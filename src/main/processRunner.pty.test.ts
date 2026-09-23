import type { BrowserWindow } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createProcessRunnerTestDatabase } from '../../test-support/processRunnerDatabase'

const mocks = vi.hoisted(() => ({
  ptyDataHandlers: [] as Array<(data: string) => void>,
  ptyExitHandlers: [] as Array<(event: { exitCode: number }) => void>,
  ptySpawn: vi.fn(),
  spawn: vi.fn()
}))

vi.mock('node:child_process', () => ({
  spawn: mocks.spawn,
  spawnSync: vi.fn()
}))

vi.mock('node-pty', () => ({
  spawn: mocks.ptySpawn
}))

import {
  ProcessRunner,
  type EffectiveShellResolver,
  type ProcessTreeTerminator
} from './processRunner'
import {
  MACOS_CAPTURED_COMMAND,
  MACOS_CAPTURED_DISPLAY_COMMAND,
  MACOS_CAPTURED_EXPECTED,
  MACOS_CAPTURED_STREAM,
  WIN32_80_COLUMN_STREAM,
  WIN32_CAPTURED_COMMAND,
  WIN32_CAPTURED_DISPLAY_COMMAND,
  WIN32_CAPTURED_EXPECTED,
  WIN32_CAPTURED_PREFIX,
  WIN32_CAPTURED_STREAM
} from './terminalStartupEchoFixtures'
import { ShellUnavailableError } from './shellService'
import type { ShellNeutralCommand } from '../shared/shell'
import {
  MAX_PERSISTED_TERMINAL_TRANSCRIPT_CHARS,
  MAX_PROCESS_RESULT_CHARS,
  MAX_TERMINAL_TRANSCRIPT_CHARS
} from '../shared/terminalBuffer'

const TERMINAL_DATA_FLUSH_INTERVAL_FOR_TEST_MS = 16

const openDatabases: Array<ReturnType<typeof createProcessRunnerTestDatabase>> = []
const activeRunners: ProcessRunner[] = []

async function disposeProcessRunnerFixtures(
  runners: ProcessRunner[],
  databases: Array<ReturnType<typeof createProcessRunnerTestDatabase>>
): Promise<void> {
  const errors: Array<{ label: string; error: unknown }> = []
  for (const runner of runners.reverse()) {
    try {
      await runner.killAll('interrupted')
    } catch (error) {
      errors.push({ label: 'runner killAll', error })
    }
  }
  for (const db of databases) {
    if (db.open) {
      try {
        db.close()
      } catch (error) {
        errors.push({ label: 'database close', error })
      }
    }
  }
  if (errors.length > 0) {
    throw new AggregateError(
      errors.map(({ label, error }) => (
        error instanceof Error ? new Error(`${label}: ${error.message}`, { cause: error }) : new Error(`${label}: ${String(error)}`)
      )),
      `Failed to dispose ProcessRunner fixtures: ${errors.map(({ label }) => label).join(', ')}`
    )
  }
}

afterEach(async () => {
  await disposeProcessRunnerFixtures(activeRunners.splice(0), openDatabases.splice(0))
})

