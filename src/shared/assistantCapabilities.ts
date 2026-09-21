import {
  AUTO_RETRY_CRON_MAX_LENGTH,
  AUTO_RETRY_DEFAULT_MAX_RETRIES,
  AUTO_RETRY_MAX_MAX_RETRIES,
  AUTO_RETRY_MIN_MAX_RETRIES,
  RECOMMENDED_RETRY_DELAYS_MINUTES
} from './terminalAutoRetry'
import { SKIN_BOUNDS } from './skin'
import { LAYOUT_BOUNDS } from './appSettings'
import {
  MAX_WORKFLOW_EDGES,
  MAX_WORKFLOW_NODES,
  MAX_WORKFLOW_STRING,
  SYSTEM_VARIABLES,
  SYSTEM_VARIABLE_DESCRIPTIONS
} from './workflow'
import type { NodeType } from './workflow'
import type { Translator } from './i18n/translator'
import type { TranslationKey } from './i18n/types'

/**
 * Descriptive capability catalog for the cliloom assistant CLI. This module is
 * pure data: it must not depend on Electron, the browser, the filesystem, or
 * main-process objects. Final validation always happens in the existing
 * business parsers; nothing here is a JSON Schema validator.
 */

export const ASSISTANT_CAPABILITY_SCHEMA_VERSION = 2

export type AssistantCommandDescriptor = {
  /** Stable command id used in --json output and capability tests. */
  id: string
  /** Exact CLI usage line shown by `cliloom help`. */
  usage: string
  summary: string
  /** Input form for commands that take JSON payloads. */
  input?: string
  /** When a change takes effect. */
  appliesTo: string
}

