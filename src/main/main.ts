import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  screen,
  session,
  shell
} from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { APP_ID, APP_NAME, APP_USER_DATA_DIRECTORY_NAME } from '../shared/branding'
import { resolveLanguageFromLocale, type LayoutPreferences } from '../shared/appSettings'
import type { SkinContent } from '../shared/appSettings'
import { MAX_IMPORT_BYTES } from '../shared/skin'
import { initMainI18n, setMainI18nLanguage, t } from './i18n'
import {
  addProject,
  getLastOpenedWorkspace,
  getTaskContext,
  listProjects,
  listTasks,
  openDatabase,
  reorderProjects,
  setLastOpenedWorkspace,
  updateProjectName,
  updateTaskTitle,
  type AppDatabase
} from './database'
import { ProcessRunner } from './processRunner'
import {
  listTaskTerminalSessions,
  resolveTaskSessionTranscript
} from './terminalSessionAccess'
import {
  compactLegacyStorage,
  reclaimDatabaseSpaceIfNeeded
} from './databaseMaintenance'
import { IdleMaintenanceScheduler } from './idleMaintenanceScheduler'
import { rebuildRuntimeShellEnvironment } from './shellEnvironment'
import { WorkflowRuntimeService } from './workflowRuntimeService'
import { reconcileRecoverableRuntimeState } from './runtimePersistence'
import { deleteProjectWithProcesses, deleteTaskWithProcesses } from './taskCleanup'
import { getAssistantCliArguments, runAssistantCliMode } from './assistantCli'
import { AssistantCommandHandler } from './assistantCommandHandler'
import { AssistantTerminalService } from './assistantTerminalService'
import { AssistantWindowManager } from './assistantWindowManager'
import {
  ensureAssistantWorkspace,
  WINDOWS_ASSISTANT_CLI_EXECUTABLE
} from './assistantWorkspace'
import {
  BUILD_IDENTITY_FILE,
  loadApplicationBuildIdentity,
  type ApplicationBuildIdentity
} from './buildIdentity'
import {
  createDesktopInstanceLaunchData,
  launchReplacementExecutable,
  resolvePortableExecutablePath,
  type DesktopInstanceLaunchData
} from './instanceHandoff'
import { InstanceHandoffCoordinator } from './instanceHandoffCoordinator'
import { SettingsService } from './settingsService'
import { ShellService } from './shellService'
import { isUnsupportedProjectPath } from '../shared/projectPath'
import type { TerminalRetryMode } from '../shared/terminalSession'
import { clampWindowBounds } from './windowState'
import { WorkflowConfigService } from './workflowConfigService'
import { buildApplicationMenuTemplate } from './applicationMenu'
import { InstalledFontService } from './installedFonts'
import { createElectronUpdaterAdapter } from './electronUpdaterAdapter'
import { coordinateUpdateInstall } from './updateInstallCoordinator'
import { readUpdatePackageTypeMarker, UpdateService } from './updateService'
import {
  createSecureWebPreferences,
  installDevToolsShortcut,
  installNavigationGuards,
  installPermissionHandlers,
  isTrustedIpcSender,
  isTrustedWindowContents,
  resolveDevelopmentServerUrl,
  resolveRendererUrl,
  type IpcSenderEvent
} from './windowSecurity'

const THEME_READY_TIMEOUT_MS = 5_000
const WINDOW_STATE_DEBOUNCE_MS = 300
const DATABASE_MAINTENANCE_IDLE_DELAY_MS = 5_000
const DATABASE_MAINTENANCE_RETRY_DELAY_MS = 30_000
const ENABLE_PACKAGED_RENDERER_DEVTOOLS = true

let mainWindow: BrowserWindow | null = null
let mainThemeReady = false
let mainThemeTimer: NodeJS.Timeout | null = null
let mainStateTimer: NodeJS.Timeout | null = null
let allowMainWindowDestroy = false
let mainWindowClosing: Promise<void> | null = null
let db: AppDatabase
let runner: ProcessRunner
let workflowRuntime: WorkflowRuntimeService
let settingsService: SettingsService
let shellService: ShellService
let workflowConfigService: WorkflowConfigService
let assistantTerminalService: AssistantTerminalService
let assistantCommandHandler: AssistantCommandHandler
let assistantWindowManager: AssistantWindowManager
let runtimeEnvironment: NodeJS.ProcessEnv = process.env
let quitCleanup: Promise<void> | null = null
let allowApplicationQuit = false
let databaseMaintenanceScheduler: IdleMaintenanceScheduler | null = null
let developmentServerUrl: URL | null = null
let mainRendererUrl: string | null = null
let applicationBuildIdentity: ApplicationBuildIdentity | null = null
let updateService: UpdateService
let desktopInitialized = false
const installedFontService = new InstalledFontService()

