import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CircleHelp,
  FolderPlus,
  Languages,
  Palette,
  RefreshCw,
  Settings,
  SlidersHorizontal,
  TerminalSquare,
  Trash2,
  Workflow
} from 'lucide-react'
import type { ProjectRecord } from '../appTypes'
import {
  type DetectedExecutionTarget,
  type ExecutionTargetDescriptor,
  type ShellSnapshot
} from '../../shared/shell'
import type { SupportedLanguage, UserSkin } from '../../shared/appSettings'
import { SUPPORTED_LANGUAGES } from '../../shared/appSettings'
import { backgroundToCss, BUILTIN_SKIN_OPTIONS } from '../theme'
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

type ProjectRailProps = {
  projects: ProjectRecord[]
  activeProjectId: string | null
  onSelectProject: (project: ProjectRecord) => void
  onReorderProject: (dragId: string, dropId: string) => void
  onAddProject: () => void
  onDeleteProject: (project: ProjectRecord) => Promise<void>
  onOpenDesigner: () => void
  onOpenAssistant: () => void
  activeSkinId: string
  userSkins: UserSkin[]
  onSkinChange: (id: string) => void
  onOpenAppearance: () => void
  language: SupportedLanguage
  onLanguageChange: (language: SupportedLanguage) => void
  shellSnapshot: ShellSnapshot
  onShellChange: (shellId: string | 'automatic') => Promise<void>
  onRefreshShells: () => Promise<void>
}

