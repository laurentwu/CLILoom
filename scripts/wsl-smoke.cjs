const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')

const MARKER_TIMEOUT_MS = 15_000
const EXIT_TIMEOUT_MS = 10_000
const MAX_OUTPUT_CHARS = 256 * 1024

function waitForOutput(child, pattern) {
  return new Promise((resolve, reject) => {
    let output = ''
    let settled = false
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      callback(value)
    }
    const inspect = (chunk) => {
      output += chunk.toString('utf8')
      if (output.length > MAX_OUTPUT_CHARS) {
        finish(reject, new Error('WSL smoke output exceeded its limit'))
        return
      }
      const match = output.match(pattern)
      if (match) finish(resolve, { match, output })
    }
    child.stdout.on('data', inspect)
    child.stderr.on('data', inspect)
    child.once('error', (error) => finish(reject, error))
    child.once('exit', (code, signal) => {
      finish(reject, new Error(
        `WSL smoke process exited before its marker (code=${code}, signal=${signal}).\n${output}`
      ))
    })
    const timer = setTimeout(() => {
      finish(reject, new Error(`Timed out waiting for WSL smoke marker.\n${output}`))
    }, MARKER_TIMEOUT_MS)
  })
}

function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true)
  return Promise.race([
    new Promise((resolve) => child.once('exit', () => resolve(true))),
    new Promise((resolve) => setTimeout(() => resolve(false), EXIT_TIMEOUT_MS))
  ])
}

function waitForValue(read, description, timeoutMs = MARKER_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now()
    const inspect = () => {
      try {
        const value = read()
        if (value) {
          resolve(value)
          return
        }
      } catch (error) {
        reject(error)
        return
      }
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error(`Timed out waiting for ${description}`))
        return
      }
      setTimeout(inspect, 50)
    }
    inspect()
  })
}

function runWithElectronNode() {
  return new Promise((resolve, reject) => {
    const electron = require('electron')
    const child = spawn(electron, [__filename], {
      stdio: 'inherit',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      windowsHide: true
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`Electron WSL smoke runtime exited with signal ${signal}`))
        return
      }
      resolve(code ?? 1)
    })
  })
}

function createRunnerDatabase(Database) {
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
  return db
}

async function assertLinuxPidExited(service, target, pid, label) {
  await service.runInTarget(target, [
    '/bin/sh', '-c', '! kill -0 "$1" 2>/dev/null', label, pid
  ])
}