const assistantCliArguments = getAssistantCliArguments(process.argv)
if (assistantCliArguments) {
  void runAssistantCliMode(assistantCliArguments).then(
    (exitCode) => app.exit(exitCode),
    (error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
      app.exit(10)
    }
  )
} else {
  startDesktopApplication()
}

function startDesktopApplication(): void {
  app.setAppUserModelId(APP_ID)
  app.setName(APP_NAME)
  app.setPath('userData', path.join(app.getPath('appData'), APP_USER_DATA_DIRECTORY_NAME))
  try {
    applicationBuildIdentity = loadApplicationBuildIdentity({
      filePath: path.join(app.getAppPath(), ...BUILD_IDENTITY_FILE.split('/')),
      appVersion: app.getVersion(),
      required: app.isPackaged
    })
  } catch (error) {
    dialog.showErrorBox(
      t('errors:startup.failedTitle'),
      error instanceof Error ? error.message : String(error)
    )
    app.exit(10)
    return
  }
  const buildIdentity = applicationBuildIdentity
  const instanceLaunchData = createDesktopInstanceLaunchData({
    identity: buildIdentity,
    environment: process.env
  })
  if (!app.requestSingleInstanceLock(instanceLaunchData)) {
    app.quit()
    return
  }

  const instanceHandoffCoordinator = new InstanceHandoffCoordinator({
    getCurrentIdentity: () => applicationBuildIdentity,
    focusCurrent: showMainApplicationWindow,
    confirmSwitch: confirmInstanceSwitch,
    showUnavailable: showHandoffUnavailableDialog,
    resolveExecutablePath: (candidate) => resolvePortableExecutablePath({
      PORTABLE_EXECUTABLE_FILE: candidate
    }, process.platform),
    cleanupCurrent: beginSafeApplicationCleanup,
    onCleanupFailed: (error) => {
      quitCleanup = null
      showUnsafeExitError(error)
    },
    releaseSingleInstanceLock: () => app.releaseSingleInstanceLock(),
    launchReplacement: (executablePath) => launchReplacementExecutable(executablePath),
    onLaunchFailed: showReplacementLaunchFailed,
    quitCurrent: quitAfterInstanceHandoff,
    onUnexpectedError: (error) => {
      console.error('Second application instance handling failed:', error)
    }
  })

  app.on('second-instance', (_event, _argv, _workingDirectory, additionalData) => {
    instanceHandoffCoordinator.enqueue(additionalData)
  })

  app.on('before-quit', (event) => {
    if (allowApplicationQuit) return
    event.preventDefault()
    if (quitCleanup) return
    void completeNormalApplicationQuit()
  })

  void app.whenReady().then(async () => {
    developmentServerUrl = resolveDevelopmentServerUrl(
      process.env.VITE_DEV_SERVER_URL,
      app.isPackaged
    )
    const menuTemplate = buildApplicationMenuTemplate(process.platform)
    Menu.setApplicationMenu(menuTemplate ? Menu.buildFromTemplate(menuTemplate) : null)
    initMainI18n(resolveLanguageFromLocale(app.getLocale()))
    db = openDatabase(app.getPath('userData'))
    settingsService = new SettingsService(db, process.env)
    const detectedLanguage = settingsService.detectLanguageFromSystemLocale(app.getLocale())
    settingsService.ensureDetectedLanguage(detectedLanguage)
    settingsService.normalizeAppearanceOnStart(detectedLanguage)
    initMainI18n(settingsService.getSnapshot().appearance.language)
    updateService = new UpdateService({
      currentVersion: app.getVersion(),
      isPackaged: app.isPackaged,
      environment: process.env,
      packageTypeMarker: readUpdatePackageTypeMarker(process.resourcesPath),
      adapterFactory: createElectronUpdaterAdapter,
      openExternal: (url) => shell.openExternal(url).then(() => undefined)
    })
    shellService = new ShellService({ settingsService, environment: process.env })
    await shellService.refresh()
    runtimeEnvironment = (await rebuildRuntimeShellEnvironment({
      baseEnvironment: process.env,
      shellService,
      consumers: [settingsService]
    })).environment
    workflowConfigService = new WorkflowConfigService(db)
    const runtimeDirectory = path.join(app.getPath('userData'), 'runtime')
    fs.mkdirSync(runtimeDirectory, { recursive: true, mode: 0o700 })
    runner = new ProcessRunner(
      db,
      () => mainWindow,
      runtimeEnvironment,
      shellService,
      undefined,
      runtimeDirectory
    )
    reconcileRecoverableRuntimeState(db, {
      isTerminalSessionLive: (session) => runner.hasLiveSession(session.id)
    })
    workflowRuntime = new WorkflowRuntimeService(
      db,
      runner,
      () => mainWindow,
      () => scheduleDatabaseMaintenance(),
      shellService
    )
    databaseMaintenanceScheduler = new IdleMaintenanceScheduler({
      idleDelayMs: DATABASE_MAINTENANCE_IDLE_DELAY_MS,
      retryDelayMs: DATABASE_MAINTENANCE_RETRY_DELAY_MS,
      isIdle: isDatabaseMaintenanceIdle,
      run: runDatabaseMaintenance,
      onError: (error) => {
        console.error('[DatabaseMaintenance] failed:', error)
      }
    })

    const workspace = ensureAssistantWorkspace({
      userDataPath: app.getPath('userData'),
      executablePath: process.execPath,
      appVersion: buildIdentity.appVersion,
      buildId: buildIdentity.buildId,
      ...(process.platform === 'win32'
        ? {
            windowsConsoleLauncherPath: app.isPackaged
              ? path.join(path.dirname(process.execPath), WINDOWS_ASSISTANT_CLI_EXECUTABLE)
              : path.join(app.getAppPath(), 'dist', 'native', WINDOWS_ASSISTANT_CLI_EXECUTABLE)
          }
        : {}),
      ...(process.defaultApp ? { appEntryPath: app.getAppPath() } : {}),
      noSandbox: app.commandLine.hasSwitch('no-sandbox')
    })
    assistantCommandHandler = new AssistantCommandHandler({
      workflowService: workflowConfigService,
      settingsService,
      listProjects: () => listProjects(db),
      workspace,
      appVersion: app.getVersion(),
      environment: runtimeEnvironment,
      shellService,
      confirmDelete: confirmAssistantWorkflowDelete
    })
    assistantTerminalService = new AssistantTerminalService({
      workspace,
      environment: runtimeEnvironment,
      commandHandler: assistantCommandHandler,
      shellService
    })
    assistantWindowManager = new AssistantWindowManager({
      settingsService,
      terminalService: assistantTerminalService,
      preloadPath: path.join(__dirname, 'assistantPreload.js'),
      rendererPath: path.join(__dirname, '../../renderer/assistant.html'),
      enableDevTools: !app.isPackaged || ENABLE_PACKAGED_RENDERER_DEVTOOLS,
      ...(developmentServerUrl
        ? { devServerUrl: developmentServerUrl }
        : {})
    })
    installPermissionHandlers(session.defaultSession, (webContents, requestingUrl) => (
      isMainWindowContents(webContents, requestingUrl) ||
      assistantWindowManager.isTrustedContents(webContents, requestingUrl)
    ))

    registerIpc()
    registerServiceBroadcasts()
    createWindow()
    desktopInitialized = true
    instanceHandoffCoordinator.markInitialized()
    scheduleDatabaseMaintenance()

    app.on('activate', () => {
      if (!mainWindow) createWindow()
    })
  }).catch((error) => {
    console.error('App initialization failed:', error)
    dialog.showErrorBox(t('errors:startup.failedTitle'), error instanceof Error ? error.message : String(error))
    app.quit()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}

async function confirmInstanceSwitch(
  currentIdentity: ApplicationBuildIdentity,
  incoming: DesktopInstanceLaunchData
): Promise<boolean> {
  const currentDescription = formatBuildDescription({
    appVersion: currentIdentity.appVersion,
    buildId: currentIdentity.buildId,
    architecture: currentIdentity.architecture
  })
  const incomingDescription = formatBuildDescription(incoming)
  const options: Electron.MessageBoxOptions = {
    type: 'question',
    title: t('common:instanceHandoff.title'),
    message: t('common:instanceHandoff.message'),
    detail: t('common:instanceHandoff.detail', {
      current: currentDescription,
      incoming: incomingDescription
    }),
    buttons: [t('common:action.cancel'), t('common:action.switchAndRestart')],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  }
  const parent = getVisibleDialogParent()
  const result = parent
    ? await dialog.showMessageBox(parent, options)
    : await dialog.showMessageBox(options)
  return result.response === 1
}

function showReplacementLaunchFailed(error: unknown): void {
  console.error('Replacement portable application failed to launch:', error)
  dialog.showErrorBox(
    t('common:instanceHandoff.launchFailedTitle'),
    t('common:instanceHandoff.launchFailedMessage', {
      detail: error instanceof Error ? error.message : String(error)
    })
  )
}

function quitAfterInstanceHandoff(): void {
  allowMainWindowDestroy = true
  allowApplicationQuit = true
  app.quit()
}

async function showHandoffUnavailableDialog(incoming: DesktopInstanceLaunchData): Promise<void> {
  const options: Electron.MessageBoxOptions = {
    type: 'info',
    title: t('common:instanceHandoff.unavailableTitle'),
    message: t('common:instanceHandoff.unavailableMessage'),
    detail: t('common:instanceHandoff.unavailableDetail', {
      incoming: formatBuildDescription(incoming)
    }),
    buttons: [t('common:action.ok')],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  }
  const parent = getVisibleDialogParent()
  if (parent) {
    await dialog.showMessageBox(parent, options)
  } else {
    await dialog.showMessageBox(options)
  }
}

function getVisibleDialogParent(): BrowserWindow | null {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) return mainWindow
  const assistantWindow = assistantWindowManager?.getWindow?.() ?? null
  return assistantWindow && !assistantWindow.isDestroyed() && assistantWindow.isVisible()
    ? assistantWindow
    : null
}

function formatBuildDescription(build: {
  appVersion: string
  buildId: string
  architecture: string
}): string {
  return `${build.appVersion} / ${build.architecture} / ${build.buildId}`
}

function showMainApplicationWindow(): void {
  if (!desktopInitialized) return
  if (mainWindowClosing) {
    void mainWindowClosing.then(() => showMainApplicationWindow())
    return
  }
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    return
  }
  if (!mainThemeReady) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function beginSafeApplicationCleanup(): Promise<void> {
  if (!quitCleanup) {
    quitCleanup = (async () => {
      await Promise.all([
        workflowRuntime?.shutdown?.()
          ?? runner?.killAll?.().then(() => undefined)
          ?? Promise.resolve(),
        assistantWindowManager?.close?.() ?? Promise.resolve()
      ])
      databaseMaintenanceScheduler?.stop()
    })()
  }
  return quitCleanup
}

async function completeNormalApplicationQuit(): Promise<void> {
  try {
    await beginSafeApplicationCleanup()
    allowMainWindowDestroy = true
    allowApplicationQuit = true
    app.quit()
  } catch (error) {
    console.error('App process cleanup failed:', error)
    quitCleanup = null
    showUnsafeExitError(error)
    if (!mainWindow && app.isReady() && desktopInitialized) createWindow()
  }
}

function showUnsafeExitError(error: unknown): void {
  dialog.showErrorBox(
    t('errors:exit.unsafeTitle'),
    t('errors:exit.unsafeMessage', {
      detail: error instanceof Error ? error.message : String(error)
    })
  )
}

function createWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) return
  const rendererUrl = resolveRendererUrl({
    rendererPath: path.join(__dirname, '../../renderer/index.html'),
    devServerUrl: developmentServerUrl
  })
  const primary = screen.getPrimaryDisplay().workArea
  const savedState = settingsService.getMainWindowState()
  const defaultBounds = {
    x: primary.x + Math.max(0, Math.floor((primary.width - Math.min(1440, primary.width)) / 2)),
    y: primary.y + Math.max(0, Math.floor((primary.height - Math.min(920, primary.height)) / 2)),
    width: Math.min(1440, primary.width),
    height: Math.min(920, primary.height)
  }
  const bounds = clampWindowBounds(
    savedState?.bounds ?? defaultBounds,
    screen.getAllDisplays().map((display) => display.workArea),
    primary
  )
  const window = new BrowserWindow({
    ...bounds,
    minWidth: Math.min(720, primary.width),
    minHeight: Math.min(600, primary.height),
    show: false,
    title: APP_NAME,
    webPreferences: createSecureWebPreferences({
      preloadPath: path.join(__dirname, 'preload.js'),
      enableDevTools: !app.isPackaged || ENABLE_PACKAGED_RENDERER_DEVTOOLS
    })
  })
  mainWindow = window
  mainRendererUrl = rendererUrl
  mainThemeReady = false
  allowMainWindowDestroy = false
  installDevToolsShortcut(window.webContents)
  installNavigationGuards(window.webContents, rendererUrl)
  installMainWindowListeners(window)
  if (savedState?.maximized) window.maximize()

  void window.loadURL(rendererUrl).catch((error) => {
    console.error('Failed to load renderer:', error)
  })

  mainThemeTimer = setTimeout(() => {
    if (window !== mainWindow || window.isDestroyed() || mainThemeReady) return
    mainThemeReady = true
    window.show()
  }, THEME_READY_TIMEOUT_MS)
}

