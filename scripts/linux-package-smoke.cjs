const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const {
  mkdtempSync,
  rmSync,
  statSync
} = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { chromium } = require('playwright')
const {
  getSandboxHelperPath,
  isConfiguredSetuidSandbox
} = require('./linux-sandbox.cjs')

const CSP_ERROR_PATTERN = /Content Security Policy|Refused to (?:load|execute|apply|connect)/i
const STARTUP_TIMEOUT_MS = 30_000

function isAppImagePath(executablePath) {
  return /\.AppImage$/i.test(executablePath)
}

function waitForDevToolsEndpoint(child, logs) {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      callback(value)
    }
    const inspectOutput = (chunk) => {
      const text = chunk.toString()
      logs.push(text)
      const match = logs.join('').match(/DevTools listening on (ws:\/\/\S+)/)
      if (match) finish(resolve, match[1])
    }
    const timer = setTimeout(() => {
      finish(reject, new Error(`Timed out waiting for packaged Electron startup.\n${logs.join('')}`))
    }, STARTUP_TIMEOUT_MS)

    child.stdout.on('data', inspectOutput)
    child.stderr.on('data', inspectOutput)
    child.once('error', (error) => finish(reject, error))
    child.once('exit', (code, signal) => {
      finish(
        reject,
        new Error(`Packaged Electron exited before the smoke test (code=${code}, signal=${signal}).\n${logs.join('')}`)
      )
    })
  })
}

function installPageMonitoring(page, failures) {
  page.on('pageerror', (error) => failures.push(`page error: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error' && CSP_ERROR_PATTERN.test(message.text())) {
      failures.push(`console: ${message.text()}`)
    }
  })
}

async function assertRendered(page, label) {
  await page.locator('#root > *').first().waitFor({ timeout: STARTUP_TIMEOUT_MS })
  const text = await page.locator('#root').innerText()
  assert.ok(text.trim(), `${label} renderer root must not be blank`)
}

async function readSecurityState(page, apiName) {
  return page.evaluate((name) => {
    const api = window[name]
    return {
      hasNodeProcess: typeof window.process !== 'undefined',
      rendererNoSandboxSwitch: api?.rendererNoSandboxSwitch,
      rendererSandboxed: api?.rendererSandboxed
    }
  }, apiName)
}

async function readCspViolations(page) {
  return page.evaluate(() => window.__cliloomCspViolations ?? [])
}

async function terminate(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  const exited = await Promise.race([
    new Promise((resolve) => child.once('exit', () => resolve(true))),
    new Promise((resolve) => setTimeout(() => resolve(false), 10_000))
  ])
  if (!exited) child.kill('SIGKILL')
}

async function main() {
  if (process.platform !== 'linux') {
    throw new Error('The installed-package sandbox smoke test is Linux-only')
  }

  const executableArgument = process.argv[2]
  if (!executableArgument) {
    throw new Error(
      'Usage: npm run test:linux-package -- /absolute/path/to/cliloom-or.AppImage'
    )
  }
  const executablePath = path.resolve(executableArgument)
  const isAppImage = isAppImagePath(executablePath)
  if (isAppImage) {
    const appImageStat = statSync(executablePath)
    assert.ok(appImageStat.isFile(), `AppImage must be a regular file: ${executablePath}`)
    assert.notEqual(
      appImageStat.mode & 0o111,
      0,
      `AppImage must be executable: ${executablePath}`
    )
  } else {
    const helperPath = getSandboxHelperPath(executablePath)
    const helperStat = statSync(helperPath)
    assert.ok(
      isConfiguredSetuidSandbox(helperStat),
      `Installed chrome-sandbox must be a root-owned regular file with mode 4755: ${helperPath} ` +
        `(uid=${helperStat.uid}, mode=${(helperStat.mode & 0o7777).toString(8)})`
    )
  }

  const appDataDirectory = mkdtempSync(path.join(tmpdir(), 'cliloom-linux-package-smoke-'))
  const logs = []
  const failures = []
  const childEnvironment = {
    ...process.env,
    VITE_DEV_SERVER_URL: '',
    XDG_CONFIG_HOME: appDataDirectory
  }
  for (const inheritedAppImageVariable of [
    'APPDIR',
    'APPIMAGE',
    'ARGV0',
    'LD_LIBRARY_PATH',
    'OWD'
  ]) {
    delete childEnvironment[inheritedAppImageVariable]
  }
  const child = spawn(executablePath, [
    '--disable-gpu',
    '--remote-debugging-port=0'
  ], {
    env: childEnvironment,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let browser

  try {
    const devToolsEndpoint = await waitForDevToolsEndpoint(child, logs)
    browser = await chromium.connectOverCDP(devToolsEndpoint)
    const context = browser.contexts()[0]
    assert.ok(context, 'Packaged Electron must expose its default browser context')
    await context.addInitScript(() => {
      window.__cliloomCspViolations = []
      document.addEventListener('securitypolicyviolation', (event) => {
        window.__cliloomCspViolations.push({
          blockedUri: event.blockedURI,
          directive: event.effectiveDirective
        })
      })
    })

    const mainPage = context.pages()[0] ?? await context.waitForEvent('page', {
      timeout: STARTUP_TIMEOUT_MS
    })
    installPageMonitoring(mainPage, failures)
    await mainPage.reload({ waitUntil: 'domcontentloaded' })
    await assertRendered(mainPage, 'Main')
    assert.deepEqual(await readCspViolations(mainPage), [], 'Main renderer must have no CSP violations')
    assert.deepEqual(await readSecurityState(mainPage, 'cliLoom'), {
      hasNodeProcess: false,
      rendererNoSandboxSwitch: false,
      rendererSandboxed: true
    })

    const assistantPagePromise = context.waitForEvent('page', { timeout: STARTUP_TIMEOUT_MS })
    await mainPage.evaluate(async () => {
      if (!window.cliLoom) throw new Error('Missing main preload API')
      await window.cliLoom.openAssistant()
    })
    const assistantPage = await assistantPagePromise
    installPageMonitoring(assistantPage, failures)
    await assertRendered(assistantPage, 'Assistant')
    assert.deepEqual(
      await readCspViolations(assistantPage),
      [],
      'Assistant renderer must have no CSP violations'
    )
    assert.deepEqual(await readSecurityState(assistantPage, 'cliLoomAssistant'), {
      hasNodeProcess: false,
      rendererNoSandboxSwitch: false,
      rendererSandboxed: true
    })
    assert.deepEqual(failures, [], 'Production renderers must have no CSP or page errors')

    const packageKind = isAppImage ? 'AppImage' : 'installed-package'
    process.stdout.write(`Linux ${packageKind} sandbox and production renderer smoke passed\n`)
  } finally {
    if (browser) await browser.close().catch(() => undefined)
    await terminate(child)
    rmSync(appDataDirectory, { recursive: true, force: true })
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
  process.exitCode = 1
})
