import { describe, expect, it } from 'vitest'
import type { ShellNeutralCommand } from '../shared/shell'
import { prepareExecutionInvocation } from './executionInvocation'

const nativeTarget = {
  id: 'posix:%2Fbin%2Fbash',
  displayName: 'bash',
  family: 'posix' as const,
  executablePath: '/bin/bash',
  source: 'system' as const
}

describe('execution target invocation builder', () => {
  it('builds native invocations and preserves target metadata', () => {
    const invocation = prepareExecutionInvocation({
      target: nativeTarget,
      mode: 'non-interactive',
      command: 'printf native',
      targetCwd: '/repo',
      hostCwd: '/private/runtime',
      baseEnvironment: { PATH: '/usr/bin' },
      platform: 'linux'
    })

    expect(invocation).toMatchObject({
      executable: '/bin/bash',
      args: ['-lc', 'printf native'],
      hostCwd: '/repo',
      targetCwd: '/repo',
      target: { kind: 'native', executablePath: '/bin/bash' }
    })
  })

  it('keeps bound values in the native environment instead of the command', () => {
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
      target: nativeTarget,
      mode: 'non-interactive',
      command,
      targetCwd: '/repo',
      hostCwd: '/private/runtime',
      baseEnvironment: { PATH: '/usr/bin' },
      platform: 'linux'
    })

    expect(invocation.args.join('\n')).not.toContain('secret $value')
    expect(invocation.env.CLILOOM_INTERNAL_VALUE_0).toBe('secret $value\n中文')
  })
})