function installMainWindowListeners(window: BrowserWindow): void {
  const scheduleStateSave = () => {
    if (window.isDestroyed() || window.isMinimized()) return
    if (mainStateTimer) clearTimeout(mainStateTimer)
    mainStateTimer = setTimeout(() => saveMainWindowState(window), WINDOW_STATE_DEBOUNCE_MS)
  }
  window.on('move', scheduleStateSave)
  window.on('resize', scheduleStateSave)
  window.on('maximize', scheduleStateSave)
  window.on('unmaximize', scheduleStateSave)
  window.on('close', (event) => {
    if (allowMainWindowDestroy) return
    event.preventDefault()
    if (mainWindowClosing) return
    mainWindowClosing = (async () => {
      saveMainWindowState(window)
      allowMainWindowDestroy = true
      if (!window.isDestroyed()) window.destroy()
    })().finally(() => {
      mainWindowClosing = null
    })
  })
  window.on('closed', () => {
    if (mainThemeTimer) clearTimeout(mainThemeTimer)
    if (mainStateTimer) clearTimeout(mainStateTimer)
    mainThemeTimer = null
    mainStateTimer = null
    if (mainWindow === window) {
      mainWindow = null
      mainRendererUrl = null
    }
    allowMainWindowDestroy = false
    mainThemeReady = false
  })
}

