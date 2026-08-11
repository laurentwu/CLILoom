import { describe, expect, it } from 'vitest'
import { createI18n } from './i18n'
import {
  bindShellVariables,
  duplicateWorkflowDefinition,
  getAvailableUserVariables,
  getSystemVariables,
  interpolate,
  parseWorkflowDefinition,
  sortVariableDefinitions,
  SYSTEM_VARIABLES,
  SYSTEM_VARIABLE_DESCRIPTIONS,
  validateUserVariableKey,
  validateVariableDefinitions,
  validateWorkflow
} from './workflow'
import type { WorkflowDefinition, WorkflowEdge, WorkflowNode } from './workflow'

describe('variable rules', () => {
  it('rejects user variables with sys_ prefix', () => {
    expect(validateUserVariableKey('sys_project_dir')).toEqual({
      key: 'errors:workflowValidation.variableKeySysPrefix'
    })
    expect(validateUserVariableKey('sys_worktree_dir')).toEqual({
      key: 'errors:workflowValidation.variableKeySysPrefix'
    })
    expect(validateUserVariableKey('prompt')).toBeNull()
  })

  it('rejects duplicate and invalid variables', () => {
    expect(
      validateVariableDefinitions([
        { key: 'prompt', label: 'Prompt', type: 'text', required: true },
        { key: 'prompt', label: 'Prompt again', type: 'text', required: false },
        { key: 'sys_bad', label: 'Bad', type: 'text', required: false }
      ])
    ).toEqual([
      { key: 'errors:workflowValidation.variableKeyDuplicate', params: { key: 'prompt' } },
      { key: 'errors:workflowValidation.variableKeySysPrefix' }
    ])
  })

  it('sorts variables by explicit order while preserving ties and unset items', () => {
    const variables = [
      { key: 'unset_a', label: 'Unset A', type: 'text' as const, required: false },
      { key: 'third', label: 'Third', type: 'text' as const, required: false, order: 3 },
      { key: 'first_a', label: 'First A', type: 'text' as const, required: false, order: 1 },
      { key: 'first_b', label: 'First B', type: 'text' as const, required: false, order: 1 },
      { key: 'unset_b', label: 'Unset B', type: 'text' as const, required: false }
    ]

    expect(sortVariableDefinitions(variables).map((variable) => variable.key)).toEqual([
      'first_a',
      'first_b',
      'third',
      'unset_a',
      'unset_b'
    ])
    expect(variables.map((variable) => variable.key)).toEqual([
      'unset_a',
      'third',
      'first_a',
      'first_b',
      'unset_b'
    ])
  })

  it('rejects non-positive and fractional variable orders', () => {
    expect(
      validateVariableDefinitions([
        { key: 'zero', label: 'Zero', type: 'text', required: false, order: 0 },
        { key: 'fraction', label: 'Fraction', type: 'text', required: false, order: 1.5 }
      ])
    ).toEqual([
      { key: 'errors:workflowValidation.variableOrderInvalid', params: { label: 'Zero' } },
      { key: 'errors:workflowValidation.variableOrderInvalid', params: { label: 'Fraction' } }
    ])
  })

  it('injects sys_ variables and interpolates values', () => {
    const sys = getSystemVariables({
      taskId: 'task-1',
      projectDir: '/repo',
      workflowId: 'wf',
      currentNodeId: 'node-1',
      lastNodeId: 'node-0',
      lastCommand: { stdout: 'ok', stderr: '', exitCode: 0 }
    })

    expect(Object.keys(sys).every((key) => key.startsWith('sys_'))).toBe(true)
    expect(interpolate('cd ${sys_project_dir}/.cliloom-worktrees/${sys_task_id} && echo ${prompt}', { ...sys, prompt: 'hello' })).toBe(
      'cd /repo/.cliloom-worktrees/task-1 && echo hello'
    )
    expect(sys).not.toHaveProperty('sys_worktree_dir')
    expect(sys).not.toHaveProperty('sys_plan_path')
  })

  it('binds shell variables through an isolated environment without embedding values', () => {
    const prompt = '`codex` $(printf injected) "$HOME" \'quoted\'\nnext line'
    const bound = bindShellVariables(
      'codex --yolo "${prompt}" && printf "%s:%s" "${prompt}" "${missing}"',
      { prompt }
    )

    expect(bound).toEqual({
      command:
        'codex --yolo "${CLILOOM_INTERNAL_VALUE_0}" && printf "%s:%s" "${CLILOOM_INTERNAL_VALUE_0}" "${CLILOOM_INTERNAL_VALUE_1}"',
      env: {
        CLILOOM_INTERNAL_VALUE_0: prompt,
        CLILOOM_INTERNAL_VALUE_1: ''
      }
    })
    expect(bound.command).not.toContain(prompt)
  })

  it('rejects NUL characters in interpolated and shell-bound variables', () => {
    expect(() => interpolate('${prompt}', { prompt: 'before\0after' })).toThrow(
      'Workflow variables must not contain a NUL character'
    )
    expect(() => bindShellVariables('echo "${prompt}"', { prompt: 'before\0after' })).toThrow(
      'Workflow variables must not contain a NUL character'
    )
  })
})

