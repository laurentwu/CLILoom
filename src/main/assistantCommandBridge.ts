import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import {
  ASSISTANT_BRIDGE_API_VERSION,
  MAX_BRIDGE_BODY_BYTES,
  type AssistantBridgeRequest,
  type AssistantBridgeResponse
} from '../shared/assistant'
import { AppError } from '../shared/appError'
import {
  AssistantCommandError,
  AssistantCommandHandler
} from './assistantCommandHandler'
import { WorkflowRevisionConflictError } from './database'
import { NotFoundError } from './errors'
import { t } from './i18n'

export type AssistantBridgeSession = {
  port: number
  token: string
  close: () => Promise<void>
}

export async function startAssistantCommandBridge(
  handler: AssistantCommandHandler
): Promise<AssistantBridgeSession> {
  const token = randomBytes(32).toString('base64url')
  let active = true
  const server = createServer(async (request, response) => {
    const send = (status: number, body: AssistantBridgeResponse) => {
      const encodedResponse = encodeAssistantBridgeResponse(status, body)
      response.writeHead(encodedResponse.status, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(encodedResponse.encoded),
        'cache-control': 'no-store'
      })
      response.end(encodedResponse.encoded)
    }

    try {
      if (!active) throw new BridgeHttpError(401, 'BRIDGE_REVOKED', t('errors:bridge.revoked'))
      if (request.method !== 'POST' || request.url !== '/v1/command') {
        throw new BridgeHttpError(404, 'NOT_FOUND', t('errors:bridge.notFound'))
      }
      if (!isAuthorized(request, token)) {
        throw new BridgeHttpError(401, 'UNAUTHORIZED', t('errors:bridge.unauthorized'))
      }
      const contentType = request.headers['content-type']?.split(';')[0].trim().toLowerCase()
      if (contentType !== 'application/json') {
        throw new BridgeHttpError(415, 'INVALID_CONTENT_TYPE', t('errors:bridge.invalidContentType'))
      }
      const body = await readRequestBody(request)
      const parsed = parseBridgeRequest(body)
      const result = await handler.handle(parsed)
      send(200, createAssistantBridgeSuccessResponse(parsed, result))
    } catch (error) {
      const mapped = mapBridgeError(error)
      send(mapped.status, {
        version: ASSISTANT_BRIDGE_API_VERSION,
        ok: false,
        exitCode: mapped.exitCode,
        error: { code: mapped.code, message: mapped.message }
      })
    }
  })

  server.on('clientError', (error, socket) => {
    void error
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n')
  })
  await listen(server)
  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error(t('errors:bridge.noPort'))
  }

  return {
    port: address.port,
    token,
    close: async () => {
      if (!active && !server.listening) return
      active = false
      await closeServer(server)
    }
  }
}

export function createAssistantBridgeSuccessResponse(
  request: AssistantBridgeRequest,
  result: { data: unknown; text: string }
): AssistantBridgeResponse {
  return {
    version: ASSISTANT_BRIDGE_API_VERSION,
    ok: true,
    exitCode: 0,
    ...(request.args.includes('--json') ? { data: result.data } : { text: result.text })
  }
}

export function encodeAssistantBridgeResponse(
  status: number,
  body: AssistantBridgeResponse
): { status: number; encoded: string } {
  const encoded = JSON.stringify(body)
  if (Buffer.byteLength(encoded) <= MAX_BRIDGE_BODY_BYTES) return { status, encoded }
  return {
    status: 413,
    encoded: JSON.stringify({
      version: ASSISTANT_BRIDGE_API_VERSION,
      ok: false,
      exitCode: 6,
      error: {
        code: 'RESPONSE_TOO_LARGE',
        message: t('errors:bridge.responseTooLarge', { limit: MAX_BRIDGE_BODY_BYTES })
      }
    } satisfies AssistantBridgeResponse)
  }
}

function parseBridgeRequest(source: string): AssistantBridgeRequest {
  let value: unknown
  try {
    value = JSON.parse(source) as unknown
  } catch {
    throw new BridgeHttpError(400, 'INVALID_JSON', t('errors:bridge.invalidJson'))
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BridgeHttpError(400, 'INVALID_REQUEST', t('errors:bridge.requestNotObject'))
  }
  const request = value as Record<string, unknown>
  if (request.version !== 1 || typeof request.command !== 'string' || !request.command) {
    throw new BridgeHttpError(400, 'INVALID_REQUEST', t('errors:bridge.invalidVersionOrCommand'))
  }
  if (!Array.isArray(request.args) || request.args.length > 100 ||
    !request.args.every((argument) => typeof argument === 'string' && argument.length <= 10_000)) {
    throw new BridgeHttpError(400, 'INVALID_REQUEST', t('errors:bridge.invalidArgs'))
  }
  if (request.stdin !== undefined &&
    (typeof request.stdin !== 'string' || Buffer.byteLength(request.stdin) > MAX_BRIDGE_BODY_BYTES)) {
    throw new BridgeHttpError(400, 'INVALID_REQUEST', t('errors:bridge.stdinTooLarge'))
  }
  return {
    version: 1,
    command: request.command,
    args: request.args as string[],
    ...(typeof request.stdin === 'string' ? { stdin: request.stdin } : {})
  }
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const declaredLength = Number(request.headers['content-length'] ?? 0)
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BRIDGE_BODY_BYTES) {
    throw new BridgeHttpError(413, 'BODY_TOO_LARGE', t('errors:bridge.bodyTooLarge'))
  }
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BRIDGE_BODY_BYTES) {
      throw new BridgeHttpError(413, 'BODY_TOO_LARGE', t('errors:bridge.bodyTooLarge'))
    }
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function isAuthorized(request: IncomingMessage, token: string): boolean {
  const authorization = request.headers.authorization
  if (!authorization?.startsWith('Bearer ')) return false
  const provided = Buffer.from(authorization.slice('Bearer '.length))
  const expected = Buffer.from(token)
  return provided.length === expected.length && timingSafeEqual(provided, expected)
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject)
      resolve()
    })
  })
}

function closeServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve()
  return new Promise((resolve) => {
    server.close(() => resolve())
    server.closeAllConnections?.()
  })
}

class BridgeHttpError extends AppError {
  readonly status: number
  readonly exitCode: number

  constructor(
    status: number,
    code: string,
    message: string,
    exitCode = 2
  ) {
    super({ code, message })
    this.status = status
    this.exitCode = exitCode
  }
}

export function mapBridgeError(error: unknown): {
  status: number
  code: string
  message: string
  exitCode: number
} {
  if (error instanceof BridgeHttpError) return error
  if (error instanceof NotFoundError) {
    return { status: 404, code: 'NOT_FOUND', message: error.message, exitCode: 3 }
  }
  if (error instanceof AssistantCommandError) {
    const status = error.code === 'NOT_FOUND' ? 404 : 400
    return { status, code: error.code, message: error.message, exitCode: error.exitCode }
  }
  if (error instanceof WorkflowRevisionConflictError) {
    return { status: 409, code: error.code, message: error.message, exitCode: 5 }
  }
  const message = error instanceof Error ? error.message : String(error)
  return { status: 400, code: 'VALIDATION_ERROR', message, exitCode: 2 }
}
