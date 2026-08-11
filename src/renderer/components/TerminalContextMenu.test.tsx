// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const contextMenuCloseEvents = vi.hoisted(() => [] as Array<{ preventDefault: () => void }>)

vi.mock('@/components/ui/context-menu', async () => {
  const React = await import('react')
  const passthrough = ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children)
  return {
    ContextMenu: passthrough,
    ContextMenuContent: ({
      children,
      onCloseAutoFocus
    }: {
      children?: React.ReactNode
      onCloseAutoFocus?: (event: { preventDefault: () => void }) => void
    }) => React.createElement(
      'div',
      null,
      children,
      React.createElement('button', {
        'aria-label': '关闭菜单',
        onClick: () => {
          const event = { preventDefault: vi.fn() }
          contextMenuCloseEvents.push(event)
          onCloseAutoFocus?.(event)
        },
        type: 'button'
      })
    ),
    ContextMenuItem: ({
      children,
      onSelect
    }: {
      children?: React.ReactNode
      onSelect?: () => void
    }) => React.createElement('button', { onClick: onSelect, type: 'button' }, children),
    ContextMenuSeparator: () => React.createElement('hr'),
    ContextMenuTrigger: passthrough
  }
})

vi.mock('../clipboard', () => ({
  readClipboardText: vi.fn(),
  writeClipboardText: vi.fn()
}))

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn()
  }
}))

import { toast } from 'sonner'
import { readClipboardText, writeClipboardText } from '../clipboard'
import { i18n } from '../i18n'
import type { TerminalTextSnapshot } from '../terminalText'
import { TerminalContextMenu } from './TerminalContextMenu'

const readClipboardTextMock = vi.mocked(readClipboardText)
const writeClipboardTextMock = vi.mocked(writeClipboardText)
const toastErrorMock = vi.mocked(toast.error)
const toastSuccessMock = vi.mocked(toast.success)

function renderMenu(options: {
  canPaste?: boolean
  getText?: () => TerminalTextSnapshot
  onPaste?: (text: string) => boolean
  onShowMarkdown?: (text: string) => void
} = {}) {
  const {
    canPaste = true,
    getText = () => ({ source: 'all', text: 'terminal output' }),
    onPaste = vi.fn(() => true),
    onShowMarkdown = vi.fn()
  } = options
  render(
    <I18nextProvider i18n={i18n}>
      <TerminalContextMenu
        canPaste={canPaste}
        getText={getText}
        onPaste={onPaste}
        onShowMarkdown={onShowMarkdown}
      >
        <div>terminal</div>
      </TerminalContextMenu>
    </I18nextProvider>
  )
  return { onPaste, onShowMarkdown }
}

