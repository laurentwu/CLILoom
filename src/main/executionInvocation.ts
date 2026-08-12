import {
  toExecutionTargetDescriptor,
  type ExecutionTargetDescriptor,
  type ResolvedExecutionTarget,
  type ShellNeutralCommand
} from '../shared/shell'
import {
  buildInteractiveInvocation,
  buildNonInteractiveInvocation,
  prepareShellCommand,
  type PreparedShellCommand,
  type ShellInvocation
} from './shellExecution'

export type ExecutionInvocationMode = 'interactive' | 'non-interactive'

export type PreparedExecutionInvocation = PreparedShellCommand & ShellInvocation & {
  hostCwd: string
  targetCwd: string
  target: ExecutionTargetDescriptor
}

export function prepareExecutionInvocation(options: {
  target: ResolvedExecutionTarget
  mode: ExecutionInvocationMode
  command: string | ShellNeutralCommand
  targetCwd: string
  hostCwd: string
  baseEnvironment?: NodeJS.ProcessEnv
  requestEnvironment?: Record<string, string>
  platform?: NodeJS.Platform
}): PreparedExecutionInvocation {
  const platform = options.platform ?? process.platform
  const baseEnvironment = options.baseEnvironment ?? process.env
  const prepared = prepareShellCommand({
    shell: options.target,
    command: options.command,
    baseEnvironment,
    requestEnvironment: options.requestEnvironment,
    platform
  })
  const invocation = options.mode === 'interactive'
    ? buildInteractiveInvocation(options.target)
    : buildNonInteractiveInvocation(options.target, prepared.command)
  return {
    ...prepared,
    ...invocation,
    hostCwd: options.targetCwd || options.hostCwd,
    targetCwd: options.targetCwd,
    target: toExecutionTargetDescriptor(options.target)
  }
}
