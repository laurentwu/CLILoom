// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { i18n } from './i18n'
import {
  DEFAULT_ASSISTANT_CONFIG,
  DEFAULT_APPEARANCE_PREFERENCES,
  DEFAULT_LAYOUT_PREFERENCES,
  DEFAULT_SHELL_PREFERENCES
} from '../shared/appSettings'
import { DEFAULT_SKIN } from './theme'
import type { VariableDefinition, WorkflowDefinition, WorkflowNode } from '../shared/workflow'
import type {
  WorkflowRuntimeBranchRun,
  WorkflowRuntimeStartOptions,
  WorkflowRuntimeState
} from '../shared/workflowRuntime'
import type { ShellSnapshot } from '../shared/shell'
import type { TerminalDataEvent, TerminalTranscriptSnapshot } from '../shared/terminalBuffer'
import type { UpdateState } from '../shared/update'
import { TASK_DRAFT_VERSION, type TaskDraftPayload, type TaskDraftRecord } from '../shared/taskDraft'
import type {
  Bootstrap,
  ProjectRecord,
  TaskRecord,
  WorkflowRecord,
  WorkflowSaveResult
} from './appTypes'
import type { TerminalSession } from './utils'

const { designerInspectorRender, reactFlowRender, terminalTranscriptLoadRequest } = vi.hoisted(() => ({
  designerInspectorRender: vi.fn(),
  reactFlowRender: vi.fn(),
  terminalTranscriptLoadRequest: vi.fn()
}))

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn()
  }
}))

vi.mock('@xyflow/react', async () => {
  const React = await import('react')
  const passthrough = ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children)
  type FlowElement = { id: string }
  type SelectionChangeHandler = (selection: { nodes: FlowElement[]; edges: FlowElement[] }) => void

  const ReactFlow = ({
    children,
    connectionMode,
    edges = [],
    nodes = [],
    onConnect,
    onSelectionChange
  }: {
    children?: React.ReactNode
    connectionMode?: string
    edges?: FlowElement[]
    nodes?: FlowElement[]
    onConnect?: (connection: {
      source: string
      sourceHandle: string | null
      target: string
      targetHandle: string | null
    }) => void
    onSelectionChange?: SelectionChangeHandler
  }) => {
    const [selectedNodeId, setSelectedNodeId] = React.useState<string | null>(null)
    const selectedNodes = React.useMemo(
      () => nodes.filter((node) => node.id === selectedNodeId),
      [nodes, selectedNodeId]
    )

    reactFlowRender({ connectionMode, edges, nodes, onConnect })

    React.useEffect(() => {
      onSelectionChange?.({ nodes: selectedNodes, edges: [] })
    }, [onSelectionChange, selectedNodes])

    return React.createElement(
      'div',
      { 'data-connection-mode': connectionMode, 'data-testid': 'react-flow' },
      ...nodes.map((node) => React.createElement('button', {
        key: node.id,
        onClick: () => setSelectedNodeId(node.id),
        type: 'button'
      }, `Select flow node ${node.id}`)),
      onSelectionChange
        ? React.createElement('button', {
            onClick: () => onSelectionChange({ nodes: selectedNodes, edges: [] }),
            type: 'button'
          }, 'Repeat current flow selection')
        : null,
      children
    )
  }

  return {
    Background: () => null,
    ConnectionMode: { Loose: 'loose', Strict: 'strict' },
    Controls: () => null,
    MarkerType: { ArrowClosed: 'arrow-closed' },
    MiniMap: () => null,
    ReactFlow,
    ReactFlowProvider: passthrough,
    addEdge: (edge: unknown, edges: unknown[]) => [...edges, edge],
    applyEdgeChanges: (_changes: unknown[], edges: unknown[]) => edges,
    applyNodeChanges: (_changes: unknown[], nodes: unknown[]) => nodes
  }
})

vi.mock('@/components/ui/select', async () => {
  const React = await import('react')
  type SelectContextValue = {
    value?: string
    onValueChange?: (value: string) => void
  }
  const SelectContext = React.createContext<SelectContextValue>({})
  return {
    Select: ({
      children,
      onValueChange,
      value
    }: {
      children?: React.ReactNode
      onValueChange?: (value: string) => void
      value?: string
    }) => React.createElement(
      SelectContext.Provider,
      { value: { onValueChange, value } },
      React.createElement('div', null, children)
    ),
    SelectTrigger: ({
      children,
      size: _size,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement> & { size?: string }) => React.createElement(
      'button',
      { ...props, type: 'button' },
      children
    ),
    SelectValue: () => {
      const context = React.useContext(SelectContext)
      return React.createElement('span', null, context.value)
    },
    SelectContent: ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children),
    SelectItem: ({
      children,
      disabled,
      value
    }: {
      children?: React.ReactNode
      disabled?: boolean
      value: string
    }) => {
      const context = React.useContext(SelectContext)
      return React.createElement(
        'button',
        {
          disabled,
          onClick: () => context.onValueChange?.(value),
          type: 'button'
        },
        children
      )
    }
  }
})

vi.mock('@/components/ui/alert-dialog', async () => {
  const React = await import('react')
  type DialogContextValue = { onOpenChange?: (open: boolean) => void }
  const DialogContext = React.createContext<DialogContextValue>({})
  const passthrough = ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children)
  return {
    AlertDialog: ({
      children,
      onOpenChange,
      open
    }: {
      children?: React.ReactNode
      onOpenChange?: (open: boolean) => void
      open?: boolean
    }) => open
      ? React.createElement(DialogContext.Provider, { value: { onOpenChange } }, children)
      : null,
    AlertDialogAction: ({
      children,
      onClick,
      variant: _variant,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }) => {
      const context = React.useContext(DialogContext)
      return React.createElement('button', {
        ...props,
        onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
          onClick?.(event)
          if (!event.defaultPrevented) context.onOpenChange?.(false)
        },
        type: 'button'
      }, children)
    },
    AlertDialogCancel: ({
      children,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement>) => {
      const context = React.useContext(DialogContext)
      return React.createElement('button', {
        ...props,
        onClick: () => context.onOpenChange?.(false),
        type: 'button'
      }, children)
    },
    AlertDialogContent: ({ children }: { children?: React.ReactNode }) => React.createElement(
      'div',
      { role: 'alertdialog' },
      children
    ),
    AlertDialogDescription: ({ children }: { children?: React.ReactNode }) => React.createElement('p', null, children),
    AlertDialogFooter: passthrough,
    AlertDialogHeader: passthrough,
    AlertDialogMedia: passthrough,
    AlertDialogTitle: ({ children }: { children?: React.ReactNode }) => React.createElement('h2', null, children)
  }
})

vi.mock('./components/ProjectRail', async () => {
  const React = await import('react')
  return {
    ProjectRail: ({
      onOpenDesigner,
      onRenameProject,
      onSelectProject,
      projects,
      shellSnapshot,
      onShellChange,
      onRefreshShells,
      updateState,
      onCheckForUpdates,
      onInstallUpdate,
      onOpenUpdateRelease
    }: {
      onOpenDesigner: () => void
      onRenameProject: (project: ProjectRecord, name: string) => Promise<void>
      onSelectProject: (project: ProjectRecord) => void
      projects: ProjectRecord[]
      shellSnapshot: ShellSnapshot
      onShellChange: (shellId: string | 'automatic') => Promise<void>
      onRefreshShells: () => Promise<void>
      updateState: UpdateState
      onCheckForUpdates: () => void
      onInstallUpdate: () => void
      onOpenUpdateRelease: () => void
    }) => React.createElement(
      'nav',
      null,
      ...projects.map((item) => React.createElement(
        React.Fragment,
        { key: item.id },
        React.createElement('button', {
          onClick: () => onSelectProject(item),
          type: 'button'
        }, `切换项目 ${item.name}`),
        React.createElement('button', {
          onClick: () => void onRenameProject(item, '  Renamed project  '),
          type: 'button'
        }, `重命名项目 ${item.name}`)
      )),
      React.createElement('button', {
        onClick: onOpenDesigner,
        type: 'button'
      }, '打开工作流设计器'),
      React.createElement('output', { 'data-testid': 'shell-selection' }, JSON.stringify({
        selection: shellSnapshot.preferences.selection.mode === 'automatic'
          ? 'automatic'
          : shellSnapshot.preferences.selection.shell.id,
        effective: shellSnapshot.effectiveShell?.id ?? null
      })),
      React.createElement('button', {
        onClick: () => {
          const target = shellSnapshot.candidates.find((shell) => (
            shell.id !== shellSnapshot.effectiveShell?.id
          )) ?? shellSnapshot.candidates[0]
          if (target) void onShellChange(target.id).catch(() => undefined)
        },
        type: 'button'
      }, '选择另一个 Shell'),
      React.createElement('button', {
        onClick: () => void onRefreshShells().catch(() => undefined),
        type: 'button'
      }, '重新检测 Shell'),
      React.createElement('output', { 'data-testid': 'update-state' }, updateState.status),
      React.createElement('button', {
        'data-testid': 'check-update',
        onClick: onCheckForUpdates,
        type: 'button'
      }, '检查更新（测试）'),
      React.createElement('button', {
        'data-testid': 'install-update',
        onClick: onInstallUpdate,
        type: 'button'
      }, '安装更新（测试）'),
      React.createElement('button', {
        'data-testid': 'open-update-release',
        onClick: onOpenUpdateRelease,
        type: 'button'
      }, '打开更新页（测试）')
    )
  }
})

vi.mock('./components/TaskSidebar', async () => {
  const React = await import('react')
  return {
    TaskSidebar: ({
      activeProject,
      displayedTasks,
      onLoadTask,
      onRenameTask,
      onShowMoreTasks,
      onStartNewTask,
      showDraftTask,
      totalTaskCount
    }: {
      activeProject: ProjectRecord | null
      displayedTasks: TaskRecord[]
      onLoadTask: (task: TaskRecord) => void
      onRenameTask: (task: TaskRecord, title: string) => Promise<void>
      onShowMoreTasks: () => void
      onStartNewTask: () => void
      showDraftTask?: boolean
      totalTaskCount: number
    }) => React.createElement(
      'aside',
      null,
      React.createElement('button', {
        disabled: !activeProject,
        onClick: onStartNewTask,
        type: 'button'
      }, '新建任务'),
      showDraftTask
        ? React.createElement('div', { 'data-testid': 'draft-task' }, '草稿任务')
        : null,
      ...displayedTasks.map((task) => React.createElement(
        React.Fragment,
        { key: task.id },
        React.createElement('button', {
          'data-task-status': task.status,
          onClick: () => onLoadTask(task),
          type: 'button'
        }, `加载 ${task.title}`),
        React.createElement('button', {
          onClick: () => void onRenameTask(task, '手动名称'),
          type: 'button'
        }, `重命名 ${task.title}`)
      )),
      displayedTasks.length < totalTaskCount
        ? React.createElement('button', {
            onClick: onShowMoreTasks,
            type: 'button'
          }, '查看更多')
        : null
    )
  }
})

