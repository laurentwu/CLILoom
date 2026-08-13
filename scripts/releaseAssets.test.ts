import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

type ReleaseFilePlan = { assets: string[]; requiredSidecars: string[]; metadata: string }
type JobManifest = {
  version: string
  files: Array<{ name: string; sha256: string }>
}
type ManifestModule = {
  createJobManifest: (options: {
    platform: string
    arch: string
    releaseDir: string
    output: string
    version?: string
  }) => JobManifest
  expectedReleaseFiles: (platform: string, arch: string, version: string) => ReleaseFilePlan
}
type AssemblyModule = {
  assembleReleaseAssets: (options: {
    inputRoot: string
    outputDir: string
    tag: string
  }) => { version: string; channel: string; files: string[] }
  mergeMetadata: (
    inputs: Array<{
      metadata: Record<string, unknown>
      entries: Array<{ url: string; sha512: string }>
      job: { expected: { metadata: string } }
    }>,
    version: string
  ) => Record<string, unknown>
}
type YamlModule = {
  load: (source: string, options?: unknown) => Record<string, unknown>
}

const require = createRequire(import.meta.url)
const {
  createJobManifest,
  expectedReleaseFiles
} = require('./create-release-job-manifest.cjs') as ManifestModule
const {
  assembleReleaseAssets,
  mergeMetadata
} = require('./assemble-release-assets.cjs') as AssemblyModule
const yaml = require('js-yaml') as YamlModule
const temporaryDirectories: string[] = []
const JOBS = [
  ['mac', 'x64'],
  ['mac', 'arm64'],
  ['win', 'x64'],
  ['win', 'arm64'],
  ['linux', 'x64'],
  ['linux', 'arm64']
] as const

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function sha512(content: Buffer): string {
  return createHash('sha512').update(content).digest('base64')
}

function createFixture(version = '1.2.3') {
  const root = mkdtempSync(path.join(tmpdir(), 'cliloom-release-assets-'))
  temporaryDirectories.push(root)
  const inputRoot = path.join(root, 'input')
  const outputDir = path.join(root, 'output')
  mkdirSync(inputRoot)
  const directories = new Map<string, string>()

  for (const [platform, arch] of JOBS) {
    const directory = path.join(inputRoot, `CLILoom-${platform}-${arch}`)
    directories.set(`${platform}/${arch}`, directory)
    mkdirSync(directory)
    const expected = expectedReleaseFiles(platform, arch, version)
    const contents = new Map<string, Buffer>()
    for (const name of expected.assets) {
      const content = Buffer.from(`${platform}/${arch}/${name}\n`)
      contents.set(name, content)
      writeFileSync(path.join(directory, name), content)
    }
    for (const name of expected.requiredSidecars) {
      writeFileSync(path.join(directory, name), `${platform}/${arch}/${name}\n`)
    }
    const metadataAssetNames = platform === 'win'
      ? expected.assets.filter((name) => name.includes('-Setup-'))
      : expected.assets
    const files = metadataAssetNames.map((name) => ({
      url: name,
      sha512: sha512(contents.get(name)!),
      size: contents.get(name)!.length
    }))
    writeFileSync(path.join(directory, expected.metadata), JSON.stringify({
      version,
      files,
      path: files[0].url,
      sha512: files[0].sha512,
      releaseName: `CLILoom ${version}`,
      releaseNotes: 'Fixture release notes',
      releaseDate: arch === 'x64'
        ? '2026-08-12T01:00:00.000Z'
        : '2026-08-12T02:00:00.000Z'
    }))
    createJobManifest({
      platform,
      arch,
      releaseDir: directory,
      output: path.join(directory, 'job-manifest.json'),
      version
    })
  }
  return { directories, inputRoot, outputDir, root, version }
}

function readYaml(filePath: string): Record<string, unknown> {
  return yaml.load(readFileSync(filePath, 'utf8'))
}

