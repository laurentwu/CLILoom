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
import { createTestResources, type TestResources } from '../test-support/resources'
import {
  assertNoCspViolations,
  ensureCspProbeCoverage,
  installCspProbe,
  monitorPage,
  resetCspProbeFailures
} from './support/cspProbe'
import type { ProjectRecord, TaskRecord } from '../src/renderer/appTypes'
import type { WorkflowDefinition } from '../src/shared/workflow'

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

const projectRoot = path.join(__dirname, '..')
let resources: TestResources
let appDataDirectory = ''
let electronApp: ElectronApplication | null = null
let fixtureDirectory = ''
let mainPage: Page
let projectADirectory = ''
let projectBDirectory = ''

test.skip(process.platform !== 'linux', 'The production-entry isolation test runs on Linux')

let launchCounter = 0

async function launchApplication(): Promise<void> {
  launchCounter += 1
  const app = await electron.launch({
    args: [projectRoot],
    cwd: projectRoot,
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL: '',
      XDG_CONFIG_HOME: appDataDirectory
    }
  })
  electronApp = app
  resources.defer(`electron-app-${launchCounter}`, () => app.close())
  const context = app.context()
  await installCspProbe(context)
  mainPage = await app.firstWindow()
  const stopMonitoring = monitorPage(mainPage)
  resources.defer('csp-monitor', stopMonitoring)
  await ensureCspProbeCoverage(mainPage)
  await mainPage.locator('#root > *').first().waitFor()
}

