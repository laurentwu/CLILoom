import { expect, type BrowserContext, type Page } from 'playwright/test'

/**
 * Shared CSP monitoring for the production-entry Electron E2E suites.
 *
 * The probe must be proven installed before a "no violations" assertion is
 * accepted: a missing probe flag or violation array fails the check instead of
 * being read as an empty report. Only probe installation, page error
 * collection and the no-violation assertion live here; business flows stay in
 * the E2E files.
 */

export type CspViolation = {
  blockedUri: string
  directive: string
}

export type WindowWithCspProbe = Window & typeof globalThis & {
  __cliloomCspProbeInstalled?: boolean
  __cliloomCspViolations?: CspViolation[]
}

export const cspProbeFailures: string[] = []

export async function installCspProbe(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const target = window as Window & typeof globalThis & {
      __cliloomCspProbeInstalled?: boolean
      __cliloomCspViolations?: Array<{ blockedUri: string; directive: string }>
    }
    target.__cliloomCspProbeInstalled = true
    target.__cliloomCspViolations = []
    document.addEventListener('securitypolicyviolation', (event) => {
      target.__cliloomCspViolations?.push({
        blockedUri: event.blockedURI,
        directive: event.effectiveDirective
      })
    })
  })
}

/**
 * Ensures the currently loaded document carries the probe. Context init
 * scripts only cover future navigations, so an already-loaded first window
 * gets one controlled reload during test setup. Never call this in the middle
 * of business steps to paper over lost events.
 */
export async function ensureCspProbeCoverage(page: Page): Promise<void> {
  const installed = await page.evaluate(() => (
    (window as WindowWithCspProbe).__cliloomCspProbeInstalled === true
  ))
  if (!installed) {
    await page.reload({ waitUntil: 'domcontentloaded' })
  }
}

export function monitorPage(page: Page): () => void {
  const onPageError = (error: Error) => cspProbeFailures.push(`page error: ${error.message}`)
  const onConsole = (message: { type(): string; text(): string }) => {
    if (
      message.type() === 'error' &&
      /Content Security Policy|Refused to (?:load|execute|apply|connect)/i.test(message.text())
    ) {
      cspProbeFailures.push(`console: ${message.text()}`)
    }
  }
  page.on('pageerror', onPageError)
  page.on('console', onConsole)
  return () => {
    page.off('pageerror', onPageError)
    page.off('console', onConsole)
  }
}

export function resetCspProbeFailures(): void {
  cspProbeFailures.splice(0)
}

export async function assertNoCspViolations(page: Page): Promise<void> {
  await page.locator('#root > *').first().waitFor()
  await expect(page.locator('#root')).not.toHaveText('')
  const probeState = await page.evaluate(() => ({
    installed: (window as WindowWithCspProbe).__cliloomCspProbeInstalled === true,
    violations: (window as WindowWithCspProbe).__cliloomCspViolations ?? null
  }))
  expect(probeState.installed, 'CSP probe was not installed for this page').toBe(true)
  expect(probeState.violations, 'CSP probe violation array is missing').not.toBeNull()
  expect(probeState.violations).toEqual([])
  expect(cspProbeFailures, 'CSP or page errors were captured during monitoring').toEqual([])
}
