import { parseShellNeutralCommand, type ShellNeutralCommand } from './shell'
import type { TerminalRetryMode } from './terminalSession'

export type TerminalCommandTemplateSnapshot = {
  version: 1
  syntax: 'workflow' | 'replay'
  template: string
  variables: Record<string, string>
}

export type TerminalRetryDraft = {
  sessionId: string
  mode: TerminalRetryMode
  revision: string
  command: string
  source: 'workflow-retry-command' | 'saved-command'
  syntax: 'workflow' | 'replay'
  cwd: string
  executionTargetName: string | null
  hasSavedVariables: boolean
}

export type TerminalRetryEdit = {
  revision: string
  command: string
}

export type TerminalRetryTemplateErrorCode =
  | 'invalid-template'
  | 'unknown-variable'
  | 'unknown-saved-variable'

export class TerminalRetryTemplateError extends Error {
  constructor(readonly code: TerminalRetryTemplateErrorCode, readonly variable?: string) {
    super(code)
    this.name = 'TerminalRetryTemplateError'
  }
}

const VARIABLE_REFERENCE_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g
const SAVED_VARIABLE_PATTERN = /^retry_saved_[1-9][0-9]*$/
const BINDING_PREFIX = 'CLILOOM_INTERNAL_VALUE_'

export function parseTerminalRetryEdit(value: unknown): TerminalRetryEdit | null {
  if (!isRecord(value)) return null
  const keys = Object.keys(value)
  if (
    keys.some((key) => key !== 'revision' && key !== 'command') ||
    typeof value.revision !== 'string' || !value.revision || value.revision.includes('\0') ||
    typeof value.command !== 'string' || value.command.includes('\0')
  ) return null
  return { revision: value.revision, command: value.command }
}

export function parseTerminalCommandTemplateSnapshot(
  value: unknown,
  command?: ShellNeutralCommand
): TerminalCommandTemplateSnapshot | null {
  if (!isRecord(value) || value.version !== 1) return null
  if (value.syntax !== 'workflow' && value.syntax !== 'replay') return null
  if (typeof value.template !== 'string' || value.template.includes('\0')) return null
  if (!isRecord(value.variables)) return null
  const variables: Record<string, string> = {}
  for (const [name, variableValue] of Object.entries(value.variables)) {
    if (!isVariableName(name) || typeof variableValue !== 'string' || variableValue.includes('\0')) {
      return null
    }
    variables[name] = variableValue
  }
  const snapshot: TerminalCommandTemplateSnapshot = {
    version: 1,
    syntax: value.syntax,
    template: value.template,
    variables
  }
  if (!command) return snapshot
  try {
    return commandsAreSemanticallyEqual(command, bindTerminalCommandTemplate(snapshot.template, snapshot))
      ? snapshot
      : null
  } catch {
    return null
  }
}

export function restoreTerminalCommandTemplate(
  commandValue: ShellNeutralCommand,
  snapshotValue?: unknown
): TerminalCommandTemplateSnapshot {
  const command = parseShellNeutralCommand(commandValue)
  if (!command) throw new TerminalRetryTemplateError('invalid-template')
  const savedSnapshot = parseTerminalCommandTemplateSnapshot(snapshotValue, command)
  if (savedSnapshot) return savedSnapshot

  const unavailableNames = new Set<string>(Object.keys(command.bindings))
  for (const segment of command.segments) {
    if (segment.type !== 'literal') continue
    for (const name of referencedVariableNames(segment.value)) unavailableNames.add(name)
  }

  const bindingNames = new Map<string, string>()
  const variables: Record<string, string> = {}
  let nextIndex = 1
  let template = ''
  for (const segment of command.segments) {
    if (segment.type === 'literal') {
      template += segment.value
      continue
    }
    let editableName = bindingNames.get(segment.name)
    if (!editableName) {
      do {
        editableName = `retry_saved_${nextIndex}`
        nextIndex += 1
      } while (unavailableNames.has(editableName))
      bindingNames.set(segment.name, editableName)
      unavailableNames.add(editableName)
      variables[editableName] = command.bindings[segment.name]
    }
    template += `\${${editableName}}`
  }
  return { version: 1, syntax: 'replay', template, variables }
}

export function bindTerminalCommandTemplate(
  template: string,
  snapshot: TerminalCommandTemplateSnapshot,
  reservedEnvironmentNames: Iterable<string> = []
): ShellNeutralCommand {
  if (template.includes('\0') || !template.trim()) {
    throw new TerminalRetryTemplateError('invalid-template')
  }
  const originalReferences = new Set(referencedVariableNames(snapshot.template))
  return bindSelectedReferences(
    template,
    (name) => {
      if (Object.hasOwn(snapshot.variables, name)) return snapshot.variables[name]
      if (snapshot.syntax === 'workflow') {
        throw new TerminalRetryTemplateError('unknown-variable', name)
      }
      if (SAVED_VARIABLE_PATTERN.test(name) && !originalReferences.has(name)) {
        throw new TerminalRetryTemplateError('unknown-saved-variable', name)
      }
      return undefined
    },
    reservedEnvironmentNames
  )
}

