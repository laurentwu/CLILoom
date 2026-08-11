import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { accessSync, constants } from 'node:fs'
import path from 'node:path'
import {
  createWslTargetId,
  type DetectedWslTarget,
  type ResolvedWslTarget,
  type WslExecutionTargetDescriptor
} from '../shared/shell'
import {
  parseAssistantCommand,
  type ResolvedAssistantCommand
} from '../shared/assistant'
import { t } from './i18n'
import type { ProcessTerminationResult } from './processTermination'

const DEFAULT_TIMEOUT_MS = 5_000
const DEFAULT_OUTPUT_LIMIT = 256 * 1024
const LOGIN_SHELL_PROBE_TIMEOUT_MS = 10_000
const VALIDATION_CACHE_MS = 30_000
const WSL_PROBE_ENV = 'CLILOOM_WSL_PROBE'
const TRUSTED_LINUX_PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
const USER_PATH_BEGIN_MARKER = '__CLILOOM_USER_PATH_BEGIN__'
const USER_PATH_END_MARKER = '__CLILOOM_USER_PATH_END__'
const COMMAND_PATH_BEGIN_MARKER = '__CLILOOM_COMMAND_PATH_BEGIN__'
const COMMAND_PATH_END_MARKER = '__CLILOOM_COMMAND_PATH_END__'
export const WSL_SESSION_ENV = 'CLILOOM_SESSION_ID'
export const WSL_TRANSPORT_ENV_PREFIX = 'CLILOOM_WSL_TRANSPORT_'

export type WslCommandResult = {
  exitCode: number | null
  stdout: Buffer
  stderr: Buffer
  timedOut?: boolean
}

export type WslCommandExecutor = (
  executable: string,
  args: string[],
  options: {
    env: NodeJS.ProcessEnv
    timeoutMs: number
    maxOutputBytes: number
  }
) => Promise<WslCommandResult>

export type WslDiscoveryResult = {
  targets: DetectedWslTarget[]
  error?: string
  authoritative?: boolean
}

export type WslSessionHandle = {
  sessionId: string
  distributionName: string
  sessionDirectory: string
  unitName: string
}

type ValidationCacheEntry = {
  expiresAt: number
  target: ResolvedWslTarget
}

export const CGROUP_SCOPE_PROBE_SCRIPT = [
  'set -eu',
  "parent_cgroup=$(awk -F: '$1 == \"0\" { print $3; exit }' /proc/$$/cgroup)",
  'case "$parent_cgroup" in /*) ;; *) exit 51 ;; esac',
  '[ -r "/sys/fs/cgroup$parent_cgroup/cgroup.procs" ] || exit 52',
  'child=',
  'cleanup_scope_probe() {',
  '  if [ -n "$child" ]; then',
  '    kill "$child" 2>/dev/null || true',
  '    wait "$child" 2>/dev/null || true',
  '  fi',
  '}',
  "trap 'cleanup_scope_probe' EXIT HUP INT TERM",
  'env -i PATH="$PATH" setsid /bin/sh -c \'sleep 5\' &',
  'child=$!',
  'attempts=0',
  'while [ ! -r "/proc/$child/cgroup" ] && [ "$attempts" -lt 20 ]; do',
  '  sleep 0.05',
  '  attempts=$((attempts + 1))',
  'done',
  '[ -r "/proc/$child/cgroup" ] || exit 53',
  "child_cgroup=$(awk -F: '$1 == \"0\" { print $3; exit }' \"/proc/$child/cgroup\")",
  '[ "$child_cgroup" = "$parent_cgroup" ] || exit 54',
  'cleanup_scope_probe',
  'child=',
  'trap - EXIT HUP INT TERM'
].join('\n')

export const CAPABILITY_PROBE_SCRIPT = [
  'set -eu',
  `PATH=${TRUSTED_LINUX_PATH}`,
  'export PATH',
  'uid=$(id -u)',
  "home=$(awk -F: -v wanted=\"$uid\" '$3 == wanted { print $6; exit }' /etc/passwd)",
  "shell=$(awk -F: -v wanted=\"$uid\" '$3 == wanted { print $7; exit }' /etc/passwd)",
  '[ -n "$home" ]',
  '[ -n "$shell" ]',
  'command -v wslpath >/dev/null',
  'command -v awk >/dev/null',
  'command -v tr >/dev/null',
  'command -v grep >/dev/null',
  'command -v sleep >/dev/null',
  'command -v readlink >/dev/null',
  'command -v od >/dev/null',
  'command -v cat >/dev/null',
  'command -v kill >/dev/null',
  'command -v mkdir >/dev/null',
  'command -v chmod >/dev/null',
  'command -v mv >/dev/null',
  'command -v rm >/dev/null',
  'command -v printf >/dev/null',
  'command -v env >/dev/null',
  'command -v setsid >/dev/null',
  'command -v systemd-run >/dev/null',
  '[ -r /sys/fs/cgroup/cgroup.controllers ]',
  'test -r /proc/$$/stat',
  '[ -n "${CLILOOM_WSL_PROBE-}" ]',
  'probe_child=',
  'cleanup_probe_child() {',
  '  if [ -n "$probe_child" ]; then',
  '    kill "$probe_child" 2>/dev/null || true',
  '    wait "$probe_child" 2>/dev/null || true',
  '  fi',
  '}',
  "trap 'cleanup_probe_child' EXIT",
  "trap 'exit 129' HUP",
  "trap 'exit 130' INT",
  "trap 'exit 143' TERM",
  'sleep 5 &',
  'probe_child=$!',
  '[ -r "/proc/$probe_child/environ" ]',
  "tr '\\000' '\\n' < \"/proc/$probe_child/environ\" | grep -Fqx \"CLILOOM_WSL_PROBE=$CLILOOM_WSL_PROBE\"",
  'cleanup_probe_child',
  'probe_child=',
  'trap - EXIT HUP INT TERM',
  'scope_unit=cliloom-probe-${CLILOOM_WSL_PROBE}.scope',
  'systemd_run_expand_option=',
  "if systemd-run --help 2>/dev/null | grep -Fq -- '--expand-environment'; then",
  '  systemd_run_expand_option=--expand-environment=no',
  'fi',
  `systemd-run $systemd_run_expand_option --user --scope --quiet --collect --unit="$scope_unit" /bin/sh -c ${quotePosixShellArgument(CGROUP_SCOPE_PROBE_SCRIPT)} cliloom-cgroup-probe`,
  "printf '__CLILOOM_DISTRO__%s\\n' \"${WSL_DISTRO_NAME-}\"",
  "printf '__CLILOOM_UID__%s\\n' \"$uid\"",
  "printf '__CLILOOM_HOME__%s\\n' \"$home\"",
  "printf '__CLILOOM_SHELL__%s\\n' \"$shell\"",
  "printf '__CLILOOM_ENV__%s\\n' \"${CLILOOM_WSL_PROBE-}\""
].join('\n')

