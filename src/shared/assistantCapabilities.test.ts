import { describe, expect, it } from 'vitest'
import {
  ASSISTANT_CAPABILITY_SCHEMA_VERSION,
  ASSISTANT_COMMAND_DESCRIPTORS,
  CONTEXT_CAPABILITY_SUMMARIES,
  TERMINAL_AUTO_RETRY_CONFIG_EXAMPLES,
  WORKFLOW_NODE_TYPES,
  WORKFLOW_SCHEMA_EXAMPLES,
  buildAssistantHelpText,
  buildWorkflowSchema,
  renderWorkflowSchemaText,
  type WorkflowSchemaDocument
} from './assistantCapabilities'
import {
  LAYOUT_BOUNDS,
  PUBLIC_LAYOUT_WIDTH_KEYS,
  PUBLIC_SETTING_DEFINITIONS,
  parseLayoutPreferences,
  parsePublicLayoutWidth
} from './appSettings'
import { MAX_BRIDGE_BODY_BYTES } from './assistant'
import { createI18n } from './i18n'
import type { Translator } from './i18n/translator'
import { evaluateExpression } from './expression'
import {
  AUTO_RETRY_DEFAULT_MAX_RETRIES,
  AUTO_RETRY_MAX_MAX_RETRIES,
  AUTO_RETRY_MIN_MAX_RETRIES,
  RECOMMENDED_RETRY_DELAYS_MINUTES,
  parseTerminalAutoRetryConfig
} from './terminalAutoRetry'
import { parseWorkflowDefinition, SYSTEM_VARIABLES } from './workflow'

const translators: Array<{ language: 'en' | 'zh'; translate: Translator }> = []
for (const language of ['en', 'zh'] as const) {
  const instance = createI18n(language)
  translators.push({
    language,
    translate: (key, params) => instance.t(key, params)
  })
}

const [english] = translators

function collectStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(collectStrings)
  if (typeof value === 'object' && value !== null) {
    return Object.values(value).flatMap(collectStrings)
  }
  return []
}

function flattenKeys(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return prefix ? [prefix] : []
  if (Array.isArray(value)) return value.flatMap((entry, index) => flattenKeys(entry, `${prefix}[${index}]`))
  return Object.entries(value).flatMap(([key, child]) => flattenKeys(child, prefix ? `${prefix}.${key}` : key))
}

function namedJsonBlock(document: string, name: string, searchFromLine = 0): string {
  const lines = document.split('\n')
  const headerIndex = lines.findIndex((line, index) => (
    index >= searchFromLine && line.trim() === `${name}:`
  ))
  if (headerIndex < 0) throw new Error(`The document is missing the "${name}" example block`)
  const block: string[] = []
  for (const line of lines.slice(headerIndex + 1)) {
    if (line !== '' && !line.startsWith('    ')) break
    block.push(line.slice(4))
  }
  return block.join('\n').trim()
}

function terminalNode(workflow: ReturnType<typeof parseWorkflowDefinition>, nodeId: string) {
  const node = workflow.nodes.find((candidate) => candidate.id === nodeId)
  if (!node) throw new Error(`missing node ${nodeId}`)
  return node.config as Record<string, unknown>
}

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

  it('exposes 27 commands without the removed auto-retry entry points', () => {
    const ids = ASSISTANT_COMMAND_DESCRIPTORS.map((descriptor) => descriptor.id)
    expect(ids).not.toContain('workflow.auto-retry.get')
    expect(ids).not.toContain('workflow.auto-retry.set')
    expect(ids.length).toBe(27)
    for (const kept of [
      'help',
      'context',
      'doctor',
      'workflow.list',
      'workflow.get',
      'workflow.schema',
      'workflow.validate',
      'workflow.save',
      'workflow.delete',
      'project.list',
      'project.set-default-workflow',
      'settings.list',
      'settings.get',
      'settings.set',
      'shell.list',
      'shell.refresh',
      'shell.select',
      'skin.list',
      'skin.get',
      'skin.create',
      'skin.update',
      'skin.duplicate',
      'skin.rename',
      'skin.delete',
      'skin.import',
      'skin.export',
      'skin.fonts'
    ]) {
      expect(ids).toContain(kept)
    }
    const help = buildAssistantHelpText()
    expect(help).not.toContain('auto-retry')
    expect(help).toContain('cliloom workflow schema [--json]')
    expect(help).toContain('cliloom workflow save (--stdin | --file <relative-path>) [--expected-revision <revision>] [--json]')
    expect(help).toContain('cliloom shell select <automatic|detected-shell-id> [--json]')
    expect(help).toContain('cliloom skin fonts [--json]')
    expect(help).toContain('cliloom settings set <public-key> <value> [--json]')
    for (const usage of ASSISTANT_COMMAND_DESCRIPTORS.map((descriptor) => descriptor.usage)) {
      expect(help).toContain(usage)
    }
  })

  it('registers the capability groups in context summaries', () => {
    const summary = CONTEXT_CAPABILITY_SUMMARIES.join('\n')
    expect(summary).toContain('nodes[].config.autoRetry')
    expect(summary).toContain('shell')
    expect(summary).toContain('skins')
    expect(summary).toContain('layout.projectRailWidth')
    expect(summary).not.toContain('auto-retry get/set')
  })
})

