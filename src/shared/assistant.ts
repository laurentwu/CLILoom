import { AppError } from './appError'

export const MAX_INITIALIZATION_COMMAND_LENGTH = 2048
export const MAX_ASSISTANT_TRANSCRIPT_CHARS = 200_000
export const MAX_BRIDGE_BODY_BYTES = 2 * 1024 * 1024
export const ASSISTANT_BRIDGE_API_VERSION = 1
export const ASSISTANT_BRIDGE_PORT_ENV = 'CLILOOM_ASSISTANT_BRIDGE_PORT'
export const ASSISTANT_BRIDGE_TOKEN_ENV = 'CLILOOM_ASSISTANT_BRIDGE_TOKEN'
export const ASSISTANT_CLI_STDIN_PIPE_ENV = 'CLILOOM_ASSISTANT_CLI_STDIN_PIPE'

export type ParsedAssistantCommand = {
  executable: string
  args: string[]
}

export type ResolvedAssistantCommand = ParsedAssistantCommand & {
  executablePath: string
  versionOutput?: string
}

export type AssistantTerminalStatus =
  | { state: 'idle' }
  | { state: 'starting' }
  | { state: 'running'; pid: number }
  | { state: 'exited'; exitCode: number | null; signal?: number }
  | { state: 'failed'; message: string }

export type AssistantBridgeRequest = {
  version: 1
  command: string
  args: string[]
  stdin?: string
}

export type AssistantBridgeResponse = {
  version: 1
  ok: boolean
  exitCode: number
  data?: unknown
  text?: string
  error?: {
    code: string
    message: string
  }
}

export function parseAssistantCommand(
  source: unknown,
  platform: 'posix' | 'win32' = 'posix'
): ParsedAssistantCommand {
  if (typeof source !== 'string') {
    throw new AppError({
      code: 'ASSISTANT_COMMAND_INVALID',
      message: 'The initialization command must be a string',
      i18nKey: 'errors:assistantCommand.initMustBeString'
    })
  }
  const input = source.trim()
  if (!input) {
    throw new AppError({
      code: 'ASSISTANT_COMMAND_INVALID',
      message: 'The initialization command must not be empty',
      i18nKey: 'errors:assistantCommand.initEmpty'
    })
  }
  if (input.length > MAX_INITIALIZATION_COMMAND_LENGTH) {
    throw new AppError({
      code: 'ASSISTANT_COMMAND_INVALID',
      message: `The initialization command cannot exceed ${MAX_INITIALIZATION_COMMAND_LENGTH} characters`,
      i18nKey: 'errors:assistantCommand.initTooLong',
      params: { limit: MAX_INITIALIZATION_COMMAND_LENGTH }
    })
  }
  if (input.includes('\0')) {
    throw new AppError({
      code: 'ASSISTANT_COMMAND_INVALID',
      message: 'The initialization command must not contain a NUL character',
      i18nKey: 'errors:assistantCommand.initNul'
    })
  }

  const args: string[] = []
  let current = ''
  let quote: 'single' | 'double' | null = null
  let escaped = false
  let tokenStarted = false

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]
    const next = input[index + 1]

    if (escaped) {
      current += character
      tokenStarted = true
      escaped = false
      continue
    }

    if (quote === 'single') {
      if (character === "'") quote = null
      else current += character
      tokenStarted = true
      continue
    }

    if (quote === 'double') {
      if (character === '"') {
        quote = null
      } else if (character === '\\') {
        if (next === undefined) {
          throw new AppError({
            code: 'ASSISTANT_COMMAND_INVALID',
            message: 'The initialization command ends with an unfinished escape',
            i18nKey: 'errors:assistantCommand.initUnterminatedEscape'
          })
        }
        if (platform === 'posix' && ['\\', '"', '$', '`'].includes(next)) escaped = true
        else current += character
      } else if (character === '`' || (character === '$' && next === '(')) {
        throw new AppError({
          code: 'ASSISTANT_COMMAND_INVALID',
          message: 'The initialization command must not contain command substitution',
          i18nKey: 'errors:assistantCommand.initCommandSubstitution'
        })
      } else {
        current += character
      }
      tokenStarted = true
      continue
    }

    if (/\s/.test(character)) {
      if (tokenStarted) {
        args.push(current)
        current = ''
        tokenStarted = false
      }
      continue
    }

    if (character === "'") {
      quote = 'single'
      tokenStarted = true
      continue
    }
    if (character === '"') {
      quote = 'double'
      tokenStarted = true
      continue
    }
    if (character === '\\') {
      if (next === undefined) {
        throw new AppError({
          code: 'ASSISTANT_COMMAND_INVALID',
          message: 'The initialization command ends with an unfinished escape',
          i18nKey: 'errors:assistantCommand.initUnterminatedEscape'
        })
      }
      if (platform === 'posix') escaped = true
      else current += character
      tokenStarted = true
      continue
    }
    if (character === '`' || (character === '$' && next === '(')) {
      throw new AppError({
        code: 'ASSISTANT_COMMAND_INVALID',
        message: 'The initialization command must not contain command substitution',
        i18nKey: 'errors:assistantCommand.initCommandSubstitution'
      })
    }
    if (character === ';') {
      throw new AppError({
        code: 'ASSISTANT_COMMAND_INVALID',
        message: 'The initialization command must not contain the control operator ;',
        i18nKey: 'errors:assistantCommand.initControlOperator',
        params: { operator: ';' }
      })
    }
    if (character === '|') {
      const op = next === '|' ? '||' : '|'
      throw new AppError({
        code: 'ASSISTANT_COMMAND_INVALID',
        message: `The initialization command must not contain the control operator ${op}`,
        i18nKey: 'errors:assistantCommand.initControlOperator',
        params: { operator: op }
      })
    }
    if (character === '&') {
      const op = next === '&' ? '&&' : '&'
      throw new AppError({
        code: 'ASSISTANT_COMMAND_INVALID',
        message: `The initialization command must not contain the control operator ${op}`,
        i18nKey: 'errors:assistantCommand.initControlOperator',
        params: { operator: op }
      })
    }
    if (character === '<' || character === '>') {
      throw new AppError({
        code: 'ASSISTANT_COMMAND_INVALID',
        message: 'The initialization command must not contain I/O redirection',
        i18nKey: 'errors:assistantCommand.initRedirection'
      })
    }

    current += character
    tokenStarted = true
  }

  if (escaped) {
    throw new AppError({
      code: 'ASSISTANT_COMMAND_INVALID',
      message: 'The initialization command ends with an unfinished escape',
      i18nKey: 'errors:assistantCommand.initUnterminatedEscape'
    })
  }
  if (quote) {
    throw new AppError({
      code: 'ASSISTANT_COMMAND_INVALID',
      message: 'The initialization command contains an unclosed quote',
      i18nKey: 'errors:assistantCommand.initUnclosedQuote'
    })
  }
  if (tokenStarted) args.push(current)
  if (!args[0]) {
    throw new AppError({
      code: 'ASSISTANT_COMMAND_INVALID',
      message: 'The initialization command must contain an executable',
      i18nKey: 'errors:assistantCommand.initNoExecutable'
    })
  }

  return { executable: args[0], args: args.slice(1) }
}

