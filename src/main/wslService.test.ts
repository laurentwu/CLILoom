import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  CAPABILITY_PROBE_SCRIPT,
  CGROUP_SCOPE_PROBE_SCRIPT,
  LINUX_COMMAND_PROBE_SCRIPT,
  TILDE_PATH_PROBE_SCRIPT,
  USER_SHELL_PATH_PROBE_SCRIPT,
  WSL_SESSION_SCOPE_LAUNCH_SCRIPT,
  WSL_STALE_SESSION_LIST_SCRIPT,
  WSL_SESSION_TERMINATE_SCRIPT,
  WSL_SESSION_WRAPPER_SCRIPT,
  WslService,
  buildWslTransportEnvironment,
  createWslSessionDirectory,
  createWslSessionUnitName,
  decodeWslOutput,
  mergeWslEnvValue,
  parseCommandPathOutput,
  parseMarkedOutput,
  parseUserShellPathOutput,
  parseWslDistributionList,
  parseWslUncPath,
  parseWslVerboseList,
  type WslCommandExecutor
} from './wslService'
import { createWslTargetId, type ResolvedWslTarget } from '../shared/shell'

const launcher = 'C:\\Windows\\System32\\wsl.exe'

function extractShellSection(script: string, startMarker: string, endMarker: string): string {
  const start = script.indexOf(startMarker)
  const end = script.indexOf(endMarker, start)
  if (start < 0 || end < 0) throw new Error(`Missing shell section: ${startMarker}`)
  return script.slice(start, end)
}

describe('WSL catalog parsing', () => {
  it('decodes UTF-16LE and UTF-8 catalogs, removes duplicates, and reads optional metadata', () => {
    const utf16 = Buffer.from('\uFEFFUbuntu\r\nDebian\r\nubuntu\r\n', 'utf16le')
    expect(decodeWslOutput(utf16)).toContain('Ubuntu\nDebian')
    expect(parseWslDistributionList(utf16)).toEqual(['Ubuntu', 'Debian'])
    expect(parseWslDistributionList(Buffer.from('Arch\r\n', 'utf8'))).toEqual(['Arch'])

    const verbose = parseWslVerboseList(
      Buffer.from('  NAME STATE VERSION\r\n* Ubuntu Running 2\r\n  Debian Stopped 1\r\n'),
      ['Ubuntu', 'Debian']
    )
    expect(verbose.get('ubuntu')).toEqual({ version: 2, isDefault: true })
    expect(verbose.get('debian')).toEqual({ version: 1 })

    const prefixed = parseWslVerboseList(
      Buffer.from('  Ubuntu Dev Stopped 1\r\n* Ubuntu Running 2\r\n'),
      ['Ubuntu', 'Ubuntu Dev']
    )
    expect(prefixed.get('ubuntu dev')).toEqual({ version: 1 })
    expect(prefixed.get('ubuntu')).toEqual({ version: 2, isDefault: true })
  })

  it('recognizes both WSL UNC aliases without treating ordinary UNC as WSL', () => {
    expect(parseWslUncPath('\\\\wsl$\\Ubuntu\\home\\me')).toEqual({
      distributionName: 'Ubuntu',
      relativePath: 'home\\me'
    })
    expect(parseWslUncPath('\\\\wsl.localhost\\Debian\\home')).toMatchObject({
      distributionName: 'Debian'
    })
    expect(parseWslUncPath('\\\\server\\share\\repo')).toBeNull()
  })
})

