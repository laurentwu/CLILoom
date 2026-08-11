import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Check,
  Copy,
  Download,
  Plus,
  RotateCcw,
  Trash2,
  Upload,
  X
} from 'lucide-react'
import type { TranslationKey } from '../../shared/i18n/types'
import type { UserSkin } from '../../shared/appSettings'
import {
  BUILTIN_SKIN_LIGHT_ID,
  SKIN_BOUNDS,
  SKIN_COLOR_TOKEN_KEYS,
  defaultSkinContent,
  getBuiltinSkin,
  type Skin,
  type SkinBackground,
  type SkinContent
} from '../../shared/skin'
import { applySkin, backgroundToCss, BUILTIN_SKIN_OPTIONS } from '../theme'
import { CodeFontFamilyPicker } from './CodeFontFamilyPicker'
import { Button } from '@/components/ui/button'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ColorPicker } from '@/components/ui/color-picker'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'

const NEW_SKIN_DRAFT_ID = 'user.unsaved-draft'

type AppearancePanelProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  activeSkin: Skin
  activeSkinId: string
  userSkins: UserSkin[]
}

function cloneContent(content: SkinContent): SkinContent {
  return {
    mode: content.mode,
    colors: { ...content.colors },
    typography: { ...content.typography },
    radius: content.radius,
    background:
      content.background.kind === 'solid'
        ? { kind: 'solid', color: content.background.color }
        : { kind: 'gradient', stops: [...content.background.stops], angle: content.background.angle },
    spacingScale: content.spacingScale
  }
}

