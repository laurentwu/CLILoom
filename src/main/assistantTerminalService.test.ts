import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DetectedShell } from '../shared/shell'

const mocks = vi.hoisted(() => ({
  bridgeClose: vi.fn(),
  ptySpawn: vi.fn(),
  resolveAssistantCommand: vi.fn(),
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

function createWorkspaceStatus() {
  return {
    workspaceVersion: 2,
    appVersion: '0.1.0',
    buildId: `sha256:${'a'.repeat(64)}`,
    synchronized: true,
    managedFileCount: 4,
    repairedFiles: [],
    issues: []
  }
}

function createWorkspaceMetadata(
  synchronize = vi.fn(() => createWorkspaceStatus())
) {
  const status = createWorkspaceStatus()
  return {
    workspaceVersion: status.workspaceVersion,
    appVersion: status.appVersion,
    buildId: status.buildId,
    synchronize,
    inspect: vi.fn(() => status)
  }
}

function createService(
  resolveEffectiveShell: () => DetectedShell,
  configuredShell?: DetectedShell,
  synchronizeWorkspace?: () => ReturnType<typeof createWorkspaceStatus>
) {
  return new AssistantTerminalService({
    workspace: {
      rootPath: '/private/assistant',
      binPath: '/private/assistant/bin',
      launcherPath: '/private/assistant/bin/cliloom',
      windowsLauncherPath: '/private/assistant/bin/cliloom.cmd',
      ...createWorkspaceMetadata(synchronizeWorkspace
        ? vi.fn(synchronizeWorkspace)
        : undefined)
    },
    environment: { PATH: '/usr/bin' },
    platform: 'linux',
    commandHandler: {} as never,
    shellService: {
      resolveEffectiveShell,
      getSnapshot: () => ({
        platform: 'linux',
        preferences: configuredShell
          ? {
              version: 3,
              selection: {
                mode: 'explicit',
                shell: configuredShell
              }
            }
          : { version: 3, selection: { mode: 'automatic' } },
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

  it('synchronizes the managed workspace before resolving or starting the assistant', async () => {
    mocks.ptySpawn.mockReturnValue(createTerminal(1003))
    const synchronizeWorkspace = vi.fn(() => createWorkspaceStatus())
    const resolveEffectiveShell = vi.fn(() => shells.posix)
    const service = createService(
      resolveEffectiveShell,
      undefined,
      synchronizeWorkspace
    )

    await service.start('codex')

    expect(synchronizeWorkspace).toHaveBeenCalledOnce()
    expect(synchronizeWorkspace.mock.invocationCallOrder[0])
      .toBeLessThan(resolveEffectiveShell.mock.invocationCallOrder[0])
    await service.close()
  })

  it('reports workspace synchronization failures at the synchronization stage', async () => {
    const resolveEffectiveShell = vi.fn(() => shells.posix)
    const service = createService(
      resolveEffectiveShell,
      undefined,
      () => {
        throw new Error('managed workspace is blocked')
      }
    )

    await expect(service.start('codex'))
      .rejects.toThrow('failed during synchronize workspace: managed workspace is blocked')

    expect(resolveEffectiveShell).not.toHaveBeenCalled()
    expect(mocks.startBridge).not.toHaveBeenCalled()
    expect(mocks.ptySpawn).not.toHaveBeenCalled()
    expect(service.getStatus()).toEqual({
      state: 'failed',
      message: expect.stringContaining(
        'failed during synchronize workspace: managed workspace is blocked'
      )
    })
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

  it('closes the bridge after a natural native assistant exit', async () => {
    let exitHandler: ((event: { exitCode: number; signal?: number }) => void) | undefined
    const terminal = {
      ...createTerminal(2501),
      onExit: vi.fn((handler: (event: { exitCode: number; signal?: number }) => void) => {
        exitHandler = handler
      })
    }
    mocks.ptySpawn.mockReturnValue(terminal)
    const service = createService(() => shells.posix)

    await service.start('codex')
    exitHandler?.({ exitCode: 0 })

    await vi.waitFor(() => expect(service.getStatus()).toEqual({ state: 'exited', exitCode: 0 }))
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
