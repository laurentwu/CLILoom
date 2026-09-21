import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable, Writable } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ASSISTANT_BRIDGE_PORT_ENV,
  ASSISTANT_BRIDGE_TOKEN_ENV,
  MAX_BRIDGE_BODY_BYTES,
  type AssistantBridgeRequest
} from '../shared/assistant'
import { defaultSkinContent } from '../shared/skin'
import { DEFAULT_SHELL_PREFERENCES, type ShellSnapshot } from '../shared/shell'
import { AssistantCommandError } from './assistantCommandHandler'
import {
  createAssistantBridgeSuccessResponse,
  encodeAssistantBridgeResponse,
  mapBridgeError,
  startAssistantCommandBridge
} from './assistantCommandBridge'
import { runAssistantCliMode } from './assistantCli'
import { NotFoundError } from './errors'
import { openDatabase, type AppDatabase } from './database'
import { SettingsService } from './settingsService'
import { WorkflowConfigService } from './workflowConfigService'
import { ensureAssistantWorkspace } from './assistantWorkspace'
import { AssistantCommandHandler } from './assistantCommandHandler'

function request(args: string[]): AssistantBridgeRequest {
  return { version: 1, command: 'context', args }
}

function collectOutput(): { stream: Writable; read: () => string } {
  let content = ''
  return {
    stream: new Writable({
      write(chunk, _encoding, callback) {
        content += chunk.toString()
        callback()
      }
    }),
    read: () => content
  }
}

describe('assistant command bridge responses', () => {
  it('returns only the representation requested by the CLI', () => {
    const result = { data: { large: true }, text: 'human output' }
    expect(createAssistantBridgeSuccessResponse(request([]), result)).toEqual({
      version: 1,
      ok: true,
      exitCode: 0,
      text: 'human output'
    })
    expect(createAssistantBridgeSuccessResponse(request(['--json']), result)).toEqual({
      version: 1,
      ok: true,
      exitCode: 0,
      data: { large: true }
    })
  })

  it('bounds the complete UTF-8 response rather than counting characters', () => {
    const response = createAssistantBridgeSuccessResponse(request([]), {
      data: null,
      text: '界'.repeat(MAX_BRIDGE_BODY_BYTES)
    })
    const encoded = encodeAssistantBridgeResponse(200, response)
    const parsed = JSON.parse(encoded.encoded) as { error?: { code: string } }

    expect(encoded.status).toBe(413)
    expect(Buffer.byteLength(encoded.encoded)).toBeLessThanOrEqual(MAX_BRIDGE_BODY_BYTES)
    expect(parsed.error?.code).toBe('RESPONSE_TOO_LARGE')
  })
})

describe('mapBridgeError status code contract', () => {
  it('maps NotFoundError to 404 / NOT_FOUND / exitCode 3', () => {
    expect(mapBridgeError(new NotFoundError('文件不存在：foo.md'))).toEqual({
      status: 404,
      code: 'NOT_FOUND',
      message: '文件不存在：foo.md',
      exitCode: 3
    })
  })

  it('maps AssistantCommandError with NOT_FOUND code to 404', () => {
    const result = mapBridgeError(new AssistantCommandError('NOT_FOUND', 3, '流程不存在或已被删除'))
    expect(result.status).toBe(404)
    expect(result.code).toBe('NOT_FOUND')
    expect(result.exitCode).toBe(3)
  })

  it('maps a generic validation error to 400 / VALIDATION_ERROR', () => {
    const result = mapBridgeError(new Error('--file 路径不能包含 ..'))
    expect(result).toEqual({
      status: 400,
      code: 'VALIDATION_ERROR',
      message: '--file 路径不能包含 ..',
      exitCode: 2
    })
  })
})

