import { spawn, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { t } from './i18n'

const DEFAULT_TERMINATION_GRACE_MS = 750
const TASKKILL_TIMEOUT_MS = 2_000

export type ProcessTreeHandle = {
  pid?: number
  kill: (signal?: 'SIGTERM' | 'SIGKILL') => unknown
  onData?: unknown
  onExit?: (listener: () => void) => { dispose?: () => void } | void
}

export type ProcessTerminationResult = {
  terminated: boolean
  error?: string
}

export type TaskkillOptions = {
  environment?: NodeJS.ProcessEnv
  spawnProcess?: typeof spawn
  timeoutMs?: number
  isProcessAlive?: (pid: number) => boolean
}

/** Best-effort, bounded and idempotent process-tree termination. */
export async function terminateProcessTree(
  handle: ProcessTreeHandle,
  options: {
    platform?: NodeJS.Platform
    graceMs?: number
    isDirectChild?: (pid: number) => boolean
    taskkill?: TaskkillOptions
  } = {}
): Promise<ProcessTerminationResult> {
  const platform = options.platform ?? process.platform
  const pid = handle.pid
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) {
    return { terminated: false, error: t('errors:termination.invalidPid') }
  }
  if (platform === 'win32') {
    return terminateWindowsProcessTree(
      handle,
      pid,
      options.graceMs ?? DEFAULT_TERMINATION_GRACE_MS,
      options.taskkill
    )
  }
  return terminatePosixProcessTree(
    handle,
    pid,
    options.graceMs ?? DEFAULT_TERMINATION_GRACE_MS,
    options.isDirectChild?.(pid) ?? isDirectChildProcess(pid, platform)
  )
}

async function terminateWindowsProcessTree(
  handle: ProcessTreeHandle,
  pid: number,
  graceMs: number,
  options?: TaskkillOptions
): Promise<ProcessTerminationResult> {
  if (isPtyHandle(handle)) {
    let rootAlreadyExited = false
    try {
      rootAlreadyExited = !(options?.isProcessAlive ?? isProcessAlive)(pid)
    } catch {
      // If liveness cannot be checked, keep the full termination path.
    }
    if (rootAlreadyExited) return runTaskkill(pid, options)

    const exitWaiter = createPtyExitWaiter(handle, graceMs)
    const ptyErrors = exitWaiter.registrationError ? [exitWaiter.registrationError] : []
    const taskkill = await runTaskkill(pid, options)
    if (taskkill.terminated) {
      // taskkill 已在根进程仍存活时捕获并终止整棵树。等待 node-pty
      // 自然观察退出，避免再附加到一个已经关闭的 ConPTY 控制台。
      await exitWaiter.promise
      return taskkill
    }

    try {
      handle.kill()
    } catch (error) {
      ptyErrors.push(error instanceof Error ? error.message : String(error))
      exitWaiter.cancel()
    }
    const exited = await exitWaiter.promise
    return {
      terminated: exited,
      error: exited
        ? undefined
        : [...ptyErrors, taskkill.error].filter(Boolean).join('; ') || undefined
    }
  }

  // A regular ChildProcess does not kill its descendants. Keep the root alive
  // until taskkill has captured and terminated the complete parent/child tree.
  const taskkill = await runTaskkill(pid, options)
  if (taskkill.terminated) {
    try {
      handle.kill()
    } catch {
      // node-pty/ChildProcess may already have observed the exit.
    }
  }
  return taskkill
}

function isPtyHandle(
  handle: ProcessTreeHandle
): handle is ProcessTreeHandle & Required<Pick<ProcessTreeHandle, 'onExit'>> {
  return typeof handle.onData === 'function' && typeof handle.onExit === 'function'
}

function createPtyExitWaiter(
  handle: ProcessTreeHandle & Required<Pick<ProcessTreeHandle, 'onExit'>>,
  timeoutMs: number
): {
    promise: Promise<boolean>
    cancel: () => void
    registrationError?: string
  } {
  let settled = false
  let subscription: { dispose?: () => void } | void
  let timer: NodeJS.Timeout | undefined
  let resolvePromise: (exited: boolean) => void = () => undefined
  const promise = new Promise<boolean>((resolve) => {
    resolvePromise = resolve
  })
  const settle = (exited: boolean) => {
    if (settled) return
    settled = true
    if (timer) clearTimeout(timer)
    try {
      subscription?.dispose?.()
    } catch {
      // Listener disposal is best-effort after the PTY has exited.
    }
    resolvePromise(exited)
  }

  let registrationError: string | undefined
  try {
    subscription = handle.onExit(() => settle(true))
    if (settled) subscription?.dispose?.()
  } catch (error) {
    registrationError = error instanceof Error ? error.message : String(error)
    settle(false)
  }
  if (!settled) {
    if (timeoutMs > 0) timer = setTimeout(() => settle(false), timeoutMs)
    else settle(false)
  }

  return { promise, cancel: () => settle(false), registrationError }
}

