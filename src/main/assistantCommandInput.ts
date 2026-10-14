import { AppError } from '../shared/appError'
import {
  MAX_ASSISTANT_INPUT_FILE_BYTES,
  readAssistantWorkspaceFile
} from './assistantWorkspace'
import { t } from './i18n'

export class AssistantCommandError extends AppError {
  readonly exitCode: number

  constructor(
    code: string,
    exitCode: number,
    message: string
  ) {
    super({ code, message })
    this.exitCode = exitCode
    this.name = 'AssistantCommandError'
  }
}

export type AssistantInputReadOptions = {
  allowRevision?: boolean
  maxBytes?: number
}

export type AssistantInputSource = {
  content: string
  expectedRevision?: number
}

export function readAssistantCommandInput(options: {
  args: string[]
  stdin: string | undefined
  workspaceRoot: string
} & AssistantInputReadOptions): AssistantInputSource {
  const { args, stdin, workspaceRoot } = options
  const allowRevision = options.allowRevision === true
  const maxBytes = options.maxBytes ?? MAX_ASSISTANT_INPUT_FILE_BYTES
  let useStdin = false
  let filePath: string | undefined
  let expectedRevision: number | undefined
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--stdin') {
      if (useStdin) throw new AssistantCommandError('INVALID_ARGUMENT', 2, t('errors:assistantCommand.stdinDuplicate'))
      useStdin = true
    } else if (argument === '--file') {
      if (filePath !== undefined || !args[index + 1]) {
        throw new AssistantCommandError('INVALID_ARGUMENT', 2, t('errors:assistantCommand.fileRelative'))
      }
      filePath = args[index + 1]
      index += 1
    } else if (argument === '--expected-revision' && allowRevision) {
      if (expectedRevision !== undefined) {
        throw new AssistantCommandError('INVALID_ARGUMENT', 2, t('errors:assistantCommand.revisionDuplicate'))
      }
      const rawRevision = args[index + 1]
      const revision = Number(rawRevision)
      if (!rawRevision || !Number.isInteger(revision) || revision < 1) {
        throw new AssistantCommandError('INVALID_ARGUMENT', 2, t('errors:assistantCommand.revisionPositive'))
      }
      expectedRevision = revision
      index += 1
    } else {
      throw new AssistantCommandError('INVALID_ARGUMENT', 2, t('errors:assistantCommand.unknownArgument', { argument }))
    }
  }
  if (useStdin === Boolean(filePath)) {
    throw new AssistantCommandError('INVALID_ARGUMENT', 2, t('errors:assistantCommand.stdinOrFile'))
  }
  const content = useStdin
    ? stdin ?? ''
    : readAssistantWorkspaceFile(workspaceRoot, filePath, maxBytes)
  if (Buffer.byteLength(content, 'utf8') > maxBytes) {
    throw new AssistantCommandError('INVALID_ARGUMENT', 2, t('errors:assistantCommand.inputTooLarge', { limit: maxBytes }))
  }
  return { content, ...(expectedRevision === undefined ? {} : { expectedRevision }) }
}

export function parseAssistantCommandJson(source: string): unknown {
  if (!source.trim()) throw new AssistantCommandError('INVALID_ARGUMENT', 2, t('errors:assistantCommand.inputJsonEmpty'))
  try {
    return JSON.parse(source) as unknown
  } catch {
    throw new AssistantCommandError('INVALID_JSON', 2, t('errors:assistantCommand.inputJsonInvalid'))
  }
}

export function requireJsonObjectInput(value: unknown): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AssistantCommandError('INVALID_ARGUMENT', 2, t('errors:assistantCommand.inputJsonObjectRequired'))
  }
}

export function rejectUnknownFields(
  value: unknown,
  allowedKeys: readonly string[],
  label: string
): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return
  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key)) {
      throw new AssistantCommandError(
        'INVALID_ARGUMENT',
        2,
        t('errors:assistantCommand.unknownArgument', { argument: `${label}.${key}` })
      )
    }
  }
}
