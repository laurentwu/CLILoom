import Database from 'better-sqlite3'
import type { BrowserWindow } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
import { ShellUnavailableError } from './shellService'
import {
  MAX_PERSISTED_TERMINAL_TRANSCRIPT_CHARS,
  MAX_PROCESS_RESULT_CHARS,
  MAX_TERMINAL_TRANSCRIPT_CHARS
} from '../shared/terminalBuffer'

const TERMINAL_DATA_FLUSH_INTERVAL_FOR_TEST_MS = 16

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
  platform: NodeJS.Platform = process.platform
) {
  const db = new Database(':memory:')
  db.exec(`
    create table terminal_sessions (
      id text primary key,
      task_id text not null,
      node_id text not null,
      kind text not null,
      command text not null,
      cwd text not null,
      status text not null,
      transcript text not null,
      created_at text not null,
      updated_at text not null,
      request_json text
    );
    create table process_logs (
      id text primary key,
      task_id text not null,
      node_id text,
      stream text not null,
      content text not null,
      created_at text not null
    );
    create table hook_runs (
      id text primary key,
      task_id text not null,
      node_id text not null,
      hook_type text not null,
      status text not null,
      stdout text not null,
      stderr text not null,
      exit_code integer,
      created_at text not null
    );
  `)
  return {
    db,
    runner: new ProcessRunner(
      db,
      getWindow as unknown as () => BrowserWindow | null,
      { PATH: '/usr/bin', HOME: '/home/test', LANG: 'C.UTF-8' },
      shellResolver,
      terminateTree,
      process.cwd(),
      platform
    )
  }
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
    db.close()
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
    const { db, runner } = createRunner(() => ({
      webContents: {
        send: (channel: string, payload: unknown) => {
          sends.push({ channel, payload: payload as { status?: string } })
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

  it('kills only in-memory PTYs belonging to the requested task', async () => {
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

    await expect(runner.killByTask('task-1')).resolves.toBe(2)
    expect(kills[0]).toHaveBeenCalledOnce()
    expect(kills[1]).toHaveBeenCalledOnce()
    expect(kills[2]).not.toHaveBeenCalled()
    expect(runner.hasLiveSession(otherId)).toBe(true)

    await expect(runner.kill(otherId)).resolves.toBe(true)
    await Promise.all([first, second, other])
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

  it('cancels terminals and hooks still waiting for native target validation', async () => {
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

    const cleanup = runner.killByTask('pending-target-task')
    completeResolution(target)

    await expect(cleanup).resolves.toBe(2)
    await expect(terminal).resolves.toMatchObject({ status: 'killed', exitCode: null })
    await expect(hook).resolves.toMatchObject({ status: 'killed', exitCode: null })
    expect(mocks.ptySpawn).not.toHaveBeenCalled()
    expect(mocks.spawn).not.toHaveBeenCalled()
    expect(db.prepare('select status from terminal_sessions limit 1').get()).toEqual({ status: 'killed' })
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
        detached: process.platform !== 'win32'
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
