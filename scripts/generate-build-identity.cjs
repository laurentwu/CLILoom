'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const PROJECT_ROOT = path.resolve(__dirname, '..')
const BUILD_IDENTITY_VERSION = 1
const BUILD_IDENTITY_OUTPUT = path.join('dist', 'build-identity.json')
const BUILD_INPUTS = Object.freeze([
  'assistant.html',
  'build',
  'electron-builder.yml',
  'index.html',
  'LICENSE',
  'native',
  'package-lock.json',
  'package.json',
  'scripts',
  'src',
  'third_party',
  'THIRD_PARTY_NOTICES.md',
  'tsconfig.e2e.json',
  'tsconfig.json',
  'tsconfig.main.json',
  'vite.config.mts'
])

function collectBuildInputFiles(projectRoot, inputs = BUILD_INPUTS) {
  const files = []

  function visit(relativePath) {
    const absolutePath = path.join(projectRoot, relativePath)
    const stat = fs.lstatSync(absolutePath)
    if (stat.isSymbolicLink()) {
      throw new Error(`Build identity input must not be a symbolic link: ${relativePath}`)
    }
    if (stat.isFile()) {
      files.push(relativePath.split(path.sep).join('/'))
      return
    }
    if (!stat.isDirectory()) {
      throw new Error(`Unsupported build identity input: ${relativePath}`)
    }
    for (const entry of fs.readdirSync(absolutePath).sort(compareText)) {
      visit(path.join(relativePath, entry))
    }
  }

  for (const input of [...inputs].sort(compareText)) {
    visit(input)
  }
  return files
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function hashBuildInputs(projectRoot, inputs = BUILD_INPUTS) {
  const hash = crypto.createHash('sha256')
  hash.update('CLILoom build inputs\0v1\0')
  for (const relativePath of collectBuildInputFiles(projectRoot, inputs)) {
    const absolutePath = path.join(projectRoot, ...relativePath.split('/'))
    const content = fs.readFileSync(absolutePath)
    const mode = fs.statSync(absolutePath).mode & 0o777
    hash.update(`${Buffer.byteLength(relativePath)}:${relativePath}\0${mode.toString(8)}\0${content.length}:`)
    hash.update(content)
    hash.update('\0')
  }
  return hash.digest('hex')
}

function createBuildIdentity(projectRoot, inputs = BUILD_INPUTS) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'))
  if (typeof packageJson.version !== 'string' || !packageJson.version) {
    throw new Error('package.json must provide a non-empty version for the build identity')
  }
  return {
    version: BUILD_IDENTITY_VERSION,
    appVersion: packageJson.version,
    sourceHash: hashBuildInputs(projectRoot, inputs)
  }
}

function writeBuildIdentity(projectRoot = PROJECT_ROOT) {
  const identity = createBuildIdentity(projectRoot)
  const outputPath = path.join(projectRoot, BUILD_IDENTITY_OUTPUT)
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  const uniqueSuffix = `${process.pid}-${crypto.randomBytes(8).toString('hex')}`
  const temporaryPath = `${outputPath}.tmp-${uniqueSuffix}`
  fs.writeFileSync(temporaryPath, `${JSON.stringify(identity, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx'
  })
  try {
    fs.renameSync(temporaryPath, outputPath)
  } catch (error) {
    if (!error || !['EACCES', 'EEXIST', 'EPERM'].includes(error.code)) throw error
    const backupPath = `${outputPath}.old-${uniqueSuffix}`
    fs.renameSync(outputPath, backupPath)
    try {
      fs.renameSync(temporaryPath, outputPath)
      fs.rmSync(backupPath, { force: true })
    } catch (replacementError) {
      fs.renameSync(backupPath, outputPath)
      throw replacementError
    }
  } finally {
    fs.rmSync(temporaryPath, { force: true })
  }
  return { identity, outputPath }
}

module.exports = {
  BUILD_IDENTITY_OUTPUT,
  BUILD_IDENTITY_VERSION,
  BUILD_INPUTS,
  collectBuildInputFiles,
  createBuildIdentity,
  hashBuildInputs,
  writeBuildIdentity
}

if (require.main === module) {
  try {
    const { identity, outputPath } = writeBuildIdentity()
    process.stdout.write(`Generated ${path.relative(PROJECT_ROOT, outputPath)} (${identity.sourceHash})\n`)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
