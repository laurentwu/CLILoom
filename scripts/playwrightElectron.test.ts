import { mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildE2eLaunchPlan,
  E2eToolUnavailableError,
  findExecutableOnPath,
  resolvePlaywrightCliPath,
  runE2eLaunch
} from './playwright-electron.cjs'

const PLAYWRIGHT_CLI = resolvePlaywrightCliPath()

function planFor(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, forwardedArgs: string[] = []) {
  return buildE2eLaunchPlan({
    platform,
    env,
    nodeExecutable: '/opt/node/bin/node',
    cliPath: PLAYWRIGHT_CLI,
    forwardedArgs
  })
}

describe('buildE2eLaunchPlan', () => {
  it('runs Playwright directly on non-Linux platforms', () => {
    for (const platform of ['darwin', 'win32'] as const) {
      const plan = planFor(platform, { PATH: '/usr/bin' })
      expect(plan.executable, platform).toBe('/opt/node/bin/node')
      expect(plan.args, platform).toEqual([PLAYWRIGHT_CLI, 'test'])
    }
  })

  it('wraps dbus-run-session around the node command when a display exists', () => {
    const plan = planFor('linux', { PATH: '/usr/bin', DISPLAY: ':0' })
    expect(plan.executable).toBe('/usr/bin/dbus-run-session')
    expect(plan.args).toEqual(['--', '/opt/node/bin/node', PLAYWRIGHT_CLI, 'test'])
  })

  it('adds xvfb-run when DISPLAY is missing or empty', () => {
    for (const env of [{ PATH: '/usr/bin' }, { PATH: '/usr/bin', DISPLAY: '' }] as const) {
      const plan = planFor('linux', env)
      expect(plan.executable).toBe('/usr/bin/dbus-run-session')
      expect(plan.args).toEqual([
        '--',
        '/usr/bin/xvfb-run',
        '-a',
        '/opt/node/bin/node',
        PLAYWRIGHT_CLI,
        'test'
      ])
    }
  })

  it('forwards original CLI arguments verbatim without shell reassembly', () => {
    const forwarded = ['--reporter=line', 'e2e/terminal.e2e.ts', 'a path with spaces.spec.ts']
    const plan = planFor('linux', { PATH: '/usr/bin', DISPLAY: ':1' }, forwarded)
    expect(plan.args.slice(-forwarded.length)).toEqual(forwarded)
    const plain = planFor('darwin', { PATH: '/usr/bin' }, forwarded)
    expect(plain.args.slice(-forwarded.length)).toEqual(forwarded)
  })

  it('fails closed when dbus-run-session is missing on Linux', () => {
    expect(() => planFor('linux', { PATH: '/nonexistent', DISPLAY: ':0' }))
      .toThrow(E2eToolUnavailableError)
    try {
      planFor('linux', { PATH: '/nonexistent', DISPLAY: ':0' })
    } catch (error) {
      expect((error as E2eToolUnavailableError).message).toContain('dbus-run-session')
      expect((error as E2eToolUnavailableError).message).toContain('dbus-daemon')
    }
  })

  it('fails closed when xvfb-run is missing without a display', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'cliloom-e2e-tools-'))
    try {
      // Provide dbus-run-session but not xvfb-run.
      symlinkSync('/usr/bin/dbus-run-session', path.join(directory, 'dbus-run-session'))
      expect(() => planFor('linux', { PATH: directory, DISPLAY: '' }))
        .toThrow(E2eToolUnavailableError)
      try {
        planFor('linux', { PATH: directory, DISPLAY: '' })
      } catch (error) {
        expect((error as E2eToolUnavailableError).message).toContain('xvfb-run')
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('locates executables across every PATH entry', () => {
    expect(findExecutableOnPath('definitely-missing-tool', { PATH: '/usr/bin:/bin' })).toBeNull()
    const found = findExecutableOnPath('sh', { PATH: '/nonexistent:/usr/bin:/bin' })
    expect(found === null || found.endsWith('sh')).toBe(true)
  })
})

describe('runE2eLaunch subprocess behavior', () => {
  const dbusAvailable = process.platform === 'linux' &&
    findExecutableOnPath('dbus-run-session', process.env) !== null

  it.skipIf(!dbusAvailable || process.platform !== 'linux')(
    'gives the wrapped command a valid isolated D-Bus session address',
    async () => {
      const plan = buildE2eLaunchPlan({
        platform: 'linux',
        env: { ...process.env, DISPLAY: process.env.DISPLAY ?? '' },
        nodeExecutable: process.execPath,
        cliPath: '/dev/null',
        forwardedArgs: []
      })
      // Replace the Playwright invocation with an inline D-Bus probe.
      const probe = plan.args.findIndex((argument) => argument === '/dev/null')
      const args = [...plan.args]
      args.splice(
        probe,
        1,
        '-e',
        'const address = process.env.DBUS_SESSION_BUS_ADDRESS || "";' +
          'if (!address.startsWith("unix:")) { console.error("invalid address: " + address); process.exit(3); }' +
          'process.stdout.write("dbus-ok");'
      )
      const { child, done } = runE2eLaunch(
        { executable: plan.executable, args },
        { env: { ...process.env, DBUS_SESSION_BUS_ADDRESS: 'invalid:stale' }, stdio: ['ignore', 'pipe', 'pipe'] }
      )
      child.stderr?.on('data', () => undefined)
      const result = await done
      expect(result.code).toBe(0)
    },
    30_000
  )

  it.skipIf(!dbusAvailable || process.platform !== 'linux')(
    'propagates a non-zero exit code from the wrapped command',
    async () => {
      const plan = buildE2eLaunchPlan({
        platform: 'linux',
        env: { ...process.env, DISPLAY: process.env.DISPLAY ?? '' },
        nodeExecutable: process.execPath,
        cliPath: '/dev/null',
        forwardedArgs: []
      })
      const probe = plan.args.findIndex((argument) => argument === '/dev/null')
      const args = [...plan.args]
      args.splice(probe, 1, '-e', 'process.exit(7)')
      const { child, done } = runE2eLaunch(
        { executable: plan.executable, args },
        { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] }
      )
      child.stdout?.on('data', () => undefined)
      child.stderr?.on('data', () => undefined)
      const result = await done
      expect(result.code).toBe(7)
    },
    30_000
  )

  it('reports a startup failure with code 1 instead of silently passing', async () => {
    const { done } = runE2eLaunch(
      { executable: '/definitely/missing/e2e-wrapper', args: [] },
      { env: process.env }
    )
    const result = await done
    expect(result.code).toBe(1)
    expect(result.error).toBeInstanceOf(Error)
  })

  it.skipIf(!dbusAvailable || process.platform !== 'linux')(
    'terminates the wrapped chain on SIGTERM without orphans',
    async () => {
      const plan = buildE2eLaunchPlan({
        platform: 'linux',
        env: { ...process.env, DISPLAY: process.env.DISPLAY ?? '' },
        nodeExecutable: process.execPath,
        cliPath: '/dev/null',
        forwardedArgs: []
      })
      const probe = plan.args.findIndex((argument) => argument === '/dev/null')
      const args = [...plan.args]
      args.splice(
        probe,
        1,
        '-e',
        'process.stdout.write("started:" + process.pid + "\\n"); setInterval(() => undefined, 500)'
      )
      const { child, done } = runE2eLaunch(
        { executable: plan.executable, args },
        { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] }
      )
      const started = new Promise<number>((resolve) => {
        let output = ''
        child.stdout?.on('data', (chunk: Buffer) => {
          output += chunk.toString()
          const match = /started:(\d+)\n/.exec(output)
          if (match) resolve(Number(match[1]))
        })
      })
      child.stderr?.on('data', () => undefined)
      let probePid: number | undefined
      try {
        probePid = await started
        child.kill('SIGTERM')
        const result = await done
        expect(result.signal === 'SIGTERM' || result.code !== null).toBe(true)
        // Check the actual PID: a surviving orphan no longer has the wrapper
        // as its parent. A zombie has exited and is awaiting its host reaper.
        await expect.poll(() => {
          try {
            const stat = readFileSync(`/proc/${probePid}/stat`, 'utf8')
            return stat.slice(stat.lastIndexOf(')') + 2).startsWith('Z')
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true
            throw error
          }
        }).toBe(true)
      } finally {
        child.kill('SIGTERM')
        if (probePid) {
          try { process.kill(probePid, 'SIGKILL') } catch { /* Already reaped. */ }
        }
      }
    },
    30_000
  )
})