function createRunner(
  getWindow: () => { webContents: { send: (channel: string, payload: unknown) => void } } | null = () => null,
  shellResolver: EffectiveShellResolver = {
    resolveEffectiveShell: () => ({
      id: 'posix:%2Fbin%2Fbash',
      displayName: 'bash',
      family: 'posix',
      executablePath: '/bin/bash',
      source: 'system'
    })
  },
  terminateTree: ProcessTreeTerminator = async (handle) => {
    try {
      handle.kill('SIGTERM')
      return { terminated: true }
    } catch (error) {
      return {
        terminated: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  },
  platform: NodeJS.Platform = 'linux'
) {
  const db = createProcessRunnerTestDatabase()
  openDatabases.push(db)
  const runner = new ProcessRunner(
    db,
    getWindow as unknown as () => BrowserWindow | null,
    { PATH: '/usr/bin', HOME: '/home/test', LANG: 'C.UTF-8' },
    shellResolver,
    terminateTree,
    process.cwd(),
    platform
  )
  activeRunners.push(runner)
  return { db, runner }
}

beforeEach(() => {
  mocks.ptyDataHandlers = []
  mocks.ptyExitHandlers = []
  mocks.spawn.mockReset()
  mocks.ptySpawn.mockReset()
})
describe('ProcessRunner non-interactive PTY output', () => {
  it('runs non-interactive commands in a PTY while rejecting input', async () => {
    const ptyWrite = vi.fn()
    const sends: Array<{
      channel: string
      payload: {
        id?: string
        stream?: 'stdout' | 'stderr'
        content?: string
        cursor?: number
      }
    }> = []

    mocks.ptySpawn.mockReturnValue({
      pid: 4242,
      onData: vi.fn((callback: (data: string) => void) => {
        mocks.ptyDataHandlers.push(callback)
      }),
      onExit: vi.fn((callback: (event: { exitCode: number }) => void) => {
        mocks.ptyExitHandlers.push(callback)
      }),
      write: ptyWrite,
      kill: vi.fn()
    })

    const { db, runner } = createRunner(() => ({
      webContents: {
        send: (channel: string, payload: unknown) => {
          sends.push({
            channel,
            payload: payload as {
              id?: string
              stream?: 'stdout' | 'stderr'
              content?: string
              cursor?: number
            }
          })
        }
      }
    }))

    const result = runner.run({
      taskId: 'task-1',
      nodeId: 'node-1',
      kind: 'non-interactive',
      command: 'long-running-command',
      cwd: '/repo'
    })

    expect(mocks.ptySpawn).toHaveBeenCalledWith(
      '/bin/bash',
      ['-lc', 'long-running-command'],
      expect.objectContaining({
        name: 'xterm-256color',
        cwd: '/repo'
      })
    )
    expect(mocks.spawn).not.toHaveBeenCalled()
    expect(ptyWrite).not.toHaveBeenCalled()

    const sessionId = sends.find((event) => event.channel === 'terminal:created')?.payload.id
    expect(sessionId).toBeTypeOf('string')
    expect(runner.write(sessionId!, 'ignored input')).toBe(false)
    expect(runner.isInputReady(sessionId!)).toBe(false)

    mocks.ptyDataHandlers[0]('first line\r\n')
    mocks.ptyDataHandlers[0]('warning\r\n')

    mocks.ptyExitHandlers[0]({ exitCode: 0 })
    await expect(result).resolves.toMatchObject({
      stdout: 'first line\r\nwarning\r\n',
      stderr: '',
      exitCode: 0
    })

    expect(sends.filter((event) => event.channel === 'terminal:data').map((event) => event.payload)).toEqual([
      {
        sessionId: expect.any(String),
        taskId: 'task-1',
        nodeId: 'node-1',
        stream: 'stdout',
        content: 'first line\r\nwarning\r\n',
        cursor: 2
      }
    ])
    db.close()
  })

  it('seals queued terminal data at a live transcript snapshot cursor', async () => {
    mocks.ptySpawn.mockReturnValue({
      pid: 4242,
      onData: vi.fn((callback: (data: string) => void) => {
        mocks.ptyDataHandlers.push(callback)
      }),
      onExit: vi.fn((callback: (event: { exitCode: number }) => void) => {
        mocks.ptyExitHandlers.push(callback)
      }),
      write: vi.fn(),
      kill: vi.fn()
    })
    const sends: Array<{ channel: string; payload: Record<string, unknown> }> = []
    const { db, runner } = createRunner(() => ({
      webContents: {
        send: (channel: string, payload: unknown) => {
          sends.push({ channel, payload: payload as Record<string, unknown> })
        }
      }
    }))
    const result = runner.run({
      taskId: 'task-1',
      nodeId: 'node-1',
      kind: 'non-interactive',
      command: 'snapshot-command',
      cwd: '/repo'
    })
    const sessionId = sends.find((event) => event.channel === 'terminal:created')?.payload.id as string

    mocks.ptyDataHandlers[0]('before snapshot')
    expect(runner.getLiveTranscriptSnapshot(sessionId, 'task-1')).toEqual({
      transcript: '$ snapshot-command\nbefore snapshot',
      cursor: 1
    })
    mocks.ptyDataHandlers[0](' after snapshot')
    mocks.ptyExitHandlers[0]({ exitCode: 0 })
    await result

    expect(sends.filter((event) => event.channel === 'terminal:data').map((event) => event.payload))
      .toEqual([
        expect.objectContaining({ content: 'before snapshot', cursor: 1 }),
        expect.objectContaining({ content: ' after snapshot', cursor: 2 })
      ])
    db.close()
  })

  it('keeps a larger live transcript while bounding persisted transcripts and process results', async () => {
    mocks.ptySpawn.mockReturnValue({
      pid: 4242,
      onData: vi.fn((callback: (data: string) => void) => {
        mocks.ptyDataHandlers.push(callback)
      }),
      onExit: vi.fn((callback: (event: { exitCode: number }) => void) => {
        mocks.ptyExitHandlers.push(callback)
      }),
      write: vi.fn(),
      kill: vi.fn()
    })
    const { db, runner } = createRunner()
    const run = runner.run({
      taskId: 'task-1',
      nodeId: 'node-1',
      kind: 'non-interactive',
      command: 'large-output',
      cwd: '/repo'
    })
    const output = `${'x'.repeat(MAX_TERMINAL_TRANSCRIPT_CHARS + 10)}tail`

    mocks.ptyDataHandlers[0](output)
    const activeSession = db.prepare('select id from terminal_sessions limit 1')
      .get() as { id: string }
    expect(runner.hasActiveProcesses()).toBe(true)
    expect(runner.getLiveTranscript(activeSession.id)).toHaveLength(MAX_TERMINAL_TRANSCRIPT_CHARS)
    expect(runner.getLiveTranscript(activeSession.id, 'another-task')).toBeNull()
    expect(runner.getLiveTranscript(activeSession.id)).toBe(
      output.slice(-MAX_TERMINAL_TRANSCRIPT_CHARS)
    )
    mocks.ptyExitHandlers[0]({ exitCode: 0 })
    const result = await run
    expect(runner.hasActiveProcesses()).toBe(false)

    const session = db.prepare('select transcript from terminal_sessions limit 1')
      .get() as { transcript: string }
    const logCount = db.prepare('select count(*) as count from process_logs')
      .get() as { count: number }
    expect(session.transcript).toHaveLength(MAX_PERSISTED_TERMINAL_TRANSCRIPT_CHARS)
    expect(session.transcript).toBe(output.slice(-MAX_PERSISTED_TERMINAL_TRANSCRIPT_CHARS))
    expect(result.stdout).toHaveLength(MAX_PROCESS_RESULT_CHARS)
    expect(result.stdout).toBe(output.slice(-MAX_PROCESS_RESULT_CHARS))
    expect(logCount.count).toBe(0)
    db.close()
  })

  it('does not append process logs', async () => {
    mocks.ptySpawn.mockReturnValue({
      pid: 4242,
      onData: vi.fn((callback: (data: string) => void) => {
        mocks.ptyDataHandlers.push(callback)
      }),
      onExit: vi.fn((callback: (event: { exitCode: number }) => void) => {
        mocks.ptyExitHandlers.push(callback)
      }),
      write: vi.fn(),
      kill: vi.fn()
    })
    const { db, runner } = createRunner()
    const run = runner.run({
      taskId: 'task-1',
      nodeId: 'node-1',
      kind: 'non-interactive',
      command: 'new-output',
      cwd: '/repo'
    })
    mocks.ptyDataHandlers[0]('new')
    mocks.ptyExitHandlers[0]({ exitCode: 0 })
    await run

    const count = db.prepare(
      'select count(*) as count from process_logs where task_id = ? and node_id = ?'
    ).get('task-1', 'node-1') as { count: number }
    expect(count.count).toBe(0)
  })

  it('disposes mid-flight fixtures without late flush errors after a failure', async () => {
    mocks.ptySpawn.mockReturnValue({
      pid: 4242,
      onData: vi.fn((callback: (data: string) => void) => {
        mocks.ptyDataHandlers.push(callback)
      }),
      onExit: vi.fn((callback: (event: { exitCode: number }) => void) => {
        mocks.ptyExitHandlers.push(callback)
      }),
      write: vi.fn(),
      kill: vi.fn()
    })
    const { db, runner } = createRunner()

    // Reproduce the state a failing test leaves behind: output already
    // queued (persist/flush timers armed) but the fake PTY exit never fired.
    void runner.run({
      taskId: 'task-mid-flight',
      nodeId: 'node-mid-flight',
      kind: 'non-interactive',
      command: 'never-settles',
      cwd: '/repo'
    })
    mocks.ptyDataHandlers[0]('queued before the failure')
    expect(runner.hasActiveProcesses()).toBe(true)

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      await disposeProcessRunnerFixtures(
        activeRunners.splice(0),
        openDatabases.splice(0)
      )
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Ending every session first (killAll) drains the pending flush work
      // and clears the 5-second persist timer, so closing the database can
      // no longer race a late "database connection is not open" write.
      expect(runner.hasActiveProcesses()).toBe(false)
      expect(db.open).toBe(false)
      expect(consoleError).not.toHaveBeenCalledWith(
        expect.stringMatching(/flush failed|not open/),
        expect.anything()
      )
    } finally {
      consoleError.mockRestore()
    }
  })
})

describe('ProcessRunner PTY termination and timeouts', () => {
  it('kills a non-interactive PTY session directly', async () => {
    const sends: Array<{ channel: string; payload: { id?: string; status?: string } }> = []
    const ptyKill = vi.fn()
    mocks.ptySpawn.mockReturnValue({
      pid: 4242,
      onData: vi.fn(),
      onExit: vi.fn((callback: (event: { exitCode: number }) => void) => {
        mocks.ptyExitHandlers.push(callback)
      }),
      write: vi.fn(),
      kill: ptyKill
    })

    const { db, runner } = createRunner(() => ({
      webContents: {
        send: (channel: string, payload: unknown) => {
          sends.push({ channel, payload: payload as { id?: string; status?: string } })
        }
      }
    }))

    const result = runner.run({
      taskId: 'task-1',
      nodeId: 'node-1',
      kind: 'non-interactive',
      command: 'agent-command',
      cwd: '/repo'
    })
    const sessionId = sends.find((event) => event.channel === 'terminal:created')?.payload.id

    expect(sessionId).toBeTypeOf('string')
    await expect(runner.kill(sessionId!)).resolves.toBe(true)
    expect(ptyKill).toHaveBeenCalledOnce()

    await expect(result).resolves.toMatchObject({ exitCode: null, status: 'killed' })
    mocks.ptyExitHandlers[0]({ exitCode: 0 })

    const row = db.prepare('select status from terminal_sessions where id = ?').get(sessionId) as { status: string }
    expect(row.status).toBe('killed')
    db.close()
  })

  it('marks a timed-out non-interactive PTY session as failed', async () => {
    vi.useFakeTimers()
    const sends: Array<{
      channel: string
      payload: {
        content?: string
        status?: string
      }
    }> = []
    const ptyKill = vi.fn()
    mocks.ptySpawn.mockReturnValue({
      pid: 4343,
      onData: vi.fn(),
      onExit: vi.fn((callback: (event: { exitCode: number }) => void) => {
        mocks.ptyExitHandlers.push(callback)
      }),
      write: vi.fn(),
      kill: ptyKill
    })

    const { db, runner } = createRunner(() => ({
      webContents: {
        send: (channel: string, payload: unknown) => {
          sends.push({ channel, payload: payload as { content?: string; status?: string } })
        }
      }
    }))

    try {
      const result = runner.run({
        taskId: 'task-1',
        nodeId: 'node-1',
        kind: 'non-interactive',
        command: 'slow-command',
        cwd: '/repo',
        timeoutMs: 50
      })

      await vi.advanceTimersByTimeAsync(50)
      await vi.advanceTimersByTimeAsync(TERMINAL_DATA_FLUSH_INTERVAL_FOR_TEST_MS)

      expect(ptyKill).toHaveBeenCalledOnce()
      expect(sends.find((event) => event.channel === 'terminal:data')?.payload.content).toContain(
        'Process timed out after 50 ms'
      )

      mocks.ptyExitHandlers[0]({ exitCode: 143 })
      await expect(result).resolves.toMatchObject({
        stderr: expect.stringContaining('Process timed out after 50 ms'),
        exitCode: -1,
        status: 'failed'
      })

      expect(sends.find((event) => event.channel === 'terminal:closed')?.payload.status).toBe('failed')
      const row = db.prepare('select status from terminal_sessions order by created_at desc limit 1').get() as { status: string }
      expect(row.status).toBe('failed')
    } finally {
      vi.useRealTimers()
      db.close()
    }
  })

  it('settles a timed-out session when the PTY cannot be killed', async () => {
    vi.useFakeTimers()
    const sends: Array<{ channel: string; payload: { status?: string } }> = []
    mocks.ptySpawn.mockReturnValue({
      pid: 4343,
      onData: vi.fn(),
      onExit: vi.fn(),
      write: vi.fn(),
      kill: vi.fn(() => {
        throw new Error('kill failed')
      })
    })
    // The first termination attempt reports the unconfirmed tree (the
    // behavior under test); teardown-time terminations must succeed so the
    // fixture can be disposed cleanly.
    let failNextTermination = true
    const terminateTree = vi.fn(async () => {
      if (failNextTermination) {
        failNextTermination = false
        return { terminated: false, error: 'kill failed' }
      }
      return { terminated: true }
    })
    const { db, runner } = createRunner(() => ({
      webContents: {
        send: (channel: string, payload: unknown) => {
          sends.push({ channel, payload: payload as { status?: string } })
        }
      }
    }), undefined, terminateTree as unknown as Parameters<typeof createRunner>[2])

    try {
      const result = runner.run({
        taskId: 'task-1',
        nodeId: 'node-1',
        kind: 'non-interactive',
        command: 'slow-command',
        cwd: '/repo',
        timeoutMs: 50
      })

      await vi.advanceTimersByTimeAsync(50)

      await expect(result).resolves.toMatchObject({
      stderr: expect.stringContaining('Failed to terminate the process tree: kill failed'),
        exitCode: -1,
        status: 'failed'
      })
      expect(sends.find((event) => event.channel === 'terminal:closed')?.payload.status).toBe('failed')
      const row = db.prepare('select status from terminal_sessions order by created_at desc limit 1').get() as { status: string }
      expect(row.status).toBe('failed')
    } finally {
      vi.useRealTimers()
      db.close()
    }
  })
})

describe('ProcessRunner interactive PTY lifecycle', () => {
  it('uses node-pty for interactive sessions', async () => {
    const ptyWrite = vi.fn()
    mocks.ptySpawn.mockReturnValue({
      pid: 123,
      onData: vi.fn(),
      onExit: vi.fn((callback: (event: { exitCode: number }) => void) => {
        mocks.ptyExitHandlers.push(callback)
      }),
      write: ptyWrite,
      kill: vi.fn()
    })
    const { db, runner } = createRunner()

    const result = runner.run({
      taskId: 'task-1',
      nodeId: 'node-1',
      kind: 'interactive',
      command: 'df',
      cwd: '/repo'
    })
    mocks.ptyExitHandlers[0]({ exitCode: 0 })
    await result

    expect(mocks.ptySpawn).toHaveBeenCalled()
    expect(ptyWrite).toHaveBeenCalledWith('df\n')
    db.close()
  })

  it('removes only the bare startup command echo before the interactive prompt', async () => {
    const command = 'codex --yolo "${PROMPT_VALUE}"'
    const displayCommand = 'codex --yolo "implement the task"'
    const prompt = 'wty@host:/repo$ '
    mocks.ptySpawn.mockReturnValue({
      pid: 124,
      onData: vi.fn((callback: (data: string) => void) => {
        mocks.ptyDataHandlers.push(callback)
      }),
      onExit: vi.fn((callback: (event: { exitCode: number }) => void) => {
        mocks.ptyExitHandlers.push(callback)
      }),
      write: vi.fn(),
      kill: vi.fn()
    })
    const { db, runner } = createRunner()

    const run = runner.run({
      taskId: 'task-startup-echo',
      nodeId: 'node-startup-echo',
      kind: 'interactive',
      command,
      displayCommand,
      cwd: '/repo'
    })
    mocks.ptyDataHandlers[0](command.slice(0, 12))
    mocks.ptyDataHandlers[0](`${command.slice(12)}\r`)
    mocks.ptyDataHandlers[0](`\n${prompt}${command}\r\ncommand output\r\n`)
    mocks.ptyExitHandlers[0]({ exitCode: 0 })

    const result = await run
    const session = db.prepare('select transcript from terminal_sessions limit 1')
      .get() as { transcript: string }
    expect(session.transcript).toBe(`${prompt}${displayCommand}\r\ncommand output\r\n`)
    expect(result.stdout).toBe(`${command}\r\n${prompt}${command}\r\ncommand output\r\n`)
    db.close()
  })

  it('restores the bare startup command when the shell does not redraw it', async () => {
    const command = 'codex --yolo "${PROMPT_VALUE}"'
    const displayCommand = 'codex --yolo "implement the task"'
    mocks.ptySpawn.mockReturnValue({
      pid: 125,
      onData: vi.fn((callback: (data: string) => void) => {
        mocks.ptyDataHandlers.push(callback)
      }),
      onExit: vi.fn((callback: (event: { exitCode: number }) => void) => {
        mocks.ptyExitHandlers.push(callback)
      }),
      write: vi.fn(),
      kill: vi.fn()
    })
    const { db, runner } = createRunner()

    const run = runner.run({
      taskId: 'task-no-redraw',
      nodeId: 'node-no-redraw',
      kind: 'interactive',
      command,
      displayCommand,
      cwd: '/repo'
    })
    mocks.ptyDataHandlers[0](`${command}\r\n$ ready\r\n`)
    mocks.ptyExitHandlers[0]({ exitCode: 0 })

    await run
    const session = db.prepare('select transcript from terminal_sessions limit 1')
      .get() as { transcript: string }
    expect(session.transcript).toBe(`${displayCommand}\r\n$ ready\r\n`)
    db.close()
  })

  it('releases a held startup-command prefix unchanged when later output diverges', async () => {
    const command = 'codex --yolo'
    const prefix = command.slice(0, 10)
    mocks.ptySpawn.mockReturnValue({
      pid: 126,
      onData: vi.fn((callback: (data: string) => void) => {
        mocks.ptyDataHandlers.push(callback)
      }),
      onExit: vi.fn((callback: (event: { exitCode: number }) => void) => {
        mocks.ptyExitHandlers.push(callback)
      }),
      write: vi.fn(),
      kill: vi.fn()
    })
    const { db, runner } = createRunner()

    const run = runner.run({
      taskId: 'task-diverging-prefix',
      nodeId: 'node-diverging-prefix',
      kind: 'interactive',
      command,
      cwd: '/repo'
    })
    mocks.ptyDataHandlers[0](prefix)
    mocks.ptyDataHandlers[0]('x shell output\r\n')
    mocks.ptyExitHandlers[0]({ exitCode: 0 })

    await run
    const session = db.prepare('select transcript from terminal_sessions limit 1')
      .get() as { transcript: string }
    expect(session.transcript).toBe(`${prefix}x shell output\r\n`)
    db.close()
  })

  it('flushes an incomplete startup-command prefix once when the session is killed', async () => {
    const command = 'codex --yolo "${PROMPT_VALUE}"'
    const prefix = command.slice(0, 12)
    mocks.ptySpawn.mockReturnValue({
      pid: 127,
      onData: vi.fn((callback: (data: string) => void) => {
        mocks.ptyDataHandlers.push(callback)
      }),
      onExit: vi.fn((callback: (event: { exitCode: number }) => void) => {
        mocks.ptyExitHandlers.push(callback)
      }),
      write: vi.fn(),
      kill: vi.fn()
    })
    const { db, runner } = createRunner()

    const run = runner.run({
      taskId: 'task-incomplete-echo',
      nodeId: 'node-incomplete-echo',
      kind: 'interactive',
      command,
      displayCommand: 'codex --yolo "implement the task"',
      cwd: '/repo'
    })
    const sessionId = (db.prepare('select id from terminal_sessions limit 1')
      .get() as { id: string }).id
    mocks.ptyDataHandlers[0](prefix)

    await expect(runner.kill(sessionId)).resolves.toBe(true)
    await expect(run).resolves.toMatchObject({ status: 'killed' })
    const session = db.prepare('select transcript from terminal_sessions where id = ?')
      .get(sessionId) as { transcript: string }
    expect(session.transcript).toBe(prefix)
    db.close()
  })

  it('preserves initial interactive output that is not the bare startup command', async () => {
    mocks.ptySpawn.mockReturnValue({
      pid: 128,
      onData: vi.fn((callback: (data: string) => void) => {
        mocks.ptyDataHandlers.push(callback)
      }),
      onExit: vi.fn((callback: (event: { exitCode: number }) => void) => {
        mocks.ptyExitHandlers.push(callback)
      }),
      write: vi.fn(),
      kill: vi.fn()
    })
    const { db, runner } = createRunner()

    const run = runner.run({
      taskId: 'task-startup-output',
      nodeId: 'node-startup-output',
      kind: 'interactive',
      command: 'codex --yolo',
      cwd: '/repo'
    })
    mocks.ptyDataHandlers[0]('shell startup banner\r\n')
    mocks.ptyDataHandlers[0]('wty@host:/repo$ codex --yolo\r\n')
    mocks.ptyExitHandlers[0]({ exitCode: 0 })

    await run
    const session = db.prepare('select transcript from terminal_sessions limit 1')
      .get() as { transcript: string }
    expect(session.transcript).toBe(
      'shell startup banner\r\nwty@host:/repo$ codex --yolo\r\n'
    )
    db.close()
  })

  it('writes raw bytes only to interactive PTY sessions', async () => {
    const sends: Array<{ channel: string; payload: { id: string; kind: string } }> = []
    const { db, runner } = createRunner(() => ({ webContents: { send: (channel: string, payload: unknown) => { sends.push({ channel, payload: payload as { id: string; kind: string } }) } } }))
    const ptyWrite = vi.fn()
    mocks.ptySpawn.mockReturnValue({
      pid: 1,
      onData: vi.fn(),
      onExit: vi.fn((callback: (event: { exitCode: number }) => void) => { mocks.ptyExitHandlers.push(callback) }),
      write: ptyWrite,
      kill: vi.fn()
    })

    const interactiveRun = runner.run({ taskId: 't', nodeId: 'n', kind: 'interactive', command: 'bash', cwd: '/r' })
    const nonInteractiveRun = runner.run({ taskId: 't', nodeId: 'n2', kind: 'non-interactive', command: 'echo hi', cwd: '/r' })

    const interactiveId = sends.find((s) => s.channel === 'terminal:created' && s.payload.kind === 'interactive')!.payload.id
    const nonInteractiveId = sends.find((s) => s.channel === 'terminal:created' && s.payload.kind === 'non-interactive')!.payload.id

    expect(runner.write(interactiveId, 'ls')).toBe(true)
    expect(ptyWrite).toHaveBeenCalledWith('ls')
    expect(runner.write(interactiveId, '')).toBe(true)
    expect(runner.write(nonInteractiveId, 'x')).toBe(false)
    expect(runner.write('missing', 'x')).toBe(false)

    mocks.ptyExitHandlers.forEach((cb) => cb({ exitCode: 0 }))
    await interactiveRun
    await nonInteractiveRun
    db.close()
  })

  it('resizes both interactive and non-interactive PTY sessions', async () => {
    const sends: Array<{ channel: string; payload: { id: string; kind: string } }> = []
    const { db, runner } = createRunner(() => ({ webContents: { send: (channel: string, payload: unknown) => { sends.push({ channel, payload: payload as { id: string; kind: string } }) } } }))
    const ptyResize = vi.fn()
    mocks.ptySpawn.mockReturnValue({
      pid: 1,
      onData: vi.fn(),
      onExit: vi.fn((callback: (event: { exitCode: number }) => void) => { mocks.ptyExitHandlers.push(callback) }),
      write: vi.fn(),
      resize: ptyResize,
      kill: vi.fn()
    })

    const interactiveRun = runner.run({ taskId: 't', nodeId: 'n', kind: 'interactive', command: 'bash', cwd: '/r' })
    const nonInteractiveRun = runner.run({ taskId: 't', nodeId: 'n2', kind: 'non-interactive', command: 'echo hi', cwd: '/r' })
    const interactiveId = sends.find((s) => s.channel === 'terminal:created' && s.payload.kind === 'interactive')!.payload.id
    const nonInteractiveId = sends.find((s) => s.channel === 'terminal:created' && s.payload.kind === 'non-interactive')!.payload.id

    expect(runner.resize(interactiveId, 120, 30)).toBe(true)
    expect(ptyResize).toHaveBeenCalledWith(120, 30)
    expect(runner.resize(nonInteractiveId, 80, 24)).toBe(true)
    expect(ptyResize).toHaveBeenCalledWith(80, 24)
    expect(runner.resize('missing', 80, 24)).toBe(false)

    mocks.ptyExitHandlers.forEach((cb) => cb({ exitCode: 0 }))
    await interactiveRun
    await nonInteractiveRun
    db.close()
  })

  it('kill settles the session: later data/exit do not override killed status', async () => {
    const sends: Array<{ channel: string; payload: { id: string; status?: string; exitCode?: number | null } }> = []
    const dataHandlers: Array<(data: string) => void> = []
    const { db, runner } = createRunner(() => ({ webContents: { send: (channel: string, payload: unknown) => { sends.push({ channel, payload: payload as { id: string; status?: string; exitCode?: number | null } }) } } }))
    mocks.ptySpawn.mockReturnValue({
      pid: 1,
      onData: vi.fn((callback: (data: string) => void) => { dataHandlers.push(callback) }),
      onExit: vi.fn((callback: (event: { exitCode: number }) => void) => { mocks.ptyExitHandlers.push(callback) }),
      write: vi.fn(),
      kill: vi.fn()
    })

    const run = runner.run({ taskId: 't', nodeId: 'n', kind: 'interactive', command: 'bash', cwd: '/r' })
    const sid = sends.find((s) => s.channel === 'terminal:created')!.payload.id

    await expect(runner.kill(sid)).resolves.toBe(true)

    dataHandlers[0]('late output after kill')
    mocks.ptyExitHandlers[0]({ exitCode: 0 })
    await run

    const row = db.prepare('select status from terminal_sessions where id = ?').get(sid) as { status: string }
    expect(row.status).toBe('killed')
    const closed = sends.filter((s) => s.channel === 'terminal:closed')
    expect(closed).toHaveLength(1)
    expect(closed[0].payload.status).toBe('killed')
    expect(closed[0].payload.exitCode).toBeNull()
    db.close()
  })

  it('interrupts only in-memory PTYs belonging to the requested task', async () => {
    const sends: Array<{ channel: string; payload: { id: string; task_id: string } }> = []
    const kills: Array<ReturnType<typeof vi.fn>> = []
    mocks.ptySpawn.mockImplementation(() => {
      const kill = vi.fn()
      kills.push(kill)
      return {
        pid: kills.length,
        onData: vi.fn(),
        onExit: vi.fn((callback: (event: { exitCode: number }) => void) => {
          mocks.ptyExitHandlers.push(callback)
        }),
        write: vi.fn(),
        kill
      }
    })
    const { db, runner } = createRunner(() => ({
      webContents: {
        send: (channel: string, payload: unknown) => {
          sends.push({ channel, payload: payload as { id: string; task_id: string } })
        }
      }
    }))
    const first = runner.run({ taskId: 'task-1', nodeId: 'a', kind: 'non-interactive', command: 'a', cwd: '/repo' })
    const second = runner.run({ taskId: 'task-1', nodeId: 'b', kind: 'non-interactive', command: 'b', cwd: '/repo' })
    const other = runner.run({ taskId: 'task-2', nodeId: 'c', kind: 'non-interactive', command: 'c', cwd: '/repo' })
    const created = sends.filter((event) => event.channel === 'terminal:created')
    const otherId = created.find((event) => event.payload.task_id === 'task-2')!.payload.id

    await expect(runner.killByTask('task-1', 'interrupted')).resolves.toBe(2)
    expect(kills[0]).toHaveBeenCalledOnce()
    expect(kills[1]).toHaveBeenCalledOnce()
    expect(kills[2]).not.toHaveBeenCalled()
    expect(runner.hasLiveSession(otherId)).toBe(true)
    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ status: 'interrupted', exitCode: null }),
      expect.objectContaining({ status: 'interrupted', exitCode: null })
    ])
    expect(db.prepare(
      'select distinct status from terminal_sessions where task_id = ?'
    ).all('task-1')).toEqual([{ status: 'interrupted' }])

    await expect(runner.kill(otherId)).resolves.toBe(true)
    await other
    db.close()
  })

  it('interrupts active and pending terminals during global cleanup', async () => {
    const target = {
      id: 'posix:%2Fbin%2Fbash',
      displayName: 'bash',
      family: 'posix' as const,
      executablePath: '/bin/bash',
      source: 'system' as const
    }
    let completeResolution: (value: typeof target) => void = () => undefined
    const resolution = new Promise<typeof target>((resolve) => {
      completeResolution = resolve
    })
    const shellResolver: EffectiveShellResolver = {
      resolveEffectiveShell: () => target,
      resolveTarget: async () => resolution
    }
    const childKill = vi.fn()
    mocks.ptySpawn.mockReturnValue({
      pid: 4242,
      onData: vi.fn(),
      onExit: vi.fn((callback: (event: { exitCode: number }) => void) => {
        mocks.ptyExitHandlers.push(callback)
      }),
      write: vi.fn(),
      kill: childKill
    })
    const { db, runner } = createRunner(() => null, shellResolver)
    const active = runner.run({
      taskId: 'active-task',
      nodeId: 'active-terminal',
      kind: 'non-interactive',
      command: 'sleep 60',
      cwd: '/repo'
    })
    const pending = runner.run({
      taskId: 'pending-task',
      nodeId: 'pending-terminal',
      kind: 'non-interactive',
      command: 'sleep 60',
      cwd: '/repo',
      executionTarget: {
        kind: 'native',
        id: target.id,
        displayName: target.displayName,
        family: target.family,
        executablePath: target.executablePath
      }
    })

    const cleanup = runner.killAll('interrupted')
    completeResolution(target)

    await expect(cleanup).resolves.toBe(2)
    await expect(Promise.all([active, pending])).resolves.toEqual([
      expect.objectContaining({ status: 'interrupted', exitCode: null }),
      expect.objectContaining({ status: 'interrupted', exitCode: null })
    ])
    expect(childKill).toHaveBeenCalledOnce()
    expect(mocks.ptySpawn).toHaveBeenCalledOnce()
    expect(db.prepare(
      'select task_id, status from terminal_sessions order by task_id'
    ).all()).toEqual([
      { task_id: 'active-task', status: 'interrupted' },
      { task_id: 'pending-task', status: 'interrupted' }
    ])
    expect(runner.hasActiveProcesses()).toBe(false)
    db.close()
  })

  it('propagates an unconfirmed tree-kill failure and keeps the session retryable', async () => {
    mocks.ptySpawn.mockReturnValue({
      pid: 6262,
      onData: vi.fn(),
      onExit: vi.fn(),
      write: vi.fn(),
      kill: vi.fn()
    })
    const terminateTree = vi.fn()
      .mockResolvedValueOnce({ terminated: false, error: 'permission denied' })
      .mockResolvedValueOnce({ terminated: true })
    const { db, runner } = createRunner(() => null, undefined, terminateTree)
    const result = runner.run({
      taskId: 'tree-failure-task',
      nodeId: 'tree-failure-node',
      kind: 'non-interactive',
      command: 'long-running',
      cwd: '/repo'
    })

    await expect(runner.killByTask('tree-failure-task')).rejects.toThrow(
      'Process trees not confirmed terminated: 1'
    )
    expect(db.prepare('select status from terminal_sessions limit 1').get()).toEqual({
      status: 'killed'
    })
    expect(runner.hasLiveSession((db.prepare(
      'select id from terminal_sessions limit 1'
    ).get() as { id: string }).id)).toBe(true)

    await expect(runner.killByTask('tree-failure-task')).resolves.toBe(1)
    await expect(result).resolves.toMatchObject({
      status: 'killed',
      stderr: expect.stringContaining('permission denied')
    })
    expect(terminateTree).toHaveBeenCalledTimes(2)
    db.close()
  })

  it('spawns pty at requested size and emits terminal:attached after command write', async () => {
    const events: string[] = []
    const sends: Array<{ channel: string; payload: { id?: string; sessionId?: string; taskId?: string; nodeId?: string } }> = []
    const opts: { cols?: number; rows?: number } = {}
    mocks.ptySpawn.mockImplementation((_command: string, _args: string[], options: { cols?: number; rows?: number }) => {
      Object.assign(opts, options)
      return {
        pid: 1,
        onData: vi.fn(),
        onExit: vi.fn((callback: (event: { exitCode: number }) => void) => { mocks.ptyExitHandlers.push(callback) }),
        write: vi.fn((data: string) => { events.push(`write:${data}`) }),
        kill: vi.fn()
      }
    })
    const { db, runner } = createRunner(() => ({ webContents: { send: (channel: string, payload: unknown) => { sends.push({ channel, payload: payload as { id?: string; sessionId?: string; taskId?: string; nodeId?: string } }); events.push(`send:${channel}`) } } }))

    const run = runner.run({ taskId: 't', nodeId: 'n', kind: 'interactive', command: 'df', cwd: '/r', cols: 120, rows: 30 })
    const ptyId = sends.find((s) => s.channel === 'terminal:created')!.payload.id as string
    expect(runner.isInputReady(ptyId)).toBe(true)
    expect(runner.isInputReady('missing')).toBe(false)
    mocks.ptyExitHandlers[0]({ exitCode: 0 })
    await run

    expect(opts.cols).toBe(120)
    expect(opts.rows).toBe(30)
    const writeIdx = events.indexOf('write:df\n')
    const attachedIdx = events.indexOf('send:terminal:attached')
    expect(writeIdx).toBeGreaterThanOrEqual(0)
    expect(attachedIdx).toBeGreaterThan(writeIdx)
    const attached = sends.find((s) => s.channel === 'terminal:attached')
    expect(attached?.payload.taskId).toBe('t')
    expect(attached?.payload.nodeId).toBe('n')
    db.close()
  })

  it('fails and terminates an interactive session when the first command write throws', async () => {
    const sends: Array<{ channel: string; payload: { id?: string; sessionId?: string; status?: string } }> = []
    const ptyKill = vi.fn()
    mocks.ptySpawn.mockReturnValue({
      pid: 4242,
      onData: vi.fn(),
      onExit: vi.fn((callback: (event: { exitCode: number }) => void) => {
        mocks.ptyExitHandlers.push(callback)
      }),
      write: vi.fn(() => {
        throw new Error('write unavailable')
      }),
      kill: ptyKill
    })
    const { db, runner } = createRunner(() => ({
      webContents: {
        send: (channel: string, payload: unknown) => {
          sends.push({ channel, payload: payload as { id?: string; sessionId?: string; status?: string } })
        }
      }
    }))

    const result = await runner.run({
      taskId: 'task-write-failure',
      nodeId: 'node-write-failure',
      kind: 'interactive',
      command: 'echo never-ran',
      cwd: '/repo'
    })
    const sessionId = sends.find((event) => event.channel === 'terminal:created')?.payload.id

    expect(result).toMatchObject({
      status: 'failed',
      exitCode: -1,
      stderr: expect.stringContaining('failed during write')
    })
    expect(ptyKill).toHaveBeenCalledWith('SIGTERM')
    expect(runner.isInputReady(sessionId!)).toBe(false)
    expect(sends.filter((event) => event.channel === 'terminal:attached')).toHaveLength(0)
    expect(sends.filter((event) => event.channel === 'terminal:closed')).toHaveLength(1)
    expect(db.prepare('select status from terminal_sessions where id = ?').get(sessionId)).toEqual({
      status: 'failed'
    })

    mocks.ptyExitHandlers[0]({ exitCode: 0 })
    expect(sends.filter((event) => event.channel === 'terminal:closed')).toHaveLength(1)
    db.close()
  })
})