async function terminatePosixProcessTree(
  handle: ProcessTreeHandle,
  pid: number,
  graceMs: number,
  ownsProcessGroup: boolean
): Promise<ProcessTerminationResult> {
  let termSent = false
  if (ownsProcessGroup) {
    try {
      process.kill(-pid, 'SIGTERM')
      termSent = true
    } catch {
      // Fall through to the direct child handle.
    }
  }
  if (!termSent) {
    try {
      handle.kill('SIGTERM')
      termSent = true
    } catch {
      return { terminated: true }
    }
  }

  if (termSent && graceMs > 0) {
    await new Promise<void>((resolve) => setTimeout(resolve, graceMs))
  }
  if (ownsProcessGroup) {
    try {
      process.kill(-pid, 'SIGKILL')
      return { terminated: true }
    } catch {
      // Fall through to the direct child handle.
    }
  }
  try {
    handle.kill('SIGKILL')
  } catch {
    // The process has already exited.
  }
  return { terminated: true }
}

function isDirectChildProcess(pid: number, platform: NodeJS.Platform): boolean {
  if (platform === 'linux') {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
      const commandEnd = stat.lastIndexOf(')')
      if (commandEnd < 0) return false
      const fields = stat.slice(commandEnd + 1).trim().split(/\s+/)
      return Number(fields[1]) === process.pid && Number(fields[2]) === pid
    } catch {
      return false
    }
  }
  if (platform === 'darwin') {
    try {
      const result = spawnSync('/bin/ps', ['-o', 'ppid=', '-o', 'pgid=', '-p', String(pid)], {
        encoding: 'utf8',
        timeout: 1_000,
        stdio: ['ignore', 'pipe', 'ignore']
      })
      const [parentPid, processGroupId] = result.stdout.trim().split(/\s+/).map(Number)
      return parentPid === process.pid && processGroupId === pid
    } catch {
      return false
    }
  }
  return false
}

export function resolveTaskkillPath(environment: NodeJS.ProcessEnv = process.env): string {
  const windowsRoot = getEnvironmentValue(environment, 'SystemRoot')
    ?? getEnvironmentValue(environment, 'WINDIR')
  if (!windowsRoot || windowsRoot.includes('\0') || !path.win32.isAbsolute(windowsRoot)) {
    throw new Error(t('errors:termination.taskkillNotFound'))
  }
  return path.win32.join(windowsRoot, 'System32', 'taskkill.exe')
}

export function runTaskkill(
  pid: number,
  options: TaskkillOptions = {}
): Promise<ProcessTerminationResult> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>
    try {
      const executable = resolveTaskkillPath(options.environment)
      child = (options.spawnProcess ?? spawn)(executable, ['/pid', String(pid), '/t', '/f'], {
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'pipe']
      })
    } catch (error) {
      resolve({
        terminated: false,
        error: t('errors:termination.taskkillStartFailed', {
          detail: error instanceof Error ? error.message : String(error)
        })
      })
      return
    }

    let settled = false
    let stderr = ''
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string | Buffer) => {
      stderr = (stderr + String(chunk)).slice(-4_096)
    })
    let timer: NodeJS.Timeout | undefined
    const finish = (result: ProcessTerminationResult) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve(result)
    }
    timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        // taskkill may already have exited.
      }
      finish({ terminated: false, error: t('errors:termination.taskkillTimeout') })
    }, options.timeoutMs ?? TASKKILL_TIMEOUT_MS)
    child.once('error', (error) => {
      finish({ terminated: false, error: t('errors:termination.taskkillExecFailed', { detail: error.message }) })
    })
    child.once('exit', (code) => {
      if (code === 0) {
        finish({ terminated: true })
        return
      }
      let processAlive = true
      try {
        processAlive = (options.isProcessAlive ?? isProcessAlive)(pid)
      } catch (error) {
        finish({
          terminated: false,
          error: t('errors:termination.taskkillResultUnknown', {
            detail: error instanceof Error ? error.message : String(error)
          })
        })
        return
      }
      if (!processAlive) {
        finish({ terminated: true })
        return
      }
      const detail = stderr.trim()
      finish({
        terminated: false,
        error: t('errors:termination.taskkillExitCode', {
          code: code ?? 'null',
          detail: detail || ''
        })
      })
    })
  })
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

function getEnvironmentValue(
  environment: NodeJS.ProcessEnv,
  name: string
): string | undefined {
  const match = Object.keys(environment).find((key) => key.toLowerCase() === name.toLowerCase())
  return match ? environment[match] : undefined
}
