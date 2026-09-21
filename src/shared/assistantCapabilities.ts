import {
  AUTO_RETRY_CRON_MAX_LENGTH,
  AUTO_RETRY_DEFAULT_MAX_RETRIES,
  AUTO_RETRY_MAX_MAX_RETRIES,
  AUTO_RETRY_MIN_MAX_RETRIES,
  RECOMMENDED_RETRY_DELAYS_MINUTES
} from './terminalAutoRetry'
import { SKIN_BOUNDS } from './skin'
import { LAYOUT_BOUNDS } from './appSettings'

/**
 * Descriptive capability catalog for the cliloom assistant CLI. This module is
 * pure data: it must not depend on Electron, the browser, the filesystem, or
 * main-process objects. Final validation always happens in the existing
 * business parsers; nothing here is a JSON Schema validator.
 */

export const ASSISTANT_CAPABILITY_SCHEMA_VERSION = 1

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
    summary: 'Detailed field-level workflow schema, node configs, hooks, auto-retry rules, and valid examples',
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
    summary: 'Create or revision-checked update of a full workflow definition',
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
    id: 'workflow.auto-retry.get',
    usage: 'cliloom workflow auto-retry get <workflow-id> <node-id> [--json]',
    summary: 'Read the saved autoRetry configuration of one terminal node (null means not configured and disabled)',
    appliesTo: 'read-only'
  },
  {
    id: 'workflow.auto-retry.set',
    usage: 'cliloom workflow auto-retry set <workflow-id> <node-id> (--stdin | --file <relative-path>) --expected-revision <revision> [--json]',
    summary: 'Replace or remove the autoRetry configuration of one terminal node',
    input: 'Complete autoRetry object or JSON null',
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

export function buildAssistantHelpText(): string {
  return [
    'CLILoom assistant command',
    '',
    'Usage:',
    ...ASSISTANT_COMMAND_DESCRIPTORS.map((descriptor) => `  ${descriptor.usage}`)
  ].join('\n')
}

export function getAssistantCommandDescriptor(id: string): AssistantCommandDescriptor | undefined {
  return ASSISTANT_COMMAND_DESCRIPTORS.find((descriptor) => descriptor.id === id)
}

// ---------------------------------------------------------------------------
// Workflow schema description
// ---------------------------------------------------------------------------

export const AUTO_RETRY_RECOMMENDED_DELAYS_LABEL = [
  ...RECOMMENDED_RETRY_DELAYS_MINUTES.slice(0, -1),
  `then ${RECOMMENDED_RETRY_DELAYS_MINUTES[RECOMMENDED_RETRY_DELAYS_MINUTES.length - 1]} minutes for every later attempt`
].join(', ')

export const TERMINAL_AUTO_RETRY_SCHEMA = {
  appliesTo: [
    'interactive-terminal',
    'non-interactive-terminal'
  ],
  storage: 'config.autoRetry on the node; absence means the feature is off with no persisted state',
  setCommand: 'cliloom workflow auto-retry set <workflow-id> <node-id> --stdin --expected-revision <revision>',
  fields: {
    enabled: `boolean, required; false keeps the strategy fields for later re-enable but stops retrying`,
    mode: `'recommended' (fixed backoff delays) or 'cron' (calendar schedule), required`,
    maxRetries: `integer ${AUTO_RETRY_MIN_MAX_RETRIES}-${AUTO_RETRY_MAX_MAX_RETRIES}, null for unlimited; omitted defaults to ${AUTO_RETRY_DEFAULT_MAX_RETRIES}`,
    cron: `required for cron mode: five-field cron (minute hour day month weekday); at most ${AUTO_RETRY_CRON_MAX_LENGTH} characters`
  },
  recommendedDelays: AUTO_RETRY_RECOMMENDED_DELAYS_LABEL,
  semantics: [
    `maxRetries counts automatic retries only; the first execution and manual retries do not consume attempts, and a manual retry starts a fresh cycle`,
    'recommended mode waits from the moment of failure: ' + AUTO_RETRY_RECOMMENDED_DELAYS_LABEL + ' (minutes)',
    'cron mode retries at the next calendar match after the failure, not after a fixed delay',
    'when both day-of-month and weekday are restricted, cron uses the classic Unix any-match semantics',
    'six-field seconds, @macros, names, and Quartz extensions are not accepted',
    'the time zone comes from the system IANA zone captured when the task starts; there is no timezone field',
    'whether hook failures, user stops, or interruptions trigger a retry follows the existing runtime rules',
    'enabled cron configurations must have a computable future trigger time; disabled ones may keep an unfinished draft',
    'changing the workflow does not cancel existing waiting plans, reset counters of running tasks, or rewrite history'
  ],
  setRules: [
    'the set command replaces the whole autoRetry object; get first, then submit the merged object',
    'top-level JSON null removes config.autoRetry and restores the not-configured state',
    'unknown fields (including cron in recommended mode) are rejected',
    'saving requires the workflow revision returned by get; the designer must not hold unsaved edits for the same workflow'
  ],
  examples: {
    recommendedFinite: { enabled: true, mode: 'recommended', maxRetries: 5 },
    recommendedDefault: { enabled: true, mode: 'recommended' },
    cronFinite: { enabled: true, mode: 'cron', cron: '*/15 * * * *', maxRetries: 4 },
    cronUnlimited: { enabled: true, mode: 'cron', cron: '*/15 * * * *', maxRetries: null },
    disabledKeepsStrategy: { enabled: false, mode: 'cron', cron: '*/5 * * * *', maxRetries: 5 },
    clear: null
  }
} as const

/**
 * Minimal complete workflows. Every example must pass
 * parseWorkflowDefinition; the adjacent test enforces this.
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
          autoRetry: { enabled: true, mode: 'recommended', maxRetries: 10 }
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
      { id: 'end', type: 'end', name: 'End', config: {} }
    ],
    edges: [
      { id: 'start-watch', from: 'start', to: 'watch' },
      { id: 'watch-sync', from: 'watch', to: 'sync' },
      { id: 'sync-end', from: 'sync', to: 'end' }
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
      { id: 'gate-fanout', from: 'gate', to: 'fanout', condition: '${environment} == "production"' },
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

export const WORKFLOW_NODE_TYPES = [
  'start',
  'interactive-terminal',
  'non-interactive-terminal',
  'input',
  'exclusive-gateway',
  'parallel-gateway',
  'end'
] as const

export const WORKFLOW_SCHEMA_NOTES = [
  'A workflow has id, name, optional description, nodes, edges, and optional layout (nodes mapped to {x,y}).',
  'Exactly one start node is required. Node ids, edge ids, and references are validated on save.',
  'Start nodes need one outgoing edge and no incoming edge; end nodes have no outgoing edge; other node types need at least one incoming edge and exactly one outgoing edge (gateways may have more).',
  'Variables live on start/input nodes: key, label, type (text|number), required, optional order, defaultValue, and options.',
  'Hooks (startHook/endHook) are optional per node: enabled, command, optional cwd/env, and failPolicy (continue|fail-node).',
  'Both terminal types accept command, optional retryCommand, cwd, optional env, and optional autoRetry. Interactive terminals add autoStart; non-interactive terminals add optional timeoutMs and successExitCodes.',
  'Exclusive gateways route by edge condition with an optional defaultEdgeId; parallel gateways are split or join (join lists joinIncomingEdgeIds).',
  'The legacy per-node shell field is still parsed for compatibility but does not replace the global shell selection (shell select).',
  'Updates through workflow save must carry the revision read at workflow get; a valid configuration alone does not mean the command ran.',
  'Use cliloom workflow validate before save, and cliloom workflow auto-retry get/set for focused autoRetry edits.'
] as const

export function buildWorkflowSchema(): {
  schemaVersion: number
  workflow: Record<string, unknown>
  nodeConfigs: Record<string, unknown>
  hooks: Record<string, unknown>
  terminalAutoRetry: unknown
  examples: Record<string, unknown>
  notes: readonly string[]
} {
  return {
    schemaVersion: ASSISTANT_CAPABILITY_SCHEMA_VERSION,
    workflow: {
      id: 'string, 1-512 chars, no NUL; identifies the workflow',
      name: 'string, 1-512 chars',
      description: 'optional string',
      nodes: 'array of nodes (see nodeConfigs); unique ids',
      edges: 'array of { id, from, to, condition?, isDefault? } referencing existing nodes',
      layout: 'optional { nodes: { [nodeId]: { x, y } } }'
    },
    nodeConfigs: {
      start: {
        variables: 'VariableDefinition[] (may be empty)'
      },
      'interactive-terminal': {
        command: 'required string; supports ${variable} references',
        retryCommand: 'optional command template used for manual retries and automatic retries (falls back to command when absent)',
        cwd: 'required string, e.g. ${sys_project_dir}',
        env: 'optional record of string to string',
        shell: 'legacy compatibility field; prefer the global shell selection',
        autoStart: 'required boolean',
        autoRetry: 'optional terminal auto-retry configuration'
      },
      'non-interactive-terminal': {
        command: 'required string; supports ${variable} references',
        retryCommand: 'optional command template used for manual retries and automatic retries (falls back to command when absent)',
        cwd: 'required string',
        env: 'optional record of string to string',
        timeoutMs: 'optional integer 1-86400000',
        successExitCodes: 'required integer array (-255..255), e.g. [0]',
        autoRetry: 'optional terminal auto-retry configuration'
      },
      input: {
        variables: 'VariableDefinition[] (may be empty)'
      },
      'exclusive-gateway': {
        defaultEdgeId: 'optional id of one outgoing edge used when no condition matches'
      },
      'parallel-gateway': {
        mode: "'split' or 'join'",
        joinIncomingEdgeIds: 'for join: ids of the incoming edges to wait for (required, unique, targeting this node)'
      },
      end: {}
    },
    hooks: {
      location: 'optional startHook/endHook on any node',
      enabled: 'boolean',
      command: 'string (may be empty)',
      cwd: 'optional string',
      env: 'optional record of string to string',
      failPolicy: "'continue' or 'fail-node'"
    },
    terminalAutoRetry: TERMINAL_AUTO_RETRY_SCHEMA,
    examples: WORKFLOW_SCHEMA_EXAMPLES,
    notes: WORKFLOW_SCHEMA_NOTES
  }
}

// ---------------------------------------------------------------------------
// Compact summaries embedded in `cliloom context`
// ---------------------------------------------------------------------------

export const CONTEXT_CAPABILITY_SUMMARIES = [
  'read and validate workflows',
  'create or revision-safe update workflows',
  'set project default workflows',
  'read and update public settings',
  'read the detailed workflow schema (workflow schema)',
  'read and change terminal node automatic retry (workflow auto-retry get/set)',
  'list, refresh, and select the global shell (shell list/refresh/select)',
  'manage user skins: list, get, create, update, duplicate, rename, delete, import, export, fonts',
  'read and set the project rail and task sidebar widths (layout.projectRailWidth, layout.taskSidebarWidth)'
] as const

export const CONTEXT_WORKFLOW_SCHEMA_NOTES = [
  ...WORKFLOW_SCHEMA_NOTES.slice(0, 3),
  'Run `cliloom workflow schema --json` for the full field-level schema, auto-retry rules, and valid examples.'
] as const

export const CONTEXT_TERMINAL_AUTO_RETRY_SUMMARY = {
  command: 'cliloom workflow auto-retry get/set <workflow-id> <node-id>',
  modes: ['recommended', 'cron'],
  defaultMaxRetries: AUTO_RETRY_DEFAULT_MAX_RETRIES,
  maxRetriesRange: [AUTO_RETRY_MIN_MAX_RETRIES, AUTO_RETRY_MAX_MAX_RETRIES],
  recommendedDelaysMinutes: RECOMMENDED_RETRY_DELAYS_MINUTES,
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