export const USER_SHELL_PATH_PROBE_SCRIPT = [
  'set -eu',
  `printf '${USER_PATH_BEGIN_MARKER}\\n'`,
  "printf '%s\\n' \"$PATH\"",
  `printf '${USER_PATH_END_MARKER}\\n'`
].join('\n')

export const LINUX_COMMAND_PROBE_SCRIPT = [
  'set -eu',
  'requested=$1',
  'user_path=$PATH',
  `PATH=${TRUSTED_LINUX_PATH}`,
  'export PATH',
  'case "$requested" in',
  '  */*)',
  '    case "$requested" in /*) candidate=$requested ;; *) exit 43 ;; esac',
  '    ;;',
  '  *)',
  '    linux_path=',
  '    old_ifs=$IFS',
  '    IFS=:',
  '    for directory in $user_path; do',
  '      [ -n "$directory" ] || continue',
  '      mapped=$(wslpath -w "$directory" 2>/dev/null || true)',
  "      lower=$(printf '%s' \"$mapped\" | tr '[:upper:]' '[:lower:]')",
  "      case \"$lower\" in '\\\\wsl$\\'*|'\\\\wsl.localhost\\'*) ;; *) continue ;; esac",
  '      if [ -z "$linux_path" ]; then linux_path=$directory; else linux_path=$linux_path:$directory; fi',
  '    done',
  '    IFS=$old_ifs',
  '    [ -n "$linux_path" ]',
  '    candidate=$(PATH=$linux_path command -v "$requested" 2>/dev/null || true)',
  '    ;;',
  'esac',
  'case "$candidate" in /*) ;; *) exit 44 ;; esac',
  'resolved=$(readlink -f "$candidate" 2>/dev/null || true)',
  '[ -n "$resolved" ]',
  '[ -f "$resolved" ]',
  '[ -x "$resolved" ]',
  'mapped=$(wslpath -w "$resolved" 2>/dev/null || true)',
  "lower=$(printf '%s' \"$mapped\" | tr '[:upper:]' '[:lower:]')",
  "case \"$lower\" in '\\\\wsl$\\'*|'\\\\wsl.localhost\\'*) ;; *) exit 45 ;; esac",
  "magic=$(od -An -tx1 -N2 \"$resolved\" 2>/dev/null | tr -d ' \\r\\n')",
  '[ "$magic" != 4d5a ]',
  `printf '${COMMAND_PATH_BEGIN_MARKER}\\n'`,
  "printf '%s\\n' \"$resolved\"",
  `printf '${COMMAND_PATH_END_MARKER}\\n'`
].join('\n')

export const TILDE_PATH_PROBE_SCRIPT = [
  'set -eu',
  'requested=$1',
  'case "$requested" in ~*) ;; *) exit 43 ;; esac',
  'remainder=${requested#\\~}',
  'case "$remainder" in',
  '  */*) user=${remainder%%/*}; suffix=/${remainder#*/} ;;',
  '  *) user=$remainder; suffix= ;;',
  'esac',
  '[ -n "$user" ] || exit 43',
  "home=$(awk -F: -v wanted=\"$user\" '$1 == wanted { print $6; exit }' /etc/passwd)",
  'case "$home" in /*) ;; *) exit 44 ;; esac',
  "printf '%s%s' \"$home\" \"$suffix\""
].join('\n')

export const WSL_SESSION_SCOPE_LAUNCH_SCRIPT = [
  'set -eu',
  'trusted_home=$1',
  'default_uid=$2',
  'unit=$3',
  'wrapper=$4',
  'shift 4',
  'case "$trusted_home" in /*) ;; *) exit 64 ;; esac',
  'case "$default_uid" in \'\'|*[!0-9]*) exit 64 ;; esac',
  'case "$unit" in cliloom-*.scope) ;; *) exit 64 ;; esac',
  '[ -n "$wrapper" ] || exit 64',
  '[ "$#" -ge 1 ] || exit 64',
  'wrapper_name=$1',
  'shift',
  'initial_path=$PATH',
  `PATH=${TRUSTED_LINUX_PATH}`,
  'HOME=$trusted_home',
  'XDG_RUNTIME_DIR=/run/user/$default_uid',
  'DBUS_SESSION_BUS_ADDRESS=unix:path=$XDG_RUNTIME_DIR/bus',
  'export PATH HOME XDG_RUNTIME_DIR DBUS_SESSION_BUS_ADDRESS',
  'systemd_run_expand_option=',
  "if systemd-run --help 2>/dev/null | grep -Fq -- '--expand-environment'; then",
  '  systemd_run_expand_option=--expand-environment=no',
  'fi',
  'exec systemd-run $systemd_run_expand_option --user --scope --quiet --collect --unit="$unit" /bin/sh -c "$wrapper" "$wrapper_name" "$initial_path" "$@"'
].join('\n')

