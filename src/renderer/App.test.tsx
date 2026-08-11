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
import type { WorkflowDefinition, WorkflowNode } from '../shared/workflow'
import type { WorkflowRuntimeStartOptions, WorkflowRuntimeState } from '../shared/workflowRuntime'
import type { ShellSnapshot } from '../shared/shell'
import type { TerminalDataEvent, TerminalTranscriptSnapshot } from '../shared/terminalBuffer'
import type {
  Bootstrap,
  ProjectRecord,
  TaskRecord,
  WorkflowRecord,
  WorkflowSaveResult
} from './appTypes'
import type { TerminalSession } from './utils'

const { designerInspectorRender, reactFlowRender } = vi.hoisted(() => ({
  designerInspectorRender: vi.fn(),
  reactFlowRender: vi.fn()
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
      onSelectProject,
      projects,
      shellSnapshot,
      onShellChange,
      onRefreshShells
    }: {
      onOpenDesigner: () => void
      onSelectProject: (project: ProjectRecord) => void
      projects: ProjectRecord[]
      shellSnapshot: ShellSnapshot
      onShellChange: (shellId: string | 'automatic') => Promise<void>
      onRefreshShells: () => Promise<void>
    }) => React.createElement(
      'nav',
      null,
      ...projects.map((item) => React.createElement('button', {
        key: item.id,
        onClick: () => onSelectProject(item),
        type: 'button'
      }, `切换项目 ${item.name}`)),
      React.createElement('button', {
        onClick: onOpenDesigner,
        type: 'button'
      }, '打开流程设计器'),
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
      }, '重新检测 Shell')
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
      onStartNewTask,
      showDraftTask
    }: {
      activeProject: ProjectRecord | null
      displayedTasks: TaskRecord[]
      onLoadTask: (task: TaskRecord) => void
      onRenameTask: (task: TaskRecord, title: string) => Promise<void>
      onStartNewTask: () => void
      showDraftTask?: boolean
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
      ))
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
      onRun,
      onVariableChange,
      sessions,
      variables
    }: {
      canOperate: boolean
      node: { id: string; name: string }
      onLoadTerminalTranscript: (session: TerminalSession) => Promise<void>
      onRun: () => void
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
              onClick: () => void onLoadTerminalTranscript(sessions[0]),
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
      }, '运行')
    )
  }
})

vi.mock('./components/ParallelBranchGroup', () => ({
  ParallelBranchGroup: () => null
}))

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

type Listeners = {
  shellsChanged?: (snapshot: ShellSnapshot) => void
  settingsChanged?: (snapshot: Bootstrap['settings']) => void
  workflowState?: (state: WorkflowRuntimeState) => void
  workflowChanged?: (event: unknown) => void
  terminalData?: (event: TerminalDataEvent) => void
}

function setupApi(options: {
  data?: ReturnType<typeof bootstrap>
  restore?: {
    state: WorkflowRuntimeState
    workflow: WorkflowDefinition
    terminalSessions?: TerminalSession[]
  } | null
} = {}) {
  const data = options.data ?? bootstrap()
  const listeners: Listeners = {}
  let workflowRecords = data.workflowRecords
  const unsubscribe = () => {}
  const api = {
    bootstrap: vi.fn().mockResolvedValue(data),
    listTasks: vi.fn().mockResolvedValue(data.tasks),
    listWorkflows: vi.fn(() => Promise.resolve(workflowRecords)),
    restoreWorkflowState: vi.fn().mockResolvedValue(options.restore ?? null),
    getTaskContext: vi.fn().mockResolvedValue('{}'),
    listTaskSessions: vi.fn().mockResolvedValue([]),
    getTaskSessionTranscript: vi.fn().mockResolvedValue({
      transcript: 'loaded transcript',
      cursor: null
    }),
    setLastOpenedWorkspace: vi.fn().mockResolvedValue(undefined),
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
    updateShell: vi.fn().mockResolvedValue(data.shell),
    refreshShells: vi.fn().mockResolvedValue(data.shell),
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
    onWorkflowState: vi.fn((callback: (state: WorkflowRuntimeState) => void) => {
      listeners.workflowState = callback
      return unsubscribe
    }),
    onTerminalCreated: vi.fn(() => unsubscribe),
    onTerminalRestarted: vi.fn(() => unsubscribe),
    onTerminalData: vi.fn((callback: (event: TerminalDataEvent) => void) => {
      listeners.terminalData = callback
      return unsubscribe
    }),
    onTerminalClosed: vi.fn(() => unsubscribe)
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
    }
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

  it('keeps an unstarted draft out of the task list and adds it after a successful launch', async () => {
    const { api, listeners } = setupApi()
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

    fireEvent.click(screen.getByRole('button', { name: '运行' }))

    const startedTaskButton = await screen.findByRole('button', { name: '加载 已发起任务' })
    expect(startedTaskButton.getAttribute('data-task-status')).toBe('running')

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

    fireEvent.click(screen.getByRole('button', { name: '打开流程设计器' }))
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

    fireEvent.click(screen.getByRole('button', { name: '打开流程设计器' }))
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

    fireEvent.click(screen.getByRole('button', { name: '打开流程设计器' }))
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

    fireEvent.click(screen.getByRole('button', { name: '打开流程设计器' }))
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

    fireEvent.click(screen.getByRole('button', { name: '打开流程设计器' }))
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

    fireEvent.click(screen.getByRole('button', { name: '打开流程设计器' }))
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

    fireEvent.click(screen.getByRole('button', { name: '打开流程设计器' }))
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

    fireEvent.click(screen.getByRole('button', { name: '打开流程设计器' }))
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

    fireEvent.click(screen.getByRole('button', { name: '打开流程设计器' }))
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

    fireEvent.click(screen.getByRole('button', { name: '打开流程设计器' }))
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

    fireEvent.click(screen.getByRole('button', { name: '打开流程设计器' }))
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
        version: 2,
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