function rewriteMetadata(
  fixture: ReturnType<typeof createFixture>,
  platform: string,
  arch: string,
  transform: (metadata: Record<string, unknown>) => void
) {
  const directory = fixture.directories.get(`${platform}/${arch}`)!
  const expected = expectedReleaseFiles(platform, arch, fixture.version)
  const filePath = path.join(directory, expected.metadata)
  const metadata = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>
  transform(metadata)
  writeFileSync(filePath, JSON.stringify(metadata))
  createJobManifest({
    platform,
    arch,
    releaseDir: directory,
    output: path.join(directory, 'job-manifest.json'),
    version: fixture.version
  })
}

describe('release asset manifests', () => {
  it('rejects unknown files before a packaging job can upload them', () => {
    const fixture = createFixture()
    const directory = fixture.directories.get('linux/x64')!
    writeFileSync(path.join(directory, 'unexpected.bin'), 'unknown')

    expect(() => createJobManifest({
      platform: 'linux',
      arch: 'x64',
      releaseDir: directory,
      output: path.join(directory, 'job-manifest.json'),
      version: fixture.version
    })).toThrow(/Unknown release files/)
  })

  it('rejects missing updater sidecars for NSIS and macOS ZIP packages', () => {
    const fixture = createFixture()
    for (const key of ['win/x64', 'mac/arm64']) {
      const [platform, arch] = key.split('/')
      const directory = fixture.directories.get(key)!
      const expected = expectedReleaseFiles(platform, arch, fixture.version)
      rmSync(path.join(directory, expected.requiredSidecars[0]))

      expect(() => createJobManifest({
        platform,
        arch,
        releaseDir: directory,
        output: path.join(directory, 'job-manifest.json'),
        version: fixture.version
      })).toThrow(/Missing release file/)
    }
  })
})