async function registerProjectDirectories(directories: string[]): Promise<ProjectRecord[]> {
  const app = electronApp!
  await app.evaluate(({ dialog }, directoriesToRegister) => {
    const state = globalThis as typeof globalThis & {
      __cliloomDialogDirectories?: string[]
      __cliloomOriginalShowOpenDialog?: typeof dialog.showOpenDialog
    }
    state.__cliloomDialogDirectories = [...directoriesToRegister]
    state.__cliloomOriginalShowOpenDialog = dialog.showOpenDialog
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [state.__cliloomDialogDirectories?.shift() ?? '']
    })
  }, directories)
  try {
    const addProject = mainPage.getByRole('button', { name: 'Add project folder' })
    for (const directory of directories) {
      await addProject.click()
      await expect(
        mainPage.getByRole('button', { name: `Open project ${path.basename(directory)}` })
      ).toBeVisible()
    }
  } finally {
    await app.evaluate(({ dialog }) => {
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
  }
  const projects = await mainPage.evaluate(() => window.cliLoom?.listProjects()) as ProjectRecord[]
  const registered = directories.map((directory) => {
    const project = projects.find((item) => item.path === directory)
    if (!project) throw new Error(`E2E project ${directory} was not registered`)
    return project
  })
  return registered
}

test.beforeEach(async () => {
  resetCspProbeFailures()
  resources = createTestResources()
  appDataDirectory = mkdtempSync(path.join(tmpdir(), 'cliloom-isolation-e2e-data-'))
  resources.defer('app-data-directory', () => {
    rmSync(appDataDirectory, { recursive: true, force: true })
  })
  fixtureDirectory = mkdtempSync(path.join(tmpdir(), 'cliloom-isolation-e2e-projects-'))
  resources.defer('project-fixture-directory', () => {
    rmSync(fixtureDirectory, { recursive: true, force: true })
  })
  projectADirectory = path.join(fixtureDirectory, 'Project A')
  projectBDirectory = path.join(fixtureDirectory, 'Project B')
  mkdirSync(projectADirectory)
  mkdirSync(projectBDirectory)
  await launchApplication()
})

test.afterEach(async () => {
  await resources.dispose()
})

test('isolates background task updates and clears unread after a successful project load', async ({}, testInfo) => {
  const [projectA, projectB] = await registerProjectDirectories([projectADirectory, projectBDirectory])

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
  await assertNoCspViolations(mainPage)
})

test('edits a failed workflow terminal command once through the real runtime chain', async () => {
  const [projectA] = await registerProjectDirectories([projectADirectory])
  await mainPage.getByRole('button', { name: 'Open project Project A' }).click()

  const retryWorkflow: WorkflowDefinition = {
    id: 'e2e-edited-terminal-retry',
    name: 'Edited terminal retry',
    nodes: [
      {
        id: 'start',
        type: 'start',
        name: 'Start',
        config: {
          variables: [{ key: 'marker', label: 'Marker', type: 'text', required: true }]
        }
      },
      {
        id: 'terminal',
        type: 'non-interactive-terminal',
        name: 'Fail then edit',
        config: {
          command: 'printf \'INITIAL:%s\\n\' "${marker}"; exit 9',
          cwd: '${sys_project_dir}',
          successExitCodes: [0]
        }
      },
      { id: 'end', type: 'end', name: 'Finished after edited retry', config: {} }
    ],
    edges: [
      { id: 'start-terminal', from: 'start', to: 'terminal' },
      { id: 'terminal-end', from: 'terminal', to: 'end' }
    ]
  }
  const taskId = 'e2e-edited-terminal-task'
  const taskTitle = 'Editable retry task'
  await mainPage.evaluate(async ({ definition, projectId, taskId, taskTitle }) => {
    if (!window.cliLoom) throw new Error('Missing main preload API')
    await window.cliLoom.saveWorkflow(definition)
    await window.cliLoom.startWorkflow({
      taskId,
      projectId,
      workflow: definition,
      variables: { marker: taskTitle },
      startNodeId: 'start'
    })
  }, { definition: retryWorkflow, projectId: projectA.id, taskId, taskTitle })

  const taskStatus = () => mainPage.evaluate(async ({ projectId, taskId }) => {
    if (!window.cliLoom) throw new Error('Missing main preload API')
    return (await window.cliLoom.listTasks(projectId))
      .find((task: TaskRecord) => task.id === taskId)?.status
  }, { projectId: projectA.id, taskId })
  const transcript = () => mainPage.evaluate(async (taskId) => {
    if (!window.cliLoom) throw new Error('Missing main preload API')
    const sessions = await window.cliLoom.listTaskSessions(taskId) as Array<{ id: string }>
    const session = sessions.at(-1)
    return session
      ? (await window.cliLoom.getTaskSessionTranscript(taskId, session.id)).transcript
      : ''
  }, taskId)

  await expect.poll(taskStatus).toBe('failed')
  const taskButton = mainPage.locator('.task-sidebar button').filter({ hasText: taskTitle }).first()
  await expect(taskButton).toBeVisible()
  await taskButton.click()
  await expect.poll(transcript).toContain(`INITIAL:${taskTitle}`)

  const editButton = mainPage.getByRole('button', { name: 'Edit command and retry' })
  await editButton.click()
  let dialog = mainPage.getByRole('dialog')
  const originalCommand = 'printf \'INITIAL:%s\\n\' "${marker}"; exit 9'
  await expect(dialog.getByLabel('Retry command')).toHaveValue(originalCommand)
  await dialog.getByLabel('Retry command').fill('printf \'CANCELLED-RETRY-SENTINEL\\n\'')
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toBeHidden()
  expect(await transcript()).not.toContain('CANCELLED-RETRY-SENTINEL')
  expect(await taskStatus()).toBe('failed')

  await editButton.click()
  dialog = mainPage.getByRole('dialog')
  const editedCommand = 'printf \'EDITED-RETRY-SENTINEL\\n\''
  await dialog.getByLabel('Retry command').fill(editedCommand)
  await dialog.getByRole('button', { name: 'Retry and continue workflow' }).click()
  await expect(dialog).toBeHidden()
  await expect.poll(transcript).toContain('EDITED-RETRY-SENTINEL')
  await expect.poll(taskStatus).toBe('completed')
  await expect(mainPage.getByText('Finished after edited retry', { exact: true })).toBeVisible()

  await mainPage.getByRole('radio', { name: 'Flow graph view' }).click()
  await mainPage.getByText('Fail then edit', { exact: true }).click()
  await mainPage.getByRole('button', { name: 'Edit command and retry' }).click()
  dialog = mainPage.getByRole('dialog')
  await expect(dialog.getByLabel('Retry command')).toHaveValue(originalCommand)
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  expect(await mainPage.evaluate(async (workflowId) => {
    if (!window.cliLoom) throw new Error('Missing main preload API')
    const records = await window.cliLoom.listWorkflows() as Array<{ workflow: WorkflowDefinition }>
    return records.find((record) => record.workflow.id === workflowId)?.workflow
  }, retryWorkflow.id)).toEqual(retryWorkflow)

  await electronApp!.close()
  electronApp = null
  await launchApplication()
  await mainPage.getByRole('button', { name: 'Open project Project A' }).click()
  const restoredTaskButton = mainPage.locator('.task-sidebar button').filter({ hasText: taskTitle }).first()
  await expect(restoredTaskButton).toBeVisible()
  await restoredTaskButton.click()
  await mainPage.getByRole('radio', { name: 'Flow graph view' }).click()
  await mainPage.getByText('Fail then edit', { exact: true }).click()
  await expect(mainPage.locator('[data-slot="card-description"]')).toContainText(editedCommand)
  await mainPage.getByRole('button', { name: 'Edit command and retry' }).click()
  dialog = mainPage.getByRole('dialog')
  await expect(dialog.getByLabel('Retry command')).toHaveValue(originalCommand)
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await assertNoCspViolations(mainPage)
})
