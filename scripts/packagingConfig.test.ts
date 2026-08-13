import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  APP_ID,
  APP_NAME,
  APP_SLUG,
  APP_USER_DATA_DIRECTORY_NAME
} from '../src/shared/branding'

const ELECTRON_BUILDER_NSIS_UUID_NAMESPACE = '50e065bc-3134-11e6-9bab-38c9862bdaf3'
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/

function readProjectFile(relativePath: string): string {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
}

function readProjectBuffer(relativePath: string): Buffer {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url))
}

function getTopLevelSection(source: string, name: string): string {
  const lines = source.split(/\r?\n/)
  const start = lines.indexOf(`${name}:`)
  if (start === -1) throw new Error(`Missing ${name} section`)

  const end = lines.findIndex((line, index) => (
    index > start && line.trim() !== '' && !/^\s/.test(line)
  ))
  return lines.slice(start + 1, end === -1 ? undefined : end).join('\n')
}

function getYamlList(section: string, name: string): string[] {
  const lines = section.split(/\r?\n/)
  const start = lines.findIndex((line) => line.trim() === `${name}:`)
  if (start === -1) throw new Error(`Missing ${name} list`)

  const keyIndent = lines[start].search(/\S/)
  const values: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '') continue
    if (line.search(/\S/) <= keyIndent) break
    const item = line.trim().match(/^-\s+(.+)$/)
    if (item) values.push(item[1])
  }
  return values
}

function getYamlSequence(section: string): string[] {
  const values: string[] = []
  for (const line of section.split(/\r?\n/)) {
    const item = line.trim().match(/^-\s+(.+)$/)
    if (item) values.push(item[1])
  }
  return values
}

function getYamlScalar(source: string, name: string): string {
  const line = source.split(/\r?\n/).find((candidate) => candidate.trimStart().startsWith(`${name}:`))
  if (!line) throw new Error(`Missing ${name} value`)

  const value = line.trim().slice(name.length + 1).trim()
  if (!value) throw new Error(`Empty ${name} value`)
  return value
}

function uuidV5(name: string, namespace: string): string {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(namespace)) {
    throw new Error(`Invalid UUID namespace: ${namespace}`)
  }

  const namespaceBytes = Buffer.from(namespace.replaceAll('-', ''), 'hex')
  const hash = createHash('sha1').update(namespaceBytes).update(name).digest()
  hash[6] = (hash[6] & 0x0f) | 0x50
  hash[8] = (hash[8] & 0x3f) | 0x80
  const hex = hash.subarray(0, 16).toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