vi.mock('./components/NodeDetailPanel', async () => {
  const React = await import('react')
  return {
    NodeDetailPanel: ({
      canOperate,
      node,
      onLoadTerminalTranscript,
      onRetryNode,
      onRun,
      onVariableChange,
      sessions,
      variables
    }: {
      canOperate: boolean
      node: { id: string; name: string }
      onLoadTerminalTranscript: (session: TerminalSession) => Promise<void>
      onRetryNode: () => void
      onRun?: () => void
      onVariableChange: (key: string, value: string) => void
      sessions: TerminalSession[]
      variables: Record<string, unknown>
    }) => React.createElement(
      'section',
      { 'data-testid': 'node-detail' },
      React.createElement('span', null, node.name),
      React.createElement('output', { 'data-testid': 'variables' }, JSON.stringify(variables)),
      sessions[0]
        ? React.createElement(
            React.Fragment,
            null,
            React.createElement('output', { 'data-testid': 'terminal-transcript' }, sessions[0].transcript ?? 'unloaded'),
            React.createElement('button', {
              onClick: () => terminalTranscriptLoadRequest(onLoadTerminalTranscript(sessions[0])),
              type: 'button'
            }, `加载终端 ${sessions[0].id}`)
          )
        : null,
      React.createElement('button', {
        disabled: !canOperate,
        onClick: () => onVariableChange('prompt', 'edited prompt'),
        type: 'button'
      }, '修改变量'),
      React.createElement('button', {
        disabled: !canOperate,
        onClick: onRun,
        type: 'button'
      }, '运行'),
      React.createElement('button', {
        disabled: !canOperate,
        onClick: onRetryNode,
        type: 'button'
      }, `重试节点 ${node.id}`)
    )
  }
})

vi.mock('./components/ParallelBranchGroup', async () => {
  const React = await import('react')
  return {
    ParallelBranchGroup: ({
      branches,
      onRetryNode
    }: {
      branches: WorkflowRuntimeBranchRun[]
      onRetryNode: (branchId: string, nodeId: string) => void
    }) => React.createElement(
      'section',
      { 'data-testid': 'parallel-branch-group' },
      ...branches.map((branch) => React.createElement('button', {
        key: branch.branchId,
        onClick: () => onRetryNode(branch.branchId, branch.currentNodeId),
        type: 'button'
      }, `重试分支 ${branch.branchId}:${branch.currentNodeId}`))
    )
  }
})

vi.mock('./components/StatusBadge', () => ({
  StatusBadge: () => null
}))

vi.mock('./components/TerminalScrollGroup', async () => {
  const React = await import('react')
  return {
    TerminalScrollGroup: ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children)
  }
})

vi.mock('./components/NodeIcon', () => ({ NodeIcon: () => null }))
vi.mock('./designer/DesignerFlowNode', () => ({ DesignerFlowNode: () => null }))
vi.mock('./designer/DesignerFlowEdge', () => ({ DesignerFlowEdge: () => null }))
vi.mock('./designer/DesignerInspector', async () => {
  const React = await import('react')
  return {
    DesignerInspector: ({
      nodes,
      onUpdateNode,
      selection
    }: {
      nodes: WorkflowNode[]
      onUpdateNode: (nodeId: string, patch: Partial<WorkflowNode>) => void
      selection: { kind: 'node' | 'edge'; id: string } | null
    }) => {
      designerInspectorRender(selection)
      const selectedNode = selection?.kind === 'node'
        ? nodes.find((node) => node.id === selection.id)
        : undefined
      return React.createElement(
        React.Fragment,
        null,
        React.createElement(
          'output',
          { 'data-testid': 'designer-selection' },
          selection ? `${selection.kind}:${selection.id}` : 'none'
        ),
        selectedNode?.type === 'interactive-terminal'
          ? React.createElement(
              'button',
              {
                onClick: () => onUpdateNode(selectedNode.id, {
                  config: { command: 'bash', cwd: '${sys_project_dir}', autoStart: true }
                }),
                type: 'button'
              },
              'Set terminal command'
            )
          : null
      )
    }
  }
})
vi.mock('./designer/layout', () => ({
  arrangeWorkflowNodesLeftToRight: (nodes: unknown[]) => nodes
}))
vi.mock('./designer/snapping', () => ({
  HORIZONTAL_ALIGNMENT_SNAP_DISTANCE: 8,
  snapNodePositionHorizontally: (position: unknown) => position
}))

import { App } from './App'

const project: ProjectRecord = {
  id: 'project-1',
  name: 'Project',
  path: '/repo',
  sort_order: 0,
  default_workflow_id: 'workflow-a',
  created_at: '2026-01-01T00:00:00.000Z'
}

const otherProject: ProjectRecord = {
  ...project,
  id: 'project-2',
  name: 'Other Project',
  path: '/other-repo',
  default_workflow_id: 'workflow-b'
}

function workflow(
  id: string,
  name: string,
  promptDefault: string,
  includeInput = false
): WorkflowDefinition {
  const inputNode = includeInput
    ? [{
        id: `${id}-input`,
        type: 'input' as const,
        name: `${name} Input`,
        config: { variables: [] }
      }]
    : []
  return {
    id,
    name,
    nodes: [
      {
        id: `${id}-start`,
        type: 'start',
        name: `${name} Start`,
        config: {
          variables: [{
            key: 'prompt',
            label: 'Prompt',
            type: 'text',
            required: false,
            defaultValue: promptDefault
          }]
        }
      },
      ...inputNode,
      { id: `${id}-end`, type: 'end', name: `${name} End`, config: {} }
    ],
    edges: includeInput
      ? [
          { id: `${id}-edge-1`, from: `${id}-start`, to: `${id}-input` },
          { id: `${id}-edge-2`, from: `${id}-input`, to: `${id}-end` }
        ]
      : [{ id: `${id}-edge`, from: `${id}-start`, to: `${id}-end` }]
  }
}

const workflowA = workflow('workflow-a', '流程 A', 'default a')
const workflowB = workflow('workflow-b', '流程 B', 'default b', true)