export const ASSISTANT_COMMAND_DESCRIPTORS: readonly AssistantCommandDescriptor[] = [
  {
    id: 'help',
    usage: 'cliloom help',
    summary: 'List every assistant command with its usage line',
    appliesTo: 'read-only'
  },
  {
    id: 'context',
    usage: 'cliloom context [--json]',
    summary: 'Application snapshot: projects, workflows, public settings, shell and skin summaries',
    appliesTo: 'read-only'
  },
  {
    id: 'doctor',
    usage: 'cliloom doctor [--json]',
    summary: 'Diagnose the assistant terminal, bridge, and workspace',
    appliesTo: 'read-only'
  },
  {
    id: 'workflow.list',
    usage: 'cliloom workflow list [--json]',
    summary: 'List workflows with id, revision, name',
    appliesTo: 'read-only'
  },
  {
    id: 'workflow.get',
    usage: 'cliloom workflow get <workflow-id> [--json]',
    summary: 'Read one workflow definition and its current revision',
    appliesTo: 'read-only'
  },
  {
    id: 'workflow.schema',
    usage: 'cliloom workflow schema [--json]',
    summary: 'Complete field-level workflow save documentation, node configs, variables, hooks, edges, layout, auto-retry rules, and valid examples',
    appliesTo: 'read-only'
  },
  {
    id: 'workflow.validate',
    usage: 'cliloom workflow validate (--stdin | --file <relative-path>) [--json]',
    summary: 'Validate a full workflow JSON without saving',
    input: 'Full workflow definition object',
    appliesTo: 'read-only'
  },
  {
    id: 'workflow.save',
    usage: 'cliloom workflow save (--stdin | --file <relative-path>) [--expected-revision <revision>] [--json]',
    summary: 'Create or revision-checked update of a full workflow definition (including nodes[].config.autoRetry)',
    input: 'Full workflow definition object',
    appliesTo: 'future-workflow-runs'
  },
  {
    id: 'workflow.delete',
    usage: 'cliloom workflow delete <workflow-id> [--json]',
    summary: 'Delete a workflow after the existing confirmation flow',
    appliesTo: 'future-workflow-runs'
  },
  {
    id: 'project.list',
    usage: 'cliloom project list [--json]',
    summary: 'List projects with their default workflow',
    appliesTo: 'read-only'
  },
  {
    id: 'project.set-default-workflow',
    usage: 'cliloom project set-default-workflow <project-id> <workflow-id> [--json]',
    summary: 'Set the default workflow of a project',
    appliesTo: 'future-workflow-runs'
  },
  {
    id: 'settings.list',
    usage: 'cliloom settings list [--json]',
    summary: 'List public settings with values and metadata',
    appliesTo: 'read-only'
  },
  {
    id: 'settings.get',
    usage: 'cliloom settings get <public-key> [--json]',
    summary: 'Read one public setting (values are strings)',
    appliesTo: 'read-only'
  },
  {
    id: 'settings.set',
    usage: 'cliloom settings set <public-key> <value> [--json]',
    summary: 'Write one public setting: skin, language, sidebar widths, assistant command',
    appliesTo: 'varies by key (see definitions)'
  },
  {
    id: 'shell.list',
    usage: 'cliloom shell list [--json]',
    summary: 'Shell snapshot: selection mode, detected candidates, effective target',
    appliesTo: 'read-only'
  },
  {
    id: 'shell.refresh',
    usage: 'cliloom shell refresh [--json]',
    summary: 'Re-detect shells and rebuild the runtime environment (same path as the settings UI)',
    appliesTo: 'new-workflows-and-next-assistant-session'
  },
  {
    id: 'shell.select',
    usage: 'cliloom shell select <automatic|detected-shell-id> [--json]',
    summary: 'Select the global shell by automatic mode or a detected candidate id',
    appliesTo: 'new-workflows-and-next-assistant-session'
  },
  {
    id: 'skin.list',
    usage: 'cliloom skin list [--json]',
    summary: 'List skins with id, name, builtin, active flags (no color content)',
    appliesTo: 'read-only'
  },
  {
    id: 'skin.get',
    usage: 'cliloom skin get <skin-id> [--json]',
    summary: 'Read one skin including its full content',
    appliesTo: 'read-only'
  },
  {
    id: 'skin.create',
    usage: 'cliloom skin create (--stdin | --file <relative-path>) [--json]',
    summary: 'Create a new user skin; it is not activated automatically',
    input: '{ "name": string, "content": SkinContent }',
    appliesTo: 'settings'
  },
  {
    id: 'skin.update',
    usage: 'cliloom skin update <skin-id> (--stdin | --file <relative-path>) [--json]',
    summary: 'Replace the content of one user skin; id and name are preserved',
    input: 'Complete SkinContent object',
    appliesTo: 'settings'
  },
  {
    id: 'skin.duplicate',
    usage: 'cliloom skin duplicate <skin-id> [--json]',
    summary: 'Duplicate a builtin or user skin into a new user skin',
    appliesTo: 'settings'
  },
  {
    id: 'skin.rename',
    usage: 'cliloom skin rename <skin-id> <name> [--json]',
    summary: 'Rename one user skin',
    appliesTo: 'settings'
  },
  {
    id: 'skin.delete',
    usage: 'cliloom skin delete <skin-id> [--json]',
    summary: 'Delete one user skin; deleting the active skin falls back to the default builtin skin',
    appliesTo: 'settings'
  },
  {
    id: 'skin.import',
    usage: 'cliloom skin import (--stdin | --file <relative-path>) [--json]',
    summary: 'Import a cliloom-skin export (v1/v2) as a new user skin',
    input: 'cliloom-skin export JSON',
    appliesTo: 'settings'
  },
  {
    id: 'skin.export',
    usage: 'cliloom skin export <skin-id> [--json]',
    summary: 'Print a cliloom-skin v2 export document for any skin',
    appliesTo: 'read-only'
  },
  {
    id: 'skin.fonts',
    usage: 'cliloom skin fonts [--json]',
    summary: 'List installed font family names usable for skin typography',
    appliesTo: 'read-only'
  }
]

export function buildAssistantHelpText(notes: readonly string[] = []): string {
  return [
    'CLILoom assistant command',
    '',
    'Usage:',
    ...ASSISTANT_COMMAND_DESCRIPTORS.map((descriptor) => `  ${descriptor.usage}`),
    ...(notes.length > 0 ? ['', ...notes.map((note) => `  ${note}`)] : [])
  ].join('\n')
}

