import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DetectedShell, ResolvedWslTarget } from '../shared/shell'

const mocks = vi.hoisted(() => ({
  bridgeClose: vi.fn(),
  ptySpawn: vi.fn(),
  resolveAssistantCommand: vi.fn(),
  ensureWslAssistantLauncher: vi.fn(),
  startBridge: vi.fn(),
  terminateProcessTree: vi.fn()
}))

vi.mock('node-pty', () => ({ spawn: mocks.ptySpawn }))
vi.mock('./assistantCommand', () => ({
  resolveAssistantCommand: mocks.resolveAssistantCommand
}))
vi.mock('./assistantCommandBridge', () => ({
  startAssistantCommandBridge: mocks.startBridge
}))
vi.mock('./assistantWorkspace', async (importOriginal) => ({
  ...await importOriginal<typeof import('./assistantWorkspace')>(),
  ensureWslAssistantLauncher: mocks.ensureWslAssistantLauncher
}))
vi.mock('./processTermination', () => ({
  terminateProcessTree: mocks.terminateProcessTree
}))

import { AssistantTerminalService } from './assistantTerminalService'

const shells: Record<DetectedShell['family'], DetectedShell> = {
  posix: {
    id: 'posix:%2Fbin%2Fzsh',
    displayName: 'zsh',
    family: 'posix',
    executablePath: '/bin/zsh',
    source: 'system'
  },
  powershell: {
    id: 'powershell:C%3A%5CTools%5Cpwsh.exe',
    displayName: 'PowerShell 7',
    family: 'powershell',
    executablePath: 'C:\\Tools\\pwsh.exe',
    source: 'path'
  },
  cmd: {
    id: 'cmd:C%3A%5CWindows%5CSystem32%5Ccmd.exe',
    displayName: 'Command Prompt',
    family: 'cmd',
    executablePath: 'C:\\Windows\\System32\\cmd.exe',
    source: 'comspec'
  }
}

function createTerminal(pid: number) {
  return {
    pid,
    onData: vi.fn(),
    onExit: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn()
  }
}

function createService(
  resolveEffectiveShell: () => DetectedShell,
  configuredShell?: DetectedShell
) {
  return new AssistantTerminalService({
    workspace: {
      rootPath: '/private/assistant',
      binPath: '/private/assistant/bin',
      launcherPath: '/private/assistant/bin/cliloom',
      windowsLauncherPath: '/private/assistant/bin/cliloom.cmd'
    },
    environment: { PATH: '/usr/bin' },
    commandHandler: {} as never,
    shellService: {
      resolveEffectiveShell,
      getSnapshot: () => ({
        platform: 'linux',
        preferences: configuredShell
          ? {
              version: 1,
              selection: {
                mode: 'explicit',
                shell: configuredShell
              }
            }
          : { version: 1, selection: { mode: 'automatic' } },
        candidates: [],
        effectiveShell: null
      })
    } as never
  })
}

