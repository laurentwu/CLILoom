// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { i18n } from '../i18n'
import { defaultSkinContent, type UserSkin } from '../../shared/skin'

vi.mock('@/components/ui/tooltip', async () => {
  const React = await import('react')
  const Passthrough = ({ children }: { children?: React.ReactNode }) => React.createElement(
    React.Fragment,
    null,
    children
  )
  return {
    Tooltip: Passthrough,
    TooltipContent: Passthrough,
    TooltipTrigger: Passthrough
  }
})

vi.mock('@/components/ui/dropdown-menu', async () => {
  const React = await import('react')
  const RadioContext = React.createContext<((value: string) => void) | undefined>(undefined)
  const Container = ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children)
  return {
    DropdownMenu: Container,
    DropdownMenuContent: Container,
    DropdownMenuGroup: Container,
    DropdownMenuLabel: Container,
    DropdownMenuSeparator: () => React.createElement('hr'),
    DropdownMenuSub: Container,
    DropdownMenuSubContent: Container,
    DropdownMenuSubTrigger: Container,
    DropdownMenuTrigger: Container,
    DropdownMenuRadioGroup: ({
      children,
      onValueChange
    }: {
      children?: React.ReactNode
      onValueChange?: (value: string) => void
    }) => React.createElement(
      RadioContext.Provider,
      { value: onValueChange },
      children
    ),
    DropdownMenuRadioItem: ({
      children,
      disabled,
      value
    }: {
      children?: React.ReactNode
      disabled?: boolean
      value: string
    }) => {
      const onValueChange = React.useContext(RadioContext)
      return React.createElement('button', {
        disabled,
        onClick: () => onValueChange?.(value),
        type: 'button'
      }, children)
    },
    DropdownMenuItem: ({
      children,
      disabled,
      onSelect
    }: {
      children?: React.ReactNode
      disabled?: boolean
      onSelect?: (event: { preventDefault: () => void }) => void
    }) => React.createElement('button', {
      disabled,
      onClick: () => onSelect?.({ preventDefault: () => undefined }),
      type: 'button'
    }, children)
  }
})

vi.mock('@/components/ui/alert-dialog', async () => {
  const React = await import('react')
  const Container = ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children)
  return {
    AlertDialog: ({ children, open }: { children?: React.ReactNode; open?: boolean }) => open
      ? React.createElement('div', null, children)
      : null,
    AlertDialogAction: Container,
    AlertDialogCancel: Container,
    AlertDialogContent: Container,
    AlertDialogDescription: Container,
    AlertDialogFooter: Container,
    AlertDialogHeader: Container,
    AlertDialogMedia: Container,
    AlertDialogTitle: Container
  }
})

import { ProjectRail } from './ProjectRail'

afterEach(() => {
  cleanup()
})

