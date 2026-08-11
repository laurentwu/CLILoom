import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from 'playwright/test'

let appDataDirectory = ''
let electronApp: ElectronApplication
let originalClipboard = ''
let page: Page

async function readSystemClipboard() {
  return electronApp.evaluate(({ clipboard }) => clipboard.readText())
}

async function writeSystemClipboard(text: string) {
  await electronApp.evaluate(({ clipboard }, value) => clipboard.writeText(value), text)
}

async function openTerminalMenu() {
  await page.locator('.xterm-screen').click({ button: 'right', position: { x: 80, y: 80 } })
  await expect(page.getByRole('menu')).toBeVisible()
}

async function copyTerminalContent() {
  await openTerminalMenu()
  await page.getByRole('menuitem', { name: 'Copy', exact: true }).click()
  await expect.poll(readSystemClipboard).not.toBe('')
  return readSystemClipboard()
}

test.beforeAll(async () => {
  appDataDirectory = mkdtempSync(path.join(tmpdir(), 'cliloom-terminal-e2e-'))
  electronApp = await electron.launch({
    args: [
      path.join(__dirname, 'electron-main.cjs'),
      `--user-data-dir=${appDataDirectory}`
    ],
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      CLILOOM_E2E_URL: 'http://127.0.0.1:41731/e2e/terminal.html'
    }
  })
  page = await electronApp.firstWindow()
  originalClipboard = await readSystemClipboard()
})

test.afterAll(async () => {
  await writeSystemClipboard(originalClipboard)
  await electronApp.close()
  if (appDataDirectory) rmSync(appDataDirectory, { recursive: true, force: true })
})

test.beforeEach(async () => {
  await page.reload()
  await page.locator('.xterm-helper-textarea').waitFor()
  await writeSystemClipboard('')
})

test('copies the real scrolled xterm buffer and restores keyboard focus', async () => {
  const textarea = page.locator('.xterm-helper-textarea')
  await textarea.focus()
  await openTerminalMenu()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')

  await expect.poll(readSystemClipboard).toContain('# Terminal E2E')
  const copied = await readSystemClipboard()
  expect(copied).toContain('history-01')
  expect(copied).toContain('history-36')
  expect(copied).toContain('中文与 emoji 👩‍💻🙂')
  expect(copied).not.toContain('\u001b[')
  await expect(textarea).toBeFocused()
})

test('reads the real system clipboard and sends paste through xterm onData', async () => {
  const pasted = 'printf "粘贴🙂"\r'
  await writeSystemClipboard(pasted)
  await openTerminalMenu()
  await page.getByRole('menuitem', { name: 'Paste', exact: true }).click()

  await expect(page.getByTestId('sent-input')).toHaveText(pasted)
  await expect(page.locator('.xterm-helper-textarea')).toBeFocused()
})

test('edits and copies Markdown in a trapped dialog, blocks links, and reopens a fresh snapshot', async () => {
  await openTerminalMenu()
  await page.getByRole('menuitem', { name: 'Show in rich text editor' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('heading', { name: 'Terminal E2E' })).toBeVisible()
  await expect(page.locator('[data-slot="dialog-overlay"]')).toBeVisible()
  expect(await dialog.evaluate((element) => Number(getComputedStyle(element).zIndex))).toBeGreaterThanOrEqual(50)
  const codeEditor = dialog.locator('.cm-editor').first()
  await expect(codeEditor).toBeVisible()
  const codeBackground = await codeEditor.evaluate((element) => getComputedStyle(element).backgroundColor)
  expect(codeBackground).not.toBe('rgb(255, 255, 255)')
  expect(codeBackground).not.toBe('rgba(0, 0, 0, 0)')

  for (let index = 0; index < 12; index += 1) {
    await page.keyboard.press('Tab')
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true)
  }

  const originalUrl = page.url()
  await dialog.getByRole('link', { name: '文档链接' }).click()
  expect(page.url()).toBe(originalUrl)

  await dialog.getByRole('radio', { name: 'Markdown source' }).click()
  const editor = dialog.locator('.mdxeditor-source-editor .cm-content')
  await expect(editor).toBeVisible()
  await editor.click()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.type('## Edited in Electron')
  await dialog.getByRole('button', { name: 'Copy Markdown' }).click()
  await expect.poll(readSystemClipboard).toContain('## Edited in Electron')

  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page.locator('.xterm-helper-textarea')).toBeFocused()

  await openTerminalMenu()
  await page.getByRole('menuitem', { name: 'Show in rich text editor' }).click()
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Terminal E2E' })).toBeVisible()
  await expect(page.getByRole('dialog')).not.toContainText('Edited in Electron')
})