describe('release asset assembly', () => {
  it('merges both architectures, strips legacy fields, and writes complete checksums', () => {
    const fixture = createFixture()
    const result = assembleReleaseAssets({
      inputRoot: fixture.inputRoot,
      outputDir: fixture.outputDir,
      tag: `v${fixture.version}`
    })

    expect(result).toMatchObject({ version: fixture.version, channel: 'latest' })
    const windows = readYaml(path.join(fixture.outputDir, 'latest.yml'))
    const mac = readYaml(path.join(fixture.outputDir, 'latest-mac.yml'))
    const linuxX64 = readYaml(path.join(fixture.outputDir, 'latest-linux.yml'))
    const linuxArm64 = readYaml(path.join(fixture.outputDir, 'latest-linux-arm64.yml'))
    expect(windows).not.toHaveProperty('path')
    expect(windows).not.toHaveProperty('sha512')
    expect((windows.files as Array<{ url: string }>).map((entry) => entry.url))
      .toEqual(expect.arrayContaining([
        `CLILoom-Setup-${fixture.version}-Windows-x64.exe`,
        `CLILoom-Setup-${fixture.version}-Windows-arm64.exe`
      ]))
    expect((windows.files as unknown[])).toHaveLength(2)
    expect((mac.files as Array<{ url: string }>).map((entry) => entry.url))
      .toEqual(expect.arrayContaining([
        `CLILoom-${fixture.version}-macOS-x64.zip`,
        `CLILoom-${fixture.version}-macOS-arm64.zip`
      ]))
    expect((mac.files as unknown[])).toHaveLength(2)
    expect(linuxX64.files as unknown[]).toHaveLength(3)
    expect(linuxArm64.files as unknown[]).toHaveLength(3)
    expect(windows.releaseDate).toBe('2026-08-12T02:00:00.000Z')

    const releaseFiles = readdirSync(fixture.outputDir).filter((name) => name !== 'SHA256SUMS.txt')
    const checksumLines = readFileSync(path.join(fixture.outputDir, 'SHA256SUMS.txt'), 'utf8')
      .trim().split('\n')
    expect(checksumLines).toHaveLength(releaseFiles.length)
    for (const name of releaseFiles) {
      expect(checksumLines.some((line) => line.endsWith(`  ${name}`))).toBe(true)
    }
  })

  it('uses the matching prerelease channel for every platform', () => {
    const fixture = createFixture('2.0.0-beta.3')
    const result = assembleReleaseAssets({
      inputRoot: fixture.inputRoot,
      outputDir: fixture.outputDir,
      tag: 'v2.0.0-beta.3'
    })

    expect(result.channel).toBe('beta')
    expect(readdirSync(fixture.outputDir)).toEqual(expect.arrayContaining([
      'beta.yml',
      'beta-mac.yml',
      'beta-linux.yml',
      'beta-linux-arm64.yml'
    ]))
  })

  it('fails when an expected architecture or matching tag is missing', () => {
    const missing = createFixture()
    rmSync(missing.directories.get('mac/arm64')!, { recursive: true })
    expect(() => assembleReleaseAssets({
      inputRoot: missing.inputRoot,
      outputDir: missing.outputDir,
      tag: `v${missing.version}`
    })).toThrow(/Expected 6 job manifests/)

    const wrongTag = createFixture()
    expect(() => assembleReleaseAssets({
      inputRoot: wrongTag.inputRoot,
      outputDir: wrongTag.outputDir,
      tag: 'v9.9.9'
    })).toThrow(/must equal/)
  })

  it('fails on manifest hash tampering and dangling metadata references', () => {
    const tampered = createFixture()
    const windowsDirectory = tampered.directories.get('win/x64')!
    writeFileSync(
      path.join(windowsDirectory, `CLILoom-Setup-${tampered.version}-Windows-x64.exe`),
      'tampered'
    )
    expect(() => assembleReleaseAssets({
      inputRoot: tampered.inputRoot,
      outputDir: tampered.outputDir,
      tag: `v${tampered.version}`
    })).toThrow(/Size mismatch|SHA-256 mismatch/)

    const dangling = createFixture()
    rewriteMetadata(dangling, 'linux', 'x64', (metadata) => {
      const files = metadata.files as Array<Record<string, unknown>>
      files[0].url = 'missing.AppImage'
    })
    expect(() => assembleReleaseAssets({
      inputRoot: dangling.inputRoot,
      outputDir: dangling.outputDir,
      tag: `v${dangling.version}`
    })).toThrow(/unknown asset/)
  })

  it('uses each Linux package manager architecture spelling', () => {
    expect(expectedReleaseFiles('linux', 'x64', '1.2.3').assets).toEqual([
      'CLILoom-1.2.3-Linux-x86_64.AppImage',
      'CLILoom-1.2.3-Linux-amd64.deb',
      'CLILoom-1.2.3-Linux-x86_64.rpm'
    ])
    expect(expectedReleaseFiles('linux', 'arm64', '1.2.3').assets).toEqual([
      'CLILoom-1.2.3-Linux-arm64.AppImage',
      'CLILoom-1.2.3-Linux-arm64.deb',
      'CLILoom-1.2.3-Linux-aarch64.rpm'
    ])
  })

  it('rejects Portable executables in Windows updater metadata', () => {
    const fixture = createFixture()
    rewriteMetadata(fixture, 'win', 'x64', (metadata) => {
      const portableName = `CLILoom-Portable-${fixture.version}-Windows-x64.exe`
      const portableContent = readFileSync(path.join(fixture.directories.get('win/x64')!, portableName))
      ;(metadata.files as Array<Record<string, unknown>>).push({
        url: portableName,
        sha512: sha512(portableContent),
        size: portableContent.length
      })
    })

    expect(() => assembleReleaseAssets({
      inputRoot: fixture.inputRoot,
      outputDir: fixture.outputDir,
      tag: `v${fixture.version}`
    })).toThrow(/Portable executable must not appear/)
  })

  it('rejects duplicate URLs and conflicting shared publishing fields', () => {
    const baseMetadata = {
      version: '1.2.3',
      files: [],
      releaseName: 'CLILoom 1.2.3',
      releaseDate: '2026-08-12T00:00:00.000Z'
    }
    const entry = { url: 'same.exe', sha512: 'hash' }
    const job = { expected: { metadata: 'latest.yml' } }
    expect(() => mergeMetadata([
      { metadata: baseMetadata, entries: [entry], job },
      { metadata: baseMetadata, entries: [entry], job }
    ], '1.2.3')).toThrow(/Duplicate updater URL/)
    expect(() => mergeMetadata([
      { metadata: baseMetadata, entries: [], job },
      {
        metadata: { ...baseMetadata, releaseName: 'Different' },
        entries: [],
        job
      }
    ], '1.2.3')).toThrow(/Shared updater fields differ/)
  })
})
