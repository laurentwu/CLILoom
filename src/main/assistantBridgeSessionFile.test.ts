import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { startAssistantCommandBridge } from './assistantCommandBridge'
import {
  ASSISTANT_BRIDGE_SESSION_FILE,
  readAssistantBridgeSession,
  writeAssistantBridgeSession
} from './assistantBridgeSessionFile'

const directories: string[] = []
function createSessionPath(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'cliloom-session-file-'))
  directories.push(directory)
  return path.join(directory, ASSISTANT_BRIDGE_SESSION_FILE)
}
const credentials = { port: 12345, token: randomBytes(32).toString('base64url') }

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('private assistant session credentials', () => {
  it.each([
    { version: 1, ...credentials, port: 0 },
    { version: 1, ...credentials, port: 65536 },
    { version: 1, ...credentials, token: 'invalid-token' },
    { version: 2, ...credentials },
    null
  ])('rejects invalid credentials: %o', (value) => {
    const filePath = createSessionPath()
    writeFileSync(filePath, JSON.stringify(value), { mode: 0o600 })
    expect(() => readAssistantBridgeSession(filePath)).toThrow('Invalid assistant session credentials')
  })

  it('rejects oversized credentials and relative or unrelated paths', () => {
    const filePath = createSessionPath()
    writeFileSync(filePath, 'x'.repeat(4097), { mode: 0o600 })
    expect(() => readAssistantBridgeSession(filePath)).toThrow('Assistant session must be private')
    expect(() => readAssistantBridgeSession(ASSISTANT_BRIDGE_SESSION_FILE)).toThrow('Invalid assistant session path')
    expect(() => readAssistantBridgeSession(path.join(path.dirname(filePath), 'other.json'))).toThrow('Invalid assistant session path')
  })

  it.skipIf(process.platform === 'win32')('rejects public permissions and symlinks without overwriting their targets', () => {
    const filePath = createSessionPath()
    writeAssistantBridgeSession(filePath, credentials)
    chmodSync(filePath, 0o644)
    expect(() => readAssistantBridgeSession(filePath)).toThrow('Assistant session must be private')
    chmodSync(filePath, 0o600)
    chmodSync(path.dirname(filePath), 0o755)
    expect(() => readAssistantBridgeSession(filePath)).toThrow('Assistant session must be private')
    chmodSync(path.dirname(filePath), 0o700)
    const targetPath = path.join(path.dirname(filePath), 'target.json')
    writeFileSync(targetPath, 'preserved')
    rmSync(filePath)
    symlinkSync(targetPath, filePath)
    expect(() => readAssistantBridgeSession(filePath)).toThrow('Assistant session must be private')
    expect(() => writeAssistantBridgeSession(filePath, credentials)).toThrow()
    expect(readFileSync(targetPath, 'utf8')).toBe('preserved')
  })

  it('rotates stale credentials and prevents an older bridge from deleting the new session', async () => {
    const sessionFilePath = createSessionPath()
    writeAssistantBridgeSession(sessionFilePath, credentials)
    const handler = { handle: async () => ({ data: {}, text: '' }) } as never
    const first = await startAssistantCommandBridge(handler, { sessionFilePath })
    let second: Awaited<ReturnType<typeof startAssistantCommandBridge>> | undefined
    try {
      expect(readAssistantBridgeSession(sessionFilePath).token).toBe(first.token)
      second = await startAssistantCommandBridge(handler, { sessionFilePath })
      await first.close()
      expect(readAssistantBridgeSession(sessionFilePath).token).toBe(second.token)
      await second.close()
      expect(existsSync(sessionFilePath)).toBe(false)
    } finally {
      await first.close()
      await second?.close()
    }
  })
})
