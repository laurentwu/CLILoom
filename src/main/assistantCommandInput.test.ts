import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MAX_IMPORT_BYTES } from '../shared/skin'
import { ensureAssistantWorkspace } from './assistantWorkspace'
import { initMainI18n } from './i18n'
import {
  AssistantCommandError,
  parseAssistantCommandJson,
  readAssistantCommandInput
} from './assistantCommandInput'

initMainI18n('en')

const temporaryDirectories: string[] = []
const buildIdentity = {
  appVersion: '0.1.0',
  buildId: `sha256:${'a'.repeat(64)}`
}

function canCreateFileSymbolicLinks(): boolean {
  const directory = mkdtempSync(path.join(tmpdir(), 'cliloom-symlink-probe-'))
  try {
    const target = path.join(directory, 'target')
    const link = path.join(directory, 'link')
    writeFileSync(target, 'probe')
    symlinkSync(target, link)
    return true
  } catch {
    return false
  } finally {
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
}

const supportsFileSymbolicLinks = canCreateFileSymbolicLinks()

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})

function createWorkspace() {
  const directory = mkdtempSync(path.join(tmpdir(), 'cliloom-assistant-input-'))
  temporaryDirectories.push(directory)
  return ensureAssistantWorkspace({
    userDataPath: directory,
    executablePath: process.execPath,
    ...buildIdentity
  })
}

