'use strict'

const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const PROJECT_ROOT = path.resolve(__dirname, '..')
const PROJECT_FILE = path.join(PROJECT_ROOT, 'native', 'windows', 'cliloom-cli.vcxproj')
const WINDOWS_ASSISTANT_CLI_EXECUTABLE = 'cliloom-cli.exe'
const WINDOWS_GUI_SUBSYSTEM = 2
const WINDOWS_CONSOLE_SUBSYSTEM = 3
const PE32_MAGIC = 0x10b
const PE32_PLUS_MAGIC = 0x20b

function readPeSubsystemFromBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 64 || buffer.toString('ascii', 0, 2) !== 'MZ') {
    throw new Error('Executable does not contain a valid DOS header')
  }
  const peOffset = buffer.readUInt32LE(0x3c)
  const optionalHeaderOffset = peOffset + 24
  if (peOffset > buffer.length - 24 || buffer.toString('ascii', peOffset, peOffset + 4) !== 'PE\0\0') {
    throw new Error('Executable does not contain a valid PE signature')
  }
  const optionalHeaderSize = buffer.readUInt16LE(peOffset + 20)
  const subsystemOffset = optionalHeaderOffset + 68
  if (optionalHeaderSize < 70 || subsystemOffset > buffer.length - 2) {
    throw new Error('Executable contains a truncated PE optional header')
  }
  const magic = buffer.readUInt16LE(optionalHeaderOffset)
  if (magic !== PE32_MAGIC && magic !== PE32_PLUS_MAGIC) {
    throw new Error(`Executable uses an unsupported PE optional header: 0x${magic.toString(16)}`)
  }
  return buffer.readUInt16LE(subsystemOffset)
}

function readPeSubsystem(filePath) {
  return readPeSubsystemFromBuffer(fs.readFileSync(filePath))
}

function assertPeSubsystem(filePath, expectedSubsystem, label) {
  const actualSubsystem = readPeSubsystem(filePath)
  if (actualSubsystem !== expectedSubsystem) {
    throw new Error(
      `${label} must use PE subsystem ${expectedSubsystem}, found ${actualSubsystem}: ${filePath}`
    )
  }
}

function normalizeWindowsArchitecture(value) {
  if (value === 'x64' || value === 1) return 'x64'
  if (value === 'arm64' || value === 3) return 'arm64'
  throw new Error(`Unsupported Windows CLI architecture: ${String(value)}`)
}

function findMsBuild(environment = process.env) {
  const configured = environment.MSBUILD_EXE_PATH
  if (configured) {
    if (!fs.existsSync(configured) || !fs.statSync(configured).isFile()) {
      throw new Error(`MSBUILD_EXE_PATH is not a file: ${configured}`)
    }
    return configured
  }

  const whereResult = spawnSync('where.exe', ['MSBuild.exe'], {
    encoding: 'utf8',
    windowsHide: true
  })
  if (whereResult.status === 0) {
    const match = whereResult.stdout.split(/\r?\n/).find((candidate) => candidate && fs.existsSync(candidate))
    if (match) return match
  }

  const programFiles = environment['ProgramFiles(x86)'] ?? environment.ProgramFiles
  if (!programFiles) throw new Error('Unable to locate Program Files for Visual Studio')
  const vswherePath = path.join(
    programFiles,
    'Microsoft Visual Studio',
    'Installer',
    'vswhere.exe'
  )
  if (!fs.existsSync(vswherePath)) {
    throw new Error('Visual Studio 2022 C++ build tools are required to build cliloom-cli.exe')
  }
  const query = spawnSync(vswherePath, [
    '-latest',
    '-products', '*',
    '-requires', 'Microsoft.Component.MSBuild',
    '-property', 'installationPath'
  ], {
    encoding: 'utf8',
    windowsHide: true
  })
  const installationPath = query.status === 0 ? query.stdout.trim() : ''
  if (!installationPath) {
    throw new Error('Visual Studio 2022 MSBuild was not found')
  }
  const candidates = [
    path.join(installationPath, 'MSBuild', 'Current', 'Bin', 'amd64', 'MSBuild.exe'),
    path.join(installationPath, 'MSBuild', 'Current', 'Bin', 'MSBuild.exe')
  ]
  const match = candidates.find((candidate) => fs.existsSync(candidate))
  if (!match) throw new Error(`MSBuild.exe was not found under ${installationPath}`)
  return match
}