describe('WSL discovery and target validation', () => {
  it('uses the trusted launcher, keeps automatic discovery side-effect free, and validates on resolution', async () => {
    const calls: string[][] = []
    const execute: WslCommandExecutor = vi.fn(async (_executable, args) => {
      calls.push(args)
      if (args.join(' ') === '--list --quiet') {
        return { exitCode: 0, stdout: Buffer.from('Ubuntu\r\nDebian\r\n'), stderr: Buffer.alloc(0) }
      }
      if (args.join(' ') === '--list --verbose') {
        return { exitCode: 0, stdout: Buffer.from('* Ubuntu Running 2\r\n  Debian Stopped 1\r\n'), stderr: Buffer.alloc(0) }
      }
      if (args.includes(CAPABILITY_PROBE_SCRIPT)) {
        return {
          exitCode: 0,
          stdout: Buffer.from([
            '__CLILOOM_DISTRO__Ubuntu',
            '__CLILOOM_UID__1000',
            '__CLILOOM_HOME__/home/me',
            '__CLILOOM_SHELL__/bin/bash',
            `__CLILOOM_ENV__${lastProbeValue}`
          ].join('\n')),
          stderr: Buffer.alloc(0)
        }
      }
      if (args.includes('/bin/bash') && args.includes('exit 0')) {
        return { exitCode: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }
      }
      if (args.includes(USER_SHELL_PATH_PROBE_SCRIPT)) {
        return {
          exitCode: 0,
          stdout: Buffer.from([
            'profile output',
            '__CLILOOM_USER_PATH_BEGIN__',
            '/home/me/.nvm/versions/node/v24/bin:/usr/local/bin:/usr/bin:/bin:/usr/bin',
            '__CLILOOM_USER_PATH_END__'
          ].join('\n')),
          stderr: Buffer.alloc(0)
        }
      }
      if (args.includes(WSL_STALE_SESSION_LIST_SCRIPT)) {
        return { exitCode: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }
      }
      throw new Error(`unexpected WSL call: ${args.join(' ')}`)
    })
    let lastProbeValue = ''
    const wrappedExecute: WslCommandExecutor = async (executable, args, options) => {
      lastProbeValue = options.env.CLILOOM_WSL_PROBE ?? lastProbeValue
      return execute(executable, args, options)
    }
    const service = new WslService({
      platform: 'win32',
      architecture: 'x64',
      environment: {
        SystemRoot: 'C:\\Windows',
        Path: 'C:\\Windows\\System32'
      },
      inspectLauncher: (value) => value === launcher,
      execute: wrappedExecute
    })

    const catalog = await service.discover()
    expect(catalog.targets).toHaveLength(2)
    expect(catalog.targets[0]).toMatchObject({
      id: createWslTargetId('Ubuntu'),
      distributionName: 'Ubuntu',
      wslVersion: 2,
      isSystemDefault: true,
      validationState: 'unvalidated'
    })
    expect(calls.every((args) => !args.includes('--distribution'))).toBe(true)

    const resolved = await service.resolveTarget({
      kind: 'wsl',
      id: createWslTargetId('Ubuntu'),
      displayName: 'Ubuntu',
      family: 'posix',
      distributionName: 'Ubuntu'
    })
    expect(resolved).toMatchObject({
      validationState: 'ready',
      loginShellPath: '/bin/bash',
      homeDirectory: '/home/me',
      defaultUid: 1000,
      wslExecutablePath: launcher,
      userShellPath: '/home/me/.nvm/versions/node/v24/bin:/usr/local/bin:/usr/bin:/bin'
    })
    expect(calls.some((args) => args.includes(CAPABILITY_PROBE_SCRIPT))).toBe(true)
    expect(calls.some((args) => args.includes('-ilc'))).toBe(true)
    const pathProbeCall = vi.mocked(execute).mock.calls.find(([, args]) => (
      args.includes(USER_SHELL_PATH_PROBE_SCRIPT)
    ))
    expect(pathProbeCall?.[2].env).toEqual({
      SystemRoot: 'C:\\Windows',
      Path: 'C:\\Windows\\System32'
    })
    expect(pathProbeCall?.[2].timeoutMs).toBe(10_000)
  })

  it('reports an authoritative empty catalog without starting a distribution', async () => {
    const execute: WslCommandExecutor = vi.fn(async (_executable, _args) => ({
      exitCode: 0,
      stdout: Buffer.alloc(0),
      stderr: Buffer.alloc(0)
    }))
    const service = new WslService({
      platform: 'win32',
      environment: { SystemRoot: 'C:\\Windows' },
      inspectLauncher: () => true,
      execute
    })

    await expect(service.discover()).resolves.toMatchObject({
      targets: [],
      authoritative: true,
      error: expect.stringMatching(/no Linux distributions/i)
    })
    expect(execute).toHaveBeenCalledTimes(2)
    expect(vi.mocked(execute).mock.calls.every(([, args]) => !args.includes('--distribution'))).toBe(true)
  })

  it('reconfirms catalog membership before using a cached capability result', async () => {
    let registered = true
    let probeValue = ''
    const execute: WslCommandExecutor = vi.fn(async (_executable, args, options) => {
      if (args.join(' ') === '--list --quiet') {
        return {
          exitCode: 0,
          stdout: Buffer.from(registered ? 'Ubuntu\r\n' : ''),
          stderr: Buffer.alloc(0)
        }
      }
      if (args.join(' ') === '--list --verbose') {
        return { exitCode: 0, stdout: Buffer.from(registered ? 'Ubuntu Stopped 2\r\n' : ''), stderr: Buffer.alloc(0) }
      }
      if (args.includes(CAPABILITY_PROBE_SCRIPT)) {
        probeValue = options.env.CLILOOM_WSL_PROBE ?? ''
        return {
          exitCode: 0,
          stdout: Buffer.from([
            '__CLILOOM_DISTRO__Ubuntu',
            '__CLILOOM_UID__1000',
            '__CLILOOM_HOME__/home/me',
            '__CLILOOM_SHELL__/bin/bash',
            `__CLILOOM_ENV__${probeValue}`
          ].join('\n')),
          stderr: Buffer.alloc(0)
        }
      }
      if (args.includes(USER_SHELL_PATH_PROBE_SCRIPT)) {
        return {
          exitCode: 0,
          stdout: Buffer.from(
            '__CLILOOM_USER_PATH_BEGIN__\n/home/me/.local/bin:/usr/bin:/bin\n' +
            '__CLILOOM_USER_PATH_END__\n'
          ),
          stderr: Buffer.alloc(0)
        }
      }
      return { exitCode: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }
    })
    const service = new WslService({
      platform: 'win32',
      environment: { SystemRoot: 'C:\\Windows' },
      inspectLauncher: () => true,
      execute
    })
    const target = {
      kind: 'wsl' as const,
      id: createWslTargetId('Ubuntu'),
      displayName: 'Ubuntu',
      family: 'posix' as const,
      distributionName: 'Ubuntu'
    }

    await expect(service.resolveTarget(target)).resolves.toMatchObject({ loginShellPath: '/bin/bash' })
    registered = false
    await expect(service.resolveTarget(target)).rejects.toThrow(/no Linux distributions|unavailable/i)
    expect(vi.mocked(execute).mock.calls.filter(([, args]) => args.includes(CAPABILITY_PROBE_SCRIPT)))
      .toHaveLength(1)
  })

  it('reports login PATH probe failures without calling a supported shell unsupported', async () => {
    const execute: WslCommandExecutor = vi.fn(async (_executable, args, options) => {
      if (args.join(' ') === '--list --quiet') {
        return { exitCode: 0, stdout: Buffer.from('Ubuntu\r\n'), stderr: Buffer.alloc(0) }
      }
      if (args.join(' ') === '--list --verbose') {
        return { exitCode: 0, stdout: Buffer.from('Ubuntu Running 2\r\n'), stderr: Buffer.alloc(0) }
      }
      if (args.includes(CAPABILITY_PROBE_SCRIPT)) {
        return {
          exitCode: 0,
          stdout: Buffer.from([
            '__CLILOOM_DISTRO__Ubuntu',
            '__CLILOOM_UID__1000',
            '__CLILOOM_HOME__/home/me',
            '__CLILOOM_SHELL__/bin/bash',
            `__CLILOOM_ENV__${options.env.CLILOOM_WSL_PROBE ?? ''}`
          ].join('\n')),
          stderr: Buffer.alloc(0)
        }
      }
      if (args.includes(USER_SHELL_PATH_PROBE_SCRIPT)) {
        return {
          exitCode: -1,
          stdout: Buffer.alloc(0),
          stderr: Buffer.from('output limit exceeded')
        }
      }
      return { exitCode: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }
    })
    const service = new WslService({
      platform: 'win32',
      environment: { SystemRoot: 'C:\\Windows' },
      inspectLauncher: () => true,
      execute
    })

    const error = await service.resolveTarget({
      kind: 'wsl',
      id: createWslTargetId('Ubuntu'),
      displayName: 'Ubuntu',
      family: 'posix',
      distributionName: 'Ubuntu'
    }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toMatch(/read PATH.*output limit exceeded/i)
    expect((error as Error).message).not.toMatch(/unsupported/i)
  })

  it('does not enter a stopped distribution merely to terminate an old session', async () => {
    const execute: WslCommandExecutor = vi.fn(async (_executable, args) => {
      expect(args).toEqual(['--list', '--running', '--quiet'])
      return { exitCode: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }
    })
    const service = new WslService({
      platform: 'win32',
      environment: { SystemRoot: 'C:\\Windows' },
      inspectLauncher: () => true,
      execute
    })
    await expect(service.terminateSession({
      distributionName: 'Ubuntu',
      sessionId: 'session-id',
      sessionDirectory: '/home/me/.cache/cliloom/sessions',
      unitName: 'cliloom-session-id.scope'
    }))
      .resolves.toEqual({ terminated: true })
    expect(execute).toHaveBeenCalledOnce()
  })

  it('accepts a missing marker only when confirming a natural wrapper exit', async () => {
    let terminationCalls = 0
    const execute: WslCommandExecutor = vi.fn(async (_executable, args) => {
      if (args.join(' ') === '--list --running --quiet') {
        return { exitCode: 0, stdout: Buffer.from('Ubuntu\r\n'), stderr: Buffer.alloc(0) }
      }
      expect(args).toContain(WSL_SESSION_TERMINATE_SCRIPT)
      terminationCalls += 1
      return { exitCode: terminationCalls === 1 ? 44 : 45, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }
    })
    const service = new WslService({
      platform: 'win32',
      environment: { SystemRoot: 'C:\\Windows' },
      inspectLauncher: () => true,
      execute,
      wait: async () => undefined
    })
    const handle = {
      distributionName: 'Ubuntu',
      sessionId: 'session-id',
      sessionDirectory: '/home/me/.cache/cliloom/sessions',
      unitName: 'cliloom-session-id.scope'
    }

    await expect(service.finalizeSession(handle)).resolves.toEqual({ terminated: true })
    await expect(service.terminateSession(handle)).resolves.toMatchObject({ terminated: false })
  })

  it('waits for a cold-start wrapper marker before terminating the cgroup', async () => {
    let terminationAttempts = 0
    const wait = vi.fn(async () => undefined)
    const execute: WslCommandExecutor = vi.fn(async (_executable, args) => {
      if (args.join(' ') === '--list --running --quiet') {
        return { exitCode: 0, stdout: Buffer.from('Ubuntu\r\n'), stderr: Buffer.alloc(0) }
      }
      expect(args).toContain(WSL_SESSION_TERMINATE_SCRIPT)
      terminationAttempts += 1
      return {
        exitCode: terminationAttempts < 3 ? 44 : 0,
        stdout: Buffer.alloc(0),
        stderr: Buffer.alloc(0)
      }
    })
    const service = new WslService({
      platform: 'win32',
      environment: { SystemRoot: 'C:\\Windows' },
      inspectLauncher: () => true,
      execute,
      wait
    })

    await expect(service.terminateSession({
      distributionName: 'Ubuntu',
      sessionId: 'cold-start',
      sessionDirectory: '/home/me/.cache/cliloom/sessions',
      unitName: 'cliloom-cold-start.scope'
    })).resolves.toEqual({ terminated: true })
    expect(terminationAttempts).toBe(3)
    expect(wait).toHaveBeenCalledTimes(2)
  })

  it('cleans stale cgroup markers during the next uncached target validation', async () => {
    let probeValue = ''
    const execute: WslCommandExecutor = vi.fn(async (_executable, args, options) => {
      if (args.join(' ') === '--list --quiet') {
        return { exitCode: 0, stdout: Buffer.from('Ubuntu\r\n'), stderr: Buffer.alloc(0) }
      }
      if (args.join(' ') === '--list --verbose') {
        return { exitCode: 0, stdout: Buffer.from('Ubuntu Running 2\r\n'), stderr: Buffer.alloc(0) }
      }
      if (args.includes(CAPABILITY_PROBE_SCRIPT)) {
        probeValue = options.env.CLILOOM_WSL_PROBE ?? ''
        return {
          exitCode: 0,
          stdout: Buffer.from([
            '__CLILOOM_DISTRO__Ubuntu',
            '__CLILOOM_UID__1000',
            '__CLILOOM_HOME__/home/me',
            '__CLILOOM_SHELL__/bin/bash',
            `__CLILOOM_ENV__${probeValue}`
          ].join('\n')),
          stderr: Buffer.alloc(0)
        }
      }
      if (args.includes(USER_SHELL_PATH_PROBE_SCRIPT)) {
        return {
          exitCode: 0,
          stdout: Buffer.from(
            '__CLILOOM_USER_PATH_BEGIN__\n/home/me/.local/bin:/usr/bin:/bin\n' +
            '__CLILOOM_USER_PATH_END__\n'
          ),
          stderr: Buffer.alloc(0)
        }
      }
      if (args.includes(WSL_STALE_SESSION_LIST_SCRIPT)) {
        return { exitCode: 0, stdout: Buffer.from('orphan-session\n'), stderr: Buffer.alloc(0) }
      }
      if (args.join(' ') === '--list --running --quiet') {
        return { exitCode: 0, stdout: Buffer.from('Ubuntu\r\n'), stderr: Buffer.alloc(0) }
      }
      if (args.includes(WSL_SESSION_TERMINATE_SCRIPT)) {
        expect(args).toEqual(expect.arrayContaining([
          'orphan-session',
          '/home/me/.cache/cliloom/sessions',
          'cliloom-orphan-session.scope'
        ]))
        return { exitCode: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }
      }
      return { exitCode: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }
    })
    const service = new WslService({
      platform: 'win32',
      environment: { SystemRoot: 'C:\\Windows' },
      inspectLauncher: () => true,
      execute
    })

    await expect(service.resolveTarget({
      kind: 'wsl',
      id: createWslTargetId('Ubuntu'),
      displayName: 'Ubuntu',
      family: 'posix',
      distributionName: 'Ubuntu'
    })).resolves.toMatchObject({ validationState: 'ready' })
    expect(vi.mocked(execute).mock.calls.some(([, args]) => args.includes(WSL_SESSION_TERMINATE_SCRIPT)))
      .toBe(true)
  })
})

describe('WSL path and assistant resolution', () => {
  const target: ResolvedWslTarget = {
    kind: 'wsl',
    id: createWslTargetId('Ubuntu'),
    displayName: 'Ubuntu',
    family: 'posix',
    distributionName: 'Ubuntu',
    validationState: 'ready',
    wslExecutablePath: launcher,
    loginShellPath: '/bin/bash',
    homeDirectory: '/home/me',
    defaultUid: 1000,
    userShellPath: '/home/me/.nvm/versions/node/v24/bin:/usr/local/bin:/usr/bin:/bin'
  }

  it('handles Linux, drive, and matching UNC paths while rejecting ambiguous inputs', async () => {
    const execute: WslCommandExecutor = vi.fn(async (_executable, args) => {
      if (args.at(-2) === '-u') {
        const input = String(args.at(-1))
        return {
          exitCode: 0,
          stdout: Buffer.from(input.startsWith('\\\\wsl')
            ? '/home/me/repo\n'
            : input.endsWith(' ')
              ? '/mnt/c/work/repo \n'
              : '/mnt/c/work/repo\n'),
          stderr: Buffer.alloc(0)
        }
      }
      if (args.at(-2) === '-w') {
        const input = String(args.at(-1))
        return {
          exitCode: 0,
          stdout: Buffer.from(input.endsWith(' ')
            ? '\\\\wsl.localhost\\Ubuntu\\home\\me\\repo \r\n'
            : '\\\\wsl.localhost\\Ubuntu\\home\\me\\repo\r\n'),
          stderr: Buffer.alloc(0)
        }
      }
      if (args.includes(TILDE_PATH_PROBE_SCRIPT)) {
        expect(args.at(-1)).toBe('~other/repo')
        return { exitCode: 0, stdout: Buffer.from('/home/other/repo'), stderr: Buffer.alloc(0) }
      }
      return { exitCode: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }
    })
    const service = new WslService({ platform: 'win32', execute, inspectLauncher: () => true })

    await expect(service.resolveTargetPath(target, '/tmp/repo')).resolves.toBe('/tmp/repo')
    await expect(service.resolveTargetPath(target, '~')).resolves.toBe('/home/me')
    await expect(service.resolveTargetPath(target, '~other/repo')).resolves.toBe('/home/other/repo')
    await expect(service.resolveTargetPath(target, 'C:\\work\\repo')).resolves.toBe('/mnt/c/work/repo')
    await expect(service.resolveTargetPath(target, 'C:\\work\\repo ')).resolves.toBe('/mnt/c/work/repo ')
    await expect(service.toWindowsPath(target, '/home/me/repo '))
      .resolves.toBe('\\\\wsl.localhost\\Ubuntu\\home\\me\\repo ')
    await expect(service.resolveTargetPath(target, '\\\\wsl$\\Ubuntu\\home\\me\\repo'))
      .resolves.toBe('/home/me/repo')
    await expect(service.resolveTargetPath(target, '\\\\wsl$\\Debian\\home\\me'))
      .rejects.toThrow(/Debian.*Ubuntu|Ubuntu.*Debian/)
    await expect(service.resolveTargetPath(target, '\\\\server\\share\\repo'))
      .rejects.toThrow(/network UNC/i)
    await expect(service.resolveTargetPath(target, 'relative/repo')).rejects.toThrow(/absolute/i)
    await expect(service.runInTarget(target, ['true'], undefined, 5_000, 'relative/repo'))
      .rejects.toThrow(/absolute/i)

    const canonical = await service.canonicalizeWslProjectPath(
      target,
      '\\\\wsl$\\Ubuntu\\home\\me\\repo'
    )
    expect(canonical).toEqual({
      hostPath: '\\\\wsl.localhost\\Ubuntu\\home\\me\\repo',
      targetPath: '/home/me/repo',
      identityKey: 'wsl:ubuntu:/home/me/repo'
    })
    expect(vi.mocked(execute).mock.calls.every(([, args]) => (
      args[0] === '--distribution' && args[1] === 'Ubuntu' &&
      args[2] === '--cd' && args[3] === '/'
    ))).toBe(true)
  })

  it('resolves the assistant command from the interactive user PATH through the Linux-only probe', async () => {
    const execute: WslCommandExecutor = vi.fn(async (_executable, args) => {
      if (args.includes(LINUX_COMMAND_PROBE_SCRIPT)) {
        expect(args.at(-1)).toBe('codex')
        expect(args).toEqual(expect.arrayContaining([
          '--cd', '/home/me', '--exec', '/bin/bash', '-ilc'
        ]))
        return {
          exitCode: 0,
          stdout: Buffer.from([
            'interactive profile output',
            '__CLILOOM_COMMAND_PATH_BEGIN__',
            '/home/me/.nvm/versions/node/v24/bin/codex',
            '__CLILOOM_COMMAND_PATH_END__'
          ].join('\n')),
          stderr: Buffer.alloc(0)
        }
      }
      if (args.includes('--version')) {
        return { exitCode: 0, stdout: Buffer.from('codex 1.2.3\n'), stderr: Buffer.alloc(0) }
      }
      throw new Error(`unexpected call: ${args.join(' ')}`)
    })
    const service = new WslService({
      platform: 'win32',
      environment: { SystemRoot: 'C:\\Windows' },
      execute,
      inspectLauncher: () => true
    })

    await expect(service.resolveAssistantCommand(target, 'codex --model "gpt 5"')).resolves.toEqual({
      executable: 'codex',
      args: ['--model', 'gpt 5'],
      executablePath: '/home/me/.nvm/versions/node/v24/bin/codex',
      versionOutput: 'codex 1.2.3'
    })
    const probeCall = vi.mocked(execute).mock.calls.find(([, args]) => (
      args.includes(LINUX_COMMAND_PROBE_SCRIPT)
    ))
    expect(probeCall?.[2].env).toEqual({ SystemRoot: 'C:\\Windows' })
    expect(probeCall?.[2].timeoutMs).toBe(10_000)
    expect(LINUX_COMMAND_PROBE_SCRIPT).not.toContain('codex')
  })

  it('distinguishes a slow login profile from a missing Linux-native assistant', async () => {
    const execute: WslCommandExecutor = vi.fn(async (_executable, args, options) => {
      expect(args).toContain(LINUX_COMMAND_PROBE_SCRIPT)
      expect(options.timeoutMs).toBe(10_000)
      return {
        exitCode: null,
        stdout: Buffer.alloc(0),
        stderr: Buffer.alloc(0),
        timedOut: true
      }
    })
    const service = new WslService({
      platform: 'win32',
      environment: { SystemRoot: 'C:\\Windows' },
      execute,
      inspectLauncher: () => true
    })

    const error = await service.resolveAssistantCommand(target, 'codex')
      .catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toMatch(/inspect.*timed out/i)
    expect((error as Error).message).not.toMatch(/install/i)
  })

  it('reports WSL-native CLI and interop failures without suggesting a host fallback', async () => {
    const execute: WslCommandExecutor = vi.fn(async () => ({
      exitCode: 44,
      stdout: Buffer.alloc(0),
      stderr: Buffer.alloc(0)
    }))
    const service = new WslService({ platform: 'win32', execute, inspectLauncher: () => true })

    await expect(service.resolveAssistantCommand(target, 'codex'))
      .rejects.toThrow(/Linux-native.*Ubuntu|Ubuntu.*Linux-native/i)
    await expect(service.validateAssistantInterop(target, '/mnt/c/private/cliloom', {
      CLILOOM_ASSISTANT_BRIDGE_PORT: '1234',
      CLILOOM_ASSISTANT_BRIDGE_TOKEN: 'token'
    })).rejects.toThrow(/interop.*Ubuntu|Ubuntu.*interop/i)
  })
})

describe('WSL environment transport and helper scripts', () => {
  it('replaces conflicting WSLENV entries while preserving unrelated entries and literal values', () => {
    expect(mergeWslEnvValue('KEEP/u:foo/p:Path/l', ['FOO', 'PATH'], ['path']))
      .toBe('KEEP/u:FOO:PATH/u')
    const environment = buildWslTransportEnvironment(
      { SystemRoot: 'C:\\Windows', Path: 'host-path', WSLENV: 'KEEP/u:foo/p' },
      { FOO: '${HOME}\n中文', PATH: '/custom/bin' }
    )
    expect(environment.FOO).toBe('${HOME}\n中文')
    expect(environment.PATH).toBe('/custom/bin')
    expect(environment.Path).toBeUndefined()
    expect(environment.WSLENV).toBe('KEEP/u:FOO:PATH')
  })

  it('accepts CRLF probe framing and rejects malformed or unsafe marked output', () => {
    expect(parseUserShellPathOutput(Buffer.from(
      '__CLILOOM_USER_PATH_BEGIN__\r\n/usr/bin:/bin:/usr/bin\r\n' +
      '__CLILOOM_USER_PATH_END__\r\n'
    ))).toBe('/usr/bin:/bin')

    for (const output of [
      '/usr/bin',
      '__CLILOOM_USER_PATH_END__\n/usr/bin\n__CLILOOM_USER_PATH_BEGIN__',
      '__CLILOOM_USER_PATH_BEGIN__\n\n__CLILOOM_USER_PATH_END__',
      '__CLILOOM_USER_PATH_BEGIN__\n/usr\r/bin\n__CLILOOM_USER_PATH_END__',
      '__CLILOOM_USER_PATH_BEGIN__\n/usr/bin\n/evil\n__CLILOOM_USER_PATH_END__',
      '__CLILOOM_USER_PATH_BEGIN__\n/usr/bin\0/evil\n__CLILOOM_USER_PATH_END__',
      `__CLILOOM_USER_PATH_BEGIN__\n${'x'.repeat(16_385)}\n__CLILOOM_USER_PATH_END__`
    ]) {
      expect(() => parseUserShellPathOutput(Buffer.from(output))).toThrow(/invalid output/i)
    }
    expect(() => parseCommandPathOutput(Buffer.from(
      '__CLILOOM_COMMAND_PATH_BEGIN__\nrelative/codex\n__CLILOOM_COMMAND_PATH_END__'
    ))).toThrow(/invalid path/i)
    expect(() => parseMarkedOutput(Buffer.from('END\nvalue\nBEGIN'), 'BEGIN', 'END'))
      .toThrow(/invalid output/i)
  })

  it('keeps all fixed Linux helpers syntactically valid POSIX shell', () => {
    for (const script of [
      CAPABILITY_PROBE_SCRIPT,
      CGROUP_SCOPE_PROBE_SCRIPT,
      LINUX_COMMAND_PROBE_SCRIPT,
      TILDE_PATH_PROBE_SCRIPT,
      USER_SHELL_PATH_PROBE_SCRIPT,
      WSL_SESSION_SCOPE_LAUNCH_SCRIPT,
      WSL_STALE_SESSION_LIST_SCRIPT,
      WSL_SESSION_WRAPPER_SCRIPT,
      WSL_SESSION_TERMINATE_SCRIPT
    ]) {
      const result = spawnSync('/bin/sh', ['-n'], { input: script, encoding: 'utf8' })
      expect(result.status, result.stderr).toBe(0)
    }
    expect(CAPABILITY_PROBE_SCRIPT).toContain('/proc/$probe_child/environ')
    for (const command of ['mkdir', 'chmod', 'mv', 'rm', 'printf', 'env', 'setsid', 'systemd-run']) {
      expect(CAPABILITY_PROBE_SCRIPT).toContain(`command -v ${command}`)
    }
    expect(CGROUP_SCOPE_PROBE_SCRIPT).toContain('env -i')
    expect(CGROUP_SCOPE_PROBE_SCRIPT).toContain('cgroup.procs')
    expect(LINUX_COMMAND_PROBE_SCRIPT).toContain(
      'candidate=$(PATH=$linux_path command -v "$requested"'
    )
    expect(CAPABILITY_PROBE_SCRIPT).toContain('--expand-environment=no')
    expect(WSL_SESSION_SCOPE_LAUNCH_SCRIPT).toContain('--expand-environment=no')
    expect(WSL_SESSION_WRAPPER_SCRIPT).toContain('read_process_identity() {')
    expect(WSL_SESSION_WRAPPER_SCRIPT).toContain('started=${20}')
    expect(WSL_SESSION_WRAPPER_SCRIPT).not.toContain('started=$20\n')
    expect(WSL_SESSION_WRAPPER_SCRIPT).toContain(
      'eval "transport_present=\\${$source_name+x}"'
    )
    expect(WSL_SESSION_WRAPPER_SCRIPT).toContain(
      'eval "transport_value=\\${$source_name-}"'
    )
    expect(WSL_SESSION_WRAPPER_SCRIPT).toContain('collect_members')
    expect(WSL_SESSION_WRAPPER_SCRIPT).not.toContain('live=$(members)')
    expect(WSL_SESSION_TERMINATE_SCRIPT).toContain(
      '[ "$leader_identity" = 0 ] || [ "$leader_valid" = 1 ] || exit 46'
    )
    expect(WSL_STALE_SESSION_LIST_SCRIPT).toContain(
      '[ "$leader_identity" = 0 ] || [ "$active" = 1 ] || exit 46'
    )
    expect(createWslSessionDirectory('/home/me')).toBe('/home/me/.cache/cliloom/sessions')
    expect(createWslSessionUnitName('session-id')).toBe('cliloom-session-id.scope')
  })

  it('reads proc identity without replacing the wrapper transport arguments', () => {
    const fieldsAfterCommand = Array.from({ length: 20 }, (_, index) => String(index + 1))
    fieldsAfterCommand[0] = 'S'
    fieldsAfterCommand[19] = '424242'
    const statLine = `123 (worker process) ${fieldsAfterCommand.join(' ')}`
    const result = spawnSync('/bin/sh', ['-c', [
      'stat_line=$1',
      'shift',
      'read_process_identity() {',
      '  rest=${stat_line##*) }',
      '  set -- $rest',
      '  pgrp=${3}',
      '  sid=${4}',
      '  started=${20}',
      '}',
      'read_process_identity',
      'printf \'%s|%s|%s|%s|%s\' "$1" "$2" "$pgrp" "$sid" "$started"'
    ].join('\n'), 'cliloom-proc-stat-test', statLine, 'TARGET_NAME', 'SOURCE_NAME'], { encoding: 'utf8' })

    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toBe('TARGET_NAME|SOURCE_NAME|3|4|424242')
    expect(WSL_SESSION_WRAPPER_SCRIPT).toContain('read_process_identity')
    expect(WSL_SESSION_WRAPPER_SCRIPT).toContain('started=${20}')
  })

  it('transports literal and empty environment values and rejects a missing source', () => {
    const sourceLiteral = 'CLILOOM_WSL_TRANSPORT_0'
    const sourceEmpty = 'CLILOOM_WSL_TRANSPORT_1'
    const literalValue = 'literal $HOME; $(printf injected)\nsecond line'
    const runUserShell = extractShellSection(
      WSL_SESSION_WRAPPER_SCRIPT,
      'run_user_shell() (',
      '\n\ntrap '
    )
    const harness = [
      'set -eu',
      'initial_path=$1',
      'login_shell=$2',
      'mode=command',
      'command=$3',
      'shift 3',
      runUserShell,
      'run_user_shell "$@"'
    ].join('\n')
    const command = [
      'set -eu',
      'printf \'__CLILOOM_LITERAL_BEGIN__%s__CLILOOM_LITERAL_END__\\n\' "$CLILOOM_TEST_LITERAL"',
      '[ "${CLILOOM_TEST_EMPTY+x}" = x ]',
      '[ -z "$CLILOOM_TEST_EMPTY" ]',
      '[ "${CLILOOM_WSL_TRANSPORT_0+x}" != x ]',
      '[ "${CLILOOM_WSL_TRANSPORT_1+x}" != x ]'
    ].join('\n')
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      [sourceLiteral]: literalValue,
      [sourceEmpty]: ''
    }
    const result = spawnSync('/bin/sh', [
      '-c', harness, 'cliloom-transport-test',
      process.env.PATH ?? '/usr/bin:/bin', '/bin/sh', command,
      'CLILOOM_TEST_LITERAL', sourceLiteral,
      'CLILOOM_TEST_EMPTY', sourceEmpty
    ], { encoding: 'utf8', env: environment })

    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain(
      `__CLILOOM_LITERAL_BEGIN__${literalValue}__CLILOOM_LITERAL_END__\n`
    )

    delete environment[sourceLiteral]
    const missing = spawnSync('/bin/sh', [
      '-c', harness, 'cliloom-transport-missing-test',
      process.env.PATH ?? '/usr/bin:/bin', '/bin/sh', 'exit 99',
      'CLILOOM_TEST_LITERAL', sourceLiteral
    ], { encoding: 'utf8', env: environment })

    expect(missing.status, missing.stderr).toBe(66)
  })

  it('collects numeric cgroup members without including the wrapper process', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'cliloom-cgroup-members-'))
    try {
      const cgroupProcs = path.join(directory, 'cgroup.procs')
      const collectMembers = extractShellSection(
        WSL_SESSION_WRAPPER_SCRIPT,
        'collect_members() {',
        '\n\ncleanup_members() {'
      )
      const result = spawnSync('/bin/sh', ['-c', [
        'set -eu',
        'cgroup_procs=$1',
        'printf \'%s\\n\' "$$" not-a-pid 41 \'\' 82 > "$cgroup_procs"',
        collectMembers,
        'live=stale',
        'collect_members',
        'printf \'%s\' "$live"'
      ].join('\n'), 'cliloom-cgroup-members-test', cgroupProcs], { encoding: 'utf8' })

      expect(result.status, result.stderr).toBe(0)
      expect(result.stdout).toBe('41 82')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
