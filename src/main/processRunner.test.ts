import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'
import { bindShellCommand, interpolate } from '../shared/workflow'
import { ProcessRunner } from './processRunner'
import { renderShellCommand } from './shellExecution'

function createRunner(withWindow = false) {
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
  const send = vi.fn()
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !/^CLILOOM_INTERNAL_VALUE_\d+$/.test(name))
  )
  const runner = new ProcessRunner(
    db,
    () => withWindow ? { webContents: { send } } as never : null,
    environment
  )
  return { db, runner, send }
}

describe('ProcessRunner session liveness', () => {
  it('reports missing sessions as not live', () => {
    const { db, runner } = createRunner()
    expect(runner.hasLiveSession('missing')).toBe(false)
    db.close()
  })
})

describe('ProcessRunner retry error handling', () => {
  it('rethrows the specific retry error instead of wrapping it when stored data is malformed', () => {
    const { db, runner } = createRunner()
    db.prepare(
      `insert into terminal_sessions
        (id, task_id, node_id, kind, command, cwd, status, transcript, created_at, updated_at, request_json)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      'sess-retry', 'task-1', 'node-1', 'non-interactive', 'echo', process.cwd(),
      'completed', '', new Date().toISOString(), new Date().toISOString(), '"not-an-object"'
    )

    expect(() => runner.retry('sess-retry')).toThrow(/rerun the workflow/i)
    db.close()
  })

  it('wraps an unreadable retry payload in a retry error', () => {
    const { db, runner } = createRunner()
    db.prepare(
      `insert into terminal_sessions
        (id, task_id, node_id, kind, command, cwd, status, transcript, created_at, updated_at, request_json)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      'sess-unreadable', 'task-1', 'node-1', 'non-interactive', 'echo', process.cwd(),
      'completed', '', new Date().toISOString(), new Date().toISOString(), '{bad json'
    )

    expect(() => runner.retry('sess-unreadable')).toThrow(/rerun the workflow/i)
    db.close()
  })

  it('reports a missing terminal session on retry', () => {
    const { runner } = createRunner()
    expect(() => runner.retry('definitely-missing')).toThrow(/Terminal session not found/i)
  })

  it('preserves the specific retry diagnostic for invalid stored env', () => {
    const { db, runner } = createRunner()
    const envelope = JSON.stringify({
      version: 2,
      retry: {
        command: { version: 1, segments: [{ type: 'literal', value: 'echo' }], bindings: {} },
        env: 'not-an-object'
      }
    })
    db.prepare(
      `insert into terminal_sessions
        (id, task_id, node_id, kind, command, cwd, status, transcript, created_at, updated_at, request_json)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      'sess-env', 'task-1', 'node-1', 'non-interactive', 'echo', process.cwd(),
      'completed', '', new Date().toISOString(), new Date().toISOString(), envelope
    )

    expect(() => runner.retry('sess-env')).toThrow(/Terminal retry environment is invalid/i)
    db.close()
  })

  it('preserves the specific retry diagnostic for invalid stored params', () => {
    const { db, runner } = createRunner()
    const envelope = JSON.stringify({
      version: 2,
      retry: {
        command: { version: 1, segments: [{ type: 'literal', value: 'echo' }], bindings: {} },
        timeoutMs: -1
      }
    })
    db.prepare(
      `insert into terminal_sessions
        (id, task_id, node_id, kind, command, cwd, status, transcript, created_at, updated_at, request_json)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      'sess-params', 'task-1', 'node-1', 'non-interactive', 'echo', process.cwd(),
      'completed', '', new Date().toISOString(), new Date().toISOString(), envelope
    )

    expect(() => runner.retry('sess-params')).toThrow(/Terminal retry parameters are invalid/i)
    db.close()
  })
})

