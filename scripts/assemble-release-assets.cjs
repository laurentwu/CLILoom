#!/usr/bin/env node

const { createHash } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const yaml = require('js-yaml')
const {
  expectedReleaseFiles,
  getReleaseChannel
} = require('./create-release-job-manifest.cjs')

const EXPECTED_JOBS = [
  ['mac', 'x64'],
  ['mac', 'arm64'],
  ['win', 'x64'],
  ['win', 'arm64'],
  ['linux', 'x64'],
  ['linux', 'arm64']
]
const RESERVED_METADATA_KEYS = new Set(['version', 'files', 'path', 'sha512', 'releaseDate'])

function hashFile(filePath, algorithm) {
  return createHash(algorithm).update(fs.readFileSync(filePath)).digest(
    algorithm === 'sha512' ? 'base64' : 'hex'
  )
}

function findFiles(root, fileName) {
  const matches = []
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const candidate = path.join(root, entry.name)
    if (entry.isDirectory()) matches.push(...findFiles(candidate, fileName))
    else if (entry.isFile() && entry.name === fileName) matches.push(candidate)
  }
  return matches
}

function readManifest(manifestPath) {
  let manifest
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    throw new Error(`Invalid job manifest ${manifestPath}: ${error.message}`)
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error(`Invalid job manifest object: ${manifestPath}`)
  }
  if (manifest.schemaVersion !== 1) throw new Error(`Unsupported job manifest schema: ${manifestPath}`)
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error(`Job manifest has no files: ${manifestPath}`)
  }
  return { manifest, manifestPath, directory: path.dirname(manifestPath) }
}

function validateJob(job, version, channel) {
  const { manifest, manifestPath, directory } = job
  const expected = expectedReleaseFiles(manifest.platform, manifest.arch, version)
  if (manifest.version !== version) {
    throw new Error(`Version mismatch in ${manifestPath}: ${manifest.version} != ${version}`)
  }
  if (manifest.channel !== channel) {
    throw new Error(`Channel mismatch in ${manifestPath}: ${manifest.channel} != ${channel}`)
  }

  const requiredNames = new Set([
    ...expected.assets,
    ...expected.requiredSidecars,
    expected.metadata
  ])
  const allowedNames = new Set([
    ...requiredNames,
    ...expected.assets.map((name) => `${name}.blockmap`)
  ])
  const names = new Set()
  const files = new Map()
  for (const entry of manifest.files) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`Invalid file entry in ${manifestPath}`)
    }
    if (
      typeof entry.name !== 'string' ||
      path.basename(entry.name) !== entry.name ||
      !allowedNames.has(entry.name)
    ) {
      throw new Error(`Unknown release asset in ${manifestPath}: ${String(entry.name)}`)
    }
    if (names.has(entry.name)) throw new Error(`Duplicate asset in ${manifestPath}: ${entry.name}`)
    names.add(entry.name)
    if (!Number.isSafeInteger(entry.size) || entry.size < 0) {
      throw new Error(`Invalid size for ${entry.name} in ${manifestPath}`)
    }
    if (typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
      throw new Error(`Invalid SHA-256 for ${entry.name} in ${manifestPath}`)
    }
    const filePath = path.join(directory, entry.name)
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      throw new Error(`Manifest references a missing file: ${entry.name}`)
    }
    const stat = fs.statSync(filePath)
    if (stat.size !== entry.size) throw new Error(`Size mismatch for ${entry.name}`)
    if (hashFile(filePath, 'sha256') !== entry.sha256) {
      throw new Error(`SHA-256 mismatch for ${entry.name}`)
    }
    const expectedKind = entry.name === expected.metadata
      ? 'metadata'
      : entry.name.endsWith('.blockmap')
        ? 'sidecar'
        : 'asset'
    if (entry.kind !== expectedKind) throw new Error(`Invalid kind for ${entry.name}`)
    files.set(entry.name, { ...entry, filePath })
  }
  for (const required of requiredNames) {
    if (!names.has(required)) throw new Error(`Missing required asset in ${manifestPath}: ${required}`)
  }

  const actualFiles = fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
  const unknownFiles = actualFiles.filter((name) => name !== path.basename(manifestPath) && !names.has(name))
  if (unknownFiles.length > 0) {
    throw new Error(`Unlisted files beside ${manifestPath}: ${unknownFiles.join(', ')}`)
  }
  return { ...job, expected, files }
}

