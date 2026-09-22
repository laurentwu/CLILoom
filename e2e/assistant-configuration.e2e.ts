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
 *
 * The whole assistant configuration lifecycle runs as one stateful scenario:
 * each step continues the exact database, running windows, and assistant
 * session left by the previous step, so a mid-scenario failure cannot cascade
 * into misleading "persistence lost" reports from later tests.
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
let fixtureDirectory = ''
let jobsDirectory = ''
let resultsDirectory = ''
let scriptDirectory = ''
let createdSkinId = ''
let selectedCandidatePath = ''
let electronApp: ElectronApplication
let mainPage: Page

test.skip(process.platform !== 'linux', 'The assistant configuration e2e runs on the Linux validation job')

let lastJob: { name: string; body: string; stdout: string; stderr: string; exit: string } | null = null

function jobDiagnostics(): string {
  if (!lastJob) return 'no job ran yet'
  const listing = existsSync(resultsDirectory) ? readdirSync(resultsDirectory).join(', ') : ''
  return [
    `last job: ${lastJob.name}`,
    `exit=${lastJob.exit}`,
    `stderr=${lastJob.stderr.slice(0, 500)}`,
    `stdout=${lastJob.stdout.slice(0, 500)}`,
    `results: ${listing}`
  ].join(' | ')
}

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

async function runJob(name: string, body: string): Promise<JobResult> {
  writeFileSync(path.join(jobsDirectory, `${name}.sh`), `${body}\n`)
  await waitForResultFile(`${name}.sh.done`)
  const result = {
    name,
    stdout: readFileSync(path.join(resultsDirectory, `${name}.sh.stdout`), 'utf8'),
    stderr: readFileSync(path.join(resultsDirectory, `${name}.sh.stderr`), 'utf8'),
    exit: readFileSync(path.join(resultsDirectory, `${name}.sh.exit`), 'utf8')
  }
  lastJob = { body, ...result }
  return result
}

/** Parses job stdout as JSON with the failing job's diagnostics attached. */
type JobResult = { name: string; stdout: string; stderr: string; exit: string }
function parseJobJson<T>(job: Pick<JobResult, 'name' | 'stdout'>, label: string): T {
  try {
    return JSON.parse(job.stdout) as T
  } catch (error) {
    throw new Error(
      `${label}: ${job.name} returned invalid JSON (${error instanceof Error ? error.message : String(error)}); ${jobDiagnostics()}`
    )
  }
}

/** Parses a failed job's stderr JSON error with diagnostics attached. */
function parseJobError<T>(job: JobResult, label: string): T {
  try {
    return JSON.parse(job.stderr) as T
  } catch (error) {
    throw new Error(
      `${label}: ${job.name} returned invalid JSON error (${error instanceof Error ? error.message : String(error)}); ${jobDiagnostics()}`
    )
  }
}

