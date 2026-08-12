import { Readable, Writable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import {
  ASSISTANT_BRIDGE_PORT_ENV,
  ASSISTANT_BRIDGE_TOKEN_ENV,
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
})