describe('ProjectRail project actions', () => {
  it('moves rename and delete into an ordered project context menu', async () => {
    i18n.changeLanguage('zh')
    const project = {
      id: 'project-1',
      name: 'Demo',
      path: '/repo/demo',
      sort_order: 0,
      created_at: '2026-08-11T00:00:00.000Z'
    }
    const onRenameProject = vi.fn().mockResolvedValue(undefined)
    const onSelectProject = vi.fn()
    render(<I18nextProvider i18n={i18n}>
      <ProjectRail
        activeProjectId="project-1"
        activeSkinId="builtin.light.neutral"
        language="zh"
        projects={[
          project,
          {
            id: 'project-2',
            name: 'Other',
            path: '/repo/other',
            sort_order: 1,
            created_at: '2026-08-11T00:00:00.000Z'
          }
        ]}
        shellSnapshot={{
          platform: 'linux',
          preferences: { version: 3, selection: { mode: 'automatic' } },
          candidates: [],
          effectiveShell: null,
          error: undefined
        }}
        onAddProject={() => undefined}
        onLanguageChange={() => undefined}
        onOpenAppearance={() => undefined}
        onDeleteProject={async () => undefined}
        onOpenAssistant={() => undefined}
        onOpenDesigner={() => undefined}
        onRefreshShells={async () => undefined}
        onRenameProject={onRenameProject}
        onReorderProject={() => undefined}
        onSelectProject={onSelectProject}
        onShellChange={async () => undefined}
        onSkinChange={() => undefined}
        userSkins={[]}
      />
    </I18nextProvider>)

    const projectButton = screen.getByRole('button', { name: '打开项目 Demo' })
    const projectButtonClasses = projectButton.className.split(/\s+/)
    expect(projectButton.getAttribute('title')).toBeNull()
    expect(screen.getByText('/repo/demo')).toBeTruthy()
    expect(projectButtonClasses).not.toContain('ring-2')
    expect(projectButtonClasses).not.toContain('ring-primary/20')
    expect(projectButton.getAttribute('data-variant')).toBe('default')
    expect(screen.getByRole('button', { name: '打开项目 Other' }).getAttribute('data-variant')).toBe('ghost')
    expect(screen.queryByRole('button', { name: '删除项目 Demo' })).toBeNull()

    fireEvent.contextMenu(projectButton, { clientX: 20, clientY: 20 })
    const menuItems = await screen.findAllByRole('menuitem')
    expect(menuItems.map((item) => item.textContent)).toEqual(['重命名', '删除'])
    expect(menuItems[1].getAttribute('data-variant')).toBe('destructive')
    expect(onSelectProject).not.toHaveBeenCalled()

    fireEvent.click(menuItems[0])
    const nameInput = await screen.findByLabelText('项目名称') as HTMLInputElement
    expect(nameInput.value).toBe('Demo')
    fireEvent.change(nameInput, { target: { value: '  Renamed project  ' } })
    fireEvent.click(screen.getByRole('button', { name: '保存名称' }))
    await waitFor(() => expect(onRenameProject).toHaveBeenCalledWith(project, 'Renamed project'))

    fireEvent.contextMenu(projectButton, { clientX: 20, clientY: 20 })
    fireEvent.click(await screen.findByRole('menuitem', { name: '删除' }))
    expect(screen.getByText('删除项目“Demo”？')).toBeTruthy()
  })

  it('disables blank names and submits a valid rename with Enter', async () => {
    i18n.changeLanguage('zh')
    const project = {
      id: 'project-1',
      name: 'Demo',
      path: '/repo/demo',
      sort_order: 0,
      created_at: '2026-08-11T00:00:00.000Z'
    }
    const onRenameProject = vi.fn().mockResolvedValue(undefined)
    render(<I18nextProvider i18n={i18n}>
      <ProjectRail
        activeProjectId="project-1"
        activeSkinId="builtin.light.neutral"
        language="zh"
        projects={[project]}
        shellSnapshot={{
          platform: 'linux',
          preferences: { version: 3, selection: { mode: 'automatic' } },
          candidates: [],
          effectiveShell: null,
          error: undefined
        }}
        onAddProject={() => undefined}
        onLanguageChange={() => undefined}
        onOpenAppearance={() => undefined}
        onDeleteProject={async () => undefined}
        onOpenAssistant={() => undefined}
        onOpenDesigner={() => undefined}
        onRefreshShells={async () => undefined}
        onRenameProject={onRenameProject}
        onReorderProject={() => undefined}
        onSelectProject={() => undefined}
        onShellChange={async () => undefined}
        onSkinChange={() => undefined}
        userSkins={[]}
      />
    </I18nextProvider>)

    fireEvent.contextMenu(screen.getByRole('button', { name: '打开项目 Demo' }), { clientX: 20, clientY: 20 })
    fireEvent.click(await screen.findByRole('menuitem', { name: '重命名' }))
    const nameInput = await screen.findByLabelText('项目名称')
    fireEvent.change(nameInput, { target: { value: '   ' } })
    const saveButton = screen.getByRole('button', { name: '保存名称' }) as HTMLButtonElement
    expect(saveButton.disabled).toBe(true)
    fireEvent.click(saveButton)
    expect(onRenameProject).not.toHaveBeenCalled()

    fireEvent.change(nameInput, { target: { value: '  Renamed with Enter  ' } })
    fireEvent.keyDown(nameInput, { key: 'Enter' })
    await waitFor(() => expect(onRenameProject).toHaveBeenCalledWith(project, 'Renamed with Enter'))
  })
})

