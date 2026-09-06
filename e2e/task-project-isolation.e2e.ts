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

const workflow: WorkflowDefinition = {
  id: 'e2e-project-isolation',
  name: 'Project isolation workflow',
  nodes: [
    {
      id: 'start',
      type: 'start',
      name: 'Start',
      config: {
        variables: [{
          key: 'title',
          label: 'Title',
          type: 'text',
          required: true
        }]
      }
    },
    {
      id: 'input',
      type: 'input',
      name: 'Wait for input',
      config: { variables: [] }
    },
    { id: 'end', type: 'end', name: 'End', config: {} }
  ],
  edges: [
    { id: 'start-input', from: 'start', to: 'input' },
    { id: 'input-end', from: 'input', to: 'end' }
  ]
}

const failures: string[] = []
let appDataDirectory = ''
let electronApp: ElectronApplication
let fixtureDirectory = ''
let mainPage: Page
let projectADirectory = ''
let projectBDirectory = ''

test.skip(process.platform !== 'linux', 'The production-entry isolation test runs on Linux')

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

test.beforeAll(async () => {
  const projectRoot = path.join(__dirname, '..')
  appDataDirectory = mkdtempSync(path.join(tmpdir(), 'cliloom-isolation-e2e-data-'))
  fixtureDirectory = mkdtempSync(path.join(tmpdir(), 'cliloom-isolation-e2e-projects-'))
  projectADirectory = path.join(fixtureDirectory, 'Project A')
  projectBDirectory = path.join(fixtureDirectory, 'Project B')
  mkdirSync(projectADirectory)
  mkdirSync(projectBDirectory)
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
})

test.afterAll(async () => {
  await electronApp?.close()
  if (appDataDirectory) rmSync(appDataDirectory, { recursive: true, force: true })
  if (fixtureDirectory) rmSync(fixtureDirectory, { recursive: true, force: true })
})

