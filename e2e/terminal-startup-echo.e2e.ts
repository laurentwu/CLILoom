import Database from 'better-sqlite3'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
import type { ProjectRecord, TaskRecord } from '../src/renderer/appTypes'
import type { WorkflowDefinition } from '../src/shared/workflow'

/**
 * Exercises the production interactive-terminal startup path: the workflow
 * engine starts a real PTY through ProcessRunner, the startup-echo recognizer
 * deduplicates the echoed command, and the renderer's xterm view plus the
 * persisted transcript agree before and after a re-attach. The command text
 * deliberately contains CJK text, an emoji, and a bound variable so the
 * display command must show the actual parameter value exactly once.
 */

const projectRoot = path.join(__dirname, '..')
const databasePath = (dataDirectory: string) => path.join(dataDirectory, 'CLILoom', 'cliloom.db')

const COMMAND_TEMPLATE = 'printf "启动回显 中文 😀 参数=${title} 程序输出-完成"; exit'
const DISPLAY_COMMAND = 'printf "启动回显 中文 😀 参数=实际参数-😀 程序输出-完成"; exit'
const COMMAND_MARKER = 'printf "启动回显'

function startupEchoWorkflow(isolatedHome: string): WorkflowDefinition {
  return {
    id: 'e2e-startup-echo-workflow',
    name: 'Startup echo workflow',
    nodes: [
      {
        id: 'start',
        type: 'start',
        name: 'Start',
        config: { variables: [{ key: 'title', label: 'Title', type: 'text', required: true }] }
      },
      {
        id: 'term',
        type: 'interactive-terminal',
        name: 'Startup echo terminal',
        config: {
          command: COMMAND_TEMPLATE,
          cwd: '${sys_project_dir}',
          env: { HOME: isolatedHome, TERM: 'xterm-256color' },
          autoStart: false
        }
      },
      { id: 'end', type: 'end', name: 'End', config: {} }
    ],
    edges: [
      { id: 'start-term', from: 'start', to: 'term' },
      { id: 'term-end', from: 'term', to: 'end' }
    ]
  }
}

let resources: TestResources
let appDataDirectory = ''
let fixtureDirectory = ''
let projectDirectory = ''
let isolatedHome = ''
let electronApp: ElectronApplication
let mainPage: Page

test.skip(process.platform !== 'linux', 'The startup echo e2e runs on the Linux validation job')

async function launchApplication(): Promise<void> {
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
  resources.defer('electron-app', () => app.close())
  mainPage = await app.firstWindow()
  await mainPage.locator('#root > *').first().waitFor()
}

test.beforeAll(async () => {
  resources = createTestResources()
  appDataDirectory = mkdtempSync(path.join(tmpdir(), 'cliloom-startup-echo-data-'))
  resources.defer('app-data-directory', () => {
    rmSync(appDataDirectory, { recursive: true, force: true })
  })
  fixtureDirectory = mkdtempSync(path.join(tmpdir(), 'cliloom-startup-echo-projects-'))
  resources.defer('project-fixture-directory', () => {
    rmSync(fixtureDirectory, { recursive: true, force: true })
  })
  projectDirectory = path.join(fixtureDirectory, 'echo-project')
  isolatedHome = path.join(fixtureDirectory, 'isolated-home')
  mkdirSync(projectDirectory)
  mkdirSync(isolatedHome)
  const profile = [
    'export LANG=C.UTF-8',
    'export LC_ALL=C.UTF-8',
    'export TERM=xterm-256color',
    'export HISTFILE=/dev/null',
    'export HISTSIZE=0',
    'PROMPT_COMMAND=',
    "PS1='CLILOOM$ '",
    'set +m'
  ].join('\n')
  writeFileSync(path.join(isolatedHome, '.bash_profile'), `${profile}\n`)
  writeFileSync(path.join(isolatedHome, '.bashrc'), `${profile}\n`)
  writeFileSync(path.join(isolatedHome, '.hushlogin'), '')

  await launchApplication()
})

test.afterAll(async () => {
  await resources.dispose()
})

