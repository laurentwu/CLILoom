import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { spawn } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import {
  resolveTaskkillPath,
  runTaskkill,
  terminateProcessTree
} from './processTermination'

function createTaskkillProcess(): {
  child: ReturnType<typeof spawn>
  stderr: PassThrough
  kill: ReturnType<typeof vi.fn>
} {
  const emitter = new EventEmitter()
  const stderr = new PassThrough()
  const kill = vi.fn()
  return {
    child: Object.assign(emitter, { stderr, kill }) as unknown as ReturnType<typeof spawn>,
    stderr,
    kill
  }
}

describe('terminateProcessTree safety', () => {
  it('never sends a process-group signal for an unowned PID', async () => {
    const processKill = vi.spyOn(process, 'kill')
    const directKill = vi.fn()

    await expect(terminateProcessTree(
      { pid: 4242, kill: directKill },
      { platform: 'linux', graceMs: 0, isDirectChild: () => false }
    )).resolves.toEqual({ terminated: true })

    expect(processKill).not.toHaveBeenCalled()
    expect(directKill).toHaveBeenNthCalledWith(1, 'SIGTERM')
    expect(directKill).toHaveBeenNthCalledWith(2, 'SIGKILL')
    processKill.mockRestore()
  })

  it('uses the owned process group when direct-child ownership is verified', async () => {
    const processKill = vi.spyOn(process, 'kill').mockReturnValue(true)
    const directKill = vi.fn()

    await terminateProcessTree(
      { pid: 5151, kill: directKill },
      { platform: 'linux', graceMs: 0, isDirectChild: () => true }
    )

    expect(processKill).toHaveBeenNthCalledWith(1, -5151, 'SIGTERM')
    expect(processKill).toHaveBeenNthCalledWith(2, -5151, 'SIGKILL')
    expect(directKill).not.toHaveBeenCalled()
    processKill.mockRestore()
  })

  it('launches taskkill by an absolute System32 path and reports permission failures', async () => {
    const { child, stderr } = createTaskkillProcess()
    const spawnProcess = vi.fn(() => child) as unknown as typeof spawn
    const resultPromise = runTaskkill(6161, {
      environment: { SystemRoot: 'C:\\Windows' },
      spawnProcess,
      isProcessAlive: () => true
    })

    stderr.write('Access is denied')
    child.emit('exit', 5)

    await expect(resultPromise).resolves.toEqual({
      terminated: false,
      error: 'taskkill returned exit code 5: Access is denied'
    })
    expect(spawnProcess).toHaveBeenCalledWith(
      'C:\\Windows\\System32\\taskkill.exe',
      ['/pid', '6161', '/t', '/f'],
      expect.objectContaining({ windowsHide: true })
    )
  })

  it('treats a non-zero taskkill result as success only when the target is gone', async () => {
    const { child } = createTaskkillProcess()
    const resultPromise = runTaskkill(7171, {
      environment: { WINDIR: 'C:\\Windows' },
      spawnProcess: vi.fn(() => child) as unknown as typeof spawn,
      isProcessAlive: () => false
    })

    child.emit('exit', 128)
    await expect(resultPromise).resolves.toEqual({ terminated: true })
  })

  it('fails closed when taskkill cannot be resolved or times out', async () => {
    expect(() => resolveTaskkillPath({ SystemRoot: 'relative' })).toThrow('SystemRoot')

    const { child, kill } = createTaskkillProcess()
    await expect(runTaskkill(8181, {
      environment: { SystemRoot: 'C:\\Windows' },
      spawnProcess: vi.fn(() => child) as unknown as typeof spawn,
      timeoutMs: 1,
      isProcessAlive: () => true
    })).resolves.toEqual({ terminated: false, error: 'taskkill timed out' })
    expect(kill).toHaveBeenCalledOnce()
  })
})
