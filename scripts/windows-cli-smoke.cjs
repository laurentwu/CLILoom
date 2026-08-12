'use strict'

const { spawn, spawnSync } = require('node:child_process')
const { randomBytes } = require('node:crypto')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const {
  WINDOWS_ASSISTANT_CLI_EXECUTABLE,
  WINDOWS_CONSOLE_SUBSYSTEM,
  WINDOWS_GUI_SUBSYSTEM,
  assertPeSubsystem
} = require('./build-windows-console-launcher.cjs')

const PROJECT_ROOT = path.resolve(__dirname, '..')
const PROCESS_TIMEOUT_MS = 30_000
const MAX_OUTPUT_BYTES = 256 * 1024
const BRIDGE_PORT_ENV = 'CLILOOM_ASSISTANT_BRIDGE_PORT'
const BRIDGE_TOKEN_ENV = 'CLILOOM_ASSISTANT_BRIDGE_TOKEN'
const FORWARDING_PROBE = 'argument with spaces "quoted" and trailing\\'

function parseArguments(argv) {
  let packaged = false
  let includeWsl = false
  for (const argument of argv) {
    if (argument === '--packaged') packaged = true
    else if (argument === '--wsl') includeWsl = true
    else throw new Error('Usage: node scripts/windows-cli-smoke.cjs [--packaged] [--wsl]')
  }
  return { packaged, includeWsl }
}

function findPackagedApplicationDirectory() {
  const releaseDirectory = path.join(PROJECT_ROOT, 'release')
  const candidates = fs.readdirSync(releaseDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^win(?:-.+)?-unpacked$/i.test(entry.name))
    .map((entry) => path.join(releaseDirectory, entry.name))
    .filter((directory) => (
      fs.existsSync(path.join(directory, 'CLILoom.exe')) &&
      fs.existsSync(path.join(directory, WINDOWS_ASSISTANT_CLI_EXECUTABLE))
    ))
  if (candidates.length !== 1) {
    throw new Error(`Expected one unpacked Windows application, found ${candidates.length}`)
  }
  return candidates[0]
}

function resolveRuntime(packaged) {
  if (packaged) {
    const appDirectory = findPackagedApplicationDirectory()
    return {
      consoleExecutable: path.join(appDirectory, WINDOWS_ASSISTANT_CLI_EXECUTABLE),
      electronExecutable: path.join(appDirectory, 'CLILoom.exe'),
      electronArguments: ['--cliloom-cli']
    }
  }
  const electronExecutable = require('electron')
  if (typeof electronExecutable !== 'string') {
    throw new Error('The development Electron executable could not be resolved')
  }
  return {
    consoleExecutable: path.join(PROJECT_ROOT, 'dist', 'native', WINDOWS_ASSISTANT_CLI_EXECUTABLE),
    electronExecutable,
    electronArguments: [PROJECT_ROOT, '--cliloom-cli']
  }
}

function quotePowerShell(value) {
  return `'${value.replaceAll("'", "''")}'`
}

function mergeWslEnv(current, names) {
  const requested = new Set(names.map((name) => name.toLowerCase()))
  const existing = (current ?? '').split(':').filter(Boolean).filter((entry) => {
    const name = entry.split('/')[0]
    return !requested.has(name.toLowerCase())
  })
  return [...existing, ...names].join(':')
}

function runBoundedProcess(executable, args, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      env: environment,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const stdout = []
    const stderr = []
    let outputBytes = 0
    let settled = false
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      callback(value)
    }
    const append = (target, chunk) => {
      outputBytes += chunk.length
      if (outputBytes > MAX_OUTPUT_BYTES) {
        terminateProcessTree(child.pid)
        finish(reject, new Error('Windows CLI smoke output exceeded its limit'))
        return
      }
      target.push(Buffer.from(chunk))
    }
    child.stdout.on('data', (chunk) => append(stdout, chunk))
    child.stderr.on('data', (chunk) => append(stderr, chunk))
    child.once('error', (error) => finish(reject, error))
    child.once('exit', (exitCode, signal) => finish(resolve, {
      exitCode,
      signal,
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8')
    }))
    const timer = setTimeout(() => {
      terminateProcessTree(child.pid)
      finish(reject, new Error(`Windows CLI smoke timed out after ${PROCESS_TIMEOUT_MS} ms`))
    }, PROCESS_TIMEOUT_MS)
  })
}