describe('workflow duplication', () => {
  it('creates an independent workflow and remaps every graph reference', () => {
    const source: WorkflowDefinition = {
      id: 'source-workflow',
      name: 'Source workflow',
      nodes: [
        {
          id: 'start',
          type: 'start',
          name: 'Start',
          config: {
            variables: [{ key: 'prompt', label: 'Prompt', type: 'text', required: true }]
          }
        },
        { id: 'split', type: 'parallel-gateway', name: 'Split', config: { mode: 'split' } },
        {
          id: 'left',
          type: 'non-interactive-terminal',
          name: 'Left',
          config: { command: 'echo left', cwd: '.', successExitCodes: [0] }
        },
        {
          id: 'right',
          type: 'non-interactive-terminal',
          name: 'Right',
          config: { command: 'echo right', cwd: '.', successExitCodes: [0] }
        },
        {
          id: 'join',
          type: 'parallel-gateway',
          name: 'Join',
          config: { mode: 'join', joinIncomingEdgeIds: ['left-join', 'right-join'] }
        },
        {
          id: 'review',
          type: 'input',
          name: 'Review',
          config: {
            variables: [{ key: 'feedback', label: 'Feedback', type: 'text', required: true }]
          }
        },
        {
          id: 'choice',
          type: 'exclusive-gateway',
          name: 'Choice',
          config: { defaultEdgeId: 'choice-review' }
        },
        { id: 'end', type: 'end', name: 'End', config: {} }
      ],
      edges: [
        { id: 'start-split', from: 'start', to: 'split' },
        { id: 'split-left', from: 'split', to: 'left' },
        { id: 'split-right', from: 'split', to: 'right' },
        { id: 'left-join', from: 'left', to: 'join' },
        { id: 'right-join', from: 'right', to: 'join' },
        { id: 'join-review', from: 'join', to: 'review' },
        { id: 'review-choice', from: 'review', to: 'choice' },
        { id: 'choice-end', from: 'choice', to: 'end', condition: 'feedback == "done"' },
        { id: 'choice-review', from: 'choice', to: 'review', isDefault: true }
      ],
      layout: { nodes: {} }
    }
    source.layout!.nodes = Object.fromEntries(
      source.nodes.map((node, index) => [node.id, { x: index * 10, y: index * 20 }])
    )
    let nextId = 0
    const duplicate = duplicateWorkflowDefinition(source, {
      name: 'Source workflow copy',
      createId: (kind) => `${kind}-copy-${nextId++}`
    })
    const nodeIds = new Map(
      source.nodes.map((node, index) => [node.id, duplicate.nodes[index].id])
    )
    const edgeIds = new Map(
      source.edges.map((edge, index) => [edge.id, duplicate.edges[index].id])
    )

    expect(duplicate.id).not.toBe(source.id)
    expect(duplicate.name).toBe('Source workflow copy')
    expect(duplicate.nodes.every((node) => !source.nodes.some((sourceNode) => sourceNode.id === node.id))).toBe(true)
    expect(duplicate.edges.every((edge) => !source.edges.some((sourceEdge) => sourceEdge.id === edge.id))).toBe(true)

    for (const [index, edge] of source.edges.entries()) {
      expect(duplicate.edges[index]).toEqual({
        ...edge,
        id: edgeIds.get(edge.id),
        from: nodeIds.get(edge.from),
        to: nodeIds.get(edge.to)
      })
    }

    for (const [index, node] of source.nodes.entries()) {
      const copiedNode = duplicate.nodes[index]
      if (node.type === 'exclusive-gateway' && 'defaultEdgeId' in node.config && node.config.defaultEdgeId) {
        expect('defaultEdgeId' in copiedNode.config ? copiedNode.config.defaultEdgeId : undefined)
          .toBe(edgeIds.get(node.config.defaultEdgeId))
      }
      if (node.type === 'parallel-gateway' && 'joinIncomingEdgeIds' in node.config && node.config.joinIncomingEdgeIds) {
        expect('joinIncomingEdgeIds' in copiedNode.config ? copiedNode.config.joinIncomingEdgeIds : undefined)
          .toEqual(node.config.joinIncomingEdgeIds.map((edgeId) => edgeIds.get(edgeId)))
      }
      expect(duplicate.layout?.nodes[copiedNode.id]).toEqual(source.layout?.nodes[node.id])
    }

    const duplicateStart = duplicate.nodes.find((node) => node.type === 'start')!
    const sourceStart = source.nodes.find((node) => node.type === 'start')!
    if ('variables' in duplicateStart.config && 'variables' in sourceStart.config) {
      duplicateStart.config.variables[0].label = 'Changed only in duplicate'
      expect(sourceStart.config.variables[0].label).not.toBe('Changed only in duplicate')
    }
    expect(validateWorkflow(duplicate)).toEqual([])
  })
})

