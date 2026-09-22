import Database from 'better-sqlite3'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
  type TestInfo
} from 'playwright/test'
import type { ProjectRecord, TaskRecord } from '../src/renderer/appTypes'
import type { WorkflowDefinition } from '../src/shared/workflow'

type CspViolation = {
  blockedUri: string
  directive: string
}

type WindowWithCspProbe = Window & typeof globalThis & {
  __cliloomCspViolations?: CspViolation[]
}

const projectRoot = path.join(__dirname, '..')
const databasePath = (dataDirectory: string) => path.join(dataDirectory, 'CLILoom', 'cliloom.db')

const workflow: WorkflowDefinition = {
  id: 'e2e-auto-retry-workflow',
  name: 'Auto retry workflow',
  nodes: [
    {
      id: 'start',
      type: 'start',
      name: 'Start',
      config: { variables: [{ key: 'title', label: 'Title', type: 'text', required: false }] }
    },
    {
      id: 'cmd',
      type: 'non-interactive-terminal',
      name: 'Flaky command',
      config: {
        command: 'sh -c \'test -f marker && echo recovered || { touch marker; exit 7; }\'',
        cwd: '${sys_project_dir}',
        successExitCodes: [0],
        autoRetry: { enabled: true, mode: 'recommended', maxRetries: 3 }
      }
    },
    { id: 'end', type: 'end', name: 'End', config: {} }
  ],
  edges: [
    { id: 'start-cmd', from: 'start', to: 'cmd' },
    { id: 'cmd-end', from: 'cmd', to: 'end' }
  ]
}

// Controlled fixture: the first execution fails instantly, while automatic
// retries wait for a release marker before failing again, so the running
// state is stable and observable in the UI and the database.
const startedTimeWorkflow: WorkflowDefinition = {
  id: 'e2e-auto-retry-started-workflow',
  name: 'Auto retry start time workflow',
  nodes: [
    {
      id: 'start',
      type: 'start',
      name: 'Start',
      config: { variables: [{ key: 'title', label: 'Title', type: 'text', required: false }] }
    },
    {
      id: 'cmd',
      type: 'non-interactive-terminal',
      name: 'Controlled flaky command',
      config: {
        command: 'sh -c \'exit 7\'',
        retryCommand: 'sh -c \'while [ ! -f release-marker ]; do sleep 0.2; done; exit 9\'',
        cwd: '${sys_project_dir}',
        successExitCodes: [0],
        autoRetry: { enabled: true, mode: 'recommended', maxRetries: 3 }
      }
    },
    { id: 'end', type: 'end', name: 'End', config: {} }
  ],
  edges: [
    { id: 'start-cmd', from: 'start', to: 'cmd' },
    { id: 'cmd-end', from: 'cmd', to: 'end' }
  ]
}

const failures: string[] = []
let appDataDirectory = ''
let projectDirectory = ''
let projectId = ''
let electronApp: ElectronApplication
let mainPage: Page

test.skip(process.platform !== 'linux', 'The automatic retry e2e runs on the Linux validation job')

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

async function launchApplication() {
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
  monitorPage(mainPage)
  await mainPage.locator('#root > *').first().waitFor()
}

function openDatabase(): Database.Database {
  return new Database(databasePath(appDataDirectory), { fileMustExist: true })
}

function readAutoRetry(taskId: string): Record<string, unknown> | null {
  const db = openDatabase()
  try {
    const row = db.prepare(
      'select output_json from node_runs where node_id = ? and run_id = ?'
    ).get('cmd', taskId) as { output_json: string } | undefined
    if (!row?.output_json) return null
    return (JSON.parse(row.output_json) as { autoRetry?: Record<string, unknown> }).autoRetry ?? null
  } finally {
    db.close()
  }
}

/** Controlled e2e fixture: move a persisted waiting plan into the past. */
function forceWaitingPlanDue(taskId: string, offsetMs: number): void {
  const db = openDatabase()
  try {
    const row = db.prepare(
      'select output_json from node_runs where node_id = ? and run_id = ?'
    ).get('cmd', taskId) as { output_json: string } | undefined
    if (!row?.output_json) throw new Error(`No node run for task ${taskId}`)
    const output = JSON.parse(row.output_json) as Record<string, unknown>
    const autoRetry = output.autoRetry as Record<string, unknown> | undefined
    if (!autoRetry || autoRetry.phase !== 'waiting') {
      throw new Error(`Task ${taskId} has no waiting auto retry plan`)
    }
    autoRetry.nextRetryAt = Date.now() - offsetMs
    db.prepare('update node_runs set output_json = ? where run_id = ? and node_id = ?')
      .run(JSON.stringify(output), taskId, 'cmd')
  } finally {
    db.close()
  }
}