describe('assistant command input arguments', () => {
  it('reads from stdin and from a workspace-relative file', () => {
    const workspace = createWorkspace()
    writeFileSync(path.join(workspace.rootPath, 'payload.json'), '{"ok":true}')

    expect(readAssistantCommandInput({
      args: ['--stdin'],
      stdin: '{"a":1}',
      workspaceRoot: workspace.rootPath
    })).toEqual({ content: '{"a":1}' })

    expect(readAssistantCommandInput({
      args: ['--file', 'payload.json'],
      stdin: undefined,
      workspaceRoot: workspace.rootPath
    }).content).toBe('{"ok":true}')
  })

  it('parses revisions only when allowed and requires exactly one source', () => {
    const workspace = createWorkspace()
    expect(readAssistantCommandInput({
      args: ['--stdin', '--expected-revision', '42'],
      stdin: 'null',
      workspaceRoot: workspace.rootPath,
      allowRevision: true
    })).toEqual({ content: 'null', expectedRevision: 42 })

    expect(() => readAssistantCommandInput({
      args: ['--expected-revision', '1'],
      stdin: undefined,
      workspaceRoot: workspace.rootPath
    })).toThrow(AssistantCommandError)
    expect(readAssistantCommandInput({
      args: ['--stdin'],
      stdin: undefined,
      workspaceRoot: workspace.rootPath
    }).content).toBe('')
    expect(() => readAssistantCommandInput({
      args: ['--stdin', '--stdin'],
      stdin: '{}',
      workspaceRoot: workspace.rootPath
    })).toThrow(AssistantCommandError)
    expect(() => readAssistantCommandInput({
      args: ['--file', 'a.json', '--file', 'b.json'],
      stdin: undefined,
      workspaceRoot: workspace.rootPath
    })).toThrow(AssistantCommandError)
    expect(() => readAssistantCommandInput({
      args: ['--stdin', '--file', 'a.json'],
      stdin: '{}',
      workspaceRoot: workspace.rootPath
    })).toThrow(AssistantCommandError)
    expect(() => readAssistantCommandInput({
      args: ['--stdin', '--unknown'],
      stdin: '{}',
      workspaceRoot: workspace.rootPath
    })).toThrow(AssistantCommandError)
    expect(() => readAssistantCommandInput({
      args: ['--stdin', '--expected-revision', '0'],
      stdin: '{}',
      workspaceRoot: workspace.rootPath,
      allowRevision: true
    })).toThrow(AssistantCommandError)
    expect(() => readAssistantCommandInput({
      args: ['--stdin', '--expected-revision', '1.5'],
      stdin: '{}',
      workspaceRoot: workspace.rootPath,
      allowRevision: true
    })).toThrow(AssistantCommandError)
  })

  it('keeps file access inside the workspace', () => {
    const workspace = createWorkspace()
    writeFileSync(path.join(workspace.rootPath, 'legitimate.json'), '{"inside":true}')
    expect(readAssistantCommandInput({
      args: ['--file', 'legitimate.json'],
      stdin: undefined,
      workspaceRoot: workspace.rootPath
    }).content).toBe('{"inside":true}')

    const existingOutsideParent = path.join(workspace.rootPath, '..', 'outside-input.json')
    writeFileSync(existingOutsideParent, '{"outside":true}')
    expect(() => readAssistantCommandInput({
      args: ['--file', '../outside-input.json'],
      stdin: undefined,
      workspaceRoot: workspace.rootPath
    })).toThrow(/must not contain \.\./)
    expect(() => readAssistantCommandInput({
      args: ['--file', path.resolve(workspace.rootPath, 'absolute-input.json')],
      stdin: undefined,
      workspaceRoot: workspace.rootPath
    })).toThrow(/only accepts relative paths/)
    mkdirSync(path.join(workspace.rootPath, 'directory-input'))
    expect(() => readAssistantCommandInput({
      args: ['--file', 'directory-input'],
      stdin: undefined,
      workspaceRoot: workspace.rootPath
    })).toThrow(/must be a regular file/)
    expect(() => readAssistantCommandInput({
      args: ['--file', 'missing-input.json'],
      stdin: undefined,
      workspaceRoot: workspace.rootPath
    })).toThrow(/File not found: missing-input\.json/)
  })

  it.runIf(supportsFileSymbolicLinks)('rejects symlinks that escape the workspace', () => {
    const workspace = createWorkspace()
    const outside = path.join(workspace.rootPath, '..', 'outside.json')
    writeFileSync(outside, '{"outside":true}')
    symlinkSync(outside, path.join(workspace.rootPath, 'escape.json'))
    expect(() => readAssistantCommandInput({
      args: ['--file', 'escape.json'],
      stdin: undefined,
      workspaceRoot: workspace.rootPath
    })).toThrow(/cannot read files outside the assistant workspace/)
  })

  it('enforces the configured UTF-8 byte limits for stdin and files', () => {
    const workspace = createWorkspace()
    const payload = `${'x'.repeat(MAX_IMPORT_BYTES)}é`
    expect(Buffer.byteLength(payload, 'utf8')).toBeGreaterThan(MAX_IMPORT_BYTES)
    writeFileSync(path.join(workspace.rootPath, 'big.json'), payload)

    expect(() => readAssistantCommandInput({
      args: ['--stdin'],
      stdin: payload,
      workspaceRoot: workspace.rootPath,
      maxBytes: MAX_IMPORT_BYTES
    })).toThrow(AssistantCommandError)
    expect(() => readAssistantCommandInput({
      args: ['--file', 'big.json'],
      stdin: undefined,
      workspaceRoot: workspace.rootPath,
      maxBytes: MAX_IMPORT_BYTES
    })).toThrow(`File exceeds the ${MAX_IMPORT_BYTES} byte limit`)

    const tricky = JSON.stringify({ text: 'quote " backslash \\ newline \n 中文 é' })
    expect(parseAssistantCommandJson(tricky)).toEqual({
      text: 'quote " backslash \\ newline \n 中文 é'
    })
  })

  it('parses JSON including top-level null and rejects invalid payloads', () => {
    expect(parseAssistantCommandJson('null')).toBeNull()
    expect(parseAssistantCommandJson(' {"ok":true} ')).toEqual({ ok: true })
    expect(() => parseAssistantCommandJson('   ')).toThrow(AssistantCommandError)
    expect(() => parseAssistantCommandJson('{broken')).toThrow(AssistantCommandError)
  })
})