function buildWindowsConsoleLauncher(options = {}) {
  if (process.platform !== 'win32') {
    throw new Error('cliloom-cli.exe can only be built on Windows')
  }
  const architecture = normalizeWindowsArchitecture(options.architecture ?? process.arch)
  const platform = architecture === 'arm64' ? 'ARM64' : 'x64'
  const outputPath = path.resolve(
    options.outputPath ?? path.join(PROJECT_ROOT, 'dist', 'native', WINDOWS_ASSISTANT_CLI_EXECUTABLE)
  )
  if (path.extname(outputPath).toLowerCase() !== '.exe') {
    throw new Error(`Windows CLI output must be an .exe file: ${outputPath}`)
  }
  const outputDirectory = path.dirname(outputPath)
  const intermediateDirectory = path.resolve(
    options.intermediateDirectory ?? path.join(PROJECT_ROOT, 'dist', 'native', 'obj', architecture)
  )
  fs.mkdirSync(outputDirectory, { recursive: true })
  fs.mkdirSync(intermediateDirectory, { recursive: true })
  const msbuildPath = options.msbuildPath ?? findMsBuild(options.environment)
  const result = spawnSync(msbuildPath, [
    PROJECT_FILE,
    '/nologo',
    '/m',
    '/verbosity:minimal',
    '/p:Configuration=Release',
    `/p:Platform=${platform}`,
    `/p:OutDir=${outputDirectory}${path.sep}`,
    `/p:IntDir=${intermediateDirectory}${path.sep}`,
    `/p:TargetName=${path.basename(outputPath, '.exe')}`
  ], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    const detail = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
    throw new Error(`Failed to build ${WINDOWS_ASSISTANT_CLI_EXECUTABLE}: ${detail}`)
  }
  if (!fs.existsSync(outputPath) || !fs.statSync(outputPath).isFile()) {
    throw new Error(`MSBuild did not create ${outputPath}`)
  }
  assertPeSubsystem(outputPath, WINDOWS_CONSOLE_SUBSYSTEM, WINDOWS_ASSISTANT_CLI_EXECUTABLE)
  return outputPath
}

function parseArguments(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--arch' && argv[index + 1]) {
      options.architecture = argv[index + 1]
      index += 1
    } else if (argument === '--output' && argv[index + 1]) {
      options.outputPath = argv[index + 1]
      index += 1
    } else {
      throw new Error(`Usage: node scripts/build-windows-console-launcher.cjs [--arch x64|arm64] [--output path]`)
    }
  }
  return options
}

module.exports = {
  WINDOWS_ASSISTANT_CLI_EXECUTABLE,
  WINDOWS_GUI_SUBSYSTEM,
  WINDOWS_CONSOLE_SUBSYSTEM,
  assertPeSubsystem,
  buildWindowsConsoleLauncher,
  findMsBuild,
  normalizeWindowsArchitecture,
  readPeSubsystem,
  readPeSubsystemFromBuffer
}

if (require.main === module) {
  try {
    if (process.platform !== 'win32') {
      process.stdout.write(`SKIP: ${WINDOWS_ASSISTANT_CLI_EXECUTABLE} is built only on Windows.\n`)
    } else {
      const outputPath = buildWindowsConsoleLauncher(parseArguments(process.argv.slice(2)))
      process.stdout.write(`Built Windows Console launcher: ${outputPath}\n`)
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