test.beforeAll(async () => {
  appDataDirectory = mkdtempSync(path.join(tmpdir(), 'cliloom-auto-retry-data-'))
  const fixtureDirectory = mkdtempSync(path.join(tmpdir(), 'cliloom-auto-retry-projects-'))
  projectDirectory = path.join(fixtureDirectory, 'retry-project')
  mkdirSync(projectDirectory)
})

test.afterAll(async () => {
  await electronApp?.close()
  if (appDataDirectory) rmSync(appDataDirectory, { recursive: true, force: true })
})

async function startTask(
  taskId: string,
  title: string,
  definition: WorkflowDefinition = workflow
): Promise<void> {
  // Every task starts from a failed first execution, so the marker that the
  // flaky command creates must not exist yet.
  rmSync(path.join(projectDirectory, 'marker'), { force: true })
  await mainPage.evaluate(async ({ definition, projectId, taskId, title }) => {
    if (!window.cliLoom) throw new Error('Missing main preload API')
    await window.cliLoom.startWorkflow({
      taskId,
      projectId,
      workflow: definition,
      variables: { title },
      startNodeId: 'start'
    })
  }, { definition, projectId, taskId, title })
  await mainPage.getByRole('button', { name: new RegExp(title) }).first().click()
}

function listTask(taskId: string): Promise<TaskRecord | undefined> {
  return mainPage.evaluate(async ({ projectId, taskId }) => {
    if (!window.cliLoom) throw new Error('Missing main preload API')
    const tasks = (await window.cliLoom.listTasks(projectId)) as TaskRecord[]
    return tasks.find((task) => task.id === taskId)
  }, { projectId, taskId }) as Promise<TaskRecord | undefined>
}

/**
 * Attach a window screenshot. Capture can transiently fail on virtual
 * displays while a frame is pending, so retry a few times before giving up.
 */
async function attachScreenshot(testInfo: TestInfo, name: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await testInfo.attach(name, {
        body: await mainPage.screenshot(),
        contentType: 'image/png'
      })
      return
    } catch (error) {
      if (attempt === 2) throw error
      await mainPage.waitForTimeout(500)
    }
  }
}

/**
 * Register the fixture project for the current test. Standalone runs do the
 * full add-project flow; when an earlier test already registered the same
 * directory the existing record is reused.
 */
async function ensureProjectRegistered(): Promise<string> {
  const existing = await mainPage.evaluate(() => window.cliLoom?.listProjects()) as ProjectRecord[]
  const registered = existing.find((item) => item.path === projectDirectory)
  if (registered) return registered.id

  await electronApp.evaluate(({ dialog }, directory) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [directory]
    })
  }, projectDirectory)
  await mainPage.getByRole('button', { name: 'Add project folder' }).click()
  await expect(
    mainPage.getByRole('button', { name: `Open project ${path.basename(projectDirectory)}` })
  ).toBeVisible()
  const projects = await mainPage.evaluate(() => window.cliLoom?.listProjects()) as ProjectRecord[]
  const project = projects.find((item) => item.path === projectDirectory)
  if (!project) throw new Error('E2E project was not registered')
  return project.id
}

/** Frozen per-run timezone recorded when the task was launched. */
function readAutoRetryTimeZone(taskId: string): string {
  const db = openDatabase()
  try {
    const row = db.prepare(
      'select context_json from workflow_runs where task_id = ? order by updated_at desc limit 1'
    ).get(taskId) as { context_json: string }
    const context = JSON.parse(row.context_json) as { autoRetryContext?: { timeZone?: string } }
    return context.autoRetryContext?.timeZone ?? 'UTC'
  } finally {
    db.close()
  }
}

/** Mirror the banner's locale- and zone-based rendering of a start time. */
function expectedStartTimeText(epochMs: number, timeZone: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(epochMs))
}

