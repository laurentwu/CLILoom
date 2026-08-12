import {
  existsSync,
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable, Writable } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ASSISTANT_BRIDGE_PORT_ENV,
  ASSISTANT_BRIDGE_TOKEN_ENV
} from '../shared/assistant'
import {
  isWslExecutionTarget,
  type DetectedShell,
  type ShellFamily,
  type ShellNeutralCommand
} from '../shared/shell'
import { openDatabase, type AppDatabase } from './database'
import { ProcessRunner } from './processRunner'
import { CMD_MAX_COMMAND_CHARS, getCmdCommandLineLength } from './shellExecution'
import { SettingsService } from './settingsService'
import { ShellService } from './shellService'
import { ensureAssistantWorkspace } from './assistantWorkspace'
import { startAssistantCommandBridge } from './assistantCommandBridge'
import { runAssistantCliMode } from './assistantCli'
import { AssistantTerminalService } from './assistantTerminalService'

type NativeContext = {
  directory: string
  workingDirectory: string
  db: AppDatabase
  runner: ProcessRunner
  settings: SettingsService
  shells: ShellService
}

const contexts: NativeContext[] = []

afterEach(async () => {
  for (const context of contexts.splice(0)) {
    await context.runner.killAll()
    context.db.close()
    rmSync(context.directory, { recursive: true, force: true })
  }
})

function createNativeContext(): NativeContext {
  const directory = mkdtempSync(path.join(tmpdir(), 'cliloom-shell-smoke-'))
  const workingDirectory = path.join(directory, '工作 空间-😀')
  mkdirSync(workingDirectory)
  const db = openDatabase(directory)
  const settings = new SettingsService(db, process.env)
  const shells = new ShellService({ settingsService: settings, environment: process.env })
  const runner = new ProcessRunner(db, () => null, process.env, shells)
  const context = { directory, workingDirectory, db, runner, settings, shells }
  contexts.push(context)
  return context
}

function printBoundValue(family: ShellFamily, value: string): ShellNeutralCommand {
  const binding = 'CLILOOM_INTERNAL_VALUE_0'
  if (family === 'powershell') {
    return {
      version: 1,
      segments: [
        { type: 'literal', value: 'Write-Output "__START__' },
        { type: 'binding', name: binding },
        { type: 'literal', value: '__END__"' }
      ],
      bindings: { [binding]: value }
    }
  }
  if (family === 'cmd') {
    return {
      version: 1,
      segments: [
        { type: 'literal', value: 'echo(__START__' },
        { type: 'binding', name: binding },
        { type: 'literal', value: '__END__' }
      ],
      bindings: { [binding]: value }
    }
  }
  return {
    version: 1,
    segments: [
      { type: 'literal', value: "printf '__START__%s__END__' \"" },
      { type: 'binding', name: binding },
      { type: 'literal', value: '"' }
    ],
    bindings: { [binding]: value }
  }
}

function interactiveExitCommand(family: ShellFamily): string {
  if (family === 'powershell') return "Write-Output 'interactive-中文-😀'; exit 0"
  if (family === 'cmd') return 'echo interactive-中文-😀 & exit'
  return "printf 'interactive-中文-😀'; exit 0"
}

function longRunningCommand(family: ShellFamily): string {
  if (family === 'powershell') return 'Start-Sleep -Seconds 60'
  if (family === 'cmd') return 'ping -n 60 127.0.0.1 >nul'
  return 'sleep 60'
}

function runExecutableCommand(
  family: ShellFamily,
  executablePath: string,
  scriptPath: string
): ShellNeutralCommand {
  const executableBinding = 'CLILOOM_INTERNAL_VALUE_0'
  const scriptBinding = 'CLILOOM_INTERNAL_VALUE_1'
  return {
    version: 1,
    segments: [
      { type: 'literal', value: family === 'powershell' ? '& "' : '"' },
      { type: 'binding', name: executableBinding },
      { type: 'literal', value: '" "' },
      { type: 'binding', name: scriptBinding },
      { type: 'literal', value: '"' }
    ],
    bindings: {
      [executableBinding]: executablePath,
      [scriptBinding]: scriptPath
    }
  }
}

