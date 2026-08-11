import { request as httpRequest } from 'node:http'
import {
  ASSISTANT_BRIDGE_API_VERSION,
  ASSISTANT_BRIDGE_PORT_ENV,
  ASSISTANT_BRIDGE_TOKEN_ENV,
  MAX_BRIDGE_BODY_BYTES,
  type AssistantBridgeRequest,
  type AssistantBridgeResponse
} from '../shared/assistant'

export type AssistantCliIo = {
  stdin: NodeJS.ReadableStream
  stdout: NodeJS.WritableStream
  stderr: NodeJS.WritableStream
}

export function getAssistantCliArguments(argv: string[]): string[] | null {
  const markerIndex = argv.indexOf('--cliloom-cli')
  return markerIndex < 0 ? null : argv.slice(markerIndex + 1)
}

export async function runAssistantCliMode(
  args: string[],
  environment: NodeJS.ProcessEnv = process.env,
  io: AssistantCliIo = process
): Promise<number> {
  const port = Number(environment[ASSISTANT_BRIDGE_PORT_ENV])
  const token = environment[ASSISTANT_BRIDGE_TOKEN_ENV]
  if (!Number.isInteger(port) || port < 1 || port > 65_535 || !token) {
    io.stderr.write('cliloom is only available inside an active CLILoom assistant session.\n')
    return 10
  }

  let stdin: string | undefined
  if (args.includes('--stdin')) {
    try {
      stdin = await readBoundedStdin(io.stdin)
    } catch (error) {
      io.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
      return 2
    }
  }
  const request: AssistantBridgeRequest = {
    version: ASSISTANT_BRIDGE_API_VERSION,
    command: args[0] ?? 'help',
    args: args.slice(1),
    ...(stdin === undefined ? {} : { stdin })
  }

  try {
    const response = await callBridge(port, token, request)
    const jsonOutput = args.includes('--json')
    if (response.ok) {
      const output = jsonOutput
        ? JSON.stringify(response.data ?? { version: 1 })
        : response.text ?? ''
      io.stdout.write(`${output.slice(0, MAX_BRIDGE_BODY_BYTES)}${output.endsWith('\n') ? '' : '\n'}`)
      return response.exitCode
    }
    const errorOutput = jsonOutput
      ? JSON.stringify({
          version: 1,
          ok: false,
          error: response.error ?? { code: 'UNKNOWN', message: 'Unknown bridge error' }
        })
      : response.error?.message ?? 'Unknown bridge error'
    io.stderr.write(`${errorOutput.slice(0, MAX_BRIDGE_BODY_BYTES)}\n`)
    return response.exitCode || 10
  } catch (error) {
    io.stderr.write(`Unable to contact the CLILoom assistant bridge: ${safeErrorMessage(error)}\n`)
    return 10
  }
}

async function readBoundedStdin(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
    size += buffer.length
    if (size > MAX_BRIDGE_BODY_BYTES) {
      throw new Error(`stdin exceeds the ${MAX_BRIDGE_BODY_BYTES} byte limit`)
    }
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function callBridge(
  port: number,
  token: string,
  body: AssistantBridgeRequest
): Promise<AssistantBridgeResponse> {
  return new Promise((resolve, reject) => {
    const encoded = JSON.stringify(body)
    const request = httpRequest({
      hostname: '127.0.0.1',
      port,
      path: '/v1/command',
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(encoded)
      },
      timeout: 5 * 60_000
    }, (response) => {
      const chunks: Buffer[] = []
      let size = 0
      response.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > MAX_BRIDGE_BODY_BYTES) {
          request.destroy(new Error('Bridge response exceeds the size limit'))
          return
        }
        chunks.push(chunk)
      })
      response.on('end', () => {
        try {
          const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as AssistantBridgeResponse
          if (parsed.version !== ASSISTANT_BRIDGE_API_VERSION || typeof parsed.ok !== 'boolean') {
            throw new Error('Bridge returned an invalid response')
          }
          resolve(parsed)
        } catch (error) {
          reject(error)
        }
      })
    })
    request.once('timeout', () => request.destroy(new Error('Bridge request timed out')))
    request.once('error', reject)
    request.end(encoded)
  })
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
}