describe('AssistantTerminalService global shell integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.bridgeClose.mockResolvedValue(undefined)
    mocks.startBridge.mockResolvedValue({
      port: 32123,
      token: 'secret-token',
      close: mocks.bridgeClose
    })
    mocks.resolveAssistantCommand.mockReturnValue({
      executable: 'codex',
      args: ['--model', 'gpt 5'],
      executablePath: '/usr/bin/codex'
    })
    mocks.ensureWslAssistantLauncher.mockReturnValue('/private/assistant/wsl-bin/cliloom')
    mocks.terminateProcessTree.mockResolvedValue({ terminated: true })
  })

  it('keeps the active assistant alive and uses a newly selected shell only on restart', async () => {
    let selectedShell = shells.posix
    mocks.ptySpawn
      .mockReturnValueOnce(createTerminal(1001))
      .mockReturnValueOnce(createTerminal(1002))
    const resolveEffectiveShell = vi.fn(() => selectedShell)
    const service = createService(resolveEffectiveShell)

    await service.start('codex --model "gpt 5"')

    expect(mocks.ptySpawn).toHaveBeenNthCalledWith(
      1,
      '/bin/zsh',
      ['-ilc', expect.stringContaining("exec '/usr/bin/codex' '--model' 'gpt 5'")],
      expect.objectContaining({
        cwd: '/private/assistant',
        env: expect.objectContaining({
          PATH: expect.stringContaining('/private/assistant/bin'),
          CLILOOM_ASSISTANT_BRIDGE_TOKEN: 'secret-token'
        })
      })
    )

    selectedShell = shells.powershell
    expect(mocks.terminateProcessTree).not.toHaveBeenCalled()
    expect(resolveEffectiveShell).toHaveBeenCalledTimes(1)

    await service.restart('codex --model "gpt 5"')

    expect(mocks.terminateProcessTree).toHaveBeenCalledTimes(1)
    expect(resolveEffectiveShell).toHaveBeenCalledTimes(2)
    expect(mocks.ptySpawn).toHaveBeenNthCalledWith(
      2,
      'C:\\Tools\\pwsh.exe',
      ['-NoLogo', '-Command', expect.stringContaining("& '/usr/bin/codex' '--model' 'gpt 5'")],
      expect.any(Object)
    )
  })

  it('uses a rebuilt login environment for the next assistant start', async () => {
    mocks.ptySpawn.mockReturnValue(createTerminal(1501))
    const service = createService(() => shells.posix)

    service.setEnvironment({ PATH: '/new-login/bin:/usr/bin' })
    await service.start('codex')

    expect(mocks.resolveAssistantCommand).toHaveBeenCalledWith(
      'codex',
      { PATH: '/new-login/bin:/usr/bin' }
    )
    expect(mocks.ptySpawn).toHaveBeenCalledWith(
      '/bin/zsh',
      expect.any(Array),
      expect.objectContaining({
        env: expect.objectContaining({
          PATH: '/private/assistant/bin:/new-login/bin:/usr/bin'
        })
      })
    )
  })

  it('uses cmd with delayed expansion disabled for assistant arguments', async () => {
    mocks.ptySpawn.mockReturnValue(createTerminal(2001))
    const service = createService(() => shells.cmd)

    await service.start('codex --model "gpt 5"')

    expect(mocks.ptySpawn).toHaveBeenCalledWith(
      'C:\\Windows\\System32\\cmd.exe',
      [
        '/d',
        '/v:off',
        '/s',
        '/c',
        expect.stringContaining('"/usr/bin/codex" "--model" "gpt 5"')
      ],
      expect.any(Object)
    )
  })

  it('starts a WSL-native CLI through the token-free interop shim and cleans Linux first', async () => {
    const terminal = createTerminal(2501)
    mocks.ptySpawn.mockReturnValue(terminal)
    mocks.ensureWslAssistantLauncher.mockReturnValue('C:\\private\\assistant\\wsl-bin\\cliloom')
    const target: ResolvedWslTarget = {
      kind: 'wsl',
      id: 'wsl:v1:Ubuntu',
      displayName: 'Ubuntu',
      family: 'posix',
      distributionName: 'Ubuntu',
      validationState: 'ready',
      wslVersion: 2,
      wslExecutablePath: 'C:\\Windows\\System32\\wsl.exe',
      loginShellPath: '/bin/bash',
      homeDirectory: '/home/me',
      defaultUid: 1000,
      userShellPath: '/home/me/.nvm/versions/node/v24/bin:/usr/local/bin:/usr/bin:/bin'
    }
    const resolveTargetPath = vi.fn(async (_target: ResolvedWslTarget, value: string) => {
      const paths: Record<string, string> = {
        'C:\\private\\assistant': '/mnt/c/private/assistant',
        'C:\\private\\assistant\\wsl-bin': '/mnt/c/private/assistant/wsl-bin',
        'C:\\private\\assistant\\wsl-bin\\cliloom': '/mnt/c/private/assistant/wsl-bin/cliloom',
        'C:\\Program Files\\CLILoom\\cliloom-cli.exe': '/mnt/c/Program Files/CLILoom/cliloom-cli.exe',
        'C:\\source\\cliloom': '/mnt/c/source/cliloom'
      }
      return paths[value] ?? value
    })
    const validateWslAssistantInterop = vi.fn(async () => undefined)
    const terminateWslSession = vi.fn(async () => ({ terminated: true }))
    const service = new AssistantTerminalService({
      workspace: {
        rootPath: 'C:\\private\\assistant',
        binPath: 'C:\\private\\assistant\\bin',
        wslBinPath: 'C:\\private\\assistant\\wsl-bin',
        launcherPath: 'C:\\private\\assistant\\bin\\cliloom',
        windowsLauncherPath: 'C:\\private\\assistant\\bin\\cliloom.cmd',
        wslLauncherPath: 'C:\\private\\assistant\\wsl-bin\\cliloom',
        hostLauncherArguments: [
          'C:\\Program Files\\CLILoom\\cliloom-cli.exe',
          'C:\\Program Files\\CLILoom\\CLILoom.exe',
          '--no-sandbox',
          'C:\\source\\cliloom',
          '--cliloom-cli'
        ]
      },
      environment: { SystemRoot: 'C:\\Windows', PATH: 'C:\\Windows\\System32' },
      commandHandler: {} as never,
      platform: 'win32',
      shellService: {
        resolveEffectiveTarget: async () => target,
        resolveAssistantCommand: async () => ({
          executable: 'codex',
          args: ['--model', 'gpt 5'],
          executablePath: '/usr/local/bin/codex'
        }),
        resolveTargetPath,
        makeWslExecutable: async () => undefined,
        validateWslAssistantInterop,
        terminateWslSession,
        getSnapshot: () => ({
          platform: 'win32',
          preferences: { version: 2, selection: { mode: 'automatic' } },
          candidates: [target],
          effectiveShell: target
        })
      } as never
    })

    await service.start('codex --model "gpt 5"')

    expect(mocks.ensureWslAssistantLauncher).toHaveBeenCalledWith(
      expect.objectContaining({ wslBinPath: 'C:\\private\\assistant\\wsl-bin' }),
      [
        '/mnt/c/Program Files/CLILoom/cliloom-cli.exe',
        'C:\\Program Files\\CLILoom\\CLILoom.exe',
        '--no-sandbox',
        'C:\\source\\cliloom',
        '--cliloom-cli'
      ]
    )
    expect(resolveTargetPath).not.toHaveBeenCalledWith(target, 'C:\\source\\cliloom')
    expect(validateWslAssistantInterop).toHaveBeenCalledWith(
      target,
      '/mnt/c/private/assistant/wsl-bin/cliloom',
      expect.objectContaining({
        CLILOOM_ASSISTANT_BRIDGE_PORT: '32123',
        CLILOOM_ASSISTANT_BRIDGE_TOKEN: 'secret-token'
      })
    )
    const [executable, args, options] = mocks.ptySpawn.mock.calls[0]
    expect(executable).toBe('C:\\Windows\\System32\\wsl.exe')
    expect(args).toEqual(expect.arrayContaining([
      '--distribution', 'Ubuntu', '--cd', '/mnt/c/private/assistant', '--exec', '/bin/sh'
    ]))
    expect(args.join('\n')).not.toContain('secret-token')
    expect(options.env.CLILOOM_ASSISTANT_BRIDGE_TOKEN).toBeUndefined()
    expect(Object.values(options.env)).toContain('secret-token')
    expect(options.env.WSLENV).toMatch(/CLILOOM_WSL_TRANSPORT_/)

    await service.close()
    expect(terminateWslSession).toHaveBeenCalledOnce()
    expect(mocks.terminateProcessTree).toHaveBeenCalledWith(terminal)
    expect(terminateWslSession.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.terminateProcessTree.mock.invocationCallOrder[0])
  })

  it('confirms WSL cleanup after a natural assistant exit', async () => {
    let exitHandler: ((event: { exitCode: number; signal?: number }) => void) | undefined
    const terminal = {
      ...createTerminal(2502),
      onExit: vi.fn((handler: (event: { exitCode: number; signal?: number }) => void) => {
        exitHandler = handler
      })
    }
    mocks.ptySpawn.mockReturnValue(terminal)
    mocks.ensureWslAssistantLauncher.mockReturnValue('C:\\private\\assistant\\wsl-bin\\cliloom')
    const target: ResolvedWslTarget = {
      kind: 'wsl',
      id: 'wsl:v1:Ubuntu',
      displayName: 'Ubuntu',
      family: 'posix',
      distributionName: 'Ubuntu',
      validationState: 'ready',
      wslVersion: 2,
      wslExecutablePath: 'C:\\Windows\\System32\\wsl.exe',
      loginShellPath: '/bin/bash',
      homeDirectory: '/home/me',
      defaultUid: 1000,
      userShellPath: '/home/me/.nvm/versions/node/v24/bin:/usr/local/bin:/usr/bin:/bin'
    }
    const paths: Record<string, string> = {
      'C:\\private\\assistant': '/mnt/c/private/assistant',
      'C:\\private\\assistant\\wsl-bin': '/mnt/c/private/assistant/wsl-bin',
      'C:\\private\\assistant\\wsl-bin\\cliloom': '/mnt/c/private/assistant/wsl-bin/cliloom',
      'C:\\cliloom-cli.exe': '/mnt/c/cliloom-cli.exe'
    }
    const finalizeWslSession = vi.fn(async () => ({ terminated: true }))
    const service = new AssistantTerminalService({
      workspace: {
        rootPath: 'C:\\private\\assistant',
        binPath: 'C:\\private\\assistant\\bin',
        wslBinPath: 'C:\\private\\assistant\\wsl-bin',
        launcherPath: 'C:\\private\\assistant\\bin\\cliloom',
        windowsLauncherPath: 'C:\\private\\assistant\\bin\\cliloom.cmd',
        wslLauncherPath: 'C:\\private\\assistant\\wsl-bin\\cliloom',
        hostLauncherArguments: ['C:\\cliloom-cli.exe', 'C:\\CLILoom.exe', '--cliloom-cli']
      },
      environment: { SystemRoot: 'C:\\Windows', PATH: 'C:\\Windows\\System32' },
      commandHandler: {} as never,
      platform: 'win32',
      shellService: {
        resolveEffectiveTarget: async () => target,
        resolveAssistantCommand: async () => ({
          executable: 'codex',
          args: [],
          executablePath: '/usr/local/bin/codex'
        }),
        resolveTargetPath: async (_target: ResolvedWslTarget, value: string) => paths[value] ?? value,
        makeWslExecutable: async () => undefined,
        validateWslAssistantInterop: async () => undefined,
        terminateWslSession: vi.fn(async () => ({ terminated: true })),
        finalizeWslSession,
        getSnapshot: () => ({
          platform: 'win32',
          preferences: { version: 2, selection: { mode: 'automatic' } },
          candidates: [target],
          effectiveShell: target
        })
      } as never
    })

    await service.start('codex')
    exitHandler?.({ exitCode: 0 })

    await vi.waitFor(() => expect(service.getStatus()).toEqual({ state: 'exited', exitCode: 0 }))
    expect(finalizeWslSession).toHaveBeenCalledOnce()
    expect(mocks.bridgeClose).toHaveBeenCalledOnce()
    expect(mocks.terminateProcessTree).not.toHaveBeenCalled()
  })

  it('does not create a bridge or PTY when the explicit shell is unavailable', async () => {
    const service = createService(() => {
      throw new Error('所选 Shell 不可用')
    }, shells.posix)

    await expect(service.start('codex')).rejects.toThrow('所选 Shell 不可用')

    expect(mocks.startBridge).not.toHaveBeenCalled()
    expect(mocks.ptySpawn).not.toHaveBeenCalled()
    expect(service.getStatus()).toEqual({
      state: 'failed',
      message: expect.stringMatching(/Platform .*zsh \(\/bin\/zsh, posix\).*failed during detect: 所选 Shell 不可用.*Redetect/)
    })
  })

  it('propagates an unconfirmed process-tree cleanup and retries it on the next close', async () => {
    mocks.ptySpawn.mockReturnValue(createTerminal(3001))
    mocks.terminateProcessTree
      .mockResolvedValueOnce({ terminated: false, error: 'permission denied' })
      .mockResolvedValueOnce({ terminated: true })
    const service = createService(() => shells.posix)
    await service.start('codex')

    await expect(service.close()).rejects.toThrow('Assistant cleanup failed: permission denied')
    expect(service.getStatus()).toEqual({
      state: 'failed',
      message: 'Assistant cleanup failed: permission denied'
    })

    await expect(service.close()).resolves.toBeUndefined()
    expect(mocks.terminateProcessTree).toHaveBeenCalledTimes(2)
    expect(service.getStatus()).toEqual({ state: 'idle' })
  })
})