test('automatic retries cover scheduling, cancellation and restart recovery', async ({ }, testInfo) => {
  failures.splice(0)
  await launchApplication()

  await electronApp.evaluate(({ dialog }, directory) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [directory]
    })
  }, projectDirectory)
  await mainPage.getByRole('button', { name: 'Add project folder' }).click()
  await expect(
    mainPage.getByRole('button', { name: `Open project ${path.basename(projectDirectory)}` })
  ).toBeVisible()
  const projects = await mainPage.evaluate(() => window.cliLoom?.listProjects()) as ProjectRecord[]
  const project = projects.find((item) => item.path === projectDirectory)
  if (!project) throw new Error('E2E project was not registered')
  projectId = project.id

  await mainPage.evaluate(async (definition) => {
    if (!window.cliLoom) throw new Error('Missing main preload API')
    await window.cliLoom.saveWorkflow(definition)
  }, workflow)

  // A failed terminal node schedules an automatic retry and shows the banner.
  await startTask('e2e-auto-retry-cancelled', 'retry-cancel')
  await expect.poll(async () => (await listTask('e2e-auto-retry-cancelled'))?.status).toBe('failed')
  await expect.poll(async () => readAutoRetry('e2e-auto-retry-cancelled')?.phase).toBe('waiting')
  await expect(mainPage.getByText(/Automatic retry #1 will run at/).first()).toBeVisible()
  await attachScreenshot(testInfo, 'auto-retry-waiting-banner')

  // Cancelling from the banner cancels only this cycle; no retry fires later.
  await mainPage.getByRole('button', { name: 'Cancel automatic retry' }).click()
  await expect.poll(async () => readAutoRetry('e2e-auto-retry-cancelled')?.phase).toBe('cancelled')
  await expect(mainPage.getByText('Automatic retry cancelled').first()).toBeVisible()

  // A stopped task has its waiting plans cancelled in storage and the stale
  // waiting banner is replaced by the blocked outcome in the UI.
  await startTask('e2e-auto-retry-stopped', 'retry-stop')
  await expect.poll(async () => readAutoRetry('e2e-auto-retry-stopped')?.phase).toBe('waiting')
  await mainPage.evaluate(async (taskId) => {
    if (!window.cliLoom) throw new Error('Missing main preload API')
    await window.cliLoom.stopWorkflow(taskId)
  }, 'e2e-auto-retry-stopped')
  await expect.poll(async () => readAutoRetry('e2e-auto-retry-stopped')?.phase).toBe('blocked')
  await expect(
    mainPage.locator('[data-auto-retry-phase="blocked"]').first()
  ).toBeVisible()
  await expect(
    mainPage.getByText('The task was stopped, so automatic retries were cancelled.').first()
  ).toBeVisible()

  // A waiting plan survives a restart: the overdue plan runs exactly once,
  // the retry succeeds, and the workflow continues to the end node.
  rmSync(path.join(projectDirectory, 'marker'), { force: true })
  await startTask('e2e-auto-retry-recovered', 'retry-recover')
  await expect.poll(async () => readAutoRetry('e2e-auto-retry-recovered')?.phase).toBe('waiting')
  await electronApp.close()

  forceWaitingPlanDue('e2e-auto-retry-recovered', 5_000)
  await launchApplication()
  await expect.poll(async () => (
    (await listTask('e2e-auto-retry-recovered'))?.status
  ), { timeout: 30_000 }).toBe('completed')
  expect(readAutoRetry('e2e-auto-retry-recovered')).toBeNull()
  const db = openDatabase()
  try {
    const nodeRun = db.prepare(
      'select status from node_runs where run_id = ? and node_id = ?'
    ).get('e2e-auto-retry-recovered', 'cmd') as { status: string }
    expect(nodeRun.status).toBe('completed')
  } finally {
    db.close()
  }

  expect(await mainPage.evaluate(() => (
    (window as WindowWithCspProbe).__cliloomCspViolations ?? []
  ))).toEqual([])
  expect(failures).toEqual([])
})