test('preserves logical lines after real reflow and isolates the alternate buffer', async () => {
  await page.getByTestId('toggle-width').click()
  await expect(page.getByTestId('terminal-shell')).toHaveCSS('width', '320px')
  const copiedAfterResize = await copyTerminalContent()
  expect(copiedAfterResize).toContain(
    'REFLOW-SENTINEL ' + 'markdown-terminal-content '.repeat(12).trimEnd()
  )

  await page.getByTestId('enter-alternate').click()
  await expect.poll(copyTerminalContent).toContain('# Alternate Buffer')
  const alternate = await readSystemClipboard()
  expect(alternate).toContain('中文🙂')
  expect(alternate).not.toContain('# Terminal E2E')
  expect(alternate).not.toContain('history-01')
})

test('keeps the same live xterm and receives output while its React view is detached', async () => {
  const marker = 'same-live-xterm'
  await page.locator('.xterm').evaluate((element, value) => {
    ;(element as HTMLElement).dataset.instanceMarker = value
  }, marker)

  await page.getByTestId('toggle-mounted').click()
  await expect(page.locator('.xterm')).toHaveCount(0)
  await page.getByTestId('emit-detached').click()
  await page.getByTestId('toggle-mounted').click()

  const terminal = page.locator('.xterm')
  await expect(terminal).toHaveAttribute('data-instance-marker', marker)
  await expect.poll(copyTerminalContent).toContain('DETACHED-OUTPUT-SENTINEL')
})