describe('parallel gateway validation', () => {
  it('requires joinIncomingEdgeIds for join gateways', () => {
    const workflow: WorkflowDefinition = {
      id: 'wf-invalid-join',
      name: 'Invalid join',
      nodes: [
        { id: 'start', type: 'start', name: 'Start', config: { variables: [{ key: 'prompt', label: 'Prompt', type: 'text', required: true }] } },
        { id: 'split', type: 'parallel-gateway', name: 'Split', config: { mode: 'split' } },
        { id: 'a', type: 'non-interactive-terminal', name: 'A', config: { command: 'echo a', cwd: '${sys_project_dir}', successExitCodes: [0] } },
        { id: 'b', type: 'non-interactive-terminal', name: 'B', config: { command: 'echo b', cwd: '${sys_project_dir}', successExitCodes: [0] } },
        { id: 'join', type: 'parallel-gateway', name: 'Join', config: { mode: 'join' } },
        { id: 'end', type: 'end', name: 'End', config: {} }
      ],
      edges: [
        { id: 'e-start-split', from: 'start', to: 'split' },
        { id: 'e-split-a', from: 'split', to: 'a' },
        { id: 'e-split-b', from: 'split', to: 'b' },
        { id: 'e-a-join', from: 'a', to: 'join' },
        { id: 'e-b-join', from: 'b', to: 'join' },
        { id: 'e-join-end', from: 'join', to: 'end' }
      ]
    }

    expect(validateWorkflow(workflow).map((i) => i.key)).toContain('errors:workflowValidation.joinNeedsIncomingEdgeIds')
  })

  it('rejects joinIncomingEdgeIds that are not incoming edges to that join', () => {
    const workflow: WorkflowDefinition = {
      id: 'wf-wrong-join-edge',
      name: 'Wrong join edge',
      nodes: [
        { id: 'start', type: 'start', name: 'Start', config: { variables: [{ key: 'prompt', label: 'Prompt', type: 'text', required: true }] } },
        { id: 'split', type: 'parallel-gateway', name: 'Split', config: { mode: 'split' } },
        { id: 'a', type: 'non-interactive-terminal', name: 'A', config: { command: 'echo a', cwd: '${sys_project_dir}', successExitCodes: [0] } },
        { id: 'b', type: 'non-interactive-terminal', name: 'B', config: { command: 'echo b', cwd: '${sys_project_dir}', successExitCodes: [0] } },
        { id: 'join', type: 'parallel-gateway', name: 'Join', config: { mode: 'join', joinIncomingEdgeIds: ['e-split-a'] } },
        { id: 'end', type: 'end', name: 'End', config: {} }
      ],
      edges: [
        { id: 'e-start-split', from: 'start', to: 'split' },
        { id: 'e-split-a', from: 'split', to: 'a' },
        { id: 'e-split-b', from: 'split', to: 'b' },
        { id: 'e-a-join', from: 'a', to: 'join' },
        { id: 'e-b-join', from: 'b', to: 'join' },
        { id: 'e-join-end', from: 'join', to: 'end' }
      ]
    }

    expect(validateWorkflow(workflow).map((i) => i.key)).toContain('errors:workflowValidation.joinIncomingEdgeIdsMustTargetJoin')
  })

  it('requires split gateways to have at least two outgoing edges', () => {
    const workflow: WorkflowDefinition = {
      id: 'wf-single-split',
      name: 'Single split',
      nodes: [
        { id: 'start', type: 'start', name: 'Start', config: { variables: [{ key: 'prompt', label: 'Prompt', type: 'text', required: true }] } },
        { id: 'split', type: 'parallel-gateway', name: 'Split', config: { mode: 'split' } },
        { id: 'end', type: 'end', name: 'End', config: {} }
      ],
      edges: [
        { id: 'e-start-split', from: 'start', to: 'split' },
        { id: 'e-split-end', from: 'split', to: 'end' }
      ]
    }

    expect(validateWorkflow(workflow).map((i) => i.key)).toContain('errors:workflowValidation.splitNeedsTwoOutgoingEdges')
  })
})