function saveMainWindowState(window: BrowserWindow): void {
  if (window.isDestroyed() || window.isMinimized()) return
  settingsService.setMainWindowState({
    version: 1,
    bounds: window.getNormalBounds(),
    maximized: window.isMaximized()
  })
}

async function refreshRuntimeEnvironment() {
  await shellService.refresh()
  const rebuilt = await rebuildRuntimeShellEnvironment({
    baseEnvironment: process.env,
    shellService,
    consumers: [
      settingsService,
      runner,
      assistantTerminalService,
      assistantCommandHandler
    ]
  })
  runtimeEnvironment = rebuilt.environment
  return rebuilt.shell
}

function scheduleDatabaseMaintenance(
  delayMs = DATABASE_MAINTENANCE_IDLE_DELAY_MS
): void {
  if (quitCleanup || allowApplicationQuit) return
  databaseMaintenanceScheduler?.request(delayMs)
}

function isDatabaseMaintenanceIdle(): boolean {
  return !quitCleanup &&
    !runner.hasActiveProcesses() &&
    !workflowRuntime.hasActiveTasks()
}

async function runDatabaseMaintenance(): Promise<boolean> {
  const cleanup = await compactLegacyStorage(db, {
    canContinue: isDatabaseMaintenanceIdle
  })
  if (!cleanup.completed || !isDatabaseMaintenanceIdle()) return false

  const reclaim = reclaimDatabaseSpaceIfNeeded(db, {
    canRun: isDatabaseMaintenanceIdle
  })
  if (
    cleanup.processLogsDeleted > 0 ||
    cleanup.transcriptsCompacted > 0 ||
    reclaim.vacuumed
  ) {
    console.info('[DatabaseMaintenance] completed', {
      processLogsDeleted: cleanup.processLogsDeleted,
      transcriptsCompacted: cleanup.transcriptsCompacted,
      reclaimableBytesBefore: reclaim.before.reclaimableBytes,
      vacuumed: reclaim.vacuumed
    })
  }
  return true
}

