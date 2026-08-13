// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { i18n } from '../i18n'
import { DEFAULT_SKIN } from '../theme'
import type { SkinContent, UserSkin } from '../../shared/skin'
import { AppearancePanel } from './AppearancePanel'

vi.mock('@/components/ui/dialog', async () => {
  const React = await import('react')
  const Container = ({
    children,
    open,
    onOpenChange
  }: {
    children?: React.ReactNode
    open?: boolean
    onOpenChange?: (open: boolean) => void
  }) => open
    ? React.createElement(
        'div',
        null,
        children,
        React.createElement(
          'button',
          { 'aria-label': 'Close appearance panel', onClick: () => onOpenChange?.(false), type: 'button' },
          'Close'
        )
      )
    : null
  return {
    Dialog: Container,
    DialogContent: ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children),
    DialogDescription: () => null,
    DialogHeader: ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children),
    DialogTitle: ({ children }: { children?: React.ReactNode }) => React.createElement('h2', null, children)
  }
})

vi.mock('@/components/ui/alert-dialog', async () => {
  const React = await import('react')
  type DialogContextValue = { onOpenChange?: (open: boolean) => void }
  const DialogContext = React.createContext<DialogContextValue>({})
  const Container = ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children)
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
    AlertDialogFooter: Container,
    AlertDialogHeader: Container,
    AlertDialogMedia: Container,
    AlertDialogTitle: ({ children }: { children?: React.ReactNode }) => React.createElement('h2', null, children)
  }
})

vi.mock('@/components/ui/color-picker', () => {
  const React = require('react')
  return {
    ColorPicker: ({ value, onChange, label }: { value: string; onChange: (v: string) => void; label?: string }) =>
      React.createElement('input', { 'aria-label': label, onChange: (e: { target: { value: string } }) => onChange(e.target.value), type: 'text', value })
  }
})

vi.mock('@/components/ui/slider', () => {
  const React = require('react')
  return {
    Slider: ({ value, onValueChange }: { value: number[]; onValueChange: (v: number[]) => void }) =>
      React.createElement('input', {
        onChange: (e: { target: { value: string } }) => onValueChange([Number(e.target.value)]),
        type: 'range',
        value: value?.[0] ?? 0
      })
  }
})

function makeUserSkin(overrides: Partial<UserSkin> = {}): UserSkin {
  return {
    ...DEFAULT_SKIN,
    id: 'user.test-skin',
    builtin: false,
    name: 'Test skin',
    ...overrides
  } as UserSkin
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

function setupApi(overrides: Record<string, ReturnType<typeof vi.fn>> = {}) {
  const api = {
    createSkin: vi.fn(async (_name: string, content: SkinContent) =>
      makeUserSkin({ id: 'user.created', ...content })),
    updateUserSkin: vi.fn(async (id: string, content: SkinContent) =>
      makeUserSkin({ id, ...content })),
    renameSkin: vi.fn(async (id: string, name: string) => makeUserSkin({ id, name })),
    deleteSkin: vi.fn(async () => undefined),
    duplicateSkin: vi.fn(async () => makeUserSkin({ id: 'user.copy', name: 'Test skin copy' })),
    exportSkin: vi.fn(async () => ({ canceled: false, path: '/tmp/x.json' })),
    importSkin: vi.fn(async () => ({ canceled: true })),
    getInstalledFontFamilies: vi.fn(async () => ['B&B Mono', 'Fira Code', 'Iosevka Term']),
    setActiveSkin: vi.fn(async (id: string) => id),
    ...overrides
  }
  Object.defineProperty(window, 'cliLoom', { configurable: true, value: api, writable: true })
  return api
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
})