describe('terminal node validation', () => {
  it('requires terminal nodes to have command and cwd', () => {
    const workflow: WorkflowDefinition = {
      id: 'wf-empty-terminal',
      name: 'Empty terminal',
      nodes: [
        { id: 'start', type: 'start', name: 'Start', config: { variables: [{ key: 'prompt', label: 'Prompt', type: 'text', required: false }] } },
        { id: 'interactive', type: 'interactive-terminal', name: 'Interactive', config: { command: '', cwd: '${sys_project_dir}', autoStart: true } },
        { id: 'automatic', type: 'non-interactive-terminal', name: 'Automatic', config: { command: 'echo ok', cwd: '   ', successExitCodes: [0] } },
        { id: 'end', type: 'end', name: 'End', config: {} }
      ],
      edges: [
        { id: 'e-start-interactive', from: 'start', to: 'interactive' },
        { id: 'e-interactive-automatic', from: 'interactive', to: 'automatic' },
        { id: 'e-automatic-end', from: 'automatic', to: 'end' }
      ]
    }

    expect(validateWorkflow(workflow).map((i) => i.key)).toEqual(expect.arrayContaining([
      'errors:workflowValidation.terminalCommandEmpty',
      'errors:workflowValidation.workingDirEmpty'
    ]))
  })
})

