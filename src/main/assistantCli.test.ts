import { randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:net'
import { Readable, Writable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import {
  ASSISTANT_BRIDGE_PORT_ENV,
  ASSISTANT_BRIDGE_TOKEN_ENV,
  ASSISTANT_CLI_STDIN_PIPE_ENV,
  MAX_BRIDGE_BODY_BYTES,
  type AssistantBridgeRequest
} from '../shared/assistant'
import { startAssistantCommandBridge } from './assistantCommandBridge'
import { runAssistantCliMode } from './assistantCli'

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

function createTrustedStdinPipeName(): string {
  return `\\\\.\\pipe\\cliloom-cli-stdin-${randomBytes(16).toString('hex')}`
}

function listen(server: Server, pipeName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(pipeName, resolve)
  })
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })
}

describe('assistant CLI stdin', () => {
  it('forwards piped multiline Unicode input to the bridge without alteration', async () => {
    const input = '{\n  "id": "管道-😀",\n  "name": "PowerShell 与 Bash"\n}\n'
    let received: AssistantBridgeRequest | undefined
    const bridge = await startAssistantCommandBridge({
      handle: async (request: AssistantBridgeRequest) => {
        received = request
        return { data: { accepted: true }, text: 'stdin-ok' }
      }
    } as never)
    const stdout = collectOutput()
    const stderr = collectOutput()

    try {
      const exitCode = await runAssistantCliMode([
        'workflow',
        'validate',
        '--stdin'
      ], {
        [ASSISTANT_BRIDGE_PORT_ENV]: String(bridge.port),
        [ASSISTANT_BRIDGE_TOKEN_ENV]: bridge.token
      }, {
        stdin: Readable.from([Buffer.from(input, 'utf8')]),
        stdout: stdout.stream,
        stderr: stderr.stream
      })

      expect(exitCode).toBe(0)
      expect(received).toEqual({
        version: 1,
        command: 'workflow',
        args: ['validate', '--stdin'],
        stdin: input
      })
      expect(stdout.read()).toBe('stdin-ok\n')
      expect(stderr.read()).toBe('')
    } finally {
      await bridge.close()
    }
  })

  it('rejects stdin beyond the bridge body limit before making a request', async () => {
    const stdout = collectOutput()
    const stderr = collectOutput()
    const exitCode = await runAssistantCliMode([
      'workflow',
      'validate',
      '--stdin'
    ], {
      [ASSISTANT_BRIDGE_PORT_ENV]: '1',
      [ASSISTANT_BRIDGE_TOKEN_ENV]: 'test-token'
    }, {
      stdin: Readable.from([Buffer.alloc(MAX_BRIDGE_BODY_BYTES + 1, 0x61)]),
      stdout: stdout.stream,
      stderr: stderr.stream
    })

    expect(exitCode).toBe(2)
    expect(stdout.read()).toBe('')
    expect(stderr.read()).toBe(`stdin exceeds the ${MAX_BRIDGE_BODY_BYTES} byte limit\n`)
  })

  it('rejects an untrusted Windows stdin pipe name', async () => {
    const stdout = collectOutput()
    const stderr = collectOutput()
    const exitCode = await runAssistantCliMode([
      'workflow',
      'validate',
      '--stdin'
    ], {
      [ASSISTANT_BRIDGE_PORT_ENV]: '1',
      [ASSISTANT_BRIDGE_TOKEN_ENV]: 'test-token',
      [ASSISTANT_CLI_STDIN_PIPE_ENV]: '\\\\.\\pipe\\untrusted'
    }, {
      stdin: Readable.from([]),
      stdout: stdout.stream,
      stderr: stderr.stream
    })

    expect(exitCode).toBe(2)
    expect(stdout.read()).toBe('')
    expect(stderr.read()).toBe('Windows CLI stdin pipe is invalid\n')
  })

  it('forwards input from a trusted Windows stdin pipe to the bridge', async () => {
    const input = '{\n  "id": "可信管道-😀"\n}\n'
    const pipeName = createTrustedStdinPipeName()
    const pipeServer = createServer((socket) => socket.end(input))
    let received: AssistantBridgeRequest | undefined
    const bridge = await startAssistantCommandBridge({
      handle: async (request: AssistantBridgeRequest) => {
        received = request
        return { data: { accepted: true }, text: 'pipe-ok' }
      }
    } as never)
    const stdout = collectOutput()
    const stderr = collectOutput()

    await listen(pipeServer, pipeName)
    try {
      const exitCode = await runAssistantCliMode([
        'workflow',
        'validate',
        '--stdin'
      ], {
        [ASSISTANT_BRIDGE_PORT_ENV]: String(bridge.port),
        [ASSISTANT_BRIDGE_TOKEN_ENV]: bridge.token,
        [ASSISTANT_CLI_STDIN_PIPE_ENV]: pipeName
      }, {
        stdin: Readable.from([]),
        stdout: stdout.stream,
        stderr: stderr.stream
      })

      expect(exitCode).toBe(0)
      expect(received).toEqual({
        version: 1,
        command: 'workflow',
        args: ['validate', '--stdin'],
        stdin: input
      })
      expect(stdout.read()).toBe('pipe-ok\n')
      expect(stderr.read()).toBe('')
    } finally {
      await Promise.all([close(pipeServer), bridge.close()])
    }
  })

  it('reports a trusted Windows stdin pipe with no listener', async () => {
    const pipeName = createTrustedStdinPipeName()
    const stdout = collectOutput()
    const stderr = collectOutput()
    const exitCode = await runAssistantCliMode([
      'workflow',
      'validate',
      '--stdin'
    ], {
      [ASSISTANT_BRIDGE_PORT_ENV]: '1',
      [ASSISTANT_BRIDGE_TOKEN_ENV]: 'test-token',
      [ASSISTANT_CLI_STDIN_PIPE_ENV]: pipeName
    }, {
      stdin: Readable.from([]),
      stdout: stdout.stream,
      stderr: stderr.stream
    })

    expect(exitCode).toBe(2)
    expect(stdout.read()).toBe('')
    expect(stderr.read()).toContain(pipeName)
  })
})
