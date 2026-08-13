#!/usr/bin/env node

const { createHash } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const PLATFORMS = new Set(['mac', 'win', 'linux'])
const ARCHITECTURES = new Set(['x64', 'arm64'])
const IGNORED_BUILDER_FILES = new Set([
  'builder-debug.yml',
  'builder-effective-config.yaml'
])
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/

function getReleaseChannel(version) {
  const match = SEMVER_PATTERN.exec(version)
  if (!match) throw new Error(`Invalid release version: ${version}`)
  return match[4]?.split('.')[0] ?? 'latest'
}

function expectedReleaseFiles(platform, arch, version) {
  if (!PLATFORMS.has(platform)) throw new Error(`Unsupported release platform: ${platform}`)
  if (!ARCHITECTURES.has(arch)) throw new Error(`Unsupported release architecture: ${arch}`)
  if (platform === 'mac') {
    const zip = `CLILoom-${version}-macOS-${arch}.zip`
    return {
      assets: [
        `CLILoom-${version}-macOS-${arch}.dmg`,
        zip
      ],
      requiredSidecars: [`${zip}.blockmap`],
      metadata: 'latest-mac.yml'
    }
  }
  if (platform === 'win') {
    const setup = `CLILoom-Setup-${version}-Windows-${arch}.exe`
    return {
      assets: [
        setup,
        `CLILoom-Portable-${version}-Windows-${arch}.exe`
      ],
      requiredSidecars: [`${setup}.blockmap`],
      metadata: 'latest.yml'
    }
  }
  const linuxArch = arch === 'x64'
    ? { appImage: 'x86_64', deb: 'amd64', rpm: 'x86_64' }
    : { appImage: 'arm64', deb: 'arm64', rpm: 'aarch64' }
  return {
    assets: [
      `CLILoom-${version}-Linux-${linuxArch.appImage}.AppImage`,
      `CLILoom-${version}-Linux-${linuxArch.deb}.deb`,
      `CLILoom-${version}-Linux-${linuxArch.rpm}.rpm`
    ],
    requiredSidecars: [],
    metadata: arch === 'x64'
      ? 'latest-linux.yml'
      : 'latest-linux-arm64.yml'
  }
}

function sha256File(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function createJobManifest(options) {
  const releaseDir = path.resolve(options.releaseDir)
  const output = path.resolve(options.output)
  const version = options.version ?? require(path.resolve('package.json')).version
  const { assets, requiredSidecars, metadata } = expectedReleaseFiles(
    options.platform,
    options.arch,
    version
  )
  const entries = fs.readdirSync(releaseDir, { withFileTypes: true })
  const regularFiles = entries.filter((entry) => entry.isFile()).map((entry) => entry.name)
  const allowedSidecars = new Set(assets.map((name) => `${name}.blockmap`))
  const allowedFiles = new Set([...assets, metadata, ...allowedSidecars])
  const outputInsideRelease = path.dirname(output) === releaseDir ? path.basename(output) : null

  const unknownFiles = regularFiles.filter((name) => (
    name !== outputInsideRelease &&
    !allowedFiles.has(name) &&
    !IGNORED_BUILDER_FILES.has(name)
  ))
  if (unknownFiles.length > 0) {
    throw new Error(`Unknown release files for ${options.platform}/${options.arch}: ${unknownFiles.join(', ')}`)
  }

  for (const required of [...assets, ...requiredSidecars, metadata]) {
    if (!regularFiles.includes(required)) {
      throw new Error(`Missing release file for ${options.platform}/${options.arch}: ${required}`)
    }
  }

  const selectedFiles = regularFiles
    .filter((name) => allowedFiles.has(name))
    .sort((left, right) => left.localeCompare(right))
    .map((name) => {
      const filePath = path.join(releaseDir, name)
      const stat = fs.statSync(filePath)
      return {
        name,
        kind: name === metadata
          ? 'metadata'
          : name.endsWith('.blockmap')
            ? 'sidecar'
            : 'asset',
        size: stat.size,
        sha256: sha256File(filePath)
      }
    })

  const manifest = {
    schemaVersion: 1,
    platform: options.platform,
    arch: options.arch,
    version,
    channel: getReleaseChannel(version),
    files: selectedFiles
  }
  fs.mkdirSync(path.dirname(output), { recursive: true })
  fs.writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  return manifest
}

function parseArguments(argv) {
  const values = {}
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]
    const value = argv[index + 1]
    if (!name?.startsWith('--') || value === undefined) {
      throw new Error(`Invalid argument near ${name ?? '<end>'}`)
    }
    values[name.slice(2)] = value
  }
  for (const required of ['platform', 'arch', 'release-dir', 'output']) {
    if (!values[required]) throw new Error(`Missing --${required}`)
  }
  return {
    platform: values.platform,
    arch: values.arch,
    releaseDir: values['release-dir'],
    output: values.output
  }
}

if (require.main === module) {
  try {
    const manifest = createJobManifest(parseArguments(process.argv.slice(2)))
    process.stdout.write(
      `Created ${manifest.platform}/${manifest.arch} release manifest with ${manifest.files.length} files.\n`
    )
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}

module.exports = {
  createJobManifest,
  expectedReleaseFiles,
  getReleaseChannel
}