describe('workflow structural validation', () => {
  it('reports a single outgoing-edge issue for a disconnected start node', () => {
    const workflow: WorkflowDefinition = {
      id: 'wf-disconnected-start',
      name: 'Disconnected start',
      nodes: [
        { id: 'start', type: 'start', name: 'Start', config: { variables: [] } },
        { id: 'end', type: 'end', name: 'End', config: {} }
      ],
      edges: []
    }

    const keys = validateWorkflow(workflow).map((issue) => issue.key)

    expect(keys).toContain('errors:workflowValidation.startNeedsOutgoingEdge')
    expect(keys).not.toContain('errors:workflowValidation.missingOutgoingEdge')
  })

  it('rejects nullable hooks', () => {
    expect(() => parseWorkflowDefinition({
      id: 'wf-null-hooks',
      name: 'Nullable legacy hooks',
      nodes: [
        { id: 'start', type: 'start', name: 'Start', config: { variables: [] } },
        {
          id: 'terminal',
          type: 'non-interactive-terminal',
          name: 'Terminal',
          config: { command: 'echo ok', cwd: '.', successExitCodes: [0] },
          startHook: null,
          endHook: null
        },
        { id: 'end', type: 'end', name: 'End', config: {} }
      ],
      edges: [
        { id: 'e-start-terminal', from: 'start', to: 'terminal' },
        { id: 'e-terminal-end', from: 'terminal', to: 'end' }
      ]
    })).toThrow('startHook must be an object')
  })

  it('rejects an exclusive gateway defaultEdgeId that is not one of its outgoing edges', () => {
    const workflow: WorkflowDefinition = {
      id: 'wf-invalid-default-edge',
      name: 'Invalid default edge',
      nodes: [
        { id: 'start', type: 'start', name: 'Start', config: { variables: [] } },
        {
          id: 'choice',
          type: 'exclusive-gateway',
          name: 'Choice',
          config: { defaultEdgeId: 'e-start-choice' }
        },
        { id: 'end', type: 'end', name: 'End', config: {} }
      ],
      edges: [
        { id: 'e-start-choice', from: 'start', to: 'choice' },
        { id: 'e-choice-end', from: 'choice', to: 'end' }
      ]
    }

    expect(validateWorkflow(workflow).map((i) => i.key)).toContain(
      'errors:workflowValidation.invalidDefaultEdgeId'
    )
  })

  it('allows start nodes without startup variables', () => {
    const workflow: WorkflowDefinition = {
      id: 'wf-start-no-vars',
      name: 'Start no vars',
      nodes: [
        { id: 'start', type: 'start', name: 'Start', config: { variables: [] } },
        { id: 'end', type: 'end', name: 'End', config: {} }
      ],
      edges: [{ id: 'e-start-end', from: 'start', to: 'end' }]
    }

    expect(validateWorkflow(workflow).map((i) => i.key)).not.toContain('errors:workflowValidation.variableKeyEmpty')
  })

  it('rejects incoming edges on start nodes', () => {
    const workflow: WorkflowDefinition = {
      id: 'wf-start-incoming',
      name: 'Start incoming',
      nodes: [
        { id: 'start', type: 'start', name: 'Start', config: { variables: [] } },
        {
          id: 'terminal',
          type: 'interactive-terminal',
          name: 'Terminal',
          config: { command: 'bash', cwd: '${sys_project_dir}', autoStart: true }
        }
      ],
      edges: [
        { id: 'e-start-terminal', from: 'start', to: 'terminal' },
        { id: 'e-terminal-start', from: 'terminal', to: 'start' }
      ]
    }

    const errors = validateWorkflow(workflow)

    expect(errors).toEqual([{ key: 'errors:workflowValidation.startHasIncomingEdge' }])
    expect(errors.map((issue) => createI18n('zh').t(issue.key, issue.params)))
      .toEqual(['start 节点不能有入边'])
    expect(() => parseWorkflowDefinition(workflow)).toThrow('Invalid workflow definition')
  })

  it('rejects multiple outgoing edges on non-gateway nodes', () => {
    const workflow: WorkflowDefinition = {
      id: 'wf-multi-out',
      name: 'Multi out',
      nodes: [
        { id: 'start', type: 'start', name: 'Start', config: { variables: [] } },
        { id: 'a', type: 'non-interactive-terminal', name: 'A', config: { command: 'echo a', cwd: '${sys_project_dir}', successExitCodes: [0] } },
        { id: 'b', type: 'end', name: 'B', config: {} },
        { id: 'c', type: 'end', name: 'C', config: {} }
      ],
      edges: [
        { id: 'e-start-a', from: 'start', to: 'a' },
        { id: 'e-a-b', from: 'a', to: 'b' },
        { id: 'e-a-c', from: 'a', to: 'c' }
      ]
    }

    expect(validateWorkflow(workflow).map((i) => i.key)).toContain('errors:workflowValidation.normalNodeSingleOutgoingEdge')
  })

  it('does not crash when terminal config is missing command or cwd', () => {
    const workflow: WorkflowDefinition = {
      id: 'wf-missing-config',
      name: 'Missing config',
      nodes: [
        { id: 'start', type: 'start', name: 'Start', config: { variables: [] } },
        { id: 'broken', type: 'non-interactive-terminal', name: 'Broken', config: {} as never },
        { id: 'end', type: 'end', name: 'End', config: {} }
      ],
      edges: [
        { id: 'e-start-broken', from: 'start', to: 'broken' },
        { id: 'e-broken-end', from: 'broken', to: 'end' }
      ]
    }

    const errors = validateWorkflow(workflow)
    expect(errors.map((i) => i.key)).toContain('errors:workflowValidation.terminalCommandEmpty')
    expect(errors.map((i) => i.key)).toContain('errors:workflowValidation.workingDirEmpty')
  })
})