test('renders an inset xterm 6 vertical scrollbar that scrolls and keeps copy working', async () => {
  const scrollbar = page.locator('.xterm-host .xterm-scrollable-element > .scrollbar.vertical')
  const slider = page.locator('.xterm-host .xterm-scrollable-element > .scrollbar.vertical > .slider')
  const overviewRuler = page.locator('.xterm-host .xterm-decoration-overview-ruler')
  await expect(scrollbar).toHaveCSS('width', '12px')
  await expect(slider).toHaveCSS('width', '6px')
  await expect(overviewRuler).toHaveCount(1)

  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  }))
  const rulerState = await overviewRuler.evaluate((element) => {
    const canvas = element as HTMLCanvasElement
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Expected overview ruler canvas context')
    const borderAlpha = context.getImageData(0, Math.floor(canvas.height / 2), 1, 1).data[3]
    return { borderAlpha, width: getComputedStyle(canvas).width }
  })
  expect(rulerState).toEqual({ borderAlpha: 0, width: '12px' })

  const terminalGeometry = await page.locator('.xterm-host').evaluate((host) => {
    const screen = host.querySelector<HTMLElement>('.xterm-screen')
    const verticalScrollbar = host.querySelector<HTMLElement>('.scrollbar.vertical')
    const verticalSlider = verticalScrollbar?.querySelector<HTMLElement>('.slider')
    if (!screen || !verticalScrollbar || !verticalSlider) {
      throw new Error('Expected terminal geometry elements')
    }
    return {
      screenRight: screen.getBoundingClientRect().right,
      scrollbarLeft: verticalScrollbar.getBoundingClientRect().left,
      scrollbarRight: verticalScrollbar.getBoundingClientRect().right,
      sliderLeft: verticalSlider.getBoundingClientRect().left,
      sliderRight: verticalSlider.getBoundingClientRect().right
    }
  })
  expect(terminalGeometry.screenRight).toBeLessThanOrEqual(terminalGeometry.scrollbarLeft)
  expect(terminalGeometry.sliderLeft).toBeGreaterThanOrEqual(terminalGeometry.screenRight + 6)
  expect(terminalGeometry.sliderRight).toBe(terminalGeometry.scrollbarRight)

  // The legacy .xterm-viewport still has overflow-y: scroll in xterm 6's own
  // CSS; scrolling has moved to .xterm-scrollable-element, so the viewport must
  // not reserve a native scrollbar gutter beside the themed div slider.
  const viewport = page.locator('.xterm-host .xterm-viewport')
  expect(await viewport.evaluate((element) => {
    const target = element as HTMLElement
    return target.offsetWidth - target.clientWidth
  })).toBe(0)

  // Verify the slider opacity was reduced below the old 20% baseline so that
  // the scrollbar remains visually unobtrusive over terminal text.
  const sliderAlpha = await slider.evaluate((element) => {
    const bg = getComputedStyle(element).backgroundColor
    const match = bg.match(/[\d.]+(?=\))/)
    return match ? Number.parseFloat(match[0]) : 1
  })
  expect(sliderAlpha).toBeLessThan(0.18)
  expect(sliderAlpha).toBeGreaterThan(0)

  const initialTop = await slider.evaluate((element) => element.getBoundingClientRect().top)

  await page.locator('.xterm-screen').hover()
  for (let index = 0; index < 24; index += 1) {
    await page.mouse.wheel(0, -1000)
  }

  await expect.poll(
    async () => slider.evaluate((element) => element.getBoundingClientRect().top),
    { timeout: 5000 }
  ).not.toBe(initialTop)

  const copied = await copyTerminalContent()
  expect(copied).toContain('# Terminal E2E')
})

test('reserves a stable safe area for plain-text terminal scrollbars', async () => {
  const shortOutput = page.getByTestId('plain-output-short').locator('.terminal-output')
  const overflowingOutput = page.getByTestId('plain-output-overflowing').locator('.terminal-output')
  await shortOutput.waitFor()
  await overflowingOutput.scrollIntoViewIfNeeded()

  const readGeometry = (selector: string) => page.locator(selector).evaluate((element) => {
    const target = element as HTMLElement
    const computed = getComputedStyle(target)
    const rect = target.getBoundingClientRect()
    const paddingInlineEnd = Number.parseFloat(computed.paddingInlineEnd)
    const paddingInlineStart = Number.parseFloat(computed.paddingInlineStart)
    const contentRight = rect.left + target.clientLeft + target.clientWidth - paddingInlineEnd
    return {
      extraPadding: paddingInlineEnd - paddingInlineStart,
      clientHeight: target.clientHeight,
      clientWidth: target.clientWidth,
      safeGap: rect.right - 6 - contentRight,
      scrollHeight: target.scrollHeight,
      scrollbarGutter: computed.scrollbarGutter
    }
  })
  const shortGeometry = await readGeometry('[data-testid="plain-output-short"] .terminal-output')
  const overflowingGeometry = await readGeometry('[data-testid="plain-output-overflowing"] .terminal-output')

  expect(overflowingGeometry.scrollHeight).toBeGreaterThan(overflowingGeometry.clientHeight)
  expect(shortGeometry.scrollbarGutter).toBe('stable')
  expect(overflowingGeometry.scrollbarGutter).toBe('stable')
  expect(overflowingGeometry.clientWidth).toBe(shortGeometry.clientWidth)
  expect(shortGeometry.extraPadding).toBe(10)
  expect(overflowingGeometry.extraPadding).toBe(10)
  expect(overflowingGeometry.safeGap).toBeGreaterThanOrEqual(10)
})
