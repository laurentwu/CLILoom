// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { i18n } from '../i18n'

vi.mock('@/components/ui/dropdown-menu', async () => {
  const React = await import('react')
  const Passthrough = ({ children }: { children?: React.ReactNode }) => React.createElement(
    React.Fragment,
    null,
    children
  )
  return {
    DropdownMenu: Passthrough,
    DropdownMenuContent: Passthrough,
    DropdownMenuGroup: Passthrough,
    DropdownMenuItem: ({
      children,
      onSelect
    }: {
      children?: React.ReactNode
      onSelect?: (event: { preventDefault: () => void }) => void
    }) => React.createElement('button', {
      onClick: () => onSelect?.({ preventDefault: () => undefined }),
      type: 'button'
    }, children),
    DropdownMenuLabel: Passthrough,
    DropdownMenuRadioGroup: Passthrough,
    DropdownMenuRadioItem: Passthrough,
    DropdownMenuSeparator: Passthrough,
    DropdownMenuSub: Passthrough,
    DropdownMenuSubContent: Passthrough,
    DropdownMenuSubTrigger: Passthrough,
    DropdownMenuTrigger: Passthrough
  }
})

vi.mock('@/components/ui/dialog', async () => {
  const React = await import('react')
  const Passthrough = ({ children }: { children?: React.ReactNode }) => React.createElement(
    React.Fragment,
    null,
    children
  )
  return {
    Dialog: ({ children, open }: { children?: React.ReactNode; open?: boolean }) => open
      ? React.createElement(React.Fragment, null, children)
      : null,
    DialogContent: ({ children }: { children?: React.ReactNode }) => React.createElement(
      'div',
      { role: 'dialog' },
      children
    ),
    DialogDescription: Passthrough,
    DialogFooter: Passthrough,
    DialogHeader: Passthrough,
    DialogTitle: Passthrough
  }
})

vi.mock('@/components/ui/alert-dialog', () => ({
  AlertDialog: () => null,
  AlertDialogAction: () => null,
  AlertDialogCancel: () => null,
  AlertDialogContent: () => null,
  AlertDialogDescription: () => null,
  AlertDialogFooter: () => null,
  AlertDialogHeader: () => null,
  AlertDialogMedia: () => null,
  AlertDialogTitle: () => null
}))

vi.mock('@/components/ui/scroll-area', async () => {
  const React = await import('react')
  return {
    ScrollArea: ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children)
  }
})

import { formatTaskStartedAt, TaskSidebar } from './TaskSidebar'

afterEach(() => {
  cleanup()
})

describe('TaskSidebar', () => {
  it('shows the system-localized task start time to the right of its status', () => {
    i18n.changeLanguage('en')
    const createdAt = '2026-08-10T19:30:00.000Z'
    const expected = new Intl.DateTimeFormat(undefined, {
      dateStyle: 'short',
      timeStyle: 'short'
    }).format(new Date(createdAt))

    render(
      <I18nextProvider i18n={i18n}>
        <TaskSidebar
          activeProject={null}
          activeTaskId="task-1"
          availableWorkflows={[]}
          displayedTasks={[{
            id: 'task-1',
            project_id: 'project-1',
            title: 'Task title',
            status: 'completed',
            created_at: createdAt,
            updated_at: createdAt
          }]}
          showAllTasks={false}
          totalTaskCount={1}
          onDeleteTask={vi.fn()}
          onLoadTask={vi.fn()}
          onRenameTask={vi.fn()}
          onSetDefaultWorkflow={vi.fn()}
          onShowAllTasks={vi.fn()}
          onStartNewTask={vi.fn()}
        />
      </I18nextProvider>
    )

    const status = screen.getByText('Completed')
    const startedAt = document.querySelector('time')
    expect(startedAt?.textContent).toBe(expected)
    expect(startedAt?.getAttribute('datetime')).toBe(createdAt)
    expect(startedAt?.className).toContain('text-xs')
    expect(startedAt?.className).toContain('text-muted-foreground')
    expect(startedAt?.className).toContain('min-w-0')
    expect(startedAt?.className).toContain('flex-1')
    expect(startedAt?.className).toContain('truncate')
    expect(startedAt?.className).toContain('text-right')
    expect(startedAt?.parentElement?.className).toContain('min-w-0')
    expect(status.parentElement).toBe(startedAt?.parentElement)
  })

  it('trims before applying the twenty-character rename limit', async () => {
    i18n.changeLanguage('en')
    const createdAt = '2026-08-10T19:30:00.000Z'
    const task = {
      id: 'task-1',
      project_id: 'project-1',
      title: 'Task title',
      status: 'completed',
      created_at: createdAt,
      updated_at: createdAt
    }
    const onRenameTask = vi.fn().mockResolvedValue(undefined)

    render(
      <I18nextProvider i18n={i18n}>
        <TaskSidebar
          activeProject={null}
          activeTaskId={task.id}
          availableWorkflows={[]}
          displayedTasks={[task]}
          showAllTasks={false}
          totalTaskCount={1}
          onDeleteTask={vi.fn()}
          onLoadTask={vi.fn()}
          onRenameTask={onRenameTask}
          onSetDefaultWorkflow={vi.fn()}
          onShowAllTasks={vi.fn()}
          onStartNewTask={vi.fn()}
        />
      </I18nextProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    const input = screen.getByLabelText('Task name') as HTMLTextAreaElement
    const twentyCharacters = '12345678901234567890'
    const enteredValue = `  ${twentyCharacters}extra`
    fireEvent.change(input, { target: { value: enteredValue } })
    expect(input.value).toBe(enteredValue)

    fireEvent.click(screen.getByRole('button', { name: 'Save name' }))
    await waitFor(() => expect(onRenameTask).toHaveBeenCalledWith(task, twentyCharacters))
  })

  it('does not render an invalid start time', () => {
    expect(formatTaskStartedAt('not-a-date')).toBe('')
  })
})