describe('ProjectRail Shell settings', () => {
  it('shows an unavailable persisted choice and keeps it selected after update rejection', async () => {
    i18n.changeLanguage('zh')
    const onShellChange = vi.fn().mockRejectedValue(new Error('主进程拒绝了 Shell 选择'))
    const onRefreshShells = vi.fn().mockResolvedValue(undefined)
    render(<I18nextProvider i18n={i18n}>
      <ProjectRail
        activeProjectId={null}
        activeSkinId="builtin.light.neutral"
        language="en"
        projects={[]}
      shellSnapshot={{
        platform: 'linux',
        preferences: {
          version: 3,
          selection: {
            mode: 'explicit',
            shell: {
              kind: 'native',
              id: 'posix:%2Fmissing%2Fzsh',
              displayName: 'zsh',
              family: 'posix',
              executablePath: '/missing/zsh'
            }
          }
        },
        candidates: [{
          id: 'posix:%2Fbin%2Fbash',
          displayName: 'bash',
          family: 'posix',
          executablePath: '/bin/bash',
          source: 'system'
        }],
        effectiveShell: null,
        error: '所选 Shell 不可用：zsh (/missing/zsh)'
      }}
      onAddProject={() => undefined}
      onLanguageChange={() => undefined}
      onOpenAppearance={() => undefined}
      onDeleteProject={async () => undefined}
      onOpenAssistant={() => undefined}
      onOpenDesigner={() => undefined}
      onRefreshShells={onRefreshShells}
      onRenameProject={async () => undefined}
      onReorderProject={() => undefined}
      onSelectProject={() => undefined}
      onShellChange={onShellChange}
      onSkinChange={() => undefined}
      userSkins={[]}
      />
    </I18nextProvider>)

    expect(screen.getByText('zsh（不可用）')).toBeTruthy()
    expect(screen.getByText('/missing/zsh')).toBeTruthy()
    expect(screen.getByText('所选 Shell 不可用：zsh (/missing/zsh)')).toBeTruthy()
    const unavailableOption = screen.getByTitle('zsh（不可用） · /missing/zsh')
    expect(unavailableOption.classList).toContain('truncate')
    expect(unavailableOption.classList).not.toContain('flex-col')
    const detectedOption = screen.getByTitle('bash · posix · /bin/bash')
    expect(detectedOption.classList).toContain('truncate')
    expect(detectedOption.classList).not.toContain('flex-col')

    fireEvent.click(screen.getByRole('button', { name: /bash posix/ }))

    await waitFor(() => expect(onShellChange).toHaveBeenCalledWith('posix:%2Fbin%2Fbash'))
    expect(await screen.findByText('主进程拒绝了 Shell 选择')).toBeTruthy()
    expect(screen.getByText('zsh（不可用）')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '重新检测终端环境' }))
    await waitFor(() => expect(onRefreshShells).toHaveBeenCalledOnce())
  })
})

