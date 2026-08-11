import Database from 'better-sqlite3'
import { spawn } from 'node-pty'
import { describe, expect, it } from 'vitest'

function runtimeMajor(name: string, version: string | undefined): number {
  if (version === undefined) {
    throw new Error(`${name} version is unavailable`)
  }
  const majorText = version.split('.')[0]
  if (!/^\d+$/.test(majorText)) {
    throw new Error(`${name} version "${version}" does not have a numeric major component`)
  }
  return Number.parseInt(majorText, 10)
}

describe('electron runtime baseline', () => {
  it('runs on Electron 43 with Node 24 and Chromium 150 majors', () => {
    expect(runtimeMajor('Electron', process.versions.electron)).toBe(43)
    expect(runtimeMajor('Node', process.versions.node)).toBe(24)
    expect(runtimeMajor('Chromium', process.versions.chrome)).toBe(150)
  })

  it('loads better-sqlite3 and executes an in-memory query', () => {
    const db = new Database(':memory:')
    try {
      const row = db.prepare('select 1 as value').get() as { value: number }
      expect(row).toEqual({ value: 1 })
    } finally {
      db.close()
    }
  })

  it('loads the node-pty native binding', () => {
    expect(typeof spawn).toBe('function')
  })

  it('rejects an undefined version with a component-named error', () => {
    expect(() => runtimeMajor('TestComponent', undefined)).toThrow('TestComponent')
  })

  it('rejects a major component that is not a decimal integer', () => {
    expect(() => runtimeMajor('TestComponent', '43beta.0.0')).toThrow('TestComponent')
    expect(() => runtimeMajor('TestComponent', 'abc.1.2')).toThrow('TestComponent')
  })
})