/** Asserts a job's exit code with full diagnostics instead of a bare expect. */
function expectJobExit(job: JobResult, label: string, expected: string): void {
  if (job.exit !== expected) {
    throw new Error(`${label}: ${job.name} exited with ${job.exit}, expected ${expected}; ${jobDiagnostics()}`)
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
  fixtureDirectory = mkdtempSync(path.join(tmpdir(), 'cliloom-assistant-config-fixture-'))
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
  if (fixtureDirectory) rmSync(fixtureDirectory, { recursive: true, force: true })
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

test('assistant configuration lifecycle', async () => {
  test.setTimeout(180_000)

  await test.step('discovers capabilities and saves the full workflow lifecycle', async () => {
    const context = await runJob('10-context', 'cliloom context --json')
    expectJobExit(context, 'context', '0')
    expect(context.stderr, `context stderr; ${jobDiagnostics()}`).toBe('')
    const contextData = parseJobJson<{
      schemaVersion: number
      commandDescriptors: Array<{ id: string }>
      publicSettings: Array<{ key: string }>
      workflows: Array<{ id: string; revision: number }>
    }>(context, 'context')
    expect(contextData.schemaVersion).toBe(2)
    const descriptorIds = contextData.commandDescriptors.map((descriptor) => descriptor.id)
    expect(descriptorIds).toContain('workflow.save')
    expect(descriptorIds).not.toContain('workflow.auto-retry.get')
    expect(descriptorIds).not.toContain('workflow.auto-retry.set')
    expect(contextData.publicSettings.map((setting) => setting.key)).toContain('layout.projectRailWidth')
    expect(contextData.workflows).toEqual([expect.objectContaining({ id: 'assistant-config-e2e', revision: 1 })])
    expect(context.stdout).not.toContain('CLILOOM_ASSISTANT_BRIDGE_TOKEN')

    const schema = await runJob('20-schema', 'cliloom workflow schema --json')
    expectJobExit(schema, 'schema', '0')
    const schemaData = parseJobJson<{
      schemaVersion: number
      save: { usage: string }
      nodeConfigs: Record<string, unknown>
      terminalAutoRetry: { examples: Record<string, unknown> }
      examples: Record<string, unknown>
    }>(schema, 'schema')
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
    expectJobExit(read, 'workflow get', '0')
    const record = parseJobJson<{ workflow: WorkflowDefinition; revision: number }>(read, 'workflow get')
    expect(record.revision).toBe(1)
    expect(record.workflow.id).toBe('assistant-config-e2e')

    const set = await runJob('40-workflow-save-recommended', [
      `printf '%s' '${JSON.stringify(withTermAutoRetry(record.workflow, { enabled: true, mode: 'recommended', maxRetries: 5 }))}' | cliloom workflow save --stdin --expected-revision ${record.revision} --json`
    ].join('\n'))
    expectJobExit(set, 'recommended save', '0')
    expect(set.stderr, `recommended save stderr; ${jobDiagnostics()}`).toBe('')
    expect(parseJobJson<{ revision: number }>(set, 'recommended save')).toMatchObject({
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
    expect(dirty.exit, `dirty-guard stderr; ${jobDiagnostics()}`).toBe('2')
    expect(parseJobError<{ error: { code: string } }>(dirty, 'dirty guard').error.code).toBe('VALIDATION_ERROR')

    await mainPage.evaluate(async () => {
      if (!window.cliLoom) throw new Error('Missing main preload API')
      await window.cliLoom.setDesignerState({ workflowId: null, open: false, dirty: false })
    })
    const stale = await runJob('60-workflow-save-stale', [
      `printf '%s' '${JSON.stringify(withTermAutoRetry(record.workflow, { enabled: true, mode: 'cron', cron: '*/15 * * * *', maxRetries: null }))}' | cliloom workflow save --stdin --expected-revision 1 --json`
    ].join('\n'))
    expect(stale.exit).toBe('5')
    expect(parseJobError<{ error: { code: string } }>(stale, 'stale revision').error.code).toBe('WORKFLOW_REVISION_CONFLICT')

    const removal = await runJob('65-workflow-save-removal', [
      `printf '%s' '${JSON.stringify(withTermAutoRetry(record.workflow, undefined))}' | cliloom workflow save --stdin --expected-revision 2 --json`
    ].join('\n'))
    expectJobExit(removal, 'auto-retry removal', '0')
    expect(removal.stderr, jobDiagnostics()).toBe('')
    expect(parseJobJson<{ revision: number }>(removal, 'auto-retry removal')).toMatchObject({ revision: 3 })
    const afterRemoval = await runJob('66-workflow-get-removed', 'cliloom workflow get assistant-config-e2e --json')
    const removedRecord = parseJobJson<{ workflow: WorkflowDefinition; revision: number }>(afterRemoval, 'removed auto-retry get')
    const removedTerminal = removedRecord.workflow.nodes.find((node) => node.id === 'term')
    expect((removedTerminal?.config as Record<string, unknown>).autoRetry).toBeUndefined()
    expect(removedTerminal?.config).toMatchObject({ command: 'sleep 30', retryCommand: 'sleep 30 --retry' })

    const retry = await runJob('70-workflow-save-cron', [
      `printf '%s' '${JSON.stringify(withTermAutoRetry(removedRecord.workflow, { enabled: true, mode: 'cron', cron: '*/15 * * * *', maxRetries: null }))}' | cliloom workflow save --stdin --expected-revision 3 --json`
    ].join('\n'))
    expectJobExit(retry, 'cron save', '0')
    expect(retry.stderr, jobDiagnostics()).toBe('')
    expect(parseJobJson<{ revision: number }>(retry, 'cron save')).toMatchObject({
      revision: 4
    })

    const legacyGet = await runJob('75-legacy-auto-retry-get', 'cliloom workflow auto-retry get assistant-config-e2e term --json')
    expect(legacyGet.exit).toBe('2')
    expect(parseJobError<{ error: { code: string } }>(legacyGet, 'legacy get').error.code).toBe('INVALID_ARGUMENT')
    const legacySet = await runJob('76-legacy-auto-retry-set', [
      `printf '%s' '{"enabled":true,"mode":"recommended"}' | cliloom workflow auto-retry set assistant-config-e2e term --stdin --expected-revision 4 --json`
    ].join('\n'))
    expect(legacySet.exit).toBe('2')
    expect(parseJobError<{ error: { code: string } }>(legacySet, 'legacy set').error.code).toBe('INVALID_ARGUMENT')
  })

  await test.step('syncs layout, shell, and skin settings into running windows', async () => {
    const width = await runJob('80-layout', 'cliloom settings set layout.projectRailWidth 200 --json')
    expectJobExit(width, 'layout', '0')
    expect(parseJobJson<{ key: string; value: string; appliesTo: string }>(width, 'layout')).toMatchObject({
      key: 'layout.projectRailWidth',
      value: '200',
      appliesTo: 'immediate'
    })
    await expect.poll(readProjectRailWidth).toBe('200px')
    await expect.poll(readTaskSidebarWidth).toBe('168px')

    const shells = await runJob('90-shell-list', 'cliloom shell list --json')
    expectJobExit(shells, 'shell list', '0')
    const shellSnapshot = parseJobJson<{ shell: ShellSnapshot }>(shells, 'shell list')
    expect(shellSnapshot.shell.candidates.length).toBeGreaterThan(0)
    expect(shells.stdout).not.toContain('CLILOOM_ASSISTANT_BRIDGE_TOKEN')
    const candidate = shellSnapshot.shell.candidates[0]

    const select = await runJob('100-shell-select', `cliloom shell select '${candidate.id}' --json`)
    expectJobExit(select, 'shell select', '0')
    expect(parseJobJson<{ command: string; appliesTo: string }>(select, 'shell select')).toMatchObject({
      command: 'shell.select',
      appliesTo: 'new-workflows-and-next-assistant-session'
    })
    await expect.poll(async () => (
      (await mainPage.evaluate(() => window.cliLoom?.getShells())) as ShellSnapshot
    ).preferences.selection.mode).toBe('explicit')

    // The running assistant session keeps its bridge: another job still works.
    const alive = await runJob('110-alive', 'cliloom settings get layout.taskSidebarWidth')
    expectJobExit(alive, 'alive check', '0')
    expect(alive.stdout.trim()).toBe('168')

    const skin = await runJob('120-skin-duplicate', 'cliloom skin duplicate builtin.dark.neutral --json')
    expectJobExit(skin, 'skin duplicate', '0')
    const created = (parseJobJson<{ skin: { id: string; name: string; builtin: boolean; content: UserSkin } }>(skin, 'skin duplicate')).skin
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
    expectJobExit(updated, `skin update; ${jobDiagnostics()}`, '0')
    expect((parseJobJson<{ skin: { content: UserSkin } }>(updated, 'skin update')).skin.content.typography.fontSize).toBe(18)
    expect((parseJobJson<{ skin: { name: string } }>(updated, 'skin update')).skin.name).toContain('copy')

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
    expectJobExit(activated, 'skin activate', '0')

    await expect.poll(() => readThemeBackground(mainPage)).not.toBe(mainBefore)
    await expect.poll(() => readThemeBackground(assistantPage!)).not.toBe(assistantBefore)
  })

  await test.step('persists configuration across a restart and the next assistant session', async () => {
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
    expectJobExit(doctor, 'post-restart doctor', '0')
    expect(doctor.stdout).not.toContain('CLILOOM_ASSISTANT_BRIDGE_TOKEN')
    const doctorShell = (parseJobJson<{
      shell: { selection: string; executablePath: string | null }
    }>(doctor, 'post-restart doctor')).shell
    expect(doctorShell.selection).toBe('explicit')
    expect(doctorShell.executablePath).toBe(selectedCandidatePath)
  })
})