export function ProjectRail({
  projects,
  activeProjectId,
  onSelectProject,
  onReorderProject,
  onAddProject,
  onDeleteProject,
  onOpenDesigner,
  onOpenAssistant,
  activeSkinId,
  userSkins,
  onSkinChange,
  onOpenAppearance,
  language,
  onLanguageChange,
  shellSnapshot,
  onShellChange,
  onRefreshShells
}: ProjectRailProps) {
  const { t } = useTranslation()
  const [projectToDelete, setProjectToDelete] = useState<ProjectRecord | null>(null)
  const [shellBusy, setShellBusy] = useState(false)
  const [shellActionError, setShellActionError] = useState<string | null>(null)
  const activeBuiltinSkin = BUILTIN_SKIN_OPTIONS.find((skin) => skin.id === activeSkinId)
  const activeUserSkin = userSkins.find((skin) => skin.id === activeSkinId)
  const activeBackground = activeBuiltinSkin?.background
    ?? (activeUserSkin ? backgroundToCss(activeUserSkin.background) : undefined)
  const explicitSelection = shellSnapshot.preferences.selection.mode === 'explicit'
    ? shellSnapshot.preferences.selection.shell
    : null
  const selectedShellId = shellSnapshot.preferences.selection.mode === 'automatic'
    ? 'automatic'
    : explicitSelection!.id
  const unavailableSelection = explicitSelection !== null &&
    !shellSnapshot.candidates.some((target) => (
      target.id === explicitSelection.id
    ))
  const visibleCandidates = unavailableSelection
    ? shellSnapshot.candidates.filter((target) => target.id !== explicitSelection?.id)
    : shellSnapshot.candidates
  const nativeCandidates = visibleCandidates
  const automaticShellDetail = shellSnapshot.preferences.selection.mode === 'automatic'
    ? shellSnapshot.effectiveShell
      ? getTargetDetail(shellSnapshot.effectiveShell)
      : t('settings:shell.noneDetected')
    : t('settings:shell.automaticHint')
  const shellError = shellActionError ?? shellSnapshot.error

  const performShellAction = async (action: () => Promise<void>) => {
    setShellBusy(true)
    setShellActionError(null)
    try {
      await action()
    } catch (error) {
      setShellActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setShellBusy(false)
    }
  }

  const renderTargetOption = (target: DetectedExecutionTarget, busy: boolean) => {
    const detail = getTargetDetail(target)

    return (
      <DropdownMenuRadioItem
        disabled={busy}
        key={target.id}
        value={target.id}
      >
        <span
          className="min-w-0 flex-1 truncate"
          title={[target.displayName, target.family, detail].filter(Boolean).join(' · ')}
        >
          {target.displayName}
          {' '}<span className="text-xs text-muted-foreground">{target.family}</span>
          <span className="ml-2 text-xs text-muted-foreground">{detail}</span>
        </span>
      </DropdownMenuRadioItem>
    )
  }

  return (
    <>
      <aside className="project-rail flex min-h-0 flex-col items-center justify-between border-r bg-sidebar px-2 py-3 text-sidebar-foreground">
        <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col items-center gap-2 overflow-x-hidden overflow-y-auto">
          {projects.map((project) => {
            const isActive = project.id === activeProjectId
            return (
              <div className="group relative flex w-full justify-center" key={project.id}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      aria-label={t('project:action.openProject', { name: project.name })}
                      className="size-10 shrink-0 rounded-xl font-heading text-sm"
                      draggable
                      variant={isActive ? 'default' : 'ghost'}
                      onClick={() => onSelectProject(project)}
                      onDragStart={(event) => event.dataTransfer.setData('text/project-id', project.id)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => onReorderProject(event.dataTransfer.getData('text/project-id'), project.id)}
                    >
                      {project.name.slice(0, 1).toUpperCase()}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    <div className="flex max-w-64 flex-col gap-0.5">
                      <strong>{project.name}</strong>
                      <span className="truncate text-xs text-muted-foreground">{project.path}</span>
                    </div>
                  </TooltipContent>
                </Tooltip>
                <Button
                  aria-label={t('project:action.deleteProject', { name: project.name })}
                  className="absolute -top-1 right-0 size-4 rounded-sm bg-transparent opacity-0 shadow-none transition-opacity hover:bg-transparent focus-visible:bg-transparent focus-visible:opacity-100 dark:bg-transparent dark:hover:bg-transparent group-hover:opacity-100"
                  size="icon-xs"
                  title={t('project:tooltip.deleteProject')}
                  variant="destructive"
                  onClick={() => setProjectToDelete(project)}
                >
                  <Trash2 />
                </Button>
              </div>
            )
          })}

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={t('project:action.addFolder')}
                size="icon-lg"
                variant="outline"
                onClick={onAddProject}
              >
                <FolderPlus />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">{t('project:action.addFolder')}</TooltipContent>
          </Tooltip>
        </div>

        <div className="flex flex-col items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button aria-label={t('assistant:action.open')} size="icon-lg" variant="ghost" onClick={onOpenAssistant}>
                <CircleHelp />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">{t('assistant:label.window')}</TooltipContent>
          </Tooltip>

          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button aria-label={t('settings:menu.label')} size="icon-lg" variant="ghost">
                    <Settings />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="right">{t('settings:menu.label')}</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="start" className="min-w-64" side="right">
              <DropdownMenuGroup>
                <DropdownMenuItem onSelect={onOpenDesigner}>
                  <Workflow />
                  {t('designer:action.open')}
                </DropdownMenuItem>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Palette />
                    <span className="min-w-0 flex-1 truncate">{t('settings:menu.skin')}</span>
                    <span
                      aria-hidden
                      className="size-3 shrink-0 rounded-full border border-foreground/10"
                      style={{ background: activeBackground }}
                    />
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="max-h-[min(520px,calc(100vh-2rem))] min-w-56 overflow-x-hidden overflow-y-auto">
                    <DropdownMenuRadioGroup
                      value={activeSkinId}
                      onValueChange={(value) => onSkinChange(value)}
                    >
                      <DropdownMenuLabel>{t('skin:group.preset')}</DropdownMenuLabel>
                      {BUILTIN_SKIN_OPTIONS.map((skin) => (
                        <DropdownMenuRadioItem key={skin.id} value={skin.id}>
                          <span
                            aria-hidden
                            className="size-3.5 shrink-0 rounded-full border border-foreground/10"
                            style={{ background: skin.background }}
                          />
                          <span className="min-w-0 flex-1 truncate">{t(skin.nameKey)}</span>
                        </DropdownMenuRadioItem>
                      ))}
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel>{t('skin:group.mySkins')}</DropdownMenuLabel>
                      {userSkins.length > 0 ? (
                        userSkins.map((skin) => (
                          <DropdownMenuRadioItem key={skin.id} value={skin.id}>
                            <span
                              aria-hidden
                              className="size-3.5 shrink-0 rounded-full border border-foreground/10"
                              style={{ background: backgroundToCss(skin.background) }}
                            />
                            <span className="min-w-0 flex-1 truncate" title={skin.name}>{skin.name}</span>
                          </DropdownMenuRadioItem>
                        ))
                      ) : (
                        <DropdownMenuItem disabled>
                          <span className="text-muted-foreground">{t('skin:hint.emptyCustom')}</span>
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuRadioGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => onOpenAppearance()}>
                      <SlidersHorizontal />
                      {t('skin:action.customize')}
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Languages />
                    <span className="min-w-0 flex-1 truncate">{t('settings:language.label')}</span>
                    <span className="max-w-20 shrink-0 truncate text-xs text-muted-foreground">
                      {t(`settings:language.${language}`)}
                    </span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="min-w-48">
                    <DropdownMenuRadioGroup
                      value={language}
                      onValueChange={(value) => {
                        if (SUPPORTED_LANGUAGES.some((lng) => lng === value))
                          onLanguageChange(value as SupportedLanguage)
                      }}
                    >
                      {SUPPORTED_LANGUAGES.map((lng) => (
                        <DropdownMenuRadioItem key={lng} value={lng}>
                          <span className="min-w-0 flex-1 truncate">{t(`settings:language.${lng}`)}</span>
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <TerminalSquare />
                    <span className="min-w-0 flex-1 truncate">{t('settings:menu.defaultShell')}</span>
                    <span
                      className="max-w-20 shrink-0 truncate text-xs text-muted-foreground"
                      title={shellSnapshot.effectiveShell?.displayName}
                    >
                      {shellSnapshot.effectiveShell?.displayName ?? t('settings:shell.unavailableShort')}
                    </span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="max-h-[min(520px,calc(100vh-2rem))] min-w-80 max-w-[min(32rem,var(--radix-dropdown-menu-content-available-width))] overflow-y-auto">
                    <DropdownMenuLabel>{t('settings:menu.globalShell')}</DropdownMenuLabel>
                    <DropdownMenuRadioGroup
                      value={selectedShellId}
                      onValueChange={(value) => {
                        if (shellBusy || value === selectedShellId) return
                        void performShellAction(() => onShellChange(value))
                      }}
                    >
                      <DropdownMenuRadioItem disabled={shellBusy} value="automatic">
                        <span
                          className="min-w-0 flex-1 truncate"
                          title={`${t('settings:shell.automatic')} · ${automaticShellDetail}`}
                        >
                          {t('settings:shell.automatic')}
                          <span className="ml-2 text-xs text-muted-foreground">{automaticShellDetail}</span>
                        </span>
                      </DropdownMenuRadioItem>
                      {unavailableSelection && explicitSelection && (
                        <DropdownMenuRadioItem disabled value={explicitSelection.id}>
                          <span
                            className="min-w-0 flex-1 truncate text-destructive"
                            title={`${t('terminal:shell.unavailable', { name: explicitSelection.displayName })} · ${getTargetDetail(explicitSelection)}`}
                          >
                            {t('terminal:shell.unavailable', { name: explicitSelection.displayName })}
                            <span className="ml-2 text-xs">{getTargetDetail(explicitSelection)}</span>
                          </span>
                        </DropdownMenuRadioItem>
                      )}
                      {nativeCandidates.length > 0 && (
                        <DropdownMenuLabel>{t(shellSnapshot.platform === 'win32'
                          ? 'settings:shell.windowsGroup'
                          : 'settings:shell.nativeGroup')}</DropdownMenuLabel>
                      )}
                      {nativeCandidates.map((target) => renderTargetOption(target, shellBusy))}
                    </DropdownMenuRadioGroup>
                    {shellError && (
                      <DropdownMenuLabel className="text-destructive" title={shellError}>
                        {shellError}
                      </DropdownMenuLabel>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      disabled={shellBusy}
                      onSelect={(event) => {
                        event.preventDefault()
                        void performShellAction(onRefreshShells)
                      }}
                    >
                      <RefreshCw className={shellBusy || shellSnapshot.discovering ? 'animate-spin' : undefined} />
                      {t('settings:shell.redetect')}
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      <AlertDialog open={Boolean(projectToDelete)} onOpenChange={(open) => !open && setProjectToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia>
              <Trash2 />
            </AlertDialogMedia>
            <AlertDialogTitle>{t('project:delete.title', { name: projectToDelete?.name ?? '' })}</AlertDialogTitle>
            <AlertDialogDescription>{t('project:delete.description')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common:action.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (!projectToDelete) return
                void onDeleteProject(projectToDelete).finally(() => setProjectToDelete(null))
              }}
            >
              {t('project:delete.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function getTargetDetail(target: DetectedExecutionTarget | ExecutionTargetDescriptor): string {
  return target.executablePath
}
