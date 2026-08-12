import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

type BuildIdentityGenerator = {
  collectBuildInputFiles: (root: string, inputs: string[]) => string[]
  createBuildIdentity: (
    root: string,
    inputs: string[]
  ) => { version: number; appVersion: string; sourceHash: string }
  hashBuildInputs: (root: string, inputs: string[]) => string
}

const generator = require('./generate-build-identity.cjs') as BuildIdentityGenerator
const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('build identity generator', () => {
  it('hashes sorted file paths and contents deterministically', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'cliloom-build-inputs-'))
    temporaryDirectories.push(root)
    mkdirSync(path.join(root, 'src'))
    writeFileSync(path.join(root, 'package.json'), '{"version":"0.1.0"}')
    writeFileSync(path.join(root, 'src', 'b.ts'), 'export const b = 2\n')
    writeFileSync(path.join(root, 'src', 'a.ts'), 'export const a = 1\n')
    const inputs = ['src', 'package.json']

    const files = generator.collectBuildInputFiles(root, inputs)
    const first = generator.createBuildIdentity(root, inputs)
    const repeated = generator.createBuildIdentity(root, [...inputs].reverse())

    expect(files).toEqual(['package.json', 'src/a.ts', 'src/b.ts'])
    expect(first).toEqual(repeated)
    expect(first).toMatchObject({ version: 1, appVersion: '0.1.0' })
    expect(first.sourceHash).toMatch(/^[0-9a-f]{64}$/)

    writeFileSync(path.join(root, 'src', 'a.ts'), 'export const a = 3\n')
    expect(generator.hashBuildInputs(root, inputs)).not.toBe(first.sourceHash)
    expect(readFileSync(path.join(root, 'src', 'b.ts'), 'utf8')).toContain('b = 2')
  })
})
