import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page
} from 'playwright/test'

type CspViolation = {
  blockedUri: string
  directive: string
}

type WindowWithCspProbe = Window & typeof globalThis & {
  __cliloomCspViolations?: CspViolation[]
}

const failures: string[] = []
let appDataDirectory = ''
let assistantPage: Page
let electronApp: ElectronApplication
let mainPage: Page

test.skip(process.platform !== 'linux', 'The production-entry smoke runs on the Linux validation job')

function monitorPage(page: Page) {
  page.on('pageerror', (error) => failures.push(`page error: ${error.message}`))
  page.on('console', (message) => {
    if (
      message.type() === 'error' &&
      /Content Security Policy|Refused to (?:load|execute|apply|connect)/i.test(message.text())
    ) {
      failures.push(`console: ${message.text()}`)
    }
  })
}

async function assertRenderedWithoutCspViolations(page: Page) {
  await page.locator('#root > *').first().waitFor()
  await expect(page.locator('#root')).not.toHaveText('')
  expect(await page.evaluate(() => (
    (window as WindowWithCspProbe).__cliloomCspViolations ?? []
  ))).toEqual([])
}

test.beforeAll(async () => {
  const projectRoot = path.join(__dirname, '..')
  appDataDirectory = mkdtempSync(path.join(tmpdir(), 'cliloom-production-e2e-'))
  electronApp = await electron.launch({
    args: [projectRoot],
    cwd: projectRoot,
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL: '',
      XDG_CONFIG_HOME: appDataDirectory
    }
  })
  const context = electronApp.context()
  await context.addInitScript(() => {
    const target = window as WindowWithCspProbe
    target.__cliloomCspViolations = []
    document.addEventListener('securitypolicyviolation', (event) => {
      target.__cliloomCspViolations?.push({
        blockedUri: event.blockedURI,
        directive: event.effectiveDirective
      })
    })
  })
  mainPage = await electronApp.firstWindow()
  electronApp.on('window', monitorPage)
})

test.afterAll(async () => {
  await electronApp?.close()
  if (appDataDirectory) rmSync(appDataDirectory, { recursive: true, force: true })
})

test('loads both real production renderer entries without CSP violations', async () => {
  monitorPage(mainPage)
  failures.splice(0)
  await mainPage.reload({ waitUntil: 'domcontentloaded' })
  await assertRenderedWithoutCspViolations(mainPage)
  expect(mainPage.url()).toMatch(/\/dist\/renderer\/index\.html$/)

  const assistantPromise = electronApp.waitForEvent('window')
  await mainPage.evaluate(async () => {
    if (!window.cliLoom) throw new Error('Missing main preload API')
    await window.cliLoom.openAssistant()
  })
  assistantPage = await assistantPromise
  await assertRenderedWithoutCspViolations(assistantPage)
  expect(assistantPage.url()).toMatch(/\/dist\/renderer\/assistant\.html$/)
  expect(failures).toEqual([])
})
