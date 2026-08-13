import { EventEmitter } from 'node:events'
import { lstatSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  classifyInstanceLaunch,
  createDesktopInstanceLaunchData,
  launchReplacementExecutable,
  parseDesktopInstanceLaunchData,
  resolvePortableExecutablePath
} from './instanceHandoff'

const temporaryDirectories: string[] = []
const currentBuildId = `sha256:${'a'.repeat(64)}`
const incomingBuildId = `sha256:${'b'.repeat(64)}`

function canCreateFileSymbolicLinks(): boolean {
  const directory = mkdtempSync(path.join(tmpdir(), 'cliloom-symlink-probe-'))
  const target = path.join(directory, 'target')
  const link = path.join(directory, 'link')
  try {
    writeFileSync(target, 'probe')
    symlinkSync(target, link)
    return lstatSync(link).isSymbolicLink()
  } catch {
    return false
  } finally {
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
}

const supportsFileSymbolicLinks = canCreateFileSymbolicLinks()

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})

function createPortableFixture(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'cliloom-portable-handoff-'))
  temporaryDirectories.push(directory)
  const executablePath = path.join(directory, 'CLILoom Portable.exe')
  writeFileSync(executablePath, 'fixture')
  return executablePath
}

describe('portable instance handoff', () => {
  it('publishes the validated outer portable executable path', () => {
    const executablePath = createPortableFixture()
    const resolvedPath = resolvePortableExecutablePath({
      PORTABLE_EXECUTABLE_FILE: executablePath
    }, 'win32')
    const data = createDesktopInstanceLaunchData({
      identity: {
        version: 1,
        appVersion: '0.1.0',
        sourceHash: 'c'.repeat(64),
        buildId: currentBuildId,
        platform: 'win32',
        architecture: 'x64'
      },
      environment: { PORTABLE_EXECUTABLE_FILE: executablePath }
    })

    expect(resolvedPath).toBe(executablePath)
    expect(data).toMatchObject({
      protocolVersion: 1,
      appVersion: '0.1.0',
      buildId: currentBuildId,
      platform: 'win32',
      architecture: 'x64',
      portableExecutablePath: executablePath
    })
    expect(parseDesktopInstanceLaunchData(data)).toEqual(data)
  })

  it('focuses the same build and offers a handoff only for a different portable build', () => {
    const executablePath = createPortableFixture()
    const base = {
      kind: 'cliloom-desktop-instance',
      protocolVersion: 1,
      appVersion: '0.1.0',
      platform: 'win32',
      architecture: 'x64',
      portableExecutablePath: executablePath
    }

    expect(classifyInstanceLaunch(currentBuildId, {
      ...base,
      buildId: currentBuildId
    })).toEqual({ action: 'focus' })
    expect(classifyInstanceLaunch(currentBuildId, {
      ...base,
      buildId: incomingBuildId
    })).toMatchObject({
      action: 'offer-handoff',
      executablePath,
      incoming: { buildId: incomingBuildId }
    })
    expect(classifyInstanceLaunch(currentBuildId, {
      ...base,
      buildId: incomingBuildId,
      portableExecutablePath: null
    })).toMatchObject({
      action: 'handoff-unavailable',
      incoming: { buildId: incomingBuildId }
    })
    expect(classifyInstanceLaunch(currentBuildId, { buildId: incomingBuildId }))
      .toEqual({ action: 'focus' })
  })

  it.each([
    { name: 'wrong kind', override: { kind: 'other-application' } },
    { name: 'wrong protocol', override: { protocolVersion: 2 } },
    { name: 'unsafe version', override: { appVersion: '0.1.0\0unexpected' } },
    { name: 'invalid build id', override: { buildId: 'sha256:invalid' } },
    { name: 'unsupported platform', override: { platform: 'freebsd' } },
    { name: 'unsupported architecture', override: { architecture: 'ia32' } },
    {
      name: 'portable path on a non-Windows platform',
      override: { platform: 'linux', portableExecutablePath: '/tmp/CLILoom.exe' }
    },
    { name: 'relative portable path', override: { portableExecutablePath: 'CLILoom.exe' } },
    { name: 'non-executable extension', override: { portableExecutablePath: 'C:\\CLILoom.txt' } }
  ])('rejects malformed launch data with $name', ({ override }) => {
    const valid = {
      kind: 'cliloom-desktop-instance',
      protocolVersion: 1,
      appVersion: '0.1.0',
      buildId: incomingBuildId,
      platform: 'win32',
      architecture: 'x64',
      portableExecutablePath: 'C:\\CLILoom.exe'
    }

    expect(parseDesktopInstanceLaunchData({ ...valid, ...override })).toBeNull()
  })

  it('rejects unavailable, unsafe, and non-Windows portable executable paths', () => {
    const executablePath = createPortableFixture()
    const directoryPath = path.join(path.dirname(executablePath), 'Directory.exe')
    mkdirSync(directoryPath)

    expect(resolvePortableExecutablePath({
      PORTABLE_EXECUTABLE_FILE: executablePath
    }, 'linux')).toBeNull()
    expect(resolvePortableExecutablePath({
      PORTABLE_EXECUTABLE_FILE: 'relative.exe'
    }, 'win32')).toBeNull()
    expect(resolvePortableExecutablePath({
      PORTABLE_EXECUTABLE_FILE: directoryPath
    }, 'win32')).toBeNull()
  })

  it.runIf(supportsFileSymbolicLinks)('rejects a symbolic-link portable executable', () => {
    const executablePath = createPortableFixture()
    const symlinkPath = path.join(path.dirname(executablePath), 'Alias.exe')
    symlinkSync(executablePath, symlinkPath)

    expect(resolvePortableExecutablePath({
      PORTABLE_EXECUTABLE_FILE: symlinkPath
    }, 'win32')).toBeNull()
  })

  it('launches without inheriting portable or assistant bridge state', async () => {
    const executablePath = createPortableFixture()
    const child = new EventEmitter() as EventEmitter & { unref: ReturnType<typeof vi.fn> }
    child.unref = vi.fn()
    const spawnProcess = vi.fn(() => {
      queueMicrotask(() => child.emit('spawn'))
      return child
    })

    await launchReplacementExecutable(executablePath, {
      platform: 'win32',
      environment: {
        PATH: '/bin',
        PORTABLE_EXECUTABLE_FILE: '/old/CLILoom.exe',
        CLILOOM_ASSISTANT_BRIDGE_TOKEN: 'secret',
        CLILOOM_ASSISTANT_CLI_STDIN_PIPE: '\\\\.\\pipe\\stale'
      },
      spawnProcess: spawnProcess as never
    })

    expect(spawnProcess).toHaveBeenCalledWith(executablePath, [], expect.objectContaining({
      detached: true,
      shell: false,
      stdio: 'ignore',
      env: { PATH: '/bin' }
    }))
    expect(child.unref).toHaveBeenCalledOnce()
  })

  it('rejects when the replacement process emits an error before spawning', async () => {
    const executablePath = createPortableFixture()
    const child = new EventEmitter() as EventEmitter & { unref: ReturnType<typeof vi.fn> }
    child.unref = vi.fn()
    const spawnProcess = vi.fn(() => {
      queueMicrotask(() => child.emit('error', new Error('spawn denied')))
      return child
    })

    await expect(launchReplacementExecutable(executablePath, {
      platform: 'win32',
      spawnProcess: spawnProcess as never
    })).rejects.toThrow('spawn denied')

    expect(child.unref).not.toHaveBeenCalled()
  })
})
