import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type PointerEvent as ReactPointerEvent
} from 'react'
import {
  Background,
  ConnectionMode,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodePositionChange,
  type OnSelectionChangeFunc,
  type ReactFlowInstance
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  AlignHorizontalSpaceBetween,
  Copy,
  Focus,
  MoreHorizontal,
  Network,
  Plus,
  Save,
  Square,
  Trash2,
  TriangleAlert,
  Workflow,
  X
} from 'lucide-react'
import { toast } from 'sonner'
import {
  type NodeRunStatus,
  type VariableValue,
  type WorkflowDefinition,
  type WorkflowNode,
  duplicateWorkflowDefinition,
  validateUserVariableKey,
  validateWorkflow
} from '../shared/workflow'
import type {
  WorkflowRuntimeBranchRun,
  WorkflowRuntimeNodeRun,
  WorkflowRuntimeState
} from '../shared/workflowRuntime'
import { TASK_DRAFT_VERSION } from '../shared/taskDraft'
import type { TerminalRetryMode } from '../shared/terminalSession'
import {
  DEFAULT_ASSISTANT_CONFIG,
  DEFAULT_APPEARANCE_PREFERENCES,
  DEFAULT_LAYOUT_PREFERENCES,
  DEFAULT_SHELL_PREFERENCES,
  type UserSkin
} from '../shared/appSettings'
import { getBuiltinSkin } from '../shared/skin'
import { normalizeProjectName } from '../shared/projectName'
import { normalizeTaskTitle } from '../shared/taskTitle'
import {
  appendBoundedText,
  MAX_TERMINAL_TRANSCRIPT_CHARS,
  type TerminalDataEvent
} from '../shared/terminalBuffer'
import type { UpdateErrorCode, UpdateState } from '../shared/update'
import {
  getNodeTypeLabel,
  getCurrentInputVariables,
  getDefaultVariables,
  getDefaultNodeConfig,
  canStartNewTask,
  canSwitchTaskWorkflow,
  hasModifiedWorkflowVariables,
  handleError,
  clamp,
  getTaskTitle,
  getParallelGroupBranchesForNode,
  getNodeOperationState,
  getNodeDetailZoomTarget,
  getNodeDetailZoomTitle,
  getNextActiveProjectIdAfterDelete,
  shouldResetActiveTaskAfterDelete,
  mergeTaskRecord
} from './utils'
import { getWorkflowAction } from './executionActions'
import type { NodeDetailZoomTarget, TerminalSession } from './utils'
import { NodeIcon } from './components/NodeIcon'
import { DesignerFlowNode } from './designer/DesignerFlowNode'
import { DesignerFlowEdge } from './designer/DesignerFlowEdge'
import { DesignerInspector } from './designer/DesignerInspector'
import {
  HORIZONTAL_ALIGNMENT_SNAP_DISTANCE,
  snapNodePositionHorizontally
} from './designer/snapping'
import { arrangeWorkflowNodesLeftToRight } from './designer/layout'
import { pruneJoinIncomingEdgeIds } from './designer/joinEdges'
import { NodeDetailPanel } from './components/NodeDetailPanel'
import { ParallelBranchGroup } from './components/ParallelBranchGroup'
import { ProjectRail } from './components/ProjectRail'
import { ReleaseNotesView } from './components/ReleaseNotesView'
import { AppearancePanel } from './components/AppearancePanel'
import { StatusBadge } from './components/StatusBadge'
import { TaskSidebar } from './components/TaskSidebar'
import { TerminalScrollGroup } from './components/TerminalScrollGroup'
import type {
  Bootstrap,
  ProjectRecord,
  TaskDraftPayload,
  TaskDraftRecord,
  TaskRecord,
  WorkflowRecord,
  WorkflowSaveResult
} from './appTypes'
import { applySkin, DEFAULT_SKIN, type Skin } from './theme'
import { i18n, syncI18nLanguage } from './i18n'
import { useTranslation } from 'react-i18next'
import type { TranslationKey } from '../shared/i18n/types'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'

type NodeRun = WorkflowRuntimeNodeRun
type DesignerSelection =
  | { kind: 'node'; id: string }
  | { kind: 'edge'; id: string }
  | null
type FlowNodeData = {
  workflowNode: WorkflowNode
  status?: NodeRunStatus
}
type FlowNode = Node<FlowNodeData, 'workflowNode'>
type FlowEdge = Edge<{
  workflowEdge: WorkflowDefinition['edges'][number]
  onDelete?: (edgeId: string) => void
}>

const emptyWorkflow: WorkflowDefinition = {
  id: '__no-workflow__',
  name: i18n.t('workflow:empty.name'),
  nodes: [],
  edges: []
}

const fallbackBootstrap: Bootstrap = {
  workflows: [],
  workflowRecords: [],
  settings: {
    assistant: DEFAULT_ASSISTANT_CONFIG,
    appearance: DEFAULT_APPEARANCE_PREFERENCES,
    layout: DEFAULT_LAYOUT_PREFERENCES,
    shell: DEFAULT_SHELL_PREFERENCES,
    skins: [],
    activeSkin: DEFAULT_SKIN
  },
  shell: {
    platform: 'other',
    preferences: DEFAULT_SHELL_PREFERENCES,
    candidates: [],
    effectiveShell: null,
    error: i18n.t('status:shell.notDetected')
  },
  projects: [],
  terminalSessions: [],
  lastOpenedWorkspace: null
}

const TERMINAL_STATE_FLUSH_MS = 250

const FALLBACK_UPDATE_STATE: UpdateState = {
  status: 'idle',
  capability: 'unsupported',
  packageType: 'unknown',
  currentVersion: '…'
}

const UPDATE_ERROR_KEYS: Record<UpdateErrorCode, TranslationKey> = {
  'unsupported-build': 'settings:update.error.unsupportedBuild',
  'check-failed': 'settings:update.error.checkFailed',
  'download-failed': 'settings:update.error.downloadFailed',
  'invalid-release': 'settings:update.error.invalidRelease',
  'install-unavailable': 'settings:update.error.installUnavailable',
  'install-failed': 'settings:update.error.installFailed',
  'open-release-failed': 'settings:update.error.openReleaseFailed'
}

function resolveSkinFromId(id: string, userSkins: UserSkin[]): Skin | undefined {
  return getBuiltinSkin(id) ?? userSkins.find((skin) => skin.id === id)
}

function getWorkflowCopyName(sourceName: string, workflows: WorkflowDefinition[]): string {
  const baseName = i18n.t('workflow:copySuffix', { name: sourceName })
  const existingNames = new Set(workflows.map((workflow) => workflow.name))
  if (!existingNames.has(baseName)) return baseName

  let copyNumber = 2
  while (existingNames.has(`${baseName} ${copyNumber}`)) copyNumber += 1
  return `${baseName} ${copyNumber}`
}

function toWorkflowRevisionMap(records: WorkflowRecord[]): Record<string, number> {
  return Object.fromEntries(records.map((record) => [record.workflow.id, record.revision]))
}

const DESIGNER_NODE_GROUPS: Array<{ labelKey: TranslationKey; types: WorkflowNode['type'][] }> = [
  {
    labelKey: 'designer:palette.flowControl',
    types: ['start', 'end', 'exclusive-gateway', 'parallel-gateway']
  },
  {
    labelKey: 'designer:palette.terminal',
    types: ['interactive-terminal', 'non-interactive-terminal']
  },
  {
    labelKey: 'designer:palette.data',
    types: ['input']
  }
]

const TASK_BATCH_SIZE = 10
const DRAFT_SAVE_DEBOUNCE_MS = 300

type ScheduledDraftSave = {
  payload: TaskDraftPayload
  timer: ReturnType<typeof setTimeout>
}

type PendingDraftLaunch = {
  contentVersion: number
  projectId: string
}

type DraftLookupOutcome = 'restored' | 'missing' | 'aborted' | 'error'

type PendingDraftLoad = {
  projectId: string
  requestId: number
}

