const { statSync } = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const SETUID_SANDBOX_MODE = 0o4755

function getSandboxHelperPath(executablePath, platform = process.platform) {
  const pathApi = platform === 'win32' ? path.win32 : path.posix
  return pathApi.join(pathApi.dirname(executablePath), 'chrome-sandbox')
}

function isConfiguredSetuidSandbox(stat) {
  return stat.isFile() && stat.uid === 0 && (stat.mode & 0o7777) === SETUID_SANDBOX_MODE
}

function inspectLinuxSandbox(executablePath, options = {}) {
  const platform = options.platform ?? process.platform
  if (platform !== 'linux') return { supported: true, method: 'platform' }

  const helperPath = getSandboxHelperPath(executablePath, platform)
  const readStat = options.statSync ?? statSync
  try {
    if (isConfiguredSetuidSandbox(readStat(helperPath))) {
      return { supported: true, method: 'setuid', helperPath }
    }
  } catch {
    // A missing helper can still be supported by an available user namespace sandbox.
  }

  const run = options.spawnSync ?? spawnSync
  const userNamespaceProbe = run('unshare', ['-Ur', 'true'], { stdio: 'ignore' })
  if (!userNamespaceProbe.error && userNamespaceProbe.status === 0) {
    return { supported: true, method: 'userns', helperPath }
  }

  return { supported: false, method: 'unavailable', helperPath }
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function assertLinuxSandboxAvailable(executablePath, options) {
  const result = inspectLinuxSandbox(executablePath, options)
  if (result.supported) return result

  throw new Error([
    'The Linux Chromium sandbox is unavailable; CLILoom will not start without it.',
    'Configure Electron\'s SUID sandbox helper, then retry:',
    `  sudo chown root:root ${shellQuote(result.helperPath)}`,
    `  sudo chmod 4755 ${shellQuote(result.helperPath)}`,
    'Alternatively, run on a system where unprivileged user namespaces are permitted.'
  ].join('\n'))
}

module.exports = {
  SETUID_SANDBOX_MODE,
  assertLinuxSandboxAvailable,
  getSandboxHelperPath,
  inspectLinuxSandbox,
  isConfiguredSetuidSandbox
}