export function quotePosixArg(value: string): string {
  if (value.length === 0) return "''"
  return `'${value.replaceAll("'", `'"'"'`)}'`
}

export function quotePowerShellArg(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

export function buildAssistantBootstrapCommand(
  shell: 'posix' | 'powershell' | 'cmd',
  executablePath: string,
  args: string[],
  privateBinPath: string
): string {
  const quote = shell === 'powershell' ? quotePowerShellArg : quotePosixArg
  const invocation = [executablePath, ...args].map(quote).join(' ')
  if (shell === 'powershell') {
    return `$env:PATH = ${quote(privateBinPath)} + [IO.Path]::PathSeparator + $env:PATH; & ${invocation}`
  }
  if (shell === 'cmd') {
    const values = [executablePath, ...args, privateBinPath]
    if (values.some((value) => value.includes('%'))) {
      throw new AppError({
        code: 'ASSISTANT_COMMAND_INVALID',
        message: 'Under cmd.exe the initialization command and path must not contain %. Install PowerShell or adjust the command.',
        i18nKey: 'errors:assistantCommand.cmdPercent'
      })
    }
    if (values.some((value) => /[\0\r\n"]/.test(value))) {
      throw new AppError({
        code: 'ASSISTANT_COMMAND_INVALID',
        message: 'Under cmd.exe the initialization command and path must not contain quotes, newlines, or NUL characters',
        i18nKey: 'errors:assistantCommand.cmdInvalidChars'
      })
    }
    const quoteCmd = (value: string) => `"${value}"`
    return `chcp 65001>nul & set "PATH=${privateBinPath};%PATH%" && ${[executablePath, ...args].map(quoteCmd).join(' ')}`
  }
  return `export PATH=${quote(privateBinPath)}:$PATH; exec ${invocation}`
}

export class StreamingSecretRedactor {
  private pending = ''

  constructor(
    private readonly secret: string,
    private readonly replacement = '[REDACTED]'
  ) {}

  push(chunk: string): string {
    if (!this.secret) return chunk
    let buffer = this.pending + chunk
    this.pending = ''
    let output = ''
    while (buffer) {
      const match = buffer.indexOf(this.secret)
      if (match >= 0) {
        output += buffer.slice(0, match) + this.replacement
        buffer = buffer.slice(match + this.secret.length)
        continue
      }

      const possiblePrefixLength = longestSecretPrefixSuffix(buffer, this.secret)
      output += buffer.slice(0, buffer.length - possiblePrefixLength)
      this.pending = buffer.slice(buffer.length - possiblePrefixLength)
      break
    }
    return output
  }

  flush(): string {
    const output = this.pending.replaceAll(this.secret, this.replacement)
    this.pending = ''
    return output
  }
}

function longestSecretPrefixSuffix(value: string, secret: string): number {
  const maxLength = Math.min(value.length, secret.length - 1)
  for (let length = maxLength; length > 0; length -= 1) {
    if (value.endsWith(secret.slice(0, length))) return length
  }
  return 0
}
