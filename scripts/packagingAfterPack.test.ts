import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

type AfterPackContext = {
  electronPlatformName: string
  arch: number
  appOutDir: string
  packager?: { appInfo?: { productFilename?: string } }
}

type LauncherBuildOptions = {
  architecture: 'x64' | 'arm64'
  outputPath: string
  intermediateDirectory: string
}

type AfterPackDependencies = {
  linuxAfterPack?: (context: AfterPackContext) => Promise<void>
  assertPeSubsystem?: (filePath: string, subsystem: number, label: string) => void
  buildWindowsConsoleLauncher?: (options: LauncherBuildOptions) => string
}

type PackagingAfterPackModule = {
  createAfterPack: (
    dependencies?: AfterPackDependencies
  ) => (context: AfterPackContext) => Promise<void>
}

const { createAfterPack } = require('./packaging-after-pack.cjs') as PackagingAfterPackModule
const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function createApplicationDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'cliloom-after-pack-'))
  temporaryDirectories.push(directory)
  writeFileSync(path.join(directory, 'CLILoom.exe'), 'desktop fixture')
  return directory
}

describe('packaging afterPack hook', () => {
  it.each([
    { arch: 1, architecture: 'x64' as const },
    { arch: 3, architecture: 'arm64' as const }
  ])('builds and verifies the Windows Console launcher for $architecture', async ({
    arch,
    architecture
  }) => {
    const appOutDir = createApplicationDirectory()
    const linuxAfterPack = vi.fn(async () => undefined)
    const assertPeSubsystem = vi.fn()
    const buildWindowsConsoleLauncher = vi.fn((options: LauncherBuildOptions) => {
      writeFileSync(options.outputPath, 'console fixture')
      return options.outputPath
    })
    const afterPack = createAfterPack({
      linuxAfterPack,
      assertPeSubsystem,
      buildWindowsConsoleLauncher
    })
    const context: AfterPackContext = {
      electronPlatformName: 'win32',
      arch,
      appOutDir,
      packager: { appInfo: { productFilename: 'CLILoom' } }
    }

    await afterPack(context)

    const desktopExecutable = path.join(appOutDir, 'CLILoom.exe')
    const consoleExecutable = path.join(appOutDir, 'cliloom-cli.exe')
    expect(linuxAfterPack).toHaveBeenCalledOnce()
    expect(linuxAfterPack).toHaveBeenCalledWith(context)
    expect(buildWindowsConsoleLauncher).toHaveBeenCalledOnce()
    expect(buildWindowsConsoleLauncher).toHaveBeenCalledWith({
      architecture,
      outputPath: consoleExecutable,
      intermediateDirectory: expect.stringMatching(
        new RegExp(`dist[\\\\/]native[\\\\/]obj[\\\\/]package-${architecture}$`)
      )
    })
    expect(existsSync(consoleExecutable)).toBe(true)
    expect(assertPeSubsystem.mock.calls).toEqual([
      [desktopExecutable, 2, 'CLILoom desktop executable'],
      [consoleExecutable, 3, 'cliloom-cli.exe'],
      [desktopExecutable, 2, 'CLILoom desktop executable']
    ])
  })

  it('runs only the existing platform hook outside Windows', async () => {
    const linuxAfterPack = vi.fn(async () => undefined)
    const assertPeSubsystem = vi.fn()
    const buildWindowsConsoleLauncher = vi.fn()
    const afterPack = createAfterPack({
      linuxAfterPack,
      assertPeSubsystem,
      buildWindowsConsoleLauncher
    })
    const context: AfterPackContext = {
      electronPlatformName: 'darwin',
      arch: 3,
      appOutDir: '/unused'
    }

    await afterPack(context)

    expect(linuxAfterPack).toHaveBeenCalledOnce()
    expect(linuxAfterPack).toHaveBeenCalledWith(context)
    expect(assertPeSubsystem).not.toHaveBeenCalled()
    expect(buildWindowsConsoleLauncher).not.toHaveBeenCalled()
  })
})