describe('ProcessRunner PTY execution', () => {
  it('runs a non-interactive command in a real PTY and preserves its exit code', async () => {
    const { db, runner } = createRunner()

    const result = await runner.run({
      taskId: 'task-1',
      nodeId: 'node-1',
      kind: 'non-interactive',
      command: 'printf pty-ok; exit 7',
      cwd: process.cwd()
    })

    expect(result).toMatchObject({
      stdout: expect.stringContaining('pty-ok'),
      stderr: '',
      exitCode: 7,
      status: 'closed'
    })
    const session = db
      .prepare('select kind, status, transcript from terminal_sessions limit 1')
      .get() as { kind: string; status: string; transcript: string }
    expect(session).toMatchObject({
      kind: 'non-interactive',
      status: 'closed',
      transcript: expect.stringContaining('pty-ok')
    })
    db.close()
  })

  it('passes shell metacharacters as literal bound values instead of executing them', async () => {
    const { db, runner, send } = createRunner(true)
    const prompt = '`printf backtick-executed` $(printf dollar-executed) "$HOME" \'quoted\'\nnext line'
    const template = "printf '%s' \"${prompt}\""
    const bound = bindShellCommand(template, { prompt })
    const displayCommand = interpolate(template, { prompt })

    const result = await runner.run({
      taskId: 'task-safe-values',
      nodeId: 'node-safe-values',
      kind: 'non-interactive',
      command: bound,
      displayCommand,
      cwd: process.cwd(),
    })

    expect(result.exitCode).toBe(0)
    expect(result.stdout.replace(/\r/g, '')).toBe(prompt)
    expect(result.stdout).not.toContain('backtick-executed dollar-executed')
    expect(send).toHaveBeenCalledWith('terminal:created', expect.objectContaining({
      command: displayCommand,
      transcript: `$ ${displayCommand}\n`
    }))
    const session = db.prepare(
      'select command, transcript, request_json from terminal_sessions limit 1'
    ).get() as { command: string; transcript: string; request_json: string }
    expect(session.command).toBe(renderShellCommand(bound, 'posix'))
    expect(session.transcript.startsWith(`$ ${displayCommand}\n`)).toBe(true)
    expect(JSON.parse(session.request_json)).toMatchObject({
      version: 3,
      retry: { command: bound, displayCommand },
      diagnostic: { family: 'posix' }
    })
    db.close()
  })

  it('shows the interpolated command when an interactive shell echoes the safe binding', async () => {
    const { db, runner } = createRunner()
    const prompt = 'actual $(printf injected) value'
    const template = "printf '%s' \"${prompt}\"; exit"
    const bound = bindShellCommand(template, { prompt })
    const displayCommand = interpolate(template, { prompt })

    const result = await runner.run({
      taskId: 'task-interactive-display',
      nodeId: 'node-interactive-display',
      kind: 'interactive',
      command: bound,
      displayCommand,
      cwd: process.cwd(),
    })

    expect(result.exitCode).toBe(0)
    expect(result.stdout.replace(/\r/g, '')).toContain(prompt)
    expect(result.stdout).toContain(renderShellCommand(bound, 'posix'))
    const session = db.prepare(
      'select transcript from terminal_sessions limit 1'
    ).get() as { transcript: string }
    expect(session.transcript).toContain(displayCommand)
    expect(session.transcript).not.toContain('CLILOOM_INTERNAL_VALUE_0')
    db.close()
  })

  it('retries a closed terminal in place with its stored launch configuration', async () => {
    const { db, runner, send } = createRunner(true)
    const first = await runner.run({
      taskId: 'task-retry',
      nodeId: 'node-retry',
      kind: 'non-interactive',
      command: 'printf "$RETRY_VALUE"',
      cwd: process.cwd(),
      env: { RETRY_VALUE: 'configured-output' },
      timeoutMs: 5000
    })
    db.prepare('update terminal_sessions set transcript = ? where id = ?')
      .run('stale-output', first.sessionId)

    expect(runner.getRetryTarget(first.sessionId)).toEqual({
      sessionId: first.sessionId,
      taskId: 'task-retry',
      nodeId: 'node-retry'
    })
    const retried = runner.retry(first.sessionId)

    expect(retried).toMatchObject({
      sessionId: first.sessionId,
      taskId: 'task-retry',
      nodeId: 'node-retry'
    })
    expect(send).toHaveBeenCalledWith('terminal:restarted', expect.objectContaining({
      id: first.sessionId,
      status: 'running',
      transcript: '$ printf "$RETRY_VALUE"\n'
    }))
    await expect(retried.result).resolves.toMatchObject({
      sessionId: first.sessionId,
      stdout: expect.stringContaining('configured-output'),
      exitCode: 0
    })
    await vi.waitFor(() => {
      const row = db.prepare(
        'select status, transcript, request_json from terminal_sessions where id = ?'
      ).get(first.sessionId) as { status: string; transcript: string; request_json: string }
      expect(row.status).toBe('closed')
      expect(row.transcript).toContain('configured-output')
      expect(row.transcript).not.toContain('stale-output')
      expect(JSON.parse(row.request_json)).toMatchObject({
        version: 3,
        retry: {
          command: {
            version: 1,
            segments: [{ type: 'literal', value: 'printf "$RETRY_VALUE"' }],
            bindings: {}
          },
          env: { RETRY_VALUE: 'configured-output' },
          timeoutMs: 5000
        },
        diagnostic: { family: 'posix' }
      })
    })
    expect(
      (db.prepare('select count(*) as count from terminal_sessions').get() as { count: number }).count
    ).toBe(1)
    db.close()
  })

  it('rejects retrying the same live terminal session', async () => {
    const { db, runner } = createRunner()
    const running = runner.run({
      taskId: 'task-live',
      nodeId: 'node-live',
      kind: 'non-interactive',
      command: 'sleep 60',
      cwd: process.cwd()
    })
    const row = db.prepare('select id from terminal_sessions').get() as { id: string }

    expect(() => runner.retry(row.id)).toThrow('The terminal is still running and cannot be retried')

    await expect(runner.kill(row.id)).resolves.toBe(true)
    await running
    db.close()
  })

  it('allows an ended session to retry while another session for the same node is live', async () => {
    const { db, runner } = createRunner()
    const ended = await runner.run({
      taskId: 'task-parallel',
      nodeId: 'node-shared',
      kind: 'non-interactive',
      command: 'printf retry-ok',
      cwd: process.cwd()
    })
    const liveResult = runner.run({
      taskId: 'task-parallel',
      nodeId: 'node-shared',
      kind: 'non-interactive',
      command: 'sleep 60',
      cwd: process.cwd()
    })
    const liveRow = db.prepare(
      'select id from terminal_sessions where id <> ?'
    ).get(ended.sessionId) as { id: string }

    const retried = runner.retry(ended.sessionId)
    expect(retried.sessionId).toBe(ended.sessionId)
    expect(runner.hasLiveSession(liveRow.id)).toBe(true)

    await expect(retried.result).resolves.toMatchObject({ exitCode: 0 })
    const retriedRow = db.prepare('select status from terminal_sessions where id = ?')
      .get(ended.sessionId) as { status: string }
    expect(retriedRow.status).toBe('closed')
    await expect(runner.kill(liveRow.id)).resolves.toBe(true)
    await liveResult
    db.close()
  })
})
