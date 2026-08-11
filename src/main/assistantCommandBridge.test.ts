import { describe, expect, it } from 'vitest'
import { MAX_BRIDGE_BODY_BYTES, type AssistantBridgeRequest } from '../shared/assistant'
import { AssistantCommandError } from './assistantCommandHandler'
import {
  createAssistantBridgeSuccessResponse,
  encodeAssistantBridgeResponse,
  mapBridgeError
} from './assistantCommandBridge'
import { NotFoundError } from './errors'

function request(args: string[]): AssistantBridgeRequest {
  return { version: 1, command: 'context', args }
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