describe('packaging configuration', () => {
  it('pins the public application identity across runtime and packaging metadata', () => {
    const builderConfig = readProjectFile('electron-builder.yml')
    const filesConfig = getTopLevelSection(builderConfig, 'files')
    const nsisConfig = getTopLevelSection(builderConfig, 'nsis')
    const mainSource = readProjectFile('src/main/main.ts')
    const packageJson = JSON.parse(readProjectFile('package.json')) as {
      name: string
      productName: string
      version: string
      license: string
      homepage: string
      desktopName: string
      repository: { type: string; url: string }
      scripts: Record<string, string>
    }
    const packageLock = JSON.parse(readProjectFile('package-lock.json')) as {
      packages: Record<string, { version?: string; license?: string }>
    }
    const rootLockPackage = packageLock.packages['']

    expect(APP_ID).toBe('io.github.laurentwu.cliloom')
    expect(APP_NAME).toBe('CLILoom')
    expect(APP_SLUG).toBe('cliloom')
    expect(APP_USER_DATA_DIRECTORY_NAME).toBe('CLILoom')
    expect(getYamlScalar(builderConfig, 'appId')).toBe(APP_ID)
    expect(getYamlScalar(builderConfig, 'productName')).toBe(APP_NAME)
    expect(packageJson).toMatchObject({
      name: APP_SLUG,
      productName: APP_NAME,
      license: 'Apache-2.0',
      homepage: 'https://github.com/laurentwu/CLILoom',
      desktopName: `${APP_ID}.desktop`,
      repository: {
        type: 'git',
        url: 'https://github.com/laurentwu/CLILoom.git'
      }
    })
    expect(packageJson.version).toMatch(SEMVER_PATTERN)
    expect(rootLockPackage).toMatchObject({
      version: packageJson.version,
      license: packageJson.license
    })

    const generatedGuid = uuidV5(APP_ID, ELECTRON_BUILDER_NSIS_UUID_NAMESPACE)
    expect(generatedGuid).toBe('2af5650f-5c23-520c-b262-debedf73652c')
    expect(getYamlScalar(nsisConfig, 'guid')).toBe(generatedGuid)
    expect(getYamlSequence(filesConfig)).toContain('LICENSE')
    expect(getYamlSequence(filesConfig)).toContain('THIRD_PARTY_NOTICES.md')
    expect(getYamlSequence(filesConfig)).toContain("'!dist/native/**'")
    expect(readProjectFile('LICENSE')).toContain('Apache License\n                           Version 2.0, January 2004')
    const thirdPartyNotices = readProjectFile('THIRD_PARTY_NOTICES.md')
    expect(thirdPartyNotices).toContain('# Third-party notices')
    expect(thirdPartyNotices).toContain('@fontsource-variable/jetbrains-mono')
    expect(thirdPartyNotices).not.toContain('@fontsource-variable/noto-sans-sc')
    expect(thirdPartyNotices).toContain('electron@43.3.0')
    expect(packageJson.scripts['licenses:check'])
      .toBe('node scripts/generate-third-party-notices.cjs --check')
    expect(packageJson.scripts.prebuild).toContain('npm run licenses:check')
    expect(packageJson.scripts.prebuild)
      .toContain('node scripts/generate-build-identity.cjs')
    expect(packageJson.scripts['prebuild:main'])
      .toContain('node scripts/generate-build-identity.cjs')
    expect(readProjectFile('scripts/generate-build-identity.cjs'))
      .toContain("path.join('dist', 'build-identity.json')")
    expect(mainSource).toMatch(/app\.setAppUserModelId\(APP_ID\)/)
    expect(mainSource).toMatch(/app\.setPath\(\s*'userData',\s*path\.join\(\s*app\.getPath\('appData'\),\s*APP_USER_DATA_DIRECTORY_NAME\s*\)\s*\)/)
  })

  it('builds and uploads NSIS and portable Windows artifacts', () => {
    const builderConfig = readProjectFile('electron-builder.yml')
    const windowsConfig = getTopLevelSection(builderConfig, 'win')
    const workflow = readProjectFile('.github/workflows/package.yml')
    const packageJson = JSON.parse(readProjectFile('package.json')) as {
      scripts: Record<string, string>
    }
    const afterPack = readProjectFile('scripts/packaging-after-pack.cjs')

    expect(getYamlList(windowsConfig, 'target')).toEqual(['nsis', 'portable'])
    expect(builderConfig).toMatch(/^nsis:/m)
    expect(getYamlScalar(builderConfig, 'afterPack'))
      .toBe('./scripts/packaging-after-pack.cjs')
    expect(packageJson.scripts['build:main'])
      .toContain('node scripts/build-windows-console-launcher.cjs')
    expect(packageJson.scripts['test:windows-cli-smoke'])
      .toBe('npm run build:main && node scripts/windows-cli-smoke.cjs')
    expect(packageJson.scripts['test:wsl-smoke']).toBeUndefined()
    expect(afterPack).toContain('WINDOWS_CONSOLE_SUBSYSTEM')
    expect(afterPack).toContain('WINDOWS_GUI_SUBSYSTEM')
    expect(afterPack).toContain('buildWindowsConsoleLauncher')
    expect(workflow).toContain('npm run test:windows-cli-smoke -- --packaged')
    expect(workflow).toContain('release/*.exe')
  })

  it('uses Windows-compatible bitmap frames for the executable icon', () => {
    const icon = readProjectBuffer('build/icons/icon.ico')
    const expectedSizes = [16, 24, 32, 48, 64, 128, 256]

    expect(icon.readUInt16LE(0)).toBe(0)
    expect(icon.readUInt16LE(2)).toBe(1)
    expect(icon.readUInt16LE(4)).toBe(expectedSizes.length)

    for (const [index, expectedSize] of expectedSizes.entries()) {
      const directoryOffset = 6 + index * 16
      const width = icon.readUInt8(directoryOffset) || 256
      const height = icon.readUInt8(directoryOffset + 1) || 256
      const imageLength = icon.readUInt32LE(directoryOffset + 8)
      const imageOffset = icon.readUInt32LE(directoryOffset + 12)

      expect([width, height]).toEqual([expectedSize, expectedSize])
      expect(icon.readUInt16LE(directoryOffset + 4)).toBe(1)
      expect(icon.readUInt16LE(directoryOffset + 6)).toBe(32)
      expect(imageOffset + imageLength).toBeLessThanOrEqual(icon.length)
      expect(icon.readUInt32LE(imageOffset)).toBe(40)
      expect(icon.readInt32LE(imageOffset + 4)).toBe(expectedSize)
      expect(icon.readInt32LE(imageOffset + 8)).toBe(expectedSize * 2)
      expect(icon.readUInt16LE(imageOffset + 12)).toBe(1)
      expect(icon.readUInt16LE(imageOffset + 14)).toBe(32)
      expect(icon.readUInt32LE(imageOffset + 16)).toBe(0)
    }
  })

  it('uses a complete macOS icon set with correctly sized Retina frames', () => {
    const builderConfig = readProjectFile('electron-builder.yml')
    const macConfig = getTopLevelSection(builderConfig, 'mac')
    const packageJson = JSON.parse(readProjectFile('package.json')) as {
      devDependencies: Record<string, string>
    }
    const icon = readProjectBuffer('build/icons/icon.icns')
    const expectedChunks = [
      { type: 'ic04', size: 16, encoding: 'argb' },
      { type: 'ic05', size: 32, encoding: 'argb' },
      { type: 'ic07', size: 128, encoding: 'png' },
      { type: 'ic08', size: 256, encoding: 'png' },
      { type: 'ic09', size: 512, encoding: 'png' },
      { type: 'ic10', size: 1024, encoding: 'png' },
      { type: 'ic11', size: 32, encoding: 'png' },
      { type: 'ic12', size: 64, encoding: 'png' },
      { type: 'ic13', size: 256, encoding: 'png' },
      { type: 'ic14', size: 512, encoding: 'png' }
    ]

    expect(getYamlScalar(macConfig, 'icon')).toBe('icons/icon.icns')
    expect(packageJson.devDependencies['electron-builder']).toBe('^26.15.7')
    expect(icon.toString('ascii', 0, 4)).toBe('icns')
    expect(icon.readUInt32BE(4)).toBe(icon.length)

    let offset = 8
    for (const expected of expectedChunks) {
      const type = icon.toString('ascii', offset, offset + 4)
      const chunkLength = icon.readUInt32BE(offset + 4)
      const payloadOffset = offset + 8

      expect(type).toBe(expected.type)
      expect(chunkLength).toBeGreaterThan(8)
      expect(offset + chunkLength).toBeLessThanOrEqual(icon.length)
      if (expected.encoding === 'argb') {
        expect(icon.toString('ascii', payloadOffset, payloadOffset + 4)).toBe('ARGB')
      } else {
        expect(icon.subarray(payloadOffset, payloadOffset + 8))
          .toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
        expect(icon.toString('ascii', payloadOffset + 12, payloadOffset + 16)).toBe('IHDR')
        expect(icon.readUInt32BE(payloadOffset + 16)).toBe(expected.size)
        expect(icon.readUInt32BE(payloadOffset + 20)).toBe(expected.size)
      }
      offset += chunkLength
    }

    expect(offset).toBe(icon.length)
  })

  it('provides a valid RGBA PNG icon set for Linux packages', () => {
    const builderConfig = readProjectFile('electron-builder.yml')
    const linuxConfig = getTopLevelSection(builderConfig, 'linux')
    const expectedSizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024]

    expect(getYamlScalar(linuxConfig, 'icon')).toBe('icons')
    for (const expectedSize of expectedSizes) {
      const icon = readProjectBuffer(`build/icons/${expectedSize}x${expectedSize}.png`)

      expect(icon.subarray(0, 8))
        .toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      expect(icon.toString('ascii', 12, 16)).toBe('IHDR')
      expect(icon.readUInt32BE(16)).toBe(expectedSize)
      expect(icon.readUInt32BE(20)).toBe(expectedSize)
      expect(icon.readUInt8(24)).toBe(8)
      expect(icon.readUInt8(25)).toBe(6)
      expect(icon.readUInt8(28)).toBe(0)
    }
  })

  it('builds, tests, and uploads AppImage alongside sandboxed Linux system packages', () => {
    const builderConfig = readProjectFile('electron-builder.yml')
    const appImageConfig = getTopLevelSection(builderConfig, 'appImage')
    const linuxConfig = getTopLevelSection(builderConfig, 'linux')
    const debConfig = getTopLevelSection(builderConfig, 'deb')
    const rpmConfig = getTopLevelSection(builderConfig, 'rpm')
    const workflow = readProjectFile('.github/workflows/package.yml')
    const packageJson = JSON.parse(readProjectFile('package.json')) as {
      scripts: Record<string, string>
    }

    expect(getYamlList(linuxConfig, 'target')).toEqual(['AppImage', 'deb', 'rpm'])
    expect(getYamlScalar(builderConfig, 'appimage')).toBe('1.0.3')
    expect(getYamlScalar(appImageConfig, 'executableArgs')).toBe('[]')
    expect(packageJson.scripts['package:appimage'])
      .toBe('npm run build && electron-builder --linux AppImage --publish never')
    expect(getYamlList(debConfig, 'depends')).toContain('libasound2t64 | libasound2')
    expect(getYamlList(rpmConfig, 'depends')).toContain('alsa-lib')
    expect(getYamlScalar(debConfig, 'afterInstall'))
      .toBe('./scripts/linux-after-install.sh')
    expect(getYamlScalar(rpmConfig, 'afterInstall'))
      .toBe('./scripts/linux-after-install.sh')
    expect(getYamlScalar(builderConfig, 'afterPack'))
      .toBe('./scripts/packaging-after-pack.cjs')
    const packagingAfterPack = readProjectFile('scripts/packaging-after-pack.cjs')
    expect(packagingAfterPack).toContain("require('./linux-sandbox-after-pack.cjs')")
    const appImageLauncher = readProjectFile('scripts/appimage-AppRun.sh')
    expect(appImageLauncher)
      .toContain('exec "${APPDIR}/cliloom" --disable-setuid-sandbox "$@"')
    expect(appImageLauncher).not.toContain('--no-sandbox')
    const sandboxAfterPack = readProjectFile('scripts/linux-sandbox-after-pack.cjs')
    expect(sandboxAfterPack)
      .toContain('buildsAppImage ? REGULAR_EXECUTABLE_MODE : SETUID_SANDBOX_MODE')
    const afterInstall = readProjectFile('scripts/linux-after-install.sh')
    expect(afterInstall).toContain('chown root:root "$sandbox_helper"')
    expect(afterInstall).toContain('chmod 4755 "$sandbox_helper"')
    expect(afterInstall).not.toContain('unshare')
    expect(afterInstall).not.toContain('chmod 0755')
    expect(workflow).toContain('npm run test:linux-package -- "${appimages[0]}"')
    expect(workflow).toContain('kernel.apparmor_restrict_unprivileged_userns')
    expect(workflow).toContain('npm run test:linux-package -- /opt/CLILoom/cliloom')
    expect(workflow).toContain('release/*.AppImage')
  })

  it('configures manual application updates and fail-closed draft releases', () => {
    const builderConfig = readProjectFile('electron-builder.yml')
    const workflow = readProjectFile('.github/workflows/package.yml')
    const packageJson = JSON.parse(readProjectFile('package.json')) as {
      dependencies: Record<string, string>
      devDependencies: Record<string, string>
      scripts: Record<string, string>
    }
    const packageLock = JSON.parse(readProjectFile('package-lock.json')) as {
      packages: Record<string, {
        version?: string
        dependencies?: Record<string, string>
        devDependencies?: Record<string, string>
      }>
    }
    const preload = readProjectFile('src/main/preload.ts')
    const mainSource = readProjectFile('src/main/main.ts')
    const updateService = readProjectFile('src/main/updateService.ts')

    expect(packageJson.dependencies['electron-updater']).toBe('^6.8.9')
    expect(packageLock.packages[''].dependencies?.['electron-updater']).toBe('^6.8.9')
    expect(packageLock.packages['node_modules/electron-updater'].version).toBe('6.8.9')
    expect(packageJson.devDependencies['js-yaml']).toBe('^4.3.1')
    expect(getYamlScalar(builderConfig, 'electronUpdaterCompatibility')).toBe("'>=2.16'")
    expect(builderConfig).toMatch(/^publish:\n  - provider: github$/m)
    expect(getYamlScalar(builderConfig, 'owner')).toBe('laurentwu')
    expect(getYamlScalar(builderConfig, 'repo')).toBe('CLILoom')
    expect(getYamlScalar(builderConfig, 'releaseType')).toBe('draft')
    for (const command of ['package:mac', 'package:win', 'package:appimage', 'package:linux']) {
      expect(packageJson.scripts[command]).toContain('--publish never')
    }

    expect(preload).toContain("ipcRenderer.invoke('updates:check')")
    expect(preload).toContain("ipcRenderer.invoke('updates:install')")
    expect(preload).toContain("ipcRenderer.on('updates:state', listener)")
    expect(preload).toContain("ipcRenderer.removeListener('updates:state', listener)")
    for (const channel of ['get-state', 'check', 'open-release', 'install']) {
      expect(mainSource).toMatch(new RegExp(
        `ipcMain\\.handle\\('updates:${channel}', (?:async )?\\(event\\) => \\{\\s*assertMainSender\\(event\\)`
      ))
    }
    expect(mainSource).toContain('if (!updateService.beginInstall())')
    expect(updateService).toContain('if (!options.isPackaged)')
    expect(updateService).toContain("this.runtime.capability === 'unsupported'")
    expect(updateService).toContain('autoDownload: this.runtime.capability === \'installable\'')

    expect(workflow).toMatch(/^permissions:\n  contents: read$/m)
    expect(workflow.match(/contents: write/g)).toHaveLength(1)
    expect(workflow).toContain("if: startsWith(github.ref, 'refs/tags/')")
    expect(workflow).toContain('needs: [validate, shell-smoke, package]')
    expect(workflow).toContain('scripts/create-release-job-manifest.cjs')
    expect(workflow).toContain('scripts/assemble-release-assets.cjs')
    expect(workflow).toContain('gh api --paginate')
    expect(workflow).toContain('gh release create "$GITHUB_REF_NAME"')
    expect(workflow).toContain('--draft')
    expect(workflow).toContain('--verify-tag')
    expect(workflow).toContain('--generate-notes')
    expect(workflow).toContain('release-assets/*')
  })

  it('documents installer and portable release output', () => {
    const packagingGuide = readProjectFile('PACKAGING.md')

    expect(packagingGuide).toContain('| Windows | x64, ARM64 | NSIS installer, Portable EXE |')
    expect(packagingGuide).toContain('| Linux | x64, ARM64 | AppImage, DEB, RPM |')
    expect(packagingGuide).toMatch(/\bNSIS\b/)
  })
})