test('automatic retry start time is recorded, displayed and preserved', async ({ }, testInfo) => {
  failures.splice(0)
  await electronApp?.close()
  await launchApplication()

  // Self-contained fixture: this test registers its own project and creates
  // its own tasks, so it also passes when run standalone.
  projectId = await ensureProjectRegistered()

  await mainPage.evaluate(async (definition) => {
    if (!window.cliLoom) throw new Error('Missing main preload API')
    await window.cliLoom.saveWorkflow(definition)
  }, startedTimeWorkflow)

  const taskId = 'e2e-auto-retry-started'
  const releaseMarker = path.join(projectDirectory, 'release-marker')
  rmSync(releaseMarker, { force: true })
  await startTask(taskId, 'retry-start', startedTimeWorkflow)
  await expect.poll(async () => (await listTask(taskId))?.status).toBe('failed')
  await expect.poll(async () => readAutoRetry(taskId)?.phase).toBe('waiting')

  // Stop the app, move the persisted waiting plan into the past and relaunch:
  // the scheduler performs a real automatic retry (no manual retry button).
  await electronApp.close()
  forceWaitingPlanDue(taskId, 5_000)
  await launchApplication()
  await mainPage.getByRole('button', { name: /retry-start/ }).first().click()

  await expect(mainPage.getByText('Automatic retry #1 in progress').first()).toBeVisible()
  await expect.poll(async () => readAutoRetry(taskId)?.phase, { timeout: 30_000 }).toBe('running')
  const startedAt = readAutoRetry(taskId)?.lastRetryStartedAt as number
  expect(typeof startedAt).toBe('number')
  const timeZone = readAutoRetryTimeZone(taskId)
  const locale = await mainPage.evaluate(() => Intl.DateTimeFormat().resolvedOptions().locale)
  const expectedStart = `Last automatic retry started at ${expectedStartTimeText(startedAt, timeZone, locale)}`
  await expect(mainPage.getByText(expectedStart).first()).toBeVisible()
  const runningBanner = mainPage.locator('[data-auto-retry-phase="running"]').first()
  await expect(runningBanner).toBeVisible()
  await expect(runningBanner).not.toContainText(/GMT|UTC|Los_Angeles|Shanghai/)
  await attachScreenshot(testInfo, 'auto-retry-started-running')

  // Releasing the command makes the retry fail again: waiting keeps the very
  // same recorded start time for the next attempt.
  writeFileSync(releaseMarker, 'release')
  await expect.poll(async () => readAutoRetry(taskId)?.phase, { timeout: 30_000 }).toBe('waiting')
  const afterFailure = readAutoRetry(taskId)
  expect(afterFailure?.attemptsStarted).toBe(1)
  expect(afterFailure?.lastRetryStartedAt).toBe(startedAt)
  await expect(mainPage.getByText(/Automatic retry #2 will run at/).first()).toBeVisible()
  await expect(mainPage.getByText(expectedStart).first()).toBeVisible()
  await attachScreenshot(testInfo, 'auto-retry-started-waiting')

  // Narrow-panel visibility: a 380px column inside this wide window (the
  // parallel-branch grid size) must wrap the actions below the description
  // instead of crushing the text next to shrink-0 buttons.
  await mainPage.evaluate(() => {
    const banner = document.querySelector('[data-auto-retry-phase="waiting"]')
    if (banner) (banner as HTMLElement).style.maxWidth = '380px'
  })
  const narrowLine = mainPage.getByText(expectedStart).first()
  await expect(narrowLine).toBeVisible()
  expect((await narrowLine.boundingBox())?.width).toBeGreaterThan(150)
  await expect(mainPage.getByRole('button', { name: 'Cancel automatic retry' })).toBeVisible()
  await attachScreenshot(testInfo, 'auto-retry-started-narrow')
  await mainPage.evaluate(() => {
    for (const banner of document.querySelectorAll('[data-auto-retry-phase]')) {
      (banner as HTMLElement).style.maxWidth = ''
    }
  })

  // Cancelling keeps the history line, also after reopening the task.
  await mainPage.getByRole('button', { name: 'Cancel automatic retry' }).click()
  await expect.poll(async () => readAutoRetry(taskId)?.phase).toBe('cancelled')
  expect(readAutoRetry(taskId)?.lastRetryStartedAt).toBe(startedAt)
  await expect(mainPage.getByText('Automatic retry cancelled').first()).toBeVisible()
  await expect(mainPage.getByText(expectedStart).first()).toBeVisible()

  // Switch to a task created by this test and back: the time survives the
  // round trip without leaking into the other node.
  rmSync(releaseMarker, { force: true })
  await startTask('e2e-auto-retry-started-switch', 'retry-switch', startedTimeWorkflow)
  await expect.poll(async () => (await listTask('e2e-auto-retry-started-switch'))?.status).toBe('failed')
  await expect(mainPage.getByText(expectedStart).first()).toBeHidden()
  await mainPage.getByRole('button', { name: /retry-start/ }).first().click()
  await expect(mainPage.getByText(expectedStart).first()).toBeVisible()
  await attachScreenshot(testInfo, 'auto-retry-started-cancelled')

  expect(await mainPage.evaluate(() => (
    (window as WindowWithCspProbe).__cliloomCspViolations ?? []
  ))).toEqual([])
  expect(failures).toEqual([])
})