test('isolates background task updates and clears unread after a successful project load', async ({}, testInfo) => {
  failures.splice(0)
  await electronApp.evaluate(({ dialog }, directories) => {
    const state = globalThis as typeof globalThis & {
      __cliloomDialogDirectories?: string[]
      __cliloomOriginalShowOpenDialog?: typeof dialog.showOpenDialog
    }
    state.__cliloomDialogDirectories = [...directories]
    state.__cliloomOriginalShowOpenDialog = dialog.showOpenDialog
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [state.__cliloomDialogDirectories?.shift() ?? '']
    })
  }, [projectADirectory, projectBDirectory])

  const addProject = mainPage.getByRole('button', { name: 'Add project folder' })
  await addProject.click()
  await expect(mainPage.getByRole('button', { name: 'Open project Project A' })).toBeVisible()
  await addProject.click()
  await expect(mainPage.getByRole('button', { name: 'Open project Project B' })).toBeVisible()

  await electronApp.evaluate(({ dialog }) => {
    const state = globalThis as typeof globalThis & {
      __cliloomDialogDirectories?: string[]
      __cliloomOriginalShowOpenDialog?: typeof dialog.showOpenDialog
    }
    if (state.__cliloomOriginalShowOpenDialog) {
      dialog.showOpenDialog = state.__cliloomOriginalShowOpenDialog
    }
    delete state.__cliloomDialogDirectories
    delete state.__cliloomOriginalShowOpenDialog
  })

  const projects = await mainPage.evaluate(() => window.cliLoom?.listProjects()) as ProjectRecord[]
  const projectA = projects.find((project) => project.path === projectADirectory)
  const projectB = projects.find((project) => project.path === projectBDirectory)
  expect(projectA).toBeTruthy()
  expect(projectB).toBeTruthy()
  if (!projectA || !projectB) throw new Error('E2E projects were not registered')

  await mainPage.evaluate(async (definition) => {
    if (!window.cliLoom) throw new Error('Missing main preload API')
    await window.cliLoom.saveWorkflow(definition)
  }, workflow)
  await expect(mainPage.getByRole('button', { name: 'New task' })).toBeEnabled()

  const startTask = (taskId: string, projectId: string, title: string) => mainPage.evaluate(
    async ({ definition, projectId, taskId, title }) => {
      if (!window.cliLoom) throw new Error('Missing main preload API')
      await window.cliLoom.startWorkflow({
        taskId,
        projectId,
        workflow: definition,
        variables: { title },
        startNodeId: 'start'
      })
    },
    { definition: workflow, projectId, taskId, title }
  )
  const listTasks = (projectId: string) => mainPage.evaluate(
    async (id) => {
      if (!window.cliLoom) throw new Error('Missing main preload API')
      return window.cliLoom.listTasks(id)
    },
    projectId
  ) as Promise<TaskRecord[]>

  const taskBId = 'e2e-background-task'
  await startTask(taskBId, projectB.id, 'B task')
  await expect.poll(async () => (
    (await listTasks(projectB.id)).find((task) => task.id === taskBId)?.status
  )).toBe('waiting-input')
  await expect(mainPage.locator('.task-sidebar').getByText('B task', { exact: true })).toBeVisible()

  await mainPage.getByRole('button', { name: 'Open project Project A' }).click()
  await expect(mainPage.locator('.task-sidebar').getByText('Project A', { exact: true })).toBeVisible()
  const taskAId = 'e2e-current-task'
  await startTask(taskAId, projectA.id, 'A task')
  await expect.poll(async () => (
    (await listTasks(projectA.id)).find((task) => task.id === taskAId)?.status
  )).toBe('waiting-input')
  await expect(mainPage.locator('.task-sidebar').getByText('A task', { exact: true })).toBeVisible()
  const workspaceTitleBefore = await mainPage.locator('.workspace-header__task-title').textContent()

  await mainPage.evaluate(async (taskId) => {
    if (!window.cliLoom) throw new Error('Missing main preload API')
    await window.cliLoom.updateWorkflowVariables(taskId, {})
  }, taskBId)
  await expect.poll(async () => (
    (await listTasks(projectB.id)).find((task) => task.id === taskBId)?.status
  )).toBe('completed')

  const unreadMarker = mainPage.locator(
    `[data-project-unread-indicator="true"][data-project-id="${projectB.id}"]`
  )
  await expect(unreadMarker).toBeVisible()
  await expect(mainPage.locator('.task-sidebar').getByText('A task', { exact: true })).toBeVisible()
  await expect(mainPage.locator('.task-sidebar').getByText('B task', { exact: true })).toHaveCount(0)
  expect(await mainPage.locator('.workspace-header__task-title').textContent()).toBe(workspaceTitleBefore)
  await testInfo.attach('project-unread-marker-visible', {
    body: await mainPage.screenshot(),
    contentType: 'image/png'
  })

  await mainPage.getByRole('button', {
    name: 'Open project Project B, unread task status updates'
  }).click()
  await expect(mainPage.locator('.task-sidebar').getByText('B task', { exact: true })).toBeVisible()
  await expect(mainPage.locator('.task-sidebar').getByText('A task', { exact: true })).toHaveCount(0)
  await expect(mainPage.locator('.task-sidebar').getByText('Completed', { exact: true })).toBeVisible()
  await expect(unreadMarker).toHaveCount(0)

  await mainPage.getByRole('button', { name: 'Open project Project A' }).click()
  await expect(mainPage.locator('.task-sidebar').getByText('A task', { exact: true })).toBeVisible()
  await expect(mainPage.locator('.task-sidebar').getByText('B task', { exact: true })).toHaveCount(0)

  await testInfo.attach('project-unread-marker-cleared', {
    body: await mainPage.screenshot(),
    contentType: 'image/png'
  })
  expect(await mainPage.evaluate(() => (
    (window as WindowWithCspProbe).__cliloomCspViolations ?? []
  ))).toEqual([])
  expect(failures).toEqual([])
})
