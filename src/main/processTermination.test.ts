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

  it('starts taskkill after node-pty and keeps the PTY exit wait bounded', async () => {
    vi.useFakeTimers()
    const calls: string[] = []
    const { child } = createTaskkillProcess()
    const spawnProcess = vi.fn(() => {
      calls.push('taskkill')
      return child
    }) as unknown as typeof spawn
    const ptyKill = vi.fn(() => calls.push('pty'))
    try {
      const resultPromise = terminateProcessTree({
        pid: 5252,
        kill: ptyKill,
        onData: vi.fn(),
        onExit: vi.fn()
      }, {
        platform: 'win32',
        graceMs: 25,
        taskkill: {
          environment: { SystemRoot: 'C:\\Windows' },
          spawnProcess,
          isProcessAlive: () => true
        }
      })

      expect(calls).toEqual(['pty', 'taskkill'])
      child.emit('exit', 0)
      await vi.advanceTimersByTimeAsync(24)
      let settled = false
      void resultPromise.then(() => {
        settled = true
      })
      await Promise.resolve()
      expect(settled).toBe(false)
      await vi.advanceTimersByTimeAsync(1)

      await expect(resultPromise).resolves.toEqual({ terminated: true })
      expect(ptyKill).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('still sweeps the tree when node-pty confirms its own exit synchronously', async () => {
    let exit: (() => void) | undefined
    const { child } = createTaskkillProcess()
    const calls: string[] = []
    const spawnProcess = vi.fn(() => {
      calls.push('taskkill')
      return child
    }) as unknown as typeof spawn
    const resultPromise = terminateProcessTree({
      pid: 5303,
      kill: () => {
        calls.push('pty')
        exit?.()
      },
      onData: vi.fn(),
      onExit: (listener) => {
        exit = listener
      }
    }, {
      platform: 'win32',
      graceMs: 25,
      taskkill: {
        environment: { SystemRoot: 'C:\\Windows' },
        spawnProcess,
        isProcessAlive: () => true
      }
    })

    expect(calls).toEqual(['pty', 'taskkill'])
    child.emit('exit', 0)
    await expect(resultPromise).resolves.toEqual({ terminated: true })
  })

  it('waits for an asynchronous PTY exit and disposes its listener', async () => {
    vi.useFakeTimers()
    const { child } = createTaskkillProcess()
    let exit: (() => void) | undefined
    const dispose = vi.fn()
    try {
      const resultPromise = terminateProcessTree({
        pid: 5323,
        kill: () => {
          setTimeout(() => exit?.(), 10)
        },
        onData: vi.fn(),
        onExit: (listener) => {
          exit = listener
          return { dispose }
        }
      }, {
        platform: 'win32',
        graceMs: 25,
        taskkill: {
          environment: { SystemRoot: 'C:\\Windows' },
          spawnProcess: vi.fn(() => child) as unknown as typeof spawn,
          isProcessAlive: () => true
        }
      })

      child.emit('exit', 0)
      await vi.advanceTimersByTimeAsync(9)
      expect(dispose).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)

      await expect(resultPromise).resolves.toEqual({ terminated: true })
      expect(dispose).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('skips the PTY grace wait when the root already exited', async () => {
    vi.useFakeTimers()
    const { child } = createTaskkillProcess()
    const ptyKill = vi.fn()
    const onExit = vi.fn()
    try {
      const resultPromise = terminateProcessTree({
        pid: 5333,
        kill: ptyKill,
        onData: vi.fn(),
        onExit
      }, {
        platform: 'win32',
        graceMs: 25,
        taskkill: {
          environment: { SystemRoot: 'C:\\Windows' },
          spawnProcess: vi.fn(() => child) as unknown as typeof spawn,
          isProcessAlive: () => false
        }
      })

      child.emit('exit', 128)
      await expect(resultPromise).resolves.toEqual({ terminated: true })
      expect(ptyKill).not.toHaveBeenCalled()
      expect(onExit).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps a regular child alive until taskkill captures its descendants', async () => {
    const calls: string[] = []
    const { child } = createTaskkillProcess()
    const spawnProcess = vi.fn(() => {
      calls.push('taskkill')
      return child
    }) as unknown as typeof spawn
    const directKill = vi.fn(() => calls.push('child'))
    const resultPromise = terminateProcessTree({ pid: 5353, kill: directKill }, {
      platform: 'win32',
      taskkill: {
        environment: { SystemRoot: 'C:\\Windows' },
        spawnProcess
      }
    })

    expect(calls).toEqual(['taskkill'])
    child.emit('exit', 0)

    await expect(resultPromise).resolves.toEqual({ terminated: true })
    expect(calls).toEqual(['taskkill', 'child'])
  })

  it('falls back to taskkill when node-pty teardown throws', async () => {
    const { child } = createTaskkillProcess()
    const resultPromise = terminateProcessTree({
      pid: 5454,
      kill: () => {
        throw new Error('pty kill failed')
      },
      onData: vi.fn(),
      onExit: vi.fn()
    }, {
      platform: 'win32',
      graceMs: 0,
      taskkill: {
        environment: { SystemRoot: 'C:\\Windows' },
        spawnProcess: vi.fn(() => child) as unknown as typeof spawn,
        isProcessAlive: () => true
      }
    })

    await Promise.resolve()
    child.emit('exit', 0)
    await expect(resultPromise).resolves.toEqual({ terminated: true })
  })

  it('reports both node-pty and taskkill failures', async () => {
    const { child, stderr } = createTaskkillProcess()
    const resultPromise = terminateProcessTree({
      pid: 5555,
      kill: () => {
        throw new Error('pty kill failed')
      },
      onData: vi.fn(),
      onExit: vi.fn()
    }, {
      platform: 'win32',
      graceMs: 0,
      taskkill: {
        environment: { SystemRoot: 'C:\\Windows' },
        spawnProcess: vi.fn(() => child) as unknown as typeof spawn,
        isProcessAlive: () => true
      }
    })

    await Promise.resolve()
    stderr.write('Access is denied')
    child.emit('exit', 5)
    await expect(resultPromise).resolves.toEqual({
      terminated: false,
      error: 'pty kill failed; taskkill returned exit code 5: Access is denied'
    })
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
