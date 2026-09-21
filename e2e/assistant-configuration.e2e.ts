import Database from 'better-sqlite3'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page
} from 'playwright/test'
import type { WorkflowDefinition } from '../src/shared/workflow'
import type { ShellSnapshot } from '../src/shared/shell'
import type { UserSkin } from '../src/shared/appSettings'

/**
 * Drives the real assistant launch path: the initialization command runs in
 * the assistant PTY with the live bridge environment, and the job runner
 * below executes the private workspace `cliloom` launcher for each job the
 * test submits. No real AI service is involved and no unauthenticated entry
 * point is added to production code.
 */

const projectRoot = path.join(__dirname, '..')
const databasePath = (dataDirectory: string) => path.join(dataDirectory, 'CLILoom', 'cliloom.db')

const workflow: WorkflowDefinition = {
  id: 'assistant-config-e2e',
  name: 'Assistant configuration workflow',
  nodes: [
    { id: 'start', type: 'start', name: 'Start', config: { variables: [] } },
    {
      id: 'term',
      type: 'interactive-terminal',
      name: 'Watcher',
      config: {
        command: 'sleep 30',
        retryCommand: 'sleep 30 --retry',
        cwd: '${sys_project_dir}',
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

const assistantScript = `#!/bin/sh
if [ "$1" = "--version" ]; then
  printf 'cliloom-e2e-assistant 1.0\\n'
  exit 0
fi
jobs="$CLILOOM_E2E_JOBS"
out="$CLILOOM_E2E_OUT"
while true; do
  entry=$(ls "$jobs" 2>/dev/null | sort | head -n 1)
  if [ -z "$entry" ]; then
    sleep 0.2
    continue
  fi
  mv "$jobs/$entry" "$out/$entry.running" 2>/dev/null || continue
  (
    sh "$out/$entry.running" >"$out/$entry.stdout" 2>"$out/$entry.stderr"
    printf '%s' "$?" >"$out/$entry.exit"
    mv "$out/$entry.running" "$out/$entry.done"
  ) || true
done
`

let appDataDirectory = ''
let jobsDirectory = ''
let resultsDirectory = ''
let scriptDirectory = ''
let createdSkinId = ''
let selectedCandidatePath = ''
let electronApp: ElectronApplication
let mainPage: Page

test.skip(process.platform !== 'linux', 'The assistant configuration e2e runs on the Linux validation job')

async function waitForResultFile(name: string, timeoutMs = 90_000): Promise<void> {
  const startedAt = Date.now()
  while (!existsSync(path.join(resultsDirectory, name))) {
    if (Date.now() - startedAt > timeoutMs) {
      const listing = existsSync(resultsDirectory) ? readdirSync(resultsDirectory) : []
      throw new Error(`Timed out waiting for ${name}; results contain: ${listing.join(', ')}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
}

async function runJob(name: string, body: string): Promise<{ stdout: string; stderr: string; exit: string }> {
  writeFileSync(path.join(jobsDirectory, `${name}.sh`), `${body}\n`)
  await waitForResultFile(`${name}.sh.done`)
  return {
    stdout: readFileSync(path.join(resultsDirectory, `${name}.sh.stdout`), 'utf8'),
    stderr: readFileSync(path.join(resultsDirectory, `${name}.sh.stderr`), 'utf8'),
    exit: readFileSync(path.join(resultsDirectory, `${name}.sh.exit`), 'utf8')
  }
}

function openDatabase(): Database.Database {
  return new Database(databasePath(appDataDirectory), { fileMustExist: true })
}

function setAssistantInitializationCommand(command: string): void {
  const db = openDatabase()
  try {
    db.prepare('insert or replace into settings (key, value_json, updated_at) values (?, ?, ?)')
      .run('assistant_config', JSON.stringify({ version: 1, initializationCommand: command }), new Date().toISOString())
  } finally {
    db.close()
  }
}

async function launchApplication(): Promise<void> {
  electronApp = await electron.launch({
    args: [projectRoot],
    cwd: projectRoot,
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL: '',
      XDG_CONFIG_HOME: appDataDirectory,
      CLILOOM_E2E_JOBS: jobsDirectory,
      CLILOOM_E2E_OUT: resultsDirectory
    }
  })
  mainPage = await electronApp.firstWindow()
  await mainPage.locator('#root > *').first().waitFor()
}

async function openAssistantAndWaitForFirstJob(): Promise<void> {
  await mainPage.evaluate(async () => {
    if (!window.cliLoom) throw new Error('Missing main preload API')
    await window.cliLoom.openAssistant()
  })
}

async function readProjectRailWidth(): Promise<string> {
  return mainPage.evaluate(() => {
    const shell = document.querySelector('.app-shell')
    if (!shell) throw new Error('Missing app shell element')
    return getComputedStyle(shell).getPropertyValue('--project-rail-width').trim()
  })
}

async function readTaskSidebarWidth(): Promise<string> {
  return mainPage.evaluate(() => {
    const shell = document.querySelector('.app-shell')
    if (!shell) throw new Error('Missing app shell element')
    return getComputedStyle(shell).getPropertyValue('--task-sidebar-width').trim()
  })
}

test.beforeAll(async () => {
  appDataDirectory = mkdtempSync(path.join(tmpdir(), 'cliloom-assistant-config-data-'))
  const fixtureDirectory = mkdtempSync(path.join(tmpdir(), 'cliloom-assistant-config-fixture-'))
  scriptDirectory = path.join(fixtureDirectory, 'bin')
  jobsDirectory = path.join(fixtureDirectory, 'jobs')
  resultsDirectory = path.join(fixtureDirectory, 'results')
  mkdirSync(scriptDirectory, { recursive: true })
  mkdirSync(jobsDirectory, { recursive: true })
  mkdirSync(resultsDirectory, { recursive: true })
  const scriptPath = path.join(scriptDirectory, 'cliloom-e2e-assistant.sh')
  writeFileSync(scriptPath, assistantScript)
  chmodSync(scriptPath, 0o755)

  await launchApplication()
  await mainPage.evaluate(async (definition) => {
    if (!window.cliLoom) throw new Error('Missing main preload API')
    await window.cliLoom.saveWorkflow(definition)
  }, workflow)
  setAssistantInitializationCommand(scriptPath)
  await openAssistantAndWaitForFirstJob()
})

test.afterAll(async () => {
  await electronApp?.close()
  if (appDataDirectory) rmSync(appDataDirectory, { recursive: true, force: true })
})

function withTermAutoRetry(definition: WorkflowDefinition, autoRetry: unknown): WorkflowDefinition {
  return {
    ...definition,
    nodes: definition.nodes.map((node) => (
      node.id === 'term'
        ? { ...node, config: { ...(node.config as Record<string, unknown>), autoRetry } }
        : node
    )) as WorkflowDefinition['nodes']
  }
}

test('assistant discovers capabilities and configures terminal auto-retry', async () => {
  const context = await runJob('10-context', 'cliloom context --json')
  expect(context.exit).toBe('0')
  expect(context.stderr).toBe('')
  const contextData = JSON.parse(context.stdout) as {
    schemaVersion: number
    commandDescriptors: Array<{ id: string }>
    publicSettings: Array<{ key: string }>
    workflows: Array<{ id: string; revision: number }>
  }
  expect(contextData.schemaVersion).toBe(2)
  const descriptorIds = contextData.commandDescriptors.map((descriptor) => descriptor.id)
  expect(descriptorIds).toContain('workflow.save')
  expect(descriptorIds).not.toContain('workflow.auto-retry.get')
  expect(descriptorIds).not.toContain('workflow.auto-retry.set')
  expect(contextData.publicSettings.map((setting) => setting.key)).toContain('layout.projectRailWidth')
  expect(contextData.workflows).toEqual([expect.objectContaining({ id: 'assistant-config-e2e', revision: 1 })])
  expect(context.stdout).not.toContain('CLILOOM_ASSISTANT_BRIDGE_TOKEN')

  const schema = await runJob('20-schema', 'cliloom workflow schema --json')
  expect(schema.exit).toBe('0')
  const schemaData = JSON.parse(schema.stdout) as {
    schemaVersion: number
    save: { usage: string }
    nodeConfigs: Record<string, unknown>
    terminalAutoRetry: { examples: Record<string, unknown> }
    examples: Record<string, unknown>
  }
  expect(schemaData.schemaVersion).toBe(2)
  expect(schemaData.save.usage).toContain('cliloom workflow save')
  expect(Object.keys(schemaData.nodeConfigs)).toEqual([
    'start',
    'interactive-terminal',
    'non-interactive-terminal',
    'input',
    'exclusive-gateway',
    'parallel-gateway',
    'end'
  ])

  const read = await runJob('30-workflow-get', 'cliloom workflow get assistant-config-e2e --json')
  expect(read.exit).toBe('0')
  const record = JSON.parse(read.stdout) as {
    workflow: WorkflowDefinition
    revision: number
  }
  expect(record.revision).toBe(1)
  expect(record.workflow.id).toBe('assistant-config-e2e')

  const set = await runJob('40-workflow-save-recommended', [
    `printf '%s' '${JSON.stringify(withTermAutoRetry(record.workflow, { enabled: true, mode: 'recommended', maxRetries: 5 }))}' | cliloom workflow save --stdin --expected-revision ${record.revision} --json`
  ].join('\n'))
  expect(set.exit, `set stderr: ${set.stderr}`).toBe('0')
  expect(set.stderr).toBe('')
  expect(JSON.parse(set.stdout)).toMatchObject({
    command: 'workflow.save',
    created: false,
    revision: 2
  })

  const savedInApp = await mainPage.evaluate(async () => {
    if (!window.cliLoom) throw new Error('Missing main preload API')
    const records = (await window.cliLoom.listWorkflows()) as Array<{
      revision: number
      workflow: WorkflowDefinition
    }>
    const record = records.find((item) => item.workflow.id === 'assistant-config-e2e')
    if (!record) throw new Error('Workflow missing from the main window')
    return record
  })
  expect(savedInApp.revision).toBe(2)
  const terminal = savedInApp.workflow.nodes.find((node) => node.id === 'term')
  expect(terminal?.config).toMatchObject({
    command: 'sleep 30',
    retryCommand: 'sleep 30 --retry',
    autoRetry: { enabled: true, mode: 'recommended', maxRetries: 5 }
  })

  // The designer's unsaved-edit protection blocks assistant writes.
  await mainPage.evaluate(async (workflowId) => {
    if (!window.cliLoom) throw new Error('Missing main preload API')
    await window.cliLoom.setDesignerState({ workflowId, open: true, dirty: true })
  }, 'assistant-config-e2e')
  const dirty = await runJob('50-workflow-save-dirty', [
    `printf '%s' '${JSON.stringify(withTermAutoRetry(record.workflow, { enabled: true, mode: 'cron', cron: '*/15 * * * *', maxRetries: null }))}' | cliloom workflow save --stdin --expected-revision 2 --json`
  ].join('\n'))
  expect(dirty.exit).toBe('2')
  expect(JSON.parse(dirty.stderr).error.code).toBe('VALIDATION_ERROR')

  await mainPage.evaluate(async () => {
    if (!window.cliLoom) throw new Error('Missing main preload API')
    await window.cliLoom.setDesignerState({ workflowId: null, open: false, dirty: false })
  })
  const stale = await runJob('60-workflow-save-stale', [
    `printf '%s' '${JSON.stringify(withTermAutoRetry(record.workflow, { enabled: true, mode: 'cron', cron: '*/15 * * * *', maxRetries: null }))}' | cliloom workflow save --stdin --expected-revision 1 --json`
  ].join('\n'))
  expect(stale.exit).toBe('5')
  expect(JSON.parse(stale.stderr).error.code).toBe('WORKFLOW_REVISION_CONFLICT')

  const removal = await runJob('65-workflow-save-removal', [
    `printf '%s' '${JSON.stringify(withTermAutoRetry(record.workflow, undefined))}' | cliloom workflow save --stdin --expected-revision 2 --json`
  ].join('\n'))
  expect(removal.exit, `removal stderr: ${removal.stderr}`).toBe('0')
  expect(JSON.parse(removal.stdout)).toMatchObject({ revision: 3 })
  const afterRemoval = await runJob('66-workflow-get-removed', 'cliloom workflow get assistant-config-e2e --json')
  const removedRecord = JSON.parse(afterRemoval.stdout) as { workflow: WorkflowDefinition; revision: number }
  const removedTerminal = removedRecord.workflow.nodes.find((node) => node.id === 'term')
  expect((removedTerminal?.config as Record<string, unknown>).autoRetry).toBeUndefined()
  expect(removedTerminal?.config).toMatchObject({ command: 'sleep 30', retryCommand: 'sleep 30 --retry' })

  const retry = await runJob('70-workflow-save-cron', [
    `printf '%s' '${JSON.stringify(withTermAutoRetry(removedRecord.workflow, { enabled: true, mode: 'cron', cron: '*/15 * * * *', maxRetries: null }))}' | cliloom workflow save --stdin --expected-revision 3 --json`
  ].join('\n'))
  expect(retry.exit).toBe('0')
  expect(JSON.parse(retry.stdout)).toMatchObject({
    revision: 4
  })

  const legacyGet = await runJob('75-legacy-auto-retry-get', 'cliloom workflow auto-retry get assistant-config-e2e term --json')
  expect(legacyGet.exit).toBe('2')
  const legacySet = await runJob('76-legacy-auto-retry-set', [
    `printf '%s' '{"enabled":true,"mode":"recommended"}' | cliloom workflow auto-retry set assistant-config-e2e term --stdin --expected-revision 4 --json`
  ].join('\n'))
  expect(legacySet.exit).toBe('2')
  expect(JSON.parse(legacySet.stderr).error.code).toBe('INVALID_ARGUMENT')
})

test('assistant updates widths, shells, and skins with live application sync', async () => {
  const width = await runJob('80-layout', 'cliloom settings set layout.projectRailWidth 200 --json')
  expect(width.exit).toBe('0')
  expect(JSON.parse(width.stdout)).toMatchObject({
    key: 'layout.projectRailWidth',
    value: '200',
    appliesTo: 'immediate'
  })
  await expect.poll(readProjectRailWidth).toBe('200px')
  await expect.poll(readTaskSidebarWidth).toBe('168px')

  const shells = await runJob('90-shell-list', 'cliloom shell list --json')
  expect(shells.exit).toBe('0')
  const shellSnapshot = JSON.parse(shells.stdout) as { shell: ShellSnapshot }
  expect(shellSnapshot.shell.candidates.length).toBeGreaterThan(0)
  expect(shells.stdout).not.toContain('CLILOOM_ASSISTANT_BRIDGE_TOKEN')
  const candidate = shellSnapshot.shell.candidates[0]

  const select = await runJob('100-shell-select', `cliloom shell select '${candidate.id}' --json`)
  expect(select.exit).toBe('0')
  expect(JSON.parse(select.stdout)).toMatchObject({
    command: 'shell.select',
    appliesTo: 'new-workflows-and-next-assistant-session'
  })
  await expect.poll(async () => (
    (await mainPage.evaluate(() => window.cliLoom?.getShells())) as ShellSnapshot
  ).preferences.selection.mode).toBe('explicit')

  // The running assistant session keeps its bridge: another job still works.
  const alive = await runJob('110-alive', 'cliloom settings get layout.taskSidebarWidth')
  expect(alive.exit).toBe('0')
  expect(alive.stdout.trim()).toBe('168')

  const skin = await runJob('120-skin-duplicate', 'cliloom skin duplicate builtin.dark.neutral --json')
  expect(skin.exit).toBe('0')
  const created = (JSON.parse(skin.stdout) as { skin: { id: string; name: string; builtin: boolean; content: UserSkin } }).skin
  expect(created.builtin).toBe(false)
  expect(created.id).not.toBe('builtin.dark.neutral')

  const updatePayload = JSON.stringify({
    mode: created.content.mode,
    colors: created.content.colors,
    typography: { codeFontFamily: 'Test Mono', fontSize: 18, lineHeight: 1.6 },
    radius: 1,
    background: created.content.background,
    spacingScale: 1.25
  })
  const updated = await runJob('130-skin-update', [
    `printf '%s' '${updatePayload}' | cliloom skin update '${created.id}' --stdin --json`
  ].join('\n'))
  expect(updated.exit, `skin update stderr: ${updated.stderr}`).toBe('0')
  expect((JSON.parse(updated.stdout) as { skin: { content: UserSkin } }).skin.content.typography.fontSize).toBe(18)
  expect((JSON.parse(updated.stdout) as { skin: { name: string } }).skin.name).toContain('copy')

  const userSkins = await mainPage.evaluate(async () => {
    const response = await window.cliLoom?.bootstrap()
    return (response?.settings.skins ?? []) as UserSkin[]
  })
  const fromApp = userSkins.find((item) => item.id === created.id)
  expect(fromApp?.typography.codeFontFamily).toBe('Test Mono')
  createdSkinId = created.id
  selectedCandidatePath = candidate.executablePath

  // Activating the skin through the assistant syncs both existing windows.
  const assistantPage = electronApp.windows().find((page) => page.url().includes('assistant.html'))
  expect(assistantPage).toBeTruthy()
  const readThemeBackground = async (page: Page): Promise<string> => page.evaluate(() => (
    getComputedStyle(document.documentElement).getPropertyValue('--background').trim()
  ))
  const mainBefore = await readThemeBackground(mainPage)
  const assistantBefore = await readThemeBackground(assistantPage!)
  expect(mainBefore).toBe(assistantBefore)

  const activated = await runJob(
    '135-skin-activate',
    `cliloom settings set appearance.skin '${created.id}' --json`
  )
  expect(activated.exit).toBe('0')

  await expect.poll(() => readThemeBackground(mainPage)).not.toBe(mainBefore)
  await expect.poll(() => readThemeBackground(assistantPage!)).not.toBe(assistantBefore)
})

test('assistant configuration persists across an application restart', async () => {
  await electronApp.close()
  await launchApplication()

  const record = await mainPage.evaluate(async () => {
    if (!window.cliLoom) throw new Error('Missing main preload API')
    const records = (await window.cliLoom.listWorkflows()) as Array<{
      revision: number
      workflow: WorkflowDefinition
    }>
    return records.find((item) => item.workflow.id === 'assistant-config-e2e')
  })
  expect(record?.revision).toBe(4)
  const terminal = record?.workflow.nodes.find((node) => node.id === 'term')
  expect(terminal?.config).toMatchObject({
    autoRetry: { enabled: true, mode: 'cron', cron: '*/15 * * * *', maxRetries: null }
  })

  await expect.poll(readProjectRailWidth).toBe('200px')
  await expect.poll(readTaskSidebarWidth).toBe('168px')

  const shellSnapshot = await mainPage.evaluate(() => window.cliLoom?.getShells()) as ShellSnapshot
  expect(shellSnapshot.preferences.selection.mode).toBe('explicit')

  const settingsSnapshot = await mainPage.evaluate(async () => {
    const response = await window.cliLoom?.bootstrap()
    return response?.settings
  })
  expect(settingsSnapshot?.appearance.activeSkinId).toBe(createdSkinId)

  // The next assistant session resolves the newly selected shell.
  await openAssistantAndWaitForFirstJob()
  const doctor = await runJob('140-post-restart-doctor', 'cliloom doctor --json')
  expect(doctor.exit).toBe('0')
  expect(doctor.stdout).not.toContain('CLILOOM_ASSISTANT_BRIDGE_TOKEN')
  const doctorShell = (JSON.parse(doctor.stdout) as {
    shell: { selection: string; executablePath: string | null }
  }).shell
  expect(doctorShell.selection).toBe('explicit')
  expect(doctorShell.executablePath).toBe(selectedCandidatePath)
})