export const WSL_SESSION_WRAPPER_SCRIPT = [
  'set -eu',
  'initial_path=$1',
  'session_id=$2',
  'login_shell=$3',
  'mode=$4',
  'command=${5-}',
  'session_dir=$6',
  'unit=$7',
  'shift 7',
  '[ -n "$initial_path" ] || exit 64',
  "case \"$session_id\" in *[!A-Za-z0-9_-]*|'') exit 64 ;; esac",
  'case "$session_dir" in /*/cliloom/sessions) ;; *) exit 64 ;; esac',
  'case "$unit" in cliloom-*.scope) ;; *) exit 64 ;; esac',
  'umask 077',
  'mkdir -p "$session_dir"',
  '[ -d "$session_dir" ] && [ ! -L "$session_dir" ]',
  'chmod 700 "$session_dir"',
  'marker=$session_dir/$session_id',
  'temporary=$marker.tmp.$$',
  '[ ! -e "$marker" ] && [ ! -L "$marker" ]',
  "trap 'rm -f \"$temporary\"' EXIT",
  // Parse proc fields inside a function so its positional parameters do not
  // replace the transport mappings still held in the wrapper's "$@".
  'read_process_identity() {',
  '  stat_line=$(cat /proc/$$/stat)',
  '  rest=${stat_line##*) }',
  '  set -- $rest',
  '  pgrp=${3}',
  '  sid=${4}',
  '  started=${20}',
  '}',
  'read_process_identity',
  "cgroup=$(awk -F: '$1 == \"0\" { print $3; exit }' /proc/$$/cgroup)",
  'case "$cgroup" in /*/"$unit") ;; *) exit 65 ;; esac',
  'cgroup_procs=/sys/fs/cgroup$cgroup/cgroup.procs',
  '[ -r "$cgroup_procs" ] || exit 65',
  "printf 'uuid=%s\\nleader=%s\\nstart=%s\\nsid=%s\\npgrp=%s\\nunit=%s\\ncgroup=%s\\n' \"$session_id\" \"$$\" \"$started\" \"$sid\" \"$pgrp\" \"$unit\" \"$cgroup\" > \"$temporary\"",
  'chmod 600 "$temporary"',
  'mv "$temporary" "$marker"',
  'trap - EXIT',
  '',
  // Keep collection in the wrapper shell. Command substitution would fork a
  // process into this same cgroup and make the collector observe itself.
  'collect_members() {',
  '  live=',
  '  [ -r "$cgroup_procs" ] || return 0',
  '  while IFS= read -r pid; do',
  '    case "$pid" in \'\'|*[!0-9]*) continue ;; esac',
  '    [ "$pid" != "$$" ] || continue',
  '    if [ -n "$live" ]; then live="$live $pid"; else live=$pid; fi',
  '  done < "$cgroup_procs"',
  '}',
  '',
  'cleanup_members() {',
  '  trap - TERM INT HUP',
  '  collect_members',
  '  [ -z "$live" ] || kill -TERM $live 2>/dev/null || true',
  '  attempts=0',
  '  while [ $attempts -lt 10 ]; do',
  '    collect_members',
  '    [ -n "$live" ] || break',
  '    sleep 0.1',
  '    attempts=$((attempts + 1))',
  '  done',
  '  collect_members',
  '  [ -z "$live" ] || kill -KILL $live 2>/dev/null || true',
  '  attempts=0',
  '  while [ $attempts -lt 10 ]; do',
  '    collect_members',
  '    [ -n "$live" ] || break',
  '    sleep 0.05',
  '    attempts=$((attempts + 1))',
  '  done',
  '  collect_members',
  '  if [ -n "$live" ]; then return 1; fi',
  '  rm -f "$marker"',
  '}',
  '',
  'run_user_shell() (',
  '  PATH=$initial_path',
  '  export PATH',
  '  while [ "$#" -gt 0 ]; do',
  '    [ "$#" -ge 2 ] || exit 64',
  '    target_name=$1',
  '    source_name=$2',
  '    shift 2',
  '    case "$target_name" in [A-Za-z_]*) ;; *) exit 64 ;; esac',
  '    case "$target_name" in *[!A-Za-z0-9_]*) exit 64 ;; esac',
  `    case "$source_name" in ${WSL_TRANSPORT_ENV_PREFIX}[0-9]*) ;; *) exit 64 ;; esac`,
  '    case "$source_name" in *[!A-Za-z0-9_]*) exit 64 ;; esac',
  '    eval "transport_present=\\${$source_name+x}"',
  '    [ "$transport_present" = x ] || exit 66',
  '    eval "transport_value=\\${$source_name-}"',
  '    unset "$source_name"',
  '    export "$target_name=$transport_value"',
  '  done',
  '  case "$mode" in',
  '    interactive) "$login_shell" -il ;;',
  '    assistant) "$login_shell" -ilc "$command" ;;',
  '    command) "$login_shell" -lc "$command" ;;',
  '    *) exit 64 ;;',
  '  esac',
  ')',
  '',
  "trap 'cleanup_members || true; exit 143' TERM HUP",
  "trap 'cleanup_members || true; exit 130' INT",
  'status=0',
  'run_user_shell "$@" || status=$?',
  'if ! cleanup_members; then exit 125; fi',
  'exit "$status"'
].join('\n')

export const WSL_SESSION_TERMINATE_SCRIPT = [
  'set -eu',
  'session_id=$1',
  'session_dir=$2',
  'expected_unit=$3',
  "case \"$session_id\" in *[!A-Za-z0-9_-]*|'') exit 64 ;; esac",
  'case "$session_dir" in /*/cliloom/sessions) ;; *) exit 64 ;; esac',
  'case "$expected_unit" in cliloom-*.scope) ;; *) exit 64 ;; esac',
  `PATH=${TRUSTED_LINUX_PATH}`,
  'export PATH',
  'marker=$session_dir/$session_id',
  '[ -f "$marker" ] && [ ! -L "$marker" ] || exit 44',
  'uuid=',
  'leader=',
  'start=',
  'unit=',
  'cgroup=',
  "while IFS='=' read -r key value; do",
  '  case "$key" in',
  '    uuid) uuid=$value ;;',
  '    leader) leader=$value ;;',
  '    start) start=$value ;;',
  '    unit) unit=$value ;;',
  '    cgroup) cgroup=$value ;;',
  '  esac',
  'done < "$marker"',
  '[ "$uuid" = "$session_id" ]',
  '[ "$unit" = "$expected_unit" ]',
  "case \"$leader\" in ''|*[!0-9]*) exit 45 ;; esac",
  "case \"$start\" in ''|*[!0-9]*) exit 45 ;; esac",
  'case "$cgroup" in /*/"$unit") ;; *) exit 45 ;; esac',
  'cgroup_procs=/sys/fs/cgroup$cgroup/cgroup.procs',
  'leader_identity=0',
  'leader_valid=0',
  'if [ -r "/proc/$leader/stat" ]; then',
  '  line=$(cat "/proc/$leader/stat" 2>/dev/null || true)',
  '  tail=${line##*) }',
  '  set -- $tail',
  "  leader_cgroup=$(awk -F: '$1 == \"0\" { print $3; exit }' \"/proc/$leader/cgroup\" 2>/dev/null || true)",
  '  if [ "${20-}" = "$start" ]; then',
  '    leader_identity=1',
  '    [ "$leader_cgroup" = "$cgroup" ] && leader_valid=1',
  '  fi',
  'fi',
  '[ "$leader_identity" = 0 ] || [ "$leader_valid" = 1 ] || exit 46',
  '',
  'members() {',
  '  [ -r "$cgroup_procs" ] || return 0',
  '  while IFS= read -r pid; do',
  '    case "$pid" in \'\'|*[!0-9]*) exit 45 ;; esac',
  "    printf '%s\\n' \"$pid\"",
  '  done < "$cgroup_procs"',
  '}',
  '',
  'if [ ! -r "$cgroup_procs" ]; then',
  '  [ "$leader_valid" = 0 ] || exit 46',
  '  rm -f "$marker"',
  '  exit 0',
  'fi',
  'live=$(members)',
  '[ -z "$live" ] || kill -TERM $live 2>/dev/null || true',
  'attempts=0',
  'while [ $attempts -lt 10 ]; do',
  '  live=$(members)',
  '  [ -n "$live" ] || break',
  '  sleep 0.1',
  '  attempts=$((attempts + 1))',
  'done',
  'live=$(members)',
  '[ -z "$live" ] || kill -KILL $live 2>/dev/null || true',
  'attempts=0',
  'while [ $attempts -lt 10 ]; do',
  '  live=$(members)',
  '  [ -n "$live" ] || break',
  '  sleep 0.05',
  '  attempts=$((attempts + 1))',
  'done',
  'live=$(members)',
  '[ -z "$live" ] || exit 47',
  'rm -f "$marker"'
].join('\n')

