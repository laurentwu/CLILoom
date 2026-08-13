import { describe, expect, it } from 'vitest'
import type { DetectedShell, ShellNeutralCommand } from '../shared/shell'
import {
  CMD_MAX_COMMAND_CHARS,
  CMD_MAX_ENV_VALUE_CHARS,
  WINDOWS_MAX_ENV_BLOCK_CHARS,
  buildInteractiveInvocation,
  buildNonInteractiveInvocation,
  buildShellEnvironment,
  getCmdCommandLineLength,
  getInteractiveCommandTerminator,
  prepareShellCommand,
  renderShellCommand
} from './shellExecution'

const shells: Record<DetectedShell['family'], DetectedShell> = {
  posix: {
    id: 'posix:/bin/bash',
    displayName: 'bash',
    family: 'posix',
    executablePath: '/bin/bash',
    source: 'system'
  },
  powershell: {
    id: 'powershell:C:/pwsh.exe',
    displayName: 'PowerShell 7',
    family: 'powershell',
    executablePath: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
    source: 'path'
  },
  cmd: {
    id: 'cmd:C:/cmd.exe',
    displayName: 'Command Prompt',
    family: 'cmd',
    executablePath: 'C:\\Windows\\System32\\cmd.exe',
    source: 'system'
  }
}

const neutral: ShellNeutralCommand = {
  version: 1,
  segments: [
    { type: 'literal', value: 'printf "' },
    { type: 'binding', name: 'CLILOOM_INTERNAL_VALUE_0' },
    { type: 'literal', value: '"' }
  ],
  bindings: { CLILOOM_INTERNAL_VALUE_0: '& | < > ^ % ! " \' ( ) 中文 😀' }
}