export function getAssistantCommandDescriptor(id: string): AssistantCommandDescriptor | undefined {
  return ASSISTANT_COMMAND_DESCRIPTORS.find((descriptor) => descriptor.id === id)
}

// ---------------------------------------------------------------------------
// Workflow schema description
// ---------------------------------------------------------------------------

export const WORKFLOW_NODE_TYPES = [
  'start',
  'interactive-terminal',
  'non-interactive-terminal',
  'input',
  'exclusive-gateway',
  'parallel-gateway',
  'end'
] as const

/**
 * Field-value examples for nodes[].config.autoRetry. These are values of the
 * autoRetry field, not complete workflows; the adjacent test enforces that the
 * shared parser accepts each of them.
 */
export const TERMINAL_AUTO_RETRY_CONFIG_EXAMPLES = {
  recommendedFinite: { enabled: true, mode: 'recommended', maxRetries: 5 },
  recommendedDefault: { enabled: true, mode: 'recommended' },
  cronFinite: { enabled: true, mode: 'cron', cron: '*/15 * * * *', maxRetries: 4 },
  cronUnlimited: { enabled: true, mode: 'cron', cron: '*/15 * * * *', maxRetries: null },
  disabledKeepsStrategy: { enabled: false, mode: 'cron', cron: '*/5 * * *', maxRetries: 5 },
  clear: null
} as const

/**
 * Complete workflow definitions. Every example must pass
 * parseWorkflowDefinition; the adjacent test enforces this. None of them may
 * contain comments, ellipses, or a workflow-get response wrapper.
 */