export function App({ initialSkin = DEFAULT_SKIN }: { initialSkin?: Skin }) {
  const { t } = useTranslation()
  const [bootstrap, setBootstrap] = useState<Bootstrap>(fallbackBootstrap)
  const [projects, setProjects] = useState<ProjectRecord[]>([])
  const [tasks, setTasks] = useState<TaskRecord[]>([])
  const [visibleTaskCount, setVisibleTaskCount] = useState(TASK_BATCH_SIZE)
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const [workflow, setWorkflow] = useState<WorkflowDefinition>(emptyWorkflow)
  const [selectedNodeId, setSelectedNodeId] = useState('')
  const [variables, setVariables] = useState<Record<string, VariableValue>>({})
  const [nodeRuns, setNodeRuns] = useState<Record<string, NodeRun>>({})
  const [sessions, setSessions] = useState<TerminalSession[]>([])
  const [activeTaskId, setActiveTaskId] = useState(() => `draft-${Date.now()}`)
  const [draftStarted, setDraftStarted] = useState(false)
  const [isNewTaskDraft, setIsNewTaskDraft] = useState(false)
  const [startingWorkflowTaskId, setStartingWorkflowTaskId] = useState<string | null>(null)
  const [pendingWorkflowId, setPendingWorkflowId] = useState<string | null>(null)
  const [isConfirmingWorkflowChange, setIsConfirmingWorkflowChange] = useState(false)
  const [designerOpen, setDesignerOpen] = useState(false)
  const [editingWorkflow, setEditingWorkflow] = useState<WorkflowDefinition | null>(null)
  const [flowNodes, setFlowNodes] = useState<FlowNode[]>([])
  const [flowEdges, setFlowEdges] = useState<FlowEdge[]>([])
  const [designerSelection, setDesignerSelection] = useState<DesignerSelection>(null)
  const handleDesignerSelectionChange = useCallback<OnSelectionChangeFunc<FlowNode, FlowEdge>>(({
    nodes,
    edges
  }) => {
    let nextSelection: DesignerSelection | undefined
    if (nodes.length === 1 && edges.length === 0)
      nextSelection = { kind: 'node', id: nodes[0].id }
    else if (edges.length === 1 && nodes.length === 0)
      nextSelection = { kind: 'edge', id: edges[0].id }
    else if (nodes.length === 0 && edges.length === 0)
      nextSelection = null

    if (nextSelection === undefined) return
    setDesignerSelection((current) => {
      if (current === nextSelection) return current
      if (current && nextSelection && current.kind === nextSelection.kind && current.id === nextSelection.id)
        return current
      return nextSelection
    })
  }, [])
  const [designerFlow, setDesignerFlow] = useState<ReactFlowInstance<FlowNode, FlowEdge> | null>(null)
  const [designerDirty, setDesignerDirty] = useState(false)
  const [designerCloseConfirmationOpen, setDesignerCloseConfirmationOpen] = useState(false)
  const [workflowToDelete, setWorkflowToDelete] = useState<WorkflowDefinition | null>(null)
  const [projectRailWidth, setProjectRailWidth] = useState(64)
  const [taskSidebarWidth, setTaskSidebarWidth] = useState(168)
  const [activeSkin, setActiveSkin] = useState<Skin>(initialSkin)
  const [appearancePanelOpen, setAppearancePanelOpen] = useState(false)
  const [updateState, setUpdateState] = useState<UpdateState>(FALLBACK_UPDATE_STATE)
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false)
  const [workflowRevisions, setWorkflowRevisions] = useState<Record<string, number>>({})
  const [runtimeState, setRuntimeState] = useState<WorkflowRuntimeState | null>(null)
  const [workflowCompleted, setWorkflowCompleted] = useState(false)
  const [branchRuns, setBranchRuns] = useState<Record<string, WorkflowRuntimeBranchRun>>({})
  const [viewMode, setViewMode] = useState<'focus' | 'graph'>('focus')
  const [taskGraphFocusNodeId, setTaskGraphFocusNodeId] = useState<string | null>(null)
  const [focusedParallelSplitNodeId, setFocusedParallelSplitNodeId] = useState<string | null>(null)
  const [nodeDetailZoomTarget, setNodeDetailZoomTarget] = useState<NodeDetailZoomTarget | null>(null)
  const [parallelZoomNodeId, setParallelZoomNodeId] = useState<string | null>(null)
  const [executionOrder, setExecutionOrder] = useState<string[]>([])
  const activeTaskIdRef = useRef(activeTaskId)
  const activeProjectIdRef = useRef(activeProjectId)
  const workflowRef = useRef(workflow)
  const variablesRef = useRef(variables)
  const draftStartedRef = useRef(draftStarted)
  const isNewTaskDraftRef = useRef(isNewTaskDraft)
  const runtimeStateRef = useRef(runtimeState)
  const startingWorkflowTaskIdRef = useRef(startingWorkflowTaskId)
  const pendingWorkflowIdRef = useRef(pendingWorkflowId)
  const availableWorkflowsRef = useRef<WorkflowDefinition[]>(bootstrap.workflows)
  const workflowConfirmationRequestRef = useRef(0)
  const activeTaskPersistedRef = useRef(false)
  const taskLoadRequestRef = useRef(0)
  const terminalTranscriptLoadsRef = useRef(new Map<string, Promise<void>>())
  const pendingStartupTaskRef = useRef<{ projectId: string; taskId: string } | null>(null)
  const rememberedWorkspaceKeyRef = useRef('')
  const draftContentVersionsRef = useRef(new Map<string, number>())
  const draftRevisionsRef = useRef(new Map<string, number>())
  const draftSaveQueuesRef = useRef(new Map<string, Promise<void>>())
  const scheduledDraftSavesRef = useRef(new Map<string, ScheduledDraftSave>())
  const pendingDraftLaunchesRef = useRef(new Map<string, PendingDraftLaunch>())
  const draftLoadRequestRef = useRef(0)
  const pendingDraftLoadRef = useRef<PendingDraftLoad | null>(null)
  const draftFlushPromiseRef = useRef<Promise<void> | null>(null)
  const rendererPreparingToCloseRef = useRef(false)
  const manualFocusRef = useRef(false)
  const designerDirtyRef = useRef(designerDirty)
  const designerOpenRef = useRef(designerOpen)
  const editingWorkflowIdRef = useRef(editingWorkflow?.id ?? null)
  const designerEditVersionRef = useRef(0)
  const updateStateRef = useRef<UpdateState>(FALLBACK_UPDATE_STATE)
  const workflowIdRef = useRef(workflow.id)
  designerDirtyRef.current = designerDirty
  designerOpenRef.current = designerOpen
  editingWorkflowIdRef.current = editingWorkflow?.id ?? null
  workflowIdRef.current = workflow.id
  activeProjectIdRef.current = activeProjectId
  workflowRef.current = workflow
  variablesRef.current = variables
  draftStartedRef.current = draftStarted
  isNewTaskDraftRef.current = isNewTaskDraft
  runtimeStateRef.current = runtimeState
  startingWorkflowTaskIdRef.current = startingWorkflowTaskId
  pendingWorkflowIdRef.current = pendingWorkflowId
  availableWorkflowsRef.current = bootstrap.workflows
  const activeRuntimeStatus = runtimeState?.taskId === activeTaskId ? runtimeState.status : null
  const isRunning = activeRuntimeStatus === 'running'
  const isWaitingForInput = activeRuntimeStatus === 'waiting-input'
  const workflowAction = getWorkflowAction(activeRuntimeStatus)

  const activeProject = projects.find((project) => project.id === activeProjectId) ?? null
  const availableWorkflows = bootstrap.workflows
  const selectedNode = workflow.nodes.find((node) => node.id === selectedNodeId) ?? workflow.nodes[0]
  const selectedNodeSessions = sessions.filter((session) => session.node_id === selectedNode?.id && session.task_id === activeTaskId)
  const focusedParallelBranchRuns = focusedParallelSplitNodeId
    ? Object.values(branchRuns).filter((branch) => branch.splitNodeId === focusedParallelSplitNodeId)
    : getParallelGroupBranchesForNode(selectedNode, branchRuns)
  const focusedParallelGateway = selectedNode?.type === 'parallel-gateway'
    ? selectedNode
    : workflow.nodes.find((node) => node.id === focusedParallelSplitNodeId)
  const validationErrors = useMemo(() => validateWorkflow(workflow), [workflow])
  const runtimeCurrentNodeId = runtimeState?.taskId === activeTaskId
    ? runtimeState.currentNodeId
    : (executionOrder.at(-1) ?? workflow.nodes[0]?.id ?? '')
  const selectedNodeOperationState = selectedNode
    ? getNodeOperationState({
      nodeId: selectedNode.id,
      runtimeCurrentNodeId,
      isRunning,
      isWaitingForInput,
      branchRuns
    })
    : { canOperate: false, isRunning: false, isWaitingForInput: false }
  const selectedNodeBranch = selectedNodeOperationState.branchId ? branchRuns[selectedNodeOperationState.branchId] : undefined
  const selectedNodeCanOperate = Boolean(
    activeProject &&
    selectedNode &&
    validationErrors.length === 0 &&
    !workflowCompleted &&
    startingWorkflowTaskId !== activeTaskId &&
    selectedNodeOperationState.canOperate
  )
  const selectedNodeIsWaitingForInput = Boolean(selectedNodeCanOperate && selectedNodeOperationState.isWaitingForInput)
  const selectedNodeVariables = selectedNodeBranch?.variables ?? variables
  const designerValidationErrors = useMemo(() => {
    if (!editingWorkflow) return []
    const mappedNodes = flowNodes.map((n) => ({ ...n.data.workflowNode, x: n.position.x, y: n.position.y }))
    const mappedEdges = flowEdges.map((e) => e.data?.workflowEdge).filter((edge): edge is WorkflowDefinition['edges'][number] => Boolean(edge))
    return validateWorkflow({ ...editingWorkflow, nodes: mappedNodes, edges: mappedEdges })
  }, [flowEdges, flowNodes, editingWorkflow])
  const taskFlowNodes = useMemo<FlowNode[]>(
    () =>
      workflow.nodes.map((node, index) => ({
        id: node.id,
        type: 'workflowNode',
        position: workflow.layout?.nodes[node.id] ?? { x: 80 + (index % 4) * 230, y: 80 + Math.floor(index / 4) * 140 },
        data: { workflowNode: node, status: nodeRuns[node.id]?.status ?? 'pending' },
        selected: selectedNodeId === node.id,
        draggable: false
      })),
    [nodeRuns, selectedNodeId, workflow]
  )
  const taskFlowEdges = useMemo<FlowEdge[]>(
    () =>
      workflow.edges.map((edge) => ({
        id: edge.id,
        source: edge.from,
        target: edge.to,
        type: 'designerEdge',
        animated: edge.isDefault,
        label: edge.condition,
        markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--muted-foreground)', width: 16, height: 16 },
        style: edge.condition && !edge.isDefault ? { strokeDasharray: '5 3' } : {},
        data: { workflowEdge: edge }
      })),
    [workflow.edges]
  )
  const taskGraphFitViewOptions = taskGraphFocusNodeId && taskFlowNodes.some((node) => node.id === taskGraphFocusNodeId)
    ? { nodes: [{ id: taskGraphFocusNodeId }], padding: 0.2, maxZoom: 1 }
    : { padding: 0.2, maxZoom: 1 }
  const displayedTasks = tasks.slice(0, visibleTaskCount)
  const persistedActiveTask = tasks.find((task) => task.id === activeTaskId)
  const persistedTaskIds = tasks.map((task) => task.id)
  const canSwitchWorkflow = Boolean(
    activeProject &&
    availableWorkflows.length > 0 &&
    canSwitchTaskWorkflow({
      isNewTaskDraft,
      activeTaskId,
      persistedTaskIds,
      runtimeTaskId: runtimeState?.taskId ?? null,
      startingWorkflowTaskId
    })
  )
  const currentWorkflowIsAvailable = availableWorkflows.some((item) => item.id === workflow.id)
  const workspaceTaskTitle = persistedActiveTask?.title
    ? persistedActiveTask.title
    : draftStarted
      ? getTaskTitle(workflow, variables)
      : activeProject
        ? t('task:selectOrCreate')
        : t('project:addFolderPrompt')
  function updateWorkspaceWorkflow(nextWorkflow: WorkflowDefinition) {
    workflowIdRef.current = nextWorkflow.id
    workflowRef.current = nextWorkflow
    setWorkflow(nextWorkflow)
  }

  function refreshWorkspaceWorkflowDefinition(nextWorkflow: WorkflowDefinition) {
    updateWorkspaceWorkflow(nextWorkflow)
    setSelectedNodeId((current) => (
      nextWorkflow.nodes.some((node) => node.id === current)
        ? current
        : (nextWorkflow.nodes[0]?.id ?? '')
    ))
    if (isNewTaskDraftRef.current && activeProjectIdRef.current) {
      const nextVariables = restoreDraftVariables(nextWorkflow, variablesRef.current)
      variablesRef.current = nextVariables
      setVariables(nextVariables)
      void persistDraftSnapshot(activeProjectIdRef.current, nextWorkflow, nextVariables)
    }
  }

  function applyWorkflowCatalog(records: WorkflowRecord[]): WorkflowDefinition[] {
    const workflows = records.map((record) => record.workflow)
    availableWorkflowsRef.current = workflows
    setWorkflowRevisions(toWorkflowRevisionMap(records))
    setBootstrap((current) => ({
      ...current,
      workflows,
      workflowRecords: records
    }))
    return workflows
  }

  function updateDraftStarted(nextDraftStarted: boolean) {
    draftStartedRef.current = nextDraftStarted
    setDraftStarted(nextDraftStarted)
  }

  function updateNewTaskDraft(nextIsNewTaskDraft: boolean) {
    isNewTaskDraftRef.current = nextIsNewTaskDraft
    setIsNewTaskDraft(nextIsNewTaskDraft)
  }

  function updateRuntimeState(nextRuntimeState: WorkflowRuntimeState | null) {
    runtimeStateRef.current = nextRuntimeState
    setRuntimeState(nextRuntimeState)
  }

  function updateStartingWorkflowTaskId(taskId: string | null) {
    startingWorkflowTaskIdRef.current = taskId
    setStartingWorkflowTaskId(taskId)
  }

  function updatePendingWorkflowId(workflowId: string | null) {
    if (pendingWorkflowIdRef.current !== workflowId) {
      workflowConfirmationRequestRef.current += 1
    }
    pendingWorkflowIdRef.current = workflowId
    setPendingWorkflowId(workflowId)
    if (workflowId === null) setIsConfirmingWorkflowChange(false)
  }

  function createDraftPayload(
    projectId: string,
    nextWorkflow: WorkflowDefinition,
    nextVariables: Record<string, VariableValue>
  ): TaskDraftPayload {
    const revision = (draftRevisionsRef.current.get(projectId) ?? 0) + 1
    draftRevisionsRef.current.set(projectId, revision)
    return {
      version: TASK_DRAFT_VERSION,
      workflow: nextWorkflow,
      variables: { ...nextVariables },
      revision
    }
  }

  function markDraftContentChanged(projectId: string): number {
    const version = (draftContentVersionsRef.current.get(projectId) ?? 0) + 1
    draftContentVersionsRef.current.set(projectId, version)
    return version
  }

  function enqueueDraftSnapshot(
    projectId: string,
    payload: TaskDraftPayload,
    overwrite = false
  ): Promise<void> {
    const saveDraft = window.cliLoom?.saveTaskDraft
    if (!saveDraft) return Promise.resolve()

    const previous = draftSaveQueuesRef.current.get(projectId) ?? Promise.resolve()
    const operation = previous.catch(() => undefined).then(async () => {
      try {
        const saved = overwrite
          ? await saveDraft(projectId, payload, true) as TaskDraftRecord | undefined
          : await saveDraft(projectId, payload) as TaskDraftRecord | undefined
        if (saved && saved.projectId === projectId) {
          const currentRevision = draftRevisionsRef.current.get(projectId) ?? 0
          draftRevisionsRef.current.set(projectId, Math.max(currentRevision, saved.revision))
        }
      } catch (error) {
        handleError(error, 'saveTaskDraft')
      }
    })
    const tracked = operation.finally(() => {
      if (draftSaveQueuesRef.current.get(projectId) === tracked) {
        draftSaveQueuesRef.current.delete(projectId)
      }
    })
    draftSaveQueuesRef.current.set(projectId, tracked)
    return tracked
  }

  function cancelScheduledDraftSave(projectId: string): TaskDraftPayload | null {
    const scheduled = scheduledDraftSavesRef.current.get(projectId)
    if (!scheduled) return null
    clearTimeout(scheduled.timer)
    scheduledDraftSavesRef.current.delete(projectId)
    return scheduled.payload
  }

  function scheduleDraftSnapshot(
    projectId: string,
    nextWorkflow: WorkflowDefinition,
    nextVariables: Record<string, VariableValue>
  ): void {
    if (!window.cliLoom?.saveTaskDraft) return

    markDraftContentChanged(projectId)
    const payload = createDraftPayload(projectId, nextWorkflow, nextVariables)
    cancelScheduledDraftSave(projectId)
    let scheduled!: ScheduledDraftSave
    const timer = setTimeout(() => {
      if (scheduledDraftSavesRef.current.get(projectId) !== scheduled) return
      scheduledDraftSavesRef.current.delete(projectId)
      void enqueueDraftSnapshot(projectId, payload)
    }, DRAFT_SAVE_DEBOUNCE_MS)
    scheduled = { payload, timer }
    scheduledDraftSavesRef.current.set(projectId, scheduled)
  }

  function flushScheduledDraftSaves(): Promise<void> {
    const scheduled = [...scheduledDraftSavesRef.current.entries()]
    scheduledDraftSavesRef.current.clear()
    for (const [, item] of scheduled) clearTimeout(item.timer)
    return Promise.all(scheduled.map(([projectId, item]) => (
      enqueueDraftSnapshot(projectId, item.payload)
    ))).then(() => undefined)
  }

  function persistDraftSnapshot(
    projectId: string,
    nextWorkflow: WorkflowDefinition,
    nextVariables: Record<string, VariableValue>,
    options: { contentChanged?: boolean; overwrite?: boolean } = {}
  ): Promise<void> {
    if (options.contentChanged !== false) markDraftContentChanged(projectId)
    if (!window.cliLoom?.saveTaskDraft) return Promise.resolve()
    cancelScheduledDraftSave(projectId)
    return enqueueDraftSnapshot(
      projectId,
      createDraftPayload(projectId, nextWorkflow, nextVariables),
      options.overwrite
    )
  }

  function deletePersistedDraft(projectId: string): Promise<void> {
    cancelScheduledDraftSave(projectId)
    const deleteDraft = window.cliLoom?.deleteTaskDraft
    if (!deleteDraft) {
      draftRevisionsRef.current.delete(projectId)
      return Promise.resolve()
    }

    const previous = draftSaveQueuesRef.current.get(projectId) ?? Promise.resolve()
    const operation = previous.catch(() => undefined).then(async () => {
      try {
        await deleteDraft(projectId)
        draftRevisionsRef.current.delete(projectId)
      } catch (error) {
        handleError(error, 'deleteTaskDraft')
      }
    })
    const tracked = operation.finally(() => {
      if (draftSaveQueuesRef.current.get(projectId) === tracked) {
        draftSaveQueuesRef.current.delete(projectId)
      }
    })
    draftSaveQueuesRef.current.set(projectId, tracked)
    return tracked
  }

  function flushActiveDraft(): Promise<void> {
    const projectId = activeProjectIdRef.current
    if (!projectId || !isNewTaskDraftRef.current) return Promise.resolve()
    return persistDraftSnapshot(projectId, workflowRef.current, variablesRef.current, {
      contentChanged: false
    })
  }

  async function flushDraftOperations(): Promise<void> {
    const pendingFlush = draftFlushPromiseRef.current
    if (pendingFlush) return pendingFlush

    const operation = (async () => {
      await flushActiveDraft()
      while (
        scheduledDraftSavesRef.current.size > 0 ||
        draftSaveQueuesRef.current.size > 0
      ) {
        await flushScheduledDraftSaves()
        const pending = [...draftSaveQueuesRef.current.values()]
        await Promise.all(pending.map((item) => item.catch(() => undefined)))
      }
    })()
    draftFlushPromiseRef.current = operation
    const clearPendingFlush = () => {
      if (draftFlushPromiseRef.current === operation) draftFlushPromiseRef.current = null
    }
    void operation.then(clearPendingFlush, clearPendingFlush)
    return operation
  }

  function currentWorkspaceUsesTaskSnapshot(): boolean {
    return Boolean(
      activeTaskPersistedRef.current ||
      pendingStartupTaskRef.current ||
      startingWorkflowTaskIdRef.current === activeTaskIdRef.current
    )
  }

  function currentWorkspaceHasDraftContent(): boolean {
    return draftStartedRef.current || isNewTaskDraftRef.current
  }

  function canSwitchCurrentDraftWorkflow(): boolean {
    const currentTaskId = activeTaskIdRef.current
    return canSwitchTaskWorkflow({
      isNewTaskDraft: isNewTaskDraftRef.current,
      activeTaskId: currentTaskId,
      persistedTaskIds: activeTaskPersistedRef.current
        ? [currentTaskId]
        : persistedTaskIds,
      runtimeTaskId: runtimeStateRef.current?.taskId ?? null,
      startingWorkflowTaskId: startingWorkflowTaskIdRef.current
    })
  }

  function rememberWorkspace(projectId: string | null, taskId: string | null) {
    pendingStartupTaskRef.current = null
    const workspace = projectId ? { projectId, taskId } : null
    const workspaceKey = JSON.stringify(workspace)
    if (workspaceKey === rememberedWorkspaceKeyRef.current) return

    rememberedWorkspaceKeyRef.current = workspaceKey
    window.cliLoom?.setLastOpenedWorkspace(workspace).catch((error: unknown) => {
      if (rememberedWorkspaceKeyRef.current === workspaceKey) {
        rememberedWorkspaceKeyRef.current = ''
      }
      handleError(error, 'setLastOpenedWorkspace')
    })
  }

  function applyRuntimeState(
    state: WorkflowRuntimeState,
    options: { moveTaskToFront?: boolean } = {}
  ) {
    if (state.task) {
      setTasks((current) => mergeTaskRecord(
        current,
        state.task as TaskRecord,
        options.moveTaskToFront ?? true
      ))
    }
    const pendingDraftLaunch = pendingDraftLaunchesRef.current.get(state.taskId)
    if (
      state.task &&
      pendingDraftLaunch?.projectId === state.projectId
    ) {
      pendingDraftLaunchesRef.current.delete(state.taskId)
      const currentContentVersion = draftContentVersionsRef.current.get(state.projectId) ?? 0
      if (currentContentVersion === pendingDraftLaunch.contentVersion) {
        void deletePersistedDraft(state.projectId)
      }
    }
    if (state.taskId !== activeTaskIdRef.current) return
    activeTaskPersistedRef.current = true
    updateRuntimeState(state)
    updateNewTaskDraft(false)
    updatePendingWorkflowId(null)
    if (startingWorkflowTaskIdRef.current === state.taskId) {
      updateStartingWorkflowTaskId(null)
    }
    rememberWorkspace(state.projectId, state.taskId)

    const nextActiveBranches = state.activeBranches
      .map((branchId) => state.branchRuns[branchId])
      .filter((branch): branch is WorkflowRuntimeBranchRun => Boolean(branch))
    const nextActiveSplitNodeId = nextActiveBranches[0]?.splitNodeId ?? null
    if (!manualFocusRef.current) {
      setSelectedNodeId(nextActiveSplitNodeId ?? state.currentNodeId)
      setFocusedParallelSplitNodeId(nextActiveSplitNodeId)
      setNodeDetailZoomTarget(null)
    }
    variablesRef.current = state.variables
    setVariables(state.variables)
    setNodeRuns(state.nodeRuns)
    setExecutionOrder(state.executionOrder)
    setBranchRuns(state.branchRuns)
    setWorkflowCompleted(state.workflowCompleted || state.status === 'completed')
    updateDraftStarted(true)
    setViewMode('focus')
  }

  function focusNode(nodeId: string, zoomTarget: NodeDetailZoomTarget | null = null) {
    manualFocusRef.current = true
    setSelectedNodeId(nodeId)
    setFocusedParallelSplitNodeId(null)
    setNodeDetailZoomTarget(zoomTarget)
    setParallelZoomNodeId(null)
    setViewMode('focus')
  }

  function focusParallelGateway(node: WorkflowNode) {
    const branches = getParallelGroupBranchesForNode(node, branchRuns)
    if (branches.length === 0) {
      focusNode(node.id)
      return
    }
    manualFocusRef.current = true
    setSelectedNodeId(node.id)
    setFocusedParallelSplitNodeId(branches[0].splitNodeId)
    setNodeDetailZoomTarget(null)
    setViewMode('focus')
  }

  function focusGraphNode(node: WorkflowNode) {
    if (node.type === 'parallel-gateway') {
      focusParallelGateway(node)
      return
    }
    focusNode(node.id, { kind: 'graph' })
  }

  function showGraphAtNode(nodeId: string) {
    setTaskGraphFocusNodeId(nodeId)
    setViewMode('graph')
  }

  function returnFromNodeDetailZoom() {
    const target = getNodeDetailZoomTarget(nodeDetailZoomTarget)
    setNodeDetailZoomTarget(null)
    if (target.kind === 'parallel') {
      manualFocusRef.current = true
      setSelectedNodeId(target.splitNodeId)
      setFocusedParallelSplitNodeId(target.splitNodeId)
      setViewMode('focus')
      return
    }
    setFocusedParallelSplitNodeId(null)
    showGraphAtNode(selectedNodeId)
  }

  async function runWorkflowFromCurrentNode() {
    if (
      !activeProject ||
      !selectedNode ||
      validationErrors.length > 0 ||
      startingWorkflowTaskIdRef.current === activeTaskId
    ) return
    const taskId = activeTaskId
    const projectId = activeProject.id
    const workflowToStart = workflow
    const variablesToStart = { ...variablesRef.current }
    const startNodeId = selectedNode.id
    const startsNewTaskDraft = isNewTaskDraftRef.current
    updateStartingWorkflowTaskId(taskId)
    updatePendingWorkflowId(null)
    manualFocusRef.current = false
    let pendingDraftLaunchRegistered = false
    try {
      if (startsNewTaskDraft) {
        const draftFlush = flushActiveDraft()
        const contentVersion = draftContentVersionsRef.current.get(projectId) ?? 0
        await draftFlush
        pendingDraftLaunchesRef.current.set(taskId, { contentVersion, projectId })
        pendingDraftLaunchRegistered = true
      }
      const state = (await window.cliLoom?.startWorkflow({
        taskId,
        projectId,
        workflow: workflowToStart,
        variables: variablesToStart,
        startNodeId
      })) as WorkflowRuntimeState | undefined
      if (state) {
        applyRuntimeState(state)
      }
    } catch (error) {
      if (pendingDraftLaunchRegistered) pendingDraftLaunchesRef.current.delete(taskId)
      handleError(error, 'startWorkflow')
    } finally {
      if (startingWorkflowTaskIdRef.current === taskId) {
        updateStartingWorkflowTaskId(null)
        if (
          activeTaskIdRef.current === taskId &&
          isNewTaskDraftRef.current &&
          !activeTaskPersistedRef.current &&
          runtimeStateRef.current?.taskId !== taskId
        ) {
          const latestWorkflow = availableWorkflowsRef.current.find(
            (item) => item.id === workflowIdRef.current
          )
          if (latestWorkflow) refreshWorkspaceWorkflowDefinition(latestWorkflow)
        }
      }
    }
  }

  async function continueWorkflowWithVariables() {
    try {
      const state = (await window.cliLoom?.updateWorkflowVariables(activeTaskId, variables)) as WorkflowRuntimeState | null | undefined
      if (state) applyRuntimeState(state)
    } catch (error) {
      handleError(error, 'updateWorkflowVariables')
    }
  }

  async function continueBranchWithVariables(branchId: string) {
    try {
      const state = (await window.cliLoom?.updateWorkflowVariables(activeTaskId, branchRuns[branchId]?.variables ?? {}, branchId)) as WorkflowRuntimeState | null | undefined
      if (state) applyRuntimeState(state)
    } catch (error) {
      handleError(error, 'updateWorkflowBranchVariables')
    }
  }

  async function stopWorkflow() {
    try {
      const state = (await window.cliLoom?.stopWorkflow(activeTaskId)) as WorkflowRuntimeState | null | undefined
      if (state) applyRuntimeState(state)
      else {
        const currentState = runtimeStateRef.current
        if (currentState?.taskId === activeTaskId) {
          updateRuntimeState({ ...currentState, status: 'stopped', activeBranches: [] })
        }
      }
    } catch (error) {
      handleError(error, 'stopWorkflow')
    }
  }

  async function stopTerminal(sessionId: string) {
    try {
      await window.cliLoom?.killProcess(sessionId)
    } catch (error) {
      handleError(error, 'killTerminalProcess')
    }
  }

  async function retryTerminal(sessionId: string, mode: TerminalRetryMode) {
    try {
      await window.cliLoom?.retryProcess(sessionId, mode)
    } catch (error) {
      handleError(error, 'retryTerminalProcess')
    }
  }

  async function retryNode(nodeId: string, branchId?: string) {
    try {
      const state = (await window.cliLoom?.retryWorkflowNode(
        activeTaskId,
        nodeId,
        branchId
      )) as WorkflowRuntimeState | undefined
      if (state) applyRuntimeState(state)
    } catch (error) {
      handleError(error, 'retryWorkflowNode')
    }
  }

  const receiveUpdateState = useCallback((nextState: UpdateState, notify = true) => {
    const previousState = updateStateRef.current
    updateStateRef.current = nextState
    setUpdateState(nextState)

    if (
      (nextState.status === 'available' && previousState.status !== 'available') ||
      (
        nextState.status === 'downloading' &&
        previousState.status !== 'available' &&
        previousState.status !== 'downloading'
      ) ||
      (nextState.status === 'downloaded' && previousState.status !== 'downloaded')
    ) {
      setUpdateDialogOpen(true)
    } else if (nextState.status === 'upToDate' || nextState.status === 'error') {
      setUpdateDialogOpen(false)
    }

    if (!notify) return
    if (nextState.status === 'upToDate' && previousState.status !== 'upToDate') {
      toast.success(i18n.t('settings:update.upToDate', {
        version: nextState.currentVersion
      }))
    } else if (
      nextState.status === 'error' &&
      (previousState.status !== 'error' || previousState.errorCode !== nextState.errorCode)
    ) {
      toast.error(i18n.t(UPDATE_ERROR_KEYS[nextState.errorCode ?? 'check-failed']))
    }
  }, [])

  const loadTerminalTranscript = useCallback((session: TerminalSession): Promise<void> => {
    if (session.transcript !== null) return Promise.resolve()
    const key = `${session.task_id}\u0000${session.id}`
    const pending = terminalTranscriptLoadsRef.current.get(key)
    if (pending) return pending

    const getTranscript = window.cliLoom?.getTaskSessionTranscript
    if (!getTranscript) {
      return Promise.reject(new Error(i18n.t('errors:terminal.transcriptApiUnavailable')))
    }

    const request = getTranscript(session.task_id, session.id)
      .then((snapshot) => {
        setSessions((current) => current.map((item) => (
          item.task_id === session.task_id &&
          item.id === session.id &&
          item.transcript === null
            ? {
                ...item,
                transcript: snapshot.transcript,
                transcript_cursor: snapshot.cursor
              }
            : item
        )))
      })
      .catch((error: unknown) => {
        handleError(error, 'loadTerminalTranscript')
        throw error
      })
    terminalTranscriptLoadsRef.current.set(key, request)
    const clearRequest = () => {
      if (terminalTranscriptLoadsRef.current.get(key) === request) {
        terminalTranscriptLoadsRef.current.delete(key)
      }
    }
    void request.then(clearRequest, clearRequest)
    return request
  }, [])

  useEffect(() => {
    let cancelled = false
    window.cliLoom?.bootstrap().then((data: Bootstrap) => {
      if (cancelled) return
      availableWorkflowsRef.current = data.workflows
      setBootstrap(data)
      setWorkflowRevisions(toWorkflowRevisionMap(data.workflowRecords))
      setProjects(data.projects)
      setSessions(data.terminalSessions)
      setProjectRailWidth(data.settings.layout.projectRailWidth)
      setTaskSidebarWidth(data.settings.layout.taskSidebarWidth)
      applySkin(data.settings.activeSkin)
      setActiveSkin(data.settings.activeSkin)
      syncI18nLanguage(data.settings.appearance.language)
      rememberedWorkspaceKeyRef.current = JSON.stringify(data.lastOpenedWorkspace)
      const rememberedProject = data.projects.find(
        (project) => project.id === data.lastOpenedWorkspace?.projectId
      )
      const initialProject = rememberedProject ?? data.projects[0] ?? null
      pendingStartupTaskRef.current = rememberedProject && data.lastOpenedWorkspace?.taskId
        ? { projectId: rememberedProject.id, taskId: data.lastOpenedWorkspace.taskId }
        : null
      draftContentVersionsRef.current.clear()
      draftRevisionsRef.current.clear()
      for (const item of scheduledDraftSavesRef.current.values()) clearTimeout(item.timer)
      scheduledDraftSavesRef.current.clear()
      pendingDraftLaunchesRef.current.clear()
      pendingDraftLoadRef.current = null
      activeTaskPersistedRef.current = false
      updateNewTaskDraft(false)
      updatePendingWorkflowId(null)
      updateRuntimeState(null)
      activeProjectIdRef.current = initialProject?.id ?? null
      setActiveProjectId(initialProject?.id ?? null)
      const initialWorkflow = data.workflows.find((item) => item.id === initialProject?.default_workflow_id)
        ?? data.workflows[0]
        ?? emptyWorkflow
      updateWorkspaceWorkflow(initialWorkflow)
      setSelectedNodeId(initialWorkflow.nodes[0]?.id ?? '')
      const initialVariables = getDefaultVariables(initialWorkflow)
      variablesRef.current = initialVariables
      setVariables(initialVariables)
    }).catch((error: unknown) => handleError(error, 'bootstrap'))
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    window.cliLoom?.getUpdateState?.().then((state) => {
      if (!cancelled) receiveUpdateState(state, false)
    }).catch(() => {
      if (!cancelled) toast.error(i18n.t('settings:update.error.checkFailed'))
    })
    const removeUpdateState = window.cliLoom?.onUpdateState?.((state) => {
      if (!cancelled) receiveUpdateState(state)
    })
    return () => {
      cancelled = true
      removeUpdateState?.()
    }
  }, [receiveUpdateState])

  useEffect(() => {
    const removeSettings = window.cliLoom?.onSettingsChanged((event) => {
      const settings = event as Bootstrap['settings']
      applySkin(settings.activeSkin)
      setActiveSkin(settings.activeSkin)
      syncI18nLanguage(settings.appearance.language)
      setProjectRailWidth(settings.layout.projectRailWidth)
      setTaskSidebarWidth(settings.layout.taskSidebarWidth)
      setBootstrap((current) => ({ ...current, settings }))
    })
    const removeShells = window.cliLoom?.onShellsChanged((shell) => {
      setBootstrap((current) => ({ ...current, shell }))
    })
    const removeWorkflow = window.cliLoom?.onWorkflowChanged((payload) => {
      const event = payload as {
        operation: 'created' | 'updated' | 'deleted'
        id: string
        source?: 'renderer' | 'assistant'
      }
      if (event.operation === 'deleted') {
        if (pendingWorkflowIdRef.current === event.id) updatePendingWorkflowId(null)
        availableWorkflowsRef.current = availableWorkflowsRef.current.filter(
          (item) => item.id !== event.id
        )
        setWorkflowRevisions((current) => {
          const next = { ...current }
          delete next[event.id]
          return next
        })
        setBootstrap((current) => ({
          ...current,
          workflows: current.workflows.filter((item) => item.id !== event.id),
          workflowRecords: current.workflowRecords.filter((record) => record.workflow.id !== event.id)
        }))
      }
      window.cliLoom?.listWorkflows().then((records: WorkflowRecord[]) => {
        const changedRecord = records.find((record) => record.workflow.id === event.id)
        applyWorkflowCatalog(records)
        if (
          pendingWorkflowIdRef.current &&
          !records.some((record) => record.workflow.id === pendingWorkflowIdRef.current)
        ) {
          updatePendingWorkflowId(null)
        }
        if (
          workflowIdRef.current === event.id &&
          !currentWorkspaceUsesTaskSnapshot()
        ) {
          if (event.operation === 'deleted') {
            if (!currentWorkspaceHasDraftContent()) {
              resetTaskWorkspaceWithWorkflow(records[0]?.workflow ?? emptyWorkflow, {
                draftStarted: false,
                isNewTaskDraft: false
              })
            }
          } else if (changedRecord) {
            if (currentWorkspaceHasDraftContent()) {
              refreshWorkspaceWorkflowDefinition(changedRecord.workflow)
            } else {
              resetTaskWorkspaceWithWorkflow(changedRecord.workflow, {
                draftStarted: false,
                isNewTaskDraft: false
              })
            }
          }
        }
        if (
          event.source !== 'renderer' &&
          designerOpenRef.current &&
          editingWorkflowIdRef.current === event.id &&
          !designerDirtyRef.current
        ) {
          if (changedRecord) openDesigner(changedRecord.workflow)
          else {
            setDesignerOpen(false)
            setEditingWorkflow(null)
            setDesignerDirty(false)
          }
        }
      }).catch((error: unknown) => handleError(error, 'refreshWorkflows'))
    })
    const removeProject = window.cliLoom?.onProjectChanged(() => {
      window.cliLoom?.listProjects().then((records: ProjectRecord[]) => {
        setProjects(records)
      }).catch((error: unknown) => handleError(error, 'refreshProjects'))
    })
    return () => {
      removeSettings?.()
      removeShells?.()
      removeWorkflow?.()
      removeProject?.()
    }
  }, [])

  useEffect(() => {
    window.cliLoom?.setDesignerState({
      workflowId: editingWorkflow?.id ?? null,
      open: designerOpen,
      dirty: designerDirty
    }).catch((error: unknown) => handleError(error, 'setDesignerState'))
  }, [designerDirty, designerOpen, editingWorkflow?.id])

  useEffect(() => {
    setVisibleTaskCount(TASK_BATCH_SIZE)
    if (!activeProjectId) {
      setTasks([])
      return
    }
    let cancelled = false
    window.cliLoom?.listTasks(activeProjectId).then((records: TaskRecord[]) => {
      if (cancelled) return
      setTasks(records)

      const pendingTask = pendingStartupTaskRef.current
      if (!pendingTask || pendingTask.projectId !== activeProjectId) return
      pendingStartupTaskRef.current = null
      const task = records.find((record) => record.id === pendingTask.taskId)
      if (!task) {
        rememberWorkspace(activeProjectId, null)
        return
      }
      const taskIndex = records.indexOf(task)
      if (taskIndex >= TASK_BATCH_SIZE) {
        setVisibleTaskCount(Math.ceil((taskIndex + 1) / TASK_BATCH_SIZE) * TASK_BATCH_SIZE)
      }
      loadTask(task)
    }).catch((error: unknown) => handleError(error, 'listTasks'))
    return () => {
      cancelled = true
    }
  }, [activeProjectId])

  useEffect(() => {
    activeTaskIdRef.current = activeTaskId
  }, [activeTaskId])

  useEffect(() => {
    if (!persistedActiveTask) return
    activeTaskPersistedRef.current = true
    if (isNewTaskDraftRef.current) {
      updateNewTaskDraft(false)
      updatePendingWorkflowId(null)
    }
  }, [persistedActiveTask?.id])

  useEffect(() => {
    const pendingTerminalData = new Map<string, TerminalDataEvent[]>()
    let terminalDataTimer: ReturnType<typeof setTimeout> | null = null

    const flushTerminalData = () => {
      if (terminalDataTimer) {
        clearTimeout(terminalDataTimer)
        terminalDataTimer = null
      }
      if (pendingTerminalData.size === 0) return

      const events = new Map(pendingTerminalData)
      pendingTerminalData.clear()
      setSessions((current) => current.map((session) => {
        const sessionEvents = events.get(session.id) ??
          [...events.values()].find((items) => items.some((item) => (
            session.id.startsWith('pending-') &&
            session.node_id === item.nodeId &&
            session.task_id === item.taskId
          )))
        if (!sessionEvents) return session

        let transcript = session.transcript ?? ''
        let cursor = session.transcript_cursor ?? -1
        let resolvedSessionId = session.id
        for (const event of sessionEvents) {
          if (event.cursor <= cursor) continue
          transcript = appendBoundedText(
            transcript,
            event.content,
            MAX_TERMINAL_TRANSCRIPT_CHARS
          )
          cursor = event.cursor
          resolvedSessionId = event.sessionId
        }
        if (cursor === (session.transcript_cursor ?? -1)) return session
        return {
          ...session,
          id: resolvedSessionId,
          transcript,
          transcript_cursor: cursor,
          status: 'running'
        }
      }))
    }

    const removeCreated = window.cliLoom?.onTerminalCreated((event) => {
      const session = event as TerminalSession
      if (session.task_id !== activeTaskIdRef.current) return
      setSessions((current) => (
        current.some((item) => item.id === session.id)
          ? current.map((item) => item.id === session.id ? session : item)
          : [...current, session]
      ))
    })
    const removeRestarted = window.cliLoom?.onTerminalRestarted((event) => {
      const session = event as TerminalSession
      if (session.task_id !== activeTaskIdRef.current) return
      pendingTerminalData.delete(session.id)
      setSessions((current) => (
        current.some((item) => item.id === session.id)
          ? current.map((item) => item.id === session.id ? session : item)
          : [...current, session]
      ))
    })
    const removeData = window.cliLoom?.onTerminalData((event) => {
      const pending = pendingTerminalData.get(event.sessionId) ?? []
      pending.push(event)
      let overflow = pending.reduce((total, item) => total + item.content.length, 0) -
        MAX_TERMINAL_TRANSCRIPT_CHARS
      while (overflow > 0 && pending.length > 0) {
        const first = pending[0]
        if (first.content.length <= overflow) {
          overflow -= first.content.length
          pending.shift()
        } else {
          pending[0] = { ...first, content: first.content.slice(overflow) }
          overflow = 0
        }
      }
      pendingTerminalData.set(event.sessionId, pending)
      if (!terminalDataTimer) {
        terminalDataTimer = setTimeout(flushTerminalData, TERMINAL_STATE_FLUSH_MS)
      }
    })
    const removeClosed = window.cliLoom?.onTerminalClosed((event) => {
      flushTerminalData()
      setSessions((current) => {
        const exact = current.find((s) => s.id === event.sessionId)
        if (exact) {
          return current.map((s) => (s.id === event.sessionId ? { ...s, status: event.status } : s))
        }
        return current.map((s) =>
          s.id.startsWith('pending-') && s.node_id === event.nodeId && s.task_id === event.taskId
            ? { ...s, id: event.sessionId, status: event.status }
            : s
        )
      })
    })
    return () => {
      removeCreated?.()
      removeRestarted?.()
      removeData?.()
      removeClosed?.()
      if (terminalDataTimer) clearTimeout(terminalDataTimer)
      pendingTerminalData.clear()
    }
  }, [])

  useEffect(() => {
    const removeState = window.cliLoom?.onWorkflowState((event) => {
      applyRuntimeState(event as WorkflowRuntimeState)
    })
    return () => removeState?.()
  }, [])

  useEffect(() => {
    const flushDraftBeforeUnload = () => {
      if (rendererPreparingToCloseRef.current) return
      void flushDraftOperations()
    }
    window.addEventListener('beforeunload', flushDraftBeforeUnload)
    const removePrepareToClose = window.cliLoom?.onPrepareToClose?.(() => {
      rendererPreparingToCloseRef.current = true
      void flushDraftOperations().then(() => {
        try {
          window.cliLoom?.rendererReadyToClose?.()
        } catch {
          // The main process will use its bounded timeout if the renderer is
          // already shutting down and cannot send the acknowledgement.
        }
      }, () => {
        // A failed persistence operation must not block a normal application
        // close; the main process also has a bounded acknowledgement timeout.
        try {
          window.cliLoom?.rendererReadyToClose?.()
        } catch {
          // See the timeout comment above.
        }
      })
    })
    return () => {
      window.removeEventListener('beforeunload', flushDraftBeforeUnload)
      removePrepareToClose?.()
      for (const item of scheduledDraftSavesRef.current.values()) {
        clearTimeout(item.timer)
      }
      scheduledDraftSavesRef.current.clear()
    }
  }, [])

  async function chooseFolder() {
    try {
      const project = (await window.cliLoom?.chooseAndAddProject()) as ProjectRecord | null
      if (!project) return
      const requestId = draftLoadRequestRef.current + 1
      draftLoadRequestRef.current = requestId
      pendingStartupTaskRef.current = null
      pendingDraftLoadRef.current = null
      await flushActiveDraft()
      if (draftLoadRequestRef.current !== requestId) return
      const nextProjects = (await window.cliLoom?.listProjects()) as ProjectRecord[]
      if (draftLoadRequestRef.current !== requestId) return
      setProjects(nextProjects)
      // The folder picker also returns an existing project when the selected
      // path is already registered. Keep the current editor in place in that
      // case; switching away and back is the explicit navigation action that
      // should reset the transient workspace.
      if (project.id === activeProjectIdRef.current) return
      activeProjectIdRef.current = project.id
      setActiveProjectId(project.id)
      setTasks([])
      resetTaskWorkspaceForProject(project, { draftStarted: false })
      rememberWorkspace(project.id, null)
      // Landing on the project through the folder picker is a project switch
      // as well, so restore its draft like the rail navigation does.
      await loadPersistedDraft(project, requestId)
    } catch (error) {
      handleError(error, 'chooseFolder')
    }
  }

  async function deleteActiveProject(project: ProjectRecord) {
    try {
      let switchRequestId: number | null = null
      if (project.id === activeProjectIdRef.current) {
        switchRequestId = draftLoadRequestRef.current + 1
        draftLoadRequestRef.current = switchRequestId
        pendingDraftLoadRef.current = null
        await flushActiveDraft()
      }
      await window.cliLoom?.deleteProject(project.id)
      const nextProjects = (await window.cliLoom?.listProjects()) as ProjectRecord[]
      const nextActiveProjectId = getNextActiveProjectIdAfterDelete({ projects: nextProjects, deletedProjectId: project.id })
      const nextProject = nextProjects.find((item) => item.id === nextActiveProjectId) ?? null
      setProjects(nextProjects)
      activeProjectIdRef.current = nextActiveProjectId
      setActiveProjectId(nextActiveProjectId)
      setTasks([])
      resetTaskWorkspaceForProject(nextProject, { draftStarted: false })
      rememberWorkspace(nextProject?.id ?? null, null)
      // Falling back to a neighboring project is a project switch too, so
      // restore its draft like an explicit navigation would.
      if (switchRequestId !== null && nextProject) {
        await loadPersistedDraft(nextProject, switchRequestId)
      }
    } catch (error) {
      handleError(error, 'deleteActiveProject')
    }
  }

  async function renameProjectRecord(project: ProjectRecord, name: string) {
    const normalizedName = normalizeProjectName(name)
    if (!normalizedName) return
    try {
      await window.cliLoom?.renameProject(project.id, normalizedName)
      setProjects((current) => current.map((item) => (
        item.id === project.id ? { ...item, name: normalizedName } : item
      )))
    } catch (error) {
      handleError(error, 'renameProject')
      throw error
    }
  }

  async function renameTask(task: TaskRecord, title: string) {
    const normalizedTitle = normalizeTaskTitle(title)
    if (!normalizedTitle) return
    try {
      await window.cliLoom?.updateTaskTitle(task.id, normalizedTitle)
      setTasks((current) => current.map((item) => (
        item.id === task.id ? { ...item, title: normalizedTitle } : item
      )))
    } catch (error) {
      handleError(error, 'renameTask')
      throw error
    }
  }

  async function deleteTaskRecord(task: TaskRecord) {
    try {
      await window.cliLoom?.deleteTask(task.id)
      setTasks((current) => current.filter((item) => item.id !== task.id))
      if (shouldResetActiveTaskAfterDelete({ activeTaskId, deletedTaskId: task.id })) {
        resetTaskWorkspaceForProject(activeProject, { draftStarted: false })
        rememberWorkspace(activeProject?.id ?? null, null)
      }
    } catch (error) {
      handleError(error, 'deleteTask')
      throw error
    }
  }

  async function reorderProject(dragId: string, dropId: string) {
    if (dragId === dropId) return
    const current = [...projects]
    const dragIndex = current.findIndex((item) => item.id === dragId)
    const dropIndex = current.findIndex((item) => item.id === dropId)
    if (dragIndex < 0 || dropIndex < 0) return
    const [dragged] = current.splice(dragIndex, 1)
    current.splice(dropIndex, 0, dragged)
    setProjects(current)
    try {
      await window.cliLoom?.reorderProjects(current.map((item) => item.id))
    } catch (error) {
      handleError(error, 'reorderProject')
    }
  }

  function restoreDraftVariables(
    nextWorkflow: WorkflowDefinition,
    cachedVariables: Record<string, VariableValue>
  ): Record<string, VariableValue> {
    const defaults = getDefaultVariables(nextWorkflow)
    const startNode = nextWorkflow.nodes.find((node) => node.type === 'start')
    const definitions = startNode ? getCurrentInputVariables(startNode) : []
    const definitionByKey = new Map(definitions.map((definition) => [definition.key, definition]))
    const restored: Record<string, VariableValue> = {}

    for (const [key, defaultValue] of Object.entries(defaults)) {
      if (validateUserVariableKey(key)) continue
      const definition = definitionByKey.get(key)
      const cachedValue = cachedVariables[key]
      if (!definition || !Object.prototype.hasOwnProperty.call(cachedVariables, key)) {
        Object.defineProperty(restored, key, {
          configurable: true,
          enumerable: true,
          value: defaultValue,
          writable: true
        })
        continue
      }

      const compatible = definition.type === 'number'
        ? typeof cachedValue === 'number' && Number.isFinite(cachedValue)
        : typeof cachedValue === 'string'
      Object.defineProperty(restored, key, {
        configurable: true,
        enumerable: true,
        value: compatible ? cachedValue : defaultValue,
        writable: true
      })
    }
    return restored
  }

  function resetTaskWorkspaceWithWorkflow(
    nextWorkflow: WorkflowDefinition,
    options: {
      draftStarted: boolean
      isNewTaskDraft?: boolean
      variables?: Record<string, VariableValue>
    }
  ) {
    taskLoadRequestRef.current += 1
    updateWorkspaceWorkflow(nextWorkflow)
    setSelectedNodeId(nextWorkflow.nodes[0]?.id ?? '')
    const nextVariables = options.variables ?? getDefaultVariables(nextWorkflow)
    variablesRef.current = nextVariables
    setVariables(nextVariables)
    setNodeRuns({})
    setBranchRuns({})
    setSessions([])
    setExecutionOrder([])
    updateRuntimeState(null)
    const nextTaskId = `draft-${Date.now()}-${crypto.randomUUID()}`
    setActiveTaskId(nextTaskId)
    activeTaskIdRef.current = nextTaskId
    activeTaskPersistedRef.current = false
    updateDraftStarted(options.draftStarted)
    updateNewTaskDraft(options.isNewTaskDraft ?? false)
    updatePendingWorkflowId(null)
    setWorkflowCompleted(false)
    setTaskGraphFocusNodeId(null)
    setFocusedParallelSplitNodeId(null)
    setNodeDetailZoomTarget(null)
    setParallelZoomNodeId(null)
    manualFocusRef.current = false
    setViewMode('focus')
  }

  function resetTaskWorkspaceForProject(
    project: ProjectRecord | null,
    options: {
      draftStarted: boolean
      isNewTaskDraft?: boolean
      variables?: Record<string, VariableValue>
    }
  ) {
    const nextWorkflow = project
      ? (availableWorkflows.find((item) => item.id === project.default_workflow_id) ?? availableWorkflows[0] ?? emptyWorkflow)
      : (availableWorkflows[0] ?? emptyWorkflow)
    resetTaskWorkspaceWithWorkflow(nextWorkflow, options)
  }

  function createFreshProjectDraft(project: ProjectRecord): void {
    resetTaskWorkspaceForProject(project, { draftStarted: true, isNewTaskDraft: true })
    rememberWorkspace(project.id, null)
    void persistDraftSnapshot(project.id, workflowRef.current, variablesRef.current, { overwrite: true })
  }

  // Loads the persisted draft for a project and applies it to the workspace.
  // Shared by the explicit New task action and the automatic restore that
  // follows switching projects. Aborts without touching the workspace when a
  // newer navigation request has taken over.
  async function loadPersistedDraft(project: ProjectRecord, requestId: number): Promise<DraftLookupOutcome> {
    const getDraft = window.cliLoom?.getTaskDraft
    if (getDraft) pendingDraftLoadRef.current = { projectId: project.id, requestId }

    const isCurrentRequest = () => (
      draftLoadRequestRef.current === requestId && activeProjectIdRef.current === project.id
    )
    // Only the request that owns the pending marker may clear it, so a stale
    // lookup for the same project cannot unset a newer pending lookup.
    const clearPendingLoad = () => {
      if (pendingDraftLoadRef.current?.requestId === requestId) {
        pendingDraftLoadRef.current = null
      }
    }

    const pendingDraftOperation = draftSaveQueuesRef.current.get(project.id)
    if (pendingDraftOperation) {
      await pendingDraftOperation.catch(() => undefined)
      if (!isCurrentRequest()) {
        clearPendingLoad()
        return 'aborted'
      }
    }

    let draft: TaskDraftRecord | null = null
    if (getDraft) {
      try {
        draft = await getDraft(project.id)
      } catch (error) {
        clearPendingLoad()
        if (!isCurrentRequest()) return 'aborted'
        handleError(error, 'getTaskDraft')
        return 'error'
      }
    }

    if (!isCurrentRequest()) {
      clearPendingLoad()
      return 'aborted'
    }
    clearPendingLoad()

    // Treat a mismatched response as an empty draft. The project ID is part of
    // the persisted record so a stale or misrouted IPC response can never be
    // applied to the currently selected project.
    if (draft && draft.projectId !== project.id) draft = null

    if (!draft) return 'missing'

    const latestWorkflow = availableWorkflowsRef.current.find((item) => item.id === draft.workflow.id)
      ?? availableWorkflowsRef.current.find((item) => item.id === project.default_workflow_id)
      ?? availableWorkflowsRef.current[0]
      ?? emptyWorkflow
    const restoredVariables = restoreDraftVariables(latestWorkflow, draft.variables)
    draftRevisionsRef.current.set(project.id, draft.revision)
    resetTaskWorkspaceWithWorkflow(latestWorkflow, {
      draftStarted: true,
      isNewTaskDraft: true,
      variables: restoredVariables
    })
    rememberWorkspace(project.id, null)

    const workflowChanged = JSON.stringify(latestWorkflow) !== JSON.stringify(draft.workflow)
    const variablesChanged = JSON.stringify(restoredVariables) !== JSON.stringify(draft.variables)
    if (workflowChanged || variablesChanged) {
      void persistDraftSnapshot(project.id, latestWorkflow, restoredVariables)
    }
    return 'restored'
  }

  async function startNewTask(): Promise<void> {
    if (!canStartNewTask({ hasActiveProject: Boolean(activeProject) }) || availableWorkflows.length === 0) return
    if (!activeProject) return

    const project = activeProject
    // An explicit New task action takes precedence over the deferred restore
    // of the last persisted task during application bootstrap.
    pendingStartupTaskRef.current = null
    const requestId = draftLoadRequestRef.current + 1
    draftLoadRequestRef.current = requestId

    // Clicking New task while already editing a draft explicitly replaces it
    // with a fresh project-default draft, as requested by the product rule.
    if (isNewTaskDraftRef.current && activeProjectIdRef.current === project.id) {
      createFreshProjectDraft(project)
      return
    }

    // Treat a second click while the first draft lookup is still pending as an
    // explicit request for a fresh draft as well.
    if (pendingDraftLoadRef.current?.projectId === project.id) {
      pendingDraftLoadRef.current = null
      createFreshProjectDraft(project)
      return
    }

    // Without a draft bridge there is nothing to look up, so keep this path
    // synchronous and create the fresh draft immediately.
    if (!window.cliLoom?.getTaskDraft && !draftSaveQueuesRef.current.get(project.id)) {
      createFreshProjectDraft(project)
      return
    }

    const outcome = await loadPersistedDraft(project, requestId)
    if (outcome === 'missing') {
      if (
        draftLoadRequestRef.current === requestId &&
        activeProjectIdRef.current === project.id
      ) {
        createFreshProjectDraft(project)
      }
    }
  }

  function applyDraftWorkflow(nextWorkflow: WorkflowDefinition) {
    if (!activeProject || !canSwitchCurrentDraftWorkflow()) return
    resetTaskWorkspaceWithWorkflow(nextWorkflow, {
      draftStarted: true,
      isNewTaskDraft: true
    })
    rememberWorkspace(activeProject.id, null)
    void persistDraftSnapshot(activeProject.id, nextWorkflow, variablesRef.current)
  }

  function requestDraftWorkflowChange(workflowId: string) {
    if (workflowId === workflowIdRef.current || !canSwitchCurrentDraftWorkflow()) return
    const nextWorkflow = availableWorkflows.find((item) => item.id === workflowId)
    if (!nextWorkflow) return

    if (hasModifiedWorkflowVariables(variables, getDefaultVariables(workflow))) {
      updatePendingWorkflowId(workflowId)
      return
    }

    applyDraftWorkflow(nextWorkflow)
  }

  async function confirmDraftWorkflowChange() {
    const workflowId = pendingWorkflowIdRef.current
    if (!workflowId || !canSwitchCurrentDraftWorkflow()) {
      updatePendingWorkflowId(null)
      return
    }

    const taskId = activeTaskIdRef.current
    const workspaceRequestId = taskLoadRequestRef.current
    const confirmationRequestId = workflowConfirmationRequestRef.current + 1
    workflowConfirmationRequestRef.current = confirmationRequestId
    setIsConfirmingWorkflowChange(true)

    let latestWorkflows: WorkflowDefinition[]
    try {
      const records = await window.cliLoom?.listWorkflows() as WorkflowRecord[] | undefined
      if (!records) {
        updatePendingWorkflowId(null)
        return
      }
      latestWorkflows = applyWorkflowCatalog(records)
    } catch (error) {
      if (workflowConfirmationRequestRef.current === confirmationRequestId) {
        updatePendingWorkflowId(null)
      }
      handleError(error, 'confirmWorkflowChange')
      return
    } finally {
      if (workflowConfirmationRequestRef.current === confirmationRequestId) {
        setIsConfirmingWorkflowChange(false)
      }
    }

    if (
      workflowConfirmationRequestRef.current !== confirmationRequestId ||
      pendingWorkflowIdRef.current !== workflowId ||
      taskLoadRequestRef.current !== workspaceRequestId ||
      activeTaskIdRef.current !== taskId ||
      !canSwitchCurrentDraftWorkflow()
    ) return

    const nextWorkflow = latestWorkflows.find((item) => item.id === workflowId)
    if (!nextWorkflow) {
      updatePendingWorkflowId(null)
      return
    }
    applyDraftWorkflow(nextWorkflow)
  }

  async function selectProject(project: ProjectRecord) {
    if (project.id === activeProjectIdRef.current) return
    const requestId = draftLoadRequestRef.current + 1
    draftLoadRequestRef.current = requestId
    pendingStartupTaskRef.current = null
    pendingDraftLoadRef.current = null
    await flushActiveDraft()
    if (draftLoadRequestRef.current !== requestId) return
    activeProjectIdRef.current = project.id
    setActiveProjectId(project.id)
    setTasks([])
    resetTaskWorkspaceForProject(project, { draftStarted: false })
    rememberWorkspace(project.id, null)
    // Switching to a project that has a persisted draft restores it directly
    // so editing resumes without clicking New task again. Without a draft the
    // neutral workspace prepared above stays in place.
    await loadPersistedDraft(project, requestId)
  }

  async function setDefaultWorkflow(workflowId: string) {
    if (!activeProject) return
    try {
      await window.cliLoom?.setProjectDefaultWorkflow(activeProject.id, workflowId)
    } catch (error) {
      handleError(error, 'setDefaultWorkflow')
      return
    }
    const nextProjects = projects.map((project) =>
      project.id === activeProject.id ? { ...project, default_workflow_id: workflowId } : project
    )
    setProjects(nextProjects)
    const nextWorkflow = availableWorkflows.find((item) => item.id === workflowId)
    if (
      nextWorkflow &&
      !currentWorkspaceUsesTaskSnapshot() &&
      !currentWorkspaceHasDraftContent()
    ) {
      resetTaskWorkspaceWithWorkflow(nextWorkflow, {
        draftStarted: false,
        isNewTaskDraft: false
      })
    }
  }

  function openDesigner(workflowToEdit?: WorkflowDefinition) {
    const target = workflowToEdit ?? {
      id: `workflow-${Date.now()}`,
      name: t('workflow:newName'),
      nodes: [],
      edges: [],
      layout: { nodes: {} }
    }
    designerEditVersionRef.current += 1
    setEditingWorkflow(target)
    setDesignerDirty(false)
    setFlowNodes(
      target.nodes.map((node, index) => ({
        id: node.id,
        type: 'workflowNode',
        position: {
          x: target.layout?.nodes[node.id]?.x ?? 100 + (index % 4) * 230,
          y: target.layout?.nodes[node.id]?.y ?? 90 + Math.floor(index / 4) * 140
        },
        data: { workflowNode: node }
      }))
    )
    setFlowEdges(
      target.edges.map((edge) => ({
        id: edge.id,
        source: edge.from,
        target: edge.to,
        type: 'designerEdge',
        animated: edge.isDefault,
        label: edge.condition,
        markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--muted-foreground)', width: 16, height: 16 },
        style: edge.condition && !edge.isDefault ? { strokeDasharray: '5 3' } : {},
        data: { workflowEdge: edge, onDelete: deleteDesignerEdgeById }
      }))
    )
    setDesignerSelection(target.nodes[0] ? { kind: 'node', id: target.nodes[0].id } : null)
    setDesignerOpen(true)
  }

  async function saveDesigner() {
    if (!editingWorkflow) return
    const savedDesignerVersion = designerEditVersionRef.current
    const nextWorkflow: WorkflowDefinition = {
      ...editingWorkflow,
      nodes: flowNodes.map((node) => node.data.workflowNode),
      edges: flowEdges.map((edge) => edge.data!.workflowEdge),
      layout: {
        nodes: Object.fromEntries(flowNodes.map((node) => [node.id, { x: node.position.x, y: node.position.y }]))
      }
    }
    let result: WorkflowSaveResult
    try {
      const response = await window.cliLoom?.saveWorkflow(
        nextWorkflow,
        workflowRevisions[nextWorkflow.id]
      ) as WorkflowSaveResult | undefined
      if (!response) throw new Error(t('errors:workflow.saveNoResult'))
      result = response
    } catch (error) {
      handleError(error, 'saveDesigner')
      return
    }
    const savedWorkflow = result.workflow
    const savedRevision = result.revision
    setBootstrap((current) => ({
      ...current,
      workflows: [savedWorkflow, ...current.workflows.filter((item) => item.id !== savedWorkflow.id)]
    }))
    setWorkflowRevisions((current) => ({ ...current, [savedWorkflow.id]: savedRevision }))
    const designerUnchanged = (
      designerOpenRef.current &&
      editingWorkflowIdRef.current === nextWorkflow.id &&
      designerEditVersionRef.current === savedDesignerVersion
    )
    if (designerUnchanged) {
      setEditingWorkflow(savedWorkflow)
      if (!currentWorkspaceUsesTaskSnapshot()) {
        if (savedWorkflow.id === workflowIdRef.current) {
          if (currentWorkspaceHasDraftContent()) {
            refreshWorkspaceWorkflowDefinition(savedWorkflow)
          } else {
            resetTaskWorkspaceWithWorkflow(savedWorkflow, {
              draftStarted: false,
              isNewTaskDraft: false
            })
          }
        } else if (!currentWorkspaceHasDraftContent()) {
          resetTaskWorkspaceWithWorkflow(savedWorkflow, {
            draftStarted: false,
            isNewTaskDraft: false
          })
        }
      }
      setDesignerDirty(false)
    }
    toast.success(t('workflow:toast.saved'))
  }

  async function copyWorkflowDefinition(workflowToCopy: WorkflowDefinition) {
    const copiedWorkflow = duplicateWorkflowDefinition(workflowToCopy, {
      name: getWorkflowCopyName(workflowToCopy.name, availableWorkflows),
      createId: (kind) => `${kind}-${crypto.randomUUID()}`
    })

    let savedWorkflow = copiedWorkflow
    let savedRevision: number | undefined
    try {
      const result = await window.cliLoom?.saveWorkflow(copiedWorkflow) as WorkflowSaveResult | undefined
      if (result) {
        savedWorkflow = result.workflow
        savedRevision = result.revision
      }
    } catch (error) {
      handleError(error, 'copyWorkflow')
      return
    }

    setBootstrap((current) => {
      const workflows = [...current.workflows]
      const sourceIndex = workflows.findIndex((item) => item.id === workflowToCopy.id)
      workflows.splice(sourceIndex >= 0 ? sourceIndex + 1 : 0, 0, savedWorkflow)
      return { ...current, workflows }
    })
    if (savedRevision !== undefined) {
      setWorkflowRevisions((current) => ({ ...current, [savedWorkflow.id]: savedRevision }))
    }
    openDesigner(savedWorkflow)
  }

  async function deleteWorkflowDefinition(workflowToRemove: WorkflowDefinition) {
    const expectedRevision = workflowRevisions[workflowToRemove.id]
    if (expectedRevision === undefined) {
      const error = new Error(t('errors:workflow.revisionMissing'))
      handleError(error, 'deleteWorkflow')
      throw error
    }
    try {
      await window.cliLoom?.deleteWorkflow(workflowToRemove.id, expectedRevision)
    } catch (error) {
      handleError(error, 'deleteWorkflow')
      throw error
    }

    const remainingWorkflows = bootstrap.workflows.filter((item) => item.id !== workflowToRemove.id)
    const nextWorkflow = remainingWorkflows[0] ?? emptyWorkflow
    setBootstrap((current) => ({
      ...current,
      workflows: current.workflows.filter((item) => item.id !== workflowToRemove.id)
    }))
    setWorkflowRevisions((current) => {
      const next = { ...current }
      delete next[workflowToRemove.id]
      return next
    })
    setProjects((current) => current.map((project) => (
      project.default_workflow_id === workflowToRemove.id
        ? { ...project, default_workflow_id: null }
        : project
    )))

    if (
      workflowIdRef.current === workflowToRemove.id &&
      !currentWorkspaceUsesTaskSnapshot() &&
      !currentWorkspaceHasDraftContent()
    ) {
      resetTaskWorkspaceWithWorkflow(nextWorkflow, {
        draftStarted: false,
        isNewTaskDraft: false
      })
    }
    if (editingWorkflow?.id === workflowToRemove.id) {
      openDesigner(nextWorkflow)
    }
  }

  function requestCloseDesigner() {
    if (designerDirty) {
      setDesignerCloseConfirmationOpen(true)
      return
    }
    setDesignerOpen(false)
  }

  function startColumnResize(kind: 'project' | 'tasks', event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = kind === 'project' ? projectRailWidth : taskSidebarWidth
    const updateWidth = kind === 'project' ? setProjectRailWidth : setTaskSidebarWidth
    const minWidth = kind === 'project' ? 60 : 140
    const maxWidth = kind === 'project' ? 220 : 380
    let finalWidth = startWidth

    document.body.classList.add('is-resizing-columns')

    function move(pointerEvent: PointerEvent) {
      finalWidth = clamp(startWidth + pointerEvent.clientX - startX, minWidth, maxWidth)
      updateWidth(finalWidth)
    }

    function stop() {
      document.body.classList.remove('is-resizing-columns')
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      const layout = {
        version: 1 as const,
        projectRailWidth: kind === 'project' ? finalWidth : projectRailWidth,
        taskSidebarWidth: kind === 'tasks' ? finalWidth : taskSidebarWidth
      }
      window.cliLoom?.updateLayout(layout).catch((error: unknown) => handleError(error, 'updateLayout'))
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }

  async function checkForUpdates() {
    try {
      const nextState = await window.cliLoom?.checkForUpdates?.()
      if (!nextState) throw new Error('Update API unavailable')
      receiveUpdateState(nextState)
      if (
        nextState.status === 'available' ||
        nextState.status === 'downloading' ||
        nextState.status === 'downloaded'
      ) {
        setUpdateDialogOpen(true)
      }
    } catch {
      toast.error(t('settings:update.error.checkFailed'))
    }
  }

  async function installUpdate() {
    try {
      const nextState = await window.cliLoom?.installUpdate?.()
      if (!nextState) throw new Error('Update API unavailable')
      receiveUpdateState(nextState)
    } catch {
      toast.error(t('settings:update.error.installFailed'))
    }
  }

  async function openUpdateRelease() {
    try {
      const nextState = await window.cliLoom?.openUpdateRelease?.()
      if (!nextState) throw new Error('Update API unavailable')
      receiveUpdateState(nextState)
    } catch {
      toast.error(t('settings:update.error.openReleaseFailed'))
    }
  }

  return (
    <div
      className="app-shell grid h-full w-full overflow-hidden text-foreground"
      style={{
        '--project-rail-width': `${projectRailWidth}px`,
        '--task-sidebar-width': `${taskSidebarWidth}px`,
        background: 'var(--app-background)'
      } as CSSProperties}
    >
      <ProjectRail
        projects={projects}
        activeProjectId={activeProjectId}
        onSelectProject={selectProject}
        onReorderProject={reorderProject}
        onAddProject={chooseFolder}
        onRenameProject={renameProjectRecord}
        onDeleteProject={deleteActiveProject}
        onOpenDesigner={() => openDesigner()}
        onOpenAssistant={() => {
          window.cliLoom?.openAssistant().catch((error: unknown) => handleError(error, 'openAssistant'))
        }}
        activeSkinId={bootstrap.settings.appearance.activeSkinId}
        userSkins={bootstrap.settings.skins}
        onOpenAppearance={() => setAppearancePanelOpen(true)}
        shellSnapshot={bootstrap.shell}
        onShellChange={async (shellId) => {
          try {
            const shell = await window.cliLoom?.updateShell(shellId)
            if (shell) setBootstrap((current) => ({ ...current, shell }))
          } catch (error) {
            handleError(error, 'updateShell')
            throw error
          }
        }}
        onRefreshShells={async () => {
          try {
            const shell = await window.cliLoom?.refreshShells()
            if (shell) setBootstrap((current) => ({ ...current, shell }))
          } catch (error) {
            handleError(error, 'refreshShells')
            throw error
          }
        }}
        updateState={updateState}
        onCheckForUpdates={() => void checkForUpdates()}
        onInstallUpdate={() => void installUpdate()}
        onOpenUpdateRelease={() => void openUpdateRelease()}
        onSkinChange={(id) => {
          const previous = activeSkin
          const next = resolveSkinFromId(id, bootstrap.settings.skins) ?? previous
          applySkin(next)
          setActiveSkin(next)
          setBootstrap((current) => ({
            ...current,
            settings: {
              ...current.settings,
              appearance: { ...current.settings.appearance, activeSkinId: id },
              activeSkin: next
            }
          }))
          window.cliLoom?.setActiveSkin(id).catch((error: unknown) => {
            applySkin(previous)
            setActiveSkin(previous)
            setBootstrap((current) => ({
              ...current,
              settings: {
                ...current.settings,
                appearance: { ...current.settings.appearance, activeSkinId: previous.id },
                activeSkin: previous
              }
            }))
            handleError(error, 'setActiveSkin')
          })
        }}
        language={bootstrap.settings.appearance.language}
        onLanguageChange={(language) => {
          const previous = bootstrap.settings.appearance.language
          syncI18nLanguage(language)
          setBootstrap((current) => ({
            ...current,
            settings: {
              ...current.settings,
              appearance: { ...current.settings.appearance, language }
            }
          }))
          window.cliLoom?.updateLanguage(language).catch((error: unknown) => {
            syncI18nLanguage(previous)
            setBootstrap((current) => ({
              ...current,
              settings: {
                ...current.settings,
                appearance: { ...current.settings.appearance, language: previous }
              }
            }))
            handleError(error, 'updateLanguage')
          })
        }}
      />

      <AppearancePanel
        open={appearancePanelOpen}
        onOpenChange={setAppearancePanelOpen}
        activeSkin={bootstrap.settings.activeSkin}
        activeSkinId={bootstrap.settings.appearance.activeSkinId}
        userSkins={bootstrap.settings.skins}
      />

      <Dialog open={updateDialogOpen} onOpenChange={setUpdateDialogOpen}>
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden sm:max-w-lg">
          <DialogHeader className="shrink-0">
            <DialogTitle>
              {t(
                updateState.status === 'downloaded'
                  ? 'settings:update.readyTitle'
                  : 'settings:update.availableTitle',
                { version: updateState.targetVersion ?? updateState.currentVersion }
              )}
            </DialogTitle>
            <DialogDescription className="flex flex-col gap-2">
              <span>
                {t('settings:update.currentAndLatest', {
                  current: updateState.currentVersion,
                  latest: updateState.targetVersion ?? updateState.currentVersion
                })}
              </span>
              {updateState.status === 'downloaded' ? (
                <span>{t('settings:update.readyDescription')}</span>
              ) : updateState.capability === 'installable' ? (
                <span>{t('settings:update.automaticDownload')}</span>
              ) : (
                <span>
                  {t(updateState.packageType === 'portable'
                    ? 'settings:update.portableDescription'
                    : updateState.packageType === 'mac'
                      ? 'settings:update.macUnsignedDescription'
                      : updateState.packageType === 'deb' || updateState.packageType === 'rpm'
                        ? 'settings:update.linuxPackageDescription'
                        : 'settings:update.manualDescription')}
                </span>
              )}
              {updateState.packageType === 'nsis' && (
                <span>{t('settings:update.unsignedWindowsWarning')}</span>
              )}
              {updateState.status === 'downloading' && updateState.progress?.percent !== null &&
                updateState.progress?.percent !== undefined && (
                  <span>
                    {t('settings:update.downloadProgress', {
                      percent: Math.round(updateState.progress.percent)
                    })}
                  </span>
                )}
            </DialogDescription>
          </DialogHeader>
          <section
            aria-label={t('settings:update.releaseNotes')}
            className="flex min-h-0 flex-1 flex-col"
          >
            <h3 className="mb-2 shrink-0 text-sm font-medium">{t('settings:update.releaseNotes')}</h3>
            <div className="min-h-0 flex-1 overflow-hidden rounded-md border bg-muted/40">
              {updateState.releaseNotes ? (
                <ReleaseNotesView markdown={updateState.releaseNotes} />
              ) : (
                <p className="h-full overflow-y-auto p-3 text-sm text-muted-foreground">
                  {t('settings:update.noReleaseNotes')}
                </p>
              )}
            </div>
          </section>
          <DialogFooter className="shrink-0">
            <Button variant="outline" onClick={() => setUpdateDialogOpen(false)}>
              {t('settings:update.later')}
            </Button>
            {updateState.capability === 'downloadOnly' && updateState.status === 'available' && (
              <Button onClick={() => void openUpdateRelease()}>
                {t('settings:update.viewRelease')}
              </Button>
            )}
            {updateState.capability === 'installable' && updateState.status === 'downloaded' && (
              <Button onClick={() => void installUpdate()}>
                {t('settings:update.restart')}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div
        className="app-shell__project-resizer app-shell__resize-handle relative z-10 cursor-col-resize bg-border transition-colors hover:bg-primary"
        role="separator"
        aria-label={t('common:aria.resizeProjectRail')}
        onPointerDown={(event) => startColumnResize('project', event)}
      />

      <TaskSidebar
        activeProject={activeProject}
        availableWorkflows={availableWorkflows}
        displayedTasks={displayedTasks}
        totalTaskCount={tasks.length}
        activeTaskId={activeTaskId}
        onSetDefaultWorkflow={setDefaultWorkflow}
        onStartNewTask={startNewTask}
        onLoadTask={loadTask}
        onRenameTask={renameTask}
        onDeleteTask={deleteTaskRecord}
        onShowMoreTasks={() => setVisibleTaskCount((current) => (
          Math.min(current + TASK_BATCH_SIZE, tasks.length)
        ))}
      />

      <div
        className="app-shell__task-resizer app-shell__resize-handle relative z-10 cursor-col-resize bg-border transition-colors hover:bg-primary"
        role="separator"
        aria-label={t('common:aria.resizeTaskSidebar')}
        onPointerDown={(event) => startColumnResize('tasks', event)}
      />

      <main
        className="workspace-shell grid min-h-0 min-w-0 max-w-full overflow-hidden bg-muted/20"
      >
        <div className="workspace-header flex min-w-0 items-center gap-3 border-b bg-background px-4">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="workspace-header__task-title min-w-0 max-w-[45%] truncate text-sm font-medium" title={workspaceTaskTitle}>
              {workspaceTaskTitle}
            </span>
            <span className="shrink-0 text-muted-foreground">/</span>
            {canSwitchWorkflow ? (
              <div className="workspace-header__workflow-select min-w-0 flex-1">
                <Select value={workflow.id} onValueChange={requestDraftWorkflowChange}>
                  <SelectTrigger
                    aria-label={t('workflow:select.aria')}
                    className="w-full min-w-0"
                    size="sm"
                    title={workflow.name}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="start">
                    {!currentWorkflowIsAvailable && (
                      <SelectItem
                        disabled
                        title={t('workflow:deletedSuffix', { name: workflow.name })}
                        value={workflow.id}
                      >
                        {t('workflow:deletedSuffix', { name: workflow.name })}
                      </SelectItem>
                    )}
                    {availableWorkflows.map((item) => (
                      <SelectItem key={item.id} title={item.name} value={item.id}>
                        {item.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground" title={workflow.name}>
                {workflow.name}
              </span>
            )}
            <span className="workspace-header__workflow-stats shrink-0 text-xs text-muted-foreground">
              {t('workflow:summary', { nodes: workflow.nodes.length, edges: workflow.edges.length })}
            </span>
          </div>
          {activeRuntimeStatus && (
            <StatusBadge
              className="shrink-0"
              status={activeRuntimeStatus}
            />
          )}
          {workflowAction === 'stop-workflow' && (
            <Button
              className="shrink-0"
              onClick={() => void stopWorkflow()}
              size="sm"
              variant="destructive"
            >
              <Square data-icon="inline-start" />
              {t('workflow:runtimeAction.stop')}
            </Button>
          )}
          <ToggleGroup
            aria-label={t('workflow:view.aria')}
            className="shrink-0"
            size="sm"
            spacing={0}
            type="single"
            value={viewMode}
            variant="outline"
            onValueChange={(value) => {
              if (!value) return
              if (value === 'graph') setTaskGraphFocusNodeId(null)
              setViewMode(value as 'focus' | 'graph')
            }}
          >
            <ToggleGroupItem aria-label={t('workflow:view.node')} title={t('workflow:view.node')} value="focus">
              <Focus data-icon="inline-start" />
              <span className="workspace-header__view-label">{t('workflow:view.nodeLabel')}</span>
            </ToggleGroupItem>
            <ToggleGroupItem aria-label={t('workflow:view.graph')} title={t('workflow:view.graph')} value="graph">
              <Network data-icon="inline-start" />
              <span className="workspace-header__view-label">{t('workflow:view.graphLabel')}</span>
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        <section className="flex min-h-0 min-w-0 max-w-full flex-col overflow-hidden bg-background">
          {validationErrors.length > 0 && (
            <div className="shrink-0 px-3 pt-3">
              <Alert variant="destructive">
                <TriangleAlert />
                <AlertTitle>{t('workflow:invalidConfigTitle')}</AlertTitle>
                <AlertDescription className="flex flex-col gap-1">
                  {validationErrors.map((error, index) => (
                    <span key={`${error.key}:${index}`}>{t(error.key, error.params)}</span>
                  ))}
                </AlertDescription>
              </Alert>
            </div>
          )}

          <div className="workspace-content min-h-0 min-w-0 max-w-full flex-1 overflow-hidden p-3">
            <TerminalScrollGroup className="h-full w-full min-h-0 min-w-0 max-w-full overflow-hidden">
              {viewMode === 'graph' ? (
                <section className="workflow-graph h-full w-full min-w-0 max-w-full overflow-hidden rounded-xl border bg-card shadow-xs">
                  <ReactFlowProvider>
                    <ReactFlow
                      nodes={taskFlowNodes}
                      edges={taskFlowEdges}
                      nodeTypes={designerNodeTypes}
                      edgeTypes={designerEdgeTypes}
                      fitView
                      fitViewOptions={taskGraphFitViewOptions}
                      nodesDraggable={false}
                      nodesConnectable={false}
                      elementsSelectable
                      panOnScroll={false}
                      zoomOnScroll
                      onNodeClick={(_event, node) => {
                        focusGraphNode(node.data.workflowNode)
                      }}
                      connectionMode={ConnectionMode.Loose}
                      defaultEdgeOptions={{ type: 'designerEdge' }}
                    >
                      <Background color="var(--border)" gap={24} />
                      <Controls position="bottom-left" showInteractive={false} />
                      <MiniMap className="workspace-minimap !rounded-lg !border !bg-card !shadow-sm" zoomable pannable />
                    </ReactFlow>
                  </ReactFlowProvider>
                </section>
              ) : focusedParallelBranchRuns.length > 0 ? (
                <ParallelBranchGroup
                  branches={focusedParallelBranchRuns}
                  gatewayNode={focusedParallelGateway}
                  workflowNodes={workflow.nodes}
                  nodeRuns={nodeRuns}
                  sessions={sessions.filter((session) => session.task_id === activeTaskId)}
                  onBranchVariableChange={setBranchVariable}
                  onBranchContinue={continueBranchWithVariables}
                  onRetryNode={(branchId, nodeId) => void retryNode(nodeId, branchId)}
                  onStopTerminal={stopTerminal}
                  onShowGraph={() => showGraphAtNode(selectedNodeId)}
                  onToggleZoomNode={(nodeId) => setParallelZoomNodeId((curr) => (curr === nodeId ? null : nodeId))}
                  zoomedNodeId={parallelZoomNodeId}
                  onLoadTerminalTranscript={loadTerminalTranscript}
                  onSendTerminalInput={sendTerminalInput}
                  onRetryTerminal={retryTerminal}
                />
              ) : selectedNode ? (
                <NodeDetailPanel
                  node={selectedNode}
                  run={nodeRuns[selectedNode.id]}
                  sessions={selectedNodeSessions}
                  variables={selectedNodeVariables}
                  editableVariables={getCurrentInputVariables(selectedNode)}
                  canOperate={selectedNodeCanOperate}
                  isWaitingForInput={selectedNodeIsWaitingForInput}
                  onVariableChange={selectedNodeBranch
                    ? (key, value) => setBranchVariable(selectedNodeBranch.branchId, key, value)
                    : setVariable}
                  onRun={selectedNodeBranch ? undefined : runWorkflowFromCurrentNode}
                  onRetryNode={() => void retryNode(selectedNode.id, selectedNodeBranch?.branchId)}
                  onContinue={selectedNodeBranch
                    ? () => continueBranchWithVariables(selectedNodeBranch.branchId)
                    : continueWorkflowWithVariables}
                  onStopTerminal={stopTerminal}
                  onShowGraph={returnFromNodeDetailZoom}
                  onLoadTerminalTranscript={loadTerminalTranscript}
                  onSendTerminalInput={sendTerminalInput}
                  onRetryTerminal={retryTerminal}
                  zoomTitle={getNodeDetailZoomTitle(nodeDetailZoomTarget)}
                />
              ) : (
                <Empty className="h-full border bg-card">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <Workflow />
                    </EmptyMedia>
                    <EmptyTitle>
                      {availableWorkflows.length === 0 ? t('workflow:empty.addFirst') : t('task:empty.selectOrCreate')}
                    </EmptyTitle>
                    <EmptyDescription>
                      {availableWorkflows.length === 0
                        ? t('workflow:empty.noWorkflowsDescription')
                        : t('task:empty.openOrCreateDescription')}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
            </TerminalScrollGroup>
          </div>
        </section>
      </main>

      <Dialog open={designerOpen} onOpenChange={(open) => !open && requestCloseDesigner()}>
        <DialogContent
          className="workflow-designer grid max-w-none gap-0 overflow-hidden p-0 sm:max-w-none"
          showCloseButton={false}
        >
          <DialogHeader className="workflow-designer__header min-h-14 border-b px-4 py-2">
            <div className="workflow-designer__heading min-w-0">
              <DialogTitle>{t('designer:title')}</DialogTitle>
              <DialogDescription className="truncate">
                {t('designer:description')}
              </DialogDescription>
            </div>
            <Textarea
              aria-label={t('designer:workflowName.aria')}
              className="workflow-designer__name"
              value={editingWorkflow?.name ?? ''}
              onChange={(event) => {
                setEditingWorkflow((current) => (current ? { ...current, name: event.target.value } : current))
                markDesignerDirty()
              }}
            />
            <div className="workflow-designer__actions">
              {designerDirty && <Badge variant="secondary">{t('common:status.unsaved')}</Badge>}
              <Button
                aria-label={t('designer:arrange.aria')}
                disabled={flowNodes.length < 2}
                title={t('designer:arrange.tooltip')}
                variant="outline"
                onClick={arrangeDesignerNodes}
              >
                <AlignHorizontalSpaceBetween data-icon="inline-start" />
                <span className="workflow-designer__action-label">{t('designer:arrange.label')}</span>
              </Button>
              <Button
                aria-label={t('designer:saveWorkflow')}
                disabled={designerValidationErrors.length > 0}
                title={t('designer:saveWorkflow')}
                onClick={saveDesigner}
              >
                <Save data-icon="inline-start" />
                <span className="workflow-designer__action-label">{t('designer:saveWorkflow')}</span>
              </Button>
              <Button aria-label={t('designer:close.aria')} size="icon" variant="ghost" onClick={requestCloseDesigner}>
                <X />
              </Button>
            </div>
          </DialogHeader>

          <aside className="workflow-designer__workflows flex min-h-0 flex-col border-r bg-sidebar text-sidebar-foreground">
            <div className="p-3">
              <Button className="w-full" size="sm" onClick={() => openDesigner()}>
                <Plus data-icon="inline-start" />
                {t('workflow:add')}
              </Button>
            </div>
            <Separator />
            <ScrollArea className="min-h-0 flex-1">
              <div className="flex flex-col gap-1 p-2">
                {availableWorkflows.map((item) => {
                  const isActive = editingWorkflow?.id === item.id
                  return (
                    <div
                      className={cn(
                        'group flex items-center rounded-lg border border-transparent',
                        isActive && 'border-border bg-muted'
                      )}
                      key={item.id}
                    >
                      <Button
                        className="h-auto min-w-0 flex-1 justify-start px-2 py-2 text-left"
                        variant="ghost"
                        onClick={() => openDesigner(item)}
                      >
                        <span className="min-w-0 flex-1 truncate">{item.name}</span>
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            aria-label={t('workflow:actions.aria', { name: item.name })}
                            className="mr-1"
                            size="icon-sm"
                            variant="ghost"
                          >
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuGroup>
                            <DropdownMenuItem
                              title={t('workflow:copy.tooltip')}
                              onSelect={() => void copyWorkflowDefinition(item)}
                            >
                              <Copy />
                              {t('common:action.copy')}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              title={t('workflow:delete.tooltip')}
                              variant="destructive"
                              onSelect={() => setWorkflowToDelete(item)}
                            >
                              <Trash2 />
                              {t('common:action.delete')}
                            </DropdownMenuItem>
                          </DropdownMenuGroup>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  )
                })}
              </div>
            </ScrollArea>
          </aside>

          <aside className="workflow-designer__palette min-h-0 border-r bg-muted/20">
            <ScrollArea className="h-full">
              <div className="flex flex-col gap-4 p-3">
                {DESIGNER_NODE_GROUPS.map((group) => (
                  <div className="flex flex-col gap-1.5" key={group.labelKey}>
                    <h3 className="px-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                      {t(group.labelKey)}
                    </h3>
                    {group.types.map((type) => (
                      <Button
                        className="h-auto justify-start px-2 py-2"
                        draggable
                        key={type}
                        variant="outline"
                        onDragStart={(event) => event.dataTransfer.setData('text/node-type', type)}
                      >
                        <span className="flex size-7 items-center justify-center rounded-md bg-muted">
                          <NodeIcon node={{ id: type, type, name: type, config: getDefaultNodeConfig(type) }} />
                        </span>
                        <span className="truncate">{t(getNodeTypeLabel(type))}</span>
                      </Button>
                    ))}
                  </div>
                ))}
              </div>
            </ScrollArea>
          </aside>

          <section
            className="workflow-designer__canvas relative min-h-0 overflow-hidden bg-muted/20"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => addDesignerNode(event)}
          >
            <ReactFlowProvider>
              <ReactFlow
                nodes={flowNodes}
                edges={flowEdges}
                nodeTypes={designerNodeTypes}
                edgeTypes={designerEdgeTypes}
                fitView
                fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
                onInit={setDesignerFlow}
                onNodesChange={applyDesignerNodeChanges}
                onEdgesChange={applyDesignerEdgeChanges}
                onNodesDelete={deleteDesignerNodes}
                onConnect={connectDesignerNodes}
                onSelectionChange={handleDesignerSelectionChange}
                connectionMode={ConnectionMode.Strict}
                connectionLineStyle={{ stroke: 'var(--primary)', strokeWidth: 2 }}
                defaultEdgeOptions={{ type: 'designerEdge' }}
                deleteKeyCode={['Backspace', 'Delete']}
                multiSelectionKeyCode={['Meta', 'Control']}
              >
                <Background color="var(--border)" gap={24} />
                <MiniMap className="!rounded-lg !border !bg-card !shadow-sm" zoomable pannable />
                <Controls position="bottom-left" />
              </ReactFlow>
            </ReactFlowProvider>
          </section>

          <aside className="workflow-designer__inspector min-h-0 min-w-0 overflow-hidden border-l bg-background">
            <ScrollArea className="h-full">
              {designerValidationErrors.length > 0 && (
                <div className="p-3 pb-0">
                  <Alert variant="destructive">
                    <TriangleAlert />
                    <AlertTitle>{t('workflow:saveFailedTitle')}</AlertTitle>
                    <AlertDescription className="flex flex-col gap-1">
                      {designerValidationErrors.map((error, index) => (
                        <span key={`${error.key}:${index}`}>{t(error.key, error.params)}</span>
                      ))}
                    </AlertDescription>
                  </Alert>
                </div>
              )}
              <DesignerInspector
                selection={designerSelection}
                nodes={flowNodes.map((node) => ({ ...node.data.workflowNode, x: node.position.x, y: node.position.y }))}
                edges={flowEdges.map((edge) => edge.data!.workflowEdge)}
                onUpdateNode={updateDesignerNode}
                onUpdateEdge={updateDesignerEdge}
                onDeleteSelection={deleteDesignerSelection}
              />
            </ScrollArea>
          </aside>
        </DialogContent>
      </Dialog>

      <AlertDialog open={designerCloseConfirmationOpen} onOpenChange={setDesignerCloseConfirmationOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia>
              <TriangleAlert />
            </AlertDialogMedia>
            <AlertDialogTitle>{t('designer:discardConfirm.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('designer:discardConfirm.description')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('designer:discardConfirm.keepEditing')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setDesignerDirty(false)
                setDesignerCloseConfirmationOpen(false)
                setDesignerOpen(false)
              }}
            >
              {t('designer:discardConfirm.discard')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={Boolean(pendingWorkflowId)}
        onOpenChange={(open) => !open && updatePendingWorkflowId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia>
              <TriangleAlert />
            </AlertDialogMedia>
            <AlertDialogTitle>{t('workflow:switchConfirm.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('workflow:switchConfirm.description')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isConfirmingWorkflowChange}>{t('common:action.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={isConfirmingWorkflowChange}
              onClick={(event) => {
                event.preventDefault()
                void confirmDraftWorkflowChange()
              }}
            >
              {t('workflow:switchConfirm.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(workflowToDelete)} onOpenChange={(open) => !open && setWorkflowToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia>
              <Trash2 />
            </AlertDialogMedia>
            <AlertDialogTitle>{t('workflow:delete.confirm', { name: workflowToDelete?.name ?? '' })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('workflow:delete.description')}
              {t('workflow:delete.defaultProjectsNote')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common:action.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (!workflowToDelete) return
                void deleteWorkflowDefinition(workflowToDelete)
                  .then(() => setWorkflowToDelete(null))
                  .catch(() => {})
              }}
            >
              {t('workflow:delete.confirmButton')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )

  function setVariable(key: string, value: VariableValue) {
    const nextVariables = { ...variablesRef.current, [key]: value }
    variablesRef.current = nextVariables
    setVariables(nextVariables)
    updateDraftStarted(true)
    if (isNewTaskDraftRef.current && activeProjectIdRef.current) {
      scheduleDraftSnapshot(activeProjectIdRef.current, workflowRef.current, nextVariables)
    }
  }

  function setBranchVariable(branchId: string, key: string, value: VariableValue) {
    setBranchRuns((current) => {
      const branch = current[branchId]
      if (!branch) return current
      return {
        ...current,
        [branchId]: {
          ...branch,
          variables: { ...branch.variables, [key]: value }
        }
      }
    })
  }

  function sendTerminalInput(sessionId: string, input: string) {
    window.cliLoom?.writeProcess(sessionId, input)
  }

  async function loadTask(task: TaskRecord): Promise<void> {
    const navigationRequestId = draftLoadRequestRef.current + 1
    draftLoadRequestRef.current = navigationRequestId
    pendingDraftLoadRef.current = null
    await flushActiveDraft()
    if (
      draftLoadRequestRef.current !== navigationRequestId ||
      activeProjectIdRef.current !== task.project_id
    ) return

    const requestId = taskLoadRequestRef.current + 1
    taskLoadRequestRef.current = requestId
    setActiveTaskId(task.id)
    activeTaskIdRef.current = task.id
    activeTaskPersistedRef.current = true
    rememberWorkspace(task.project_id, task.id)
    manualFocusRef.current = false
    updateDraftStarted(false)
    updateNewTaskDraft(false)
    updatePendingWorkflowId(null)
    setWorkflowCompleted(task.status === 'completed')
    updateRuntimeState(null)
    setFocusedParallelSplitNodeId(null)
    setNodeDetailZoomTarget(null)
    setParallelZoomNodeId(null)

    const isCurrentTaskLoad = () => (
      taskLoadRequestRef.current === requestId && activeTaskIdRef.current === task.id
    )

    const applyTaskContextFallback = async () => {
      try {
        const contextJson = await window.cliLoom?.getTaskContext(task.id)
        if (!isCurrentTaskLoad()) return
        const context = JSON.parse(contextJson ?? '{}') as {
          variables?: Record<string, VariableValue>
          nodeRuns?: Record<string, NodeRun>
          branchRuns?: Record<string, WorkflowRuntimeBranchRun>
          workflowId?: string
          executionOrder?: string[]
        }
        const restoredVariables = context.variables ?? {}
        variablesRef.current = restoredVariables
        setVariables(restoredVariables)
        const restoredRuns = context.nodeRuns ?? {}
        setNodeRuns(restoredRuns)
        setBranchRuns(context.branchRuns ?? {})
        setExecutionOrder(context.executionOrder ?? Object.keys(restoredRuns))
        const nextWorkflow = availableWorkflows.find((item) => item.id === context.workflowId) ?? workflow
        updateWorkspaceWorkflow(nextWorkflow)
        setSelectedNodeId(context.executionOrder?.at(-1) ?? nextWorkflow.nodes[0]?.id ?? '')
        setFocusedParallelSplitNodeId(null)
        setNodeDetailZoomTarget(null)
        setViewMode('focus')
      } catch {
        if (!isCurrentTaskLoad()) return
        variablesRef.current = {}
        setVariables({})
        setNodeRuns({})
        setBranchRuns({})
        setExecutionOrder([])
      }
    }

    window.cliLoom?.restoreWorkflowState(task.id).then(async (restored) => {
      if (!isCurrentTaskLoad()) return
      const payload = restored as {
        state?: WorkflowRuntimeState | null
        workflow?: WorkflowDefinition | null
        workflowVersion?: number | null
        terminalSessions?: TerminalSession[]
      } | null | undefined
      if (payload?.state) {
        const nextWorkflow = payload.workflow
          ?? availableWorkflows.find((item) => item.id === payload.state?.workflowId)
          ?? workflow
        updateWorkspaceWorkflow(nextWorkflow)
        applyRuntimeState(payload.state, { moveTaskToFront: false })
        setViewMode('focus')
      } else {
        await applyTaskContextFallback()
      }
      if (!isCurrentTaskLoad()) return
      setSessions(payload?.terminalSessions ?? [])
    }).catch((error: unknown) => {
      if (!isCurrentTaskLoad()) return
      handleError(error, 'restoreWorkflowState')
      void applyTaskContextFallback()
      setSessions([])
      window.cliLoom?.listTaskSessions(task.id).then((records) => {
        if (!isCurrentTaskLoad()) return
        setSessions(records as TerminalSession[])
      }).catch((listError: unknown) => handleError(listError, 'listTaskSessions'))
    })

    if (!window.cliLoom?.restoreWorkflowState) {
      void applyTaskContextFallback()
      setSessions([])
      window.cliLoom?.listTaskSessions(task.id).then((records) => {
        if (!isCurrentTaskLoad()) return
        setSessions(records as TerminalSession[])
      }).catch((error: unknown) => handleError(error, 'listTaskSessions'))
    }
  }

  function markDesignerDirty() {
    designerEditVersionRef.current += 1
    setDesignerDirty(true)
  }

  function arrangeDesignerNodes() {
    setFlowNodes((current) => arrangeWorkflowNodesLeftToRight(current, flowEdges, {
      firstNodeIds: current
        .filter((node) => node.data.workflowNode.type === 'start')
        .map((node) => node.id)
    }))
    markDesignerDirty()
    window.requestAnimationFrame(() => {
      void designerFlow?.fitView({ padding: 0.15, maxZoom: 1, duration: 300 })
    })
  }

  function addDesignerNode(event: DragEvent<HTMLElement>) {
    const type = event.dataTransfer.getData('text/node-type') as WorkflowNode['type']
    if (!type) return
    const id = `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const position = designerFlow?.screenToFlowPosition({ x: event.clientX, y: event.clientY }) ?? { x: 120, y: 120 }
    
    setFlowNodes((current) => [
      ...current,
      {
        id,
        type: 'workflowNode',
        position,
        data: { 
          workflowNode: {
            id,
            type,
            name: t(getNodeTypeLabel(type)),
            config: getDefaultNodeConfig(type)
          } 
        }
      }
    ])
    setDesignerSelection({ kind: 'node', id })
    markDesignerDirty()
  }

  function applyDesignerNodeChanges(changes: NodeChange<FlowNode>[]) {
    const removedNodeIds = changes.filter((change) => change.type === 'remove').map((change) => change.id)
    if (removedNodeIds.length > 0) {
      const removed = new Set(removedNodeIds)
      const removedEdgeIds = new Set(
        flowEdges.filter((edge) => removed.has(edge.source) || removed.has(edge.target)).map((edge) => edge.id)
      )
      setDesignerSelection((current) => (current?.kind === 'node' && removed.has(current.id) ? null : current))
      setFlowEdges((current) => current.filter((edge) => !removed.has(edge.source) && !removed.has(edge.target)))
      removeStaleJoinEdgeRefs(removedEdgeIds)
      markDesignerDirty()
    }

    const positionChanges = changes.filter(
      (change): change is NodePositionChange => change.type === 'position' && Boolean(change.position)
    )
    const draggedNodeIds = new Set(positionChanges.map((change) => change.id))
    const shouldSnapHorizontally = draggedNodeIds.size === 1
    const zoom = designerFlow?.getZoom() ?? 1
    const snapThreshold = HORIZONTAL_ALIGNMENT_SNAP_DISTANCE / Math.max(zoom, 0.1)

    setFlowNodes((nodes) => {
      const snappedChanges = shouldSnapHorizontally
        ? changes.map((change) => {
          if (change.type !== 'position' || !change.position) return change

          return {
            ...change,
            position: snapNodePositionHorizontally({
              nodeId: change.id,
              position: change.position,
              nodes,
              edges: flowEdges,
              threshold: snapThreshold
            })
          }
        })
        : changes

      return applyNodeChanges(snappedChanges, nodes)
    })

    if (positionChanges.length > 0) markDesignerDirty()
  }

  function applyDesignerEdgeChanges(changes: EdgeChange<FlowEdge>[]) {
    const removedEdgeIds = changes.filter((change) => change.type === 'remove').map((change) => change.id)
    if (removedEdgeIds.length > 0) {
      setDesignerSelection((current) => (current?.kind === 'edge' && removedEdgeIds.includes(current.id) ? null : current))
      removeStaleJoinEdgeRefs(new Set(removedEdgeIds))
      markDesignerDirty()
    }
    setFlowEdges((eds) => applyEdgeChanges(changes, eds))
  }

  function connectDesignerNodes(connection: Connection) {
    if (!connection.source || !connection.target || connection.source === connection.target) return
    const edge: WorkflowDefinition['edges'][number] = {
      id: `e-${connection.source}-${connection.target}-${Date.now()}`,
      from: connection.source,
      to: connection.target
    }
    const newEdge: FlowEdge = {
      id: edge.id,
      source: edge.from,
      target: edge.to,
      type: 'designerEdge',
      animated: false,
      markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--muted-foreground)', width: 16, height: 16 },
      data: { workflowEdge: edge, onDelete: deleteDesignerEdgeById }
    }
    setFlowEdges((eds) => addEdge(newEdge, eds))
    setDesignerSelection({ kind: 'edge', id: edge.id })
    markDesignerDirty()
  }

  function removeStaleJoinEdgeRefs(removedEdgeIds: ReadonlySet<string>) {
    if (removedEdgeIds.size === 0) return
    setFlowNodes((current) => {
      const workflowNodes = current.map((node) => node.data.workflowNode)
      const pruned = pruneJoinIncomingEdgeIds(workflowNodes, removedEdgeIds)
      if (pruned === workflowNodes) return current
      return current.map((node, index) =>
        pruned[index] === workflowNodes[index]
          ? node
          : { ...node, data: { ...node.data, workflowNode: pruned[index] } }
      )
    })
  }

  function deleteDesignerNodes(nodesToDelete: FlowNode[]) {
    const nodeIds = new Set(nodesToDelete.map((node) => node.id))
    const removedEdgeIds = new Set(
      flowEdges.filter((edge) => nodeIds.has(edge.source) || nodeIds.has(edge.target)).map((edge) => edge.id)
    )
    setFlowEdges((current) => current.filter((edge) => !nodeIds.has(edge.source) && !nodeIds.has(edge.target)))
    removeStaleJoinEdgeRefs(removedEdgeIds)
    setDesignerSelection((current) => (current?.kind === 'node' && nodeIds.has(current.id) ? null : current))
    markDesignerDirty()
  }

  function updateDesignerNode(nodeId: string, patch: Partial<WorkflowNode>) {
    setFlowNodes((current) =>
      current.map((node) =>
        node.id === nodeId
          ? { ...node, data: { ...node.data, workflowNode: { ...node.data.workflowNode, ...patch } } }
          : node
      )
    )
    markDesignerDirty()
  }

  function updateDesignerEdge(edgeId: string, patch: Partial<WorkflowDefinition['edges'][number]>) {
    setFlowEdges((current) =>
      current.map((edge) => {
        if (edge.id !== edgeId) return edge
        const nextEdge = { ...edge.data!.workflowEdge, ...patch }
        return {
          ...edge,
          animated: nextEdge.isDefault,
          label: nextEdge.condition,
          style: nextEdge.condition && !nextEdge.isDefault ? { strokeDasharray: '5 3' } : {},
          data: { ...edge.data, workflowEdge: nextEdge }
        }
      })
    )
    markDesignerDirty()
  }

  function deleteDesignerEdgeById(edgeId: string) {
    setFlowEdges((current) => current.filter((edge) => edge.id !== edgeId))
    removeStaleJoinEdgeRefs(new Set([edgeId]))
    setDesignerSelection((current) => (current?.kind === 'edge' && current.id === edgeId ? null : current))
    markDesignerDirty()
  }

  function deleteDesignerSelection() {
    if (!designerSelection) return
    if (designerSelection.kind === 'node') {
      const nodeId = designerSelection.id
      const removedEdgeIds = new Set(
        flowEdges.filter((edge) => edge.source === nodeId || edge.target === nodeId).map((edge) => edge.id)
      )
      setFlowNodes((current) => current.filter((node) => node.id !== nodeId))
      setFlowEdges((current) => current.filter((edge) => edge.source !== nodeId && edge.target !== nodeId))
      removeStaleJoinEdgeRefs(removedEdgeIds)
    } else {
      const edgeId = designerSelection.id
      setFlowEdges((current) => current.filter((edge) => edge.id !== edgeId))
      removeStaleJoinEdgeRefs(new Set([edgeId]))
    }
    setDesignerSelection(null)
    markDesignerDirty()
  }
}

const designerNodeTypes = {
  workflowNode: DesignerFlowNode
}
const designerEdgeTypes = {
  designerEdge: DesignerFlowEdge
}