describe('system variable descriptions', () => {
  it('provides a translation key for every system variable', () => {
    for (const name of SYSTEM_VARIABLES) {
      const description = SYSTEM_VARIABLE_DESCRIPTIONS[name]
      expect(typeof description).toBe('string')
      expect(description.startsWith('workflow:systemVariable.')).toBe(true)
    }
  })

  it('maps sys_last_node_id to its own translation key', () => {
    expect(SYSTEM_VARIABLE_DESCRIPTIONS.sys_last_node_id).toBe('workflow:systemVariable.sys_last_node_id')
  })

  it('does not expose derived worktree and plan paths as system variables', () => {
    expect(SYSTEM_VARIABLES).not.toContain('sys_worktree_dir')
    expect(SYSTEM_VARIABLES).not.toContain('sys_plan_path')
  })
})

type Graph = { nodes: WorkflowNode[]; edges: WorkflowEdge[] }

describe('getAvailableUserVariables', () => {
  function makeVar(key: string, label = key) {
    return { key, label, type: 'text' as const, required: false }
  }

  it('returns empty when the node does not exist', () => {
    const graph: Graph = { nodes: [], edges: [] }
    expect(getAvailableUserVariables(graph, 'missing')).toEqual([])
  })

  it('returns empty when there is not exactly one start node', () => {
    const graph: Graph = {
      nodes: [
        { id: 'a', type: 'start', name: 'a', config: { variables: [makeVar('x')] } },
        { id: 'b', type: 'start', name: 'b', config: { variables: [makeVar('y')] } }
      ],
      edges: []
    }
    expect(getAvailableUserVariables(graph, 'a')).toEqual([])
  })

  it('accumulates start variables at a downstream terminal node', () => {
    const graph: Graph = {
      nodes: [
        { id: 'start', type: 'start', name: 's', config: { variables: [makeVar('prompt', '需求')] } },
        { id: 'term', type: 'non-interactive-terminal', name: 't', config: { command: 'echo', cwd: '.', successExitCodes: [0] } }
      ],
      edges: [{ id: 'e1', from: 'start', to: 'term' }]
    }
    expect(getAvailableUserVariables(graph, 'term').map((v) => v.key)).toEqual(['prompt'])
  })

  it('excludes the current input node own variables but keeps upstream ones', () => {
    const graph: Graph = {
      nodes: [
        { id: 'start', type: 'start', name: 's', config: { variables: [makeVar('prompt')] } },
        { id: 'inp', type: 'input', name: 'i', config: { variables: [makeVar('extra')] } },
        { id: 'term', type: 'non-interactive-terminal', name: 't', config: { command: 'echo', cwd: '.', successExitCodes: [0] } }
      ],
      edges: [
        { id: 'e1', from: 'start', to: 'inp' },
        { id: 'e2', from: 'inp', to: 'term' }
      ]
    }
    expect(getAvailableUserVariables(graph, 'inp').map((v) => v.key)).toEqual(['prompt'])
    expect(getAvailableUserVariables(graph, 'term').map((v) => v.key)).toEqual(['prompt', 'extra'])
  })

  it('excludes loop-body input variables from the loop header', () => {
    const graph: Graph = {
      nodes: [
        { id: 'start', type: 'start', name: 's', config: { variables: [makeVar('base')] } },
        {
          id: 'draft',
          type: 'non-interactive-terminal',
          name: 'draft',
          config: { command: 'echo draft', cwd: '.', successExitCodes: [0] }
        },
        { id: 'review', type: 'input', name: 'review', config: { variables: [makeVar('feedback')] } }
      ],
      edges: [
        { id: 'start-draft', from: 'start', to: 'draft' },
        { id: 'draft-review', from: 'draft', to: 'review' },
        { id: 'review-draft', from: 'review', to: 'draft' }
      ]
    }

    expect(getAvailableUserVariables(graph, 'draft').map((variable) => variable.key))
      .toEqual(['base'])
  })

  it('keeps only common variables after an exclusive-gateway convergence', () => {
    const graph: Graph = {
      nodes: [
        { id: 'start', type: 'start', name: 's', config: { variables: [makeVar('base')] } },
        { id: 'gw', type: 'exclusive-gateway', name: 'g', config: {} },
        { id: 'ina', type: 'input', name: 'ina', config: { variables: [makeVar('var_a')] } },
        { id: 'inb', type: 'input', name: 'inb', config: { variables: [makeVar('var_b')] } },
        { id: 'merge', type: 'end', name: 'm', config: {} }
      ],
      edges: [
        { id: 'e1', from: 'start', to: 'gw' },
        { id: 'e2', from: 'gw', to: 'ina' },
        { id: 'e3', from: 'gw', to: 'inb' },
        { id: 'e4', from: 'ina', to: 'merge' },
        { id: 'e5', from: 'inb', to: 'merge' }
      ]
    }
    expect(getAvailableUserVariables(graph, 'merge').map((v) => v.key)).toEqual(['base'])
  })

  it('isolates parallel sibling branch variables', () => {
    const graph: Graph = {
      nodes: [
        { id: 'start', type: 'start', name: 's', config: { variables: [makeVar('base')] } },
        { id: 'split', type: 'parallel-gateway', name: 'sp', config: { mode: 'split' } },
        { id: 'ina', type: 'input', name: 'ina', config: { variables: [makeVar('var_a')] } },
        { id: 'inb', type: 'input', name: 'inb', config: { variables: [makeVar('var_b')] } },
        { id: 'join', type: 'parallel-gateway', name: 'j', config: { mode: 'join', joinIncomingEdgeIds: ['ea', 'eb'] } },
        { id: 'end', type: 'end', name: 'e', config: {} }
      ],
      edges: [
        { id: 's-sp', from: 'start', to: 'split' },
        { id: 'sp-a', from: 'split', to: 'ina' },
        { id: 'sp-b', from: 'split', to: 'inb' },
        { id: 'ea', from: 'ina', to: 'join' },
        { id: 'eb', from: 'inb', to: 'join' },
        { id: 'j-e', from: 'join', to: 'end' }
      ]
    }
    expect(getAvailableUserVariables(graph, 'ina').map((v) => v.key)).toEqual(['base'])
    expect(getAvailableUserVariables(graph, 'inb').map((v) => v.key)).toEqual(['base'])
  })

  it('does not merge branch variables past a join', () => {
    const graph: Graph = {
      nodes: [
        { id: 'start', type: 'start', name: 's', config: { variables: [makeVar('base')] } },
        { id: 'split', type: 'parallel-gateway', name: 'sp', config: { mode: 'split' } },
        { id: 'ina', type: 'input', name: 'ina', config: { variables: [makeVar('var_a')] } },
        { id: 'inb', type: 'input', name: 'inb', config: { variables: [makeVar('var_b')] } },
        { id: 'join', type: 'parallel-gateway', name: 'j', config: { mode: 'join', joinIncomingEdgeIds: ['ea', 'eb'] } },
        { id: 'after', type: 'non-interactive-terminal', name: 'a', config: { command: 'echo', cwd: '.', successExitCodes: [0] } }
      ],
      edges: [
        { id: 's-sp', from: 'start', to: 'split' },
        { id: 'sp-a', from: 'split', to: 'ina' },
        { id: 'sp-b', from: 'split', to: 'inb' },
        { id: 'ea', from: 'ina', to: 'join' },
        { id: 'eb', from: 'inb', to: 'join' },
        { id: 'j-a', from: 'join', to: 'after' }
      ]
    }
    expect(getAvailableUserVariables(graph, 'join').map((v) => v.key)).toEqual(['base'])
    expect(getAvailableUserVariables(graph, 'after').map((v) => v.key)).toEqual(['base'])
  })

  it('deduplicates variables sharing the same key (first definition wins)', () => {
    const graph: Graph = {
      nodes: [
        { id: 'start', type: 'start', name: 's', config: { variables: [makeVar('dup', 'First')] } },
        { id: 'inp', type: 'input', name: 'i', config: { variables: [{ key: 'dup', label: 'Second', type: 'text', required: false }] } },
        { id: 'term', type: 'non-interactive-terminal', name: 't', config: { command: 'echo', cwd: '.', successExitCodes: [0] } }
      ],
      edges: [
        { id: 'e1', from: 'start', to: 'inp' },
        { id: 'e2', from: 'inp', to: 'term' }
      ]
    }
    const result = getAvailableUserVariables(graph, 'term')
    expect(result).toHaveLength(1)
    expect(result[0].label).toBe('First')
  })

  it('ignores variables with invalid keys', () => {
    const graph: Graph = {
      nodes: [
        { id: 'start', type: 'start', name: 's', config: { variables: [makeVar('good'), { key: 'sys_bad', label: 'Bad', type: 'text', required: false }, { key: '1bad', label: 'Num', type: 'text', required: false }] } },
        { id: 'term', type: 'non-interactive-terminal', name: 't', config: { command: 'echo', cwd: '.', successExitCodes: [0] } }
      ],
      edges: [{ id: 'e1', from: 'start', to: 'term' }]
    }
    expect(getAvailableUserVariables(graph, 'term').map((v) => v.key)).toEqual(['good'])
  })
})