describe('assistant command bridge with the real handler', () => {
  const databases: Array<{ db: AppDatabase; directory: string }> = []

  afterEach(() => {
    for (const item of databases.splice(0)) {
      item.db.close()
      rmSync(item.directory, { recursive: true, force: true })
    }
  })

  function createRealHandlerBridge() {
    const directory = mkdtempSync(path.join(tmpdir(), 'cliloom-assistant-bridge-'))
    const db = openDatabase(directory)
    databases.push({ db, directory })
    const settingsService = new SettingsService(db, { PATH: '/usr/bin' })
    const workflowService = new WorkflowConfigService(db)
    const workspace = ensureAssistantWorkspace({
      userDataPath: directory,
      executablePath: process.execPath,
      appVersion: '0.1.0',
      buildId: `sha256:${'a'.repeat(64)}`
    })
    const snapshot: ShellSnapshot = {
      platform: 'linux',
      preferences: DEFAULT_SHELL_PREFERENCES,
      candidates: [],
      effectiveShell: null,
      error: 'no shell in tests'
    }
    const handler = new AssistantCommandHandler({
      workflowService,
      settingsService,
      listProjects: () => [],
      workspace,
      appVersion: '0.1.0',
      environment: { PATH: '/usr/bin' },
      shellService: {
        getSnapshot: () => snapshot,
        resolveEffectiveShell: () => {
          throw new Error('no shell in tests')
        }
      } as never,
      confirmDelete: async () => false,
      shellConfiguration: {
        list: () => snapshot,
        refresh: async () => snapshot,
        select: async () => snapshot
      },
      listInstalledFontFamilies: async () => []
    })
    return startAssistantCommandBridge(handler)
  }

  async function runCli(bridge: { port: number; token: string }, args: string[], stdin = '') {
    const stdout = collectOutput()
    const stderr = collectOutput()
    const exitCode = await runAssistantCliMode(args, {
      [ASSISTANT_BRIDGE_PORT_ENV]: String(bridge.port),
      [ASSISTANT_BRIDGE_TOKEN_ENV]: bridge.token,
      ...(stdin ? { CLILOOM_TEST_STDIN: '1' } : {})
    }, {
      stdin: Readable.from([stdin]),
      stdout: stdout.stream,
      stderr: stderr.stream
    })
    return { exitCode, stdout: stdout.read(), stderr: stderr.read() }
  }

  it('drives a terminal auto-retry change end to end', async () => {
    const bridge = await createRealHandlerBridge()
    try {
      const workflow = {
        id: 'bridge-auto-retry',
        name: 'Bridge auto retry',
        nodes: [
          { id: 'start', type: 'start', name: 'Start', config: { variables: [] } },
          {
            id: 'term',
            type: 'non-interactive-terminal',
            name: 'Terminal',
            config: { command: 'run', cwd: '/tmp', successExitCodes: [0] }
          },
          { id: 'end', type: 'end', name: 'End', config: {} }
        ],
        edges: [
          { id: 'start-term', from: 'start', to: 'term' },
          { id: 'term-end', from: 'term', to: 'end' }
        ]
      }
      const saved = await runCli(bridge, ['workflow', 'save', '--stdin'], JSON.stringify(workflow))
      expect(saved.exitCode).toBe(0)
      expect(saved.stderr).toBe('')

      const read = await runCli(bridge, ['workflow', 'auto-retry', 'get', 'bridge-auto-retry', 'term'])
      expect(read.exitCode).toBe(0)
      expect(read.stdout).toContain('not configured')

      const set = await runCli(
        bridge,
        [
          'workflow', 'auto-retry', 'set', 'bridge-auto-retry', 'term',
          '--stdin', '--expected-revision', '1'
        ],
        JSON.stringify({ enabled: true, mode: 'recommended', maxRetries: 5 })
      )
      expect(set.exitCode).toBe(0)
      expect(set.stderr).toBe('')
      expect(set.stdout).toContain('revision 2')

      const conflict = await runCli(
        bridge,
        [
          'workflow', 'auto-retry', 'set', 'bridge-auto-retry', 'term',
          '--stdin', '--expected-revision', '1', '--json'
        ],
        'null'
      )
      expect(conflict.exitCode).toBe(5)
      expect(conflict.stdout).toBe('')
      expect(conflict.stderr).toContain('WORKFLOW_REVISION_CONFLICT')
    } finally {
      await bridge.close()
    }
  })

  it('drives a skin JSON create and read back over the bridge', async () => {
    const bridge = await createRealHandlerBridge()
    try {
      const created = await runCli(
        bridge,
        ['skin', 'create', '--stdin'],
        JSON.stringify({ name: 'Bridge theme', content: defaultSkinContent('dark') })
      )
      expect(created.exitCode).toBe(0)
      expect(created.stderr).toBe('')
      expect(created.stdout).toContain('Created skin user.')

      const listed = await runCli(bridge, ['skin', 'list'])
      expect(listed.exitCode).toBe(0)
      expect(listed.stdout).toContain('Bridge theme')

      const invalid = await runCli(
        bridge,
        ['skin', 'create', '--stdin', '--json'],
        JSON.stringify({ name: 'X', content: { mode: 'dark' }, builtin: true })
      )
      expect(invalid.exitCode).toBe(2)
      expect(invalid.stdout).toBe('')
      expect(invalid.stderr).toContain('INVALID_ARGUMENT')
    } finally {
      await bridge.close()
    }
  })

  it('rejects unauthenticated bridge requests', async () => {
    const bridge = await createRealHandlerBridge()
    try {
      const result = await runCli(
        { port: bridge.port, token: 'wrong-token' },
        ['context']
      )
      expect(result.exitCode).not.toBe(0)
      expect(result.stdout).toBe('')
      expect(result.stderr.toLowerCase()).toContain('authentication failed')
    } finally {
      await bridge.close()
    }
  })
})
