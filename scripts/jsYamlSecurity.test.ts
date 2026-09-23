import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

type YamlModule = {
  load: (source: string, options?: unknown) => unknown
  dump: (value: unknown) => string
}
type YamlPackageManifest = {
  version: string
  exports: Record<string, string | { import?: string; require?: string }>
}

const projectRequire = createRequire(import.meta.url)
const editorManifestPath = projectRequire.resolve('@mdxeditor/editor/package.json')
const editorRequire = createRequire(editorManifestPath)
const yamlManifestPath = editorRequire.resolve('js-yaml/package.json')
const yamlManifest = editorRequire(yamlManifestPath) as YamlPackageManifest
const yamlPackageDirectory = path.dirname(yamlManifestPath)
const rootExport = yamlManifest.exports['.']
const esmEntrySpecifier = typeof rootExport === 'string' ? rootExport : rootExport?.import
if (typeof esmEntrySpecifier !== 'string') {
  throw new Error('js-yaml resolved by @mdxeditor/editor has no ESM entry')
}
const esmEntryUrl = pathToFileURL(path.join(yamlPackageDirectory, esmEntrySpecifier)).href

const entries: Array<{ name: string; yaml: YamlModule }> = []

function emptySequenceItemLines(count: number): string {
  return Array.from({ length: count }, () => '  - {}').join('\n')
}

function mergeTargets(count: number, anchor: string): string {
  return Array.from(
    { length: count },
    (_, index) => `key${index}:\n  <<: *${anchor}`
  ).join('\n')
}

describe('js-yaml security regression for @mdxeditor/editor (GHSA-2883-xcg3-v3hh)', () => {
  beforeAll(async () => {
    entries.push({ name: 'CommonJS entry', yaml: editorRequire('js-yaml') as YamlModule })
    entries.push({ name: 'ESM entry', yaml: await import(esmEntryUrl) as YamlModule })
  })

  it('parses normal documents and round-trips safe values through dump', () => {
    expect(entries).toHaveLength(2)
    for (const { name, yaml } of entries) {
      const source = [
        'title: Terminal Snapshot',
        'enabled: true',
        'tags:',
        '  - alpha',
        '  - beta',
        'nested:',
        '  host: localhost',
        '  port: 8080'
      ].join('\n')
      const parsed = yaml.load(source) as Record<string, unknown>
      expect(parsed.title, name).toBe('Terminal Snapshot')
      expect(parsed.enabled, name).toBe(true)
      expect(parsed.tags, name).toEqual(['alpha', 'beta'])
      expect(parsed.nested, name).toEqual({ host: 'localhost', port: 8080 })
      const roundTripped = yaml.load(yaml.dump(parsed)) as Record<string, unknown>
      expect(roundTripped, name).toEqual(parsed)
    }
  })

  it('still supports anchor merges with explicit key overrides', () => {
    for (const { name, yaml } of entries) {
      const source = [
        'defaults: &defaults',
        '  retries: 3',
        '  timeout: 30',
        'service:',
        '  <<: *defaults',
        '  timeout: 60'
      ].join('\n')
      const parsed = yaml.load(source) as { service: Record<string, unknown> }
      expect(parsed.service, name).toEqual({ retries: 3, timeout: 60 })
    }
  })

  it('charges empty merge source mappings against maxTotalMergeKeys', () => {
    const source = [
      'arr: &arr [{}, {}, {}]',
      'one:',
      '  <<: *arr',
      'two:',
      '  <<: *arr'
    ].join('\n')
    for (const { name, yaml } of entries) {
      expect(
        () => yaml.load(source, { maxTotalMergeKeys: 5 }),
        `${name}: budget of 5 must reject six empty merge sources`
      ).toThrow(/maxTotalMergeKeys/)
      const parsed = yaml.load(source, { maxTotalMergeKeys: 6 }) as {
        arr: unknown[]
        one: unknown
        two: unknown
      }
      expect(parsed.arr, name).toHaveLength(3)
      expect(parsed.one, name).toEqual({})
      expect(parsed.two, name).toEqual({})
    }
  })

  it('enforces the default total merge budget across repeated empty merges', () => {
    const source = [
      'empty: &empty',
      emptySequenceItemLines(100),
      mergeTargets(101, 'empty')
    ].join('\n')
    for (const { name, yaml } of entries) {
      expect(
        () => yaml.load(source),
        `${name}: 101 merges of 100 empty mappings must exceed the default budget`
      ).toThrow(/maxTotalMergeKeys/)
    }
  })

  it('bounds single merge sequence length at 100 entries', () => {
    for (const { name, yaml } of entries) {
      const buildDocument = (count: number) => [
        'base: &base',
        emptySequenceItemLines(count),
        'merged:',
        '  <<: *base'
      ].join('\n')
      const parsed = yaml.load(buildDocument(100)) as { merged: unknown }
      expect(parsed.merged, name).toEqual({})
      expect(
        () => yaml.load(buildDocument(101)),
        `${name}: 101 merge sources in one sequence must be rejected`
      ).toThrow(/abnormal merge sequence size/)
    }
  })
})