describe('ProcessRunner interactive startup echo recognition', () => {
  const BINDING_NAME = 'CLILOOM_INTERNAL_VALUE_0'
  const STARTUP_COMMAND = `printf '%s' "UI 😀改动\${CLILOOM_INTERNAL_VALUE_0}"; exit`
  const STARTUP_DISPLAY_COMMAND = `printf '%s' "UI 😀改动实际参数"; exit`
  const STARTUP_PROMPT = '\u001b]0;cliloom\u0007\u001b[32muser@host:/repo\u001b[0m$ '
  const PROGRAM_OUTPUT = '程序输出 😀 done\r\n'

  function startupNeutralCommand(): ShellNeutralCommand {
    return {
      version: 1,
      segments: [
        { type: 'literal', value: `printf '%s' "UI 😀改动` },
        { type: 'binding', name: BINDING_NAME },
        { type: 'literal', value: '"; exit' }
      ],
      bindings: { [BINDING_NAME]: '实际参数' }
    }
  }

  function buildPaddedRedraw(command: string): string {
    const fragments: Array<{ afterIndex: number; fragment: string }> = [
      { afterIndex: command.indexOf('改'), fragment: ' \u001b[K' },
      { afterIndex: command.indexOf('${'), fragment: ' \u001b[0K' }
    ]
    const sorted = [...fragments].sort((a, b) => b.afterIndex - a.afterIndex)
    let redrawn = command
    for (const insertion of sorted) {
      redrawn = redrawn.slice(0, insertion.afterIndex) + insertion.fragment + redrawn.slice(insertion.afterIndex)
    }
    return redrawn
  }

  function createMockPty() {
    const ptyWrite = vi.fn()
    mocks.ptySpawn.mockReturnValue({
      pid: 1314,
      onData: vi.fn((callback: (data: string) => void) => {
        mocks.ptyDataHandlers.push(callback)
      }),
      onExit: vi.fn((callback: (event: { exitCode: number }) => void) => {
        mocks.ptyExitHandlers.push(callback)
      }),
      write: ptyWrite,
      kill: vi.fn()
    })
    return { ptyWrite }
  }

  it('deduplicates a padded startup redraw, expands bindings and keeps raw stdout', async () => {
    const { ptyWrite } = createMockPty()
    const sends: Array<{ channel: string; payload: { content?: string; sessionId?: string } }> = []
    const { db, runner } = createRunner(() => ({
      webContents: {
        send: (channel: string, payload: unknown) => {
          sends.push({ channel, payload: payload as { content?: string; sessionId?: string } })
        }
      }
    }))

    const redrawn = buildPaddedRedraw(STARTUP_COMMAND)
    const rawStream = `${STARTUP_COMMAND}\r\n${STARTUP_PROMPT}${redrawn}\r\n${PROGRAM_OUTPUT}`
    const expectedTranscript = `${STARTUP_PROMPT}${STARTUP_DISPLAY_COMMAND}\r\n${PROGRAM_OUTPUT}`

    const run = runner.run({
      taskId: 'task-padded-echo',
      nodeId: 'node-padded-echo',
      kind: 'interactive',
      command: startupNeutralCommand(),
      displayCommand: STARTUP_DISPLAY_COMMAND,
      cwd: '/repo'
    })
    const sessionId = (db.prepare('select id from terminal_sessions limit 1').get() as { id: string }).id

    expect(mocks.ptySpawn).toHaveBeenCalledWith('/bin/bash', ['-il'], expect.objectContaining({
      name: 'xterm-256color'
    }))
    expect(ptyWrite).toHaveBeenCalledTimes(1)
    expect(ptyWrite).toHaveBeenCalledWith(`${STARTUP_COMMAND}\n`)

    // Split points land inside the bare echo's surrogate pair, the OSC
    // sequence and the draw fragment; all before the redraw's line ending.
    const fragmentStart = rawStream.indexOf('\u001b[0K') - 1
    const emojiIndex = rawStream.indexOf('😀')
    const boundaries = [12, emojiIndex + 1, rawStream.indexOf('\u001b]') + 3, fragmentStart + 2]
      .sort((a, b) => a - b)
      .filter((value, index, values) => value > 0 && (index === 0 || value > values[index - 1]))
    let cursor = 0
    for (const boundary of boundaries) {
      mocks.ptyDataHandlers[0](rawStream.slice(cursor, boundary))
      cursor = boundary
      expect(sends.filter((event) => event.channel === 'terminal:data')).toHaveLength(0)
      expect(runner.getLiveTranscript(sessionId, 'task-padded-echo')).toBe('')
    }
    mocks.ptyDataHandlers[0](rawStream.slice(cursor))

    const snapshot = runner.getLiveTranscriptSnapshot(sessionId, 'task-padded-echo')
    expect(snapshot?.transcript).toBe(expectedTranscript)

    mocks.ptyExitHandlers[0]({ exitCode: 0 })
    const result = await run
    expect(result.stdout).toBe(rawStream)
    expect(result.stderr).toBe('')
    expect(result.exitCode).toBe(0)

    const ipcContent = sends
      .filter((event) => event.channel === 'terminal:data' && event.payload.sessionId === sessionId)
      .map((event) => event.payload.content)
      .join('')
    expect(ipcContent).toBe(expectedTranscript)
    const session = db.prepare('select transcript from terminal_sessions where id = ?')
      .get(sessionId) as { transcript: string }
    expect(session.transcript).toBe(expectedTranscript)
    expect(session.transcript.split('改动').length - 1).toBe(1)
    expect(session.transcript).not.toContain('CLILOOM_INTERNAL_VALUE_0')
    expect(sends.filter((event) => event.channel === 'terminal:closed')).toHaveLength(1)
    db.close()
  })

  it('releases pending startup recognition exactly once when killed mid-redraw', async () => {
    const sends: Array<{ channel: string; payload: { content?: string } }> = []
    mocks.ptySpawn.mockReturnValue({
      pid: 1315,
      onData: vi.fn((callback: (data: string) => void) => {
        mocks.ptyDataHandlers.push(callback)
      }),
      onExit: vi.fn((callback: (event: { exitCode: number }) => void) => {
        mocks.ptyExitHandlers.push(callback)
      }),
      write: vi.fn(),
      kill: vi.fn()
    })
    const { db, runner } = createRunner(() => ({
      webContents: {
        send: (channel: string, payload: unknown) => {
          sends.push({ channel, payload: payload as { content?: string } })
        }
      }
    }))

    const partialRedraw = `${STARTUP_PROMPT}${STARTUP_COMMAND.slice(0, 26)} \u001b[K`
    const run = runner.run({
      taskId: 'task-mid-redraw-kill',
      nodeId: 'node-mid-redraw-kill',
      kind: 'interactive',
      command: startupNeutralCommand(),
      displayCommand: STARTUP_DISPLAY_COMMAND,
      cwd: '/repo'
    })
    const sessionId = (db.prepare('select id from terminal_sessions limit 1').get() as { id: string }).id
    mocks.ptyDataHandlers[0](`${STARTUP_COMMAND}\r\n${partialRedraw}`)

    await expect(runner.kill(sessionId)).resolves.toBe(true)
    await expect(run).resolves.toMatchObject({ status: 'killed', exitCode: null })
    const session = db.prepare('select transcript from terminal_sessions where id = ?')
      .get(sessionId) as { transcript: string }
    expect(session.transcript).toBe(`${STARTUP_DISPLAY_COMMAND}\r\n${partialRedraw}`)
    expect(session.transcript.split('改动').length - 1).toBe(2)

    await expect(runner.kill(sessionId)).resolves.toBe(false)
    const unchanged = db.prepare('select transcript from terminal_sessions where id = ?')
      .get(sessionId) as { transcript: string }
    expect(unchanged.transcript).toBe(session.transcript)
    expect(sends.filter((event) => event.channel === 'terminal:closed')).toHaveLength(1)
    db.close()
  })

  it('shows prompts without newlines immediately while the session stays interactive', async () => {
    vi.useFakeTimers()
    const sends: Array<{ channel: string; payload: { content?: string } }> = []
    const ptyWrite = vi.fn()
    mocks.ptySpawn.mockReturnValue({
      pid: 1316,
      onData: vi.fn((callback: (data: string) => void) => {
        mocks.ptyDataHandlers.push(callback)
      }),
      onExit: vi.fn((callback: (event: { exitCode: number }) => void) => {
        mocks.ptyExitHandlers.push(callback)
      }),
      write: ptyWrite,
      kill: vi.fn()
    })
    const { db, runner } = createRunner(() => ({
      webContents: {
        send: (channel: string, payload: unknown) => {
          sends.push({ channel, payload: payload as { content?: string } })
        }
      }
    }))

    try {
      const run = runner.run({
        taskId: 'task-password-prompt',
        nodeId: 'node-password-prompt',
        kind: 'interactive',
        command: 'deploy-app',
        cwd: '/repo'
      })
      const sessionId = (db.prepare('select id from terminal_sessions limit 1').get() as { id: string }).id
      mocks.ptyDataHandlers[0]('Password: ')
      await vi.advanceTimersByTimeAsync(TERMINAL_DATA_FLUSH_INTERVAL_FOR_TEST_MS)

      expect(sends.filter((event) => event.channel === 'terminal:data').map((event) => event.payload.content))
        .toEqual(['Password: '])
      expect(runner.getLiveTranscript(sessionId, 'task-password-prompt')).toBe('Password: ')
      expect(runner.isInputReady(sessionId)).toBe(true)
      expect(runner.write(sessionId, 'secret\n')).toBe(true)
      expect(ptyWrite).toHaveBeenCalledWith('secret\n')

      mocks.ptyDataHandlers[0]('wty@host:/repo$ ')
      await vi.advanceTimersByTimeAsync(TERMINAL_DATA_FLUSH_INTERVAL_FOR_TEST_MS)
      expect(runner.getLiveTranscript(sessionId, 'task-password-prompt')).toBe('Password: wty@host:/repo$ ')

      mocks.ptyExitHandlers[0]({ exitCode: 0 })
      await expect(run).resolves.toMatchObject({ exitCode: 0 })
    } finally {
      vi.useRealTimers()
      db.close()
    }
  })

  it('resets startup recognition on retry and applies the retried command', async () => {
    const sends: Array<{ channel: string; payload: { content?: string } }> = []
    const { ptyWrite } = createMockPty()
    const { db, runner } = createRunner(() => ({
      webContents: {
        send: (channel: string, payload: unknown) => {
          sends.push({ channel, payload: payload as { content?: string } })
        }
      }
    }))

    const run = runner.run({
      taskId: 'task-retry-echo',
      nodeId: 'node-retry-echo',
      kind: 'interactive',
      command: startupNeutralCommand(),
      displayCommand: STARTUP_DISPLAY_COMMAND,
      cwd: '/repo'
    })
    const sessionId = (db.prepare('select id from terminal_sessions limit 1').get() as { id: string }).id
    const firstRaw = `${STARTUP_COMMAND}\r\n${STARTUP_PROMPT}${buildPaddedRedraw(STARTUP_COMMAND)}\r\n${PROGRAM_OUTPUT}`
    mocks.ptyDataHandlers[0](firstRaw)
    mocks.ptyExitHandlers[0]({ exitCode: 0 })
    await expect(run).resolves.toMatchObject({ exitCode: 0 })

    const retryCommand = `printf '%s' "重试 改动\${CLILOOM_INTERNAL_VALUE_0}"; exit`
    const retryDisplayCommand = `printf '%s' "重试 改动重试参数"; exit`
    const retryNeutral: ShellNeutralCommand = {
      version: 1,
      segments: [
        { type: 'literal', value: `printf '%s' "重试 改动` },
        { type: 'binding', name: BINDING_NAME },
        { type: 'literal', value: '"; exit' }
      ],
      bindings: { [BINDING_NAME]: '重试参数' }
    }
    const retryRaw = `${retryCommand}\r\n$ ${buildPaddedRedraw(retryCommand)}\r\nretry output\r\n`
    const retried = runner.retry(sessionId, {
      command: retryNeutral,
      displayCommand: retryDisplayCommand
    })
    expect(ptyWrite).toHaveBeenLastCalledWith(`${retryCommand}\n`)
    mocks.ptyDataHandlers[1](retryRaw)
    mocks.ptyExitHandlers[1]({ exitCode: 0 })
    await expect(retried.result).resolves.toMatchObject({ exitCode: 0 })

    const session = db.prepare('select transcript from terminal_sessions where id = ?')
      .get(sessionId) as { transcript: string }
    expect(session.transcript).toBe(`$ ${retryDisplayCommand}\r\nretry output\r\n`)
    expect(session.transcript).not.toContain('CLILOOM_INTERNAL_VALUE_0')
    expect(ptyWrite).toHaveBeenCalledTimes(2)
    db.close()
  })

  it('keeps single fragmented redraws untouched when no bare echo exists', async () => {
    createMockPty()
    const { db, runner } = createRunner()
    const command = STARTUP_COMMAND
    const redrawn = buildPaddedRedraw(command)
    const run = runner.run({
      taskId: 'task-fragmented-single',
      nodeId: 'node-fragmented-single',
      kind: 'interactive',
      command: startupNeutralCommand(),
      displayCommand: STARTUP_DISPLAY_COMMAND,
      cwd: '/repo'
    })
    const stream = `${STARTUP_PROMPT}${redrawn}\r\n${PROGRAM_OUTPUT}`
    mocks.ptyDataHandlers[0](stream.slice(0, 30))
    mocks.ptyDataHandlers[0](stream.slice(30))
    mocks.ptyExitHandlers[0]({ exitCode: 0 })
    await run

    const session = db.prepare('select transcript from terminal_sessions limit 1')
      .get() as { transcript: string }
    expect(session.transcript).toBe(stream)
    db.close()
  })
})

