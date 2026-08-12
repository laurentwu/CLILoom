'use strict'

const path = require('node:path')
const linuxAfterPack = require('./linux-sandbox-after-pack.cjs')
const {
  WINDOWS_ASSISTANT_CLI_EXECUTABLE,
  WINDOWS_CONSOLE_SUBSYSTEM,
  WINDOWS_GUI_SUBSYSTEM,
  assertPeSubsystem,
  buildWindowsConsoleLauncher,
  normalizeWindowsArchitecture
} = require('./build-windows-console-launcher.cjs')

const defaultDependencies = {
  linuxAfterPack,
  assertPeSubsystem,
  buildWindowsConsoleLauncher,
  normalizeWindowsArchitecture
}

function createAfterPack(dependencyOverrides = {}) {
  const dependencies = { ...defaultDependencies, ...dependencyOverrides }
  return async function afterPack(context) {
    await dependencies.linuxAfterPack(context)
    if (context.electronPlatformName !== 'win32') return

    const architecture = dependencies.normalizeWindowsArchitecture(context.arch)
    const productFilename = context.packager?.appInfo?.productFilename
    if (!productFilename || path.basename(productFilename) !== productFilename) {
      throw new Error('electron-builder did not provide a safe Windows product filename')
    }
    const desktopExecutable = path.join(context.appOutDir, `${productFilename}.exe`)
    const consoleExecutable = path.join(context.appOutDir, WINDOWS_ASSISTANT_CLI_EXECUTABLE)
    dependencies.assertPeSubsystem(
      desktopExecutable,
      WINDOWS_GUI_SUBSYSTEM,
      'CLILoom desktop executable'
    )
    dependencies.buildWindowsConsoleLauncher({
      architecture,
      outputPath: consoleExecutable,
      intermediateDirectory: path.join(
        __dirname,
        '..',
        'dist',
        'native',
        'obj',
        `package-${architecture}`
      )
    })
    dependencies.assertPeSubsystem(
      consoleExecutable,
      WINDOWS_CONSOLE_SUBSYSTEM,
      WINDOWS_ASSISTANT_CLI_EXECUTABLE
    )
    dependencies.assertPeSubsystem(
      desktopExecutable,
      WINDOWS_GUI_SUBSYSTEM,
      'CLILoom desktop executable'
    )
  }
}

const afterPack = createAfterPack()

module.exports = afterPack
module.exports.afterPack = afterPack
module.exports.createAfterPack = createAfterPack
