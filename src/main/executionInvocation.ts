import path from 'node:path'
import {
  isWslExecutionTarget,
  toExecutionTargetDescriptor,
  type DetectedShell,
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
import {
  buildWslTransportEnvironment,
  createWslSessionDirectory,
  createWslSessionUnitName,
  mergeWslEnvValue,
  WslEnvironmentBlockTooLongError,
  WSL_SESSION_ENV,
  WSL_SESSION_SCOPE_LAUNCH_SCRIPT,
  WSL_SESSION_WRAPPER_SCRIPT,
  WSL_TRANSPORT_ENV_PREFIX,
  type WslSessionHandle
} from './wslService'
import { t } from './i18n'
import {
  ASSISTANT_BRIDGE_PORT_ENV,
  ASSISTANT_BRIDGE_TOKEN_ENV
} from '../shared/assistant'

export type ExecutionInvocationMode = 'interactive' | 'non-interactive' | 'assistant'

export type PreparedExecutionInvocation = PreparedShellCommand & ShellInvocation & {
  hostCwd: string
  targetCwd: string
  target: ExecutionTargetDescriptor
  wslSession?: WslSessionHandle
}

export function prepareExecutionInvocation(options: {
  target: ResolvedExecutionTarget
  mode: ExecutionInvocationMode
  command: string | ShellNeutralCommand
  targetCwd: string
  hostCwd: string
  sessionId: string
  baseEnvironment?: NodeJS.ProcessEnv
  requestEnvironment?: Record<string, string>
  allowInternalEnvironment?: boolean
  platform?: NodeJS.Platform
}): PreparedExecutionInvocation {
  const platform = options.platform ?? process.platform
  const baseEnvironment = options.baseEnvironment ?? process.env
  if (!isWslExecutionTarget(options.target)) {
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

  if (platform !== 'win32') throw new Error(t('errors:wsl.platformUnsupported'))
  const shellView: DetectedShell = {
    id: options.target.id,
    displayName: options.target.displayName,
    family: 'posix',
    executablePath: options.target.loginShellPath,
    source: 'login-shell'
  }
  assertWslRequestEnvironment(options.requestEnvironment, options.allowInternalEnvironment === true)
  const prepared = prepareShellCommand({
    shell: shellView,
    command: options.command,
    baseEnvironment,
    requestEnvironment: options.requestEnvironment,
    platform
  })
  const requestEnvironmentEntries = Object.entries(options.requestEnvironment ?? {})
  const requestedPath = requestEnvironmentEntries.find(([name]) => (
    name.toLocaleLowerCase('en-US') === 'path'
  ))?.[1]
  const targetEnvironment: Record<string, string> = {
    ...(
      requestedPath !== undefined || options.mode === 'non-interactive'
        ? { PATH: requestedPath ?? options.target.userShellPath }
        : {}
    ),
    ...Object.fromEntries(requestEnvironmentEntries.filter(([name]) => (
      name.toLocaleLowerCase('en-US') !== 'path'
    ))),
    [WSL_SESSION_ENV]: options.sessionId
  }
  for (const bindingName of prepared.bindingNames) {
    targetEnvironment[bindingName] = prepared.env[bindingName]
  }
  let transport: ReturnType<typeof buildWslSessionTransport>
  try {
    transport = buildWslSessionTransport(baseEnvironment, targetEnvironment)
  } catch (error) {
    if (
      !(error instanceof WslEnvironmentBlockTooLongError) ||
      requestedPath !== undefined ||
      !Object.hasOwn(targetEnvironment, 'PATH')
    ) {
      throw error
    }
    delete targetEnvironment.PATH
    transport = buildWslSessionTransport(baseEnvironment, targetEnvironment)
  }
  const mode = options.mode === 'non-interactive' ? 'command' : options.mode
  const sessionDirectory = createWslSessionDirectory(options.target.homeDirectory)
  const unitName = createWslSessionUnitName(options.sessionId)
  const scopedArguments = [
    WSL_SESSION_WRAPPER_SCRIPT,
    'cliloom-wsl-session', options.sessionId, options.target.loginShellPath, mode,
    prepared.command, sessionDirectory, unitName,
    ...transport.environmentMappings
  ]
  const args = [
    '--distribution', options.target.distributionName,
    '--cd', options.targetCwd,
    '--exec', '/bin/sh', '-c', WSL_SESSION_SCOPE_LAUNCH_SCRIPT,
    'cliloom-wsl-scope', options.target.homeDirectory, String(options.target.defaultUid),
    unitName, ...scopedArguments
  ]
  return {
    ...prepared,
    env: transport.env,
    executable: options.target.wslExecutablePath,
    args,
    hostCwd: ensureHostCwd(options.hostCwd),
    targetCwd: options.targetCwd,
    target: toExecutionTargetDescriptor(options.target),
    wslSession: {
      sessionId: options.sessionId,
      distributionName: options.target.distributionName,
      sessionDirectory,
      unitName
    }
  }
}

function buildWslSessionTransport(
  baseEnvironment: NodeJS.ProcessEnv,
  targetEnvironment: Record<string, string>
): {
  env: Record<string, string>
  environmentMappings: string[]
} {
  const transferred: Record<string, string> = {}
  const environmentMappings: string[] = []
  let transportIndex = 0
  for (const [targetName, value] of Object.entries(targetEnvironment)) {
    const sourceName = `${WSL_TRANSPORT_ENV_PREFIX}${transportIndex}`
    transportIndex += 1
    transferred[sourceName] = value
    environmentMappings.push(targetName, sourceName)
  }
  const finalWslEnv = mergeWslEnvValue(
    stripInternalWslEnvEntries(getEnvironmentValue(baseEnvironment, 'WSLENV')),
    Object.keys(targetEnvironment),
    ['PATH']
  )
  const wslEnvSourceName = `${WSL_TRANSPORT_ENV_PREFIX}${transportIndex}`
  transferred[wslEnvSourceName] = finalWslEnv
  environmentMappings.push('WSLENV', wslEnvSourceName)
  return {
    env: buildWslTransportEnvironment(baseEnvironment, transferred),
    environmentMappings
  }
}

function assertWslRequestEnvironment(
  environment: Record<string, string> | undefined,
  allowInternal: boolean
): void {
  const seen = new Set<string>()
  for (const [name, value] of Object.entries(environment ?? {})) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      throw new Error(t('errors:wsl.environmentNameInvalid', { name }))
    }
    if (value.includes('\0')) throw new Error(t('errors:wsl.environmentValueInvalid'))
    const key = name.toLocaleLowerCase('en-US')
    if (
      key === 'wslenv' ||
      key === WSL_SESSION_ENV.toLocaleLowerCase('en-US') ||
      key.startsWith(WSL_TRANSPORT_ENV_PREFIX.toLocaleLowerCase('en-US')) ||
      /^cliloom_internal_value_\d+$/.test(key) ||
      (!allowInternal && (
        key === ASSISTANT_BRIDGE_PORT_ENV.toLocaleLowerCase('en-US') ||
        key === ASSISTANT_BRIDGE_TOKEN_ENV.toLocaleLowerCase('en-US')
      ))
    ) {
      throw new Error(t('errors:wsl.environmentReserved'))
    }
    if (seen.has(key)) throw new Error(t('errors:wsl.environmentNameCollision'))
    seen.add(key)
  }
}

function getEnvironmentValue(environment: NodeJS.ProcessEnv, name: string): string | undefined {
  const key = Object.keys(environment).find((candidate) => (
    candidate.toLocaleLowerCase('en-US') === name.toLocaleLowerCase('en-US')
  ))
  return key ? environment[key] : undefined
}

function stripInternalWslEnvEntries(value: string | undefined): string | undefined {
  if (!value) return value
  return value.split(':').filter((entry) => {
    const name = entry.split('/')[0]
    return !name.toLocaleLowerCase('en-US').startsWith(
      WSL_TRANSPORT_ENV_PREFIX.toLocaleLowerCase('en-US')
    )
  }).join(':')
}

function ensureHostCwd(value: string): string {
  if (!value || value.includes('\0')) throw new Error(t('errors:wsl.pathInvalid'))
  return path.win32.isAbsolute(value) || path.isAbsolute(value) ? value : path.resolve(value)
}