export function AppearancePanel({
  open,
  onOpenChange,
  activeSkin,
  activeSkinId,
  userSkins
}: AppearancePanelProps) {
  const { t } = useTranslation()
  const [selectedId, setSelectedId] = useState(activeSkinId)
  const [creating, setCreating] = useState(false)
  const [optimisticSkin, setOptimisticSkin] = useState<UserSkin | null>(null)
  const [draft, setDraft] = useState<SkinContent | null>(null)
  const [dirty, setDirty] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const saveRequestIdRef = useRef(0)
  const savingRef = useRef(false)
  const [skinToDelete, setSkinToDelete] = useState<UserSkin | null>(null)

  const selectedSkin: Skin = useMemo(
    () => getBuiltinSkin(selectedId)
      ?? userSkins.find((skin) => skin.id === selectedId)
      ?? (optimisticSkin?.id === selectedId ? optimisticSkin : activeSkin),
    [selectedId, userSkins, optimisticSkin, activeSkin]
  )
  const isEditable = creating || !selectedSkin.builtin

  useEffect(() => {
    saveRequestIdRef.current += 1
    savingRef.current = false
    setSaving(false)
    if (!open) {
      setSkinToDelete(null)
      return
    }
    setSelectedId(activeSkinId)
    setCreating(false)
    setOptimisticSkin(null)
    setError(null)
  }, [open, activeSkinId])

  useEffect(() => () => {
    saveRequestIdRef.current += 1
    savingRef.current = false
  }, [])

  useEffect(() => {
    if (!open || creating) return
    setError(null)
    if (!selectedSkin.builtin) {
      setDraft(cloneContent(selectedSkin))
      setNameDraft((selectedSkin as UserSkin).name)
      setDirty(false)
    } else {
      setDraft(null)
      setNameDraft('')
      setDirty(false)
    }
    // Preview the selected skin. Runs only on open / selection change so that
    // external settings broadcasts (which App reflects into props) are not
    // overridden by a stale non-active preview.
    applySkin(selectedSkin)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selectedId, creating])

  useEffect(() => {
    if (optimisticSkin && userSkins.some((skin) => skin.id === optimisticSkin.id)) {
      setOptimisticSkin(null)
    }
  }, [optimisticSkin, userSkins])

  // If the selected skin disappears (deleted elsewhere), fall back to the active skin.
  useEffect(() => {
    if (!open || creating) return
    const exists = Boolean(getBuiltinSkin(selectedId))
      || userSkins.some((skin) => skin.id === selectedId)
      || optimisticSkin?.id === selectedId
    if (!exists) setSelectedId(activeSkinId)
  }, [open, selectedId, userSkins, optimisticSkin, activeSkinId, creating])

  function previewDraft(next: SkinContent): void {
    setDraft(next)
    setDirty(true)
    const draftSkin: Skin = {
      ...next,
      id: creating ? NEW_SKIN_DRAFT_ID : selectedSkin.id,
      builtin: false,
      name: nameDraft || (creating
        ? t('skin:action.new')
        : selectedSkin.builtin ? 'skin' : (selectedSkin as UserSkin).name)
    }
    applySkin(draftSkin)
  }

  function confirmDiscard(): boolean {
    if (!dirty) return true
    return window.confirm(t('skin:error.dirtyConfirm'))
  }

  function invalidatePendingSave(): void {
    saveRequestIdRef.current += 1
    savingRef.current = false
    setSaving(false)
  }

  function selectSkin(id: string): void {
    if (!creating && id === selectedId) return
    if (!confirmDiscard()) return
    invalidatePendingSave()
    setError(null)
    setCreating(false)
    setOptimisticSkin(null)
    setSelectedId(id)
  }

  function updateColor(key: keyof SkinContent['colors'], value: string): void {
    if (!draft) return
    previewDraft({ ...draft, colors: { ...draft.colors, [key]: value } })
  }

  function updateBackground(next: SkinBackground): void {
    if (!draft) return
    previewDraft({ ...draft, background: next })
  }

  function handleNameChange(value: string): void {
    setNameDraft(value)
    setDirty(true)
  }

  async function handleSave(): Promise<void> {
    if (savingRef.current || !draft || !isEditable) return
    const trimmedName = nameDraft.trim()
    if (!trimmedName) {
      setError(t('skin:error.nameRequired'))
      return
    }
    const saveRequestId = ++saveRequestIdRef.current
    savingRef.current = true
    setSaving(true)
    setError(null)
    try {
      if (creating) {
        const created = await window.cliLoom?.createSkin(trimmedName, draft)
        if (saveRequestIdRef.current !== saveRequestId || !created) return
        setOptimisticSkin(created)
        setCreating(false)
        setSelectedId(created.id)
        setDraft(cloneContent(created))
        setNameDraft(created.name)
        setDirty(false)
        applySkin(created)
        return
      }
      if (trimmedName !== (selectedSkin as UserSkin).name) {
        await window.cliLoom?.renameSkin(selectedSkin.id, trimmedName)
        if (saveRequestIdRef.current !== saveRequestId) return
      }
      await window.cliLoom?.updateUserSkin(selectedSkin.id, draft)
      if (saveRequestIdRef.current !== saveRequestId) return
      setDirty(false)
    } catch (saveError) {
      if (saveRequestIdRef.current !== saveRequestId) return
      setError(saveError instanceof Error ? saveError.message : String(saveError))
      applySkin(activeSkin)
    } finally {
      if (saveRequestIdRef.current === saveRequestId) {
        savingRef.current = false
        setSaving(false)
      }
    }
  }

  function handleNew(): void {
    if (!confirmDiscard()) return
    invalidatePendingSave()
    const content = defaultSkinContent('light')
    const name = t('skin:action.new')
    setError(null)
    setCreating(true)
    setOptimisticSkin(null)
    setDraft(content)
    setNameDraft(name)
    setDirty(true)
    applySkin({ ...content, id: NEW_SKIN_DRAFT_ID, builtin: false, name })
  }

  async function handleDuplicate(): Promise<void> {
    if (creating) return
    if (!confirmDiscard()) return
    invalidatePendingSave()
    setError(null)
    try {
      const created = await window.cliLoom?.duplicateSkin(selectedSkin.id)
      if (created) {
        setOptimisticSkin(created)
        setSelectedId(created.id)
      }
    } catch (duplicateError) {
      setError(duplicateError instanceof Error ? duplicateError.message : String(duplicateError))
    }
  }

  async function handleDelete(): Promise<void> {
    const deletingSkin = skinToDelete
    if (!deletingSkin) return
    invalidatePendingSave()
    setError(null)
    try {
      await window.cliLoom?.deleteSkin(deletingSkin.id)
      setOptimisticSkin(null)
      setSelectedId(activeSkinId)
      setSkinToDelete(null)
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError))
    }
  }

  async function handleExport(): Promise<void> {
    if (creating) return
    setError(null)
    try {
      await window.cliLoom?.exportSkin(selectedSkin.id)
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : String(exportError))
    }
  }

  async function handleImport(): Promise<void> {
    if (!confirmDiscard()) return
    invalidatePendingSave()
    setError(null)
    try {
      const result = await window.cliLoom?.importSkin()
      if (result && !result.canceled) {
        setOptimisticSkin(result.skin)
        setCreating(false)
        setSelectedId(result.skin.id)
      }
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : String(importError))
    }
  }

  function handleReset(): void {
    if (!confirmDiscard()) return
    invalidatePendingSave()
    setCreating(false)
    setOptimisticSkin(null)
    setSelectedId(BUILTIN_SKIN_LIGHT_ID)
    void window.cliLoom?.setActiveSkin(BUILTIN_SKIN_LIGHT_ID)
  }

  function handleClose(openState: boolean): void {
    if (!openState) {
      if (!confirmDiscard()) return
      invalidatePendingSave()
      applySkin(activeSkin)
    }
    onOpenChange(openState)
  }

  function makeActive(): void {
    if (creating) return
    void window.cliLoom?.setActiveSkin(selectedSkin.id)
  }

  const displayedBackground = draft && isEditable ? draft.background : selectedSkin.background
  const displayedName = isEditable
    ? nameDraft
    : t((selectedSkin as { nameKey: TranslationKey }).nameKey)

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="flex max-h-[85vh] w-full sm:max-w-[min(80rem,calc(100%-2rem))] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-5 py-3">
          <DialogTitle>{t('settings:menu.skin')}</DialogTitle>
          <DialogDescription className="sr-only">{t('skin:hint.realtimePreview')}</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1">
          <aside className="flex w-56 shrink-0 flex-col gap-1 overflow-y-auto border-r bg-muted/30 p-3">
            <Button className="mb-1 w-full justify-start" disabled={saving} onClick={handleNew} size="sm" variant="outline">
              <Plus /> {t('skin:action.new')}
            </Button>
            <SkinGroupLabel label={t('skin:group.preset')} />
            {BUILTIN_SKIN_OPTIONS.map((skin) => (
              <SkinListItem
                active={!creating && skin.id === selectedId}
                background={skin.background}
                key={skin.id}
                label={t(skin.nameKey)}
                onClick={() => selectSkin(skin.id)}
              />
            ))}
            <SkinGroupLabel label={t('skin:group.mySkins')} />
            {userSkins.length > 0 ? (
              userSkins.map((skin) => (
                <SkinListItem
                  active={!creating && skin.id === selectedId}
                  background={backgroundToCss(skin.background)}
                  key={skin.id}
                  label={skin.name}
                  onClick={() => selectSkin(skin.id)}
                />
              ))
            ) : (
              <p className="px-2 text-xs text-muted-foreground">{t('skin:hint.emptyCustom')}</p>
            )}
          </aside>

          <section className="flex min-h-0 flex-1 flex-col overflow-y-auto p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span
                  aria-hidden
                  className="size-6 rounded-full border border-foreground/10"
                  style={{ background: backgroundToCss(displayedBackground) }}
                />
                <span className="text-sm font-medium">
                  {displayedName}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {!creating && selectedSkin.id !== activeSkinId && (
                  <Button disabled={saving} onClick={makeActive} size="sm" variant="secondary">
                    <Check /> {t('skin:action.confirm')}
                  </Button>
                )}
                <Button disabled={creating || saving} onClick={() => void handleDuplicate()} size="sm" variant="ghost">
                  <Copy /> {t('skin:action.duplicate')}
                </Button>
                <Button disabled={creating || saving} onClick={() => void handleExport()} size="sm" variant="ghost">
                  <Download /> {t('skin:action.export')}
                </Button>
                <Button disabled={saving} onClick={() => void handleImport()} size="sm" variant="ghost">
                  <Upload /> {t('skin:action.import')}
                </Button>
                <Button
                  disabled={creating || saving || selectedSkin.builtin}
                  onClick={() => {
                    if (creating || saving || selectedSkin.builtin) return
                    setSkinToDelete(selectedSkin as UserSkin)
                  }}
                  size="sm"
                  variant="ghost"
                >
                  <Trash2 /> {t('skin:action.delete')}
                </Button>
                <Button disabled={saving} onClick={handleReset} size="sm" variant="ghost">
                  <RotateCcw /> {t('skin:action.reset')}
                </Button>
              </div>
            </div>

            {!isEditable ? (
              <p className="text-sm text-muted-foreground">{t('skin:hint.realtimePreview')}</p>
            ) : (
              <SkinEditor
                draft={draft}
                dirty={dirty}
                saving={saving}
                nameDraft={nameDraft}
                onNameChange={handleNameChange}
                onColorChange={updateColor}
                onBackgroundChange={updateBackground}
                onDraftPatch={(patch) => draft && previewDraft({ ...draft, ...patch })}
                onSave={() => void handleSave()}
                t={t}
              />
            )}
            {error && <p className="mt-4 text-sm text-destructive">{error}</p>}
          </section>
        </div>
      </DialogContent>

      <AlertDialog open={Boolean(skinToDelete)} onOpenChange={(dialogOpen) => !dialogOpen && setSkinToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia>
              <Trash2 />
            </AlertDialogMedia>
            <AlertDialogTitle>{t('skin:delete.title', { name: skinToDelete?.name ?? '' })}</AlertDialogTitle>
            <AlertDialogDescription>{t('skin:delete.description')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common:action.cancel')}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void handleDelete()}>
              {t('skin:delete.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  )
}

type EditorProps = {
  draft: SkinContent | null
  dirty: boolean
  saving: boolean
  nameDraft: string
  onNameChange: (value: string) => void
  onColorChange: (key: keyof SkinContent['colors'], value: string) => void
  onBackgroundChange: (next: SkinBackground) => void
  onDraftPatch: (patch: Partial<SkinContent>) => void
  onSave: () => void
  t: (key: TranslationKey) => string
}

function SkinEditor({
  draft,
  dirty,
  saving,
  nameDraft,
  onNameChange,
  onColorChange,
  onBackgroundChange,
  onDraftPatch,
  onSave,
  t
}: EditorProps) {
  if (!draft) return null
  const background = draft.background

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="skin-name">{t('skin:name.label')}</Label>
          <Input
            className="h-8 w-64"
            id="skin-name"
            value={nameDraft}
            onChange={(event) => onNameChange(event.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => onDraftPatch({ mode: 'light' })}
            size="sm"
            variant={draft.mode === 'light' ? 'default' : 'outline'}
          >
            {t('skin:mode.light')}
          </Button>
          <Button
            onClick={() => onDraftPatch({ mode: 'dark' })}
            size="sm"
            variant={draft.mode === 'dark' ? 'default' : 'outline'}
          >
            {t('skin:mode.dark')}
          </Button>
          <Button disabled={!dirty || saving} onClick={onSave}>
            <Check /> {t('skin:action.confirm')}
          </Button>
        </div>
      </div>

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t('skin:section.colors')}
        </h3>
        <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {SKIN_COLOR_TOKEN_KEYS.map((key) => (
            <div className="flex flex-col gap-1.5" key={key}>
              <Label className="text-xs">{t(`skin:token.${key}` as TranslationKey)}</Label>
              <ColorPicker
                className="w-full"
                label={t(`skin:token.${key}` as TranslationKey)}
                value={draft.colors[key]}
                onChange={(value) => onColorChange(key, value)}
              />
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t('skin:section.background')}
        </h3>
        <div className="flex gap-2">
          <Button
            onClick={() => onBackgroundChange({ kind: 'solid', color: background.kind === 'solid' ? background.color : draft.colors.background })}
            size="sm"
            variant={background.kind === 'solid' ? 'default' : 'outline'}
          >
            {t('skin:background.solid')}
          </Button>
          <Button
            onClick={() =>
              onBackgroundChange(
                background.kind === 'gradient'
                  ? background
                  : { kind: 'gradient', stops: [draft.colors.background, draft.colors.foreground], angle: 180 }
              )
            }
            size="sm"
            variant={background.kind === 'gradient' ? 'default' : 'outline'}
          >
            {t('skin:background.gradient')}
          </Button>
        </div>
        {background.kind === 'solid' ? (
          <ColorPicker label={t('skin:background.solid')} value={background.color} onChange={(value) => onBackgroundChange({ kind: 'solid', color: value })} />
        ) : (
          <div className="flex flex-col gap-3">
            {background.stops.map((stop, index) => (
              <div className="flex items-center gap-2" key={index}>
                <ColorPicker
                  label={`${t('skin:background.gradient')} ${index + 1}`}
                  value={stop}
                  onChange={(value) => {
                    const stops = [...background.stops]
                    stops[index] = value
                    onBackgroundChange({ kind: 'gradient', stops, angle: background.angle })
                  }}
                />
                {background.stops.length > SKIN_BOUNDS.gradientStopsMin && (
                  <Button
                    onClick={() =>
                      onBackgroundChange({
                        kind: 'gradient',
                        stops: background.stops.filter((_, i) => i !== index),
                        angle: background.angle
                      })
                    }
                    size="icon-xs"
                    variant="ghost"
                  >
                    <X />
                  </Button>
                )}
              </div>
            ))}
            {background.stops.length < SKIN_BOUNDS.gradientStopsMax && (
              <Button
                className="w-fit"
                onClick={() =>
                  onBackgroundChange({
                    kind: 'gradient',
                    stops: [...background.stops, '#000000'],
                    angle: background.angle
                  })
                }
                size="sm"
                variant="outline"
              >
                <Plus /> {t('skin:background.addStop')}
              </Button>
            )}
            <div className="flex items-center gap-3">
              <Label className="w-16 text-xs">{t('skin:background.angle')}</Label>
              <Slider
                className="flex-1"
                max={SKIN_BOUNDS.angleMax}
                min={SKIN_BOUNDS.angleMin}
                value={[background.angle]}
                onValueChange={([value]) => onBackgroundChange({ kind: 'gradient', stops: background.stops, angle: value })}
              />
              <span className="w-10 text-right text-xs text-muted-foreground">{background.angle}°</span>
            </div>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t('skin:section.typography')}
        </h3>
        <SliderRow
          label={t('skin:font.size')}
          max={SKIN_BOUNDS.fontSizeMax}
          min={SKIN_BOUNDS.fontSizeMin}
          step={1}
          unit="px"
          value={draft.typography.fontSize}
          onChange={(value) => onDraftPatch({ typography: { ...draft.typography, fontSize: value } })}
        />
        <SliderRow
          label={t('skin:font.lineHeight')}
          max={SKIN_BOUNDS.lineHeightMax}
          min={SKIN_BOUNDS.lineHeightMin}
          step={0.05}
          unit=""
          value={draft.typography.lineHeight}
          onChange={(value) => onDraftPatch({ typography: { ...draft.typography, lineHeight: value } })}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t('skin:section.codeFont')}
        </h3>
        <CodeFontFamilyPicker
          id="skin-code-font"
          t={t}
          value={draft.typography.codeFontFamily}
          onValueChange={(codeFontFamily) => onDraftPatch({
            typography: { ...draft.typography, codeFontFamily }
          })}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t('skin:section.radius')}
        </h3>
        <SliderRow
          label={t('skin:section.radius')}
          max={SKIN_BOUNDS.radiusMax}
          min={SKIN_BOUNDS.radiusMin}
          step={0.025}
          unit="rem"
          value={draft.radius}
          onChange={(value) => onDraftPatch({ radius: value })}
        />
        <h3 className="mt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t('skin:section.spacing')}
        </h3>
        <SliderRow
          label={t('skin:section.spacing')}
          max={SKIN_BOUNDS.spacingMax}
          min={SKIN_BOUNDS.spacingMin}
          step={0.05}
          unit="x"
          value={draft.spacingScale}
          onChange={(value) => onDraftPatch({ spacingScale: value })}
        />
      </section>
    </div>
  )
}

type SliderRowProps = {
  label: string
  min: number
  max: number
  step: number
  unit: string
  value: number
  onChange: (value: number) => void
}

function SliderRow({ label, min, max, step, unit, value, onChange }: SliderRowProps) {
  return (
    <div className="flex items-center gap-3">
      <Label className="w-24 text-xs">{label}</Label>
      <Slider
        className="flex-1"
        max={max}
        min={min}
        step={step}
        value={[value]}
        onValueChange={([next]) => onChange(next)}
      />
      <span className="w-14 text-right text-xs text-muted-foreground">
        {value}
        {unit}
      </span>
    </div>
  )
}

function SkinGroupLabel({ label }: { label: string }) {
  return <p className="mt-3 px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
}

function SkinListItem({
  active,
  background,
  label,
  onClick
}: {
  active: boolean
  background: string
  label: string
  onClick: () => void
}) {
  return (
    <button
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent',
        active && 'bg-accent'
      )}
      onClick={onClick}
      type="button"
    >
      <span aria-hidden className="size-3.5 shrink-0 rounded-full border border-foreground/10" style={{ background }} />
      <span className="truncate">{label}</span>
    </button>
  )
}