describe('validation issue localization', () => {
  it('translates validation issues into the zh locale', () => {
    const i18n = createI18n('zh')
    const workflow: WorkflowDefinition = {
      id: 'wf-loc',
      name: 'Loc',
      nodes: [
        { id: 'start', type: 'start', name: 'Start', config: { variables: [] } },
        { id: 'a', type: 'non-interactive-terminal', name: 'A', config: { command: 'echo a', cwd: '${sys_project_dir}', successExitCodes: [0] } },
        { id: 'b', type: 'end', name: 'B', config: {} }
      ],
      edges: [
        { id: 'e-start-a', from: 'start', to: 'a' },
        { id: 'e-a-b', from: 'a', to: 'b' },
        { id: 'e-a-c', from: 'a', to: 'b' }
      ]
    }

    const messages = validateWorkflow(workflow).map((issue) => i18n.t(issue.key, issue.params))

    expect(messages).toContain('A: 普通节点只能有一条出边')
  })

  it('translates the missing-start-node issue into the zh locale', () => {
    const i18n = createI18n('zh')
    const workflow: WorkflowDefinition = {
      id: 'wf-no-start',
      name: 'NoStart',
      nodes: [{ id: 'end', type: 'end', name: 'End', config: {} }],
      edges: []
    }

    const messages = validateWorkflow(workflow).map((issue) => i18n.t(issue.key, issue.params))

    expect(messages).toContain('工作流必须有且只有一个 start 节点')
  })
})