export const WSL_STALE_SESSION_LIST_SCRIPT = [
  'set -eu',
  'session_dir=$1',
  'case "$session_dir" in /*/cliloom/sessions) ;; *) exit 64 ;; esac',
  `PATH=${TRUSTED_LINUX_PATH}`,
  'export PATH',
  '[ -e "$session_dir" ] || exit 0',
  '[ -d "$session_dir" ] && [ ! -L "$session_dir" ] || exit 45',
  'for marker in "$session_dir"/*; do',
  '  [ -e "$marker" ] || continue',
  '  [ -f "$marker" ] && [ ! -L "$marker" ] || exit 45',
  '  session_id=${marker##*/}',
  "  case \"$session_id\" in *[!A-Za-z0-9_-]*|'') exit 45 ;; esac",
  '  uuid=',
  '  leader=',
  '  start=',
  '  unit=',
  '  cgroup=',
  "  while IFS='=' read -r key value; do",
  '    case "$key" in',
  '      uuid) uuid=$value ;;',
  '      leader) leader=$value ;;',
  '      start) start=$value ;;',
  '      unit) unit=$value ;;',
  '      cgroup) cgroup=$value ;;',
  '    esac',
  '  done < "$marker"',
  '  [ "$uuid" = "$session_id" ] || exit 45',
  "  case \"$leader\" in ''|*[!0-9]*) exit 45 ;; esac",
  "  case \"$start\" in ''|*[!0-9]*) exit 45 ;; esac",
  '  [ "$unit" = "cliloom-$session_id.scope" ] || exit 45',
  '  case "$cgroup" in /*/"$unit") ;; *) exit 45 ;; esac',
  '  leader_identity=0',
  '  active=0',
  '  if [ -r "/proc/$leader/stat" ]; then',
  '    line=$(cat "/proc/$leader/stat" 2>/dev/null || true)',
  '    tail=${line##*) }',
  '    set -- $tail',
  "    leader_cgroup=$(awk -F: '$1 == \"0\" { print $3; exit }' \"/proc/$leader/cgroup\" 2>/dev/null || true)",
  '    if [ "${20-}" = "$start" ]; then',
  '      leader_identity=1',
  '      [ "$leader_cgroup" = "$cgroup" ] && active=1',
  '    fi',
  '  fi',
  '  [ "$leader_identity" = 0 ] || [ "$active" = 1 ] || exit 46',
  '  [ "$active" = 1 ] || printf \'%s\\n\' "$session_id"',
  'done'
].join('\n')

export function createWslSessionDirectory(homeDirectory: string): string {
  if (!homeDirectory.startsWith('/') || homeDirectory.includes('\0') || /[\r\n]/.test(homeDirectory)) {
    throw new WslUnavailableError(t('errors:wsl.pathInvalid'))
  }
  return `${homeDirectory === '/' ? '' : homeDirectory.replace(/\/+$/, '')}/.cache/cliloom/sessions`
}

export function createWslSessionUnitName(sessionId: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(sessionId)) {
    throw new WslUnavailableError(t('errors:wsl.invalidProbeInput'))
  }
  return `cliloom-${sessionId}.scope`
}

export class WslUnavailableError extends Error {
  readonly code = 'WSL_UNAVAILABLE'

  constructor(message: string) {
    super(message)
    this.name = 'WslUnavailableError'
  }
}

export class WslEnvironmentBlockTooLongError extends WslUnavailableError {}

export class WslService {
  private readonly environment: NodeJS.ProcessEnv
  private readonly platform: NodeJS.Platform
  private readonly architecture: string
  private readonly execute: WslCommandExecutor
  private readonly inspectLauncher: (filePath: string) => boolean
  private readonly wait: (milliseconds: number) => Promise<void>
  private readonly validationCache = new Map<string, ValidationCacheEntry>()
  private catalogGeneration = 0
  private catalogSignature: string | undefined

  constructor(options: {
    environment?: NodeJS.ProcessEnv
    platform?: NodeJS.Platform
    architecture?: string
    execute?: WslCommandExecutor
    inspectLauncher?: (filePath: string) => boolean
    wait?: (milliseconds: number) => Promise<void>
  } = {}) {
    this.environment = options.environment ?? process.env
    this.platform = options.platform ?? process.platform
    this.architecture = options.architecture ?? process.arch
    this.execute = options.execute ?? runBoundedProcess
    this.inspectLauncher = options.inspectLauncher ?? defaultInspectLauncher
    this.wait = options.wait ?? delay
  }

  get generation(): number {
    return this.catalogGeneration
  }

  getLauncherPath(): string {
    if (this.platform !== 'win32') throw new WslUnavailableError(t('errors:wsl.platformUnsupported'))
    const windowsRoot = getEnvironmentValue(this.environment, 'SystemRoot')
      ?? getEnvironmentValue(this.environment, 'WINDIR')
    if (!windowsRoot || windowsRoot.includes('\0') || !path.win32.isAbsolute(windowsRoot)) {
      throw new WslUnavailableError(t('errors:wsl.launcherMissing'))
    }
    const systemDirectory = this.architecture === 'ia32' ? 'Sysnative' : 'System32'
    const launcher = path.win32.join(windowsRoot, systemDirectory, 'wsl.exe')
    if (!this.inspectLauncher(launcher)) throw new WslUnavailableError(t('errors:wsl.launcherMissing'))
    return launcher
  }

  async discover(): Promise<WslDiscoveryResult> {
    if (this.platform !== 'win32') return { targets: [] }
    let launcher: string
    try {
      launcher = this.getLauncherPath()
    } catch (error) {
      return { targets: [], error: error instanceof Error ? error.message : String(error) }
    }

    try {
      const quiet = await this.executeChecked(launcher, ['--list', '--quiet'])
      const names = parseWslDistributionList(quiet.stdout)
      let verbose: ReturnType<typeof parseWslVerboseList> = new Map()
      try {
        const result = await this.executeChecked(launcher, ['--list', '--verbose'])
        verbose = parseWslVerboseList(result.stdout, names)
      } catch {
        // Version/default metadata is optional; the quiet catalog is authoritative.
      }
      const signature = names
        .map((name) => name.toLocaleLowerCase('en-US'))
        .sort()
        .join('\0')
      if (signature !== this.catalogSignature) {
        this.catalogSignature = signature
        this.catalogGeneration += 1
        this.validationCache.clear()
      }
      return {
        authoritative: true,
        targets: names.map((distributionName) => {
          const metadata = verbose.get(distributionName.toLocaleLowerCase('en-US'))
          return {
            kind: 'wsl',
            id: createWslTargetId(distributionName),
            displayName: distributionName,
            family: 'posix',
            distributionName,
            validationState: 'unvalidated',
            ...(metadata?.version ? { wslVersion: metadata.version } : {}),
            ...(metadata?.isDefault ? { isSystemDefault: true } : {})
          }
        }),
        ...(names.length === 0 ? { error: t('errors:wsl.noDistributions') } : {})
      }
    } catch (error) {
      return { targets: [], error: error instanceof Error ? error.message : String(error) }
    }
  }