describe('TerminalContextMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    contextMenuCloseEvents.length = 0
    readClipboardTextMock.mockResolvedValue('clipboard input')
    writeClipboardTextMock.mockResolvedValue(undefined)
  })

  afterEach(cleanup)

  it('shows all actions only for an input-ready terminal', () => {
    const { unmount } = render(
      <I18nextProvider i18n={i18n}>
        <TerminalContextMenu
          canPaste
          getText={() => ({ source: 'all', text: 'output' })}
          onPaste={() => true}
          onShowMarkdown={vi.fn()}
        >
          <div>terminal</div>
        </TerminalContextMenu>
      </I18nextProvider>
    )

    expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Paste' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Show in rich text editor' })).toBeTruthy()

    unmount()
    renderMenu({ canPaste: false })
    expect(screen.queryByRole('button', { name: 'Paste' })).toBeNull()
  })

  it.each([
    ['selection', 'selected text', 'Copied selected text'],
    ['all', 'all output', 'Copied terminal content']
  ] as const)('copies the %s snapshot and reports success', async (source, text, message) => {
    renderMenu({ getText: () => ({ source, text }) })

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))

    await waitFor(() => expect(writeClipboardTextMock).toHaveBeenCalledWith(text))
    expect(toastSuccessMock).toHaveBeenCalledWith(message)
    expect(toastErrorMock).not.toHaveBeenCalled()
  })

  it('reports clipboard write failures without losing the selected snapshot', async () => {
    writeClipboardTextMock.mockRejectedValue(new Error('permission denied'))
    const getText = vi.fn(() => ({ source: 'selection' as const, text: 'keep me' }))
    renderMenu({ getText })

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith('Could not write to the system clipboard'))
    expect(getText).toHaveBeenCalledOnce()
    expect(writeClipboardTextMock).toHaveBeenCalledWith('keep me')
    expect(toastSuccessMock).not.toHaveBeenCalled()
  })

  it('reads and forwards non-empty clipboard text to the terminal', async () => {
    const onPaste = vi.fn(() => true)
    renderMenu({ onPaste })

    fireEvent.click(screen.getByRole('button', { name: 'Paste' }))

    await waitFor(() => expect(onPaste).toHaveBeenCalledWith('clipboard input'))
    expect(toastErrorMock).not.toHaveBeenCalled()
  })

  it('does not send an empty clipboard value', async () => {
    readClipboardTextMock.mockResolvedValue('')
    const onPaste = vi.fn(() => true)
    renderMenu({ onPaste })

    fireEvent.click(screen.getByRole('button', { name: 'Paste' }))

    await waitFor(() => expect(readClipboardTextMock).toHaveBeenCalledOnce())
    expect(onPaste).not.toHaveBeenCalled()
    expect(toastErrorMock).not.toHaveBeenCalled()
  })

  it('reports clipboard read failures and never sends partial input', async () => {
    readClipboardTextMock.mockRejectedValue(new Error('permission denied'))
    const onPaste = vi.fn(() => true)
    renderMenu({ onPaste })

    fireEvent.click(screen.getByRole('button', { name: 'Paste' }))

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith('Could not read the system clipboard'))
    expect(onPaste).not.toHaveBeenCalled()
  })

  it('reports when readiness changes before clipboard text reaches xterm', async () => {
    const onPaste = vi.fn(() => false)
    renderMenu({ onPaste })

    fireEvent.click(screen.getByRole('button', { name: 'Paste' }))

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith('The terminal is not accepting input right now'))
    expect(onPaste).toHaveBeenCalledWith('clipboard input')
  })

  it('takes a fresh snapshot when opening the Markdown editor', async () => {
    const getText = vi.fn(() => ({ source: 'selection' as const, text: 'latest selection' }))
    const onShowMarkdown = vi.fn()
    renderMenu({ getText, onShowMarkdown })

    fireEvent.click(screen.getByRole('button', { name: 'Show in rich text editor' }))

    expect(getText).toHaveBeenCalledOnce()
    expect(onShowMarkdown).toHaveBeenCalledWith('latest selection')
  })

  it('restores terminal focus when the menu closes', () => {
    const onRestoreFocus = vi.fn()
    render(
      <I18nextProvider i18n={i18n}>
        <TerminalContextMenu
          getText={() => ({ source: 'all', text: 'output' })}
          onRestoreFocus={onRestoreFocus}
          onShowMarkdown={vi.fn()}
        >
          <div>terminal</div>
        </TerminalContextMenu>
      </I18nextProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: '关闭菜单' }))

    expect(onRestoreFocus).toHaveBeenCalledOnce()
    expect(contextMenuCloseEvents.at(-1)?.preventDefault).toHaveBeenCalled()
  })

  it('closes without a focus-restore callback and does not prevent the default autofocus', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <TerminalContextMenu
          getText={() => ({ source: 'all', text: 'output' })}
          onShowMarkdown={vi.fn()}
        >
          <div>terminal</div>
        </TerminalContextMenu>
      </I18nextProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: '关闭菜单' }))

    expect(contextMenuCloseEvents.at(-1)?.preventDefault).not.toHaveBeenCalled()
  })
})
