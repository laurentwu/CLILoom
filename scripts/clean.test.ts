import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

type CleanupScope = 'build' | 'main' | 'all'

interface CleanModule {
  cleanGeneratedArtifacts: (scope: CleanupScope, projectRoot?: string) => void
  resolveCleanupTarget: (projectRoot: string, relativePath: string) => string
  parseCleanupScope: (argv: string[]) => CleanupScope
}

const {
  cleanGeneratedArtifacts,
  resolveCleanupTarget,
  parseCleanupScope
} = require('./clean.cjs') as CleanModule

const tempRoots: string[] = []

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop()!
    rmSync(root, { recursive: true, force: true })
  }
})

function createTempRoot(prefix = 'cliloom-clean-test-'): string {
  const root = mkdtempSync(path.join(tmpdir(), prefix))
  tempRoots.push(root)
  return root
}

function writeFile(root: string, relativePath: string, contents = ''): string {
  const fullPath = path.join(root, relativePath)
  mkdirSync(path.dirname(fullPath), { recursive: true })
  writeFileSync(fullPath, contents)
  return fullPath
}

function createDirectory(root: string, relativePath: string): string {
  const fullPath = path.join(root, relativePath)
  mkdirSync(fullPath, { recursive: true })
  return fullPath
}

describe('clean script - build scope', () => {
  it('removes dist, .vite and root build info while preserving sources and release', () => {
    const root = createTempRoot()
    writeFile(root, 'dist/main/old.js')
    writeFile(root, 'dist/renderer/old.js')
    writeFile(root, '.vite/cache', 'cache')
    writeFile(root, 'tsconfig.tsbuildinfo', 'info')
    writeFile(root, 'app.tsbuildinfo', 'app')
    const releaseKeep = writeFile(root, 'release/keep.txt')
    const srcKeep = writeFile(root, 'src/keep.ts')
    const sentinel = writeFile(root, 'sentinel.txt')

    cleanGeneratedArtifacts('build', root)

    expect(existsSync(path.join(root, 'dist'))).toBe(false)
    expect(existsSync(path.join(root, '.vite'))).toBe(false)
    expect(existsSync(path.join(root, 'tsconfig.tsbuildinfo'))).toBe(false)
    expect(existsSync(path.join(root, 'app.tsbuildinfo'))).toBe(false)
    expect(existsSync(releaseKeep)).toBe(true)
    expect(existsSync(srcKeep)).toBe(true)
    expect(existsSync(sentinel)).toBe(true)
  })
})

describe('clean script - main scope', () => {
  it('removes only dist/main and the main build info, preserving renderer and root build info', () => {
    const root = createTempRoot()
    const mainOld = writeFile(root, 'dist/main/old.js')
    const mainBuildInfo = writeFile(root, 'dist/tsconfig.main.tsbuildinfo', 'info')
    const rendererIndex = writeFile(root, 'dist/renderer/index.html', '<html></html>')
    const rootBuildInfo = writeFile(root, 'tsconfig.tsbuildinfo', 'root-info')

    cleanGeneratedArtifacts('main', root)

    expect(existsSync(mainOld)).toBe(false)
    expect(existsSync(path.join(root, 'dist/main'))).toBe(false)
    expect(existsSync(mainBuildInfo)).toBe(false)
    expect(existsSync(path.join(root, 'dist/renderer'))).toBe(true)
    expect(existsSync(rendererIndex)).toBe(true)
    expect(existsSync(rootBuildInfo)).toBe(true)
  })
})

describe('clean script - all scope', () => {
  it('removes all allowed artifacts but preserves node_modules, build, env and data', () => {
    const root = createTempRoot()
    writeFile(root, 'dist/main/old.js')
    writeFile(root, 'dist/renderer/old.js')
    writeFile(root, '.vite/cache', 'cache')
    writeFile(root, 'tsconfig.tsbuildinfo', 'info')
    writeFile(root, 'release/keep.txt')
    writeFile(root, 'out/keep.txt')
    writeFile(root, 'coverage/index.html')
    writeFile(root, 'playwright-report/index.html')
    writeFile(root, 'test-results/keep.txt')
    const nodeModulesKeep = writeFile(root, 'node_modules/keep.txt')
    const buildIconsKeep = writeFile(root, 'build/icons/keep.png', 'icon')
    const envKeep = writeFile(root, '.env', 'SECRET=value')
    const dataKeep = writeFile(root, 'data.db', 'database')

    cleanGeneratedArtifacts('all', root)

    expect(existsSync(path.join(root, 'dist'))).toBe(false)
    expect(existsSync(path.join(root, '.vite'))).toBe(false)
    expect(existsSync(path.join(root, 'release'))).toBe(false)
    expect(existsSync(path.join(root, 'out'))).toBe(false)
    expect(existsSync(path.join(root, 'coverage'))).toBe(false)
    expect(existsSync(path.join(root, 'playwright-report'))).toBe(false)
    expect(existsSync(path.join(root, 'test-results'))).toBe(false)
    expect(existsSync(path.join(root, 'tsconfig.tsbuildinfo'))).toBe(false)
    expect(existsSync(nodeModulesKeep)).toBe(true)
    expect(existsSync(buildIconsKeep)).toBe(true)
    expect(existsSync(envKeep)).toBe(true)
    expect(existsSync(dataKeep)).toBe(true)
  })
})

