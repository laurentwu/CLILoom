import { accessSync, constants, readFileSync, realpathSync, statSync } from 'node:fs'
import path from 'node:path'
import type { SettingsService } from './settingsService'
import { t } from './i18n'
import {
  isWslExecutionTarget,
  toExecutionTargetDescriptor,
  type DetectedShell,
  type DetectedExecutionTarget,
  type ExecutionTargetDescriptor,
  type ResolvedExecutionTarget,
  type ResolvedWslTarget,
  type ShellDescriptor,
  type ShellDiscoverySource,
  type ShellFamily,
  type ShellPlatform,
  type ShellSnapshot
} from '../shared/shell'
import {
  parseWslUncPath,
  WslService,
  type WslSessionHandle
} from './wslService'
import type { ProcessTerminationResult } from './processTermination'
import type { ResolvedAssistantCommand } from '../shared/assistant'

export type ShellProbe = {
  inspect: (
    candidatePath: string,
    platform: NodeJS.Platform
  ) => { realPath: string } | null
  readText: (filePath: string) => string | null
}

export type ShellDiscoveryOptions = {
  platform?: NodeJS.Platform
  environment?: NodeJS.ProcessEnv
  probe?: ShellProbe
  additionalPaths?: string[]
}

type CandidateHint = {
  family?: ShellFamily
  displayName?: string
  source: ShellDiscoverySource
}

export class ShellUnavailableError extends Error {
  readonly code = 'SHELL_UNAVAILABLE'

  constructor(
    message: string,
    readonly shell: ShellDescriptor | null
  ) {
    super(message)
    this.name = 'ShellUnavailableError'
  }
}

export class ShellService {
  private environment: NodeJS.ProcessEnv
  private readonly platform: NodeJS.Platform
  private readonly probe: ShellProbe
  private readonly wslService: WslService
  private candidates: DetectedExecutionTarget[] = []
  private initialized = false
  private discovering = false
  private discoveryError: string | undefined
  private refreshSequence = 0
  private readonly listeners = new Set<(snapshot: ShellSnapshot) => void>()

  constructor(private readonly options: {
    settingsService: SettingsService
    environment?: NodeJS.ProcessEnv
    platform?: NodeJS.Platform
    probe?: ShellProbe
    wslService?: WslService
  }) {
    this.environment = options.environment ?? process.env
    this.platform = options.platform ?? process.platform
    this.probe = options.probe ?? defaultShellProbe
    this.wslService = options.wslService ?? new WslService({
      environment: this.environment,
      platform: this.platform
    })
  }

  getSnapshot(): ShellSnapshot {
    if (!this.initialized) this.replaceCandidates(this.discoverNative(), false)
    return this.buildSnapshot()
  }

  async refresh(): Promise<ShellSnapshot> {
    const sequence = ++this.refreshSequence
    this.discovering = true
    this.emit(this.buildSnapshot())
    const nativeCandidates = this.discoverNative()
    const priorWsl = this.candidates.filter(isWslExecutionTarget)
    this.wslService.clearCache()
    const discovery = await this.wslService.discover()
    if (sequence !== this.refreshSequence) return this.buildSnapshot()
    this.discoveryError = discovery.error
    const wslCandidates = discovery.error && discovery.targets.length === 0 && !discovery.authoritative
      ? priorWsl
      : discovery.targets
    this.replaceCandidates([...nativeCandidates, ...wslCandidates], false)
    this.discovering = false
    const snapshot = this.buildSnapshot()
    this.emit(snapshot)
    return snapshot
  }

  setEnvironment(environment: NodeJS.ProcessEnv): ShellSnapshot {
    this.environment = environment
    const wslCandidates = this.candidates.filter(isWslExecutionTarget)
    this.replaceCandidates([...this.discoverNative(), ...wslCandidates], false)
    const snapshot = this.buildSnapshot()
    this.emit(snapshot)
    return snapshot
  }