export const WORKFLOW_SCHEMA_EXAMPLES = {
  minimal: {
    id: 'example-minimal',
    name: 'Minimal example',
    nodes: [
      { id: 'start', type: 'start', name: 'Start', config: { variables: [] } },
      {
        id: 'cmd',
        type: 'non-interactive-terminal',
        name: 'Run once',
        config: {
          command: 'echo hello',
          cwd: '${sys_project_dir}',
          successExitCodes: [0]
        }
      },
      { id: 'end', type: 'end', name: 'End', config: {} }
    ],
    edges: [
      { id: 'start-cmd', from: 'start', to: 'cmd' },
      { id: 'cmd-end', from: 'cmd', to: 'end' }
    ]
  },
  terminalAutoRetry: {
    id: 'example-auto-retry',
    name: 'Terminal auto-retry example',
    nodes: [
      { id: 'start', type: 'start', name: 'Start', config: { variables: [] } },
      {
        id: 'watch',
        type: 'interactive-terminal',
        name: 'Watch service',
        config: {
          command: 'watch logs',
          retryCommand: 'watch logs --from-start',
          cwd: '${sys_project_dir}',
          autoStart: false,
          autoRetry: { enabled: true, mode: 'recommended', maxRetries: 5 }
        }
      },
      {
        id: 'sync',
        type: 'non-interactive-terminal',
        name: 'Nightly sync',
        config: {
          command: 'sync-data',
          cwd: '${sys_project_dir}',
          timeoutMs: 60000,
          successExitCodes: [0],
          autoRetry: { enabled: true, mode: 'cron', cron: '*/15 * * * *', maxRetries: null }
        }
      },
      {
        id: 'notify',
        type: 'non-interactive-terminal',
        name: 'Notify',
        config: {
          command: 'notify-done',
          cwd: '${sys_project_dir}',
          successExitCodes: [0],
          autoRetry: { enabled: true, mode: 'recommended' }
        }
      },
      { id: 'end', type: 'end', name: 'End', config: {} }
    ],
    edges: [
      { id: 'start-watch', from: 'start', to: 'watch' },
      { id: 'watch-sync', from: 'watch', to: 'sync' },
      { id: 'sync-notify', from: 'sync', to: 'notify' },
      { id: 'notify-end', from: 'notify', to: 'end' }
    ]
  },
  disabledKeepsStrategy: {
    id: 'example-auto-retry-disabled',
    name: 'Disabled auto-retry with kept strategy',
    nodes: [
      { id: 'start', type: 'start', name: 'Start', config: { variables: [] } },
      {
        id: 'watch',
        type: 'interactive-terminal',
        name: 'Watch service',
        config: {
          command: 'watch logs',
          cwd: '${sys_project_dir}',
          autoStart: false,
          autoRetry: { enabled: false, mode: 'cron', cron: '*/15 * * *', maxRetries: 5 }
        }
      },
      { id: 'end', type: 'end', name: 'End', config: {} }
    ],
    edges: [
      { id: 'start-watch', from: 'start', to: 'watch' },
      { id: 'watch-end', from: 'watch', to: 'end' }
    ]
  },
  removedByNull: {
    id: 'example-auto-retry-removed-null',
    name: 'Auto-retry removed via field null',
    nodes: [
      { id: 'start', type: 'start', name: 'Start', config: { variables: [] } },
      {
        id: 'watch',
        type: 'interactive-terminal',
        name: 'Watch service',
        config: {
          command: 'watch logs',
          cwd: '${sys_project_dir}',
          autoStart: false,
          autoRetry: null
        }
      },
      { id: 'end', type: 'end', name: 'End', config: {} }
    ],
    edges: [
      { id: 'start-watch', from: 'start', to: 'watch' },
      { id: 'watch-end', from: 'watch', to: 'end' }
    ]
  },
  removedByOmission: {
    id: 'example-auto-retry-removed-omission',
    name: 'Auto-retry removed via field omission',
    nodes: [
      { id: 'start', type: 'start', name: 'Start', config: { variables: [] } },
      {
        id: 'watch',
        type: 'interactive-terminal',
        name: 'Watch service',
        config: {
          command: 'watch logs',
          cwd: '${sys_project_dir}',
          autoStart: false
        }
      },
      { id: 'end', type: 'end', name: 'End', config: {} }
    ],
    edges: [
      { id: 'start-watch', from: 'start', to: 'watch' },
      { id: 'watch-end', from: 'watch', to: 'end' }
    ]
  },
  allNodeTypes: {
    id: 'example-all-node-types',
    name: 'All node types example',
    nodes: [
      {
        id: 'start',
        type: 'start',
        name: 'Start',
        config: {
          variables: [
            { key: 'environment', label: 'Environment', type: 'text', required: true, order: 1, defaultValue: 'staging', options: ['staging', 'production'] }
          ]
        }
      },
      {
        id: 'confirm',
        type: 'input',
        name: 'Confirm',
        config: {
          variables: [
            { key: 'approved', label: 'Approved', type: 'text', required: false, order: 1 }
          ]
        }
      },
      {
        id: 'prepare',
        type: 'interactive-terminal',
        name: 'Prepare',
        startHook: {
          enabled: true,
          command: 'prepare-workspace ${environment}',
          cwd: '${sys_project_dir}',
          env: { CLILOOM_EXAMPLE: '1' },
          failPolicy: 'continue'
        },
        config: {
          command: 'prepare-workspace ${environment}',
          cwd: '${sys_project_dir}',
          env: { CLILOOM_EXAMPLE: '1' },
          autoStart: true
        }
      },
      {
        id: 'build',
        type: 'non-interactive-terminal',
        name: 'Build',
        endHook: {
          enabled: false,
          command: '',
          failPolicy: 'fail-node'
        },
        config: {
          command: 'build --env ${environment}',
          retryCommand: 'build --env ${environment} --retry',
          cwd: '${sys_project_dir}',
          timeoutMs: 300000,
          successExitCodes: [0],
          autoRetry: { enabled: true, mode: 'recommended', maxRetries: 3 }
        }
      },
      {
        id: 'gate',
        type: 'exclusive-gateway',
        name: 'Deploy gate',
        config: { defaultEdgeId: 'gate-end' }
      },
      {
        id: 'fanout',
        type: 'parallel-gateway',
        name: 'Parallel split',
        config: { mode: 'split' }
      },
      {
        id: 'fanin',
        type: 'parallel-gateway',
        name: 'Parallel join',
        config: { mode: 'join', joinIncomingEdgeIds: ['branch-a', 'branch-b'] }
      },
      {
        id: 'verify',
        type: 'non-interactive-terminal',
        name: 'Verify',
        config: {
          command: 'verify-deployment',
          cwd: '${sys_project_dir}',
          successExitCodes: [0]
        }
      },
      { id: 'end', type: 'end', name: 'End', config: {} }
    ],
    edges: [
      { id: 'start-confirm', from: 'start', to: 'confirm' },
      { id: 'confirm-prepare', from: 'confirm', to: 'prepare' },
      { id: 'prepare-build', from: 'prepare', to: 'build' },
      { id: 'build-gate', from: 'build', to: 'gate' },
      { id: 'gate-fanout', from: 'gate', to: 'fanout', condition: 'environment == "production"' },
      { id: 'gate-end', from: 'gate', to: 'end', isDefault: true },
      { id: 'branch-a', from: 'fanout', to: 'fanin' },
      { id: 'branch-b', from: 'fanout', to: 'fanin' },
      { id: 'fanin-verify', from: 'fanin', to: 'verify' },
      { id: 'verify-end', from: 'verify', to: 'end' }
    ],
    layout: {
      nodes: {
        start: { x: 0, y: 0 },
        confirm: { x: 200, y: 0 },
        prepare: { x: 400, y: 0 },
        build: { x: 600, y: 0 },
        gate: { x: 800, y: 0 },
        fanout: { x: 1000, y: 0 },
        fanin: { x: 1200, y: 0 },
        verify: { x: 1400, y: 0 },
        end: { x: 1600, y: 0 }
      }
    }
  }
} as const