async function runProcessRunnerSmoke(options) {
  const Database = require('better-sqlite3')
  const { ProcessRunner } = require('../dist/main/main/processRunner.js')
  const db = createRunnerDatabase(Database)
  const events = []
  const fakeWindow = {
    webContents: {
      send(channel, payload) {
        events.push({ channel, payload })
      }
    }
  }
  const descriptor = {
    kind: 'wsl',
    id: options.target.id,
    displayName: options.target.displayName,
    family: 'posix',
    distributionName: options.target.distributionName
  }
  const resolver = {
    resolveEffectiveShell() {
      throw new Error('The WSL smoke always supplies an explicit execution target')
    },
    resolveEffectiveTarget: async () => options.target,
    resolveTarget: async (requested) => options.service.resolveTarget(requested),
    resolveTargetPath: async (target, value) => options.service.resolveTargetPath(target, value),
    terminateWslSession: async (handle) => options.service.terminateSession(handle),
    finalizeWslSession: async (handle) => options.service.finalizeSession(handle)
  }
  const runner = new ProcessRunner(
    db,
    () => fakeWindow,
    process.env,
    resolver,
    undefined,
    options.runtimeDirectory,
    'win32'
  )
  const sessionIdForTask = (taskId) => {
    const row = db.prepare(
      'select id from terminal_sessions where task_id = ? order by created_at desc limit 1'
    ).get(taskId)
    assert.ok(row && row.id, `Missing terminal session for ${taskId}`)
    return row.id
  }

  try {
    const appExitTask = `wsl-smoke-app-exit-${randomUUID()}`
    const appExitResult = runner.run({
      taskId: appExitTask,
      nodeId: 'app-exit-node',
      kind: 'non-interactive',
      command: [
        '/usr/bin/env -i PATH=/usr/bin:/bin /usr/bin/setsid /bin/sh -c \'/bin/sleep 120\' >/dev/null 2>&1 &',
        'child=$!',
        'printf \'__CLILOOM_RUNNER_CHILD__%s\\n\' "$child"',
        'wait "$child"'
      ].join('; '),
      cwd: options.targetProject,
      sourceCwd: options.targetProject,
      executionTarget: descriptor
    })
    const appExitSessionId = sessionIdForTask(appExitTask)
    const appExitMarker = await waitForValue(() => {
      const transcript = runner.getLiveTranscript(appExitSessionId, appExitTask) || ''
      return transcript.match(/__CLILOOM_RUNNER_CHILD__(\d+)/)
    }, 'ProcessRunner cgroup child marker')
    assert.ok(await runner.killAll() >= 1, 'ProcessRunner killAll did not clean the active WSL session')
    assert.equal((await appExitResult).status, 'killed')
    await assertLinuxPidExited(
      options.service,
      options.target,
      appExitMarker[1],
      'cliloom-runner-app-exit-check'
    )

    const timeoutTask = `wsl-smoke-timeout-${randomUUID()}`
    const timeoutResultPromise = runner.run({
      taskId: timeoutTask,
      nodeId: 'timeout-node',
      kind: 'non-interactive',
      command: [
        '/usr/bin/env -i PATH=/usr/bin:/bin /usr/bin/setsid /bin/sh -c \'/bin/sleep 120\' >/dev/null 2>&1 &',
        'child=$!',
        'printf \'__CLILOOM_TIMEOUT_CHILD__%s\\n\' "$child"',
        'wait "$child"'
      ].join('; '),
      cwd: options.targetProject,
      sourceCwd: options.targetProject,
      executionTarget: descriptor,
      timeoutMs: 4_000
    })
    const timeoutSessionId = sessionIdForTask(timeoutTask)
    const timeoutMarker = await waitForValue(() => {
      const transcript = runner.getLiveTranscript(timeoutSessionId, timeoutTask) || ''
      return transcript.match(/__CLILOOM_TIMEOUT_CHILD__(\d+)/)
    }, 'ProcessRunner timeout child marker')
    const timeoutResult = await timeoutResultPromise
    assert.equal(timeoutResult.status, 'failed')
    await assertLinuxPidExited(
      options.service,
      options.target,
      timeoutMarker[1],
      'cliloom-runner-timeout-check'
    )

    const hookResult = await runner.runHook({
      taskId: `wsl-smoke-hook-${randomUUID()}`,
      nodeId: 'hook-node',
      hookType: 'start',
      command: 'printf \'__CLILOOM_HOOK__%s\\n\' "$CLILOOM_HOOK_LITERAL"',
      cwd: options.targetProject,
      sourceCwd: options.targetProject,
      executionTarget: descriptor,
      env: { CLILOOM_HOOK_LITERAL: 'literal-${HOME}-中文' }
    })
    assert.equal(hookResult.status, 'completed')
    assert.match(hookResult.stdout, /__CLILOOM_HOOK__literal-\$\{HOME\}-中文/)

    const retryTask = `wsl-smoke-retry-${randomUUID()}`
    const firstRetryRun = runner.run({
      taskId: retryTask,
      nodeId: 'retry-node',
      kind: 'non-interactive',
      command: 'printf \'__CLILOOM_RETRY__\\n\'',
      cwd: options.targetProject,
      sourceCwd: options.targetProject,
      executionTarget: descriptor
    })
    const retrySessionId = sessionIdForTask(retryTask)
    const firstRetryResult = await firstRetryRun
    assert.equal(firstRetryResult.exitCode, 0)
    const retried = runner.retry(retrySessionId)
    const retriedResult = await retried.result
    assert.equal(retriedResult.exitCode, 0)
    assert.match(retriedResult.stdout, /__CLILOOM_RETRY__/)

    const immediateTask = `wsl-smoke-immediate-${randomUUID()}`
    const immediateResultPromise = runner.run({
      taskId: immediateTask,
      nodeId: 'immediate-node',
      kind: 'non-interactive',
      command: '/bin/sleep 120',
      cwd: options.targetProject,
      sourceCwd: options.targetProject,
      executionTarget: descriptor
    })
    const immediateSessionId = sessionIdForTask(immediateTask)
    await waitForValue(() => events.filter(({ channel, payload }) => (
      channel === 'terminal:created' && payload && payload.id === immediateSessionId
    )).length >= 2, 'resolved ProcessRunner launch event')
    assert.equal(await runner.kill(immediateSessionId), true)
    assert.equal((await immediateResultPromise).status, 'killed')
    assert.equal(runner.hasActiveProcesses(), false)
  } finally {
    try {
      await runner.killAll()
    } finally {
      db.close()
    }
  }
}