function record(definition: WorkflowDefinition, revision = 1): WorkflowRecord {
  return {
    workflow: definition,
    revision,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
}

function bootstrap(tasks: TaskRecord[] = []): Bootstrap & { tasks: TaskRecord[] } {
  return {
    workflows: [workflowA, workflowB],
    workflowRecords: [record(workflowA), record(workflowB)],
    settings: {
      assistant: DEFAULT_ASSISTANT_CONFIG,
      appearance: DEFAULT_APPEARANCE_PREFERENCES,
      layout: DEFAULT_LAYOUT_PREFERENCES,
      shell: DEFAULT_SHELL_PREFERENCES,
      skins: [],
      activeSkin: DEFAULT_SKIN
    },
    shell: {
      platform: 'linux',
      preferences: DEFAULT_SHELL_PREFERENCES,
      candidates: [],
      effectiveShell: null
    },
    projects: [project],
    terminalSessions: [],
    lastOpenedWorkspace: null,
    tasks
  }
}

function taskRecords(
  projectRecord: ProjectRecord,
  count: number,
  titlePrefix = '任务'
): TaskRecord[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${projectRecord.id}-task-${index + 1}`,
    project_id: projectRecord.id,
    title: `${titlePrefix} ${index + 1}`,
    status: 'completed',
    created_at: '2026-08-10T19:30:00.000Z',
    updated_at: '2026-08-10T19:30:00.000Z'
  }))
}

function runtimeState(
  taskId: string,
  definition: WorkflowDefinition,
  task?: TaskRecord
): WorkflowRuntimeState {
  return {
    taskId,
    projectId: project.id,
    projectDir: project.path,
    workflowId: definition.id,
    status: task?.status === 'completed' ? 'completed' : 'running',
    currentNodeId: definition.nodes[0].id,
    variables: { prompt: 'saved prompt' },
    nodeRuns: {},
    executionOrder: [],
    activeBranches: [],
    branchRuns: {},
    parallelResults: {},
    workflowCompleted: task?.status === 'completed',
    task
  }
}

function taskDraft(
  projectId: string,
  definition: WorkflowDefinition,
  variables: Record<string, string | number | boolean | null>,
  revision = 1
): TaskDraftRecord {
  return {
    projectId,
    version: TASK_DRAFT_VERSION,
    workflow: definition,
    variables,
    revision,
    createdAt: '2026-08-05T00:00:00.000Z',
    updatedAt: '2026-08-05T00:00:00.000Z'
  }
}

type Listeners = {
  prepareToClose?: () => void
  shellsChanged?: (snapshot: ShellSnapshot) => void
  settingsChanged?: (snapshot: Bootstrap['settings']) => void
  workflowState?: (state: WorkflowRuntimeState) => void
  workflowChanged?: (event: unknown) => void
  terminalData?: (event: TerminalDataEvent) => void
  updateState?: (state: UpdateState) => void
}

function setupApi(options: {
  data?: ReturnType<typeof bootstrap>
  drafts?: Record<string, TaskDraftRecord | null>
  restore?: {
    state: WorkflowRuntimeState
    workflow: WorkflowDefinition
    terminalSessions?: TerminalSession[]
  } | null
  updateState?: UpdateState
} = {}) {
  const data = options.data ?? bootstrap()
  const listeners: Listeners = {}
  let workflowRecords = data.workflowRecords
  const draftStore = new Map<string, TaskDraftRecord>(
    Object.entries(options.drafts ?? {}).filter((entry): entry is [string, TaskDraftRecord] => Boolean(entry[1]))
  )
  const unsubscribe = () => {}
  const initialUpdateState: UpdateState = options.updateState ?? {
    status: 'idle',
    capability: 'unsupported',
    packageType: 'unknown',
    currentVersion: '0.1.0'
  }
  const api = {
    bootstrap: vi.fn().mockResolvedValue(data),
    listTasks: vi.fn().mockResolvedValue(data.tasks),
    listWorkflows: vi.fn(() => Promise.resolve(workflowRecords)),
    restoreWorkflowState: vi.fn().mockResolvedValue(options.restore ?? null),
    getTaskContext: vi.fn().mockResolvedValue('{}'),
    getTaskDraft: vi.fn((projectId: string) => Promise.resolve(draftStore.get(projectId) ?? null)),
    saveTaskDraft: vi.fn((projectId: string, draft: TaskDraftPayload, overwrite = false) => {
      const existing = draftStore.get(projectId)
      const now = '2026-08-05T00:00:00.000Z'
      const saved: TaskDraftRecord = {
        ...draft,
        projectId,
        revision: overwrite && existing
          ? Math.max(draft.revision, existing.revision + 1)
          : draft.revision,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
      }
      draftStore.set(projectId, saved)
      return Promise.resolve(saved)
    }),
    deleteTaskDraft: vi.fn((projectId: string) => {
      draftStore.delete(projectId)
      return Promise.resolve()
    }),
    listTaskSessions: vi.fn().mockResolvedValue([]),
    getTaskSessionTranscript: vi.fn().mockResolvedValue({
      transcript: 'loaded transcript',
      cursor: null
    }),
    setLastOpenedWorkspace: vi.fn().mockResolvedValue(undefined),
    renameProject: vi.fn().mockResolvedValue(undefined),
    updateTaskTitle: vi.fn().mockResolvedValue(undefined),
    setDesignerState: vi.fn().mockResolvedValue(undefined),
    setProjectDefaultWorkflow: vi.fn().mockResolvedValue(undefined),
    saveWorkflow: vi.fn().mockImplementation((workflow: WorkflowDefinition) => Promise.resolve({
      workflow,
      revision: 2,
      created: false
    })),
    startWorkflow: vi.fn().mockImplementation(
      (_request: WorkflowRuntimeStartOptions): Promise<WorkflowRuntimeState | undefined> => Promise.resolve(undefined)
    ),
    retryWorkflowNode: vi.fn().mockResolvedValue(undefined),
    retryProcess: vi.fn().mockResolvedValue({ sessionId: 'session-1' }),
    killProcess: vi.fn().mockResolvedValue(true),
    stopWorkflow: vi.fn().mockResolvedValue(undefined),
    updateShell: vi.fn().mockResolvedValue(data.shell),
    refreshShells: vi.fn().mockResolvedValue(data.shell),
    getUpdateState: vi.fn().mockResolvedValue(initialUpdateState),
    checkForUpdates: vi.fn().mockResolvedValue(initialUpdateState),
    installUpdate: vi.fn().mockResolvedValue(initialUpdateState),
    openUpdateRelease: vi.fn().mockResolvedValue(initialUpdateState),
    updateLanguage: vi.fn().mockResolvedValue(undefined),
    onSettingsChanged: vi.fn((callback: (snapshot: Bootstrap['settings']) => void) => {
      listeners.settingsChanged = callback
      return unsubscribe
    }),
    onShellsChanged: vi.fn((callback: (snapshot: ShellSnapshot) => void) => {
      listeners.shellsChanged = callback
      return unsubscribe
    }),
    onWorkflowChanged: vi.fn((callback: (event: unknown) => void) => {
      listeners.workflowChanged = callback
      return unsubscribe
    }),
    onProjectChanged: vi.fn(() => unsubscribe),
    onUpdateState: vi.fn((callback: (state: UpdateState) => void) => {
      listeners.updateState = callback
      return unsubscribe
    }),
    onWorkflowState: vi.fn((callback: (state: WorkflowRuntimeState) => void) => {
      listeners.workflowState = callback
      return unsubscribe
    }),
    onPrepareToClose: vi.fn((callback: () => void) => {
      listeners.prepareToClose = callback
      return unsubscribe
    }),
    rendererReadyToClose: vi.fn(),
    onTerminalCreated: vi.fn(() => unsubscribe),
    onTerminalRestarted: vi.fn(() => unsubscribe),
    onTerminalData: vi.fn((callback: (event: TerminalDataEvent) => void) => {
      listeners.terminalData = callback
      return unsubscribe
    }),
    onTerminalClosed: vi.fn(() => unsubscribe)
  }
  if (options.drafts === undefined) {
    Reflect.deleteProperty(api, 'getTaskDraft')
    Reflect.deleteProperty(api, 'saveTaskDraft')
    Reflect.deleteProperty(api, 'deleteTaskDraft')
  }
  Object.defineProperty(window, 'cliLoom', {
    configurable: true,
    value: api,
    writable: true
  })
  return {
    api,
    listeners,
    setWorkflowRecords: (records: WorkflowRecord[]) => {
      workflowRecords = records
    },
    draftStore
  }
}

async function renderBootstrappedApp() {
  render(<I18nextProvider i18n={i18n}><App /></I18nextProvider>)
  const newTaskButton = screen.getByRole('button', { name: '新建任务' }) as HTMLButtonElement
  await waitFor(() => expect(newTaskButton.disabled).toBe(false))
  return newTaskButton
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

type DesignerFlowRender = {
  connectionMode?: string
  nodes: Array<{ id: string; data?: { workflowNode?: WorkflowNode } }>
  onConnect?: (connection: {
    source: string
    sourceHandle: string | null
    target: string
    targetHandle: string | null
  }) => void
}

function getLatestDesignerFlowRender(): DesignerFlowRender | undefined {
  return [...reactFlowRender.mock.calls]
    .reverse()
    .map(([props]) => props as DesignerFlowRender)
    .find((props) => props.connectionMode === 'strict')
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('App language synchronization', () => {
  it('hot-swaps the document language when settings report a new language', async () => {
    const { listeners } = setupApi()
    await renderBootstrappedApp()

    const nextSettings = {
      ...bootstrap().settings,
      appearance: { version: 2 as const, activeSkinId: DEFAULT_APPEARANCE_PREFERENCES.activeSkinId, language: 'zh' as const }
    }
    act(() => listeners.settingsChanged?.(nextSettings))

    expect(document.documentElement.lang).toBe('zh')

    act(() => listeners.settingsChanged?.({
      ...nextSettings,
      appearance: { version: 2, activeSkinId: DEFAULT_APPEARANCE_PREFERENCES.activeSkinId, language: 'en' }
    }))
    expect(document.documentElement.lang).toBe('en')
  })
})

describe('App update flow', () => {
  it('shows manual-download and restart actions from main-process update states', async () => {
    await i18n.changeLanguage('en')
    const { api, listeners } = setupApi()
    await renderBootstrappedApp()

    act(() => listeners.updateState?.({
      status: 'available',
      capability: 'downloadOnly',
      packageType: 'portable',
      currentVersion: '0.1.0',
      targetVersion: '0.2.0',
      releaseNotes: '<script>plain release note</script>'
    }))

    expect(screen.getByRole('heading', { name: 'CLILoom v0.2.0 is available' })).toBeTruthy()
    expect(screen.getByText('<script>plain release note</script>')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'View update' }))
    await waitFor(() => expect(api.openUpdateRelease).toHaveBeenCalledOnce())

    act(() => listeners.updateState?.({
      status: 'downloaded',
      capability: 'installable',
      packageType: 'nsis',
      currentVersion: '0.1.0',
      targetVersion: '0.2.0',
      releaseNotes: 'Ready to install'
    }))

    expect(screen.getByText(/not code-signed/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Restart and update' }))
    await waitFor(() => expect(api.installUpdate).toHaveBeenCalledOnce())
  })

  it('reports an explicit up-to-date result after a manual check', async () => {
    await i18n.changeLanguage('en')
    const { listeners } = setupApi()
    await renderBootstrappedApp()

    act(() => listeners.updateState?.({
      status: 'checking',
      capability: 'installable',
      packageType: 'nsis',
      currentVersion: '0.1.0'
    }))
    act(() => listeners.updateState?.({
      status: 'upToDate',
      capability: 'installable',
      packageType: 'nsis',
      currentVersion: '0.1.0'
    }))

    expect(toast.success).toHaveBeenCalledWith('CLILoom v0.1.0 is up to date.')
  })

  it('keeps a dismissed download dialog closed until the update is ready', async () => {
    await i18n.changeLanguage('en')
    const { listeners } = setupApi()
    await renderBootstrappedApp()

    act(() => listeners.updateState?.({
      status: 'available',
      capability: 'installable',
      packageType: 'appimage',
      currentVersion: '0.1.0',
      targetVersion: '0.2.0'
    }))
    fireEvent.click(screen.getByRole('button', { name: 'Later' }))
    expect(screen.queryByRole('heading', { name: 'CLILoom v0.2.0 is available' })).toBeNull()

    act(() => listeners.updateState?.({
      status: 'downloading',
      capability: 'installable',
      packageType: 'appimage',
      currentVersion: '0.1.0',
      targetVersion: '0.2.0',
      progress: { percent: 25, bytesPerSecond: 1, transferred: 1, total: 4 }
    }))
    expect(screen.queryByRole('heading', { name: 'CLILoom v0.2.0 is available' })).toBeNull()

    act(() => listeners.updateState?.({
      status: 'downloaded',
      capability: 'installable',
      packageType: 'appimage',
      currentVersion: '0.1.0',
      targetVersion: '0.2.0'
    }))
    expect(screen.getByRole('heading', { name: 'CLILoom v0.2.0 is ready' })).toBeTruthy()
  })
})

describe('App task pagination', () => {
  it('shows tasks in batches of ten', async () => {
    const tasks = taskRecords(project, 25)
    setupApi({ data: bootstrap(tasks) })

    await renderBootstrappedApp()

    expect(await screen.findByRole('button', { name: '加载 任务 10' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '加载 任务 11' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '查看更多' }))

    expect(await screen.findByRole('button', { name: '加载 任务 20' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '加载 任务 21' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '查看更多' }))

    expect(await screen.findByRole('button', { name: '加载 任务 25' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '查看更多' })).toBeNull()
  })

  it('expands through the restored task batch on startup', async () => {
    const tasks = taskRecords(project, 25)
    const data = bootstrap(tasks)
    data.lastOpenedWorkspace = {
      projectId: project.id,
      taskId: tasks[10].id
    }
    setupApi({ data })

    await renderBootstrappedApp()

    expect(await screen.findByRole('button', { name: '加载 任务 11' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '加载 任务 20' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '加载 任务 21' })).toBeNull()
    expect(screen.getByRole('button', { name: '查看更多' })).toBeTruthy()
  })

  it('resets the visible task count when switching projects', async () => {
    const projectTasks = taskRecords(project, 25, '项目一任务')
    const otherProjectTasks = taskRecords(otherProject, 25, '项目二任务')
    const data = bootstrap(projectTasks)
    data.projects = [project, otherProject]
    const { api } = setupApi({ data })
    api.listTasks.mockImplementation((projectId: string) => Promise.resolve(
      projectId === otherProject.id ? otherProjectTasks : projectTasks
    ))

    await renderBootstrappedApp()
    expect(await screen.findByRole('button', { name: '加载 项目一任务 10' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '查看更多' }))
    expect(await screen.findByRole('button', { name: '加载 项目一任务 20' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '切换项目 Other Project' }))

    expect(await screen.findByRole('button', { name: '加载 项目二任务 10' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '加载 项目二任务 11' })).toBeNull()
    expect(screen.queryByRole('button', { name: '加载 项目一任务 20' })).toBeNull()
    expect(screen.getByRole('button', { name: '查看更多' })).toBeTruthy()
  })
})

describe('App project renaming', () => {
  it('persists the trimmed name and updates the project UI without changing its identity', async () => {
    const { api } = setupApi()
    await renderBootstrappedApp()

    fireEvent.click(screen.getByRole('button', { name: '重命名项目 Project' }))

    await waitFor(() => expect(api.renameProject).toHaveBeenCalledWith(project.id, 'Renamed project'))
    expect(screen.getByRole('button', { name: '切换项目 Renamed project' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '切换项目 Project' })).toBeNull()
  })
})

describe('App task workflow selection', () => {
  it('shows the project default workflow selector only after explicitly starting a new task', async () => {
    setupApi()
    const newTaskButton = await renderBootstrappedApp()

    expect(screen.queryByLabelText('Select workflow')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '修改变量' }))
    expect(screen.queryByLabelText('Select workflow')).toBeNull()

    fireEvent.click(newTaskButton)

    expect((await screen.findByLabelText('Select workflow')).getAttribute('title')).toBe('流程 A')
  })

  it('restores a project draft only when New task is clicked', async () => {
    const cachedDraft = taskDraft(project.id, workflowA, { prompt: 'cached prompt' }, 7)
    const { api } = setupApi({ drafts: { [project.id]: cachedDraft } })
    const newTaskButton = await renderBootstrappedApp()

    expect(screen.getByTestId('variables').textContent).toContain('default a')
    expect(api.getTaskDraft).not.toHaveBeenCalled()

    fireEvent.click(newTaskButton)

    await waitFor(() => expect(api.getTaskDraft).toHaveBeenCalledWith(project.id))
    await waitFor(() => expect(screen.getByTestId('variables').textContent).toContain('cached prompt'))
  })

  it('keeps drafts scoped to a project while switching projects', async () => {
    const data = bootstrap()
    data.projects = [project, otherProject]
    const { api } = setupApi({
      data,
      drafts: { [project.id]: taskDraft(project.id, workflowA, { prompt: 'project one' }) }
    })

    await renderBootstrappedApp()
    fireEvent.click(screen.getByRole('button', { name: '新建任务' }))
    await waitFor(() => expect(screen.getByTestId('variables').textContent).toContain('project one'))

    fireEvent.click(screen.getByRole('button', { name: '切换项目 Other Project' }))
    await waitFor(() => expect(api.listTasks).toHaveBeenCalledWith(otherProject.id))
    expect(api.getTaskDraft).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: '切换项目 Project' }))
    await waitFor(() => expect(api.listTasks).toHaveBeenCalledWith(project.id))
    expect(api.getTaskDraft).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: '新建任务' }))
    await waitFor(() => expect(api.getTaskDraft).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByTestId('variables').textContent).toContain('project one'))
  })

  it('flushes a debounced draft edit before switching projects', async () => {
    const data = bootstrap()
    data.projects = [project, otherProject]
    const { api, draftStore } = setupApi({ data, drafts: {} })
    const newTaskButton = await renderBootstrappedApp()
    fireEvent.click(newTaskButton)
    await waitFor(() => expect(draftStore.get(project.id)?.variables).toEqual({ prompt: 'default a' }))
    const callsBeforeEdit = api.saveTaskDraft.mock.calls.length

    fireEvent.click(screen.getByRole('button', { name: '修改变量' }))
    expect(api.saveTaskDraft).toHaveBeenCalledTimes(callsBeforeEdit)
    fireEvent.click(screen.getByRole('button', { name: '切换项目 Other Project' }))

    await waitFor(() => expect(api.listTasks).toHaveBeenCalledWith(otherProject.id))
    expect(draftStore.get(project.id)?.variables).toEqual({ prompt: 'edited prompt' })
  })

  it('replaces an existing draft with fresh defaults when New task is clicked again', async () => {
    const cachedDraft = taskDraft(project.id, workflowA, { prompt: 'old draft' }, 3)
    const { draftStore } = setupApi({ drafts: { [project.id]: cachedDraft } })
    const newTaskButton = await renderBootstrappedApp()

    fireEvent.click(newTaskButton)
    await waitFor(() => expect(screen.getByTestId('variables').textContent).toContain('old draft'))

    fireEvent.click(newTaskButton)

    await waitFor(() => expect(screen.getByTestId('variables').textContent).toContain('default a'))
    await waitFor(() => expect(draftStore.get(project.id)?.variables).toEqual({ prompt: 'default a' }))
  })

  it('overwrites an existing draft when New task is clicked again before the first lookup finishes', async () => {
    const cachedDraft = taskDraft(project.id, workflowA, { prompt: 'old draft' }, 9)
    const { api, draftStore } = setupApi({ drafts: { [project.id]: cachedDraft } })
    const pendingLookup = deferred<TaskDraftRecord | null>()
    api.getTaskDraft.mockReturnValueOnce(pendingLookup.promise)
    const newTaskButton = await renderBootstrappedApp()

    fireEvent.click(newTaskButton)
    fireEvent.click(newTaskButton)

    await waitFor(() => expect(screen.getByTestId('variables').textContent).toContain('default a'))
    await waitFor(() => expect(draftStore.get(project.id)?.variables).toEqual({ prompt: 'default a' }))

    await act(async () => {
      pendingLookup.resolve(cachedDraft)
      await pendingLookup.promise
    })
    expect(screen.getByTestId('variables').textContent).toContain('default a')
    expect(draftStore.get(project.id)?.variables).toEqual({ prompt: 'default a' })
  })

  it('restores matching draft fields from the latest workflow definition', async () => {
    const latestWorkflow: WorkflowDefinition = {
      ...workflowA,
      nodes: workflowA.nodes.map((node) => {
        if (node.type !== 'start') return node
        const variables = (node.config as { variables: VariableDefinition[] }).variables
        return {
          ...node,
          config: {
            variables: [
              ...variables,
              {
                key: 'count',
                label: 'Count',
                type: 'number' as const,
                required: false,
                defaultValue: 9
              }
            ]
          }
        }
      })
    }
    const data = bootstrap()
    data.workflows = [latestWorkflow, workflowB]
    data.workflowRecords = [record(latestWorkflow), record(workflowB)]
    const { draftStore } = setupApi({
      data,
      drafts: {
        [project.id]: taskDraft(project.id, workflowA, {
          prompt: 'keep this',
          count: 'wrong type'
        })
      }
    })

    const newTaskButton = await renderBootstrappedApp()
    fireEvent.click(newTaskButton)

    await waitFor(() => expect(screen.getByTestId('variables').textContent).toContain('keep this'))
    expect(screen.getByTestId('variables').textContent).toContain('9')
    await waitFor(() => expect(draftStore.get(project.id)?.variables).toEqual({ prompt: 'keep this', count: 9 }))
  })

  it('flushes the active draft before the main process closes the window', async () => {
    const { api, draftStore, listeners } = setupApi({ drafts: {} })
    const newTaskButton = await renderBootstrappedApp()
    fireEvent.click(newTaskButton)
    await waitFor(() => expect(draftStore.get(project.id)?.variables).toEqual({ prompt: 'default a' }))
    const callsBeforeEdit = api.saveTaskDraft.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: '修改变量' }))

    expect(api.saveTaskDraft).toHaveBeenCalledTimes(callsBeforeEdit)

    act(() => listeners.prepareToClose?.())

    await waitFor(() => expect(api.rendererReadyToClose).toHaveBeenCalledOnce())
    expect(api.saveTaskDraft.mock.calls.at(-1)?.[0]).toBe(project.id)
    expect(api.saveTaskDraft.mock.calls.at(-1)?.[1].variables).toEqual({ prompt: 'edited prompt' })
    expect(draftStore.get(project.id)?.variables).toEqual({ prompt: 'edited prompt' })
  })

  it('debounces consecutive variable edits into one draft save', async () => {
    const { api } = setupApi({ drafts: {} })
    const newTaskButton = await renderBootstrappedApp()
    fireEvent.click(newTaskButton)
    await waitFor(() => expect(api.saveTaskDraft).toHaveBeenCalled())
    const callsBeforeEdit = api.saveTaskDraft.mock.calls.length

    fireEvent.click(screen.getByRole('button', { name: '修改变量' }))
    fireEvent.click(screen.getByRole('button', { name: '修改变量' }))
    fireEvent.click(screen.getByRole('button', { name: '修改变量' }))

    expect(api.saveTaskDraft).toHaveBeenCalledTimes(callsBeforeEdit)
    await new Promise((resolve) => setTimeout(resolve, 350))
    await waitFor(() => expect(api.saveTaskDraft).toHaveBeenCalledTimes(callsBeforeEdit + 1))
    expect(api.saveTaskDraft.mock.calls.at(-1)?.[1].variables).toEqual({ prompt: 'edited prompt' })
  })

  it('keeps an unstarted draft out of the task list and adds it after a successful launch', async () => {
    const { api, listeners } = setupApi({ drafts: {} })
    let startedTask: TaskRecord | null = null
    api.startWorkflow.mockImplementation((request: WorkflowRuntimeStartOptions) => {
      const now = '2026-08-05T00:00:00.000Z'
      const task: TaskRecord = {
        id: request.taskId,
        project_id: request.projectId,
        title: '已发起任务',
        status: 'running',
        created_at: now,
        updated_at: now
      }
      startedTask = task
      return Promise.resolve(runtimeState(request.taskId, request.workflow, task))
    })
    const newTaskButton = await renderBootstrappedApp()

    fireEvent.click(newTaskButton)

    expect(screen.queryByTestId('draft-task')).toBeNull()
    expect(screen.queryByRole('button', { name: '加载 已发起任务' })).toBeNull()
    await waitFor(() => expect(api.saveTaskDraft).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: '运行' }))

    const startedTaskButton = await screen.findByRole('button', { name: '加载 已发起任务' })
    expect(startedTaskButton.getAttribute('data-task-status')).toBe('running')
    await waitFor(() => expect(api.deleteTaskDraft).toHaveBeenCalledWith(project.id))

    const waitingTask: TaskRecord = { ...startedTask!, status: 'waiting-input' }
    act(() => listeners.workflowState?.({
      ...runtimeState(waitingTask.id, workflowA, waitingTask),
      status: 'waiting-input'
    }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '加载 已发起任务' }).getAttribute('data-task-status')).toBe('waiting-input')
    })

    expect(screen.getByTitle('已发起任务')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '重命名 已发起任务' }))
    await waitFor(() => expect(screen.getByTitle('手动名称')).toBeTruthy())
    expect(api.updateTaskTitle).toHaveBeenCalledWith(waitingTask.id, '手动名称')
  })

  it('deletes a launched draft even when its runtime state arrives after task navigation', async () => {
    const existingTask = taskRecords(project, 1, 'Existing')[0]
    const data = bootstrap([existingTask])
    const { api } = setupApi({ data, drafts: {} })
    const pendingStart = deferred<WorkflowRuntimeState>()
    api.startWorkflow.mockReturnValueOnce(pendingStart.promise)
    const newTaskButton = await renderBootstrappedApp()
    fireEvent.click(newTaskButton)
    await waitFor(() => expect(api.saveTaskDraft).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: '运行' }))
    await waitFor(() => expect(api.startWorkflow).toHaveBeenCalledOnce())
    const request = api.startWorkflow.mock.calls[0][0]
    fireEvent.click(screen.getByRole('button', { name: `加载 ${existingTask.title}` }))
    await waitFor(() => expect(api.restoreWorkflowState).toHaveBeenCalledWith(existingTask.id))

    const now = '2026-08-05T00:00:00.000Z'
    const launchedTask: TaskRecord = {
      id: request.taskId,
      project_id: request.projectId,
      title: '后台启动任务',
      status: 'running',
      created_at: now,
      updated_at: now
    }
    await act(async () => {
      pendingStart.resolve(runtimeState(request.taskId, request.workflow, launchedTask))
      await pendingStart.promise
    })

    await waitFor(() => expect(api.deleteTaskDraft).toHaveBeenCalledWith(project.id))
    expect(screen.getByRole('button', { name: `加载 ${existingTask.title}` })).toBeTruthy()
  })

  it('keeps a newer draft when an earlier launch finishes late', async () => {
    const { api, draftStore } = setupApi({ drafts: {} })
    const pendingStart = deferred<WorkflowRuntimeState>()
    api.startWorkflow.mockReturnValueOnce(pendingStart.promise)
    const newTaskButton = await renderBootstrappedApp()
    fireEvent.click(newTaskButton)
    await waitFor(() => expect(api.saveTaskDraft).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: '运行' }))
    await waitFor(() => expect(api.startWorkflow).toHaveBeenCalledOnce())
    const request = api.startWorkflow.mock.calls[0][0]
    fireEvent.click(newTaskButton)
    await waitFor(() => expect(api.saveTaskDraft.mock.calls.at(-1)?.[2]).toBe(true))

    const now = '2026-08-05T00:00:00.000Z'
    const launchedTask: TaskRecord = {
      id: request.taskId,
      project_id: request.projectId,
      title: '迟到的任务',
      status: 'running',
      created_at: now,
      updated_at: now
    }
    await act(async () => {
      pendingStart.resolve(runtimeState(request.taskId, request.workflow, launchedTask))
      await pendingStart.promise
    })

    expect(api.deleteTaskDraft).not.toHaveBeenCalled()
    expect(draftStore.get(project.id)?.variables).toEqual({ prompt: 'default a' })
  })

  it('keeps Stop workflow available while running and waiting for input', async () => {
    const { api, listeners } = setupApi()
    api.startWorkflow.mockImplementation((request: WorkflowRuntimeStartOptions) => {
      const now = '2026-08-05T00:00:00.000Z'
      const task: TaskRecord = {
        id: request.taskId,
        project_id: request.projectId,
        title: '可停止任务',
        status: 'running',
        created_at: now,
        updated_at: now
      }
      return Promise.resolve(runtimeState(request.taskId, request.workflow, task))
    })
    const newTaskButton = await renderBootstrappedApp()
    fireEvent.click(newTaskButton)
    fireEvent.click(screen.getByRole('button', { name: '运行' }))

    const stopButton = await screen.findByRole('button', { name: 'Stop workflow' })
    const runningTaskId = api.startWorkflow.mock.calls[0][0].taskId
    act(() => listeners.workflowState?.({
      ...runtimeState(runningTaskId, workflowA),
      status: 'waiting-input',
      currentNodeId: workflowA.nodes[1].id,
      nodeRuns: {
        [workflowA.nodes[1].id]: {
          nodeId: workflowA.nodes[1].id,
          status: 'waiting-input'
        }
      }
    }))

    expect(screen.getByRole('button', { name: 'Stop workflow' })).toBe(stopButton)
    fireEvent.click(stopButton)
    expect(api.stopWorkflow).toHaveBeenCalledWith(runningTaskId)
  })

  it('retries the current failed node and applies the returned workflow state', async () => {
    const task: TaskRecord = {
      id: 'retry-node-task',
      project_id: project.id,
      title: 'Retry node task',
      status: 'failed',
      created_at: '2026-08-05T00:00:00.000Z',
      updated_at: '2026-08-05T00:00:00.000Z'
    }
    const retryWorkflow: WorkflowDefinition = {
      id: 'retry-node-workflow',
      name: 'Retry node workflow',
      nodes: [
        { id: 'start', type: 'start', name: 'Start', config: { variables: [] } },
        { id: 'gate', type: 'exclusive-gateway', name: 'Gate', config: {} },
        { id: 'end', type: 'end', name: 'End after retry', config: {} }
      ],
      edges: [
        { id: 'start-gate', from: 'start', to: 'gate' },
        { id: 'gate-end', from: 'gate', to: 'end', isDefault: true }
      ]
    }
    const failedState: WorkflowRuntimeState = {
      taskId: task.id,
      projectId: project.id,
      projectDir: project.path,
      workflowId: retryWorkflow.id,
      status: 'failed',
      currentNodeId: 'gate',
      variables: {},
      nodeRuns: {
        start: { nodeId: 'start', status: 'completed' },
        gate: { nodeId: 'gate', status: 'failed', stderr: 'old failure' }
      },
      executionOrder: ['start', 'gate'],
      activeBranches: [],
      branchRuns: {},
      parallelResults: {},
      workflowCompleted: false,
      error: 'old failure',
      task
    }
    const completedTask = { ...task, status: 'completed' as const }
    const completedState: WorkflowRuntimeState = {
      ...failedState,
      status: 'completed',
      currentNodeId: 'end',
      nodeRuns: {
        start: { nodeId: 'start', status: 'completed' },
        gate: { nodeId: 'gate', status: 'completed' },
        end: { nodeId: 'end', status: 'completed' }
      },
      executionOrder: ['start', 'gate', 'end'],
      workflowCompleted: true,
      error: undefined,
      task: completedTask
    }
    const { api } = setupApi({
      data: bootstrap([task]),
      restore: { state: failedState, workflow: retryWorkflow }
    })
    api.retryWorkflowNode.mockResolvedValue(completedState)
    await renderBootstrappedApp()
    fireEvent.click(await screen.findByRole('button', { name: '加载 Retry node task' }))

    fireEvent.click(await screen.findByRole('button', { name: '重试节点 gate' }))

    await waitFor(() => expect(api.retryWorkflowNode).toHaveBeenCalledWith(
      task.id,
      'gate',
      undefined
    ))
    await waitFor(() => expect(screen.getByTestId('node-detail').textContent)
      .toContain('End after retry'))
    expect(screen.getByRole('button', { name: '加载 Retry node task' })
      .getAttribute('data-task-status')).toBe('completed')
  })

  it('passes the branch id when retrying a failed parallel branch node', async () => {
    const task: TaskRecord = {
      id: 'retry-branch-task',
      project_id: project.id,
      title: 'Retry branch task',
      status: 'failed',
      created_at: '2026-08-05T00:00:00.000Z',
      updated_at: '2026-08-05T00:00:00.000Z'
    }
    const retryWorkflow: WorkflowDefinition = {
      id: 'retry-branch-workflow',
      name: 'Retry branch workflow',
      nodes: [
        { id: 'start', type: 'start', name: 'Start', config: { variables: [] } },
        { id: 'split', type: 'parallel-gateway', name: 'Split', config: { mode: 'split' } },
        { id: 'gate', type: 'exclusive-gateway', name: 'Gate', config: {} },
        { id: 'other', type: 'non-interactive-terminal', name: 'Other', config: { command: 'other', cwd: '/repo', successExitCodes: [0] } },
        { id: 'join', type: 'parallel-gateway', name: 'Join', config: { mode: 'join', joinIncomingEdgeIds: ['gate-join', 'other-join'] } },
        { id: 'end', type: 'end', name: 'End after branch retry', config: {} }
      ],
      edges: [
        { id: 'start-split', from: 'start', to: 'split' },
        { id: 'split-gate', from: 'split', to: 'gate' },
        { id: 'split-other', from: 'split', to: 'other' },
        { id: 'gate-join', from: 'gate', to: 'join', isDefault: true },
        { id: 'other-join', from: 'other', to: 'join' },
        { id: 'join-end', from: 'join', to: 'end' }
      ]
    }
    const gateBranchId = 'split:split-gate'
    const otherBranchId = 'split:split-other'
    const failedState: WorkflowRuntimeState = {
      taskId: task.id,
      projectId: project.id,
      projectDir: project.path,
      workflowId: retryWorkflow.id,
      status: 'failed',
      currentNodeId: 'split',
      variables: {},
      nodeRuns: {
        start: { nodeId: 'start', status: 'completed' },
        split: { nodeId: 'split', status: 'completed' },
        gate: { nodeId: 'gate', status: 'failed', stderr: 'old failure' },
        other: { nodeId: 'other', status: 'completed', sessionId: 'session-other' }
      },
      executionOrder: ['start', 'split', 'gate', 'other'],
      activeBranches: [],
      branchRuns: {
        [gateBranchId]: {
          branchId: gateBranchId,
          splitNodeId: 'split',
          entryEdgeId: 'split-gate',
          entryNodeId: 'gate',
          currentNodeId: 'gate',
          status: 'failed',
          nodeIds: ['gate'],
          variables: {},
          error: 'old failure'
        },
        [otherBranchId]: {
          branchId: otherBranchId,
          splitNodeId: 'split',
          entryEdgeId: 'split-other',
          entryNodeId: 'other',
          currentNodeId: 'join',
          status: 'completed',
          nodeIds: ['other'],
          reachedJoinEdgeId: 'other-join',
          reachedJoinNodeId: 'join',
          variables: {}
        }
      },
      parallelResults: {},
      workflowCompleted: false,
      error: 'old failure',
      task
    }
    const completedState: WorkflowRuntimeState = {
      ...failedState,
      status: 'completed',
      currentNodeId: 'end',
      nodeRuns: {
        ...failedState.nodeRuns,
        gate: { nodeId: 'gate', status: 'completed' },
        join: { nodeId: 'join', status: 'completed' },
        end: { nodeId: 'end', status: 'completed' }
      },
      branchRuns: {
        ...failedState.branchRuns,
        [gateBranchId]: {
          ...failedState.branchRuns[gateBranchId],
          currentNodeId: 'join',
          status: 'completed',
          reachedJoinEdgeId: 'gate-join',
          reachedJoinNodeId: 'join',
          error: undefined
        }
      },
      workflowCompleted: true,
      error: undefined,
      task: { ...task, status: 'completed' }
    }
    const { api } = setupApi({
      data: bootstrap([task]),
      restore: { state: failedState, workflow: retryWorkflow }
    })
    api.retryWorkflowNode.mockResolvedValue(completedState)
    await renderBootstrappedApp()
    fireEvent.click(await screen.findByRole('button', { name: '加载 Retry branch task' }))

    fireEvent.click(await screen.findByRole('button', {
      name: `重试分支 ${gateBranchId}:gate`
    }))

    await waitFor(() => expect(api.retryWorkflowNode).toHaveBeenCalledWith(
      task.id,
      'gate',
      gateBranchId
    ))
    await waitFor(() => expect(screen.getByTestId('node-detail').textContent)
      .toContain('End after branch retry'))
  })

  it('switches an untouched draft immediately without changing the project default', async () => {
    const { api } = setupApi()
    const newTaskButton = await renderBootstrappedApp()
    fireEvent.click(newTaskButton)

    fireEvent.click(screen.getByRole('button', { name: '流程 B' }))

    await waitFor(() => expect(screen.getByLabelText('Select workflow').getAttribute('title')).toBe('流程 B'))
    expect(screen.getByTestId('variables').textContent).toBe('{"prompt":"default b"}')
    expect(screen.getByText('流程 B Start')).toBeTruthy()
    expect(screen.getByText('3 nodes · 2 edges')).toBeTruthy()
    expect(api.setProjectDefaultWorkflow).not.toHaveBeenCalled()
  })

  it('requires confirmation before discarding modified variables', async () => {
    setupApi()
    const newTaskButton = await renderBootstrappedApp()
    fireEvent.click(newTaskButton)
    fireEvent.click(screen.getByRole('button', { name: '修改变量' }))
    fireEvent.click(screen.getByRole('button', { name: '流程 B' }))

    expect((await screen.findByRole('alertdialog')).textContent).toContain('Switch workflow?')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByLabelText('Select workflow').getAttribute('title')).toBe('流程 A')
    expect(screen.getByTestId('variables').textContent).toBe('{"prompt":"edited prompt"}')

    fireEvent.click(screen.getByRole('button', { name: '流程 B' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm switch' }))

    await waitFor(() => expect(screen.getByLabelText('Select workflow').getAttribute('title')).toBe('流程 B'))
    expect(screen.getByTestId('variables').textContent).toBe('{"prompt":"default b"}')
  })

  it('resolves a confirmed switch from the latest catalog while an event refresh is pending', async () => {
    const catalogRefresh = deferred<WorkflowRecord[]>()
    const { api, listeners, setWorkflowRecords } = setupApi()
    const newTaskButton = await renderBootstrappedApp()
    fireEvent.click(newTaskButton)
    fireEvent.click(screen.getByRole('button', { name: '修改变量' }))
    fireEvent.click(screen.getByRole('button', { name: '流程 B' }))
    await screen.findByRole('alertdialog')

    const latestWorkflowB = workflow('workflow-b', '流程 B 最新版本', 'latest b', true)
    const latestRecords = [record(workflowA), record(latestWorkflowB, 2)]
    setWorkflowRecords(latestRecords)
    api.listWorkflows.mockReturnValueOnce(catalogRefresh.promise)
    act(() => listeners.workflowChanged?.({ operation: 'updated', id: workflowB.id }))
    expect(api.listWorkflows).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Confirm switch' }))

    await waitFor(() => {
      expect(screen.getByLabelText('Select workflow').getAttribute('title')).toBe('流程 B 最新版本')
    })
    expect(screen.getByTestId('variables').textContent).toBe('{"prompt":"latest b"}')
    expect(api.listWorkflows).toHaveBeenCalledTimes(2)

    await act(async () => {
      catalogRefresh.resolve(latestRecords)
      await catalogRefresh.promise
    })
  })

  it('keeps the current draft when the confirmation catalog lookup fails', async () => {
    const { api } = setupApi()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const newTaskButton = await renderBootstrappedApp()
    fireEvent.click(newTaskButton)
    fireEvent.click(screen.getByRole('button', { name: '修改变量' }))
    fireEvent.click(screen.getByRole('button', { name: '流程 B' }))
    await screen.findByRole('alertdialog')
    api.listWorkflows.mockRejectedValueOnce(new Error('catalog unavailable'))

    fireEvent.click(screen.getByRole('button', { name: 'Confirm switch' }))

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(screen.getByLabelText('Select workflow').getAttribute('title')).toBe('流程 A')
    expect(screen.getByTestId('variables').textContent).toBe('{"prompt":"edited prompt"}')
  })

  it('clears a pending switch during startup and refreshes the draft definition after failure', async () => {
    const startup = deferred<WorkflowRuntimeState | undefined>()
    const { api, listeners, setWorkflowRecords } = setupApi()
    api.startWorkflow.mockReturnValueOnce(startup.promise)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const newTaskButton = await renderBootstrappedApp()
    fireEvent.click(newTaskButton)
    fireEvent.click(screen.getByRole('button', { name: '修改变量' }))
    fireEvent.click(screen.getByRole('button', { name: '流程 B' }))
    await screen.findByRole('alertdialog')

    fireEvent.click(screen.getByRole('button', { name: '运行' }))
    await waitFor(() => expect(screen.queryByLabelText('Select workflow')).toBeNull())
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.getByTitle('流程 A')).toBeTruthy()

    const latestWorkflowA = workflow('workflow-a', '流程 A 最新版本', 'latest a', true)
    setWorkflowRecords([record(latestWorkflowA, 2), record(workflowB)])
    await act(async () => {
      listeners.workflowChanged?.({ operation: 'updated', id: workflowA.id })
      await Promise.resolve()
    })
    expect(api.listWorkflows).toHaveBeenCalled()
    expect(screen.getByTitle('流程 A')).toBeTruthy()

    await act(async () => {
      startup.reject(new Error('startup failed'))
      await startup.promise.catch(() => {})
    })

    expect((await screen.findByLabelText('Select workflow')).getAttribute('title')).toBe('流程 A 最新版本')
    expect(screen.getByTestId('variables').textContent).toBe('{"prompt":"edited prompt"}')
    expect(screen.getByText('流程 A 最新版本 Start')).toBeTruthy()
    expect(screen.getByText('3 nodes · 2 edges')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^加载 / })).toBeNull()
  })

  it('ignores runtime broadcasts from another task while a new draft is active', async () => {
    const { listeners } = setupApi()
    const newTaskButton = await renderBootstrappedApp()
    fireEvent.click(newTaskButton)
    await screen.findByLabelText('Select workflow')

    act(() => listeners.workflowState?.(runtimeState('other-task', workflowB)))

    expect(screen.getByLabelText('Select workflow').getAttribute('title')).toBe('流程 A')
  })

  it('cancels a pending switch immediately when the target workflow is deleted', async () => {
    const catalogRefresh = deferred<WorkflowRecord[]>()
    const { api, listeners, setWorkflowRecords } = setupApi()
    const newTaskButton = await renderBootstrappedApp()
    fireEvent.click(newTaskButton)
    fireEvent.click(screen.getByRole('button', { name: '修改变量' }))
    fireEvent.click(screen.getByRole('button', { name: '流程 B' }))
    await screen.findByRole('alertdialog')

    setWorkflowRecords([record(workflowA)])
    api.listWorkflows.mockReturnValueOnce(catalogRefresh.promise)
    act(() => listeners.workflowChanged?.({ operation: 'deleted', id: workflowB.id }))

    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.getByLabelText('Select workflow').getAttribute('title')).toBe('流程 A')
    expect(screen.getByTestId('variables').textContent).toBe('{"prompt":"edited prompt"}')

    await act(async () => {
      catalogRefresh.resolve([record(workflowA)])
      await catalogRefresh.promise
    })
  })

  it('refreshes an updated draft workflow definition without resetting its variables', async () => {
    const { listeners, setWorkflowRecords } = setupApi()
    const newTaskButton = await renderBootstrappedApp()
    fireEvent.click(newTaskButton)
    fireEvent.click(screen.getByRole('button', { name: '修改变量' }))

    const latestWorkflowA = workflow('workflow-a', '流程 A 最新版本', 'latest a', true)
    setWorkflowRecords([record(latestWorkflowA, 2), record(workflowB)])
    await act(async () => {
      listeners.workflowChanged?.({ operation: 'updated', id: workflowA.id })
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(screen.getByLabelText('Select workflow').getAttribute('title')).toBe('流程 A 最新版本')
    })
    expect(screen.getByTestId('variables').textContent).toBe('{"prompt":"edited prompt"}')
    expect(screen.getByText('流程 A 最新版本 Start')).toBeTruthy()
    expect(screen.getByText('3 nodes · 2 edges')).toBeTruthy()
  })

  it('preserves a deleted draft workflow until the user confirms another workflow', async () => {
    const { listeners, setWorkflowRecords } = setupApi()
    const newTaskButton = await renderBootstrappedApp()
    fireEvent.click(newTaskButton)
    fireEvent.click(screen.getByRole('button', { name: '修改变量' }))

    setWorkflowRecords([record(workflowB)])
    await act(async () => {
      listeners.workflowChanged?.({ operation: 'deleted', id: workflowA.id })
      await Promise.resolve()
    })

    const deletedWorkflowItem = await screen.findByRole('button', { name: '流程 A (deleted)' })
    expect((deletedWorkflowItem as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByLabelText('Select workflow').getAttribute('title')).toBe('流程 A')
    expect(screen.getByTestId('variables').textContent).toBe('{"prompt":"edited prompt"}')
    expect(screen.getByText('流程 A Start')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '流程 B' }))
    await screen.findByRole('alertdialog')
    fireEvent.click(screen.getByRole('button', { name: 'Confirm switch' }))

    await waitFor(() => expect(screen.getByLabelText('Select workflow').getAttribute('title')).toBe('流程 B'))
    expect(screen.getByTestId('variables').textContent).toBe('{"prompt":"default b"}')
  })

  it('clears a pending switch when the user changes projects', async () => {
    const data = bootstrap()
    data.projects = [project, otherProject]
    setupApi({ data })
    const newTaskButton = await renderBootstrappedApp()
    fireEvent.click(newTaskButton)
    fireEvent.click(screen.getByRole('button', { name: '修改变量' }))
    fireEvent.click(screen.getByRole('button', { name: '流程 B' }))
    await screen.findByRole('alertdialog')

    fireEvent.click(screen.getByRole('button', { name: '切换项目 Other Project' }))

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(screen.queryByLabelText('Select workflow')).toBeNull()
    expect(screen.getByTitle('流程 B')).toBeTruthy()
  })
})

describe('App workflow designer', () => {
  it('renders repeated validation issues without duplicate React keys', async () => {
    setupApi()
    await renderBootstrappedApp()

    fireEvent.click(screen.getByRole('button', { name: '打开工作流设计器' }))
    const designer = await screen.findByRole('dialog')
    const canvas = designer.querySelector('.workflow-designer__canvas')
    expect(canvas).toBeTruthy()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    for (const [index, type] of ['start', 'interactive-terminal', 'interactive-terminal', 'end'].entries()) {
      fireEvent.drop(canvas!, {
        clientX: 100 + index * 220,
        clientY: 120,
        dataTransfer: { getData: () => type }
      })
    }

    await waitFor(() => expect(getLatestDesignerFlowRender()?.nodes).toHaveLength(4))
    const flow = getLatestDesignerFlowRender()!
    const start = flow.nodes.find((node) => node.data?.workflowNode?.type === 'start')!
    const terminals = flow.nodes.filter((node) => node.data?.workflowNode?.type === 'interactive-terminal')
    const end = flow.nodes.find((node) => node.data?.workflowNode?.type === 'end')!

    act(() => {
      const onConnect = getLatestDesignerFlowRender()?.onConnect
      onConnect?.({ source: start.id, sourceHandle: null, target: terminals[0].id, targetHandle: null })
      onConnect?.({ source: terminals[0].id, sourceHandle: null, target: terminals[1].id, targetHandle: null })
      onConnect?.({ source: terminals[1].id, sourceHandle: null, target: end.id, targetHandle: null })
    })

    await waitFor(() => {
      const messages = Array.from(
        within(designer).getByRole('alert').querySelectorAll('[data-slot="alert-description"] > span')
      ).map((element) => element.textContent)
      expect(messages).toEqual(terminals.map((terminal) =>
        i18n.t('errors:workflowValidation.terminalCommandEmpty', {
          name: terminal.data?.workflowNode?.name
        })
      ))
    })
    expect(consoleError.mock.calls.some(([message]) =>
      typeof message === 'string' && message.includes('same key')
    )).toBe(false)
  })

  it('saves a manually assembled start, interactive terminal, and end flow', async () => {
    const { api } = setupApi()
    await renderBootstrappedApp()

    fireEvent.click(screen.getByRole('button', { name: '打开工作流设计器' }))
    const designer = await screen.findByRole('dialog')
    const canvas = designer.querySelector('.workflow-designer__canvas')
    expect(canvas).toBeTruthy()

    for (const [index, type] of ['start', 'interactive-terminal', 'end'].entries()) {
      fireEvent.drop(canvas!, {
        clientX: 100 + index * 220,
        clientY: 120,
        dataTransfer: { getData: () => type }
      })
    }

    await waitFor(() => expect(getLatestDesignerFlowRender()?.nodes).toHaveLength(3))
    expect(within(designer).getByTestId('react-flow').dataset.connectionMode).toBe('strict')

    const flow = getLatestDesignerFlowRender()!
    const start = flow.nodes.find((node) => node.data?.workflowNode?.type === 'start')!
    const terminal = flow.nodes.find((node) => node.data?.workflowNode?.type === 'interactive-terminal')!
    const end = flow.nodes.find((node) => node.data?.workflowNode?.type === 'end')!

    act(() => {
      const onConnect = getLatestDesignerFlowRender()?.onConnect
      onConnect?.({ source: start.id, sourceHandle: null, target: terminal.id, targetHandle: null })
      onConnect?.({ source: terminal.id, sourceHandle: null, target: end.id, targetHandle: null })
    })

    const saveButton = within(designer).getByRole('button', { name: 'Save workflow' }) as HTMLButtonElement
    await waitFor(() => {
      const messages = Array.from(
        within(designer).getByRole('alert').querySelectorAll('[data-slot="alert-description"] > span')
      ).map((element) => element.textContent)
      expect(messages).toEqual([
        i18n.t('errors:workflowValidation.terminalCommandEmpty', {
          name: terminal.data?.workflowNode?.name
        })
      ])
    })
    expect(saveButton.disabled).toBe(true)

    fireEvent.click(within(designer).getByRole('button', { name: `Select flow node ${terminal.id}` }))
    fireEvent.click(await within(designer).findByRole('button', { name: 'Set terminal command' }))

    await waitFor(() => expect(saveButton.disabled).toBe(false))
    expect(within(designer).queryByRole('alert')).toBeNull()
    fireEvent.click(saveButton)

    await waitFor(() => expect(api.saveWorkflow).toHaveBeenCalledTimes(1))
    expect(api.saveWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        nodes: expect.arrayContaining([
          expect.objectContaining({ id: start.id, type: 'start' }),
          expect.objectContaining({
            id: terminal.id,
            type: 'interactive-terminal',
            config: expect.objectContaining({ command: 'bash' })
          }),
          expect.objectContaining({ id: end.id, type: 'end' })
        ]),
        edges: [
          expect.objectContaining({ from: start.id, to: terminal.id }),
          expect.objectContaining({ from: terminal.id, to: end.id })
        ]
      }),
      undefined
    )
  })

  it('handles designer node selection notifications without repeated updates', async () => {
    setupApi()
    await renderBootstrappedApp()

    fireEvent.click(screen.getByRole('button', { name: '打开工作流设计器' }))
    const designer = await screen.findByRole('dialog')
    fireEvent.click(within(designer).getByRole('button', { name: '流程 A' }))

    await waitFor(() => expect(
      within(designer).getByTestId('designer-selection').textContent
    ).toBe('none'))

    fireEvent.click(within(designer).getByRole('button', {
      name: 'Select flow node workflow-a-end'
    }))

    await waitFor(() => expect(
      within(designer).getByTestId('designer-selection').textContent
    ).toBe('node:workflow-a-end'))

    const inspectorRenderCount = designerInspectorRender.mock.calls.length
    fireEvent.click(within(designer).getByRole('button', {
      name: 'Repeat current flow selection'
    }))

    await act(async () => {
      await Promise.resolve()
    })
    expect(designerInspectorRender).toHaveBeenCalledTimes(inspectorRenderCount)
  })

  it('keeps the designer open and clears its dirty state after a successful save', async () => {
    const { api, listeners, setWorkflowRecords } = setupApi()
    await renderBootstrappedApp()

    fireEvent.click(screen.getByRole('button', { name: '打开工作流设计器' }))
    const designer = await screen.findByRole('dialog')
    fireEvent.click(within(designer).getByRole('button', { name: '流程 A' }))
    const nameInput = within(designer).getByLabelText('Workflow name')
    fireEvent.change(nameInput, { target: { value: '流程 A 已修改' } })
    expect(within(designer).getByText('Unsaved')).toBeTruthy()

    fireEvent.click(within(designer).getByRole('button', { name: 'Save workflow' }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Workflow saved'))
    expect(api.saveWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ id: workflowA.id, name: '流程 A 已修改' }),
      1
    )
    expect(screen.getByRole('dialog')).toBe(designer)
    expect(within(designer).queryByText('Unsaved')).toBeNull()
    expect((within(designer).getByLabelText('Workflow name') as HTMLTextAreaElement).value).toBe('流程 A 已修改')

    setWorkflowRecords([
      record({ ...workflowA, name: '流程 A 事件刷新版本' }, 2),
      record(workflowB)
    ])
    await act(async () => {
      listeners.workflowChanged?.({
        operation: 'updated',
        id: workflowA.id,
        source: 'renderer'
      })
      await Promise.resolve()
    })

    await waitFor(() => expect(api.listWorkflows).toHaveBeenCalledTimes(1))
    expect((within(designer).getByLabelText('Workflow name') as HTMLTextAreaElement).value).toBe('流程 A 已修改')
  })

  it('preserves edits made while a save is pending', async () => {
    const pendingSave = deferred<WorkflowSaveResult>()
    const { api } = setupApi()
    api.saveWorkflow.mockReturnValueOnce(pendingSave.promise)
    await renderBootstrappedApp()

    fireEvent.click(screen.getByRole('button', { name: '打开工作流设计器' }))
    const designer = await screen.findByRole('dialog')
    fireEvent.click(within(designer).getByRole('button', { name: '流程 A' }))
    const nameInput = within(designer).getByLabelText('Workflow name')
    fireEvent.change(nameInput, { target: { value: '流程 A 已发起保存' } })
    fireEvent.click(within(designer).getByRole('button', { name: 'Save workflow' }))
    await waitFor(() => expect(api.saveWorkflow).toHaveBeenCalledTimes(1))

    fireEvent.change(nameInput, { target: { value: '流程 A 保存期间继续编辑' } })
    await act(async () => {
      pendingSave.resolve({
        workflow: { ...workflowA, name: '流程 A 已发起保存' },
        revision: 2,
        created: false
      })
      await pendingSave.promise
    })

    expect(screen.getByRole('dialog')).toBe(designer)
    expect((within(designer).getByLabelText('Workflow name') as HTMLTextAreaElement).value)
      .toBe('流程 A 保存期间继续编辑')
    expect(within(designer).getByText('Unsaved')).toBeTruthy()
    expect(within(designer).getByRole('button', { name: '流程 A 已发起保存' })).toBeTruthy()
    expect(toast.success).toHaveBeenCalledWith('Workflow saved')
  })

  it('does not mix workflows when the user switches while a save is pending', async () => {
    const pendingSave = deferred<WorkflowSaveResult>()
    const { api } = setupApi()
    api.saveWorkflow.mockReturnValueOnce(pendingSave.promise)
    await renderBootstrappedApp()

    fireEvent.click(screen.getByRole('button', { name: '打开工作流设计器' }))
    const designer = await screen.findByRole('dialog')
    fireEvent.click(within(designer).getByRole('button', { name: '流程 A' }))
    fireEvent.change(within(designer).getByLabelText('Workflow name'), {
      target: { value: '流程 A 已发起保存' }
    })
    fireEvent.click(within(designer).getByRole('button', { name: 'Save workflow' }))
    await waitFor(() => expect(api.saveWorkflow).toHaveBeenCalledTimes(1))

    fireEvent.click(within(designer).getByRole('button', { name: '流程 B' }))
    await act(async () => {
      pendingSave.resolve({
        workflow: { ...workflowA, name: '流程 A 已发起保存' },
        revision: 2,
        created: false
      })
      await pendingSave.promise
    })

    expect(screen.getByRole('dialog')).toBe(designer)
    expect((within(designer).getByLabelText('Workflow name') as HTMLTextAreaElement).value).toBe('流程 B')
    expect(within(designer).queryByText('Unsaved')).toBeNull()
    expect(within(designer).getByRole('button', { name: '流程 A 已发起保存' })).toBeTruthy()
    expect(toast.success).toHaveBeenCalledWith('Workflow saved')
  })

  it('keeps unsaved changes and does not report success when saving fails', async () => {
    const { api } = setupApi()
    api.saveWorkflow.mockRejectedValueOnce(new Error('save failed'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    await renderBootstrappedApp()

    fireEvent.click(screen.getByRole('button', { name: '打开工作流设计器' }))
    const designer = await screen.findByRole('dialog')
    fireEvent.click(within(designer).getByRole('button', { name: '流程 A' }))
    fireEvent.change(within(designer).getByLabelText('Workflow name'), {
      target: { value: '流程 A 保存失败' }
    })
    fireEvent.click(within(designer).getByRole('button', { name: 'Save workflow' }))

    await waitFor(() => expect(consoleError).toHaveBeenCalled())
    expect(screen.getByRole('dialog')).toBe(designer)
    expect(within(designer).getByText('Unsaved')).toBeTruthy()
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('keeps unsaved changes when saving returns no result', async () => {
    const { api } = setupApi()
    api.saveWorkflow.mockResolvedValueOnce(undefined)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    await renderBootstrappedApp()

    fireEvent.click(screen.getByRole('button', { name: '打开工作流设计器' }))
    const designer = await screen.findByRole('dialog')
    fireEvent.click(within(designer).getByRole('button', { name: '流程 A' }))
    fireEvent.change(within(designer).getByLabelText('Workflow name'), {
      target: { value: '流程 A 无保存结果' }
    })
    fireEvent.click(within(designer).getByRole('button', { name: 'Save workflow' }))

    await waitFor(() => expect(consoleError).toHaveBeenCalledWith(
      '[saveDesigner]',
      expect.objectContaining({ message: 'Saving the workflow returned no result' })
    ))
    expect(screen.getByRole('dialog')).toBe(designer)
    expect(within(designer).getByText('Unsaved')).toBeTruthy()
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('reloads a clean designer for assistant changes but preserves dirty edits', async () => {
    const { api, listeners, setWorkflowRecords } = setupApi()
    await renderBootstrappedApp()

    fireEvent.click(screen.getByRole('button', { name: '打开工作流设计器' }))
    const designer = await screen.findByRole('dialog')
    fireEvent.click(within(designer).getByRole('button', { name: '流程 A' }))

    setWorkflowRecords([
      record({ ...workflowA, name: '流程 A 助手更新' }, 2),
      record(workflowB)
    ])
    act(() => listeners.workflowChanged?.({
      operation: 'updated',
      id: workflowA.id,
      source: 'assistant'
    }))
    await waitFor(() => expect(
      (within(designer).getByLabelText('Workflow name') as HTMLTextAreaElement).value
    ).toBe('流程 A 助手更新'))

    fireEvent.change(within(designer).getByLabelText('Workflow name'), {
      target: { value: '流程 A 本地未保存' }
    })
    setWorkflowRecords([
      record({ ...workflowA, name: '流程 A 助手再次更新' }, 3),
      record(workflowB)
    ])
    act(() => listeners.workflowChanged?.({
      operation: 'updated',
      id: workflowA.id,
      source: 'assistant'
    }))

    await waitFor(() => expect(api.listWorkflows).toHaveBeenCalledTimes(2))
    expect((within(designer).getByLabelText('Workflow name') as HTMLTextAreaElement).value)
      .toBe('流程 A 本地未保存')
    expect(within(designer).getByText('Unsaved')).toBeTruthy()
  })

  it('does not replace a draft when another workflow is saved in the designer', async () => {
    const { api } = setupApi()
    const newTaskButton = await renderBootstrappedApp()
    fireEvent.click(newTaskButton)
    fireEvent.click(screen.getByRole('button', { name: '修改变量' }))

    fireEvent.click(screen.getByRole('button', { name: '打开工作流设计器' }))
    const designer = await screen.findByRole('dialog')
    fireEvent.click(within(designer).getByRole('button', { name: '流程 B' }))
    fireEvent.click(within(designer).getByRole('button', { name: 'Save workflow' }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Workflow saved'))
    expect(api.saveWorkflow).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('dialog')).toBe(designer)
    expect(screen.getByLabelText('Select workflow').getAttribute('title')).toBe('流程 A')
    expect(screen.getByTestId('variables').textContent).toBe('{"prompt":"edited prompt"}')
    expect(screen.getByText('流程 A Start')).toBeTruthy()
  })
})

describe('App restored workflow snapshots', () => {
  it('keeps a restored task workflow snapshot across catalog updates and deletion', async () => {
    const task: TaskRecord = {
      id: 'task-1',
      project_id: project.id,
      title: 'Historical task',
      status: 'completed',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z'
    }
    const snapshot = { ...workflowA, name: '流程 A 快照' }
    const { api, listeners, setWorkflowRecords } = setupApi({
      data: bootstrap([task]),
      restore: { state: runtimeState(task.id, snapshot, task), workflow: snapshot }
    })
    await renderBootstrappedApp()
    fireEvent.click(screen.getByRole('button', { name: '新建任务' }))
    fireEvent.click(screen.getByRole('button', { name: '修改变量' }))
    fireEvent.click(screen.getByRole('button', { name: '流程 B' }))
    await screen.findByRole('alertdialog')
    fireEvent.click(await screen.findByRole('button', { name: '加载 Historical task' }))
    await waitFor(() => expect(screen.getByTitle('流程 A 快照')).toBeTruthy())
    expect(screen.getByTitle('Historical task')).toBeTruthy()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.queryByLabelText('Select workflow')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '打开工作流设计器' }))
    const designer = await screen.findByRole('dialog')
    fireEvent.click(within(designer).getByRole('button', { name: '流程 B' }))
    fireEvent.click(within(designer).getByRole('button', { name: 'Save workflow' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Workflow saved'))
    expect(api.saveWorkflow).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('dialog')).toBe(designer)
    expect(screen.getByTitle('流程 A 快照')).toBeTruthy()

    const edited = { ...workflowA, name: '流程 A 最新版本' }
    setWorkflowRecords([record(edited, 2), record(workflowB)])
    await act(async () => {
      listeners.workflowChanged?.({ operation: 'updated', id: workflowA.id })
      await Promise.resolve()
    })
    expect(screen.getByTitle('流程 A 快照')).toBeTruthy()

    setWorkflowRecords([record(workflowB)])
    await act(async () => {
      listeners.workflowChanged?.({ operation: 'deleted', id: workflowA.id })
      await Promise.resolve()
    })
    expect(screen.getByTitle('流程 A 快照')).toBeTruthy()
  })
})

describe('App terminal transcript restoration', () => {
  it('loads a selected historical terminal transcript once and caches it in session state', async () => {
    const task: TaskRecord = {
      id: 'task-transcript',
      project_id: project.id,
      title: 'Transcript task',
      status: 'completed',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z'
    }
    const terminalWorkflow: WorkflowDefinition = {
      id: 'terminal-workflow',
      name: 'Terminal workflow',
      nodes: [
        {
          id: 'terminal',
          type: 'non-interactive-terminal',
          name: 'Terminal node',
          config: { command: 'echo done', cwd: '/repo', successExitCodes: [0] }
        },
        { id: 'end', type: 'end', name: 'End', config: {} }
      ],
      edges: [{ id: 'terminal-end', from: 'terminal', to: 'end' }]
    }
    const restoredState = {
      ...runtimeState(task.id, terminalWorkflow, task),
      currentNodeId: 'terminal',
      nodeRuns: {
        terminal: { nodeId: 'terminal', status: 'completed' as const, sessionId: 'session-history' }
      },
      executionOrder: ['terminal']
    }
    const transcriptDeferred = deferred<TerminalTranscriptSnapshot>()
    const { api } = setupApi({
      data: bootstrap([task]),
      restore: {
        state: restoredState,
        workflow: terminalWorkflow,
        terminalSessions: [{
          id: 'session-history',
          task_id: task.id,
          node_id: 'terminal',
          kind: 'non-interactive',
          command: 'echo done',
          cwd: '/repo',
          status: 'closed',
          transcript: null
        }]
      }
    })
    api.getTaskSessionTranscript.mockReturnValue(transcriptDeferred.promise)
    await renderBootstrappedApp()

    fireEvent.click(await screen.findByRole('button', { name: '加载 Transcript task' }))
    const loadButton = await screen.findByRole('button', { name: '加载终端 session-history' })
    fireEvent.click(loadButton)
    fireEvent.click(loadButton)
    expect(api.getTaskSessionTranscript).toHaveBeenCalledTimes(1)
    expect(api.getTaskSessionTranscript).toHaveBeenCalledWith(task.id, 'session-history')

    await act(async () => transcriptDeferred.resolve({
      transcript: 'historical output',
      cursor: null
    }))
    await waitFor(() => expect(screen.getByTestId('terminal-transcript').textContent).toBe('historical output'))
    fireEvent.click(screen.getByRole('button', { name: '加载终端 session-history' }))
    expect(api.getTaskSessionTranscript).toHaveBeenCalledTimes(1)
  })

  it('rejects with a localized error when the terminal transcript API is unavailable', async () => {
    const task: TaskRecord = {
      id: 'task-missing-transcript-api',
      project_id: project.id,
      title: 'Missing transcript API task',
      status: 'completed',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z'
    }
    const terminalWorkflow: WorkflowDefinition = {
      id: 'missing-transcript-api-workflow',
      name: 'Missing transcript API workflow',
      nodes: [
        {
          id: 'terminal',
          type: 'non-interactive-terminal',
          name: 'Terminal node',
          config: { command: 'echo done', cwd: '/repo', successExitCodes: [0] }
        },
        { id: 'end', type: 'end', name: 'End', config: {} }
      ],
      edges: [{ id: 'terminal-end', from: 'terminal', to: 'end' }]
    }
    const data = bootstrap([task])
    data.settings.appearance = { ...data.settings.appearance, language: 'zh' }
    const { api } = setupApi({
      data,
      restore: {
        state: {
          ...runtimeState(task.id, terminalWorkflow, task),
          currentNodeId: 'terminal',
          nodeRuns: {
            terminal: { nodeId: 'terminal', status: 'completed', sessionId: 'session-without-api' }
          },
          executionOrder: ['terminal']
        },
        workflow: terminalWorkflow,
        terminalSessions: [{
          id: 'session-without-api',
          task_id: task.id,
          node_id: 'terminal',
          kind: 'non-interactive',
          command: 'echo done',
          cwd: '/repo',
          status: 'closed',
          transcript: null
        }]
      }
    })
    Reflect.deleteProperty(api, 'getTaskSessionTranscript')
    await renderBootstrappedApp()

    fireEvent.click(await screen.findByRole('button', { name: '加载 Missing transcript API task' }))
    fireEvent.click(await screen.findByRole('button', { name: '加载终端 session-without-api' }))

    const request = terminalTranscriptLoadRequest.mock.calls[0]?.[0] as Promise<void> | undefined
    expect(request).toBeDefined()
    await expect(request).rejects.toThrow('终端历史记录不可用')
  })

  it('ignores queued terminal data already covered by a restored live snapshot', async () => {
    const task: TaskRecord = {
      id: 'task-live-transcript',
      project_id: project.id,
      title: 'Live transcript task',
      status: 'running',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z'
    }
    const terminalWorkflow: WorkflowDefinition = {
      id: 'live-terminal-workflow',
      name: 'Live terminal workflow',
      nodes: [
        {
          id: 'terminal',
          type: 'non-interactive-terminal',
          name: 'Terminal node',
          config: { command: 'echo live', cwd: '/repo', successExitCodes: [0] }
        },
        { id: 'end', type: 'end', name: 'End', config: {} }
      ],
      edges: [{ id: 'terminal-end', from: 'terminal', to: 'end' }]
    }
    const restoredState: WorkflowRuntimeState = {
      ...runtimeState(task.id, terminalWorkflow, task),
      currentNodeId: 'terminal',
      nodeRuns: {
        terminal: { nodeId: 'terminal', status: 'running', sessionId: 'session-live' }
      },
      executionOrder: ['terminal']
    }
    const restoreDeferred = deferred<{
      state: WorkflowRuntimeState
      workflow: WorkflowDefinition
      terminalSessions: TerminalSession[]
    }>()
    const { api, listeners } = setupApi({ data: bootstrap([task]) })
    api.restoreWorkflowState.mockReturnValue(restoreDeferred.promise)
    await renderBootstrappedApp()

    fireEvent.click(await screen.findByRole('button', { name: '加载 Live transcript task' }))
    act(() => listeners.terminalData?.({
      sessionId: 'session-live',
      taskId: task.id,
      nodeId: 'terminal',
      stream: 'stdout',
      content: 'covered output',
      cursor: 1
    }))
    await act(async () => {
      restoreDeferred.resolve({
        state: restoredState,
        workflow: terminalWorkflow,
        terminalSessions: [{
          id: 'session-live',
          task_id: task.id,
          node_id: 'terminal',
          kind: 'non-interactive',
          command: 'echo live',
          cwd: '/repo',
          status: 'running',
          transcript: '$ echo live\ncovered output',
          transcript_cursor: 1
        }]
      })
      await Promise.resolve()
      listeners.terminalData?.({
        sessionId: 'session-live',
        taskId: task.id,
        nodeId: 'terminal',
        stream: 'stdout',
        content: ' after snapshot',
        cursor: 2
      })
    })

    await waitFor(() => expect(screen.getByTestId('terminal-transcript').textContent)
      .toBe('$ echo live\ncovered output after snapshot'))
  })
})

describe('App Shell synchronization', () => {
  it('rolls back a rejected shell selection and synchronizes later shell snapshots', async () => {
    const bash = {
      id: 'posix:%2Fbin%2Fbash',
      displayName: 'bash',
      family: 'posix' as const,
      executablePath: '/bin/bash',
      source: 'system' as const
    }
    const zsh = {
      id: 'posix:%2Fbin%2Fzsh',
      displayName: 'zsh',
      family: 'posix' as const,
      executablePath: '/bin/zsh',
      source: 'system' as const
    }
    const data = bootstrap()
    data.shell = {
      platform: 'linux',
      preferences: DEFAULT_SHELL_PREFERENCES,
      candidates: [bash, zsh],
      effectiveShell: bash
    }
    const { api, listeners } = setupApi({ data })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const reportedErrors: string[] = []
    const onError = (event: Event) => {
      reportedErrors.push((event as CustomEvent<{ text: string }>).detail.text)
    }
    window.addEventListener('app:error', onError)
    api.updateShell.mockRejectedValueOnce(new Error('selection rejected'))
    await renderBootstrappedApp()

    fireEvent.click(screen.getByRole('button', { name: '选择另一个 Shell' }))

    await waitFor(() => expect(reportedErrors).toContain('[updateShell] selection rejected'))
    expect(screen.getByTestId('shell-selection').textContent).toBe(JSON.stringify({
      selection: 'automatic',
      effective: bash.id
    }))

    const explicitZsh: ShellSnapshot = {
      platform: 'linux',
      preferences: {
        version: 3,
        selection: {
          mode: 'explicit',
          shell: {
            kind: 'native',
            id: zsh.id,
            displayName: zsh.displayName,
            family: zsh.family,
            executablePath: zsh.executablePath
          }
        }
      },
      candidates: [bash, zsh],
      effectiveShell: zsh
    }
    api.updateShell.mockResolvedValueOnce(explicitZsh)
    fireEvent.click(screen.getByRole('button', { name: '选择另一个 Shell' }))

    await waitFor(() => expect(screen.getByTestId('shell-selection').textContent).toBe(JSON.stringify({
      selection: zsh.id,
      effective: zsh.id
    })))

    act(() => listeners.shellsChanged?.({
      platform: 'linux',
      preferences: DEFAULT_SHELL_PREFERENCES,
      candidates: [bash, zsh],
      effectiveShell: bash
    }))
    expect(screen.getByTestId('shell-selection').textContent).toBe(JSON.stringify({
      selection: 'automatic',
      effective: bash.id
    }))
    window.removeEventListener('app:error', onError)
  })

  it('synchronizes a refreshed Shell snapshot and preserves it when a later refresh fails', async () => {
    const bash = {
      id: 'posix:%2Fbin%2Fbash',
      displayName: 'bash',
      family: 'posix' as const,
      executablePath: '/bin/bash',
      source: 'system' as const
    }
    const zsh = {
      id: 'posix:%2Fbin%2Fzsh',
      displayName: 'zsh',
      family: 'posix' as const,
      executablePath: '/bin/zsh',
      source: 'system' as const
    }
    const data = bootstrap()
    data.shell = {
      platform: 'linux',
      preferences: DEFAULT_SHELL_PREFERENCES,
      candidates: [bash],
      effectiveShell: bash
    }
    const refreshed: ShellSnapshot = {
      platform: 'linux',
      preferences: DEFAULT_SHELL_PREFERENCES,
      candidates: [bash, zsh],
      effectiveShell: zsh
    }
    const { api } = setupApi({ data })
    api.refreshShells.mockResolvedValueOnce(refreshed)
    await renderBootstrappedApp()

    fireEvent.click(screen.getByRole('button', { name: '重新检测 Shell' }))
    await waitFor(() => expect(screen.getByTestId('shell-selection').textContent).toBe(JSON.stringify({
      selection: 'automatic',
      effective: zsh.id
    })))

    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    api.refreshShells.mockRejectedValueOnce(new Error('refresh failed'))
    fireEvent.click(screen.getByRole('button', { name: '重新检测 Shell' }))
    await waitFor(() => expect(api.refreshShells).toHaveBeenCalledTimes(2))
    expect(screen.getByTestId('shell-selection').textContent).toBe(JSON.stringify({
      selection: 'automatic',
      effective: zsh.id
    }))
  })
})