// ---------------------------------------------------------------------------
// Complete workflow save documentation
// ---------------------------------------------------------------------------

export type WorkflowSchemaFieldDocs = Record<string, string>

export type WorkflowSchemaDocument = {
  schemaVersion: number
  save: {
    usage: string
    input: string
    create: string
    update: string
    readback: string
    semantics: string[]
  }
  workflow: WorkflowSchemaFieldDocs
  node: WorkflowSchemaFieldDocs
  nodeConfigs: Record<NodeType, WorkflowSchemaFieldDocs>
  variables: WorkflowSchemaFieldDocs
  hooks: WorkflowSchemaFieldDocs
  edges: WorkflowSchemaFieldDocs
  layout: WorkflowSchemaFieldDocs
  terminalAutoRetry: {
    appliesTo: string[]
    storage: string
    saveCommand: string
    fields: WorkflowSchemaFieldDocs
    recommendedDelays: string
    semantics: string[]
    saveRules: string[]
    examples: Record<string, unknown>
  }
  systemVariables: WorkflowSchemaFieldDocs
  examples: Record<string, unknown>
  notes: string[]
}

function schemaKey(path: string): TranslationKey {
  return `assistant:workflowSchema.${path}` as TranslationKey
}

function translateFields(
  translate: Translator,
  section: string,
  fields: readonly string[],
  params?: Record<string, unknown>
): WorkflowSchemaFieldDocs {
  return Object.fromEntries(
    fields.map((field) => [field, translate(schemaKey(`${section}.${field}`), params)])
  )
}

function translateList(
  translate: Translator,
  section: string,
  entries: readonly string[],
  params?: Record<string, unknown>
): string[] {
  return entries.map((entry) => translate(schemaKey(`${section}.${entry}`), params))
}

const RECOMMENDED_DELAY_PREFIX = RECOMMENDED_RETRY_DELAYS_MINUTES
  .slice(0, -1)
  .join(', ')
const RECOMMENDED_DELAY_TAIL = String(
  RECOMMENDED_RETRY_DELAYS_MINUTES[RECOMMENDED_RETRY_DELAYS_MINUTES.length - 1]
)