function registerIpc(): void {
  ipcMain.handle('app:bootstrap', (event) => {
    assertMainSender(event)
    const workflowRecords = workflowConfigService.list()
    return {
      workflows: workflowRecords.map((record) => record.workflow),
      workflowRecords,
      settings: settingsService.getSnapshot(),
      shell: shellService.getSnapshot(),
      projects: listProjects(db),
      terminalSessions: [],
      lastOpenedWorkspace: getLastOpenedWorkspace(db)
    }
  })

  ipcMain.handle('settings:get-skin', (event) => {
    assertMainSender(event)
    return settingsService.resolveActiveSkin()
  })
  ipcMain.handle('settings:get-installed-font-families', (event) => {
    assertMainSender(event)
    return installedFontService.list()
  })
  ipcMain.handle('settings:set-active-skin', (event, id: string) => {
    assertSettingsSender(event)
    return settingsService.setActiveSkin(id)
  })
  ipcMain.handle('settings:create-skin', (event, name: string, content: SkinContent) => {
    assertSettingsSender(event)
    return settingsService.createUserSkin(name, content)
  })
  ipcMain.handle('settings:update-user-skin', (event, id: string, content: SkinContent) => {
    assertSettingsSender(event)
    return settingsService.updateUserSkin(id, content)
  })
  ipcMain.handle('settings:rename-skin', (event, id: string, name: string) => {
    assertSettingsSender(event)
    return settingsService.renameUserSkin(id, name)
  })
  ipcMain.handle('settings:delete-skin', (event, id: string) => {
    assertSettingsSender(event)
    return settingsService.deleteUserSkin(id)
  })
  ipcMain.handle('settings:duplicate-skin', (event, id: string) => {
    assertSettingsSender(event)
    return settingsService.duplicateSkin(id)
  })
  ipcMain.handle('settings:export-skin', async (event, id: string) => {
    assertSettingsSender(event)
    const json = settingsService.exportSkin(id)
    const targetWindow = mainWindow ?? undefined
    const saveOptions = {
      defaultPath: `cliloom-skin.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    } as Electron.SaveDialogOptions
    const result = targetWindow
      ? await dialog.showSaveDialog(targetWindow, saveOptions)
      : await dialog.showSaveDialog(saveOptions)
    if (result.canceled || !result.filePath) return { canceled: true as const }
    await fs.promises.writeFile(result.filePath, json, 'utf8')
    return { canceled: false as const, path: result.filePath }
  })
  ipcMain.handle('settings:import-skin', async (event) => {
    assertSettingsSender(event)
    const targetWindow = mainWindow ?? undefined
    const openOptions = {
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile']
    } as Electron.OpenDialogOptions
    const result = targetWindow
      ? await dialog.showOpenDialog(targetWindow, openOptions)
      : await dialog.showOpenDialog(openOptions)
    if (result.canceled || result.filePaths.length === 0) return { canceled: true as const }
    const filePath = result.filePaths[0]
    const stat = await fs.promises.stat(filePath)
    if (stat.size > MAX_IMPORT_BYTES) throw new Error(t('skin:error.parseFailed'))
    const raw = await fs.promises.readFile(filePath, 'utf8')
    const skin = settingsService.importSkin(raw)
    return { canceled: false as const, skin }
  })
  ipcMain.handle('settings:update-language', (event, value: unknown) => {
    assertSettingsSender(event)
    return settingsService.setLanguage(value)
  })
  ipcMain.handle('settings:update-layout', (event, value: LayoutPreferences) => {
    assertMainSender(event)
    return settingsService.setLayout(value)
  })
  ipcMain.handle('settings:get-shells', (event) => {
    assertSettingsSender(event)
    return shellService.getSnapshot()
  })
  ipcMain.handle('settings:refresh-shells', async (event) => {
    assertSettingsSender(event)
    return refreshRuntimeEnvironment()
  })
  ipcMain.handle('settings:update-shell', async (event, shellId: unknown) => {
    assertSettingsSender(event)
    shellService.select(shellId)
    await refreshRuntimeEnvironment()
    await shellService.resolveEffectiveTarget()
    return shellService.getSnapshot()
  })
  ipcMain.handle('updates:get-state', (event) => {
    assertMainSender(event)
    return updateService.getState()
  })
  ipcMain.handle('updates:check', (event) => {
    assertMainSender(event)
    return updateService.checkForUpdates()
  })
  ipcMain.handle('updates:open-release', (event) => {
    assertMainSender(event)
    return updateService.openRelease()
  })
  ipcMain.handle('updates:install', async (event) => {
    assertMainSender(event)
    if (!updateService.beginInstall()) {
      throw new Error(t('errors:update.installUnavailable'))
    }
    try {
      await coordinateUpdateInstall({
        cleanup: beginSafeApplicationCleanup,
        allowQuit: () => {
          allowMainWindowDestroy = true
          allowApplicationQuit = true
        },
        disallowQuit: () => {
          allowMainWindowDestroy = false
          allowApplicationQuit = false
        },
        quitAndInstall: () => updateService.quitAndInstall()
      })
    } catch {
      console.error('[UpdateService] install coordination failed')
      allowMainWindowDestroy = false
      allowApplicationQuit = false
      quitCleanup = null
      updateService.reportInstallFailure()
      showUnsafeExitError(new Error(t('errors:update.installCoordinationFailed')))
      if (!mainWindow && app.isReady() && desktopInitialized) createWindow()
    }
    return updateService.getState()
  })
  ipcMain.on('app:theme-ready', (event) => {
    if (!isMainSender(event)) return
    mainThemeReady = true
    if (mainThemeTimer) clearTimeout(mainThemeTimer)
    mainThemeTimer = null
    mainWindow?.show()
  })
  ipcMain.handle('assistant:open', async (event) => {
    assertMainSender(event)
    await assistantWindowManager.open()
  })
  ipcMain.handle('workspace:setLastOpened', (event, value: unknown) => {
    assertMainSender(event)
    return setLastOpenedWorkspace(db, value)
  })
  ipcMain.handle('projects:choose-add', async (event) => {
    assertMainSender(event)
    return chooseAndAddProject()
  })
  ipcMain.handle('projects:list', (event) => {
    assertMainSender(event)
    return listProjects(db)
  })
  ipcMain.handle('projects:delete', async (event, projectId: string) => {
    assertMainSender(event)
    await deleteProjectWithProcesses(db, workflowRuntime, projectId)
    scheduleDatabaseMaintenance()
  })
  ipcMain.handle('projects:rename', (event, projectId: string, name: unknown) => {
    assertMainSender(event)
    return updateProjectName(db, projectId, name)
  })
  ipcMain.handle('projects:reorder', (event, projectIds: string[]) => {
    assertMainSender(event)
    return reorderProjects(db, projectIds)
  })
  ipcMain.handle('projects:setDefaultWorkflow', (event, projectId: string, workflowId: string) => {
    assertMainSender(event)
    return workflowConfigService.setProjectDefault(projectId, workflowId)
  })
  ipcMain.handle('tasks:list', (event, projectId: string) => {
    assertMainSender(event)
    return listTasks(db, projectId)
  })
  ipcMain.handle('tasks:context', (event, taskId: string) => {
    assertMainSender(event)
    return getTaskContext(db, taskId)
  })
  ipcMain.handle('tasks:delete', async (event, taskId: string) => {
    assertMainSender(event)
    await deleteTaskWithProcesses(db, workflowRuntime, taskId)
    scheduleDatabaseMaintenance()
  })
  ipcMain.handle('tasks:updateTitle', (event, taskId: string, title: string) => {
    assertMainSender(event)
    return updateTaskTitle(db, taskId, title)
  })
  ipcMain.handle('tasks:sessions', (event, taskId: string) => {
    assertMainSender(event)
    return listTaskTerminalSessions(db, runner, taskId)
  })
  ipcMain.handle('tasks:session-transcript', (event, taskId: string, sessionId: string) => {
    assertMainSender(event)
    return resolveTaskSessionTranscript(db, runner, taskId, sessionId)
  })
  ipcMain.handle('workflows:list', (event) => {
    assertMainSender(event)
    return workflowConfigService.list()
  })
  ipcMain.handle('workflows:save', (event, workflow: unknown, expectedRevision?: number) => {
    assertMainSender(event)
    return workflowConfigService.save(workflow, expectedRevision, 'renderer')
  })
  ipcMain.handle('workflows:delete', (event, workflowId: string, expectedRevision: number) => {
    assertMainSender(event)
    return workflowConfigService.delete(workflowId, expectedRevision, 'renderer')
  })
  ipcMain.handle('designer:set-state', (event, value: unknown) => {
    assertMainSender(event)
    return workflowConfigService.setDesignerState(value)
  })
  ipcMain.handle('process:retry', async (
    event,
    sessionId: string,
    mode: TerminalRetryMode
  ) => {
    assertMainSender(event)
    if (typeof sessionId !== 'string' || !sessionId) throw new Error(t('errors:session.invalidId'))
    if (mode !== 'workflow' && mode !== 'standalone') {
      throw new Error(t('errors:session.retryDataInvalid'))
    }
    return { sessionId: await workflowRuntime.retryTerminal(sessionId, mode) }
  })
  ipcMain.on('process:write', (event, sessionId: string, input: string) => {
    if (!isMainSender(event)) return
    runner.write(sessionId, input)
  })
  ipcMain.handle('process:isInputReady', (event, sessionId: string) => {
    assertMainSender(event)
    return runner.isInputReady(sessionId)
  })
  ipcMain.handle('process:resize', (event, sessionId: string, cols: number, rows: number) => {
    assertMainSender(event)
    const width = Math.floor(cols)
    const height = Math.floor(rows)
    if (!(width > 0 && height > 0 && width <= 500 && height <= 500)) return false
    return runner.resize(sessionId, width, height)
  })
  ipcMain.handle('process:kill', (event, sessionId: string) => {
    assertMainSender(event)
    return runner.kill(sessionId)
  })
  ipcMain.handle('workflow:start', (event, request) => {
    assertMainSender(event)
    return workflowRuntime.start(request)
  })
  ipcMain.handle('workflow:retryNode', (
    event,
    taskId: string,
    nodeId: string,
    branchId?: string
  ) => {
    assertMainSender(event)
    if (
      typeof taskId !== 'string' || !taskId ||
      typeof nodeId !== 'string' || !nodeId ||
      (branchId !== undefined && (typeof branchId !== 'string' || !branchId))
    ) throw new Error(t('errors:session.invalidId'))
    return workflowRuntime.retryNode(taskId, nodeId, branchId)
  })
  ipcMain.handle('workflow:updateVariables', (event, taskId: string, variables, branchId?: string) => {
    assertMainSender(event)
    return workflowRuntime.updateVariables(taskId, variables, branchId)
  })
  ipcMain.handle('workflow:stop', (event, taskId: string) => {
    assertMainSender(event)
    return workflowRuntime.stop(taskId)
  })
  ipcMain.handle('workflow:restoreState', (event, taskId: string) => {
    assertMainSender(event)
    return workflowRuntime.restore(taskId)
  })

  ipcMain.handle('assistant:bootstrap', (event) => {
    assertAssistantSender(event)
    return {
      settings: settingsService.getSnapshot(),
      shell: shellService.getSnapshot(),
      status: assistantTerminalService.getStatus(),
      transcript: assistantTerminalService.getTranscript()
    }
  })
  ipcMain.handle('assistant:validate-command', async (event, command: string) => {
    assertAssistantSender(event)
    return assistantTerminalService.validate(command)
  })
  ipcMain.handle(
    'assistant:save-config',
    async (event, command: string, action: 'save' | 'restart') => {
      assertAssistantSender(event)
      if (action !== 'save' && action !== 'restart') throw new Error(t('errors:assistant.invalidAction'))
      const validated = await assistantTerminalService.validate(command)
      const saved = settingsService.setAssistantInitializationCommand(command, validated)
      const { config, resolved } = saved
      if (action === 'restart') await assistantTerminalService.restart(config.initializationCommand)
      return { config, resolved, status: assistantTerminalService.getStatus() }
    }
  )
  ipcMain.handle('assistant:restart', async (event) => {
    assertAssistantSender(event)
    const command = settingsService.getSnapshot().assistant.initializationCommand
    if (!command) throw new Error(t('errors:assistant.missingInitCommand'))
    return assistantTerminalService.restart(command)
  })
  ipcMain.on('assistant:write', (event, input: string) => {
    if (!assistantWindowManager.isSender(event)) return
    assistantTerminalService.write(input)
  })
  ipcMain.handle('assistant:resize', (event, cols: number, rows: number) => {
    assertAssistantSender(event)
    return assistantTerminalService.resize(cols, rows)
  })
  ipcMain.handle('assistant:hide', (event) => {
    assertAssistantSender(event)
    assistantWindowManager.hide()
  })
  ipcMain.handle('assistant:close', (event) => {
    assertAssistantSender(event)
    setImmediate(() => void assistantWindowManager.close())
  })
  ipcMain.on('assistant:theme-ready', (event) => {
    if (!assistantWindowManager.isSender(event)) return
    assistantWindowManager.markThemeReady(event)
  })
}

async function chooseAndAddProject() {
  const options = { properties: ['openDirectory'] } as Electron.OpenDialogOptions
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options)
  if (result.canceled || !result.filePaths[0]) return null

  if (isUnsupportedProjectPath(result.filePaths[0])) {
    throw new Error(t('errors:database.projectPathUnsupported'))
  }
  const projectPath = await fs.promises.realpath(result.filePaths[0])
  const stat = await fs.promises.stat(projectPath)
  if (!stat.isDirectory()) throw new Error(t('errors:database.projectPathNotDirectory'))
  return addProject(db, projectPath)
}

function registerServiceBroadcasts(): void {
  updateService.onChanged((state) => {
    mainWindow?.webContents.send('updates:state', state)
  })
  settingsService.onChanged((snapshot) => {
    setMainI18nLanguage(snapshot.appearance.language)
    assistantWindowManager.refreshTitle()
    const shellSnapshot = shellService.getSnapshot()
    mainWindow?.webContents.send('settings:changed', snapshot)
    assistantWindowManager.send('settings:changed', snapshot)
    mainWindow?.webContents.send('shells:changed', shellSnapshot)
    assistantWindowManager.send('shells:changed', shellSnapshot)
  })
  shellService.onChanged((snapshot) => {
    mainWindow?.webContents.send('shells:changed', snapshot)
    assistantWindowManager.send('shells:changed', snapshot)
  })
  workflowConfigService.onWorkflowChanged((event) => {
    mainWindow?.webContents.send('workflows:changed', event)
  })
  workflowConfigService.onProjectChanged((event) => {
    mainWindow?.webContents.send('projects:changed', event)
  })
}

async function confirmAssistantWorkflowDelete(impact: {
  workflowName: string
  workflowId: string
  defaultProjectCount: number
  historicalTaskCount: number
  activeTaskCount: number
}): Promise<boolean> {
  const detail = [
    t('workflow:delete.detailId', { id: impact.workflowId }),
    t('workflow:delete.detailDefaultProjects', { count: impact.defaultProjectCount }),
    t('workflow:delete.detailHistoricalTasks', { count: impact.historicalTaskCount }),
    t('workflow:delete.detailActiveTasks', { count: impact.activeTaskCount })
  ].join('\n')
  const options: Electron.MessageBoxOptions = {
    type: 'warning',
    title: t('workflow:delete.title'),
    message: t('workflow:delete.confirm', { name: impact.workflowName }),
    detail,
    buttons: [t('common:action.cancel'), t('common:action.delete')],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  }
  const parent = assistantWindowManager?.getWindow()
  const result = parent
    ? await dialog.showMessageBox(parent, options)
    : await dialog.showMessageBox(options)
  return result.response === 1
}

function assertMainSender(event: IpcSenderEvent): void {
  if (!isMainSender(event)) throw new Error(t('errors:sender.mainInvalid'))
}

function assertAssistantSender(event: IpcSenderEvent): void {
  if (!assistantWindowManager.isSender(event)) throw new Error(t('errors:sender.assistantInvalid'))
}

function assertSettingsSender(event: IpcSenderEvent): void {
  if (!isMainSender(event) && !assistantWindowManager.isSender(event)) {
    throw new Error(t('errors:sender.settingsInvalid'))
  }
}

function isMainSender(event: IpcSenderEvent): boolean {
  return Boolean(
    mainWindow &&
    !mainWindow.isDestroyed() &&
    mainRendererUrl &&
    isTrustedIpcSender(event, mainWindow.webContents, mainRendererUrl)
  )
}

function isMainWindowContents(
  webContents: Electron.WebContents | null,
  requestingUrl?: string
): boolean {
  return Boolean(
    mainWindow &&
    !mainWindow.isDestroyed() &&
    mainRendererUrl &&
    isTrustedWindowContents(
      webContents,
      mainWindow.webContents,
      mainRendererUrl,
      requestingUrl
    )
  )
}
