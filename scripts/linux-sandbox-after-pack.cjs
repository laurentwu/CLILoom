const { chmodSync, copyFileSync, statSync } = require('node:fs')
const path = require('node:path')
const { SETUID_SANDBOX_MODE } = require('./linux-sandbox.cjs')

const REGULAR_EXECUTABLE_MODE = 0o755

async function afterPack(context) {
  if (context.electronPlatformName !== 'linux') return

  const buildsAppImage = context.targets?.some((target) => target.name === 'appImage') ?? false
  const helperPath = path.join(context.appOutDir, 'chrome-sandbox')
  // AppImage mounts cannot honor SUID. Keep the helper non-SUID there so the
  // custom launcher can select user namespaces without triggering a helper error.
  const helperMode = buildsAppImage ? REGULAR_EXECUTABLE_MODE : SETUID_SANDBOX_MODE
  chmodSync(helperPath, helperMode)
  const helperStat = statSync(helperPath)
  if (!helperStat.isFile() || (helperStat.mode & 0o7777) !== helperMode) {
    throw new Error(
      `Failed to set the packaged Chromium sandbox helper to mode ${helperMode.toString(8)}: ` +
        helperPath
    )
  }

  if (!buildsAppImage) return

  // electron-builder's generated AppRun may add --no-sandbox when its userns probe is
  // inconclusive. Override it so Chromium either starts sandboxed or fails closed.
  const launcherPath = path.join(context.appOutDir, 'AppRun')
  copyFileSync(path.join(__dirname, 'appimage-AppRun.sh'), launcherPath)
  chmodSync(launcherPath, REGULAR_EXECUTABLE_MODE)
  const launcherStat = statSync(launcherPath)
  if (!launcherStat.isFile() || (launcherStat.mode & 0o7777) !== REGULAR_EXECUTABLE_MODE) {
    throw new Error(`Failed to install the fail-closed AppImage launcher: ${launcherPath}`)
  }
}

module.exports = afterPack
module.exports.afterPack = afterPack
