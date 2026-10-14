import { lstatSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export const ASSISTANT_BRIDGE_SESSION_FILE = '.cliloom-assistant-session.json'
export const ASSISTANT_BRIDGE_SESSION_ARGUMENT = '--cliloom-session-file'

export type AssistantBridgeCredentials = { port: number; token: string }

export function readAssistantBridgeSession(filePath: string): AssistantBridgeCredentials {
  if (!path.isAbsolute(filePath) || path.basename(filePath) !== ASSISTANT_BRIDGE_SESSION_FILE) {
    throw new Error('Invalid assistant session path')
  }
  const directory = lstatSync(path.dirname(filePath))
  const file = lstatSync(filePath)
  if (!directory.isDirectory() || directory.isSymbolicLink() ||
    !file.isFile() || file.isSymbolicLink() || file.size > 4096 ||
    (process.platform !== 'win32' &&
      ((directory.mode & 0o077) !== 0 || (file.mode & 0o077) !== 0))) {
    throw new Error('Assistant session must be private')
  }
  const value = JSON.parse(readFileSync(filePath, 'utf8'))
  if (value?.version !== 1 || !Number.isInteger(value.port) ||
    value.port < 1 || value.port > 65_535 ||
    typeof value.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value.token)) {
    throw new Error('Invalid assistant session credentials')
  }
  return { port: value.port, token: value.token }
}

export function writeAssistantBridgeSession(
  filePath: string,
  credentials: AssistantBridgeCredentials
): void {
  // Refuse existing files and symlinks rather than following an untrusted target.
  writeFileSync(filePath, JSON.stringify({ version: 1, ...credentials }), {
    encoding: 'utf8', mode: 0o600, flag: 'wx'
  })
}

export function removeAssistantBridgeSession(filePath: string, token?: string): void {
  try {
    if (token && readAssistantBridgeSession(filePath).token !== token) return
    unlinkSync(filePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}