function terminateProcessTree(pid) {
  if (!pid) return
  spawnSync('taskkill.exe', ['/pid', String(pid), '/t', '/f'], {
    windowsHide: true,
    stdio: 'ignore'
  })
}

async function withTimeout(promise, message) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), PROCESS_TIMEOUT_MS)
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function resolveWslPath(value, distributionName) {
  const distributionArguments = distributionName
    ? ['--distribution', distributionName]
    : []
  const result = spawnSync('wsl.exe', [
    ...distributionArguments,
    '--exec', 'wslpath', '-a', '-u', value
  ], {
    encoding: 'utf8',
    windowsHide: true
  })
  if (result.error) throw result.error
  if (result.status !== 0 || !result.stdout.trim()) {
    throw new Error(`Unable to map a Windows CLI smoke path into WSL: ${result.stderr.trim()}`)
  }
  return result.stdout.trim()
}

async function startFakeBridge(expectedToken) {
  let resolveRequest
  let rejectRequest
  const request = new Promise((resolve, reject) => {
    resolveRequest = resolve
    rejectRequest = reject
  })
  const server = http.createServer((incoming, response) => {
    const chunks = []
    let size = 0
    incoming.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_OUTPUT_BYTES) {
        incoming.destroy(new Error('Bridge request exceeded the smoke limit'))
        return
      }
      chunks.push(Buffer.from(chunk))
    })
    incoming.on('error', rejectRequest)
    incoming.on('end', () => {
      try {
        if (incoming.url !== '/v1/command' || incoming.method !== 'POST') {
          throw new Error(`Unexpected bridge request: ${incoming.method} ${incoming.url}`)
        }
        if (incoming.headers.authorization !== `Bearer ${expectedToken}`) {
          throw new Error('Windows CLI smoke bridge authorization mismatch')
        }
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        resolveRequest(parsed)
        const body = JSON.stringify({
          version: 1,
          ok: true,
          exitCode: 0,
          data: { accepted: true },
          text: 'bridge-stdin-ok'
        })
        response.writeHead(200, {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body)
        })
        response.end(body)
      } catch (error) {
        rejectRequest(error)
        response.writeHead(500)
        response.end()
      }
    })
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Fake bridge did not bind a TCP port')
  return {
    port: address.port,
    request,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    })
  }
}