export function buildWorkflowSchema(translate: Translator): WorkflowSchemaDocument {
  const terminalShared = translateFields(
    translate,
    'terminalShared',
    ['command', 'retryCommand', 'cwd', 'env', 'autoRetry'],
    { maxString: MAX_WORKFLOW_STRING }
  )
  const variablesField = translate(schemaKey('variables.variables'))
  return {
    schemaVersion: ASSISTANT_CAPABILITY_SCHEMA_VERSION,
    save: {
      usage: translate(schemaKey('save.usage')),
      input: translate(schemaKey('save.input')),
      create: translate(schemaKey('save.create')),
      update: translate(schemaKey('save.update')),
      readback: translate(schemaKey('save.readback')),
      semantics: translateList(translate, 'save.semantics', [
        'fullReplacement',
        'revisionOption',
        'validateBoundary',
        'noExecution',
        'dirtyDesigner',
        'sizeLimits',
        'partialInput',
        'transportFailure'
      ])
    },
    workflow: translateFields(translate, 'workflow', ['id', 'name', 'description', 'nodes', 'edges', 'layout'], {
      maxNodes: MAX_WORKFLOW_NODES,
      maxEdges: MAX_WORKFLOW_EDGES,
      maxString: MAX_WORKFLOW_STRING
    }),
    node: translateFields(translate, 'node', ['id', 'type', 'name', 'config', 'startHook', 'endHook'], {
      maxString: MAX_WORKFLOW_STRING
    }),
    nodeConfigs: {
      start: { variables: variablesField },
      'interactive-terminal': {
        ...terminalShared,
        ...translateFields(translate, 'interactive', ['shell', 'autoStart'])
      },
      'non-interactive-terminal': {
        ...terminalShared,
        ...translateFields(translate, 'nonInteractive', ['timeoutMs', 'successExitCodes'])
      },
      input: { variables: variablesField },
      'exclusive-gateway': translateFields(translate, 'gatewayExclusive', ['defaultEdgeId']),
      'parallel-gateway': translateFields(translate, 'gatewayParallel', ['mode', 'joinIncomingEdgeIds'], {
        maxEdges: MAX_WORKFLOW_EDGES
      }),
      end: translateFields(translate, 'endConfig', ['config'])
    },
    variables: {
      variables: variablesField,
      ...translateFields(
        translate,
        'variables',
        ['key', 'label', 'type', 'required', 'order', 'defaultValue', 'options'],
        { maxString: MAX_WORKFLOW_STRING }
      )
    },
    hooks: translateFields(translate, 'hooks', ['enabled', 'command', 'cwd', 'env', 'failPolicy', 'absence'], {
      maxString: MAX_WORKFLOW_STRING
    }),
    edges: translateFields(translate, 'edges', ['id', 'from', 'to', 'condition', 'isDefault', 'expression'], {
      maxString: MAX_WORKFLOW_STRING
    }),
    layout: translateFields(translate, 'layout', ['nodes', 'x', 'y'], {
      maxNodes: MAX_WORKFLOW_NODES
    }),
    terminalAutoRetry: {
      appliesTo: ['interactive-terminal', 'non-interactive-terminal'],
      storage: translate(schemaKey('autoRetry.storage')),
      saveCommand: translate(schemaKey('autoRetry.saveCommand')),
      fields: translateFields(translate, 'autoRetry.fields', ['enabled', 'mode', 'maxRetries', 'cron'], {
        min: AUTO_RETRY_MIN_MAX_RETRIES,
        max: AUTO_RETRY_MAX_MAX_RETRIES,
        default: AUTO_RETRY_DEFAULT_MAX_RETRIES,
        limit: AUTO_RETRY_CRON_MAX_LENGTH
      }),
      recommendedDelays: translate(schemaKey('autoRetry.recommendedDelays'), {
        delays: RECOMMENDED_DELAY_PREFIX,
        later: RECOMMENDED_DELAY_TAIL
      }),
      semantics: translateList(translate, 'autoRetry.semantics', [
        'countOnly',
        'cronCalendar',
        'cronLimits',
        'cronDraft',
        'timezone',
        'retryCommand',
        'failureScope',
        'persistence'
      ]),
      saveRules: translateList(translate, 'autoRetry.saveRules', [
        'fullReplace',
        'removal',
        'disabledKeeps',
        'unknownKeys'
      ]),
      examples: TERMINAL_AUTO_RETRY_CONFIG_EXAMPLES
    },
    systemVariables: Object.fromEntries(
      SYSTEM_VARIABLES.map((name) => [name, translate(SYSTEM_VARIABLE_DESCRIPTIONS[name])])
    ),
    examples: WORKFLOW_SCHEMA_EXAMPLES,
    notes: translateList(translate, 'notes', [
      'graph',
      'noGlobalGuarantees',
      'normalization',
      'templates',
      'systemVariables',
      'shellLegacy',
      'revisionHint',
      'validateHint',
      'exampleFileUsage'
    ])
  }
}

