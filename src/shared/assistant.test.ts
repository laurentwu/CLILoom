import { describe, expect, it } from 'vitest'
import {
  StreamingSecretRedactor,
  buildAssistantBootstrapCommand,
  parseAssistantCommand
} from './assistant'

describe('assistant initialization commands', () => {
  it('parses quoted POSIX arguments without executing shell syntax', () => {
    expect(parseAssistantCommand("codex --model 'gpt 5' path\\ with\\ spaces", 'posix')).toEqual({
      executable: 'codex',
      args: ['--model', 'gpt 5', 'path with spaces']
    })
    expect(() => parseAssistantCommand('codex && echo unsafe', 'posix')).toThrow('control operator')
  })

  it('preserves Windows path separators inside and outside quotes', () => {
    expect(parseAssistantCommand('"C:\\Program Files\\Codex\\codex.exe" --config C:\\Users\\me\\codex.json', 'win32')).toEqual({
      executable: 'C:\\Program Files\\Codex\\codex.exe',
      args: ['--config', 'C:\\Users\\me\\codex.json']
    })
  })

  it('refuses percent expansion when cmd.exe is the only shell', () => {
    expect(() => buildAssistantBootstrapCommand(
      'cmd',
      'C:\\Tools\\codex.exe',
      ['%PATH%'],
      'C:\\CLILoom\\bin'
    )).toThrow('must not contain %')
  })

  it('builds a UTF-8 cmd bootstrap while preserving delayed-expansion characters', () => {
    expect(buildAssistantBootstrapCommand(
      'cmd',
      'C:\\Tools\\codex.exe',
      ['literal!value', '中文 😀'],
      'C:\\CLILoom\\bin'
    )).toBe(
      'chcp 65001>nul & set "PATH=C:\\CLILoom\\bin;%PATH%" && "C:\\Tools\\codex.exe" "literal!value" "中文 😀"'
    )
    expect(() => buildAssistantBootstrapCommand(
      'cmd',
      'C:\\Tools\\codex.exe',
      ['bad"value'],
      'C:\\CLILoom\\bin'
    )).toThrow('must not contain quotes')
  })

  it('prepends the private launcher PATH for POSIX and PowerShell bootstraps', () => {
    expect(buildAssistantBootstrapCommand(
      'posix',
      '/usr/local/bin/codex',
      ['--model', 'gpt 5'],
      '/private assistant/bin'
    )).toBe(
      "export PATH='/private assistant/bin':$PATH; exec '/usr/local/bin/codex' '--model' 'gpt 5'"
    )
    expect(buildAssistantBootstrapCommand(
      'powershell',
      'C:\\Tools\\codex.exe',
      ['--model', 'gpt 5'],
      'C:\\Private Assistant\\bin'
    )).toBe(
      "$env:PATH = 'C:\\Private Assistant\\bin' + [IO.Path]::PathSeparator + $env:PATH; & 'C:\\Tools\\codex.exe' '--model' 'gpt 5'"
    )
  })
})

describe('assistant secret redaction', () => {
  it('redacts a bridge token split across terminal output chunks', () => {
    const redactor = new StreamingSecretRedactor('secret-token')
    expect(redactor.push('before secret-')).toBe('before ')
    expect(redactor.push('token after')).toBe('[REDACTED] after')
    expect(redactor.flush()).toBe('')
  })
})
