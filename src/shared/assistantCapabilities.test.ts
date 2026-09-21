import { describe, expect, it } from 'vitest'
import {
  ASSISTANT_COMMAND_DESCRIPTORS,
  AUTO_RETRY_RECOMMENDED_DELAYS_LABEL,
  CONTEXT_CAPABILITY_SUMMARIES,
  TERMINAL_AUTO_RETRY_SCHEMA,
  WORKFLOW_NODE_TYPES,
  WORKFLOW_SCHEMA_EXAMPLES,
  WORKFLOW_SCHEMA_NOTES,
  buildAssistantHelpText,
  buildWorkflowSchema
} from './assistantCapabilities'
import {
  LAYOUT_BOUNDS,
  PUBLIC_LAYOUT_WIDTH_KEYS,
  PUBLIC_SETTING_DEFINITIONS,
  parseLayoutPreferences,
  parsePublicLayoutWidth
} from './appSettings'
import { parseWorkflowDefinition } from './workflow'
import {
  parseTerminalAutoRetryCommandInput,
  parseTerminalAutoRetryConfig
} from './terminalAutoRetry'

describe('assistant command descriptors', () => {
  it('has stable unique ids and usages covering every command', () => {
    const ids = ASSISTANT_COMMAND_DESCRIPTORS.map((descriptor) => descriptor.id)
    const usages = ASSISTANT_COMMAND_DESCRIPTORS.map((descriptor) => descriptor.usage)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(usages).size).toBe(usages.length)
    for (const descriptor of ASSISTANT_COMMAND_DESCRIPTORS) {
      expect(descriptor.summary).toBeTruthy()
      expect(descriptor.appliesTo).toBeTruthy()
    }
  })

  it('registers the new capability groups in help and context', () => {
    const help = buildAssistantHelpText()
    expect(help).toContain('cliloom workflow schema [--json]')
    expect(help).toContain('cliloom workflow auto-retry get <workflow-id> <node-id> [--json]')
    expect(help).toContain(
      'cliloom workflow auto-retry set <workflow-id> <node-id> (--stdin | --file <relative-path>) --expected-revision <revision> [--json]'
    )
    expect(help).toContain('cliloom shell list [--json]')
    expect(help).toContain('cliloom shell select <automatic|detected-shell-id> [--json]')
    expect(help).toContain('cliloom skin fonts [--json]')
    expect(help).toContain('cliloom settings set <public-key> <value> [--json]')

    const summary = CONTEXT_CAPABILITY_SUMMARIES.join('\n')
    expect(summary).toContain('auto-retry')
    expect(summary).toContain('shell')
    expect(summary).toContain('skins')
    expect(summary).toContain('layout.projectRailWidth')
    for (const usage of ASSISTANT_COMMAND_DESCRIPTORS.map((descriptor) => descriptor.usage)) {
      expect(help).toContain(usage)
    }
  })
})

describe('workflow schema capability document', () => {
  it('accepts every complete workflow example through the shared validator', () => {
    for (const example of Object.values(WORKFLOW_SCHEMA_EXAMPLES)) {
      expect(() => parseWorkflowDefinition(example)).not.toThrow()
    }
  })

  it('covers all node types and both terminal configs', () => {
    const schema = buildWorkflowSchema()
    expect(Object.keys(schema.nodeConfigs).sort()).toEqual([...WORKFLOW_NODE_TYPES].sort())
    expect(schema.terminalAutoRetry).toBe(TERMINAL_AUTO_RETRY_SCHEMA)
    expect(schema.notes.length).toBe(WORKFLOW_SCHEMA_NOTES.length)
    expect(AUTO_RETRY_RECOMMENDED_DELAYS_LABEL).toContain('1, 2, 5, 10')
    expect(AUTO_RETRY_RECOMMENDED_DELAYS_LABEL).toContain('then 30 minutes')
  })

  it('documents auto-retry examples that the shared parser accepts', () => {
    const examples = TERMINAL_AUTO_RETRY_SCHEMA.examples
    for (const example of Object.values(examples)) {
      if (example === null) {
        expect(parseTerminalAutoRetryCommandInput(example)).toBeUndefined()
        continue
      }
      expect(parseTerminalAutoRetryCommandInput(example)).toEqual(
        parseTerminalAutoRetryConfig(example)
      )
    }
  })
})

