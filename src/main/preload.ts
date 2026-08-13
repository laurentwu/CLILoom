import { contextBridge, ipcRenderer } from 'electron'
import type { LayoutPreferences, SupportedLanguage, Skin, SkinContent, UserSkin } from '../shared/appSettings'
import type { ShellSnapshot } from '../shared/shell'
import type { TerminalDataEvent, TerminalTranscriptSnapshot } from '../shared/terminalBuffer'
import type { UpdateState } from '../shared/update'
import type { TerminalClosedEvent, TerminalRetryMode } from '../shared/terminalSession'

const api = {
  rendererNoSandboxSwitch: process.argv.includes('--no-sandbox'),
  rendererSandboxed: process.sandboxed === true,
  bootstrap: () => ipcRenderer.invoke('app:bootstrap'),
  getActiveSkin: () => ipcRenderer.invoke('settings:get-skin') as Promise<Skin>,
  getInstalledFontFamilies: () =>
    ipcRenderer.invoke('settings:get-installed-font-families') as Promise<string[]>,
  setActiveSkin: (id: string) => ipcRenderer.invoke('settings:set-active-skin', id) as Promise<string>,
  createSkin: (name: string, content: SkinContent) =>
    ipcRenderer.invoke('settings:create-skin', name, content) as Promise<UserSkin>,
  updateUserSkin: (id: string, content: SkinContent) =>
    ipcRenderer.invoke('settings:update-user-skin', id, content) as Promise<UserSkin>,
  renameSkin: (id: string, name: string) =>
    ipcRenderer.invoke('settings:rename-skin', id, name) as Promise<UserSkin>,
  deleteSkin: (id: string) => ipcRenderer.invoke('settings:delete-skin', id) as Promise<void>,
  duplicateSkin: (id: string) => ipcRenderer.invoke('settings:duplicate-skin', id) as Promise<UserSkin>,
  exportSkin: (id: string) =>
    ipcRenderer.invoke('settings:export-skin', id) as Promise<{ canceled: true } | { canceled: false; path: string }>,
  importSkin: () =>
    ipcRenderer.invoke('settings:import-skin') as Promise<{ canceled: true } | { canceled: false; skin: UserSkin }>,
  updateLanguage: (value: SupportedLanguage) => ipcRenderer.invoke('settings:update-language', value),
  updateLayout: (value: LayoutPreferences) => ipcRenderer.invoke('settings:update-layout', value),
  getShells: () => ipcRenderer.invoke('settings:get-shells') as Promise<ShellSnapshot>,
  refreshShells: () => ipcRenderer.invoke('settings:refresh-shells') as Promise<ShellSnapshot>,
  updateShell: (shellId: string | 'automatic') =>
    ipcRenderer.invoke('settings:update-shell', shellId) as Promise<ShellSnapshot>,
  getUpdateState: () => ipcRenderer.invoke('updates:get-state') as Promise<UpdateState>,
  checkForUpdates: () => ipcRenderer.invoke('updates:check') as Promise<UpdateState>,
  installUpdate: () => ipcRenderer.invoke('updates:install') as Promise<UpdateState>,
  openUpdateRelease: () => ipcRenderer.invoke('updates:open-release') as Promise<UpdateState>,
  themeReady: () => ipcRenderer.send('app:theme-ready'),
  openAssistant: () => ipcRenderer.invoke('assistant:open'),
  setLastOpenedWorkspace: (value: { projectId: string; taskId: string | null } | null) =>
    ipcRenderer.invoke('workspace:setLastOpened', value),
  chooseAndAddProject: () => ipcRenderer.invoke('projects:choose-add'),
  listProjects: () => ipcRenderer.invoke('projects:list'),
  deleteProject: (projectId: string) => ipcRenderer.invoke('projects:delete', projectId),
  renameProject: (projectId: string, name: string) => ipcRenderer.invoke('projects:rename', projectId, name),
  reorderProjects: (projectIds: string[]) => ipcRenderer.invoke('projects:reorder', projectIds),
  setProjectDefaultWorkflow: (projectId: string, workflowId: string) => ipcRenderer.invoke('projects:setDefaultWorkflow', projectId, workflowId),
  listTasks: (projectId: string) => ipcRenderer.invoke('tasks:list', projectId),
  getTaskContext: (taskId: string) => ipcRenderer.invoke('tasks:context', taskId) as Promise<string | null>,
  listTaskSessions: (taskId: string) => ipcRenderer.invoke('tasks:sessions', taskId),
  getTaskSessionTranscript: (taskId: string, sessionId: string) =>
    ipcRenderer.invoke('tasks:session-transcript', taskId, sessionId) as Promise<TerminalTranscriptSnapshot>,
  deleteTask: (taskId: string) => ipcRenderer.invoke('tasks:delete', taskId),
  updateTaskTitle: (taskId: string, title: string) => ipcRenderer.invoke('tasks:updateTitle', taskId, title),
  listWorkflows: () => ipcRenderer.invoke('workflows:list'),
  saveWorkflow: (workflow: unknown, expectedRevision?: number) =>
    ipcRenderer.invoke('workflows:save', workflow, expectedRevision),
  deleteWorkflow: (workflowId: string, expectedRevision: number) =>
    ipcRenderer.invoke('workflows:delete', workflowId, expectedRevision),
  setDesignerState: (value: unknown) => ipcRenderer.invoke('designer:set-state', value),
  retryProcess: (sessionId: string, mode: TerminalRetryMode) =>
    ipcRenderer.invoke('process:retry', sessionId, mode) as Promise<{ sessionId: string }>,
  writeProcess: (sessionId: string, input: string) => ipcRenderer.send('process:write', sessionId, input),
  isInputReady: (sessionId: string) => ipcRenderer.invoke('process:isInputReady', sessionId) as Promise<boolean>,
  resizeProcess: (sessionId: string, cols: number, rows: number) => ipcRenderer.invoke('process:resize', sessionId, cols, rows),
  killProcess: (sessionId: string) => ipcRenderer.invoke('process:kill', sessionId),
  startWorkflow: (request: unknown) => ipcRenderer.invoke('workflow:start', request),
  retryWorkflowNode: (taskId: string, nodeId: string, branchId?: string) =>
    ipcRenderer.invoke('workflow:retryNode', taskId, nodeId, branchId),
  updateWorkflowVariables: (taskId: string, variables: unknown, branchId?: string) => ipcRenderer.invoke('workflow:updateVariables', taskId, variables, branchId),
  stopWorkflow: (taskId: string) => ipcRenderer.invoke('workflow:stop', taskId),
  restoreWorkflowState: (taskId: string) => ipcRenderer.invoke('workflow:restoreState', taskId),
  onWorkflowState: (callback: (event: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload)
    ipcRenderer.on('workflow:state', listener)
    return () => {
      ipcRenderer.removeListener('workflow:state', listener)
    }
  },
  onTerminalCreated: (callback: (event: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload)
    ipcRenderer.on('terminal:created', listener)
    return () => ipcRenderer.removeListener('terminal:created', listener)
  },
  onTerminalRestarted: (callback: (event: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload)
    ipcRenderer.on('terminal:restarted', listener)
    return () => ipcRenderer.removeListener('terminal:restarted', listener)
  },
  onTerminalAttached: (callback: (event: { sessionId: string; taskId: string; nodeId: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: { sessionId: string; taskId: string; nodeId: string }) => callback(payload)
    ipcRenderer.on('terminal:attached', listener)
    return () => ipcRenderer.removeListener('terminal:attached', listener)
  },
  onTerminalData: (callback: (event: TerminalDataEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: TerminalDataEvent) =>
      callback(payload)
    ipcRenderer.on('terminal:data', listener)
    return () => ipcRenderer.removeListener('terminal:data', listener)
  },
  onTerminalClosed: (callback: (event: TerminalClosedEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: TerminalClosedEvent) => callback(payload)
    ipcRenderer.on('terminal:closed', listener)
    return () => ipcRenderer.removeListener('terminal:closed', listener)
  },
  onSettingsChanged: (callback: (event: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload)
    ipcRenderer.on('settings:changed', listener)
    return () => ipcRenderer.removeListener('settings:changed', listener)
  },
  onShellsChanged: (callback: (snapshot: ShellSnapshot) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: ShellSnapshot) => callback(payload)
    ipcRenderer.on('shells:changed', listener)
    return () => ipcRenderer.removeListener('shells:changed', listener)
  },
  onWorkflowChanged: (callback: (event: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload)
    ipcRenderer.on('workflows:changed', listener)
    return () => ipcRenderer.removeListener('workflows:changed', listener)
  },
  onProjectChanged: (callback: (event: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload)
    ipcRenderer.on('projects:changed', listener)
    return () => ipcRenderer.removeListener('projects:changed', listener)
  },
  onUpdateState: (callback: (state: UpdateState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: UpdateState) => callback(state)
    ipcRenderer.on('updates:state', listener)
    return () => ipcRenderer.removeListener('updates:state', listener)
  }
}

contextBridge.exposeInMainWorld('cliLoom', api)

export type CLILoomApi = typeof api
