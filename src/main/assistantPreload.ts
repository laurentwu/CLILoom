import { contextBridge, ipcRenderer } from 'electron'
import type { AppSettingsSnapshot, Skin } from '../shared/appSettings'
import type { AssistantTerminalStatus } from '../shared/assistant'
import type { ShellSnapshot } from '../shared/shell'

const api = {
  rendererNoSandboxSwitch: process.argv.includes('--no-sandbox'),
  rendererSandboxed: process.sandboxed === true,
  bootstrap: () => ipcRenderer.invoke('assistant:bootstrap') as Promise<{
    settings: AppSettingsSnapshot
    shell: ShellSnapshot
    status: AssistantTerminalStatus
    transcript: string
  }>,
  validateCommand: (command: string) => ipcRenderer.invoke('assistant:validate-command', command),
  saveConfig: (command: string, action: 'save' | 'restart') =>
    ipcRenderer.invoke('assistant:save-config', command, action),
  restart: () => ipcRenderer.invoke('assistant:restart'),
  write: (input: string) => ipcRenderer.send('assistant:write', input),
  resize: (cols: number, rows: number) => ipcRenderer.invoke('assistant:resize', cols, rows),
  hide: () => ipcRenderer.invoke('assistant:hide'),
  close: () => ipcRenderer.invoke('assistant:close'),
  themeReady: () => ipcRenderer.send('assistant:theme-ready'),
  setActiveSkin: (id: string) => ipcRenderer.invoke('settings:set-active-skin', id),
  onTerminalData: (callback: (content: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: { content: string }) => {
      callback(payload.content)
    }
    ipcRenderer.on('assistant:terminal-data', listener)
    return () => ipcRenderer.removeListener('assistant:terminal-data', listener)
  },
  onTerminalStatus: (callback: (status: AssistantTerminalStatus) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: AssistantTerminalStatus) => callback(payload)
    ipcRenderer.on('assistant:terminal-status', listener)
    return () => ipcRenderer.removeListener('assistant:terminal-status', listener)
  },
  onSettingsChanged: (callback: (settings: AppSettingsSnapshot) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: AppSettingsSnapshot) => callback(payload)
    ipcRenderer.on('settings:changed', listener)
    return () => ipcRenderer.removeListener('settings:changed', listener)
  },
  onShellsChanged: (callback: (snapshot: ShellSnapshot) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: ShellSnapshot) => callback(payload)
    ipcRenderer.on('shells:changed', listener)
    return () => ipcRenderer.removeListener('shells:changed', listener)
  },
  onThemeFallback: (callback: (skin: Skin) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: { skin: Skin }) => {
      callback(payload.skin)
    }
    ipcRenderer.on('assistant:theme-fallback', listener)
    return () => ipcRenderer.removeListener('assistant:theme-fallback', listener)
  }
}

contextBridge.exposeInMainWorld('cliLoomAssistant', api)

export type CLILoomAssistantApi = typeof api