describe('AppearancePanel', () => {
  beforeEach(() => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    })
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn()
    })
  })

  it('keeps a new skin in memory until it is saved', async () => {
    const api = setupApi()
    render(<I18nextProvider i18n={i18n}><AppearancePanel
      open
      onOpenChange={() => undefined}
      activeSkin={DEFAULT_SKIN}
      activeSkinId="builtin.light.neutral"
      userSkins={[]}
    /></I18nextProvider>)

    expect(screen.getByText('No custom themes yet.')).toBeTruthy()

    await act(async () => {
      fireEvent.click(screen.getByText('New theme'))
    })

    expect(api.createSkin).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Theme name')).toHaveProperty('value', 'New theme')
    expect(screen.getByText('No custom themes yet.')).toBeTruthy()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    })

    expect(api.createSkin).toHaveBeenCalledWith(
      'New theme',
      expect.objectContaining({ mode: 'light' })
    )
    expect(api.renameSkin).not.toHaveBeenCalled()
    expect(api.updateUserSkin).not.toHaveBeenCalled()
  })

  it('submits a pending new skin only once', async () => {
    const pending = deferred<UserSkin>()
    const api = setupApi({ createSkin: vi.fn(() => pending.promise) })
    render(<I18nextProvider i18n={i18n}><AppearancePanel
      open
      onOpenChange={() => undefined}
      activeSkin={DEFAULT_SKIN}
      activeSkinId="builtin.light.neutral"
      userSkins={[]}
    /></I18nextProvider>)

    await act(async () => {
      fireEvent.click(screen.getByText('New theme'))
    })
    const saveButton = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement
    act(() => {
      fireEvent.click(saveButton)
      fireEvent.click(saveButton)
    })

    expect(api.createSkin).toHaveBeenCalledOnce()
    expect(saveButton.disabled).toBe(true)

    await act(async () => {
      pending.resolve(makeUserSkin({ id: 'user.created' }))
      await pending.promise
    })
  })

  it('ignores a pending create result after switching skins', async () => {
    const pending = deferred<UserSkin>()
    const api = setupApi({ createSkin: vi.fn(() => pending.promise) })
    render(<I18nextProvider i18n={i18n}><AppearancePanel
      open
      onOpenChange={() => undefined}
      activeSkin={DEFAULT_SKIN}
      activeSkinId="builtin.light.neutral"
      userSkins={[]}
    /></I18nextProvider>)

    await act(async () => {
      fireEvent.click(screen.getByText('New theme'))
    })
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    })
    await act(async () => {
      fireEvent.click(screen.getByText('Neutral dark'))
    })

    await act(async () => {
      pending.resolve(makeUserSkin({ id: 'user.late' }))
      await pending.promise
    })

    expect(api.createSkin).toHaveBeenCalledOnce()
    expect(screen.queryByLabelText('Theme name')).toBeNull()
    expect(document.documentElement.dataset.skinId).toBe('builtin.dark.neutral')
  })

  it('ignores a pending create result after closing the panel', async () => {
    const pending = deferred<UserSkin>()
    const api = setupApi({ createSkin: vi.fn(() => pending.promise) })

    function Harness() {
      const [open, setOpen] = useState(true)
      return <AppearancePanel
        open={open}
        onOpenChange={setOpen}
        activeSkin={DEFAULT_SKIN}
        activeSkinId="builtin.light.neutral"
        userSkins={[]}
      />
    }

    render(<I18nextProvider i18n={i18n}><Harness /></I18nextProvider>)
    await act(async () => {
      fireEvent.click(screen.getByText('New theme'))
    })
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Close appearance panel' }))
    })

    await act(async () => {
      pending.resolve(makeUserSkin({ id: 'user.late' }))
      await pending.promise
    })

    expect(api.createSkin).toHaveBeenCalledOnce()
    expect(screen.queryByLabelText('Theme name')).toBeNull()
    expect(document.documentElement.dataset.skinId).toBe(DEFAULT_SKIN.id)
  })

  it('keeps a new skin draft available after creation fails', async () => {
    const api = setupApi({
      createSkin: vi.fn(async () => { throw new Error('create failed') })
    })
    render(<I18nextProvider i18n={i18n}><AppearancePanel
      open
      onOpenChange={() => undefined}
      activeSkin={DEFAULT_SKIN}
      activeSkinId="builtin.light.neutral"
      userSkins={[]}
    /></I18nextProvider>)

    await act(async () => {
      fireEvent.click(screen.getByText('New theme'))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    })

    expect(api.createSkin).toHaveBeenCalledOnce()
    expect(screen.getByText('create failed')).toBeTruthy()
    expect(screen.getByLabelText('Theme name')).toHaveProperty('value', 'New theme')
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('keeps a duplicated skin selected until its settings broadcast arrives', async () => {
    const copy = makeUserSkin({ id: 'user.copy', name: 'Copied skin' })
    const api = setupApi({ duplicateSkin: vi.fn(async () => copy) })
    const panel = (userSkins: UserSkin[]) => <I18nextProvider i18n={i18n}><AppearancePanel
      open
      onOpenChange={() => undefined}
      activeSkin={DEFAULT_SKIN}
      activeSkinId="builtin.light.neutral"
      userSkins={userSkins}
    /></I18nextProvider>
    const { rerender } = render(panel([]))

    await act(async () => {
      fireEvent.click(screen.getByText('Duplicate to edit'))
    })

    expect(api.duplicateSkin).toHaveBeenCalledWith(DEFAULT_SKIN.id)
    expect(screen.getByLabelText('Theme name')).toHaveProperty('value', copy.name)

    await act(async () => {
      rerender(panel([copy]))
    })
    expect(screen.getByLabelText('Theme name')).toHaveProperty('value', copy.name)

    await act(async () => {
      rerender(panel([]))
    })
    expect(screen.queryByLabelText('Theme name')).toBeNull()
  })

  it('keeps an imported skin selected until its settings broadcast arrives', async () => {
    const imported = makeUserSkin({ id: 'user.imported', name: 'Imported skin' })
    const api = setupApi({
      importSkin: vi.fn(async () => ({ canceled: false as const, skin: imported }))
    })
    const panel = (userSkins: UserSkin[]) => <I18nextProvider i18n={i18n}><AppearancePanel
      open
      onOpenChange={() => undefined}
      activeSkin={DEFAULT_SKIN}
      activeSkinId="builtin.light.neutral"
      userSkins={userSkins}
    /></I18nextProvider>
    const { rerender } = render(panel([]))

    await act(async () => {
      fireEvent.click(screen.getByText('Import…'))
    })

    expect(api.importSkin).toHaveBeenCalledOnce()
    expect(screen.getByLabelText('Theme name')).toHaveProperty('value', imported.name)

    await act(async () => {
      rerender(panel([imported]))
    })
    expect(screen.getByLabelText('Theme name')).toHaveProperty('value', imported.name)

    await act(async () => {
      rerender(panel([]))
    })
    expect(screen.queryByLabelText('Theme name')).toBeNull()
  })

  it('discards an unsaved new skin without creating it', async () => {
    const api = setupApi()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<I18nextProvider i18n={i18n}><AppearancePanel
      open
      onOpenChange={() => undefined}
      activeSkin={DEFAULT_SKIN}
      activeSkinId="builtin.light.neutral"
      userSkins={[]}
    /></I18nextProvider>)

    await act(async () => {
      fireEvent.click(screen.getByText('New theme'))
    })
    await act(async () => {
      fireEvent.click(screen.getByText('Neutral light'))
    })

    expect(confirmSpy).toHaveBeenCalled()
    expect(api.createSkin).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('Theme name')).toBeNull()
  })

  it('renders a custom skin icon from its gradient background', () => {
    setupApi()
    const background = {
      kind: 'gradient' as const,
      stops: ['#112233', '#445566'],
      angle: 45
    }
    const skin = makeUserSkin({ background })
    render(<I18nextProvider i18n={i18n}><AppearancePanel
      open
      onOpenChange={() => undefined}
      activeSkin={skin}
      activeSkinId={skin.id}
      userSkins={[skin]}
    /></I18nextProvider>)

    const labels = screen.getAllByText('Test skin')
    expect(labels).toHaveLength(2)
    for (const label of labels) {
      const iconBackground = (label.previousElementSibling as HTMLElement).style.background
      expect(iconBackground).toContain('linear-gradient(45deg')
      expect(iconBackground).toContain('rgb(17, 34, 51)')
      expect(iconBackground).toContain('rgb(68, 85, 102)')
    }
  })

  it('distinguishes applying a theme from saving theme edits', () => {
    const api = setupApi()
    const skin = makeUserSkin()
    render(<I18nextProvider i18n={i18n}><AppearancePanel
      open
      onOpenChange={() => undefined}
      activeSkin={DEFAULT_SKIN}
      activeSkinId={DEFAULT_SKIN.id}
      userSkins={[skin]}
    /></I18nextProvider>)

    fireEvent.click(screen.getByRole('button', { name: skin.name }))

    expect(screen.getByRole('button', { name: 'Apply theme' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Apply theme' }))
    expect(api.setActiveSkin).toHaveBeenCalledWith(skin.id)
  })

  it('saves content and rename through the save button', async () => {
    const api = setupApi()
    const skin = makeUserSkin()
    render(<I18nextProvider i18n={i18n}><AppearancePanel
      open
      onOpenChange={() => undefined}
      activeSkin={DEFAULT_SKIN}
      activeSkinId={skin.id}
      userSkins={[skin]}
    /></I18nextProvider>)

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Theme name'), { target: { value: 'Renamed' } })
    })
    await act(async () => {
      fireEvent.click(screen.getByText('Save'))
    })

    expect(api.renameSkin).toHaveBeenCalledWith(skin.id, 'Renamed')
    expect(api.updateUserSkin).toHaveBeenCalledWith(skin.id, expect.objectContaining({ mode: 'light' }))
  })

  it('searches installed fonts with punctuation, previews the selection and saves it', async () => {
    const api = setupApi()
    const skin = makeUserSkin()
    render(<I18nextProvider i18n={i18n}><AppearancePanel
      open
      onOpenChange={() => undefined}
      activeSkin={DEFAULT_SKIN}
      activeSkinId={skin.id}
      userSkins={[skin]}
    /></I18nextProvider>)

    await act(async () => {
      fireEvent.click(screen.getByRole('combobox', { name: 'Font family' }))
    })
    expect(api.getInstalledFontFamilies).toHaveBeenCalledOnce()

    fireEvent.change(screen.getByPlaceholderText('Search installed fonts'), {
      target: { value: 'B&B' }
    })
    expect(screen.getByText('B&B Mono')).toBeTruthy()
    expect(screen.queryByText('Iosevka Term')).toBeNull()

    fireEvent.click(screen.getByText('B&B Mono'))

    expect(document.documentElement.style.getPropertyValue('--font-code')).toContain("'B&B Mono'")

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    })

    expect(api.updateUserSkin).toHaveBeenCalledWith(
      skin.id,
      expect.objectContaining({
        typography: expect.objectContaining({ codeFontFamily: 'B&B Mono' })
      })
    )
  })

  it('uses typed text only to search and does not save an arbitrary font name', async () => {
    const api = setupApi()
    const skin = makeUserSkin()
    render(<I18nextProvider i18n={i18n}><AppearancePanel
      open
      onOpenChange={() => undefined}
      activeSkin={DEFAULT_SKIN}
      activeSkinId={skin.id}
      userSkins={[skin]}
    /></I18nextProvider>)

    await act(async () => {
      fireEvent.click(screen.getByRole('combobox', { name: 'Font family' }))
    })
    fireEvent.change(screen.getByPlaceholderText('Search installed fonts'), {
      target: { value: 'Invented Font' }
    })

    expect(screen.getByText('No matching fonts found')).toBeTruthy()
    expect(document.documentElement.style.getPropertyValue('--font-code')).not.toContain('Invented Font')
    expect(api.updateUserSkin).not.toHaveBeenCalled()
    expect(screen.queryByText('System monospace')).toBeNull()
  })

  it('marks a saved font as unavailable without replacing the theme value', async () => {
    const api = setupApi({
      getInstalledFontFamilies: vi.fn(async () => ['Fira Code'])
    })
    const skin = makeUserSkin({
      typography: { ...DEFAULT_SKIN.typography, codeFontFamily: 'Missing Mono' }
    })
    render(<I18nextProvider i18n={i18n}><AppearancePanel
      open
      onOpenChange={() => undefined}
      activeSkin={DEFAULT_SKIN}
      activeSkinId={skin.id}
      userSkins={[skin]}
    /></I18nextProvider>)

    await act(async () => {
      fireEvent.click(screen.getByRole('combobox', { name: 'Font family' }))
    })

    expect(screen.getByRole('combobox', { name: 'Font family' }).textContent)
      .toContain('Not installed: Missing Mono')
    expect(screen.getByText(
      'The selected font is not installed. JetBrains Mono is being used as the fallback.'
    )).toBeTruthy()
    expect(api.updateUserSkin).not.toHaveBeenCalled()
  })

  it('does not mark a legacy CSS generic font as unavailable or restore its preset', async () => {
    const api = setupApi({
      getInstalledFontFamilies: vi.fn(async () => ['Fira Code'])
    })
    const skin = makeUserSkin({
      typography: { ...DEFAULT_SKIN.typography, codeFontFamily: 'ui-monospace' }
    })
    render(<I18nextProvider i18n={i18n}><AppearancePanel
      open
      onOpenChange={() => undefined}
      activeSkin={DEFAULT_SKIN}
      activeSkinId={skin.id}
      userSkins={[skin]}
    /></I18nextProvider>)

    await act(async () => {
      fireEvent.click(screen.getByRole('combobox', { name: 'Font family' }))
    })

    expect(screen.getByRole('combobox', { name: 'Font family' }).textContent)
      .toBe('ui-monospace')
    expect(screen.queryByText(
      'The selected font is not installed. JetBrains Mono is being used as the fallback.'
    )).toBeNull()
    expect(screen.queryByText('System monospace')).toBeNull()
    expect(api.updateUserSkin).not.toHaveBeenCalled()
  })

  it('retries loading installed fonts after a failure', async () => {
    const getInstalledFontFamilies = vi.fn()
      .mockRejectedValueOnce(new Error('font enumeration failed'))
      .mockResolvedValueOnce(['Retry Mono'])
    const api = setupApi({ getInstalledFontFamilies })
    const skin = makeUserSkin()
    render(<I18nextProvider i18n={i18n}><AppearancePanel
      open
      onOpenChange={() => undefined}
      activeSkin={DEFAULT_SKIN}
      activeSkinId={skin.id}
      userSkins={[skin]}
    /></I18nextProvider>)

    await act(async () => {
      fireEvent.click(screen.getByRole('combobox', { name: 'Font family' }))
    })

    expect(screen.getByText('Could not load system fonts.')).toBeTruthy()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    })

    expect(screen.queryByText('Could not load system fonts.')).toBeNull()
    expect(screen.getByText('Retry Mono')).toBeTruthy()
    expect(api.getInstalledFontFamilies).toHaveBeenCalledTimes(2)
  })

  it('blocks saving and reports an error when the name is empty', async () => {
    const api = setupApi()
    const skin = makeUserSkin()
    render(<I18nextProvider i18n={i18n}><AppearancePanel
      open
      onOpenChange={() => undefined}
      activeSkin={DEFAULT_SKIN}
      activeSkinId={skin.id}
      userSkins={[skin]}
    /></I18nextProvider>)

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Theme name'), { target: { value: '   ' } })
    })
    await act(async () => {
      fireEvent.click(screen.getByText('Save'))
    })

    expect(api.updateUserSkin).not.toHaveBeenCalled()
    expect(screen.getByText('Theme name is required')).toBeTruthy()
  })

  it('asks for confirmation before discarding dirty edits when switching skins', async () => {
    setupApi()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const skin = makeUserSkin()
    render(<I18nextProvider i18n={i18n}><AppearancePanel
      open
      onOpenChange={() => undefined}
      activeSkin={DEFAULT_SKIN}
      activeSkinId={skin.id}
      userSkins={[skin]}
    /></I18nextProvider>)

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Theme name'), { target: { value: 'dirty' } })
    })
    await act(async () => {
      fireEvent.click(screen.getByText('Neutral light'))
    })

    expect(confirmSpy).toHaveBeenCalled()
  })

  it('does not delete the selected user skin before confirmation', async () => {
    const api = setupApi()
    const skin = makeUserSkin()
    render(<I18nextProvider i18n={i18n}><AppearancePanel
      open
      onOpenChange={() => undefined}
      activeSkin={DEFAULT_SKIN}
      activeSkinId={skin.id}
      userSkins={[skin]}
    /></I18nextProvider>)

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    expect(api.deleteSkin).not.toHaveBeenCalled()
    expect(screen.getByText('Delete theme "Test skin"?')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(api.deleteSkin).not.toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('uses only the delete dialog when the selected skin has dirty edits', () => {
    const api = setupApi()
    const confirmSpy = vi.mocked(window.confirm)
    const skin = makeUserSkin()
    render(<I18nextProvider i18n={i18n}><AppearancePanel
      open
      onOpenChange={() => undefined}
      activeSkin={DEFAULT_SKIN}
      activeSkinId={skin.id}
      userSkins={[skin]}
    /></I18nextProvider>)

    fireEvent.change(screen.getByLabelText('Theme name'), { target: { value: 'Dirty skin' } })
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(api.deleteSkin).not.toHaveBeenCalled()
    expect(screen.getByText('Delete theme "Test skin"?')).toBeTruthy()
  })

  it('deletes the selected user skin after confirmation', async () => {
    const api = setupApi()
    const skin = makeUserSkin()
    render(<I18nextProvider i18n={i18n}><AppearancePanel
      open
      onOpenChange={() => undefined}
      activeSkin={DEFAULT_SKIN}
      activeSkinId={skin.id}
      userSkins={[skin]}
    /></I18nextProvider>)

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete theme' }))
    })

    expect(api.deleteSkin).toHaveBeenCalledWith(skin.id)
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('reports an error and closes the dialog when deleting the selected user skin fails', async () => {
    const api = setupApi({
      deleteSkin: vi.fn(async () => { throw new Error('delete failed') })
    })
    const skin = makeUserSkin()
    render(<I18nextProvider i18n={i18n}><AppearancePanel
      open
      onOpenChange={() => undefined}
      activeSkin={DEFAULT_SKIN}
      activeSkinId={skin.id}
      userSkins={[skin]}
    /></I18nextProvider>)

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete theme' }))
    })

    expect(api.deleteSkin).toHaveBeenCalledWith(skin.id)
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.getByText('delete failed')).toBeTruthy()
  })

  it('rolls back the preview when saving fails', async () => {
    const api = setupApi({
      updateUserSkin: vi.fn(async () => { throw new Error('save failed') })
    })
    const skin = makeUserSkin()
    render(<I18nextProvider i18n={i18n}><AppearancePanel
      open
      onOpenChange={() => undefined}
      activeSkin={DEFAULT_SKIN}
      activeSkinId={skin.id}
      userSkins={[skin]}
    /></I18nextProvider>)

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Theme name'), { target: { value: 'Edited' } })
    })
    await act(async () => {
      fireEvent.click(screen.getByText('Save'))
    })

    expect(api.updateUserSkin).toHaveBeenCalled()
    expect(screen.getByText('save failed')).toBeTruthy()
  })
})