  async resolveTarget(target: WslExecutionTargetDescriptor): Promise<ResolvedWslTarget> {
    const key = target.distributionName.toLocaleLowerCase('en-US')
    // Catalog lookup is intentionally performed before consulting the short-lived
    // capability cache so an unregistered distribution can never be relaunched
    // from stale settings.
    const discovery = await this.discover()
    const detected = discovery.targets.find((candidate) => (
      candidate.distributionName.toLocaleLowerCase('en-US') === key
    ))
    if (!detected) {
      throw new WslUnavailableError(
        discovery.error ?? t('errors:wsl.distributionMissing', { distribution: target.distributionName })
      )
    }
    const cached = this.validationCache.get(key)
    if (cached && cached.expiresAt > Date.now()) {
      return { ...cached.target, ...detected, validationState: 'ready' }
    }

    const launcher = this.getLauncherPath()
    const probeValue = randomUUID()
    const env = buildWslTransportEnvironment(this.environment, {
      [WSL_PROBE_ENV]: probeValue
    })
    let result: WslCommandResult
    try {
      result = await this.executeChecked(
        launcher,
        [
          '--distribution', detected.distributionName,
          '--cd', '/',
          '--exec', '/bin/sh', '-c', CAPABILITY_PROBE_SCRIPT
        ],
        env,
        8_000
      )
    } catch (error) {
      throw new WslUnavailableError(t('errors:wsl.capabilityUnavailable', {
        distribution: detected.distributionName,
        detail: error instanceof Error ? error.message : String(error)
      }))
    }
    const output = decodeWslOutput(result.stdout)
    const values = parseProbeOutput(output)
    if (values.distro.toLocaleLowerCase('en-US') !== key) {
      throw new WslUnavailableError(t('errors:wsl.distributionMismatch'))
    }
    if (values.uid === 0) throw new WslUnavailableError(t('errors:wsl.rootDefaultUser'))
    if (values.probe !== probeValue) throw new WslUnavailableError(t('errors:wsl.environmentTransport'))
    if (!isSupportedLoginShell(values.shell)) {
      throw new WslUnavailableError(t('errors:wsl.unsupportedLoginShell', { shell: values.shell }))
    }
    try {
      await this.executeChecked(
        launcher,
        [
          '--distribution', detected.distributionName,
          '--cd', values.home,
          '--exec', values.shell, '-lc', 'exit 0'
        ],
        this.environment,
        5_000
      )
    } catch {
      throw new WslUnavailableError(t('errors:wsl.unsupportedLoginShell', { shell: values.shell }))
    }

    let pathResult: WslCommandResult
    try {
      pathResult = await this.executeChecked(
        launcher,
        [
          '--distribution', detected.distributionName,
          '--cd', values.home,
          '--exec', values.shell, '-ilc', USER_SHELL_PATH_PROBE_SCRIPT
        ],
        this.environment,
        LOGIN_SHELL_PROBE_TIMEOUT_MS
      )
    } catch (error) {
      throw new WslUnavailableError(t('errors:wsl.loginPathUnavailable', {
        shell: values.shell,
        detail: error instanceof Error ? error.message : String(error)
      }))
    }
    let userShellPath: string
    try {
      userShellPath = parseUserShellPathOutput(pathResult.stdout)
    } catch (error) {
      throw new WslUnavailableError(t('errors:wsl.loginPathUnavailable', {
        shell: values.shell,
        detail: error instanceof Error ? error.message : String(error)
      }))
    }

    const resolved: ResolvedWslTarget = {
      ...detected,
      validationState: 'ready',
      wslExecutablePath: launcher,
      loginShellPath: values.shell,
      homeDirectory: values.home,
      defaultUid: values.uid,
      userShellPath
    }
    try {
      await this.cleanupStaleSessions(resolved)
    } catch (error) {
      throw new WslUnavailableError(t('errors:wsl.capabilityUnavailable', {
        distribution: detected.distributionName,
        detail: error instanceof Error ? error.message : String(error)
      }))
    }
    this.validationCache.set(key, {
      expiresAt: Date.now() + VALIDATION_CACHE_MS,
      target: resolved
    })
    return { ...resolved }
  }

  clearCache(): void {
    this.validationCache.clear()
  }

  async resolveTargetPath(target: ResolvedWslTarget, value: string): Promise<string> {
    validatePathValue(value)
    if (value === '~') return target.homeDirectory
    if (value.startsWith('~/')) return `${target.homeDirectory}${value.slice(1)}`
    if (value.startsWith('~')) {
      const result = await this.runInTarget(target, [
        '/bin/sh', '-c', TILDE_PATH_PROBE_SCRIPT, 'cliloom-tilde-path', value
      ])
      return parseSingleAbsoluteLinuxPath(result.stdout)
    }
    if (value.startsWith('/')) return value
    const unc = parseWslUncPath(value)
    if (unc && unc.distributionName.toLocaleLowerCase('en-US') !== target.distributionName.toLocaleLowerCase('en-US')) {
      throw new WslUnavailableError(t('errors:wsl.pathDistributionMismatch', {
        expected: target.distributionName,
        actual: unc.distributionName
      }))
    }
    if (!path.win32.isAbsolute(value)) throw new WslUnavailableError(t('errors:wsl.relativePath'))
    if (value.startsWith('\\\\') && !unc) throw new WslUnavailableError(t('errors:wsl.networkUncUnsupported'))
    const result = await this.runInTarget(target, ['wslpath', '-u', value])
    return parseSingleAbsoluteLinuxPath(result.stdout)
  }

  async toWindowsPath(target: ResolvedWslTarget, linuxPath: string): Promise<string> {
    validatePathValue(linuxPath)
    if (!linuxPath.startsWith('/')) throw new WslUnavailableError(t('errors:wsl.linuxPathAbsolute'))
    const result = await this.runInTarget(target, ['wslpath', '-w', linuxPath])
    return parseSinglePathOutput(result.stdout, false)
  }

  async canonicalizeWslProjectPath(target: ResolvedWslTarget, hostPath: string): Promise<{
    hostPath: string
    targetPath: string
    identityKey: string
  }> {
    const parsed = parseWslUncPath(hostPath)
    if (!parsed) throw new WslUnavailableError(t('errors:wsl.projectMustBeWslUnc'))
    if (parsed.distributionName.toLocaleLowerCase('en-US') !== target.distributionName.toLocaleLowerCase('en-US')) {
      throw new WslUnavailableError(t('errors:wsl.pathDistributionMismatch', {
        expected: target.distributionName,
        actual: parsed.distributionName
      }))
    }
    const targetPath = await this.resolveTargetPath(target, hostPath)
    const canonicalHostPath = await this.toWindowsPath(target, targetPath)
    const canonicalParsed = parseWslUncPath(canonicalHostPath)
    if (!canonicalParsed || canonicalParsed.distributionName.toLocaleLowerCase('en-US') !== target.distributionName.toLocaleLowerCase('en-US')) {
      throw new WslUnavailableError(t('errors:wsl.pathRoundTripFailed'))
    }
    return {
      hostPath: canonicalHostPath,
      targetPath,
      identityKey: `wsl:${target.distributionName.toLocaleLowerCase('en-US')}:${targetPath}`
    }
  }

  async getHomeWindowsPath(target: ResolvedWslTarget): Promise<string> {
    return this.toWindowsPath(target, target.homeDirectory)
  }