describe('workflow schema capability document', () => {
  it('documents schemaVersion 2 with every planned section and field', () => {
    const schema = buildWorkflowSchema(english.translate)
    expect(schema.schemaVersion).toBe(ASSISTANT_CAPABILITY_SCHEMA_VERSION)
    expect(ASSISTANT_CAPABILITY_SCHEMA_VERSION).toBe(2)

    expect(Object.keys(schema.save).sort()).toEqual(
      ['create', 'input', 'readback', 'semantics', 'update', 'usage'].sort()
    )
    expect(schema.save.semantics.length).toBeGreaterThanOrEqual(8)

    expect(Object.keys(schema.workflow).sort()).toEqual(
      ['description', 'edges', 'id', 'layout', 'name', 'nodes'].sort()
    )
    expect(Object.keys(schema.node).sort()).toEqual(
      ['config', 'endHook', 'id', 'name', 'startHook', 'type'].sort()
    )
    expect(Object.keys(schema.nodeConfigs).sort()).toEqual([...WORKFLOW_NODE_TYPES].sort())
    expect(Object.keys(schema.nodeConfigs.start)).toEqual(['variables'])
    expect(Object.keys(schema.nodeConfigs.input)).toEqual(['variables'])
    expect(Object.keys(schema.nodeConfigs['interactive-terminal']).sort()).toEqual(
      ['autoRetry', 'autoStart', 'command', 'cwd', 'env', 'retryCommand', 'shell'].sort()
    )
    expect(Object.keys(schema.nodeConfigs['non-interactive-terminal']).sort()).toEqual(
      ['autoRetry', 'command', 'cwd', 'env', 'retryCommand', 'successExitCodes', 'timeoutMs'].sort()
    )
    expect(Object.keys(schema.nodeConfigs['exclusive-gateway'])).toEqual(['defaultEdgeId'])
    expect(Object.keys(schema.nodeConfigs['parallel-gateway']).sort()).toEqual(
      ['joinIncomingEdgeIds', 'mode'].sort()
    )
    expect(Object.keys(schema.nodeConfigs.end)).toEqual(['config'])
    expect(schema.nodeConfigs.end.config).toContain('{}')

    expect(Object.keys(schema.variables).sort()).toEqual(
      ['defaultValue', 'key', 'label', 'options', 'order', 'required', 'type', 'variables'].sort()
    )
    expect(Object.keys(schema.hooks).sort()).toEqual(
      ['absence', 'command', 'cwd', 'enabled', 'env', 'failPolicy'].sort()
    )
    expect(Object.keys(schema.edges).sort()).toEqual(
      ['condition', 'expression', 'from', 'id', 'isDefault', 'to'].sort()
    )
    expect(Object.keys(schema.layout).sort()).toEqual(['nodes', 'x', 'y'].sort())

    expect(Object.keys(schema.terminalAutoRetry.fields).sort()).toEqual(
      ['cron', 'enabled', 'maxRetries', 'mode'].sort()
    )
    expect(schema.terminalAutoRetry.appliesTo).toEqual([
      'interactive-terminal',
      'non-interactive-terminal'
    ])
    expect(Object.keys(schema.terminalAutoRetry.examples)).toContain('clear')
    expect(schema.terminalAutoRetry.examples.clear).toBeNull()

    expect(Object.keys(schema.systemVariables).sort()).toEqual([...SYSTEM_VARIABLES].sort())
    expect(Object.keys(schema.examples).sort()).toEqual([
      'allNodeTypes',
      'disabledKeepsStrategy',
      'minimal',
      'removedByNull',
      'removedByOmission',
      'terminalAutoRetry'
    ].sort())
    expect(schema.notes.length).toBeGreaterThanOrEqual(8)
  })

  it('keeps documented numbers aligned with the shared auto-retry constants', () => {
    const schema = buildWorkflowSchema(english.translate)
    const joined = collectStrings(schema).join('\n')
    expect(joined).toContain(`omitted defaults to ${AUTO_RETRY_DEFAULT_MAX_RETRIES}`)
    expect(joined).toContain(`Optional integer ${AUTO_RETRY_MIN_MAX_RETRIES}-${AUTO_RETRY_MAX_MAX_RETRIES}`)
    expect(schema.terminalAutoRetry.recommendedDelays).toContain(
      RECOMMENDED_RETRY_DELAYS_MINUTES.slice(0, -1).join(', ')
    )
    expect(schema.terminalAutoRetry.recommendedDelays).toContain(
      String(RECOMMENDED_RETRY_DELAYS_MINUTES[RECOMMENDED_RETRY_DELAYS_MINUTES.length - 1])
    )
    expect(joined).toContain('at most 1000 entries')
    expect(joined).toContain('is limited to 2 MiB')
  })

  it('describes null handling and join outgoing edges as the code behaves', () => {
    const schema = buildWorkflowSchema(english.translate)
    const notes = schema.notes.join('\n')
    expect(notes).toContain('removes the autoRetry field when it is omitted or null')
    expect(notes).toContain('submitting null fails validation instead of removing the field')
    expect(notes).toContain('variables[].defaultValue')
    expect(notes).toContain('every non-gateway node has at least one incoming edge and exactly one outgoing edge')
    expect(notes).toContain(
      'the validator accepts multiple outgoing edges on a join, but the runtime then continues along the first one in edges order'
    )
  })

  it('accepts every complete workflow example and normalizes it as documented', () => {
    for (const example of Object.values(WORKFLOW_SCHEMA_EXAMPLES)) {
      expect(() => parseWorkflowDefinition(example)).not.toThrow()
      expect(JSON.parse(JSON.stringify(example))).toEqual(example)
    }

    const retryExample = parseWorkflowDefinition(WORKFLOW_SCHEMA_EXAMPLES.terminalAutoRetry)
    expect(terminalNode(retryExample, 'notify').autoRetry).toEqual({
      enabled: true,
      mode: 'recommended',
      maxRetries: AUTO_RETRY_DEFAULT_MAX_RETRIES
    })
    expect(terminalNode(retryExample, 'sync').autoRetry).toEqual({
      enabled: true,
      mode: 'cron',
      cron: '*/15 * * * *',
      maxRetries: null
    })

    const disabled = parseWorkflowDefinition(WORKFLOW_SCHEMA_EXAMPLES.disabledKeepsStrategy)
    expect(terminalNode(disabled, 'watch').autoRetry).toEqual({
      enabled: false,
      mode: 'cron',
      cron: '*/15 * * *',
      maxRetries: 5
    })

    for (const removal of ['removedByNull', 'removedByOmission'] as const) {
      const parsed = parseWorkflowDefinition(WORKFLOW_SCHEMA_EXAMPLES[removal])
      expect(terminalNode(parsed, 'watch').autoRetry).toBeUndefined()
    }

    const allTypes = parseWorkflowDefinition(WORKFLOW_SCHEMA_EXAMPLES.allNodeTypes)
    expect(terminalNode(allTypes, 'build').autoRetry).toEqual({
      enabled: true,
      mode: 'recommended',
      maxRetries: 3
    })
  })

  it('documents autoRetry field values the shared parser accepts', () => {
    for (const [name, example] of Object.entries(TERMINAL_AUTO_RETRY_CONFIG_EXAMPLES)) {
      if (example === null) {
        expect(parseTerminalAutoRetryConfig(example)).toBeUndefined()
        continue
      }
      expect(parseTerminalAutoRetryConfig(example), name).toBeDefined()
    }
    expect(parseTerminalAutoRetryConfig(TERMINAL_AUTO_RETRY_CONFIG_EXAMPLES.recommendedDefault))
      .toEqual({ enabled: true, mode: 'recommended', maxRetries: AUTO_RETRY_DEFAULT_MAX_RETRIES })
  })

  it('evaluates the documented condition expressions with the shared parser', () => {
    const schema = buildWorkflowSchema(english.translate)
    expect(schema.edges.expression).toContain('environment == "production"')

    expect(evaluateExpression('environment == "production"', { environment: 'production' })).toBe(true)
    expect(evaluateExpression('environment == "production"', { environment: 'staging' })).toBe(false)
    expect(evaluateExpression(
      'approved and count >= 2 or not (environment == "staging")',
      { approved: true, count: 2, environment: 'production' }
    )).toBe(true)
    expect(evaluateExpression('contains(sys_last_command_stdout, "error")', {
      sys_last_command_stdout: 'fatal error occurred'
    })).toBe(true)
    expect(evaluateExpression('startsWith(environment, "prod")', { environment: 'production' })).toBe(true)
    expect(evaluateExpression('endsWith(environment, "tion")', { environment: 'production' })).toBe(true)
    expect(() => evaluateExpression('${environment} == "production"', { environment: 'production' }))
      .toThrow()
    expect(WORKFLOW_SCHEMA_EXAMPLES.allNodeTypes.edges
      .find((edge) => edge.id === 'gate-fanout')!.condition).toBe('environment == "production"')
  })

  it('generates en and zh documents from the same data shape with complete translations', () => {
    const englishSchema = buildWorkflowSchema(translators[0].translate)
    const chineseSchema = buildWorkflowSchema(translators[1].translate)
    expect(flattenKeys(chineseSchema)).toEqual(flattenKeys(englishSchema))

    for (const { language, translate } of translators) {
      const schema = buildWorkflowSchema(translate)
      const { examples: _workflowExamples, terminalAutoRetry, ...descriptions } = schema
      const { examples: _autoRetryExamples, ...autoRetryDescriptions } = terminalAutoRetry
      for (const value of [...collectStrings(descriptions), ...collectStrings(autoRetryDescriptions)]) {
        expect(value, `${language} leaked an untranslated key`).not.toContain('assistant:workflowSchema')
        expect(value, `${language} left an unreplaced placeholder`).not.toContain('{{')
        expect(value.length, `${language} has an empty description`).toBeGreaterThan(0)
      }
    }
  })

  it('renders the full text document with every section and complete examples', () => {
    const schema = buildWorkflowSchema(english.translate)
    const text = renderWorkflowSchemaText(schema, english.translate)

    for (const section of [
      'Saving workflows (workflow save)',
      'Workflow root fields',
      'Node common fields (nodes[] entries)',
      'Node config fields (nodes[].config by node type)',
      'Variable definitions (start/input config.variables[] entries)',
      'Hooks (startHook/endHook objects)',
      'Edges (edges[] entries)',
      'Layout (layout.nodes.<node-id>)',
      'Terminal automatic retry (config.autoRetry)',
      'System variables (provided by the runtime)',
      'Complete workflow examples',
      'Notes'
    ]) {
      expect(text).toContain(section)
    }
    for (const type of WORKFLOW_NODE_TYPES) {
      expect(text).toContain(`${type}:`)
    }
    for (const variable of SYSTEM_VARIABLES) {
      expect(text).toContain(`${variable}: `)
    }
    const documentLines = text.split('\n')
    const autoRetrySectionStart = documentLines.findIndex((line) => (
      line.trim() === 'Terminal automatic retry (config.autoRetry)'
    ))
    expect(autoRetrySectionStart).toBeGreaterThanOrEqual(0)
    const completeExamplesStart = documentLines.findIndex((line) => (
      line.trim() === 'Complete workflow examples'
    ))
    expect(completeExamplesStart).toBeGreaterThanOrEqual(0)
    expect(Object.keys(schema.examples)).toEqual(Object.keys(WORKFLOW_SCHEMA_EXAMPLES))
    for (const [name, example] of Object.entries(WORKFLOW_SCHEMA_EXAMPLES)) {
      expect(namedJsonBlock(text, name, completeExamplesStart)).toBe(JSON.stringify(example, null, 2))
    }
    expect(Object.keys(schema.terminalAutoRetry.examples))
      .toEqual(Object.keys(TERMINAL_AUTO_RETRY_CONFIG_EXAMPLES))
    for (const [name, example] of Object.entries(TERMINAL_AUTO_RETRY_CONFIG_EXAMPLES)) {
      expect(namedJsonBlock(text, name, autoRetrySectionStart)).toBe(JSON.stringify(example, null, 2))
    }
    expect(text).toContain('--file workflow.json')
    expect(text.length).toBeGreaterThan(4000)
  })

  it('keeps text and JSON responses inside the bridge body limit', () => {
    for (const { translate } of translators) {
      const schema: WorkflowSchemaDocument = buildWorkflowSchema(translate)
      const text = renderWorkflowSchemaText(schema, translate)
      const json = JSON.stringify({ version: 1, command: 'workflow.schema', ...schema })
      expect(Buffer.byteLength(text, 'utf8')).toBeLessThan(MAX_BRIDGE_BODY_BYTES)
      expect(Buffer.byteLength(json, 'utf8')).toBeLessThan(MAX_BRIDGE_BODY_BYTES)
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
