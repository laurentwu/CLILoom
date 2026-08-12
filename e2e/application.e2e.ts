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

test('keeps the narrow column dividers draggable', async () => {
  await mainPage.bringToFront()
  const shell = mainPage.locator('.app-shell')
  const resizers = [
    {
      selector: '.app-shell__project-resizer',
      widthProperty: '--project-rail-width'
    },
    {
      selector: '.app-shell__task-resizer',
      widthProperty: '--task-sidebar-width'
    }
  ]

  for (const { selector, widthProperty } of resizers) {
    const resizer = mainPage.locator(selector)
    await expect(resizer).toBeVisible()
    const bounds = await resizer.boundingBox()
    expect(bounds).not.toBeNull()
    if (!bounds) throw new Error(`Missing bounds for ${selector}`)
    expect(bounds.width).toBe(2)

    const initialWidth = await shell.evaluate((element, property) => (
      Number.parseFloat(getComputedStyle(element).getPropertyValue(property))
    ), widthProperty)
    const dragStart = {
      x: bounds.x + bounds.width + 1,
      y: bounds.y + bounds.height / 2
    }
    const hitTarget = await mainPage.evaluate(({ x, y, targetSelector }) => (
      document.elementFromPoint(x, y)?.closest(targetSelector) !== null
    ), { ...dragStart, targetSelector: selector })
    expect(hitTarget).toBe(true)

    await mainPage.mouse.move(dragStart.x, dragStart.y)
    await mainPage.mouse.down()
    await mainPage.mouse.move(dragStart.x + 8, dragStart.y)
    await mainPage.mouse.up()

    await expect.poll(() => shell.evaluate((element, property) => (
      Number.parseFloat(getComputedStyle(element).getPropertyValue(property))
    ), widthProperty)).toBe(initialWidth + 8)
  }
})

test('keeps settings menu rows on one line within the window', async () => {
  await mainPage.bringToFront()
  const settingsTrigger = mainPage.locator('.project-rail button[aria-haspopup="menu"]').last()
  await settingsTrigger.click()

  const settingsMenu = mainPage.locator('[data-slot="dropdown-menu-content"][data-state="open"]')
  await assertSingleLineMenu(settingsMenu)

  const shellTrigger = settingsMenu
    .locator('[data-slot="dropdown-menu-sub-trigger"]')
    .filter({ hasText: 'Default terminal environment' })
  await shellTrigger.hover()
  const shellMenu = mainPage.locator('[data-slot="dropdown-menu-sub-content"][data-state="open"]')
  await assertSingleLineMenu(shellMenu)

  await mainPage.keyboard.press('Escape')
})

async function assertSingleLineMenu(menu: ReturnType<Page['locator']>) {
  await expect(menu).toBeVisible()
  const rows = menu.locator([
    '[data-slot="dropdown-menu-item"]',
    '[data-slot="dropdown-menu-label"]',
    '[data-slot="dropdown-menu-radio-item"]',
    '[data-slot="dropdown-menu-sub-trigger"]'
  ].join(','))
  expect(await rows.count()).toBeGreaterThan(0)

  const measurements = await rows.evaluateAll((elements) => elements.map((element) => ({
    height: element.getBoundingClientRect().height,
    text: element.textContent?.trim() ?? '',
    whiteSpace: getComputedStyle(element).whiteSpace
  })))
  expect(measurements.filter((row) => row.whiteSpace !== 'nowrap')).toEqual([])
  expect(measurements.filter((row) => row.height > 32)).toEqual([])

  const bounds = await menu.boundingBox()
  const viewportWidth = await mainPage.evaluate(() => window.innerWidth)
  expect(bounds).not.toBeNull()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewportWidth)
}
