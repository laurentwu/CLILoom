import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createApplicationBuildIdentity,
  loadApplicationBuildIdentity,
  parsePersistedBuildIdentity
} from './buildIdentity'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('application build identity', () => {
  it('derives deterministic build ids while binding them to platform and architecture', () => {
    const persisted = {
      version: 1,
      appVersion: '0.1.0',
      sourceHash: 'a'.repeat(64)
    }

    const first = createApplicationBuildIdentity(persisted, 'win32', 'x64')
    const repeated = createApplicationBuildIdentity(persisted, 'win32', 'x64')
    const arm = createApplicationBuildIdentity(persisted, 'win32', 'arm64')

    expect(first).toEqual(repeated)
    expect(first.buildId).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(arm.buildId).not.toBe(first.buildId)
  })

  it('loads a generated identity and rejects packaged version mismatches', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'cliloom-build-identity-'))
    temporaryDirectories.push(directory)
    const filePath = path.join(directory, 'build-identity.json')
    writeFileSync(filePath, JSON.stringify({
      version: 1,
      appVersion: '0.1.0',
      sourceHash: 'b'.repeat(64)
    }))

    expect(loadApplicationBuildIdentity({
      filePath,
      appVersion: '0.1.0',
      platform: 'win32',
      architecture: 'x64',
      required: true
    })).toMatchObject({
      version: 1,
      appVersion: '0.1.0',
      sourceHash: 'b'.repeat(64),
      platform: 'win32',
      architecture: 'x64'
    })
    expect(() => loadApplicationBuildIdentity({
      filePath,
      appVersion: '0.2.0',
      required: true
    })).toThrow('Build identity version mismatch')
  })

  it('requires a valid generated identity in packaged mode', () => {
    const missing = path.join(tmpdir(), `missing-build-identity-${process.pid}.json`)

    expect(() => loadApplicationBuildIdentity({
      filePath: missing,
      appVersion: '0.1.0',
      required: true
    })).toThrow('Packaged build identity is unavailable')
    expect(() => parsePersistedBuildIdentity('{"version":1,"sourceHash":"bad"}'))
      .toThrow('unsupported format')
  })

  it('uses a deterministic development identity when the generated file is missing or invalid', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'cliloom-build-identity-'))
    temporaryDirectories.push(directory)
    const missingPath = path.join(directory, 'missing.json')
    const invalidPath = path.join(directory, 'invalid.json')
    writeFileSync(invalidPath, '{not-json')

    const options = {
      appVersion: '0.1.0',
      platform: 'linux' as const,
      architecture: 'x64',
      required: false
    }
    const missing = loadApplicationBuildIdentity({ filePath: missingPath, ...options })
    const invalid = loadApplicationBuildIdentity({ filePath: invalidPath, ...options })

    expect(missing).toEqual(invalid)
    expect(missing).toMatchObject({
      version: 1,
      appVersion: '0.1.0',
      platform: 'linux',
      architecture: 'x64'
    })
    expect(missing.buildId).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it('rejects a generated identity for another app version in development mode', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'cliloom-build-identity-'))
    temporaryDirectories.push(directory)
    const filePath = path.join(directory, 'build-identity.json')
    writeFileSync(filePath, JSON.stringify({
      version: 1,
      appVersion: '0.1.0',
      sourceHash: 'c'.repeat(64)
    }))

    expect(() => loadApplicationBuildIdentity({
      filePath,
      appVersion: '0.2.0',
      required: false
    })).toThrow('Build identity version mismatch')
  })
})
