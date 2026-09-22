'use strict'

// Unified entry for Playwright Electron E2E tests.
//
// Linux runs always get their own isolated D-Bus session via
// `dbus-run-session` so Electron's D-Bus diagnostics never pollute the CLI
// stderr contract, regardless of an inherited stale DBUS_SESSION_BUS_ADDRESS.
// When no X display is configured the session additionally wraps `xvfb-run`.
// Missing wrappers are hard failures: the suite never silently falls back to
// a D-Bus-less run.

const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

class E2eToolUnavailableError extends Error {
  constructor(tool, hint) {
    super(
      `Playwright Electron E2E tests require \`${tool}\` on this platform, but it was not found on PATH.` +
        (hint ? ` ${hint}` : '')
    )
    this.name = 'E2eToolUnavailableError'
    this.tool = tool
  }
}

function findExecutableOnPath(executable, env) {
  const pathValue = env && typeof env.PATH === 'string' ? env.PATH : ''
  for (const directory of pathValue.split(path.delimiter)) {
    if (!directory) continue
    const candidate = path.join(directory, executable)
    try {
      fs.accessSync(candidate, fs.constants.X_OK)
      return candidate
    } catch {
      // Try the next PATH entry.
    }
  }
  return null
}

function resolvePlaywrightCliPath(resolve = require.resolve) {
  return path.join(path.dirname(resolve('playwright/package.json')), 'cli.js')
}

// Builds the exact spawn description for one E2E invocation:
//
//   Linux, DISPLAY missing/empty:
//     dbus-run-session -- xvfb-run -a <node> <playwright-cli> test <args...>
//   Linux, DISPLAY set:
//     dbus-run-session -- <node> <playwright-cli> test <args...>
//   macOS / Windows:
//     <node> <playwright-cli> test <args...>
//
// Arguments are passed as an array; no shell string is ever assembled.
function buildE2eLaunchPlan(options = {}) {
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  const nodeExecutable = options.nodeExecutable ?? process.execPath
  const innerArgs = [
    options.cliPath ?? resolvePlaywrightCliPath(),
    'test',
    ...(options.forwardedArgs ?? [])
  ]

  if (platform !== 'linux') {
    return { executable: nodeExecutable, args: innerArgs }
  }

  const dbusRunSession = findExecutableOnPath('dbus-run-session', env)
  if (!dbusRunSession) {
    throw new E2eToolUnavailableError(
      'dbus-run-session',
      'Install the dbus-daemon package (for example `sudo apt-get install --no-install-recommends dbus-daemon`) and retry.'
    )
  }

  const display = typeof env.DISPLAY === 'string' ? env.DISPLAY : ''
  if (display) {
    return { executable: dbusRunSession, args: ['--', nodeExecutable, ...innerArgs] }
  }

  const xvfbRun = findExecutableOnPath('xvfb-run', env)
  if (!xvfbRun) {
    throw new E2eToolUnavailableError(
      'xvfb-run',
      'Install the xvfb package (for example `sudo apt-get install --no-install-recommends xvfb`) and retry.'
    )
  }
  return {
    executable: dbusRunSession,
    args: ['--', xvfbRun, '-a', nodeExecutable, ...innerArgs]
  }
}

const FORWARDED_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP']

// Runs one E2E invocation, forwarding termination signals and propagating the
// child's exit code or signal. Resolves with { code, signal } once the whole
// wrapped process chain (D-Bus daemon, Xvfb) has been reaped by its wrapper.
function runE2eLaunch(plan, options = {}) {
  const env = options.env ?? process.env
  const grouped = process.platform !== 'win32'
  const child = spawn(plan.executable, plan.args, {
    env,
    detached: grouped,
    stdio: options.stdio ?? 'inherit'
  })

  const terminate = (signal) => {
    try {
      if (grouped && child.pid) process.kill(-child.pid, signal)
      else child.kill(signal)
    } catch (error) {
      if (error.code !== 'ESRCH') throw error
    }
  }

  const signalHandlers = new Map()
  const installSignalHandlers = () => {
    for (const signal of FORWARDED_SIGNALS) {
      const handler = () => {
        try {
          terminate(signal)
        } catch {
          // The child may already be gone; its exit still decides our status.
        }
      }
      signalHandlers.set(signal, handler)
      process.on(signal, handler)
    }
  }
  const removeSignalHandlers = () => {
    for (const [signal, handler] of signalHandlers.entries()) {
      process.removeListener(signal, handler)
    }
    signalHandlers.clear()
  }

  installSignalHandlers()

  const done = new Promise((resolve) => {
    child.on('error', (error) => {
      removeSignalHandlers()
      // The D-Bus daemon and Xvfb inherit the child's stdio; destroy piped
      // streams so lingering inherited descriptors cannot hold the event loop.
      for (const stream of [child.stdout, child.stderr]) stream?.destroy()
      resolve({ code: 1, signal: null, error })
    })
    child.on('exit', (code, signal) => {
      removeSignalHandlers()
      // Reap descendants still in our private group even when the outer
      // wrapper was terminated directly rather than through our handler.
      if (grouped) terminate('SIGTERM')
      for (const stream of [child.stdout, child.stderr]) stream?.destroy()
      resolve({ code, signal })
    })
  })

  return { child, done }
}

async function runE2eTests(options = {}) {
  const plan = buildE2eLaunchPlan(options)
  const { done } = runE2eLaunch(plan, {
    ...options,
    env: {
      ...(options.env ?? process.env),
      CLILOOM_E2E_ISOLATED_BUS: (options.platform ?? process.platform) === 'linux' ? '1' : ''
    }
  })
  const result = await done
  if (result.error) {
    console.error(
      `[playwright-electron] failed to start ${plan.executable}: ${result.error.message}`
    )
    return 1
  }
  if (result.signal) {
    process.kill(process.pid, result.signal)
    return 128
  }
  return result.code ?? 1
}

module.exports = {
  E2eToolUnavailableError,
  buildE2eLaunchPlan,
  findExecutableOnPath,
  resolvePlaywrightCliPath,
  runE2eLaunch,
  runE2eTests
}

if (require.main === module) {
  void runE2eTests({
    platform: process.platform,
    env: process.env,
    nodeExecutable: process.execPath,
    forwardedArgs: process.argv.slice(2)
  }).then((code) => {
    process.exitCode = code
  }).catch((error) => {
    console.error(`[playwright-electron] ${error.message}`)
    process.exitCode = 1
  })
}