async function runPipeSmoke(mode, runtime, inputPath, expectedWorkflow) {
  const token = randomBytes(24).toString('hex')
  const bridge = await startFakeBridge(token)
  const environment = {
    ...process.env,
    [BRIDGE_PORT_ENV]: String(bridge.port),
    [BRIDGE_TOKEN_ENV]: token
  }
  let processResult
  try {
    const commandArguments = [
      runtime.consoleExecutable,
      runtime.electronExecutable,
      ...runtime.electronArguments,
      'workflow',
      'validate',
      '--stdin',
      FORWARDING_PROBE
    ]
    if (mode === 'powershell') {
      const systemRoot = process.env.SystemRoot ?? process.env.WINDIR
      if (!systemRoot) throw new Error('SystemRoot is unavailable')
      const powershell = path.join(
        systemRoot,
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe'
      )
      const invocation = commandArguments.map(quotePowerShell).join(' ')
      const script = [
        '$utf8 = [System.Text.UTF8Encoding]::new($false)',
        '$OutputEncoding = $utf8',
        '[Console]::OutputEncoding = $utf8',
        `Get-Content -LiteralPath ${quotePowerShell(inputPath)} -Raw -Encoding UTF8 | & ${invocation}`,
        'exit $LASTEXITCODE'
      ].join('; ')
      processResult = await runBoundedProcess(powershell, [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy', 'Bypass',
        '-Command', script
      ], environment)
    } else {
      const distributionName = process.env.CLILOOM_WSL_DISTRO
      const distributionArguments = distributionName
        ? ['--distribution', distributionName]
        : []
      const linuxInputPath = resolveWslPath(inputPath, distributionName)
      const linuxConsoleExecutable = resolveWslPath(runtime.consoleExecutable, distributionName)
      const wslCommandArguments = [
        linuxConsoleExecutable,
        runtime.electronExecutable,
        ...runtime.electronArguments,
        'workflow',
        'validate',
        '--stdin',
        FORWARDING_PROBE
      ]
      const positionalInvocation = wslCommandArguments
        .map((_argument, index) => `"$${index + 2}"`)
        .join(' ')
      environment.WSLENV = mergeWslEnv(environment.WSLENV, [
        BRIDGE_PORT_ENV,
        BRIDGE_TOKEN_ENV
      ])
      processResult = await runBoundedProcess('wsl.exe', [
        ...distributionArguments,
        '--exec', '/bin/sh', '-c',
        `cat "$1" | ${positionalInvocation}`,
        'cliloom-cli-smoke',
        linuxInputPath,
        ...wslCommandArguments
      ], environment)
    }

    const received = await withTimeout(
      bridge.request,
      `${mode} CLI pipe did not reach the bridge`
    )
    if (processResult.exitCode !== 0 || processResult.signal) {
      throw new Error(
        `${mode} CLI pipe failed (code=${processResult.exitCode}, signal=${processResult.signal})\n` +
          `${processResult.stdout}${processResult.stderr}`
      )
    }
    if (!processResult.stdout.includes('bridge-stdin-ok')) {
      throw new Error(`${mode} CLI pipe did not print the bridge response: ${processResult.stdout}`)
    }
    if (
      received.version !== 1 ||
      received.command !== 'workflow' ||
      JSON.stringify(received.args) !== JSON.stringify([
        'validate',
        '--stdin',
        FORWARDING_PROBE
      ])
    ) {
      throw new Error(`${mode} CLI pipe sent an unexpected command: ${JSON.stringify(received)}`)
    }
    let parsedInput
    try {
      parsedInput = JSON.parse(received.stdin)
    } catch (error) {
      throw new Error(`${mode} CLI pipe sent invalid or empty stdin: ${String(error)}`)
    }
    if (JSON.stringify(parsedInput) !== JSON.stringify(expectedWorkflow)) {
      throw new Error(`${mode} CLI pipe changed the workflow JSON`)
    }
    if (processResult.stdout.includes(token) || processResult.stderr.includes(token)) {
      throw new Error(`${mode} CLI pipe exposed the bridge token`)
    }
    process.stdout.write(`${mode} pipeline stdin: OK\n`)
  } finally {
    await bridge.close()
  }
}

async function main() {
  if (process.platform !== 'win32') {
    process.stdout.write(
      `SKIP: Windows Console CLI smoke requires real Windows; no pipeline behavior was validated on ${process.platform}.\n`
    )
    return
  }
  const options = parseArguments(process.argv.slice(2))
  const runtime = resolveRuntime(options.packaged)
  assertPeSubsystem(
    runtime.consoleExecutable,
    WINDOWS_CONSOLE_SUBSYSTEM,
    WINDOWS_ASSISTANT_CLI_EXECUTABLE
  )
  assertPeSubsystem(runtime.electronExecutable, WINDOWS_GUI_SUBSYSTEM, 'CLILoom Electron runtime')

  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'cliloom-cli-smoke-'))
  const inputPath = path.join(temporaryDirectory, 'workflow-管道.json')
  const workflow = {
    id: 'console-stdin-smoke',
    name: 'PowerShell 与 WSL 😀',
    description: 'multiline\nUnicode stdin',
    nodes: [
      { id: 'start', type: 'start', name: '开始', config: { variables: [] } },
      { id: 'end', type: 'end', name: '结束', config: {} }
    ],
    edges: [{ id: 'start-to-end', from: 'start', to: 'end' }]
  }
  fs.writeFileSync(inputPath, JSON.stringify(workflow, null, 2), 'utf8')
  try {
    await runPipeSmoke('powershell', runtime, inputPath, workflow)
    if (options.includeWsl) await runPipeSmoke('wsl', runtime, inputPath, workflow)
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true })
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
})