  select(value: unknown): ShellSnapshot {
    if (value === 'automatic') {
      this.options.settingsService.setShellPreferences({
        version: 2,
        selection: { mode: 'automatic' }
      })
      const wslCandidates = this.candidates.filter(isWslExecutionTarget)
      this.replaceCandidates([...this.discoverNative(), ...wslCandidates], false)
      const snapshot = this.buildSnapshot()
      this.emit(snapshot)
      return snapshot
    }
    if (typeof value !== 'string' || !value || value.length > 16_384) {
      throw new Error(t('errors:shell.invalidSelection'))
    }

    const target = this.candidates.find((candidate) => candidate.id === value)
    if (!target) throw new Error(t('errors:shell.mustBeDetected'))
    this.options.settingsService.setShellPreferences({
      version: 2,
      selection: {
        mode: 'explicit',
        shell: toExecutionTargetDescriptor(target)
      }
    })
    const snapshot = this.buildSnapshot()
    this.emit(snapshot)
    return snapshot
  }

  resolveEffectiveShell(): DetectedShell {
    // The catalog cache is for presentation only. Re-discover before every
    // process launch so an explicitly selected executable cannot disappear
    // between opening settings and starting a terminal.
    const wslCandidates = this.candidates.filter(isWslExecutionTarget)
    this.replaceCandidates([...this.discoverNative(), ...wslCandidates], true)
    const preferences = this.options.settingsService.getSnapshot().shell
    if (preferences.selection.mode === 'automatic') {
      const shell = selectDefaultShell(this.nativeCandidates(), this.platform, this.environment)
      if (shell) return shell
      throw new ShellUnavailableError(
        t('errors:shell.noneDetectedPlatform', { platform: this.platform }),
        null
      )
    }

    const selected = preferences.selection.shell
    if (isWslExecutionTarget(selected)) {
      throw new ShellUnavailableError(t('errors:wsl.targetRequiresAsyncResolution'), null)
    }
    const shell = this.nativeCandidates().find((candidate) => candidate.id === selected.id)
    if (shell && descriptorsMatch(shell, selected, this.platform)) return shell
    throw new ShellUnavailableError(
      t('errors:shell.unavailable', { name: selected.displayName, path: selected.executablePath }),
      selected
    )
  }

  async resolveEffectiveTarget(): Promise<ResolvedExecutionTarget> {
    const preferences = this.options.settingsService.getSnapshot().shell
    if (preferences.selection.mode === 'automatic') return this.resolveEffectiveShell()
    return this.resolveTarget(preferences.selection.shell)
  }

  async resolveTarget(target: ExecutionTargetDescriptor): Promise<ResolvedExecutionTarget> {
    if (isWslExecutionTarget(target)) {
      try {
        const resolved = await this.wslService.resolveTarget(target)
        this.candidates = this.candidates.map((candidate) => (
          isWslExecutionTarget(candidate) && candidate.id === resolved.id
            ? { ...resolved }
            : candidate
        ))
        this.emit(this.buildSnapshot())
        return resolved
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.candidates = this.candidates.map((candidate) => (
          isWslExecutionTarget(candidate) && candidate.id === target.id
            ? { ...candidate, validationState: 'unavailable', error: message }
            : candidate
        ))
        this.emit(this.buildSnapshot())
        throw error
      }
    }
    const candidates = this.discoverNative()
    const resolved = candidates.find((candidate) => candidate.id === target.id)
    if (resolved && descriptorsMatch(resolved, target, this.platform)) return resolved
    throw new ShellUnavailableError(
      t('errors:shell.unavailable', { name: target.displayName, path: target.executablePath }),
      target
    )
  }

  async resolveTargetPath(target: ResolvedExecutionTarget, value: string): Promise<string> {
    return isWslExecutionTarget(target)
      ? this.wslService.resolveTargetPath(target, value)
      : value
  }