export function bindMixedWorkflowRetryTemplate(
  template: string,
  variables: Record<string, string | number | boolean | null>,
  replaySnapshot: TerminalCommandTemplateSnapshot | undefined,
  stringify: (value: string | number | boolean | null | undefined) => string,
  reservedEnvironmentNames: Iterable<string> = []
): { command: ShellNeutralCommand; snapshot: TerminalCommandTemplateSnapshot } {
  if (template.includes('\0') || !template.trim()) {
    throw new TerminalRetryTemplateError('invalid-template')
  }
  const originalReferences = new Set(
    replaySnapshot?.syntax === 'replay'
      ? referencedVariableNames(replaySnapshot.template)
      : []
  )
  const captured: Record<string, string> = {}
  const command = bindSelectedReferences(
    template,
    (name) => {
      if (replaySnapshot?.syntax === 'replay' && Object.hasOwn(replaySnapshot.variables, name)) {
        const value = replaySnapshot.variables[name]
        captured[name] = value
        return value
      }
      if (
        replaySnapshot?.syntax === 'replay' &&
        SAVED_VARIABLE_PATTERN.test(name) &&
        !originalReferences.has(name)
      ) {
        throw new TerminalRetryTemplateError('unknown-saved-variable', name)
      }
      if (
        replaySnapshot?.syntax === 'replay' &&
        SAVED_VARIABLE_PATTERN.test(name) &&
        originalReferences.has(name)
      ) return undefined
      const value = stringify(variables[name])
      captured[name] = value
      return value
    },
    reservedEnvironmentNames
  )
  return {
    command,
    snapshot: { version: 1, syntax: 'replay', template, variables: captured }
  }
}

export function commandsAreSemanticallyEqual(
  leftValue: ShellNeutralCommand,
  rightValue: ShellNeutralCommand
): boolean {
  const left = parseShellNeutralCommand(leftValue)
  const right = parseShellNeutralCommand(rightValue)
  if (!left || !right) return false
  const tokens = (command: ShellNeutralCommand): Array<
    { type: 'literal'; value: string } | { type: 'binding'; id: number; value: string }
  > => {
    const result: Array<
      { type: 'literal'; value: string } | { type: 'binding'; id: number; value: string }
    > = []
    const bindingIds = new Map<string, number>()
    for (const segment of command.segments) {
      const token = segment.type === 'literal'
        ? { type: 'literal' as const, value: segment.value }
        : {
            type: 'binding' as const,
            id: bindingIds.get(segment.name) ?? bindingIds.size,
            value: command.bindings[segment.name]
          }
      if (segment.type === 'binding' && !bindingIds.has(segment.name)) {
        bindingIds.set(segment.name, token.type === 'binding' ? token.id : bindingIds.size)
      }
      const previous = result.at(-1)
      if (token.type === 'literal' && previous?.type === 'literal') previous.value += token.value
      else if (token.value || token.type === 'binding') result.push(token)
    }
    return result
  }
  return JSON.stringify(tokens(left)) === JSON.stringify(tokens(right))
}

export function referencedVariableNames(template: string): string[] {
  const result: string[] = []
  VARIABLE_REFERENCE_PATTERN.lastIndex = 0
  for (
    let match = VARIABLE_REFERENCE_PATTERN.exec(template);
    match;
    match = VARIABLE_REFERENCE_PATTERN.exec(template)
  ) result.push(match[1])
  return result
}

function bindSelectedReferences(
  template: string,
  resolve: (name: string) => string | undefined,
  reservedEnvironmentNames: Iterable<string>
): ShellNeutralCommand {
  const reserved = new Set([...reservedEnvironmentNames].map((name) => name.toLowerCase()))
  const bindingNames = new Map<string, string>()
  const bindings: Record<string, string> = {}
  const segments: ShellNeutralCommand['segments'] = []
  let literalStart = 0
  let bindingIndex = 0
  VARIABLE_REFERENCE_PATTERN.lastIndex = 0
  for (
    let match = VARIABLE_REFERENCE_PATTERN.exec(template);
    match;
    match = VARIABLE_REFERENCE_PATTERN.exec(template)
  ) {
    const name = match[1]
    const value = resolve(name)
    if (value === undefined) continue
    if (match.index > literalStart) {
      segments.push({ type: 'literal', value: template.slice(literalStart, match.index) })
    }
    let bindingName = bindingNames.get(name)
    if (!bindingName) {
      do {
        bindingName = `${BINDING_PREFIX}${bindingIndex}`
        bindingIndex += 1
      } while (reserved.has(bindingName.toLowerCase()) || Object.hasOwn(bindings, bindingName))
      bindingNames.set(name, bindingName)
      bindings[bindingName] = value
    }
    segments.push({ type: 'binding', name: bindingName })
    literalStart = match.index + match[0].length
  }
  if (literalStart < template.length || segments.length === 0) {
    segments.push({ type: 'literal', value: template.slice(literalStart) })
  }
  return { version: 1, segments, bindings }
}

function isVariableName(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