describe('shell execution adapters', () => {
  it('renders isolated bindings for every supported shell family', () => {
    expect(renderShellCommand(neutral, 'posix')).toBe('printf "${CLILOOM_INTERNAL_VALUE_0}"')
    expect(renderShellCommand(neutral, 'powershell')).toBe('printf "${env:CLILOOM_INTERNAL_VALUE_0}"')
    expect(renderShellCommand(neutral, 'cmd')).toBe('printf "!CLILOOM_INTERNAL_VALUE_0!"')
  })

  it('builds explicit non-interactive and interactive invocations', () => {
    expect(buildNonInteractiveInvocation(shells.posix, 'echo ok')).toEqual({
      executable: '/bin/bash',
      args: ['-lc', 'echo ok']
    })
    expect(buildNonInteractiveInvocation(shells.powershell, 'Write-Output ok').args).toEqual([
      '-NoLogo',
      '-Command',
      expect.stringMatching(/OutputEncoding.*Write-Output ok/)
    ])
    expect(buildNonInteractiveInvocation(shells.cmd, 'echo ok').args).toEqual([
      '/d', '/v:on', '/s', '/c', 'chcp 65001>nul & echo ok'
    ])
    expect(buildInteractiveInvocation(shells.posix).args).toEqual(['-il'])
    expect(buildInteractiveInvocation(shells.powershell).args).toEqual([
      '-NoLogo', '-NoExit', '-Command', expect.stringContaining('OutputEncoding')
    ])
    expect(buildInteractiveInvocation(shells.cmd).args).toEqual([
      '/d', '/v:on', '/k', 'chcp 65001>nul'
    ])
    expect(getInteractiveCommandTerminator('linux')).toBe('\n')
    expect(getInteractiveCommandTerminator('win32')).toBe('\r')
  })

  it('merges Windows environment keys case-insensitively', () => {
    expect(buildShellEnvironment({
      base: { Path: 'old', LANG: 'legacy' },
      overlay: { PATH: 'new' },
      platform: 'win32',
      family: 'powershell'
    })).toMatchObject({
      PATH: 'new',
      LANG: 'legacy',
      PYTHONUTF8: '1',
      PYTHONIOENCODING: 'utf-8'
    })
  })

  it('remaps generated binding names that collide with inherited environment keys', () => {
    const prepared = prepareShellCommand({
      shell: shells.powershell,
      command: neutral,
      baseEnvironment: { cliloom_internal_value_0: 'inherited' },
      platform: 'win32'
    })

    expect(prepared.command).toBe('printf "${env:CLILOOM_INTERNAL_VALUE_1}"')
    expect(prepared.env.cliloom_internal_value_0).toBe('inherited')
    expect(prepared.env.CLILOOM_INTERNAL_VALUE_1).toBe(neutral.bindings.CLILOOM_INTERNAL_VALUE_0)
  })

  it('applies a UTF-8 locale to POSIX shells including Git Bash on Windows', () => {
    expect(buildShellEnvironment({
      base: {},
      platform: 'win32',
      family: 'posix'
    })).toMatchObject({ LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' })
  })

  it('uses platform-appropriate UTF-8 locale fallbacks on Linux and macOS', () => {
    expect(buildShellEnvironment({
      base: { LANG: 'C', LC_ALL: 'C' },
      platform: 'linux',
      family: 'posix'
    })).toMatchObject({ LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' })
    expect(buildShellEnvironment({
      base: {},
      platform: 'darwin',
      family: 'posix'
    })).toMatchObject({ LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' })
  })

  it('rejects unsafe or oversized cmd values before launch', () => {
    expect(() => prepareShellCommand({
      shell: shells.cmd,
      command: { ...neutral, bindings: { CLILOOM_INTERNAL_VALUE_0: 'line1\nline2' } },
      baseEnvironment: {},
      platform: 'win32'
    })).toThrow('cmd variable values must not contain newlines')
    expect(() => prepareShellCommand({
      shell: shells.cmd,
      command: {
        version: 1,
        segments: [{ type: 'literal', value: 'x'.repeat(CMD_MAX_COMMAND_CHARS + 1) }],
        bindings: {}
      },
      baseEnvironment: {},
      platform: 'win32'
    })).toThrow('cmd command exceeds the')
    expect(() => prepareShellCommand({
      shell: shells.cmd,
      command: { ...neutral, bindings: { CLILOOM_INTERNAL_VALUE_0: 'bad\0value' } },
      baseEnvironment: {},
      platform: 'win32'
    })).toThrow('NUL')
  })

  it('accepts isolated cmd binding characters without putting their values in shell source', () => {
    const values = [
      '',
      '& | < > ^ % ! " \' ( )',
      '空 格/路径\\😀',
      'repeat & | repeat & |'
    ]

    for (const value of values) {
      const command: ShellNeutralCommand = {
        version: 1,
        segments: [
          { type: 'literal', value: 'echo ' },
          { type: 'binding', name: 'CLILOOM_INTERNAL_VALUE_0' },
          { type: 'literal', value: ' ' },
          { type: 'binding', name: 'CLILOOM_INTERNAL_VALUE_0' }
        ],
        bindings: { CLILOOM_INTERNAL_VALUE_0: value }
      }
      const prepared = prepareShellCommand({
        shell: shells.cmd,
        command,
        baseEnvironment: {},
        platform: 'win32'
      })

      expect(prepared.command).toBe(value === ''
        ? 'echo  '
        : 'echo !CLILOOM_INTERNAL_VALUE_0! !CLILOOM_INTERNAL_VALUE_0!')
      expect(prepared.command).not.toContain(value || '<empty-value>')
      expect(prepared.env.CLILOOM_INTERNAL_VALUE_0).toBe(value)
    }
  })

  it('renders an empty cmd binding without relying on delayed environment expansion', () => {
    const prepared = prepareShellCommand({
      shell: shells.cmd,
      command: {
        version: 1,
        segments: [
          { type: 'literal', value: 'echo(__START__' },
          { type: 'binding', name: 'CLILOOM_INTERNAL_VALUE_0' },
          { type: 'literal', value: '__END__' }
        ],
        bindings: { CLILOOM_INTERNAL_VALUE_0: '' }
      },
      baseEnvironment: {},
      platform: 'win32'
    })

    expect(prepared.command).toBe('echo(__START____END__')
    expect(prepared.command).not.toContain('CLILOOM_INTERNAL_VALUE_0')
    expect(prepared.env.CLILOOM_INTERNAL_VALUE_0).toBe('')
  })

  it('rejects cmd templates whose literal syntax conflicts with delayed expansion', () => {
    expect(() => prepareShellCommand({
      shell: shells.cmd,
      command: 'echo literal!',
      baseEnvironment: {},
      platform: 'win32'
    })).toThrow('cmd command templates must not contain !')
    expect(() => prepareShellCommand({
      shell: shells.cmd,
      command: 'echo first\necho second',
      baseEnvironment: {},
      platform: 'win32'
    })).toThrow('cmd command templates must not contain newlines')
  })

  it('preflights cmd percent expansion and environment block limits', () => {
    expect(() => prepareShellCommand({
      shell: shells.cmd,
      command: 'echo %LONG_VALUE%',
      baseEnvironment: { LONG_VALUE: 'safe' },
      platform: 'win32'
    })).toThrow('must not use %NAME% environment variable expansion')
    expect(() => prepareShellCommand({
      shell: shells.cmd,
      command: 'echo %PATH:~0,5%',
      baseEnvironment: { PATH: 'C:\\Windows' },
      platform: 'win32'
    })).toThrow('must not use %NAME% environment variable expansion')
    expect(() => prepareShellCommand({
      shell: shells.cmd,
      command: 'echo %CLILOOM_INTERNAL_VALUE_0%',
      baseEnvironment: {},
      platform: 'win32'
    })).toThrow('must not use %NAME% environment variable expansion')
    expect(() => prepareShellCommand({
      shell: shells.cmd,
      command: 'echo ok',
      baseEnvironment: { LONG_VALUE: 'x'.repeat(CMD_MAX_ENV_VALUE_CHARS + 1) },
      platform: 'win32'
    })).toThrow(`environment variable LONG_VALUE exceeds the ${CMD_MAX_ENV_VALUE_CHARS}`)

    const environment = Object.fromEntries(
      Array.from({ length: 40 }, (_, index) => [
        `VALUE_${index}`,
        'x'.repeat(Math.floor(WINDOWS_MAX_ENV_BLOCK_CHARS / 40))
      ])
    )
    expect(() => prepareShellCommand({
      shell: shells.cmd,
      command: 'echo ok',
      baseEnvironment: environment,
      platform: 'win32'
    })).toThrow(`environment block exceeds the ${WINDOWS_MAX_ENV_BLOCK_CHARS}`)
  })

  it('includes the cmd executable and argv wrapper in the command-line limit', () => {
    const maximumRenderedLength = CMD_MAX_COMMAND_CHARS - getCmdCommandLineLength(shells.cmd, 0)
    expect(() => prepareShellCommand({
      shell: shells.cmd,
      command: 'x'.repeat(maximumRenderedLength),
      baseEnvironment: {},
      platform: 'win32'
    })).not.toThrow()
    expect(() => prepareShellCommand({
      shell: shells.cmd,
      command: 'x'.repeat(maximumRenderedLength + 1),
      baseEnvironment: {},
      platform: 'win32'
    })).toThrow('cmd command exceeds the')
  })
})