  async resolveProjectPath(target: ResolvedExecutionTarget, value: string): Promise<string> {
    if (isWslExecutionTarget(target)) {
      const targetPath = parseWslUncPath(value)
        ? (await this.wslService.canonicalizeWslProjectPath(target, value)).targetPath
        : await this.wslService.resolveTargetPath(target, value)
      await this.wslService.assertDirectory(target, targetPath)
      return targetPath
    }
    if (typeof value !== 'string' || !value || value.includes('\0')) {
      throw new Error(t('errors:database.projectPathInvalid'))
    }
    if (this.platform === 'win32' && parseWslUncPath(value)) {
      throw new Error(t('errors:wsl.wslProjectRequiresWslTarget'))
    }
    try {
      if (!statSync(value).isDirectory()) throw new Error()
    } catch {
      throw new Error(t('errors:database.projectPathNotDirectory'))
    }
    return value
  }

  async getWslHomeWindowsPath(target: ResolvedWslTarget): Promise<string> {
    return this.wslService.getHomeWindowsPath(target)
  }

  async canonicalizeWslProjectPath(target: ResolvedWslTarget, value: string) {
    return this.wslService.canonicalizeWslProjectPath(target, value)
  }

  async resolveAssistantCommand(
    target: ResolvedWslTarget,
    command: unknown
  ): Promise<ResolvedAssistantCommand> {
    return this.wslService.resolveAssistantCommand(target, command)
  }

  async makeWslExecutable(target: ResolvedWslTarget, linuxPath: string): Promise<void> {
    return this.wslService.makeExecutable(target, linuxPath)
  }

  async validateWslAssistantInterop(
    target: ResolvedWslTarget,
    linuxLauncherPath: string,
    transferred: Record<string, string>
  ): Promise<void> {
    return this.wslService.validateAssistantInterop(target, linuxLauncherPath, transferred)
  }

  terminateWslSession(handle: WslSessionHandle): Promise<ProcessTerminationResult> {
    return this.wslService.terminateSession(handle)
  }

  finalizeWslSession(handle: WslSessionHandle): Promise<ProcessTerminationResult> {
    return this.wslService.finalizeSession(handle)
  }