describe('ProcessRunner shell resolution and legacy retries', () => {
  it('records an explicit-shell availability failure without spawning a fallback', async () => {
    const sends: Array<{ channel: string; payload: { status?: string } }> = []
    const selected = {
      id: 'posix:%2Fmissing%2Fbash',
      displayName: 'bash',
      family: 'posix' as const,
      executablePath: '/missing/bash'
    }
    const { db, runner } = createRunner(() => ({
      webContents: {
        send: (channel: string, payload: unknown) => {
          sends.push({ channel, payload: payload as { status?: string } })
        }
      }
    }), {
      resolveEffectiveShell: () => {
        throw new ShellUnavailableError('所选 Shell 不可用', selected)
      }
    })

    const result = await runner.run({
      taskId: 'task-shell-missing',
      nodeId: 'node-shell-missing',
      kind: 'non-interactive',
      command: 'echo should-not-run',
      cwd: '/repo'
    })

    expect(result).toMatchObject({
      status: 'failed',
      exitCode: -1,
      stderr: expect.stringContaining('/missing/bash')
    })
    expect(result.stderr).toContain('Redetect the shell or choose another in Settings')
    expect(mocks.ptySpawn).not.toHaveBeenCalled()
    expect(sends.find((event) => event.channel === 'terminal:closed')?.payload.status).toBe('failed')
    expect(db.prepare('select status from terminal_sessions limit 1').get()).toEqual({ status: 'failed' })
    db.close()
  })

  it('rejects a legacy WSL retry before mutating history or spawning a process', () => {
    const shellResolver: EffectiveShellResolver = {
      resolveEffectiveShell: () => ({
        id: 'posix:%2Fbin%2Fbash',
        displayName: 'bash',
        family: 'posix',
        executablePath: '/bin/bash',
        source: 'system'
      })
    }
    const { db, runner } = createRunner(() => null, shellResolver)
    const now = new Date().toISOString()
    const requestJson = JSON.stringify({
      version: 3,
      retry: {
        command: {
          version: 1,
          segments: [{ type: 'literal', value: 'pwd' }],
          bindings: {}
        },
        sourceCwd: 'C:\\work\\demo',
        targetCwd: '/mnt/c/work/demo',
        target: {
          kind: 'wsl',
          id: 'wsl:v1:Ubuntu',
          displayName: 'Ubuntu',
          family: 'posix',
          distributionName: 'Ubuntu'
        }
      }
    })
    db.prepare(
      'insert into terminal_sessions (id, task_id, node_id, kind, command, cwd, status, transcript, created_at, updated_at, request_json) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      'legacy-target-retry',
      'legacy-target-task',
      'legacy-target-node',
      'non-interactive',
      'pwd',
      '/mnt/c/work/demo',
      'closed',
      'preserved transcript',
      now,
      now,
      requestJson
    )
    const before = db.prepare(
      'select status, transcript, request_json from terminal_sessions where id = ?'
    ).get('legacy-target-retry')

    expect(() => runner.retry('legacy-target-retry'))
      .toThrow('historical execution target is no longer supported')
    expect(db.prepare(
      'select status, transcript, request_json from terminal_sessions where id = ?'
    ).get('legacy-target-retry')).toEqual(before)
    expect(mocks.ptySpawn).not.toHaveBeenCalled()
    db.close()
  })

  it('interrupts terminals still waiting for native target validation', async () => {
    const target = {
      id: 'posix:%2Fbin%2Fbash',
      displayName: 'bash',
      family: 'posix' as const,
      executablePath: '/bin/bash',
      source: 'system' as const
    }
    let completeResolution: (value: typeof target) => void = () => undefined
    const resolution = new Promise<typeof target>((resolve) => {
      completeResolution = resolve
    })
    const shellResolver: EffectiveShellResolver = {
      resolveEffectiveShell: () => target,
      resolveTarget: async () => resolution
    }
    const { db, runner } = createRunner(() => null, shellResolver)
    const descriptor = {
      kind: 'native' as const,
      id: target.id,
      displayName: target.displayName,
      family: target.family,
      executablePath: target.executablePath
    }
    const terminal = runner.run({
      taskId: 'pending-target-task',
      nodeId: 'pending-terminal',
      kind: 'non-interactive',
      command: 'echo terminal',
      cwd: '/repo',
      executionTarget: descriptor
    })
    const hook = runner.runHook({
      taskId: 'pending-target-task',
      nodeId: 'pending-hook',
      hookType: 'start',
      command: 'echo hook',
      cwd: '/repo',
      executionTarget: descriptor
    })

    const cleanup = runner.killByTask('pending-target-task', 'interrupted')
    completeResolution(target)

    await expect(cleanup).resolves.toBe(2)
    await expect(terminal).resolves.toMatchObject({ status: 'interrupted', exitCode: null })
    await expect(hook).resolves.toMatchObject({ status: 'killed', exitCode: null })
    expect(mocks.ptySpawn).not.toHaveBeenCalled()
    expect(mocks.spawn).not.toHaveBeenCalled()
    expect(db.prepare('select status from terminal_sessions limit 1').get()).toEqual({ status: 'interrupted' })
    expect(db.prepare('select status from hook_runs limit 1').get()).toEqual({ status: 'killed' })
    db.close()
  })

  it('decodes a legacy POSIX binding before retrying with the current PowerShell', async () => {
    const shellResolver: EffectiveShellResolver = {
      resolveEffectiveShell: () => ({
        id: 'powershell:C%3A%5CTools%5Cpwsh.exe',
        displayName: 'PowerShell 7',
        family: 'powershell',
        executablePath: 'C:\\Tools\\pwsh.exe',
        source: 'path'
      })
    }
    mocks.ptySpawn.mockReturnValue({
      pid: 4242,
      onData: vi.fn(),
      onExit: vi.fn((callback: (event: { exitCode: number }) => void) => {
        mocks.ptyExitHandlers.push(callback)
      }),
      write: vi.fn(),
      kill: vi.fn()
    })
    const { db, runner } = createRunner(() => null, shellResolver)
    const now = new Date().toISOString()
    db.prepare(
      'insert into terminal_sessions (id, task_id, node_id, kind, command, cwd, status, transcript, created_at, updated_at, request_json) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      'legacy-session',
      'legacy-task',
      'legacy-node',
      'non-interactive',
      'Write-Output "${CLILOOM_INTERNAL_VALUE_0}"',
      '/repo',
      'closed',
      '',
      now,
      now,
      JSON.stringify({
        env: { CLILOOM_INTERNAL_VALUE_0: 'value & $(not-code)' },
        displayCommand: 'Write-Output "value & $(not-code)"'
      })
    )

    const retried = runner.retry('legacy-session')

    expect(mocks.ptySpawn).toHaveBeenCalledWith(
      'C:\\Tools\\pwsh.exe',
      [
        '-NoLogo',
        '-Command',
        expect.stringMatching(/OutputEncoding.*Write-Output "\$\{env:CLILOOM_INTERNAL_VALUE_0\}"/)
      ],
      expect.objectContaining({
        env: expect.objectContaining({ CLILOOM_INTERNAL_VALUE_0: 'value & $(not-code)' })
      })
    )
    mocks.ptyExitHandlers[0]({ exitCode: 0 })
    await expect(retried.result).resolves.toMatchObject({ exitCode: 0 })
    expect(JSON.parse((db.prepare(
      'select request_json from terminal_sessions where id = ?'
    ).get('legacy-session') as { request_json: string }).request_json)).toMatchObject({
      version: 3,
      retry: {
        command: {
          bindings: { CLILOOM_INTERNAL_VALUE_0: 'value & $(not-code)' }
        }
      },
      diagnostic: { family: 'powershell' }
    })
    db.close()
  })

  it('decodes a legacy POSIX binding before retrying with the current cmd.exe', async () => {
    const shellResolver: EffectiveShellResolver = {
      resolveEffectiveShell: () => ({
        id: 'cmd:C%3A%5CWindows%5CSystem32%5Ccmd.exe',
        displayName: 'Command Prompt',
        family: 'cmd',
        executablePath: 'C:\\Windows\\System32\\cmd.exe',
        source: 'system'
      })
    }
    mocks.ptySpawn.mockReturnValue({
      pid: 4243,
      onData: vi.fn(),
      onExit: vi.fn((callback: (event: { exitCode: number }) => void) => {
        mocks.ptyExitHandlers.push(callback)
      }),
      write: vi.fn(),
      kill: vi.fn()
    })
    const { db, runner } = createRunner(() => null, shellResolver)
    const now = new Date().toISOString()
    db.prepare(
      'insert into terminal_sessions (id, task_id, node_id, kind, command, cwd, status, transcript, created_at, updated_at, request_json) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      'legacy-cmd-session',
      'legacy-cmd-task',
      'legacy-cmd-node',
      'non-interactive',
      'echo "${CLILOOM_INTERNAL_VALUE_0}"',
      '/repo',
      'closed',
      '',
      now,
      now,
      JSON.stringify({
        env: { CLILOOM_INTERNAL_VALUE_0: 'value & not-code' },
        displayCommand: 'echo "value & not-code"'
      })
    )

    const retried = runner.retry('legacy-cmd-session')

    expect(mocks.ptySpawn).toHaveBeenCalledWith(
      'C:\\Windows\\System32\\cmd.exe',
      ['/d', '/v:on', '/s', '/c', 'chcp 65001>nul & echo "!CLILOOM_INTERNAL_VALUE_0!"'],
      expect.objectContaining({
        env: expect.objectContaining({ CLILOOM_INTERNAL_VALUE_0: 'value & not-code' })
      })
    )
    mocks.ptyExitHandlers[0]({ exitCode: 0 })
    await expect(retried.result).resolves.toMatchObject({ exitCode: 0 })
    expect(JSON.parse((db.prepare(
      'select request_json from terminal_sessions where id = ?'
    ).get('legacy-cmd-session') as { request_json: string }).request_json)).toMatchObject({
      version: 3,
      diagnostic: { family: 'cmd' }
    })
    db.close()
  })

  it('rejects ambiguous legacy bindings instead of passing POSIX syntax to a new shell', () => {
    const { db, runner } = createRunner()
    const now = new Date().toISOString()
    db.prepare(
      'insert into terminal_sessions (id, task_id, node_id, kind, command, cwd, status, transcript, created_at, updated_at, request_json) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      'ambiguous-session',
      'legacy-task',
      'legacy-node',
      'non-interactive',
      'printf "${CLILOOM_INTERNAL_VALUE_0}"',
      '/repo',
      'closed',
      '',
      now,
      now,
      null
    )

    expect(() => runner.retry('ambiguous-session')).toThrow('cannot retry safely, rerun the workflow')
    expect(mocks.ptySpawn).not.toHaveBeenCalled()
    db.close()
  })
})