function readUpdateMetadata(filePath, version) {
  let metadata
  try {
    metadata = yaml.load(fs.readFileSync(filePath, 'utf8'), { schema: yaml.JSON_SCHEMA })
  } catch (error) {
    throw new Error(`Invalid updater metadata ${filePath}: ${error.message}`)
  }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new Error(`Updater metadata is not an object: ${filePath}`)
  }
  if (metadata.version !== version) {
    throw new Error(`Updater metadata version mismatch in ${filePath}`)
  }
  if (!Array.isArray(metadata.files) || metadata.files.length === 0) {
    throw new Error(`Updater metadata has no files: ${filePath}`)
  }
  if (
    typeof metadata.releaseDate !== 'string' ||
    !Number.isFinite(Date.parse(metadata.releaseDate))
  ) {
    throw new Error(`Updater metadata has an invalid releaseDate: ${filePath}`)
  }
  return metadata
}

function validateMetadataFileEntries(job, metadata) {
  const entries = []
  const urls = new Set()
  for (const entry of metadata.files) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`Invalid updater file entry in ${job.expected.metadata}`)
    }
    if (
      typeof entry.url !== 'string' ||
      path.basename(entry.url) !== entry.url ||
      !job.expected.assets.includes(entry.url)
    ) {
      throw new Error(`Updater metadata references an unknown asset: ${String(entry.url)}`)
    }
    if (urls.has(entry.url)) throw new Error(`Duplicate updater URL: ${entry.url}`)
    urls.add(entry.url)
    if (typeof entry.sha512 !== 'string' || entry.sha512 !== hashFile(job.files.get(entry.url).filePath, 'sha512')) {
      throw new Error(`SHA-512 mismatch for updater asset: ${entry.url}`)
    }
    if (entry.size !== undefined && entry.size !== job.files.get(entry.url).size) {
      throw new Error(`Updater size mismatch for asset: ${entry.url}`)
    }
    entries.push({ ...entry })
  }
  return entries
}

function selectUpdaterEntries(job, entries) {
  if (job.manifest.platform === 'win') {
    const portableName = job.expected.assets.find((name) => name.includes('-Portable-'))
    if (entries.some((entry) => entry.url === portableName)) {
      throw new Error(`Portable executable must not appear in updater metadata: ${portableName}`)
    }
    const setupName = job.expected.assets.find((name) => name.includes('-Setup-'))
    const selected = entries.filter((entry) => entry.url === setupName)
    if (selected.length !== 1 || entries.length !== 1) {
      throw new Error(`Windows updater metadata must reference exactly one NSIS installer for ${job.manifest.arch}`)
    }
    return selected
  }
  if (job.manifest.platform === 'mac') {
    const selected = entries.filter((entry) => entry.url.endsWith('.zip'))
    if (selected.length !== 1) {
      throw new Error(`macOS updater metadata must reference exactly one ZIP for ${job.manifest.arch}`)
    }
    return selected
  }
  const requiredExtensions = ['.AppImage', '.deb', '.rpm']
  for (const extension of requiredExtensions) {
    if (entries.filter((entry) => entry.url.endsWith(extension)).length !== 1) {
      throw new Error(`Linux updater metadata must reference one ${extension} for ${job.manifest.arch}`)
    }
  }
  if (entries.length !== requiredExtensions.length) {
    throw new Error(`Linux updater metadata contains unexpected files for ${job.manifest.arch}`)
  }
  return entries
}

