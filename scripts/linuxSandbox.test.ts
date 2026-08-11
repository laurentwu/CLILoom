import { createRequire } from 'node:module'
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

type SandboxInspection = {
  supported: boolean
  method: 'platform' | 'setuid' | 'userns' | 'unavailable'
  helperPath?: string
}

type LinuxSandboxModule = {
  SETUID_SANDBOX_MODE: number
  assertLinuxSandboxAvailable: (executablePath: string, options?: object) => SandboxInspection
  inspectLinuxSandbox: (executablePath: string, options?: object) => SandboxInspection
  isConfiguredSetuidSandbox: (stat: {
    isFile: () => boolean
    mode: number
    uid: number
  }) => boolean
}

const require = createRequire(import.meta.url)
const sandbox = require('./linux-sandbox.cjs') as LinuxSandboxModule
const afterPack = require('./linux-sandbox-after-pack.cjs') as (context: {
  appOutDir: string
  electronPlatformName: string
  targets?: Array<{ name: string }>
}) => Promise<void>
const temporaryDirectories: string[] = []

afterEach(() => {
  vi.restoreAllMocks()
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function fakeStat(options: { mode: number; uid: number; isFile?: boolean }) {
  return {
    isFile: () => options.isFile ?? true,
    mode: options.mode,
    uid: options.uid
  }
}

describe('Linux Chromium sandbox configuration', () => {
  it('accepts only a root-owned regular SUID helper with mode 4755', () => {
    expect(sandbox.isConfiguredSetuidSandbox(fakeStat({ mode: 0o104755, uid: 0 }))).toBe(true)
    expect(sandbox.isConfiguredSetuidSandbox(fakeStat({ mode: 0o100755, uid: 0 }))).toBe(false)
    expect(sandbox.isConfiguredSetuidSandbox(fakeStat({ mode: 0o104755, uid: 1000 }))).toBe(false)
    expect(sandbox.isConfiguredSetuidSandbox(fakeStat({ mode: 0o104755, uid: 0, isFile: false }))).toBe(false)
  })

  it('accepts user namespaces when the SUID helper is not configured', () => {
    const result = sandbox.inspectLinuxSandbox('/opt/CLILoom/cliloom', {
      platform: 'linux',
      statSync: () => fakeStat({ mode: 0o100755, uid: 1000 }),
      spawnSync: vi.fn(() => ({ status: 0 }))
    })

    expect(result).toMatchObject({ supported: true, method: 'userns' })
  })

  it('fails closed with actionable SUID helper instructions', () => {
    const options = {
      platform: 'linux',
      statSync: () => fakeStat({ mode: 0o100755, uid: 1000 }),
      spawnSync: vi.fn(() => ({ status: 1 }))
    }

    expect(() => sandbox.assertLinuxSandboxAvailable('/opt/CLILoom/cliloom', options))
      .toThrow(/sudo chmod 4755 '\/opt\/CLILoom\/chrome-sandbox'/)
  })

  it('marks the Linux package helper as SUID for DEB and RPM installation', async () => {
    const appOutDir = mkdtempSync(path.join(tmpdir(), 'cliloom-after-pack-'))
    temporaryDirectories.push(appOutDir)
    const helperPath = path.join(appOutDir, 'chrome-sandbox')
    writeFileSync(helperPath, 'fixture', { mode: 0o755 })

    await afterPack({ appOutDir, electronPlatformName: 'linux' })

    expect(statSync(helperPath).mode & 0o7777).toBe(sandbox.SETUID_SANDBOX_MODE)
  })

  it('installs an AppImage launcher that never adds the no-sandbox switch', async () => {
    const appOutDir = mkdtempSync(path.join(tmpdir(), 'cliloom-after-pack-'))
    temporaryDirectories.push(appOutDir)
    writeFileSync(path.join(appOutDir, 'chrome-sandbox'), 'fixture', { mode: 0o755 })

    await afterPack({
      appOutDir,
      electronPlatformName: 'linux',
      targets: [{ name: 'appImage' }]
    })

    const launcherPath = path.join(appOutDir, 'AppRun')
    const launcher = readFileSync(launcherPath, 'utf8')
    expect(statSync(path.join(appOutDir, 'chrome-sandbox')).mode & 0o7777).toBe(0o755)
    expect(statSync(launcherPath).mode & 0o7777).toBe(0o755)
    expect(launcher).toContain('exec "${APPDIR}/cliloom" --disable-setuid-sandbox "$@"')
    expect(launcher).not.toContain('--no-sandbox')
  })

  it('does not alter non-Linux package contents', async () => {
    const appOutDir = mkdtempSync(path.join(tmpdir(), 'cliloom-after-pack-'))
    temporaryDirectories.push(appOutDir)
    const helperPath = path.join(appOutDir, 'chrome-sandbox')
    writeFileSync(helperPath, 'fixture', { mode: 0o755 })
    chmodSync(helperPath, 0o755)

    await afterPack({ appOutDir, electronPlatformName: 'darwin' })

    expect(statSync(helperPath).mode & 0o7777).toBe(0o755)
  })
})