describe('ProjectRail language picker', () => {
  it('invokes onLanguageChange when a language option is chosen', () => {
    i18n.changeLanguage('zh')
    const onLanguageChange = vi.fn()
    render(<I18nextProvider i18n={i18n}>
      <ProjectRail
        activeProjectId={null}
        activeSkinId="builtin.light.neutral"
        language="en"
        projects={[]}
        shellSnapshot={{
          platform: 'linux',
          preferences: { version: 3, selection: { mode: 'automatic' } },
          candidates: [],
          effectiveShell: null,
          error: undefined
        }}
        onAddProject={() => undefined}
        onLanguageChange={onLanguageChange}
        onOpenAppearance={() => undefined}
        onDeleteProject={async () => undefined}
        onOpenAssistant={() => undefined}
        onOpenDesigner={() => undefined}
        onRefreshShells={async () => undefined}
        onRenameProject={async () => undefined}
        onReorderProject={() => undefined}
        onSelectProject={() => undefined}
        onShellChange={async () => undefined}
        onSkinChange={() => undefined}
        userSkins={[]}
      />
    </I18nextProvider>)

    fireEvent.click(screen.getByRole('button', { name: '中文' }))
    expect(onLanguageChange).toHaveBeenCalledWith('zh')
  })
})

describe('ProjectRail skin picker', () => {
  it('lists preset skins and a custom-skin empty hint, and reports selection', () => {
    i18n.changeLanguage('zh')
    const onSkinChange = vi.fn()
    render(<I18nextProvider i18n={i18n}>
      <ProjectRail
        activeProjectId={null}
        activeSkinId="builtin.light.neutral"
        language="en"
        projects={[]}
        shellSnapshot={{
          platform: 'linux',
          preferences: { version: 3, selection: { mode: 'automatic' } },
          candidates: [],
          effectiveShell: null,
          error: undefined
        }}
        onAddProject={() => undefined}
        onLanguageChange={() => undefined}
        onOpenAppearance={() => undefined}
        onDeleteProject={async () => undefined}
        onOpenAssistant={() => undefined}
        onOpenDesigner={() => undefined}
        onRefreshShells={async () => undefined}
        onRenameProject={async () => undefined}
        onReorderProject={() => undefined}
        onSelectProject={() => undefined}
        onShellChange={async () => undefined}
        onSkinChange={onSkinChange}
        userSkins={[]}
      />
    </I18nextProvider>)

    expect(screen.getByText('预设主题')).toBeTruthy()
    expect(screen.getByText('中性浅色')).toBeTruthy()
    expect(screen.getByText('中性深色')).toBeTruthy()
    expect(screen.getByText('自定义主题')).toBeTruthy()
    expect(screen.getByText('暂无自定义主题。')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '中性深色' }))
    expect(onSkinChange).toHaveBeenCalledWith('builtin.dark.neutral')
  })

  it('uses a custom skin background for both of its icons', () => {
    i18n.changeLanguage('zh')
    const skin: UserSkin = {
      ...defaultSkinContent('light'),
      id: 'user.gradient',
      builtin: false,
      name: '渐变主题',
      background: {
        kind: 'gradient',
        stops: ['#112233', '#445566'],
        angle: 45
      }
    }
    const { container } = render(<I18nextProvider i18n={i18n}>
      <ProjectRail
        activeProjectId={null}
        activeSkinId={skin.id}
        language="zh"
        projects={[]}
        shellSnapshot={{
          platform: 'linux',
          preferences: { version: 3, selection: { mode: 'automatic' } },
          candidates: [],
          effectiveShell: null,
          error: undefined
        }}
        onAddProject={() => undefined}
        onLanguageChange={() => undefined}
        onOpenAppearance={() => undefined}
        onDeleteProject={async () => undefined}
        onOpenAssistant={() => undefined}
        onOpenDesigner={() => undefined}
        onRefreshShells={async () => undefined}
        onRenameProject={async () => undefined}
        onReorderProject={() => undefined}
        onSelectProject={() => undefined}
        onShellChange={async () => undefined}
        onSkinChange={() => undefined}
        userSkins={[skin]}
      />
    </I18nextProvider>)

    expect(screen.getByText('渐变主题')).toBeTruthy()
    const gradientIcons = Array.from(container.querySelectorAll<HTMLElement>('span'))
      .filter((element) => element.style.background.includes('linear-gradient(45deg'))
    expect(gradientIcons).toHaveLength(2)
  })
})