describe('ProcessRunner hooks', () => {
  it('runs hooks with an explicit shell and includes them in awaited task cleanup', async () => {
    const handlers = new Map<string, (...args: unknown[]) => void>()
    const stdoutHandlers = new Map<string, (chunk: string) => void>()
    const stderrHandlers = new Map<string, (chunk: string) => void>()
    const childKill = vi.fn()
    const child = {
      pid: 4242,
      stdin: { end: vi.fn() },
      stdout: {
        setEncoding: vi.fn(),
        on: vi.fn((event: string, callback: (chunk: string) => void) => {
          stdoutHandlers.set(event, callback)
        })
      },
      stderr: {
        setEncoding: vi.fn(),
        on: vi.fn((event: string, callback: (chunk: string) => void) => {
          stderrHandlers.set(event, callback)
        })
      },
      on: vi.fn((event: string, callback: (...args: unknown[]) => void) => {
        handlers.set(event, callback)
      }),
      kill: childKill
    }
    mocks.spawn.mockReturnValue(child)
    const shellResolver: EffectiveShellResolver = {
      resolveEffectiveShell: () => ({
        id: 'posix:%2Fbin%2Fzsh',
        displayName: 'zsh',
        family: 'posix',
        executablePath: '/bin/zsh',
        source: 'system'
      })
    }
    const { db, runner } = createRunner(() => null, shellResolver)

    const result = runner.runHook({
      taskId: 'hook-task',
      nodeId: 'hook-node',
      hookType: 'start',
      command: 'printf hook-output',
      cwd: '/repo'
    })

    expect(mocks.spawn).toHaveBeenCalledWith(
      '/bin/zsh',
      ['-lc', 'printf hook-output'],
      expect.objectContaining({
        shell: false,
        detached: true
      })
    )
    stdoutHandlers.get('data')?.('hook-output')
    stderrHandlers.get('data')?.('warning')
    await expect(runner.killByTask('hook-task')).resolves.toBe(1)
    await expect(result).resolves.toMatchObject({
      status: 'killed',
      stdout: 'hook-output',
      stderr: 'warning',
      exitCode: null
    })
    expect(childKill).toHaveBeenCalledWith('SIGTERM')
    expect(db.prepare('select status from hook_runs limit 1').get()).toEqual({ status: 'killed' })
    handlers.get('close')?.(0)
    db.close()
  })

  it('persists Hook preparation and synchronous spawn failures', async () => {
    const { db, runner } = createRunner()

    const preparationFailure = await runner.runHook({
      taskId: 'hook-errors',
      nodeId: 'hook-preparation',
      hookType: 'start',
      command: 'echo unused',
      cwd: '/repo',
      preparationError: '工作流变量不能包含 NUL 字符'
    })
    expect(preparationFailure).toMatchObject({
      status: 'failed',
      exitCode: -1,
      stderr: expect.stringContaining('工作流变量不能包含 NUL 字符')
    })
    expect(mocks.spawn).not.toHaveBeenCalled()

    mocks.spawn.mockImplementationOnce(() => {
      throw new Error('spawn refused')
    })
    const spawnFailure = await runner.runHook({
      taskId: 'hook-errors',
      nodeId: 'hook-spawn',
      hookType: 'end',
      command: 'echo unused',
      cwd: '/repo'
    })
    expect(spawnFailure).toMatchObject({
      status: 'failed',
      exitCode: -1,
      stderr: expect.stringContaining('spawn refused')
    })
    expect(db.prepare(
      'select node_id, status, stderr from hook_runs order by rowid'
    ).all()).toEqual([
      expect.objectContaining({ node_id: 'hook-preparation', status: 'failed' }),
      expect.objectContaining({ node_id: 'hook-spawn', status: 'failed' })
    ])
    db.close()
  })

  it('persists a Hook failure when the selected Shell is unavailable', async () => {
    const selected = {
      id: 'posix:%2Fmissing%2Fbash',
      displayName: 'bash',
      family: 'posix' as const,
      executablePath: '/missing/bash'
    }
    const { db, runner } = createRunner(() => null, {
      resolveEffectiveShell: () => {
        throw new ShellUnavailableError('所选 Shell 不可用', selected)
      }
    })

    const result = await runner.runHook({
      taskId: 'hook-shell-missing',
      nodeId: 'hook-shell-missing-node',
      hookType: 'start',
      command: 'echo unused',
      cwd: '/repo'
    })

    expect(result).toMatchObject({
      status: 'failed',
      exitCode: -1,
      stderr: expect.stringContaining('/missing/bash')
    })
    expect(mocks.spawn).not.toHaveBeenCalled()
    expect(db.prepare('select status from hook_runs limit 1').get()).toEqual({
      status: 'failed'
    })
    db.close()
  })

  it('persists an asynchronous Hook spawn error and settles only once', async () => {
    const handlers = new Map<string, (...args: unknown[]) => void>()
    const child = {
      pid: 9292,
      stdin: { end: vi.fn() },
      stdout: { setEncoding: vi.fn(), on: vi.fn() },
      stderr: { setEncoding: vi.fn(), on: vi.fn() },
      on: vi.fn((event: string, callback: (...args: unknown[]) => void) => {
        handlers.set(event, callback)
      }),
      kill: vi.fn()
    }
    mocks.spawn.mockReturnValue(child)
    const { db, runner } = createRunner()
    const result = runner.runHook({
      taskId: 'hook-async-error',
      nodeId: 'hook-async-error-node',
      hookType: 'end',
      command: 'echo unused',
      cwd: '/repo'
    })

    handlers.get('error')?.(new Error('asynchronous spawn failure'))
    handlers.get('close')?.(1)

    await expect(result).resolves.toMatchObject({
      status: 'failed',
      exitCode: -1,
      stderr: expect.stringContaining('asynchronous spawn failure')
    })
    expect(db.prepare('select status, exit_code from hook_runs limit 1').get()).toEqual({
      status: 'failed',
      exit_code: -1
    })
    db.close()
  })
})