describe('public layout setting metadata', () => {
  it('keeps descriptor metadata in sync with the persisted layout bounds', () => {
    for (const key of PUBLIC_LAYOUT_WIDTH_KEYS) {
      const definition = PUBLIC_SETTING_DEFINITIONS[key]
      const isRail = key === 'layout.projectRailWidth'
      expect(definition.valueType).toBe('integer')
      expect(definition.minimum).toBe(
        isRail ? LAYOUT_BOUNDS.projectRailWidthMin : LAYOUT_BOUNDS.taskSidebarWidthMin
      )
      expect(definition.maximum).toBe(
        isRail ? LAYOUT_BOUNDS.projectRailWidthMax : LAYOUT_BOUNDS.taskSidebarWidthMax
      )
    }

    // The persisted parser uses the same shared bounds.
    expect(parseLayoutPreferences({
      version: 1,
      projectRailWidth: 1,
      taskSidebarWidth: 9_999
    })).toEqual({
      version: 1,
      projectRailWidth: LAYOUT_BOUNDS.projectRailWidthMin,
      taskSidebarWidth: LAYOUT_BOUNDS.taskSidebarWidthMax
    })
  })

  it('parses strict decimal integers for assistant width input', () => {
    expect(parsePublicLayoutWidth('layout.projectRailWidth', ' 52 ')).toBe(52)
    expect(parsePublicLayoutWidth('layout.projectRailWidth', '220')).toBe(220)
    expect(parsePublicLayoutWidth('layout.taskSidebarWidth', '140')).toBe(140)
    expect(parsePublicLayoutWidth('layout.taskSidebarWidth', '380')).toBe(380)
    expect(parsePublicLayoutWidth('layout.taskSidebarWidth', '168')).toBe(168)
  })

  it('rejects non-decimal or out-of-range width input', () => {
    const alwaysInvalid = ['', '  ', '52.5', '-52', '+52', '0x34', '1e2', '64px', 'true', 'NaN', 'Infinity']
    for (const value of alwaysInvalid) {
      expect(parsePublicLayoutWidth('layout.projectRailWidth', value)).toBeNull()
      expect(parsePublicLayoutWidth('layout.taskSidebarWidth', value)).toBeNull()
    }
    expect(parsePublicLayoutWidth('layout.projectRailWidth', '51')).toBeNull()
    expect(parsePublicLayoutWidth('layout.projectRailWidth', '221')).toBeNull()
    expect(parsePublicLayoutWidth('layout.taskSidebarWidth', '139')).toBeNull()
    expect(parsePublicLayoutWidth('layout.taskSidebarWidth', '381')).toBeNull()
  })
})

describe('strict auto-retry command input', () => {
  it('accepts complete configurations and normalizes defaults', () => {
    expect(parseTerminalAutoRetryCommandInput({
      enabled: true,
      mode: 'recommended',
      maxRetries: 5
    })).toEqual({ enabled: true, mode: 'recommended', maxRetries: 5 })
    expect(parseTerminalAutoRetryCommandInput({
      enabled: true,
      mode: 'recommended'
    })).toEqual({ enabled: true, mode: 'recommended', maxRetries: 10 })
    expect(parseTerminalAutoRetryCommandInput({
      enabled: true,
      mode: 'cron',
      cron: '*/15 * * * *',
      maxRetries: null
    })).toEqual({ enabled: true, mode: 'cron', cron: '*/15 * * * *', maxRetries: null })
  })

  it('maps JSON null to undefined so callers can delete the stored config', () => {
    expect(parseTerminalAutoRetryCommandInput(null)).toBeUndefined()
  })

  it('rejects unknown fields, cron in recommended mode, and invalid values', () => {
    expect(() => parseTerminalAutoRetryCommandInput({
      enabled: true,
      mode: 'recommended',
      cron: '*/5 * * * *'
    })).toThrow()
    expect(() => parseTerminalAutoRetryCommandInput({
      enabled: true,
      mode: 'recommended',
      timezone: 'UTC'
    })).toThrow()
    expect(() => parseTerminalAutoRetryCommandInput({
      enabled: 'true',
      mode: 'recommended'
    })).toThrow()
    expect(() => parseTerminalAutoRetryCommandInput({
      enabled: true,
      mode: 'hourly'
    })).toThrow()
    expect(() => parseTerminalAutoRetryCommandInput({
      enabled: true,
      mode: 'cron'
    })).toThrow()
    expect(() => parseTerminalAutoRetryCommandInput({
      enabled: true,
      mode: 'cron',
      cron: '*/5 * * * *',
      maxRetries: 0
    })).toThrow()
    expect(() => parseTerminalAutoRetryCommandInput({
      enabled: true,
      mode: 'cron',
      cron: '*/5 * * * *',
      maxRetries: '5'
    })).toThrow()
  })
})