/**
 * Render the complete workflow save documentation as plain text from the same
 * schema data returned by buildWorkflowSchema. This is the full document, not
 * a summary: every section and every complete JSON example is included.
 */
export function renderWorkflowSchemaText(
  schema: WorkflowSchemaDocument,
  translate: Translator
): string {
  const lines: string[] = [
    translate(schemaKey('title'), { version: schema.schemaVersion }),
    ''
  ]
  const section = (title: string, fields: WorkflowSchemaFieldDocs): void => {
    lines.push(title, ...Object.entries(fields).map(([field, description]) => `  ${field}: ${description}`), '')
  }
  const bulletList = (title: string, entries: readonly string[]): void => {
    lines.push(title, ...entries.map((entry) => `  - ${entry}`), '')
  }
  const jsonBlock = (name: string, value: unknown, label?: string): void => {
    lines.push(`  ${name}${label ? ` (${label})` : ''}:`)
    for (const line of JSON.stringify(value, null, 2).split('\n')) lines.push(`    ${line}`)
  }

  lines.push(translate(schemaKey('saveTitle')), '')
  lines.push(`  usage: ${schema.save.usage}`)
  lines.push(`  input: ${schema.save.input}`)
  lines.push(`  create: ${schema.save.create}`)
  lines.push(`  update: ${schema.save.update}`)
  lines.push(`  readback: ${schema.save.readback}`)
  bulletList(`  ${translate(schemaKey('saveSemanticsTitle'))}`, schema.save.semantics)

  section(translate(schemaKey('workflowTitle')), schema.workflow)
  section(translate(schemaKey('nodeTitle')), schema.node)

  lines.push(translate(schemaKey('nodeConfigsTitle')))
  for (const type of WORKFLOW_NODE_TYPES) {
    lines.push(`  ${type}:`)
    for (const [field, description] of Object.entries(schema.nodeConfigs[type])) {
      lines.push(`    ${field}: ${description}`)
    }
  }
  lines.push('')

  section(translate(schemaKey('variablesTitle')), schema.variables)
  section(translate(schemaKey('hooksTitle')), schema.hooks)
  section(translate(schemaKey('edgesTitle')), schema.edges)
  section(translate(schemaKey('layoutTitle')), schema.layout)

  lines.push(translate(schemaKey('autoRetryTitle')))
  lines.push(`  appliesTo: ${schema.terminalAutoRetry.appliesTo.join(', ')}`)
  lines.push(`  storage: ${schema.terminalAutoRetry.storage}`)
  lines.push(`  saveCommand: ${schema.terminalAutoRetry.saveCommand}`)
  lines.push(`  recommendedDelays: ${schema.terminalAutoRetry.recommendedDelays}`)
  lines.push(`  ${translate(schemaKey('autoRetryFieldsTitle'))}`)
  for (const [field, description] of Object.entries(schema.terminalAutoRetry.fields)) {
    lines.push(`    ${field}: ${description}`)
  }
  bulletList(`  ${translate(schemaKey('autoRetrySemanticsTitle'))}`, schema.terminalAutoRetry.semantics)
  bulletList(`  ${translate(schemaKey('autoRetrySaveRulesTitle'))}`, schema.terminalAutoRetry.saveRules)
  lines.push(`  ${translate(schemaKey('autoRetryExamplesTitle'))}`)
  for (const [name, value] of Object.entries(schema.terminalAutoRetry.examples)) {
    jsonBlock(name, value)
  }
  lines.push('')

  section(translate(schemaKey('systemVariablesTitle')), schema.systemVariables)

  lines.push(translate(schemaKey('examplesTitle')))
  for (const [name, value] of Object.entries(schema.examples)) {
    jsonBlock(name, value)
  }
  lines.push('')

  bulletList(translate(schemaKey('notesTitle')), schema.notes)
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Compact summaries embedded in `cliloom context`
// ---------------------------------------------------------------------------

export const CONTEXT_CAPABILITY_SUMMARIES = [
  'read and validate workflows',
  'create or revision-safe update workflows',
  'set project default workflows',
  'read and update public settings',
  'read the complete workflow save documentation (workflow schema)',
  'configure terminal node automatic retry by editing nodes[].config.autoRetry through workflow get/save',
  'list, refresh, and select the global shell (shell list/refresh/select)',
  'manage user skins: list, get, create, update, duplicate, rename, delete, import, export, fonts',
  'read and set the project rail and task sidebar widths (layout.projectRailWidth, layout.taskSidebarWidth)'
] as const

export const CONTEXT_WORKFLOW_SCHEMA_NOTES = [
  'A workflow is saved as one complete definition: id, name, optional description, nodes, edges, and optional layout.',
  'Exactly one start node is required. Node ids, edge ids, and references are validated on save.',
  'The revision read at workflow get must be passed to workflow save via --expected-revision; save replaces the whole definition.',
  'Run `cliloom workflow schema` (or `cliloom workflow schema --json`) for the complete field-level save documentation, auto-retry rules, and valid examples.'
] as const

export const CONTEXT_TERMINAL_AUTO_RETRY_SUMMARY = {
  editVia: 'cliloom workflow get <workflow-id> --json, edit nodes[].config.autoRetry in the workflow object, then cliloom workflow save with --expected-revision',
  storage: 'nodes[].config.autoRetry on interactive-terminal and non-interactive-terminal nodes',
  modes: ['recommended', 'cron'],
  defaultMaxRetries: AUTO_RETRY_DEFAULT_MAX_RETRIES,
  maxRetriesRange: [AUTO_RETRY_MIN_MAX_RETRIES, AUTO_RETRY_MAX_MAX_RETRIES],
  recommendedDelaysMinutes: RECOMMENDED_RETRY_DELAYS_MINUTES,
  schemaCommand: 'cliloom workflow schema --json',
  appliesTo: 'future-workflow-runs'
} as const

export const CONTEXT_SHELL_SUMMARY_NOTES = [
  'Use shell list/refresh to enumerate detected candidates, then shell select <automatic|candidate-id>.',
  'The selection applies to new workflows and the next assistant session; running tasks and history keep their snapshots.'
] as const

export const CONTEXT_SKIN_SUMMARY = {
  listCommand: 'cliloom skin list',
  detailCommand: 'cliloom skin get <skin-id>',
  fontsCommand: 'cliloom skin fonts',
  builtinSkinsAreImmutable: 'duplicate a builtin skin before modifying it',
  numericFieldsAreNormalized: `fontSize ${SKIN_BOUNDS.fontSizeMin}-${SKIN_BOUNDS.fontSizeMax}, lineHeight ${SKIN_BOUNDS.lineHeightMin}-${SKIN_BOUNDS.lineHeightMax}, radius ${SKIN_BOUNDS.radiusMin}-${SKIN_BOUNDS.radiusMax}, spacingScale ${SKIN_BOUNDS.spacingMin}-${SKIN_BOUNDS.spacingMax}, gradient angle ${SKIN_BOUNDS.angleMin}-${SKIN_BOUNDS.angleMax}`,
  createInput: '{ "name": string, "content": SkinContent }',
  updateInput: 'complete SkinContent',
  appliesTo: 'settings'
} as const

export const CONTEXT_LAYOUT_SUMMARY = {
  keys: ['layout.projectRailWidth', 'layout.taskSidebarWidth'],
  projectRailWidthRange: [LAYOUT_BOUNDS.projectRailWidthMin, LAYOUT_BOUNDS.projectRailWidthMax],
  taskSidebarWidthRange: [LAYOUT_BOUNDS.taskSidebarWidthMin, LAYOUT_BOUNDS.taskSidebarWidthMax],
  appliesTo: 'immediate'
} as const