describe('ProcessRunner captured platform startup echo integration', () => {
  function createCapturedRunner(platform: NodeJS.Platform) {
    const sends: Array<{ channel: string; payload: Record<string, unknown> }> = []
    const ptyWrite = vi.fn()
    mocks.ptySpawn.mockReturnValue({
      pid: 1717,
      onData: vi.fn((callback: (data: string) => void) => {
        mocks.ptyDataHandlers.push(callback)
      }),
      onExit: vi.fn((callback: (event: { exitCode: number }) => void) => {
        mocks.ptyExitHandlers.push(callback)
      }),
      write: ptyWrite,
      resize: vi.fn(),
      kill: vi.fn()
    })
    const { db, runner } = createRunner(() => ({
      webContents: {
        send: (channel: string, payload: unknown) => {
          sends.push({ channel, payload: payload as Record<string, unknown> })
        }
      }
    }), undefined, undefined, platform)
    return { db, runner, sends, ptyWrite }
  }

  function capturedNeutralCommand(command: string, display: string) {
    const prefixLength = command.indexOf('${CLILOOM_INTERNAL_VALUE_1}')
    const suffix = command.slice(prefixLength + '${CLILOOM_INTERNAL_VALUE_1}'.length)
    return {
      command: {
        version: 1 as const,
        segments: [
          { type: 'literal' as const, value: command.slice(0, prefixLength) },
          { type: 'binding' as const, name: 'CLILOOM_INTERNAL_VALUE_1' },
          { type: 'literal' as const, value: suffix }
        ],
        bindings: { CLILOOM_INTERNAL_VALUE_1: '实际参数-$(echo 注入)' }
      },
      displayCommand: display
    }
  }

  function transcriptView(sends: Array<{ channel: string; payload: Record<string, unknown> }>, sessionId: string) {
    return sends
      .filter((event) => event.channel === 'terminal:data' && event.payload.sessionId === sessionId)
      .map((event) => event.payload.content)
      .join('')
  }

  it('normalizes the captured macOS startup across all transcript views', async () => {
    const { db, runner, sends, ptyWrite } = createCapturedRunner('darwin')
    const neutral = capturedNeutralCommand(MACOS_CAPTURED_COMMAND, MACOS_CAPTURED_DISPLAY_COMMAND)
    const run = runner.run({
      taskId: 'task-macos-startup',
      nodeId: 'node-macos-startup',
      kind: 'interactive',
      command: neutral.command,
      displayCommand: neutral.displayCommand,
      cwd: '/repo',
      cols: 40,
      rows: 24
    })
    const sessionId = (db.prepare('select id from terminal_sessions limit 1').get() as { id: string }).id

    expect(ptyWrite).toHaveBeenCalledTimes(1)
    expect(ptyWrite).toHaveBeenCalledWith(`${MACOS_CAPTURED_COMMAND}\n`)

    const bannerEnd = MACOS_CAPTURED_STREAM.indexOf('CLILOOM$ ')
    mocks.ptyDataHandlers[0](MACOS_CAPTURED_STREAM.slice(0, bannerEnd))
    mocks.ptyDataHandlers[0](MACOS_CAPTURED_STREAM.slice(bannerEnd))
    const snapshot = runner.getLiveTranscriptSnapshot(sessionId, 'task-macos-startup')
    expect(snapshot?.transcript).toBe(MACOS_CAPTURED_EXPECTED)

    mocks.ptyExitHandlers[0]({ exitCode: 0 })
    const result = await run
    expect(result.stdout).toBe(MACOS_CAPTURED_STREAM)
    expect(result.stderr).toBe('')
    expect(result.exitCode).toBe(0)
    expect(transcriptView(sends, sessionId)).toBe(MACOS_CAPTURED_EXPECTED)
    const session = db.prepare('select transcript from terminal_sessions where id = ?')
      .get(sessionId) as { transcript: string }
    expect(session.transcript).toBe(MACOS_CAPTURED_EXPECTED)
    expect(session.transcript).not.toContain('CLILOOM_INTERNAL_VALUE_1')
    expect(session.transcript.split('任务说明：').length - 1).toBe(2)
    db.close()
  })

  it.each([
    { cols: 40, stream: WIN32_CAPTURED_STREAM },
    { cols: 80, stream: WIN32_80_COLUMN_STREAM }
  ])('normalizes the captured Windows first draw at $cols columns without a bare echo', async ({ cols, stream }) => {
    const { db, runner, sends, ptyWrite } = createCapturedRunner('win32')
    const neutral = capturedNeutralCommand(WIN32_CAPTURED_COMMAND, WIN32_CAPTURED_DISPLAY_COMMAND)
    const run = runner.run({
      taskId: 'task-win32-startup',
      nodeId: 'node-win32-startup',
      kind: 'interactive',
      command: neutral.command,
      displayCommand: neutral.displayCommand,
      cwd: 'C:\\repo',
      cols,
      rows: 24
    })
    const sessionId = (db.prepare('select id from terminal_sessions limit 1').get() as { id: string }).id

    expect(ptyWrite).toHaveBeenCalledTimes(1)
    expect(ptyWrite).toHaveBeenCalledWith(`${WIN32_CAPTURED_COMMAND}\r`)

    mocks.ptyDataHandlers[0](stream.slice(0, 90))
    mocks.ptyDataHandlers[0](stream.slice(90))
    mocks.ptyExitHandlers[0]({ exitCode: 0 })
    const result = await run
    expect(result.stdout).toBe(stream)
    expect(result.exitCode).toBe(0)
    expect(transcriptView(sends, sessionId)).toBe(WIN32_CAPTURED_EXPECTED)
    const session = db.prepare('select transcript from terminal_sessions where id = ?')
      .get(sessionId) as { transcript: string }
    expect(session.transcript).toBe(WIN32_CAPTURED_EXPECTED)
    expect(session.transcript).not.toContain('CLILOOM_INTERNAL_VALUE_1')
    db.close()
  })

  it('releases undecided startup bytes exactly once when the window expires', async () => {
    vi.useFakeTimers()
    const { db, runner, sends } = createCapturedRunner('win32')
    try {
      const neutral = capturedNeutralCommand(WIN32_CAPTURED_COMMAND, WIN32_CAPTURED_DISPLAY_COMMAND)
      const run = runner.run({
        taskId: 'task-win32-deadline',
        nodeId: 'node-win32-deadline',
        kind: 'interactive',
        command: neutral.command,
        displayCommand: neutral.displayCommand,
        cwd: 'C:\\repo',
        cols: 40,
        rows: 24
      })
      const sessionId = (db.prepare('select id from terminal_sessions limit 1').get() as { id: string }).id

      // Ends inside the OSC title so the display mapper has no command prefix
      // to hold back.
      const pendingSlice = WIN32_CAPTURED_STREAM.slice(0, 40)
      mocks.ptyDataHandlers[0](pendingSlice)
      expect(runner.getLiveTranscriptSnapshot(sessionId, 'task-win32-deadline')?.transcript).toBe('')

      await vi.advanceTimersByTimeAsync(2_000)
      expect(runner.getLiveTranscriptSnapshot(sessionId, 'task-win32-deadline')?.transcript)
        .toBe(pendingSlice)

      // The window is never extended or repeated: more pending output and time
      // do not trigger a second release, and later bytes pass through as-is.
      const later = `${WIN32_CAPTURED_STREAM.slice(40, 120)}`
      mocks.ptyDataHandlers[0](later)
      await vi.advanceTimersByTimeAsync(5_000)
      expect(runner.getLiveTranscriptSnapshot(sessionId, 'task-win32-deadline')?.transcript)
        .toBe(`${pendingSlice}${later}`)

      mocks.ptyExitHandlers[0]({ exitCode: 0 })
      const result = await run
      expect(result.stdout).toBe(`${pendingSlice}${later}`)
      expect(transcriptView(sends, sessionId)).toBe(`${pendingSlice}${later}`)
      db.close()
    } finally {
      vi.useRealTimers()
    }
  })

  it('clears the recognition timer as soon as a later chunk settles recognition', async () => {
    vi.useFakeTimers()
    const schedule = vi.spyOn(globalThis, 'setTimeout')
    const cancel = vi.spyOn(globalThis, 'clearTimeout')
    const { db, runner, sends } = createCapturedRunner('win32')
    try {
      const neutral = capturedNeutralCommand(WIN32_CAPTURED_COMMAND, WIN32_CAPTURED_DISPLAY_COMMAND)
      const run = runner.run({
        taskId: 'task-win32-settled',
        nodeId: 'node-win32-settled',
        kind: 'interactive',
        command: neutral.command,
        displayCommand: neutral.displayCommand,
        cwd: 'C:\\repo',
        cols: 40,
        rows: 24
      })
      const sessionId = (db.prepare('select id from terminal_sessions limit 1').get() as { id: string }).id
      mocks.ptyDataHandlers[0](WIN32_CAPTURED_STREAM.slice(0, 40))
      const timerIndex = schedule.mock.calls.findIndex((args) => args[1] === 2_000)
      expect(timerIndex).toBeGreaterThanOrEqual(0)
      const recognitionTimer = schedule.mock.results[timerIndex].value
      mocks.ptyDataHandlers[0](WIN32_CAPTURED_STREAM.slice(40))
      expect(cancel).toHaveBeenCalledWith(recognitionTimer)
      const settled = runner.getLiveTranscriptSnapshot(sessionId, 'task-win32-settled')?.transcript
      expect(settled).toBe(WIN32_CAPTURED_EXPECTED)

      await vi.advanceTimersByTimeAsync(6_000)
      mocks.ptyDataHandlers[0]('later output\r\n')
      expect(schedule.mock.calls.filter((args) => args[1] === 2_000)).toHaveLength(1)
      mocks.ptyExitHandlers[0]({ exitCode: 0 })
      await run
      expect(transcriptView(sends, sessionId)).toBe(`${WIN32_CAPTURED_EXPECTED}later output\r\n`)
      db.close()
    } finally {
      schedule.mockRestore()
      cancel.mockRestore()
      vi.useRealTimers()
    }
  })

  it('does not arm the window when the first output already passes through', async () => {
    vi.useFakeTimers()
    const { db, runner } = createCapturedRunner('linux')
    try {
      const run = runner.run({
        taskId: 'task-linux-prompt',
        nodeId: 'node-linux-prompt',
        kind: 'interactive',
        command: 'deploy-app',
        cwd: '/repo'
      })
      const sessionId = (db.prepare('select id from terminal_sessions limit 1').get() as { id: string }).id
      mocks.ptyDataHandlers[0]('Password: ')
      expect(runner.getLiveTranscriptSnapshot(sessionId, 'task-linux-prompt')?.transcript)
        .toBe('Password: ')

      await vi.advanceTimersByTimeAsync(4_000)
      expect(runner.getLiveTranscriptSnapshot(sessionId, 'task-linux-prompt')?.transcript)
        .toBe('Password: ')

      mocks.ptyExitHandlers[0]({ exitCode: 0 })
      await run
      db.close()
    } finally {
      vi.useRealTimers()
    }
  })

  it('releases pending recognition on resize and stops interpreting stale columns', async () => {
    vi.useFakeTimers()
    const { db, runner, sends } = createCapturedRunner('win32')
    try {
      const neutral = capturedNeutralCommand(WIN32_CAPTURED_COMMAND, WIN32_CAPTURED_DISPLAY_COMMAND)
      const run = runner.run({
        taskId: 'task-win32-resize',
        nodeId: 'node-win32-resize',
        kind: 'interactive',
        command: neutral.command,
        displayCommand: neutral.displayCommand,
        cwd: 'C:\\repo',
        cols: 40,
        rows: 24
      })
      const sessionId = (db.prepare('select id from terminal_sessions limit 1').get() as { id: string }).id

      const pendingSlice = WIN32_CAPTURED_STREAM.slice(0, 40)
      mocks.ptyDataHandlers[0](pendingSlice)
      expect(runner.getLiveTranscriptSnapshot(sessionId, 'task-win32-resize')?.transcript).toBe('')

      expect(runner.resize(sessionId, 120, 30)).toBe(true)
      expect(runner.getLiveTranscriptSnapshot(sessionId, 'task-win32-resize')?.transcript)
        .toBe(pendingSlice)

      await vi.advanceTimersByTimeAsync(3_000)
      expect(runner.getLiveTranscriptSnapshot(sessionId, 'task-win32-resize')?.transcript)
        .toBe(pendingSlice)

      // After the release the recognizer is inert: the remaining captured
      // bytes (including the boundary insert) pass through unchanged.
      const rest = WIN32_CAPTURED_STREAM.slice(40)
      mocks.ptyDataHandlers[0](rest)
      expect(runner.getLiveTranscriptSnapshot(sessionId, 'task-win32-resize')?.transcript)
        .toBe(WIN32_CAPTURED_STREAM)

      mocks.ptyExitHandlers[0]({ exitCode: 0 })
      const result = await run
      expect(result.stdout).toBe(WIN32_CAPTURED_STREAM)
      expect(transcriptView(sends, sessionId)).toBe(WIN32_CAPTURED_STREAM)
      db.close()
    } finally {
      vi.useRealTimers()
    }
  })

  it('flushes pending startup bytes once when the session is killed mid-recognition', async () => {
    vi.useFakeTimers()
    const { db, runner, sends } = createCapturedRunner('darwin')
    try {
      const neutral = capturedNeutralCommand(MACOS_CAPTURED_COMMAND, MACOS_CAPTURED_DISPLAY_COMMAND)
      const run = runner.run({
        taskId: 'task-macos-kill',
        nodeId: 'node-macos-kill',
        kind: 'interactive',
        command: neutral.command,
        displayCommand: neutral.displayCommand,
        cwd: '/repo',
        cols: 40,
        rows: 24
      })
      const sessionId = (db.prepare('select id from terminal_sessions limit 1').get() as { id: string }).id
      const partial = `${MACOS_CAPTURED_COMMAND}\r\n\r\nThe default interactive shell`
      mocks.ptyDataHandlers[0](partial)
      expect(runner.getLiveTranscriptSnapshot(sessionId, 'task-macos-kill')?.transcript).toBe('')

      await expect(runner.kill(sessionId)).resolves.toBe(true)
      await expect(run).resolves.toMatchObject({ status: 'killed', exitCode: null })
      const flushed = db.prepare('select transcript from terminal_sessions where id = ?')
        .get(sessionId) as { transcript: string }
      expect(flushed.transcript)
        .toBe(`${MACOS_CAPTURED_DISPLAY_COMMAND}\r\n\r\nThe default interactive shell`)

      await vi.advanceTimersByTimeAsync(4_000)
      await expect(runner.kill(sessionId)).resolves.toBe(false)
      const session = db.prepare('select transcript from terminal_sessions where id = ?')
        .get(sessionId) as { transcript: string }
      expect(session.transcript).toBe(flushed.transcript)
      expect(sends.filter((event) => event.channel === 'terminal:closed')).toHaveLength(1)
      db.close()
    } finally {
      vi.useRealTimers()
    }
  })

  it('retries with a fresh recognition state on the new command', async () => {
    const { db, runner, sends, ptyWrite } = createCapturedRunner('win32')
    const neutral = capturedNeutralCommand(WIN32_CAPTURED_COMMAND, WIN32_CAPTURED_DISPLAY_COMMAND)
    const first = runner.run({
      taskId: 'task-win32-retry',
      nodeId: 'node-win32-retry',
      kind: 'interactive',
      command: neutral.command,
      displayCommand: neutral.displayCommand,
      cwd: 'C:\\repo',
      cols: 40,
      rows: 24
    })
    const sessionId = (db.prepare('select id from terminal_sessions limit 1').get() as { id: string }).id
    mocks.ptyDataHandlers[0](WIN32_CAPTURED_STREAM)
    mocks.ptyExitHandlers[0]({ exitCode: 0 })
    await expect(first).resolves.toMatchObject({ exitCode: 0 })

    const retryPrefix = WIN32_CAPTURED_PREFIX
    const retryCommand = `printf '%s ' "重试任务检查任务${'$'}{CLILOOM_INTERNAL_VALUE_1}"; exit`
    const retryDisplay = `printf '%s ' "重试任务检查任务重试参数"; exit`
    const retryNeutral = capturedNeutralCommand(retryCommand, retryDisplay)
    // The boundary insert lands exactly at the 40-column edge: prompt (9) +
    // "printf '%s \"" (14) + eight wide glyphs (16) = column 39, padding
    // space brings the cursor to column 40 where ConPTY repositions.
    const retryRedraw = `${retryCommand.slice(0, 22)} \u001b[?2004l\u001b[1;40H ${retryCommand.slice(22)}`
    const retryStream = `${retryPrefix}CLILOOM$ ${retryRedraw}\r\nretry output\r\n`
    sends.length = 0
    const retried = runner.retry(sessionId, {
      command: retryNeutral.command,
      displayCommand: retryDisplay
    })
    expect(ptyWrite).toHaveBeenLastCalledWith(`${retryCommand}\r`)
    mocks.ptyDataHandlers[1](retryStream)
    mocks.ptyExitHandlers[1]({ exitCode: 0 })
    await expect(retried.result).resolves.toMatchObject({ exitCode: 0 })

    const session = db.prepare('select transcript from terminal_sessions where id = ?')
      .get(sessionId) as { transcript: string }
    expect(session.transcript).toBe(`${retryPrefix}CLILOOM$ ${retryDisplay}\r\nretry output\r\n`)
    expect(transcriptView(sends, sessionId)).toBe(session.transcript)
    db.close()
  })
})
