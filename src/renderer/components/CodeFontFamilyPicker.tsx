import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronsUpDown } from 'lucide-react'
import type { TranslationKey } from '../../shared/i18n/types'
import { DEFAULT_CODE_FONT_FAMILY } from '../../shared/skin'
import { isCssGenericFontFamily } from '../fonts'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

type FontLoadState = 'idle' | 'loading' | 'loaded' | 'error'

type CodeFontFamilyPickerProps = {
  id: string
  value: string
  onValueChange: (value: string) => void
  t: (key: TranslationKey) => string
}

function fontFamilyKey(value: string): string {
  return value.trim().toLocaleLowerCase()
}

export function CodeFontFamilyPicker({
  id,
  value,
  onValueChange,
  t
}: CodeFontFamilyPickerProps) {
  const [open, setOpen] = useState(false)
  const [loadState, setLoadState] = useState<FontLoadState>('idle')
  const [installedFontFamilies, setInstalledFontFamilies] = useState<string[]>([])
  const requestIdRef = useRef(0)

  useEffect(() => () => {
    requestIdRef.current += 1
  }, [])

  const loadInstalledFontFamilies = useCallback(async () => {
    if (loadState === 'loading') return
    const requestId = ++requestIdRef.current
    setLoadState('loading')
    try {
      const fontFamilies = await window.cliLoom?.getInstalledFontFamilies()
      if (requestIdRef.current !== requestId) return
      if (!fontFamilies) throw new Error('Installed font API is unavailable')
      setInstalledFontFamilies(fontFamilies)
      setLoadState('loaded')
    } catch {
      if (requestIdRef.current !== requestId) return
      setLoadState('error')
    }
  }, [loadState])

  const installedFontKeys = useMemo(
    () => new Set(installedFontFamilies.map(fontFamilyKey)),
    [installedFontFamilies]
  )
  const selectedFontUnavailable = loadState === 'loaded'
    && fontFamilyKey(value) !== fontFamilyKey(DEFAULT_CODE_FONT_FAMILY)
    && !isCssGenericFontFamily(value)
    && !installedFontKeys.has(fontFamilyKey(value))
  const fontFamilies = useMemo(() => {
    const seen = new Set<string>()
    const result: string[] = []
    const add = (fontFamily: string) => {
      const key = fontFamilyKey(fontFamily)
      if (!key || seen.has(key)) return
      seen.add(key)
      result.push(fontFamily)
    }

    add(DEFAULT_CODE_FONT_FAMILY)
    add(value)
    for (const fontFamily of installedFontFamilies) add(fontFamily)
    return result
  }, [installedFontFamilies, value])
  const displayedValue = selectedFontUnavailable
    ? `${t('skin:font.unavailable')}: ${value}`
    : value

  function handleOpenChange(nextOpen: boolean): void {
    setOpen(nextOpen)
    if (nextOpen && (loadState === 'idle' || loadState === 'error')) {
      void loadInstalledFontFamilies()
    }
  }

  function selectFontFamily(fontFamily: string): void {
    setOpen(false)
    if (fontFamily !== value) onValueChange(fontFamily)
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <Label className="w-24 text-xs" htmlFor={id}>{t('skin:font.family')}</Label>
        <Popover open={open} onOpenChange={handleOpenChange}>
          <PopoverTrigger asChild>
            <Button
              aria-label={t('skin:font.family')}
              className="min-w-0 flex-1 justify-between font-normal"
              id={id}
              role="combobox"
              variant="outline"
            >
              <span className="truncate">{displayedValue}</span>
              <ChevronsUpDown data-icon="inline-end" className="ml-auto opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-(--radix-popover-trigger-width) gap-0 p-0"
          >
            <Command>
              <CommandInput placeholder={t('skin:font.searchPlaceholder')} />
              <CommandList>
                <CommandEmpty>
                  {loadState === 'loading'
                    ? t('skin:font.loading')
                    : t('skin:font.noResults')}
                </CommandEmpty>
                <CommandGroup heading={t('skin:font.available')}>
                  {fontFamilies.map((fontFamily) => {
                    const bundled = fontFamilyKey(fontFamily) === fontFamilyKey(DEFAULT_CODE_FONT_FAMILY)
                    const unavailable = loadState === 'loaded'
                      && !bundled
                      && !isCssGenericFontFamily(fontFamily)
                      && !installedFontKeys.has(fontFamilyKey(fontFamily))
                    return (
                      <CommandItem
                        data-checked={fontFamilyKey(fontFamily) === fontFamilyKey(value)}
                        key={fontFamily}
                        value={fontFamily}
                        onSelect={() => selectFontFamily(fontFamily)}
                      >
                        <span className="truncate">{fontFamily}</span>
                        {bundled ? (
                          <span className="text-xs text-muted-foreground">
                            {t('skin:font.bundled')}
                          </span>
                        ) : unavailable ? (
                          <span className="text-xs text-muted-foreground">
                            {t('skin:font.unavailable')}
                          </span>
                        ) : null}
                      </CommandItem>
                    )
                  })}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>
      <p className="pl-27 text-xs text-muted-foreground">{t('skin:font.searchHint')}</p>
      {loadState === 'loading' ? (
        <p className="pl-27 text-xs text-muted-foreground" role="status">
          {t('skin:font.loading')}
        </p>
      ) : loadState === 'error' ? (
        <div className="flex items-center gap-2 pl-27 text-xs text-destructive" role="alert">
          <span>{t('skin:font.loadFailed')}</span>
          <Button
            className="h-auto px-0 text-xs"
            onClick={() => void loadInstalledFontFamilies()}
            size="xs"
            variant="link"
          >
            {t('skin:font.retry')}
          </Button>
        </div>
      ) : selectedFontUnavailable ? (
        <p className="pl-27 text-xs text-muted-foreground" role="status">
          {t('skin:font.unavailableHint')}
        </p>
      ) : null}
    </div>
  )
}