async function waitUntil(
  predicate: () => boolean,
  label: string,
  timeoutMs = 5_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise<void>((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`${label} timed out`)
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

function newestSessionId(db: AppDatabase): string {
  return (db.prepare(
    'select id from terminal_sessions order by rowid desc limit 1'
  ).get() as { id: string }).id
}

async function withTimeout<T>(promise: Promise<T>, label: string, timeoutMs = 15_000): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs)
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

describe('native shell smoke', () => {
  it('detects the platform default and persists another detected selection across service restart', () => {
    const { shells, settings } = createNativeContext()
    const snapshot = shells.getSnapshot()
    const effective = shells.resolveEffectiveShell()

    expect(snapshot.candidates.length).toBeGreaterThan(0)
    expect(snapshot.effectiveShell?.id).toBe(effective.id)
    expect(statSync(effective.executablePath).isFile()).toBe(true)

    const alternate = snapshot.candidates.find((candidate) => candidate.id !== effective.id)
    if (alternate) {
      shells.select(alternate.id)
      const restarted = new ShellService({ settingsService: settings, environment: process.env })
      expect(restarted.resolveEffectiveShell().id).toBe(alternate.id)
      restarted.select('automatic')
    }
  })

  it('runs Unicode bindings, hooks and an interactive PTY through the same real shell', async () => {
    const { db, runner, shells, workingDirectory } = createNativeContext()
    const shell = shells.resolveEffectiveShell()
    const value = 'Unicode 中文 😀 & | < > ^ % ! " \' ( ) $()'
    const command = printBoundValue(shell.family, value)

    const nonInteractive = await withTimeout(runner.run({
      taskId: 'native-terminal',
      nodeId: 'non-interactive',
      kind: 'non-interactive',
      command,
      displayCommand: `print ${value}`,
      cwd: workingDirectory
    }), 'non-interactive shell smoke')

    expect(nonInteractive.exitCode).toBe(0)
    expect(nonInteractive.stdout).toContain(`__START__${value}__END__`)
    const stored = db.prepare(
      'select request_json from terminal_sessions where id = ?'
    ).get(nonInteractive.sessionId) as { request_json: string }
    expect(JSON.parse(stored.request_json)).toMatchObject({
      version: 3,
      diagnostic: {
        targetId: shell.id,
        kind: 'native',
        family: shell.family,
        executablePath: shell.executablePath
      }
    })

    const hookValue = 'Hook 中文 😀 & | % !'
    const hook = await withTimeout(runner.runHook({
      taskId: 'native-hook',
      nodeId: 'hook',
      hookType: 'start',
      command: printBoundValue(shell.family, hookValue),
      cwd: workingDirectory
    }), 'hook shell smoke')
    expect(hook).toMatchObject({ status: 'completed', exitCode: 0 })
    expect(hook.stdout).toContain(`__START__${hookValue}__END__`)

    const interactivePromise = runner.run({
      taskId: 'native-interactive',
      nodeId: 'interactive',
      kind: 'interactive',
      command: interactiveExitCommand(shell.family),
      cwd: workingDirectory,
      cols: 90,
      rows: 24
    })
    const interactiveSessionId = newestSessionId(db)
    await waitUntil(
      () => runner.isInputReady(interactiveSessionId),
      'interactive terminal readiness'
    )
    expect(runner.isInputReady(interactiveSessionId)).toBe(true)
    expect(runner.resize(interactiveSessionId, 110, 32)).toBe(true)
    try {
      const interactive = await withTimeout(interactivePromise, 'interactive shell smoke')
      expect(interactive.exitCode).toBe(0)
      expect(interactive.stdout).toContain('interactive-中文-😀')
    } finally {
      if (runner.hasLiveSession(interactiveSessionId)) await runner.kill(interactiveSessionId)
    }
  }, 30_000)

  it('waits for manual stop and timeout process-tree cleanup', async () => {
    const { db, runner, shells, workingDirectory } = createNativeContext()
    const shell = shells.resolveEffectiveShell()
    const command = longRunningCommand(shell.family)

    const manuallyStopped = runner.run({
      taskId: 'native-stop',
      nodeId: 'manual-stop',
      kind: 'non-interactive',
      command,
      cwd: workingDirectory
    })
    const stoppedSessionId = newestSessionId(db)
    await expect(runner.kill(stoppedSessionId)).resolves.toBe(true)
    await expect(manuallyStopped).resolves.toMatchObject({ status: 'killed', exitCode: null })
    expect(runner.hasLiveSession(stoppedSessionId)).toBe(false)

    const timedOut = await withTimeout(runner.run({
      taskId: 'native-timeout',
      nodeId: 'timeout',
      kind: 'non-interactive',
      command,
      cwd: workingDirectory,
      timeoutMs: 100
    }), 'timeout cleanup smoke')
    expect(timedOut).toMatchObject({ status: 'failed', exitCode: -1 })
    expect(timedOut.stderr).toContain('timed out after 100 ms')
  }, 30_000)

  it('terminates an observable descendant process, not only the PTY shell', async () => {
    const { db, runner, shells, workingDirectory } = createNativeContext()
    const shell = shells.resolveEffectiveShell()
    const childScript = path.join(workingDirectory, 'descendant-child.cjs')
    const parentScript = path.join(workingDirectory, 'descendant-parent.cjs')
    const pidFile = path.join(workingDirectory, 'descendant.pid')
    writeFileSync(childScript, 'setInterval(() => undefined, 1000)\n')
    writeFileSync(parentScript, [
      "const { spawn } = require('node:child_process')",
      "const { writeFileSync } = require('node:fs')",
      `const child = spawn(process.execPath, [${JSON.stringify(childScript)}], { stdio: 'ignore' })`,
      `writeFileSync(${JSON.stringify(pidFile)}, String(child.pid))`,
      'setInterval(() => undefined, 1000)'
    ].join('\n'))

    const running = runner.run({
      taskId: 'native-descendant-tree',
      nodeId: 'parent',
      kind: 'non-interactive',
      command: runExecutableCommand(shell.family, process.execPath, parentScript),
      cwd: workingDirectory
    })
    const sessionId = newestSessionId(db)
    await waitUntil(() => existsSync(pidFile), 'descendant PID creation')
    const descendantPid = Number(readFileSync(pidFile, 'utf8'))
    expect(descendantPid).toBeGreaterThan(0)
    expect(processExists(descendantPid)).toBe(true)

    await expect(runner.kill(sessionId)).resolves.toBe(true)
    await expect(running).resolves.toMatchObject({ status: 'killed' })
    await waitUntil(() => !processExists(descendantPid), 'descendant termination')
  }, 30_000)

  it('creates the private launcher and reaches a real assistant command bridge', async () => {
    const { workingDirectory } = createNativeContext()
    const workspace = ensureAssistantWorkspace({
      userDataPath: workingDirectory,
      executablePath: process.execPath,
      appVersion: '0.1.0',
      buildId: `sha256:${'a'.repeat(64)}`
    })
    const launcher = process.platform === 'win32'
      ? workspace.windowsLauncherPath
      : workspace.launcherPath
    expect(statSync(launcher).isFile()).toBe(true)

    const bridge = await startAssistantCommandBridge({
      handle: async (request: { command: string }) => ({
        data: { command: request.command },
        text: `bridge-ok:${request.command}`
      })
    } as never)
    let stdout = ''
    let stderr = ''
    const output = new Writable({
      write(chunk, _encoding, callback) {
        stdout += chunk.toString()
        callback()
      }
    })
    const errorOutput = new Writable({
      write(chunk, _encoding, callback) {
        stderr += chunk.toString()
        callback()
      }
    })

    try {
      const exitCode = await runAssistantCliMode(['doctor'], {
        ...process.env,
        [ASSISTANT_BRIDGE_PORT_ENV]: String(bridge.port),
        [ASSISTANT_BRIDGE_TOKEN_ENV]: bridge.token
      }, {
        stdin: Readable.from([]),
        stdout: output,
        stderr: errorOutput
      })
      expect(exitCode).toBe(0)
      expect(stdout).toBe('bridge-ok:doctor\n')
      expect(stderr).toBe('')
      expect(stdout).not.toContain(bridge.token)
    } finally {
      await bridge.close()
    }
  }, 30_000)

  it('reaches the bridge through the selected Shell, assistant service, and private launcher', async () => {
    const { directory, shells, workingDirectory } = createNativeContext()
    const appEntryPath = path.join(workingDirectory, 'assistant-smoke-entry.cjs')
    writeFileSync(appEntryPath, [
      "const http = require('node:http')",
      "const marker = process.argv.indexOf('--cliloom-cli')",
      "const args = marker >= 0 ? process.argv.slice(marker + 1) : []",
      'const payload = JSON.stringify({ version: 1, command: args[0] || \'help\', args: args.slice(1) })',
      'const request = http.request({',
      "  hostname: '127.0.0.1',",
      '  port: Number(process.env.CLILOOM_ASSISTANT_BRIDGE_PORT),',
      "  path: '/v1/command',",
      "  method: 'POST',",
      '  headers: {',
      "    authorization: 'Bearer ' + process.env.CLILOOM_ASSISTANT_BRIDGE_TOKEN,",
      "    'content-type': 'application/json',",
      "    'content-length': Buffer.byteLength(payload)",
      '  }',
      '}, (response) => {',
      "  let body = ''",
      "  response.setEncoding('utf8')",
      "  response.on('data', (chunk) => { body += chunk })",
      "  response.on('end', () => {",
      '    const parsed = JSON.parse(body)',
      "    if (parsed.ok) process.stdout.write((parsed.text || '') + '\\n')",
      "    else process.stderr.write((parsed.error && parsed.error.message || 'bridge failed') + '\\n')",
      '  })',
      '})',
      "request.on('error', (error) => { process.stderr.write(error.message + '\\n') })",
      'request.end(payload)'
    ].join('\n'))
    const workspace = ensureAssistantWorkspace({
      userDataPath: directory,
      executablePath: process.execPath,
      appEntryPath,
      appVersion: '0.1.0',
      buildId: `sha256:${'a'.repeat(64)}`
    })
    const fakeAssistant = path.join(
      workingDirectory,
      process.platform === 'win32' ? 'smoke-assistant.cmd' : 'smoke-assistant'
    )
    if (process.platform === 'win32') {
      writeFileSync(fakeAssistant, [
        '@echo off',
        'if "%~1"=="--version" (echo smoke-assistant 1.0& exit /b 0)',
        'cliloom doctor'
      ].join('\r\n'))
    } else {
      writeFileSync(fakeAssistant, [
        '#!/bin/sh',
        '[ "$1" = "--version" ] && { echo "smoke-assistant 1.0"; exit 0; }',
        'exec cliloom doctor'
      ].join('\n'))
      chmodSync(fakeAssistant, 0o700)
    }
    const terminalService = new AssistantTerminalService({
      workspace,
      environment: process.env,
      commandHandler: {
        handle: async (request: { command: string }) => ({
          data: { command: request.command },
          text: `launcher-bridge-ok:${request.command}`
        })
      } as never,
      shellService: shells
    })

    await terminalService.start(`"${fakeAssistant}"`)
    await waitUntil(
      () => terminalService.getStatus().state === 'exited',
      'assistant launcher completion',
      15_000
    )

    expect(terminalService.getTranscript()).toContain('launcher-bridge-ok:doctor')
    expect(terminalService.getTranscript()).not.toContain('CLILOOM_ASSISTANT_BRIDGE_TOKEN')
    await terminalService.close()
  }, 30_000)

  it.runIf(process.platform === 'win32')(
    'executes the native cmd delayed-binding character matrix',
    async () => {
      const { runner, shells, workingDirectory } = createNativeContext()
      const cmd = shells.getSnapshot().candidates.find((candidate): candidate is DetectedShell => (
        !isWslExecutionTarget(candidate) && candidate.family === 'cmd'
      ))
      expect(cmd, 'cmd.exe must be detected on Windows').toBeDefined()
      shells.select(cmd!.id)
      const values = [
        '',
        '&',
        '|',
        '<',
        '>',
        '^',
        '%',
        '!',
        'paired !bang! value',
        '"',
        "'",
        '(',
        ')',
        '中文 😀',
        '& | < > ^ % ! " \' ( )',
        'repeated & | repeated & |'
      ]

      for (const [index, value] of values.entries()) {
        const result = await withTimeout(runner.run({
          taskId: 'native-cmd-matrix',
          nodeId: `value-${index}`,
          kind: 'non-interactive',
          command: printBoundValue('cmd', value),
          cwd: workingDirectory
        }), `cmd value ${index}`)
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain(`__START__${value}__END__`)
      }

      const maximumRenderedLength = CMD_MAX_COMMAND_CHARS - getCmdCommandLineLength(cmd!, 0)
      const acceptedBoundary = `rem ${'x'.repeat(maximumRenderedLength - 4)}`
      const accepted = await runner.run({
        taskId: 'native-cmd-boundary',
        nodeId: 'accepted-boundary',
        kind: 'non-interactive',
        command: acceptedBoundary,
        cwd: workingDirectory
      })
      expect(accepted).toMatchObject({ status: 'closed', exitCode: 0 })

      const rejected: Array<{ name: string; command: string | ShellNeutralCommand; message: string }> = [
        { name: 'literal-bang', command: 'echo literal!', message: '命令模板不能包含 !' },
        {
          name: 'binding-newline',
          command: printBoundValue('cmd', 'line 1\r\nline 2'),
          message: '变量值不能包含换行'
        },
        {
          name: 'binding-carriage-return',
          command: printBoundValue('cmd', 'line 1\rline 2'),
          message: '变量值不能包含换行'
        },
        {
          name: 'percent-expansion',
          command: 'echo %PATH:~0,5%',
          message: '不能使用 %NAME%'
        },
        {
          name: 'binding-nul',
          command: printBoundValue('cmd', 'before\0after'),
          message: 'NUL'
        },
        {
          name: 'command-length',
          command: `${acceptedBoundary}x`,
          message: '命令展开后超过'
        }
      ]
      for (const item of rejected) {
        const result = await runner.run({
          taskId: 'native-cmd-rejections',
          nodeId: item.name,
          kind: 'non-interactive',
          command: item.command,
          cwd: workingDirectory
        })
        expect(result).toMatchObject({ status: 'failed', exitCode: -1 })
        expect(result.stderr).toContain(item.message)
      }
    },
    60_000
  )

  it.runIf(process.platform === 'win32')(
    'executes Unicode bindings and hooks through native Git Bash when installed',
    async () => {
      const { runner, shells, workingDirectory } = createNativeContext()
      const gitBash = shells.getSnapshot().candidates.find((candidate) => (
        candidate.family === 'posix' && candidate.displayName === 'Git Bash'
      ))
      if (!gitBash) return
      shells.select(gitBash.id)

      const terminalValue = 'Git Bash 中文 😀 & | < > ^ % ! " \' ( )'
      const terminal = await withTimeout(runner.run({
        taskId: 'native-git-bash',
        nodeId: 'terminal',
        kind: 'non-interactive',
        command: printBoundValue('posix', terminalValue),
        cwd: workingDirectory
      }), 'Git Bash terminal smoke')
      expect(terminal.exitCode).toBe(0)
      expect(terminal.stdout).toContain(`__START__${terminalValue}__END__`)

      const hookValue = 'Git Bash Hook 中文 😀 & | % !'
      const hook = await withTimeout(runner.runHook({
        taskId: 'native-git-bash',
        nodeId: 'hook',
        hookType: 'start',
        command: printBoundValue('posix', hookValue),
        cwd: workingDirectory
      }), 'Git Bash hook smoke')
      expect(hook).toMatchObject({ status: 'completed', exitCode: 0 })
      expect(hook.stdout).toContain(`__START__${hookValue}__END__`)
    },
    30_000
  )
})