  async assertDirectory(target: ResolvedWslTarget, linuxPath: string): Promise<void> {
    validatePathValue(linuxPath)
    if (!linuxPath.startsWith('/')) throw new WslUnavailableError(t('errors:wsl.linuxPathAbsolute'))
    try {
      await this.runInTarget(target, [
        '/bin/sh', '-c', 'test -d "$1"', 'cliloom-directory-probe', linuxPath
      ])
    } catch {
      throw new WslUnavailableError(t('errors:database.projectPathNotDirectory'))
    }
  }

  async runInTarget(
    target: ResolvedWslTarget,
    command: string[],
    environment: NodeJS.ProcessEnv = this.environment,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    workingDirectory = '/'
  ): Promise<WslCommandResult> {
    const result = await this.executeInTarget(
      target,
      command,
      environment,
      timeoutMs,
      workingDirectory
    )
    if (result.exitCode !== 0 || result.timedOut) {
      throw new WslUnavailableError(boundedError(result, t('errors:wsl.commandFailed')))
    }
    return result
  }

  private async executeInTarget(
    target: ResolvedWslTarget,
    command: string[],
    environment: NodeJS.ProcessEnv,
    timeoutMs: number,
    workingDirectory: string
  ): Promise<WslCommandResult> {
    if (command.length === 0 || command.some((argument) => argument.includes('\0'))) {
      throw new WslUnavailableError(t('errors:wsl.invalidProbeInput'))
    }
    validatePathValue(workingDirectory)
    if (!workingDirectory.startsWith('/')) {
      throw new WslUnavailableError(t('errors:wsl.linuxPathAbsolute'))
    }
    return this.execute(
      target.wslExecutablePath,
      [
        '--distribution', target.distributionName,
        '--cd', workingDirectory,
        '--exec', ...command
      ],
      {
        env: environment,
        timeoutMs,
        maxOutputBytes: DEFAULT_OUTPUT_LIMIT
      }
    )
  }

  async resolveAssistantCommand(
    target: ResolvedWslTarget,
    command: unknown
  ): Promise<ResolvedAssistantCommand> {
    const parsed = parseAssistantCommand(command, 'posix')
    let probe: WslCommandResult
    try {
      probe = await this.executeInTarget(
        target,
        [target.loginShellPath, '-ilc', LINUX_COMMAND_PROBE_SCRIPT, 'cliloom-command-probe', parsed.executable],
        this.environment,
        LOGIN_SHELL_PROBE_TIMEOUT_MS,
        target.homeDirectory
      )
    } catch (error) {
      throw new WslUnavailableError(t('errors:wsl.assistantCommandProbeUnavailable', {
        distribution: target.distributionName,
        command: parsed.executable,
        detail: error instanceof Error ? error.message : String(error)
      }))
    }
    if ([43, 44, 45].includes(probe.exitCode ?? -1) && !probe.timedOut) {
      throw new WslUnavailableError(t('errors:wsl.assistantNotInstalled', {
        distribution: target.distributionName,
        command: parsed.executable
      }))
    }
    if (probe.exitCode !== 0 || probe.timedOut) {
      throw new WslUnavailableError(t('errors:wsl.assistantCommandProbeUnavailable', {
        distribution: target.distributionName,
        command: parsed.executable,
        detail: boundedError(probe, t('errors:wsl.commandFailed'))
      }))
    }
    const executablePath = parseCommandPathOutput(probe.stdout)
    let versionOutput: string | undefined
    try {
      const version = await this.runInTarget(
        target,
        [executablePath, '--version'],
        this.environment,
        1_500,
        target.homeDirectory
      )
      const output = `${decodeWslOutput(version.stdout)}${decodeWslOutput(version.stderr)}`.trim()
      if (output) versionOutput = output.slice(0, 1_000)
    } catch {
      // Version probing is informational.
    }
    return { ...parsed, executablePath, ...(versionOutput ? { versionOutput } : {}) }
  }

  async makeExecutable(target: ResolvedWslTarget, linuxPath: string): Promise<void> {
    await this.runInTarget(target, ['/bin/chmod', '700', linuxPath])
  }

  async validateAssistantInterop(
    target: ResolvedWslTarget,
    linuxLauncherPath: string,
    transferred: Record<string, string>
  ): Promise<void> {
    const environment = buildWslTransportEnvironment(this.environment, transferred)
    try {
      await this.runInTarget(target, [linuxLauncherPath, 'help'], environment, 8_000)
    } catch {
      throw new WslUnavailableError(t('errors:wsl.assistantInteropUnavailable', {
        distribution: target.distributionName
      }))
    }
  }

  async isDistributionRunning(distributionName: string): Promise<boolean> {
    const launcher = this.getLauncherPath()
    const result = await this.executeChecked(launcher, ['--list', '--running', '--quiet'])
    const key = distributionName.toLocaleLowerCase('en-US')
    return parseWslDistributionList(result.stdout).some((name) => name.toLocaleLowerCase('en-US') === key)
  }

  async terminateSession(handle: WslSessionHandle): Promise<ProcessTerminationResult> {
    return this.completeSession(handle, false)
  }

  async finalizeSession(handle: WslSessionHandle): Promise<ProcessTerminationResult> {
    return this.completeSession(handle, true)
  }