  onChanged(listener: (snapshot: ShellSnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private discoverNative(): DetectedShell[] {
    const preferences = this.options.settingsService.getSnapshot().shell
    return discoverShells({
      platform: this.platform,
      environment: this.environment,
      probe: this.probe,
      additionalPaths: preferences.selection.mode === 'explicit' && !isWslExecutionTarget(preferences.selection.shell)
        ? [preferences.selection.shell.executablePath]
        : undefined
    })
  }

  private nativeCandidates(): DetectedShell[] {
    return this.candidates.filter((candidate): candidate is DetectedShell => !isWslExecutionTarget(candidate))
  }

  private replaceCandidates(candidates: DetectedExecutionTarget[], emitIfChanged: boolean): void {
    const changed = JSON.stringify(candidates) !== JSON.stringify(this.candidates)
    this.candidates = candidates
    this.initialized = true
    if (changed && emitIfChanged) this.emit(this.buildSnapshot())
  }

  private buildSnapshot(): ShellSnapshot {
    const preferences = this.options.settingsService.getSnapshot().shell
    if (preferences.selection.mode === 'automatic') {
      const effectiveShell = selectDefaultShell(this.nativeCandidates(), this.platform, this.environment)
      return {
        platform: toShellPlatform(this.platform),
        preferences,
        candidates: [...this.candidates],
        effectiveShell,
        ...(this.discovering ? { discovering: true } : {}),
        ...(this.discoveryError ? { catalogError: this.discoveryError } : {}),
        ...(effectiveShell
          ? {}
          : { error: t('errors:shell.noneDetectedPlatformShort', { platform: this.platform }) })
      }
    }

    const selected = preferences.selection.shell
    const matched = this.candidates.find((candidate) => (
      candidate.id === selected.id && targetsMatch(candidate, selected, this.platform)
    )) ?? null
    const effectiveShell = matched && (!isWslExecutionTarget(matched) || matched.validationState !== 'unavailable')
      ? matched
      : null
    return {
      platform: toShellPlatform(this.platform),
      preferences,
      candidates: [...this.candidates],
      effectiveShell,
      ...(this.discovering ? { discovering: true } : {}),
      ...(this.discoveryError ? { catalogError: this.discoveryError } : {}),
      ...(effectiveShell
        ? {}
        : { error: matched && isWslExecutionTarget(matched) && matched.error
            ? matched.error
            : formatUnavailableTarget(selected) })
    }
  }

  private emit(snapshot: ShellSnapshot): void {
    for (const listener of this.listeners) listener(snapshot)
  }
}

export function discoverShells(options: ShellDiscoveryOptions = {}): DetectedShell[] {
  const platform = options.platform ?? process.platform
  const environment = options.environment ?? process.env
  const probe = options.probe ?? defaultShellProbe
  const pathApi = platform === 'win32' ? path.win32 : path.posix
  const found: DetectedShell[] = []
  const seenRealPaths = new Set<string>()

  const add = (candidatePath: string | undefined, hint: CandidateHint): void => {
    if (!candidatePath || candidatePath.includes('\0')) return
    const launchPath = normalizeLaunchPath(candidatePath, platform)
    const inspected = probe.inspect(launchPath, platform)
    if (!inspected) return
    const classified = hint.family && hint.displayName
      ? { family: hint.family, displayName: hint.displayName }
      : classifyShell(launchPath, inspected.realPath, platform, hint.source)
    if (!classified) return
    const realKey = normalizePathKey(inspected.realPath, platform)
    if (seenRealPaths.has(realKey)) return
    seenRealPaths.add(realKey)
    found.push({
      id: createShellId(classified.family, launchPath, platform),
      displayName: classified.displayName,
      family: classified.family,
      executablePath: launchPath,
      source: hint.source
    })
  }

  const resolveCommand = (command: string, source: ShellDiscoverySource): void => {
    for (const candidate of executableCandidates(command, environment, platform)) {
      add(candidate, { source })
    }
  }

  // Validate a persisted explicit launch path first so realpath de-duplication
  // does not replace its stable ID with a different symlink spelling.
  for (const candidate of options.additionalPaths ?? []) {
    add(candidate, { source: 'system' })
  }

  if (platform === 'win32') {
    resolveCommand('pwsh', 'path')
    resolveCommand('powershell', 'path')
    add(getEnvironmentValue(environment, 'ComSpec'), { source: 'comspec' })
    resolveCommand('cmd', 'system')

    const programFiles = [
      getEnvironmentValue(environment, 'ProgramFiles'),
      getEnvironmentValue(environment, 'ProgramFiles(x86)'),
      getEnvironmentValue(environment, 'LocalAppData')
    ].filter((value): value is string => Boolean(value))
    for (const root of programFiles) {
      const candidates = root.toLowerCase().endsWith('local')
        ? [pathApi.join(root, 'Programs', 'Git', 'bin', 'bash.exe')]
        : [
            pathApi.join(root, 'Git', 'bin', 'bash.exe'),
            pathApi.join(root, 'Git', 'usr', 'bin', 'bash.exe')
          ]
      for (const candidate of candidates) {
        add(candidate, {
          family: 'posix',
          displayName: 'Git Bash',
          source: 'git-for-windows'
        })
      }
    }
    for (const candidate of executableCandidates('bash', environment, platform)) {
      add(candidate, { source: 'path' })
    }
  } else {
    add(getEnvironmentValue(environment, 'SHELL'), { source: 'login-shell' })
    const shellsFile = probe.readText('/etc/shells')
    if (shellsFile) {
      for (const line of shellsFile.split(/\r?\n/)) {
        const candidate = line.trim()
        if (!candidate || candidate.startsWith('#')) continue
        add(candidate, { source: 'system' })
      }
    }
    for (const command of ['zsh', 'bash', 'sh']) resolveCommand(command, 'path')
    for (const candidate of ['/bin/zsh', '/bin/bash', '/bin/sh', '/usr/bin/zsh', '/usr/bin/bash', '/usr/bin/sh']) {
      add(candidate, { source: 'system' })
    }
  }

  return sortShellCandidates(found, platform)
}

export function selectDefaultShell(
  candidates: DetectedShell[],
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env
): DetectedShell | null {
  const byExecutableName = (names: string[]): DetectedShell | undefined => candidates.find((candidate) => {
    const name = executableBaseName(candidate.executablePath, platform)
    return names.includes(name)
  })
  const loginShellPath = getEnvironmentValue(environment, 'SHELL')
  const loginShell = loginShellPath
    ? candidates.find((candidate) => normalizePathKey(candidate.executablePath, platform) === normalizePathKey(loginShellPath, platform))
      ?? candidates.find((candidate) => (
        executableBaseName(candidate.executablePath, platform) === executableBaseName(loginShellPath, platform)
      ))
    : undefined

  if (platform === 'win32') {
    return byExecutableName(['pwsh.exe', 'pwsh'])
      ?? byExecutableName(['powershell.exe', 'powershell'])
      ?? byExecutableName(['cmd.exe', 'cmd'])
      ?? candidates[0]
      ?? null
  }
  if (platform === 'darwin') {
    return byExecutableName(['zsh']) ?? loginShell ?? byExecutableName(['sh']) ?? candidates[0] ?? null
  }
  return byExecutableName(['bash']) ?? loginShell ?? byExecutableName(['sh']) ?? candidates[0] ?? null
}

export function createShellId(
  family: ShellFamily,
  executablePath: string,
  platform: NodeJS.Platform = process.platform
): string {
  return `${family}:${encodeURIComponent(normalizePathKey(executablePath, platform))}`
}

function classifyShell(
  launchPath: string,
  realPath: string,
  platform: NodeJS.Platform,
  source: ShellDiscoverySource
): { family: ShellFamily; displayName: string } | null {
  const name = executableBaseName(launchPath, platform)
  if (name === 'pwsh' || name === 'pwsh.exe') {
    return { family: 'powershell', displayName: 'PowerShell 7' }
  }
  if (name === 'powershell' || name === 'powershell.exe') {
    return { family: 'powershell', displayName: 'Windows PowerShell' }
  }
  if (name === 'cmd' || name === 'cmd.exe') {
    return { family: 'cmd', displayName: 'Command Prompt' }
  }
  if (name === 'bash' || name === 'bash.exe') {
    if (platform === 'win32') {
      const key = `${normalizePathKey(launchPath, platform)}\n${normalizePathKey(realPath, platform)}`
      if (source !== 'git-for-windows' && !key.includes('\\git\\') && !key.includes('/git/')) return null
      return { family: 'posix', displayName: 'Git Bash' }
    }
    return { family: 'posix', displayName: 'bash' }
  }
  if (platform !== 'win32' && (name === 'zsh' || name === 'sh')) {
    return { family: 'posix', displayName: name }
  }
  return null
}

function executableCandidates(
  executable: string,
  environment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform
): string[] {
  const pathApi = platform === 'win32' ? path.win32 : path.posix
  if (pathApi.isAbsolute(executable)) return [executable]
  const pathValue = getEnvironmentValue(environment, 'PATH') ?? ''
  const delimiter = platform === 'win32' ? ';' : ':'
  const extensions = platform === 'win32'
    ? windowsExecutableExtensions(executable, environment)
    : ['']
  const candidates: string[] = []
  for (const rawDirectory of pathValue.split(delimiter)) {
    const directory = stripOuterQuotes(rawDirectory.trim())
    if (!directory) continue
    for (const extension of extensions) {
      candidates.push(pathApi.join(directory, `${executable}${extension}`))
    }
  }
  return candidates
}

function windowsExecutableExtensions(executable: string, environment: NodeJS.ProcessEnv): string[] {
  if (path.win32.extname(executable)) return ['']
  const pathext = getEnvironmentValue(environment, 'PATHEXT') ?? '.COM;.EXE;.BAT;.CMD'
  return pathext.split(';').filter(Boolean).map((extension) => (
    extension.startsWith('.') ? extension : `.${extension}`
  ))
}

function normalizeLaunchPath(value: string, platform: NodeJS.Platform): string {
  const pathApi = platform === 'win32' ? path.win32 : path.posix
  return pathApi.normalize(value)
}

function normalizePathKey(value: string, platform: NodeJS.Platform): string {
  const normalized = normalizeLaunchPath(value, platform)
  return platform === 'win32' ? normalized.toLowerCase() : normalized
}

function executableBaseName(value: string, platform: NodeJS.Platform): string {
  const pathApi = platform === 'win32' ? path.win32 : path.posix
  return pathApi.basename(value).toLowerCase()
}

function sortShellCandidates(
  candidates: DetectedShell[],
  platform: NodeJS.Platform
): DetectedShell[] {
  const rank = (shell: DetectedShell): number => {
    const name = executableBaseName(shell.executablePath, platform)
    if (platform === 'win32') {
      if (name === 'pwsh.exe' || name === 'pwsh') return 0
      if (name === 'powershell.exe' || name === 'powershell') return 1
      if (name === 'cmd.exe' || name === 'cmd') return 2
      return 3
    }
    if (platform === 'darwin') {
      if (name === 'zsh') return 0
      if (shell.source === 'login-shell') return 1
      if (name === 'sh') return 2
      return 3
    }
    if (name === 'bash') return 0
    if (shell.source === 'login-shell') return 1
    if (name === 'sh') return 2
    return 3
  }
  return candidates
    .map((shell, index) => ({ shell, index }))
    .sort((left, right) => rank(left.shell) - rank(right.shell) || left.index - right.index)
    .map(({ shell }) => shell)
}

function descriptorsMatch(
  candidate: ShellDescriptor,
  selected: ShellDescriptor,
  platform: NodeJS.Platform
): boolean {
  return candidate.id === selected.id &&
    candidate.family === selected.family &&
    normalizePathKey(candidate.executablePath, platform) === normalizePathKey(selected.executablePath, platform)
}

function targetsMatch(
  candidate: DetectedExecutionTarget,
  selected: ExecutionTargetDescriptor,
  platform: NodeJS.Platform
): boolean {
  if (isWslExecutionTarget(candidate) || isWslExecutionTarget(selected)) {
    return isWslExecutionTarget(candidate) && isWslExecutionTarget(selected) &&
      candidate.id === selected.id &&
      candidate.distributionName.toLocaleLowerCase('en-US') === selected.distributionName.toLocaleLowerCase('en-US')
  }
  return descriptorsMatch(candidate, selected, platform)
}

function formatUnavailableTarget(target: ExecutionTargetDescriptor): string {
  return isWslExecutionTarget(target)
    ? t('errors:wsl.distributionMissing', { distribution: target.distributionName })
    : t('errors:shell.unavailableShort', { name: target.displayName, path: target.executablePath })
}

function getEnvironmentValue(environment: NodeJS.ProcessEnv, name: string): string | undefined {
  if (name in environment) return environment[name]
  const match = Object.keys(environment).find((key) => key.toLowerCase() === name.toLowerCase())
  return match ? environment[match] : undefined
}

function stripOuterQuotes(value: string): string {
  return value.length >= 2 && value.startsWith('"') && value.endsWith('"')
    ? value.slice(1, -1)
    : value
}

function toShellPlatform(platform: NodeJS.Platform): ShellPlatform {
  if (platform === 'win32' || platform === 'darwin' || platform === 'linux') return platform
  return 'other'
}

const defaultShellProbe: ShellProbe = {
  inspect(candidatePath, platform) {
    try {
      const realPath = realpathSync(candidatePath)
      if (!statSync(realPath).isFile()) return null
      if (platform !== 'win32') accessSync(realPath, constants.X_OK)
      return { realPath }
    } catch {
      return null
    }
  },
  readText(filePath) {
    try {
      return readFileSync(filePath, 'utf8')
    } catch {
      return null
    }
  }
}
