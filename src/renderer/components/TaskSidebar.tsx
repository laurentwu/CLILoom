import { useEffect, useState } from 'react'
import { MoreHorizontal, Pencil, Plus, Trash2, Workflow } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { WorkflowDefinition } from '../../shared/workflow'
import { normalizeTaskTitle } from '../../shared/taskTitle'
import type { ProjectRecord, TaskRecord } from '../appTypes'
import { StatusBadge } from './StatusBadge'
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
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

type TaskSidebarProps = {
  activeProject: ProjectRecord | null
  availableWorkflows: WorkflowDefinition[]
  displayedTasks: TaskRecord[]
  totalTaskCount: number
  activeTaskId: string
  showAllTasks: boolean
  onSetDefaultWorkflow: (workflowId: string) => void
  onStartNewTask: () => void
  onLoadTask: (task: TaskRecord) => void
  onRenameTask: (task: TaskRecord, title: string) => Promise<void>
  onDeleteTask: (task: TaskRecord) => Promise<void>
  onShowAllTasks: () => void
}

export function formatTaskStartedAt(createdAt: string): string {
  const date = new Date(createdAt)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(date)
}

export function TaskSidebar({
  activeProject,
  availableWorkflows,
  displayedTasks,
  totalTaskCount,
  activeTaskId,
  showAllTasks,
  onSetDefaultWorkflow,
  onStartNewTask,
  onLoadTask,
  onRenameTask,
  onDeleteTask,
  onShowAllTasks
}: TaskSidebarProps) {
  const { t } = useTranslation()
  const [renameTask, setRenameTask] = useState<TaskRecord | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [taskToDelete, setTaskToDelete] = useState<TaskRecord | null>(null)
  const normalizedRenameValue = normalizeTaskTitle(renameValue)

  useEffect(() => {
    setRenameValue(renameTask?.title ?? '')
  }, [renameTask])

  const defaultWorkflowId = activeProject?.default_workflow_id ?? availableWorkflows[0]?.id ?? ''

  return (
    <>
      <aside className="task-sidebar flex min-h-0 flex-col border-r bg-sidebar text-sidebar-foreground">
        <div className="flex h-12 shrink-0 items-center gap-2 px-3">
          <div className="min-w-0 flex-1">
            <div className="truncate font-heading text-sm font-medium">{activeProject?.name ?? t('project:noSelection')}</div>
            <div className="truncate text-xs text-muted-foreground">{activeProject?.path ?? t('project:addFolderPrompt')}</div>
          </div>

          {activeProject && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button aria-label={t('project:settings.aria')} size="icon-sm" variant="ghost">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel title={activeProject.name}>{activeProject.name}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Workflow />
                    <span className="min-w-0 flex-1 truncate">{t('task:defaultWorkflow')}</span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {availableWorkflows.length > 0 ? (
                      <DropdownMenuRadioGroup value={defaultWorkflowId} onValueChange={onSetDefaultWorkflow}>
                        {availableWorkflows.map((workflow) => (
                          <DropdownMenuRadioItem key={workflow.id} value={workflow.id}>
                            <span className="min-w-0 flex-1 truncate" title={workflow.name}>{workflow.name}</span>
                          </DropdownMenuRadioItem>
                        ))}
                      </DropdownMenuRadioGroup>
                    ) : (
                      <DropdownMenuItem disabled>{t('task:noWorkflows')}</DropdownMenuItem>
                    )}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        <Separator />

        <div className="p-3">
          <Button
            className="w-full"
            disabled={!activeProject || availableWorkflows.length === 0}
            title={availableWorkflows.length === 0 ? t('workflow:empty.addFirst') : undefined}
            onClick={onStartNewTask}
          >
            <Plus data-icon="inline-start" />
            {t('task:new')}
          </Button>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-1 px-2 pb-3">
            {displayedTasks.map((task) => {
              const isActive = task.id === activeTaskId
              const startedAt = formatTaskStartedAt(task.created_at)
              return (
                <div
                  className={cn(
                    'group flex items-center rounded-lg border border-transparent',
                    isActive && 'border-border bg-muted'
                  )}
                  key={task.id}
                >
                  <Button
                    className="h-auto min-w-0 flex-1 justify-start px-2 py-2"
                    variant="ghost"
                    onClick={() => onLoadTask(task)}
                  >
                    <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
                      <span className="w-full truncate text-left">{task.title}</span>
                      <div className="flex w-full min-w-0 items-center gap-2">
                        <StatusBadge status={task.status} />
                        {startedAt && (
                          <time
                            className="min-w-0 flex-1 truncate text-right text-xs text-muted-foreground tabular-nums"
                            dateTime={task.created_at}
                            title={startedAt}
                          >
                            {startedAt}
                          </time>
                        )}
                      </div>
                    </div>
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        aria-label={t('task:actionsAria', { name: task.title })}
                        className="mr-1"
                        size="icon-sm"
                        variant="ghost"
                      >
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuGroup>
                        <DropdownMenuItem onSelect={() => setRenameTask(task)}>
                          <Pencil />
                          {t('task:action.rename')}
                        </DropdownMenuItem>
                        <DropdownMenuItem variant="destructive" onSelect={() => setTaskToDelete(task)}>
                          <Trash2 />
                          {t('common:action.delete')}
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )
            })}

            {totalTaskCount > 5 && !showAllTasks && (
              <Button variant="ghost" onClick={onShowAllTasks}>
                {t('task:viewAll', { count: totalTaskCount })}
              </Button>
            )}

            {displayedTasks.length === 0 && (
              <div className="px-3 py-8 text-center text-sm text-muted-foreground">{t('task:empty.noTasks')}</div>
            )}
          </div>
        </ScrollArea>
      </aside>

      <Dialog open={Boolean(renameTask)} onOpenChange={(open) => !open && setRenameTask(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('task:rename.title')}</DialogTitle>
            <DialogDescription>{t('task:rename.description')}</DialogDescription>
          </DialogHeader>
          <Textarea
            autoFocus
            aria-label={t('task:rename.nameAria')}
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key !== 'Enter'
                || (!event.ctrlKey && !event.metaKey)
                || !renameTask
                || !normalizedRenameValue
              ) return
              event.preventDefault()
              void onRenameTask(renameTask, normalizedRenameValue)
                .then(() => setRenameTask(null))
                .catch(() => {})
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTask(null)}>
              {t('common:action.cancel')}
            </Button>
            <Button
              disabled={!normalizedRenameValue}
              onClick={() => {
                if (!renameTask || !normalizedRenameValue) return
                void onRenameTask(renameTask, normalizedRenameValue)
                  .then(() => setRenameTask(null))
                  .catch(() => {})
              }}
            >
              {t('task:rename.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(taskToDelete)} onOpenChange={(open) => !open && setTaskToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia>
              <Trash2 />
            </AlertDialogMedia>
            <AlertDialogTitle>{t('task:delete.title', { name: taskToDelete?.title ?? '' })}</AlertDialogTitle>
            <AlertDialogDescription>{t('task:delete.description')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common:action.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (!taskToDelete) return
                void onDeleteTask(taskToDelete)
                  .then(() => setTaskToDelete(null))
                  .catch(() => {})
              }}
            >
              {t('task:delete.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