function readSessionTranscript(): string {
  const db = new Database(databasePath(appDataDirectory), { fileMustExist: true })
  try {
    const row = db.prepare(
      'select transcript from terminal_sessions where node_id = ? order by rowid desc limit 1'
    ).get('term') as { transcript: string } | undefined
    return row?.transcript ?? ''
  } finally {
    db.close()
  }
}

function listTask(projectId: string, taskId: string): Promise<TaskRecord | undefined> {
  return mainPage.evaluate(async ({ projectId, taskId }) => {
    if (!window.cliLoom) throw new Error('Missing main preload API')
    const tasks = (await window.cliLoom.listTasks(projectId)) as TaskRecord[]
    return tasks.find((task) => task.id === taskId)
  }, { projectId, taskId }) as Promise<TaskRecord | undefined>
}

function readTerminalText(): Promise<string> {
  return mainPage.evaluate(() => {
    const rows = document.querySelectorAll('.xterm-rows > div')
    if (rows.length === 0) throw new Error('No xterm rows rendered')
    return Array.from(rows, (row) => row.textContent ?? '').join('\n')
  })
}

test('interactive startup command shows once with real arguments and survives re-attach', async ({}, testInfo) => {
  test.setTimeout(120_000)

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

  const workflow = startupEchoWorkflow(isolatedHome)
  const taskId = 'e2e-startup-echo-run'
  await mainPage.evaluate(async ({ workflow, projectId, taskId }) => {
    if (!window.cliLoom) throw new Error('Missing main preload API')
    await window.cliLoom.startWorkflow({
      taskId,
      projectId,
      workflow,
      variables: { title: '实际参数-😀' },
      startNodeId: 'start'
    })
  }, { workflow, projectId: project.id, taskId })

  await expect.poll(async () => (await listTask(project.id, taskId))?.status, { timeout: 60_000 })
    .toBe('completed')

  // The persisted transcript keeps exactly one drawn startup command with the
  // resolved parameter, the shell prompt, and the program output.
  const transcript = readSessionTranscript()
  expect(transcript.split(COMMAND_MARKER).length - 1).toBe(1)
  expect(transcript).toContain(`CLILOOM$ ${DISPLAY_COMMAND}`)
  expect(transcript).toContain('程序输出-完成')
  expect(transcript).not.toContain('CLILOOM_INTERNAL_VALUE')
  expect(transcript).not.toContain('${title}')

  // Attach the history view in the running window: the visible xterm body
  // matches the transcript's single startup command.
  await mainPage.getByRole('button', { name: /实际参数/ }).first().click()
  await mainPage.getByRole('radio', { name: 'Flow graph view' }).click()
  await mainPage.getByText('Startup echo terminal', { exact: true }).click()
  await mainPage.locator('.xterm-rows').waitFor({ timeout: 30_000 })
  await expect.poll(readTerminalText, { timeout: 30_000 }).toContain('程序输出-完成')
  const visible = await readTerminalText()
  expect(visible.split(COMMAND_MARKER).length - 1).toBe(1)
  expect(visible).toContain(DISPLAY_COMMAND)
  expect(visible).toContain('CLILOOM$')
  expect(visible).not.toContain('CLILOOM_INTERNAL_VALUE')

  // Re-attach through a fresh renderer: the restored history still shows the
  // same single startup command.
  await mainPage.reload()
  await mainPage.locator('#root > *').first().waitFor()
  await mainPage.getByRole('button', { name: /实际参数/ }).first().click()
  await mainPage.getByRole('radio', { name: 'Flow graph view' }).click()
  await mainPage.getByText('Startup echo terminal', { exact: true }).click()
  await mainPage.locator('.xterm-rows').waitFor({ timeout: 30_000 })
  await expect.poll(readTerminalText, { timeout: 30_000 }).toContain('程序输出-完成')
  const reattached = await readTerminalText()
  expect(reattached.split(COMMAND_MARKER).length - 1).toBe(1)
  expect(reattached).toContain(DISPLAY_COMMAND)
  expect(reattached).not.toContain('CLILOOM_INTERNAL_VALUE')
  expect(reattached).toBe(visible)
  await mainPage.screenshot({ path: testInfo.outputPath('startup-echo.png') })
})
