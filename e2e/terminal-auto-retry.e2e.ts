import Database from 'better-sqlite3'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page
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

async function startTask(taskId: string, title: string): Promise<void> {
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
  }, { definition: workflow, projectId, taskId, title })
  await mainPage.getByRole('button', { name: new RegExp(title) }).first().click()
}

function listTask(taskId: string): Promise<TaskRecord | undefined> {
  return mainPage.evaluate(async ({ projectId, taskId }) => {
    if (!window.cliLoom) throw new Error('Missing main preload API')
    const tasks = (await window.cliLoom.listTasks(projectId)) as TaskRecord[]
    return tasks.find((task) => task.id === taskId)
  }, { projectId, taskId }) as Promise<TaskRecord | undefined>
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
  await testInfo.attach('auto-retry-waiting-banner', {
    body: await mainPage.screenshot(),
    contentType: 'image/png'
  })

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