  private async completeSession(
    handle: WslSessionHandle,
    allowMissingMarker: boolean
  ): Promise<ProcessTerminationResult> {
    try {
      if (handle.unitName !== createWslSessionUnitName(handle.sessionId)) {
        throw new WslUnavailableError(t('errors:wsl.invalidProbeInput'))
      }
      if (!handle.sessionDirectory.startsWith('/') || !handle.sessionDirectory.endsWith('/cliloom/sessions')) {
        throw new WslUnavailableError(t('errors:wsl.pathInvalid'))
      }
      if (!await this.isDistributionRunning(handle.distributionName)) return { terminated: true }
      const launcher = this.getLauncherPath()
      let result: WslCommandResult | undefined
      for (let attempt = 0; attempt < 51; attempt += 1) {
        if (attempt > 0 && !await this.isDistributionRunning(handle.distributionName)) {
          return { terminated: true }
        }
        result = await this.execute(
          launcher,
          [
            '--distribution', handle.distributionName,
            '--cd', '/',
            '--exec', '/bin/sh', '-c', WSL_SESSION_TERMINATE_SCRIPT,
            'cliloom-session-terminate', handle.sessionId,
            handle.sessionDirectory, handle.unitName
          ],
          {
            env: this.environment,
            timeoutMs: 5_000,
            maxOutputBytes: DEFAULT_OUTPUT_LIMIT
          }
        )
        if (result.exitCode === 0) return { terminated: true }
        if (result.exitCode !== 44 || allowMissingMarker) break
        if (attempt < 50) await this.wait(100)
      }
      if (allowMissingMarker && result?.exitCode === 44) return { terminated: true }
      return {
        terminated: false,
        error: result
          ? boundedError(result, t('errors:wsl.sessionTerminationFailed'))
          : t('errors:wsl.sessionTerminationFailed')
      }
    } catch (error) {
      return {
        terminated: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  private async cleanupStaleSessions(target: ResolvedWslTarget): Promise<void> {
    const sessionDirectory = createWslSessionDirectory(target.homeDirectory)
    const result = await this.runInTarget(target, [
      '/bin/sh', '-c', WSL_STALE_SESSION_LIST_SCRIPT,
      'cliloom-stale-session-list', sessionDirectory
    ])
    const sessionIds = parseStaleSessionIds(result.stdout)
    for (const sessionId of sessionIds) {
      const termination = await this.completeSession({
        distributionName: target.distributionName,
        sessionId,
        sessionDirectory,
        unitName: createWslSessionUnitName(sessionId)
      }, true)
      if (!termination.terminated) {
        throw new WslUnavailableError(
          termination.error ?? t('errors:wsl.sessionTerminationFailed')
        )
      }
    }
  }

  private async executeChecked(
    executable: string,
    args: string[],
    environment: NodeJS.ProcessEnv = this.environment,
    timeoutMs = DEFAULT_TIMEOUT_MS
  ): Promise<WslCommandResult> {
    const result = await this.execute(executable, args, {
      env: environment,
      timeoutMs,
      maxOutputBytes: DEFAULT_OUTPUT_LIMIT
    })
    if (result.exitCode !== 0 || result.timedOut) {
      throw new WslUnavailableError(boundedError(result, t('errors:wsl.commandFailed')))
    }
    return result
  }
}

export function decodeWslOutput(value: Buffer): string {
  if (value.length === 0) return ''
  const hasUtf16Bom = value.length >= 2 && value[0] === 0xff && value[1] === 0xfe
  let zeroOdd = 0
  let sampledOdd = 0
  for (let index = 1; index < Math.min(value.length, 512); index += 2) {
    sampledOdd += 1
    if (value[index] === 0) zeroOdd += 1
  }
  const encoding = hasUtf16Bom || (sampledOdd > 2 && zeroOdd / sampledOdd > 0.4)
    ? 'utf16le'
    : 'utf8'
  return value.toString(encoding).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
}

export function parseWslDistributionList(value: Buffer): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const line of decodeWslOutput(value).split('\n')) {
    const name = line.trim()
    if (!name || name.includes('\0') || name.length > 256) continue
    const key = name.toLocaleLowerCase('en-US')
    if (seen.has(key)) continue
    seen.add(key)
    result.push(name)
  }
  return result
}

export function parseWslVerboseList(
  value: Buffer,
  distributionNames: string[]
): Map<string, { version?: 1 | 2; isDefault?: boolean }> {
  const result = new Map<string, { version?: 1 | 2; isDefault?: boolean }>()
  const lines = decodeWslOutput(value).split('\n')
  const longestNamesFirst = [...distributionNames].sort((left, right) => right.length - left.length)
  for (const line of lines) {
    const withoutMarker = line.replace(/^\s*\*?\s*/, '')
    const lowered = withoutMarker.toLocaleLowerCase('en-US')
    const distributionName = longestNamesFirst.find((name) => (
      lowered.startsWith(name.toLocaleLowerCase('en-US')) &&
      /^\s/.test(withoutMarker.slice(name.length))
    ))
    if (!distributionName) continue
    const key = distributionName.toLocaleLowerCase('en-US')
    if (result.has(key)) continue
    const versionMatch = line.match(/\s([12])\s*$/)
    result.set(key, {
      ...(versionMatch ? { version: Number(versionMatch[1]) as 1 | 2 } : {}),
      ...(line.trimStart().startsWith('*') ? { isDefault: true } : {})
    })
  }
  return result
}

export function parseWslUncPath(value: string): {
  distributionName: string
  relativePath: string
} | null {
  const match = value.match(/^\\\\(?:wsl\$|wsl\.localhost)\\([^\\]+)(?:\\(.*))?$/i)
  if (!match) return null
  return {
    distributionName: match[1],
    relativePath: match[2] ?? ''
  }
}

export function mergeWslEnvValue(
  current: string | undefined,
  names: string[],
  win32ToWslOnlyNames: string[] = []
): string {
  const requested = new Map<string, string>()
  for (const name of names) {
    validatePortableEnvironmentName(name)
    const key = name.toLocaleLowerCase('en-US')
    const prior = requested.get(key)
    if (prior && prior !== name) throw new WslUnavailableError(t('errors:wsl.environmentNameCollision'))
    requested.set(key, name)
  }
  const win32ToWslOnly = new Set(win32ToWslOnlyNames.map((name) => {
    validatePortableEnvironmentName(name)
    return name.toLocaleLowerCase('en-US')
  }))

  const unrelated = (current ?? '').split(':').filter(Boolean).filter((entry) => {
    const name = entry.split('/')[0]
    return !requested.has(name.toLocaleLowerCase('en-US'))
  })
  const requestedEntries = [...requested].map(([key, name]) => (
    win32ToWslOnly.has(key) ? `${name}/u` : name
  ))
  const merged = [...unrelated, ...requestedEntries].join(':')
  if (merged.length > 16_384) throw new WslUnavailableError(t('errors:wsl.wslenvTooLong'))
  return merged
}

export function buildWslTransportEnvironment(
  base: NodeJS.ProcessEnv,
  transferred: Record<string, string>
): Record<string, string> {
  const result: Record<string, string> = Object.fromEntries(
    Object.entries(base).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  )
  const names = Object.keys(transferred)
  const folded = new Map<string, string>()
  for (const name of names) {
    validatePortableEnvironmentName(name)
    if (name.toLocaleLowerCase('en-US') === 'wslenv') {
      throw new WslUnavailableError(t('errors:wsl.environmentReserved'))
    }
    const key = name.toLocaleLowerCase('en-US')
    const prior = folded.get(key)
    if (prior && prior !== name) throw new WslUnavailableError(t('errors:wsl.environmentNameCollision'))
    folded.set(key, name)
  }
  for (const [name, value] of Object.entries(transferred)) {
    if (value.includes('\0')) throw new WslUnavailableError(t('errors:wsl.environmentValueInvalid'))
    setEnvironmentValue(result, name, value)
  }
  const currentWslEnv = getEnvironmentValue(base, 'WSLENV')
  setEnvironmentValue(result, 'WSLENV', mergeWslEnvValue(currentWslEnv, names))
  const blockSize = Object.entries(result).reduce((total, [name, value]) => (
    total + name.length + (value?.length ?? 0) + 2
  ), 1)
  if (blockSize > 32_767) {
    throw new WslEnvironmentBlockTooLongError(t('errors:wsl.environmentBlockTooLong'))
  }
  return result
}

export function runBoundedProcess(
  executable: string,
  args: string[],
  options: {
    env: NodeJS.ProcessEnv
    timeoutMs: number
    maxOutputBytes: number
  }
): Promise<WslCommandResult> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(executable, args, {
        env: options.env,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch (error) {
      resolve({ exitCode: -1, stdout: Buffer.alloc(0), stderr: Buffer.from(String(error)) })
      return
    }
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let stdoutSize = 0
    let stderrSize = 0
    let exceeded = false
    let settled = false
    const append = (chunks: Buffer[], chunk: Buffer, stream: 'stdout' | 'stderr') => {
      if (exceeded) return
      if (stream === 'stdout') stdoutSize += chunk.length
      else stderrSize += chunk.length
      if (stdoutSize + stderrSize > options.maxOutputBytes) {
        exceeded = true
        try { child.kill() } catch { /* already exited */ }
        return
      }
      chunks.push(chunk)
    }
    child.stdout?.on('data', (chunk: Buffer) => append(stdout, Buffer.from(chunk), 'stdout'))
    child.stderr?.on('data', (chunk: Buffer) => append(stderr, Buffer.from(chunk), 'stderr'))
    const finish = (result: WslCommandResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    const timer = setTimeout(() => {
      try { child.kill() } catch { /* already exited */ }
      finish({
        exitCode: null,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
        timedOut: true
      })
    }, options.timeoutMs)
    child.once('error', (error) => finish({
      exitCode: -1,
      stdout: Buffer.concat(stdout),
      stderr: Buffer.concat([...stderr, Buffer.from(error.message)])
    }))
    child.once('close', (exitCode) => finish({
      exitCode: exceeded ? -1 : exitCode,
      stdout: Buffer.concat(stdout),
      stderr: exceeded
        ? Buffer.concat([...stderr, Buffer.from('\noutput limit exceeded')])
        : Buffer.concat(stderr)
    }))
  })
}

function defaultInspectLauncher(filePath: string): boolean {
  try {
    accessSync(filePath, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function parseProbeOutput(output: string): {
  distro: string
  uid: number
  home: string
  shell: string
  probe: string
} {
  const read = (marker: string): string => {
    const line = output.split('\n').find((item) => item.startsWith(marker))
    if (!line) throw new WslUnavailableError(t('errors:wsl.probeOutputInvalid'))
    return line.slice(marker.length)
  }
  const uid = Number(read('__CLILOOM_UID__'))
  const home = read('__CLILOOM_HOME__')
  const shell = read('__CLILOOM_SHELL__')
  if (!Number.isInteger(uid) || uid < 0 || !home.startsWith('/') || !shell.startsWith('/')) {
    throw new WslUnavailableError(t('errors:wsl.probeOutputInvalid'))
  }
  return {
    distro: read('__CLILOOM_DISTRO__'),
    uid,
    home,
    shell,
    probe: read('__CLILOOM_ENV__')
  }
}

function isSupportedLoginShell(shell: string): boolean {
  return ['bash', 'zsh', 'sh'].includes(path.posix.basename(shell))
}

function parseSingleAbsoluteLinuxPath(value: Buffer): string {
  const output = parseSinglePathOutput(value, true)
  if (!output.startsWith('/')) {
    throw new WslUnavailableError(t('errors:wsl.pathConversionFailed'))
  }
  return output
}

export function parseUserShellPathOutput(value: Buffer): string {
  const output = parseMarkedOutput(value, USER_PATH_BEGIN_MARKER, USER_PATH_END_MARKER)
  if (!output || output.length > 16_384) {
    throw new WslUnavailableError(t('errors:wsl.probeOutputInvalid'))
  }
  const seen = new Set<string>()
  const entries = output.split(':').filter((entry) => {
    if (seen.has(entry)) return false
    seen.add(entry)
    return true
  })
  const normalized = entries.join(':')
  if (!normalized) throw new WslUnavailableError(t('errors:wsl.probeOutputInvalid'))
  return normalized
}

export function parseCommandPathOutput(value: Buffer): string {
  const output = parseMarkedOutput(value, COMMAND_PATH_BEGIN_MARKER, COMMAND_PATH_END_MARKER)
  if (!output.startsWith('/')) {
    throw new WslUnavailableError(t('errors:wsl.pathConversionFailed'))
  }
  return output
}

export function parseMarkedOutput(value: Buffer, begin: string, end: string): string {
  const output = decodeWslOutput(value)
  const beginMarker = `${begin}\n`
  const endMarker = `\n${end}`
  const beginIndex = output.lastIndexOf(beginMarker)
  if (beginIndex < 0) throw new WslUnavailableError(t('errors:wsl.probeOutputInvalid'))
  const valueStart = beginIndex + beginMarker.length
  const endIndex = output.indexOf(endMarker, valueStart)
  if (endIndex < 0) throw new WslUnavailableError(t('errors:wsl.probeOutputInvalid'))
  const result = output.slice(valueStart, endIndex)
  if (!result || result.length > 16_384 || result.includes('\0') || /[\r\n]/.test(result)) {
    throw new WslUnavailableError(t('errors:wsl.probeOutputInvalid'))
  }
  return result
}

function parseSinglePathOutput(value: Buffer, requireLinuxAbsolute: boolean): string {
  let output = decodeWslOutput(value)
  if (output.endsWith('\n')) output = output.slice(0, -1)
  if (
    !output ||
    output.length > 16_384 ||
    output.includes('\0') ||
    /[\r\n]/.test(output) ||
    (requireLinuxAbsolute && !output.startsWith('/'))
  ) {
    throw new WslUnavailableError(t('errors:wsl.pathConversionFailed'))
  }
  return output
}

function validatePathValue(value: string): void {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > 16_384 ||
    value.includes('\0') ||
    /[\r\n]/.test(value)
  ) {
    throw new WslUnavailableError(t('errors:wsl.pathInvalid'))
  }
}

function validatePortableEnvironmentName(name: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new WslUnavailableError(t('errors:wsl.environmentNameInvalid', { name }))
  }
}

function parseStaleSessionIds(value: Buffer): string[] {
  const lines = decodeWslOutput(value).split('\n').filter(Boolean)
  if (lines.length > 128 || lines.some((line) => !/^[A-Za-z0-9_-]{1,128}$/.test(line))) {
    throw new WslUnavailableError(t('errors:wsl.sessionTerminationFailed'))
  }
  return [...new Set(lines)]
}

function getEnvironmentValue(environment: NodeJS.ProcessEnv, name: string): string | undefined {
  const match = Object.keys(environment).find((key) => key.toLocaleLowerCase('en-US') === name.toLocaleLowerCase('en-US'))
  return match ? environment[match] : undefined
}

function setEnvironmentValue(environment: NodeJS.ProcessEnv | Record<string, string>, name: string, value: string): void {
  const existing = Object.keys(environment).find((key) => key.toLocaleLowerCase('en-US') === name.toLocaleLowerCase('en-US'))
  if (existing && existing !== name) delete environment[existing]
  environment[name] = value
}

function quotePosixShellArgument(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function boundedError(result: WslCommandResult, fallback: string): string {
  if (result.timedOut) return t('errors:wsl.commandTimeout')
  const detail = `${decodeWslOutput(result.stderr)}${decodeWslOutput(result.stdout)}`.trim().slice(-2_000)
  return detail || `${fallback} (${String(result.exitCode)})`
}
