import { describe, expect, it } from 'vitest'
import type { ResolvedWslTarget, ShellNeutralCommand } from '../shared/shell'
import { prepareExecutionInvocation } from './executionInvocation'
import {
  WSL_SESSION_SCOPE_LAUNCH_SCRIPT,
  WSL_SESSION_WRAPPER_SCRIPT,
  WSL_TRANSPORT_ENV_PREFIX
} from './wslService'

const wslTarget: ResolvedWslTarget = {
  kind: 'wsl',
  id: 'wsl:v1:Ubuntu',
  displayName: 'Ubuntu',
  family: 'posix',
  distributionName: 'Ubuntu',
  validationState: 'ready',
  wslVersion: 2,
  wslExecutablePath: 'C:\\Windows\\System32\\wsl.exe',
  loginShellPath: '/bin/bash',
  homeDirectory: '/home/me',
  defaultUid: 1000,
  userShellPath: '/home/me/.nvm/versions/node/v24/bin:/usr/local/bin:/usr/bin:/bin'
}

describe('execution target invocation builder', () => {
  it('builds a WSL argument array and keeps bound values out of commands and diagnostics', () => {
    const command: ShellNeutralCommand = {
      version: 1,
      segments: [
        { type: 'literal', value: 'printf "%s" "' },
        { type: 'binding', name: 'CLILOOM_INTERNAL_VALUE_0' },
        { type: 'literal', value: '"' }
      ],
      bindings: { CLILOOM_INTERNAL_VALUE_0: 'secret $value\n中文' }
    }
    const invocation = prepareExecutionInvocation({
      target: wslTarget,
      mode: 'non-interactive',
      command,
      targetCwd: '/home/me/repo with spaces',
      hostCwd: 'C:\\Users\\me\\AppData\\Local\\CLILoom\\runtime',
      sessionId: 'session_123',
      baseEnvironment: {
        SystemRoot: 'C:\\Windows',
        Path: 'C:\\Windows\\System32',
        WSLENV: 'KEEP/u'
      },
      requestEnvironment: { LITERAL: '${HOME}\n$value' },
      platform: 'win32'
    })

    expect(invocation.executable).toBe(wslTarget.wslExecutablePath)
    expect(invocation.args.slice(0, 8)).toEqual([
      '--distribution', 'Ubuntu',
      '--cd', '/home/me/repo with spaces',
      '--exec', '/bin/sh', '-c', WSL_SESSION_SCOPE_LAUNCH_SCRIPT
    ])
    expect(invocation.args).toContain(WSL_SESSION_WRAPPER_SCRIPT)
    expect(invocation.args).toContain('/bin/bash')
    expect(invocation.args).toContain('command')
    expect(invocation.args.join('\n')).not.toContain('secret $value')
    expect(invocation.args.join('\n')).not.toContain('${HOME}\n$value')
    expect(invocation.env.CLILOOM_INTERNAL_VALUE_0).toBeUndefined()
    expect(invocation.env.LITERAL).toBeUndefined()
    expect(Object.values(invocation.env)).toContain('secret $value\n中文')
    expect(Object.values(invocation.env)).toContain('${HOME}\n$value')
    expect(Object.values(invocation.env)).toContain('session_123')
    expect(Object.values(invocation.env)).toContain(wslTarget.userShellPath)
    expect(Object.values(invocation.env)).toContain(
      'KEEP/u:PATH/u:LITERAL:CLILOOM_SESSION_ID:CLILOOM_INTERNAL_VALUE_0'
    )
    expect(invocation.env.WSLENV).toMatch(/^KEEP\/u:CLILOOM_WSL_TRANSPORT_0:/)
    expect(invocation.hostCwd).toBe('C:\\Users\\me\\AppData\\Local\\CLILoom\\runtime')
    expect(invocation.targetCwd).toBe('/home/me/repo with spaces')
    expect(invocation.wslSession).toEqual({
      distributionName: 'Ubuntu',
      sessionId: 'session_123',
      sessionDirectory: '/home/me/.cache/cliloom/sessions',
      unitName: 'cliloom-session_123.scope'
    })
  })

  it('keeps helper-sensitive overrides staged until the login shell starts', () => {
    const invocation = prepareExecutionInvocation({
      target: wslTarget,
      mode: 'non-interactive',
      command: 'true',
      targetCwd: '/tmp',
      hostCwd: 'C:\\runtime',
      sessionId: 'helper-env',
      baseEnvironment: {
        SystemRoot: 'C:\\Windows',
        Path: 'C:\\Windows\\System32',
        WSLENV: 'KEEP/u'
      },
      requestEnvironment: {
        Path: '/user/only',
        HOME: '/user/home',
        XDG_RUNTIME_DIR: '/user/runtime'
      },
      platform: 'win32'
    })

    expect(invocation.env.Path).toBe('C:\\Windows\\System32')
    expect(invocation.env.PATH).toBeUndefined()
    expect(invocation.env.HOME).toBeUndefined()
    expect(invocation.env.XDG_RUNTIME_DIR).toBeUndefined()
    expect(Object.values(invocation.env)).toEqual(expect.arrayContaining([
      '/user/only', '/user/home', '/user/runtime'
    ]))
    expect(Object.values(invocation.env)).not.toContain(wslTarget.userShellPath)
    expect(Object.values(invocation.env)).toContain(
      'KEEP/u:PATH/u:HOME:XDG_RUNTIME_DIR:CLILOOM_SESSION_ID'
    )
    expect(invocation.args.join('\n')).not.toContain('/user/only')
    expect(WSL_SESSION_SCOPE_LAUNCH_SCRIPT).toContain('PATH=/usr/local/sbin:')
    expect(WSL_SESSION_SCOPE_LAUNCH_SCRIPT).toContain('initial_path=$PATH')
    expect(WSL_SESSION_SCOPE_LAUNCH_SCRIPT).toContain('HOME=$trusted_home')
    expect(WSL_SESSION_SCOPE_LAUNCH_SCRIPT).toContain('--expand-environment=no')
    expect(WSL_SESSION_WRAPPER_SCRIPT).toContain('PATH=$initial_path')
  })

  it('uses the WSL initial PATH when transporting the captured default would overflow', () => {
    const longUserPath = `/${'p'.repeat(16_000)}`
    const invocation = prepareExecutionInvocation({
      target: { ...wslTarget, userShellPath: longUserPath },
      mode: 'non-interactive',
      command: 'true',
      targetCwd: '/tmp',
      hostCwd: 'C:\\runtime',
      sessionId: 'large-default-path',
      baseEnvironment: {
        SystemRoot: 'C:\\Windows',
        LARGE_HOST_VALUE: 'x'.repeat(17_000)
      },
      platform: 'win32'
    })

    expect(Object.values(invocation.env)).not.toContain(longUserPath)
    expect(Object.values(invocation.env)).toContain('CLILOOM_SESSION_ID')
    expect(Object.values(invocation.env).some((value) => value.includes('PATH'))).toBe(false)

    expect(() => prepareExecutionInvocation({
      target: { ...wslTarget, userShellPath: longUserPath },
      mode: 'non-interactive',
      command: 'true',
      targetCwd: '/tmp',
      hostCwd: 'C:\\runtime',
      sessionId: 'large-explicit-path',
      baseEnvironment: {
        SystemRoot: 'C:\\Windows',
        LARGE_HOST_VALUE: 'x'.repeat(17_000)
      },
      requestEnvironment: { PATH: longUserPath },
      platform: 'win32'
    })).toThrow(/environment block/i)
  })

  it('lets interactive shells rebuild their default PATH from the WSL initial environment', () => {
    const invocation = prepareExecutionInvocation({
      target: wslTarget,
      mode: 'interactive',
      command: '',
      targetCwd: '/home/me',
      hostCwd: 'C:\\runtime',
      sessionId: 'interactive-path',
      baseEnvironment: { SystemRoot: 'C:\\Windows' },
      platform: 'win32'
    })

    expect(Object.values(invocation.env)).not.toContain(wslTarget.userShellPath)
    expect(Object.values(invocation.env).some((value) => value.includes('PATH'))).toBe(false)
  })

  it('rejects case-colliding, non-portable, and reserved workflow environment names', () => {
    const common = {
      target: wslTarget,
      mode: 'non-interactive' as const,
      command: 'true',
      targetCwd: '/tmp',
      hostCwd: 'C:\\runtime',
      sessionId: 'session',
      baseEnvironment: { SystemRoot: 'C:\\Windows' },
      platform: 'win32' as const
    }
    expect(() => prepareExecutionInvocation({
      ...common,
      requestEnvironment: { Name: 'one', NAME: 'two' }
    })).toThrow(/collide/i)
    expect(() => prepareExecutionInvocation({
      ...common,
      requestEnvironment: { 'BAD-NAME': 'value' }
    })).toThrow(/Invalid portable WSL environment variable name/i)
    expect(() => prepareExecutionInvocation({
      ...common,
      requestEnvironment: { CLILOOM_INTERNAL_VALUE_0: 'value' }
    })).toThrow(/reserved/i)
    expect(() => prepareExecutionInvocation({
      ...common,
      requestEnvironment: { CLILOOM_INTERNAL_VALUE_0: 'value' },
      allowInternalEnvironment: true
    })).toThrow(/reserved/i)
    expect(() => prepareExecutionInvocation({
      ...common,
      requestEnvironment: { [`${WSL_TRANSPORT_ENV_PREFIX}0`]: 'value' }
    })).toThrow(/reserved/i)
  })

  it('keeps the existing native invocation path unchanged', () => {
    const invocation = prepareExecutionInvocation({
      target: {
        id: 'posix:%2Fbin%2Fbash',
        displayName: 'bash',
        family: 'posix',
        executablePath: '/bin/bash',
        source: 'system'
      },
      mode: 'non-interactive',
      command: 'printf native',
      targetCwd: '/repo',
      hostCwd: '/private/runtime',
      sessionId: 'native-session',
      baseEnvironment: { PATH: '/usr/bin' },
      platform: 'linux'
    })
    expect(invocation).toMatchObject({
      executable: '/bin/bash',
      args: ['-lc', 'printf native'],
      hostCwd: '/repo',
      targetCwd: '/repo'
    })
  })
})
