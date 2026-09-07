import { describe, expect, it } from 'vitest'
import {
  bindMixedWorkflowRetryTemplate,
  bindTerminalCommandTemplate,
  commandsAreSemanticallyEqual,
  parseTerminalCommandTemplateSnapshot,
  parseTerminalRetryEdit,
  restoreTerminalCommandTemplate
} from './terminalRetry'
import { bindShellCommand, createWorkflowCommandTemplateSnapshot } from './workflow'

describe('terminal retry templates', () => {
  it('captures only referenced workflow values and validates the neutral command semantically', () => {
    const template = 'tool --name ${name} --again ${name} --code ${code}'
    const variables = { name: 'a; $(printf injected)', code: 7, unused: 'secret' }
    const command = bindShellCommand(template, variables)
    const snapshot = createWorkflowCommandTemplateSnapshot(template, variables)

    expect(snapshot).toEqual({
      version: 1,
      syntax: 'workflow',
      template,
      variables: { name: 'a; $(printf injected)', code: '7' }
    })
    expect(parseTerminalCommandTemplateSnapshot(snapshot, command)).toEqual(snapshot)
    expect(command.segments.filter((segment) => segment.type === 'binding')).toHaveLength(3)
  })

  it('falls back to readable saved placeholders when stored snapshot metadata does not match', () => {
    const command = {
      version: 1 as const,
      segments: [
        { type: 'literal' as const, value: 'echo ${retry_saved_1} ' },
        { type: 'binding' as const, name: 'CLILOOM_INTERNAL_VALUE_4' },
        { type: 'literal' as const, value: ':' },
        { type: 'binding' as const, name: 'CLILOOM_INTERNAL_VALUE_4' },
        { type: 'binding' as const, name: 'CLILOOM_INTERNAL_VALUE_7' }
      ],
      bindings: { CLILOOM_INTERNAL_VALUE_4: 'one', CLILOOM_INTERNAL_VALUE_7: 'two' }
    }
    const restored = restoreTerminalCommandTemplate(command, {
      version: 1,
      syntax: 'workflow',
      template: 'wrong ${value}',
      variables: { value: 'different' }
    })

    expect(restored).toEqual({
      version: 1,
      syntax: 'replay',
      template: 'echo ${retry_saved_1} ${retry_saved_2}:${retry_saved_2}${retry_saved_3}',
      variables: { retry_saved_2: 'one', retry_saved_3: 'two' }
    })
    expect(commandsAreSemanticallyEqual(command, bindTerminalCommandTemplate(restored.template, restored))).toBe(true)
  })

  it('keeps native shell references literal and rejects newly invented saved placeholders', () => {
    const snapshot = {
      version: 1 as const,
      syntax: 'replay' as const,
      template: 'echo ${HOME} ${retry_saved_9} ${retry_saved_1}',
      variables: { retry_saved_1: 'saved' }
    }
    const command = bindTerminalCommandTemplate(snapshot.template, snapshot)
    expect(command.segments).toEqual([
      { type: 'literal', value: 'echo ${HOME} ${retry_saved_9} ' },
      { type: 'binding', name: 'CLILOOM_INTERNAL_VALUE_0' }
    ])
    expect(() => bindTerminalCommandTemplate('echo ${retry_saved_2}', snapshot))
      .toThrowError('unknown-saved-variable')
  })

  it('uses current workflow values while retaining recovered saved values as isolated bindings', () => {
    const replay = {
      version: 1 as const,
      syntax: 'replay' as const,
      template: 'tool ${retry_saved_1}',
      variables: { retry_saved_1: 'old; $(touch bad)' }
    }
    const bound = bindMixedWorkflowRetryTemplate(
      'tool ${retry_saved_1} ${current}',
      { current: 'new; `touch bad`' },
      replay,
      (value) => String(value ?? '')
    )
    expect(Object.values(bound.command.bindings)).toEqual([
      'old; $(touch bad)',
      'new; `touch bad`'
    ])
    expect(bound.command.segments.filter((segment) => segment.type === 'literal')).toEqual([
      { type: 'literal', value: 'tool ' },
      { type: 'literal', value: ' ' }
    ])
  })

  it('validates renderer edit DTOs without trimming command text', () => {
    expect(parseTerminalRetryEdit({ revision: 'rev', command: '  echo ok\n' })).toEqual({
      revision: 'rev',
      command: '  echo ok\n'
    })
    expect(parseTerminalRetryEdit(null)).toBeNull()
    expect(parseTerminalRetryEdit([])).toBeNull()
    expect(parseTerminalRetryEdit({ revision: '', command: 'x' })).toBeNull()
    expect(parseTerminalRetryEdit({ revision: 'rev', command: 'x\0y' })).toBeNull()
    expect(parseTerminalRetryEdit({ revision: 'rev', command: 'x', cwd: '/tmp' })).toBeNull()
  })
})