function sharedMetadata(metadata) {
  return Object.fromEntries(Object.entries(metadata).filter(([key]) => !RESERVED_METADATA_KEYS.has(key)))
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(',')}}`
  }
  return JSON.stringify(value)
}

function mergeMetadata(inputs, version) {
  const firstShared = sharedMetadata(inputs[0].metadata)
  const firstCanonical = canonicalJson(firstShared)
  const files = []
  const urls = new Set()
  const releaseDates = []
  for (const input of inputs) {
    if (canonicalJson(sharedMetadata(input.metadata)) !== firstCanonical) {
      throw new Error(`Shared updater fields differ in ${input.job.expected.metadata}`)
    }
    releaseDates.push(input.metadata.releaseDate)
    for (const entry of input.entries) {
      if (urls.has(entry.url)) throw new Error(`Duplicate updater URL while merging: ${entry.url}`)
      urls.add(entry.url)
      files.push(entry)
    }
  }
  files.sort((left, right) => left.url.localeCompare(right.url))
  releaseDates.sort()
  return {
    version,
    files,
    ...firstShared,
    releaseDate: releaseDates.at(-1)
  }
}

function writeMetadata(outputDir, name, metadata) {
  const outputPath = path.join(outputDir, name)
  fs.writeFileSync(outputPath, yaml.dump(metadata, {
    lineWidth: 120,
    noRefs: true,
    sortKeys: false
  }), 'utf8')
  return outputPath
}

function assembleReleaseAssets(options) {
  const inputRoot = path.resolve(options.inputRoot)
  const outputDir = path.resolve(options.outputDir)
  const manifestPaths = findFiles(inputRoot, 'job-manifest.json')
  if (manifestPaths.length !== EXPECTED_JOBS.length) {
    throw new Error(`Expected ${EXPECTED_JOBS.length} job manifests, found ${manifestPaths.length}`)
  }
  const rawJobs = manifestPaths.map(readManifest)
  const versions = new Set(rawJobs.map((job) => job.manifest.version))
  if (versions.size !== 1) throw new Error('Release job manifests contain different versions')
  const version = [...versions][0]
  const expectedTag = `v${version}`
  if (options.tag !== expectedTag) throw new Error(`Tag ${options.tag} must equal ${expectedTag}`)
  const channel = getReleaseChannel(version)
  const jobs = rawJobs.map((job) => validateJob(job, version, channel))
  const jobsByKey = new Map()
  for (const job of jobs) {
    const key = `${job.manifest.platform}/${job.manifest.arch}`
    if (jobsByKey.has(key)) throw new Error(`Duplicate release job: ${key}`)
    jobsByKey.set(key, job)
  }
  for (const [platform, arch] of EXPECTED_JOBS) {
    if (!jobsByKey.has(`${platform}/${arch}`)) throw new Error(`Missing release job: ${platform}/${arch}`)
  }

  if (fs.existsSync(outputDir) && fs.readdirSync(outputDir).length > 0) {
    throw new Error(`Release output directory is not empty: ${outputDir}`)
  }
  fs.mkdirSync(outputDir, { recursive: true })
  const copiedNames = new Set()
  for (const job of jobs) {
    for (const [name, entry] of job.files) {
      if (name === job.expected.metadata) continue
      if (copiedNames.has(name)) throw new Error(`Release filename collision: ${name}`)
      copiedNames.add(name)
      fs.copyFileSync(entry.filePath, path.join(outputDir, name), fs.constants.COPYFILE_EXCL)
    }
  }

  const metadataInputs = jobs.map((job) => {
    const metadata = readUpdateMetadata(job.files.get(job.expected.metadata).filePath, version)
    const entries = selectUpdaterEntries(job, validateMetadataFileEntries(job, metadata))
    return { job, metadata, entries }
  })
  const forPlatform = (platform) => metadataInputs.filter((input) => input.job.manifest.platform === platform)
  writeMetadata(outputDir, `${channel}.yml`, mergeMetadata(forPlatform('win'), version))
  writeMetadata(outputDir, `${channel}-mac.yml`, mergeMetadata(forPlatform('mac'), version))
  for (const arch of ['x64', 'arm64']) {
    const input = metadataInputs.find((candidate) => (
      candidate.job.manifest.platform === 'linux' && candidate.job.manifest.arch === arch
    ))
    const name = arch === 'x64' ? `${channel}-linux.yml` : `${channel}-linux-arm64.yml`
    writeMetadata(outputDir, name, mergeMetadata([input], version))
  }

  for (const metadataName of [
    `${channel}.yml`,
    `${channel}-mac.yml`,
    `${channel}-linux.yml`,
    `${channel}-linux-arm64.yml`
  ]) {
    const metadata = readUpdateMetadata(path.join(outputDir, metadataName), version)
    for (const entry of metadata.files) {
      if (!fs.existsSync(path.join(outputDir, entry.url))) {
        throw new Error(`Merged metadata has a dangling reference: ${entry.url}`)
      }
      if (hashFile(path.join(outputDir, entry.url), 'sha512') !== entry.sha512) {
        throw new Error(`Merged metadata hash mismatch: ${entry.url}`)
      }
    }
  }

  const releaseFiles = fs.readdirSync(outputDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name !== 'SHA256SUMS.txt')
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right))
  const checksums = releaseFiles.map((name) => (
    `${hashFile(path.join(outputDir, name), 'sha256')}  ${name}`
  ))
  fs.writeFileSync(path.join(outputDir, 'SHA256SUMS.txt'), `${checksums.join('\n')}\n`, 'utf8')
  return { version, channel, files: [...releaseFiles, 'SHA256SUMS.txt'] }
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
  for (const required of ['input-root', 'output', 'tag']) {
    if (!values[required]) throw new Error(`Missing --${required}`)
  }
  return {
    inputRoot: values['input-root'],
    outputDir: values.output,
    tag: values.tag
  }
}

if (require.main === module) {
  try {
    const result = assembleReleaseAssets(parseArguments(process.argv.slice(2)))
    process.stdout.write(`Assembled ${result.files.length} release files for v${result.version}.\n`)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}

module.exports = {
  assembleReleaseAssets,
  hashFile,
  mergeMetadata
}