async function main() {
  if (process.platform !== 'win32') {
    process.stdout.write(
      `SKIP: WSL smoke requires real Windows; no WSL behavior was validated on ${process.platform}.\n`
    )
    return
  }
  if (!process.versions.electron) {
    const exitCode = await runWithElectronNode()
    if (exitCode !== 0) process.exitCode = exitCode
    return
  }

  // build:main runs before this script so the smoke exercises the exact current
  // TypeScript implementation rather than maintaining a second WSL adapter here.
  const {
    WslService
  } = require('../dist/main/main/wslService.js')
  const {
    prepareExecutionInvocation
  } = require('../dist/main/main/executionInvocation.js')
  const {
    createWslTargetId
  } = require('../dist/main/shared/shell.js')
  const {
    quotePosixArg
  } = require('../dist/main/shared/assistant.js')

  const service = new WslService()
  const discovery = await service.discover()
  if (discovery.error && discovery.targets.length === 0) throw new Error(discovery.error)
  assert.ok(discovery.targets.length > 0, 'At least one registered WSL distribution is required')

  const requestedName = process.env.CLILOOM_WSL_DISTRO
  const detected = requestedName
    ? discovery.targets.find((candidate) => (
        candidate.distributionName.toLowerCase() === requestedName.toLowerCase()
      ))
    : discovery.targets.find((candidate) => candidate.isSystemDefault) ?? discovery.targets[0]
  assert.ok(
    detected,
    `CLILOOM_WSL_DISTRO is not registered: ${requestedName}. ` +
      `Detected: ${discovery.targets.map((candidate) => candidate.distributionName).join(', ')}`
  )

  const target = await service.resolveTarget({
    kind: 'wsl',
    id: createWslTargetId(detected.distributionName),
    displayName: detected.displayName,
    family: 'posix',
    distributionName: detected.distributionName
  })

  const windowsProject = process.env.CLILOOM_WSL_PROJECT || process.cwd()
  const targetProject = await service.resolveTargetPath(target, windowsProject)
  await service.assertDirectory(target, targetProject)
  const homeWindowsPath = await service.getHomeWindowsPath(target)
  const homeRoundTrip = await service.canonicalizeWslProjectPath(target, homeWindowsPath)
  assert.equal(homeRoundTrip.targetPath, target.homeDirectory)
  assert.ok(target.userShellPath, 'The WSL login shell PATH probe returned an empty value')
  const windowsCommandPath = await service.resolveTargetPath(
    target,
    path.win32.join(process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows', 'System32', 'cmd.exe')
  )

  // Assistant interop stays Windows-loopback based. A disabled interop setup is
  // therefore a real smoke failure, while CLI lookup is optional and explicit.
  await service.runInTarget(target, [
    'cmd.exe', '/d', '/s', '/c', 'exit 0'
  ], process.env, 8_000)
  if (process.env.CLILOOM_WSL_ASSISTANT_COMMAND) {
    const assistant = await service.resolveAssistantCommand(
      target,
      process.env.CLILOOM_WSL_ASSISTANT_COMMAND
    )
    process.stdout.write(`WSL assistant CLI: ${assistant.executablePath}\n`)
  } else {
    process.stdout.write(
      'SKIP subcheck: set CLILOOM_WSL_ASSISTANT_COMMAND to validate a WSL-native assistant CLI.\n'
    )
  }

  const runtimeDirectory = mkdtempSync(path.join(tmpdir(), 'cliloom-wsl-smoke-'))
  const sessionId = randomUUID()
  const literalValue = `literal-\${HOME}-中文-${sessionId}`
  let child
  let naturalChild
  let crashChild
  let activeSession
  let activeNaturalSession
  let activeCrashSession
  try {
    const invocation = prepareExecutionInvocation({
      target,
      mode: 'non-interactive',
      command: [
        'printf \'__CLILOOM_ENV__%s\\n\' "$CLILOOM_SMOKE_LITERAL"',
        'printf \'__CLILOOM_HELPER_ENV__%s|%s|%s\\n\' "$PATH" "$HOME" "$XDG_RUNTIME_DIR"',
        `${quotePosixArg(windowsCommandPath)} /d /s /c 'echo __CLILOOM_WIN_PATH__%PATH%'`,
        '/usr/bin/env -i PATH=/usr/bin:/bin /usr/bin/setsid /bin/sh -c \'/bin/sleep 120\' >/dev/null 2>&1 &',
        'child=$!',
        'printf \'__CLILOOM_CHILD__%s\\n\' "$child"',
        'wait "$child"'
      ].join('; '),
      targetCwd: targetProject,
      hostCwd: runtimeDirectory,
      sessionId,
      baseEnvironment: process.env,
      requestEnvironment: {
        CLILOOM_SMOKE_LITERAL: literalValue,
        PATH: '/cliloom/user/path',
        HOME: `/tmp/cliloom-user-home-${sessionId}`,
        XDG_RUNTIME_DIR: `/tmp/cliloom-user-runtime-${sessionId}`
      },
      platform: 'win32'
    })
    assert.ok(invocation.wslSession, 'WSL invocation did not expose its cleanup handle')
    activeSession = invocation.wslSession
    assert.ok(!invocation.args.join('\n').includes(literalValue), 'Environment values must not enter argv')
    child = spawn(invocation.executable, invocation.args, {
      cwd: invocation.hostCwd,
      env: invocation.env,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const marker = await waitForOutput(child, /__CLILOOM_CHILD__(\d+)/)
    assert.ok(marker.output.includes(`__CLILOOM_ENV__${literalValue}`), 'Literal WSLENV value mismatch')
    assert.ok(
      marker.output.includes(
        `__CLILOOM_HELPER_ENV__/cliloom/user/path|/tmp/cliloom-user-home-${sessionId}|` +
        `/tmp/cliloom-user-runtime-${sessionId}`
      ),
      'User PATH/HOME/XDG_RUNTIME_DIR overrides did not reach only the login shell'
    )
    const windowsPathMatch = marker.output.match(/__CLILOOM_WIN_PATH__([^\r\n]*)/)
    assert.ok(windowsPathMatch, 'The prepared WSL invocation did not run its Win32 child')
    assert.notEqual(
      windowsPathMatch[1],
      '/cliloom/user/path',
      'The Linux PATH leaked back into the Win32 child through WSLENV'
    )
    assert.ok(
      windowsPathMatch[1].includes(path.win32.delimiter),
      'The Win32 child did not retain a Windows-delimited PATH'
    )
    const linuxPid = marker.match[1]

    const termination = await service.terminateSession(activeSession)
    assert.deepEqual(termination, { terminated: true })
    activeSession = undefined
    assert.equal(await waitForExit(child), true, 'The host wsl.exe proxy did not exit after Linux cleanup')
    await service.runInTarget(target, [
      '/bin/sh', '-c', '! kill -0 "$1" 2>/dev/null', 'cliloom-smoke-check', linuxPid
    ])

    const naturalSessionId = randomUUID()
    const naturalInvocation = prepareExecutionInvocation({
      target,
      mode: 'non-interactive',
      command: [
        'printf \'__CLILOOM_DEFAULT_PATH__%s\\n\' "$PATH"',
        'cmd.exe /d /s /c \'exit 0\'',
        'setsid sh -c \'sleep 120\' >/dev/null 2>&1 &',
        'child=$!',
        'printf \'__CLILOOM_NATURAL_CHILD__%s\\n\' "$child"',
        'exit 7'
      ].join('; '),
      targetCwd: targetProject,
      hostCwd: runtimeDirectory,
      sessionId: naturalSessionId,
      baseEnvironment: process.env,
      platform: 'win32'
    })
    assert.ok(naturalInvocation.wslSession, 'Natural WSL invocation did not expose its cleanup handle')
    activeNaturalSession = naturalInvocation.wslSession
    naturalChild = spawn(naturalInvocation.executable, naturalInvocation.args, {
      cwd: naturalInvocation.hostCwd,
      env: naturalInvocation.env,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const naturalMarker = await waitForOutput(naturalChild, /__CLILOOM_NATURAL_CHILD__(\d+)/)
    const defaultPathMatch = naturalMarker.output.match(/__CLILOOM_DEFAULT_PATH__([^\r\n]*)/)
    assert.ok(defaultPathMatch, 'The default captured WSL PATH did not reach the session')
    const capturedEntries = target.userShellPath.split(':').filter(Boolean)
    const sessionEntries = defaultPathMatch[1].split(':').filter(Boolean)
    const trustedEntries = new Set([
      '/usr/local/sbin', '/usr/local/bin', '/usr/sbin', '/usr/bin', '/sbin', '/bin'
    ])
    const representativeEntry = capturedEntries.find((entry) => !trustedEntries.has(entry))
      || capturedEntries[0]
    assert.ok(
      representativeEntry && sessionEntries.includes(representativeEntry),
      'The session PATH did not contain an entry captured from the login shell'
    )
    assert.equal(await waitForExit(naturalChild), true, 'Natural WSL wrapper exit timed out')
    assert.equal(naturalChild.exitCode, 7, 'The wrapper did not preserve a non-zero user exit code')
    assert.deepEqual(await service.finalizeSession(activeNaturalSession), { terminated: true })
    activeNaturalSession = undefined
    await service.runInTarget(target, [
      '/bin/sh', '-c', '! kill -0 "$1" 2>/dev/null',
      'cliloom-natural-smoke-check', naturalMarker.match[1]
    ])

    const crashSessionId = randomUUID()
    const crashInvocation = prepareExecutionInvocation({
      target,
      mode: 'non-interactive',
      command: [
        '/usr/bin/env -i PATH=/usr/bin:/bin /usr/bin/setsid /bin/sh -c \'/bin/sleep 120\' >/dev/null 2>&1 &',
        'child=$!',
        'printf \'__CLILOOM_CRASH_CHILD__%s\\n\' "$child"',
        'wait "$child"'
      ].join('; '),
      targetCwd: targetProject,
      hostCwd: runtimeDirectory,
      sessionId: crashSessionId,
      baseEnvironment: process.env,
      platform: 'win32'
    })
    assert.ok(crashInvocation.wslSession, 'Crash WSL invocation did not expose its cleanup handle')
    activeCrashSession = crashInvocation.wslSession
    crashChild = spawn(crashInvocation.executable, crashInvocation.args, {
      cwd: crashInvocation.hostCwd,
      env: crashInvocation.env,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const crashMarker = await waitForOutput(crashChild, /__CLILOOM_CRASH_CHILD__(\d+)/)
    await service.runInTarget(target, [
      '/bin/sh', '-c', [
        'set -eu',
        'marker=$1/$2',
        'leader=$(awk -F= \'$1 == "leader" { print $2; exit }\' "$marker")',
        'case "$leader" in \'\'|*[!0-9]*) exit 45 ;; esac',
        'kill -KILL "$leader"'
      ].join('\n'),
      'cliloom-crash-smoke',
      activeCrashSession.sessionDirectory,
      activeCrashSession.sessionId
    ])
    assert.equal(await waitForExit(crashChild), true, 'Crashed WSL host proxy did not exit')
    service.clearCache()
    await service.resolveTarget(descriptor)
    await service.runInTarget(target, [
      '/bin/sh', '-c', [
        '! kill -0 "$1" 2>/dev/null',
        '[ ! -e "$2/$3" ]'
      ].join('\n'),
      'cliloom-crash-recovery-check',
      crashMarker.match[1],
      activeCrashSession.sessionDirectory,
      activeCrashSession.sessionId
    ])
    activeCrashSession = undefined

    await runProcessRunnerSmoke({
      target,
      service,
      targetProject,
      runtimeDirectory
    })
  } finally {
    if (activeSession) {
      const cleanup = await service.terminateSession(activeSession)
      if (!cleanup.terminated) {
        process.stderr.write(`WSL smoke cleanup failed: ${cleanup.error || 'unknown error'}\n`)
      }
    }
    if (activeNaturalSession) {
      const cleanup = await service.terminateSession(activeNaturalSession)
      if (!cleanup.terminated) {
        process.stderr.write(`Natural WSL smoke cleanup failed: ${cleanup.error || 'unknown error'}\n`)
      }
    }
    if (activeCrashSession) {
      const cleanup = await service.terminateSession(activeCrashSession)
      if (!cleanup.terminated) {
        process.stderr.write(`Crash-recovery WSL smoke cleanup failed: ${cleanup.error || 'unknown error'}\n`)
      }
    }
    if (child && child.exitCode === null && child.signalCode === null) child.kill()
    if (naturalChild && naturalChild.exitCode === null && naturalChild.signalCode === null) {
      naturalChild.kill()
    }
    if (crashChild && crashChild.exitCode === null && crashChild.signalCode === null) crashChild.kill()
    rmSync(runtimeDirectory, { recursive: true, force: true })
  }

  process.stdout.write([
    'Windows/WSL smoke passed',
    `distribution=${target.distributionName}`,
    `wslVersion=${target.wslVersion ?? 'unknown'}`,
    `architecture=${process.arch}`,
    `loginShell=${target.loginShellPath}`,
    `windowsProject=${windowsProject}`,
    `targetProject=${targetProject}`
  ].join(' ') + '\n')
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
  process.exitCode = 1
})