describe('clean script - unknown scope', () => {
  it('throws a recognizable error without deleting any target', () => {
    const root = createTempRoot()
    const target = writeFile(root, 'dist/main/old.js')
    const sentinel = writeFile(root, 'sentinel.txt')

    expect(() => cleanGeneratedArtifacts('unknown' as never, root)).toThrow()

    expect(existsSync(target)).toBe(true)
    expect(existsSync(sentinel)).toBe(true)
  })
})

describe('clean script - argument parsing', () => {
  it('rejects missing, unknown and extra arguments', () => {
    const root = createTempRoot()
    const target = writeFile(root, 'dist/main/old.js')
    const sentinel = writeFile(root, 'sentinel.txt')

    expect(() => parseCleanupScope([])).toThrow()
    expect(() => parseCleanupScope(['unknown'])).toThrow()
    expect(() => parseCleanupScope(['build', 'extra'])).toThrow()

    expect(existsSync(target)).toBe(true)
    expect(existsSync(sentinel)).toBe(true)
  })

  it('returns the matching scope for each valid single argument', () => {
    expect(parseCleanupScope(['build'])).toBe('build')
    expect(parseCleanupScope(['main'])).toBe('main')
    expect(parseCleanupScope(['all'])).toBe('all')
  })
})

describe('clean script - path boundary', () => {
  it('rejects the project root itself', () => {
    const root = createTempRoot()
    expect(() => resolveCleanupTarget(root, '.')).toThrow()
    expect(() => resolveCleanupTarget(root, '')).toThrow()
  })

  it('rejects a relative path that escapes the project root', () => {
    const root = createTempRoot()
    expect(() => resolveCleanupTarget(root, '..')).toThrow()
    expect(() => resolveCleanupTarget(root, '../outside')).toThrow()
  })

  it('accepts a nested path inside the project root', () => {
    const root = createTempRoot()
    const resolved = resolveCleanupTarget(root, 'dist/main')
    expect(resolved).toBe(path.resolve(root, 'dist/main'))
  })
})

describe('clean script - external symlink target', () => {
  it('removes only the link, never the external directory or its contents', () => {
    const root = createTempRoot()
    const externalDir = mkdtempSync(path.join(tmpdir(), 'cliloom-clean-external-'))
    tempRoots.push(externalDir)
    const externalSentinel = writeFile(externalDir, 'sentinel.txt', 'keep')

    const linkPath = path.join(root, 'release')
    let linkCreated = true
    try {
      symlinkSync(
        externalDir,
        linkPath,
        process.platform === 'win32' ? 'junction' : 'dir'
      )
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'EPERM' && code !== 'ENOSYS' && code !== 'EEXIST') {
        throw error
      }
      linkCreated = false
    }

    if (!linkCreated) {
      expect(existsSync(externalSentinel)).toBe(true)
      return
    }

    cleanGeneratedArtifacts('all', root)

    expect(existsSync(linkPath)).toBe(false)
    expect(existsSync(externalDir)).toBe(true)
    expect(existsSync(externalSentinel)).toBe(true)
  })
})

describe('clean script - root build info symlink', () => {
  it('removes only the root tsbuildinfo link, never the external target file', () => {
    const root = createTempRoot()
    const externalDir = mkdtempSync(path.join(tmpdir(), 'cliloom-clean-link-external-'))
    tempRoots.push(externalDir)
    const externalFile = writeFile(externalDir, 'real.tsbuildinfo', 'external')

    const linkPath = path.join(root, 'tsconfig.tsbuildinfo')
    let linkCreated = true
    try {
      symlinkSync(externalFile, linkPath, 'file')
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'EPERM' && code !== 'ENOSYS' && code !== 'EEXIST') {
        throw error
      }
      linkCreated = false
    }

    if (!linkCreated) {
      expect(existsSync(externalFile)).toBe(true)
      return
    }

    cleanGeneratedArtifacts('build', root)

    expect(existsSync(linkPath)).toBe(false)
    expect(existsSync(externalFile)).toBe(true)
  })
})

describe('clean script - non-existent targets', () => {
  it('succeeds and stays idempotent on an empty root for build scope', () => {
    const root = createTempRoot()
    expect(() => cleanGeneratedArtifacts('build', root)).not.toThrow()
    expect(() => cleanGeneratedArtifacts('build', root)).not.toThrow()
  })

  it('succeeds and stays idempotent on an empty root for main scope', () => {
    const root = createTempRoot()
    expect(() => cleanGeneratedArtifacts('main', root)).not.toThrow()
    expect(() => cleanGeneratedArtifacts('main', root)).not.toThrow()
  })

  it('succeeds and stays idempotent on an empty root for all scope', () => {
    const root = createTempRoot()
    expect(() => cleanGeneratedArtifacts('all', root)).not.toThrow()
    expect(() => cleanGeneratedArtifacts('all', root)).not.toThrow()
  })
})
