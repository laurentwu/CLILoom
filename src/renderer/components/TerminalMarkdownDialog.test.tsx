// @vitest-environment jsdom

import { act, type ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const editorState = vi.hoisted(() => ({
  currentMarkdown: '',
  getMarkdownReturnsUndefined: false,
  lastProps: null as Record<string, unknown> | null
}))

const dialogCloseEvents = vi.hoisted(() => [] as Array<{ preventDefault: () => void }>)

const pluginMocks = vi.hoisted(() => ({
  codeBlockPlugin: vi.fn((options?: unknown) => ({ name: 'codeBlock', options })),
  codeMirrorPlugin: vi.fn((options?: unknown) => ({ name: 'codeMirror', options })),
  diffSourcePlugin: vi.fn((options?: unknown) => ({ name: 'diffSource', options })),
  headingsPlugin: vi.fn(() => ({ name: 'headings' })),
  linkDialogPlugin: vi.fn((options?: unknown) => ({ name: 'linkDialog', options })),
  linkPlugin: vi.fn(() => ({ name: 'link' })),
  listsPlugin: vi.fn(() => ({ name: 'lists' })),
  markdownShortcutPlugin: vi.fn(() => ({ name: 'markdownShortcut' })),
  quotePlugin: vi.fn(() => ({ name: 'quote' })),
  tablePlugin: vi.fn(() => ({ name: 'table' })),
  thematicBreakPlugin: vi.fn(() => ({ name: 'thematicBreak' })),
  toolbarPlugin: vi.fn((options?: unknown) => ({ name: 'toolbar', options }))
}))

const terminalMarkdownPluginMock = vi.hoisted(() => (
  vi.fn(() => ({ name: 'terminalMarkdown' }))
))

vi.mock('@mdxeditor/editor', async () => {
  const React = await import('react')
  const passthrough = ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children)
  const empty = () => null
  const MDXEditor = React.forwardRef(function MockMDXEditor(
    props: Record<string, unknown>,
    ref: React.ForwardedRef<Record<string, () => unknown>>
  ) {
    const initialMarkdown = String(props.markdown ?? '')
    const [value, setValue] = React.useState(initialMarkdown)
    const initialized = React.useRef(false)
    if (!initialized.current) {
      editorState.currentMarkdown = initialMarkdown
      initialized.current = true
    }
    editorState.lastProps = props
    React.useImperativeHandle(ref, () => ({
      focus: vi.fn(),
      getContentEditableHTML: () => '',
      getMarkdown: () => editorState.getMarkdownReturnsUndefined ? undefined : editorState.currentMarkdown,
      getSelectionMarkdown: () => '',
      insertMarkdown: vi.fn(),
      setMarkdown: vi.fn()
    }))

    return React.createElement(
      'div',
      { 'data-testid': 'mock-mdx-editor' },
      React.createElement('textarea', {
        'aria-label': 'Markdown 内容',
        onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => {
          const nextValue = event.currentTarget.value
          const onChange = props.onChange as ((value: string) => void) | undefined
          editorState.currentMarkdown = nextValue
          setValue(nextValue)
          onChange?.(nextValue)
        },
        value
      }),
      React.createElement('a', { href: 'https://example.com' }, '文档链接'),
      React.createElement('button', {
        onClick: () => (props.onError as ((value: { error: string; source: string }) => void) | undefined)?.({
          error: 'invalid markdown',
          source: 'raw <broken> markdown'
        }),
        type: 'button'
      }, '触发解析错误')
    )
  })

  return {
    BlockTypeSelect: empty,
    BoldItalicUnderlineToggles: empty,
    ChangeCodeMirrorLanguage: empty,
    CodeToggle: empty,
    ConditionalContents: passthrough,
    CreateLink: empty,
    DiffSourceToggleWrapper: passthrough,
    InsertCodeBlock: empty,
    InsertTable: empty,
    InsertThematicBreak: empty,
    ListsToggle: empty,
    MDXEditor,
    Separator: empty,
    StrikeThroughSupSubToggles: empty,
    UndoRedo: empty,
    ...pluginMocks
  }
})

vi.mock('@/components/ui/dialog', async () => {
  const React = await import('react')
  return {
    Dialog: ({
      children,
      onOpenChange,
      open
    }: {
      children?: React.ReactNode
      onOpenChange?: (open: boolean) => void
      open?: boolean
    }) => React.createElement(
      'div',
      { 'data-open': String(Boolean(open)) },
      children,
      React.createElement('button', {
        'aria-label': '关闭浮层',
        onClick: () => onOpenChange?.(false),
        type: 'button'
      })
    ),
    DialogContent: ({
      children,
      onCloseAutoFocus
    }: {
      children?: React.ReactNode
      onCloseAutoFocus?: (event: { preventDefault: () => void }) => void
    }) => React.createElement(
      'div',
      { role: 'dialog' },
      children,
      React.createElement('button', {
        'aria-label': '完成关闭动画',
        onClick: () => {
          const event = { preventDefault: vi.fn() }
          dialogCloseEvents.push(event)
          onCloseAutoFocus?.(event)
        },
        type: 'button'
      })
    ),
    DialogDescription: ({ children }: { children?: React.ReactNode }) => React.createElement('p', null, children),
    DialogFooter: ({ children }: { children?: React.ReactNode }) => React.createElement('footer', null, children),
    DialogHeader: ({ children }: { children?: React.ReactNode }) => React.createElement('header', null, children),
    DialogTitle: ({ children }: { children?: React.ReactNode }) => React.createElement('h2', null, children)
  }
})

vi.mock('../terminalMarkdown', () => ({
  terminalMarkdownPlugin: terminalMarkdownPluginMock
}))

vi.mock('../clipboard', () => ({
  writeClipboardText: vi.fn()
}))

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn()
  }
}))

import { toast } from 'sonner'
import { writeClipboardText } from '../clipboard'
import { TerminalMarkdownDialog } from './TerminalMarkdownDialog'

const writeClipboardTextMock = vi.mocked(writeClipboardText)
const toastErrorMock = vi.mocked(toast.error)
const toastSuccessMock = vi.mocked(toast.success)

describe('TerminalMarkdownDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    editorState.currentMarkdown = ''
    editorState.getMarkdownReturnsUndefined = false
    editorState.lastProps = null
    dialogCloseEvents.length = 0
    writeClipboardTextMock.mockResolvedValue(undefined)
  })

  afterEach(cleanup)

  it('configures a local rich/source Markdown editor without HTML or remote resources', () => {
    render(<TerminalMarkdownDialog initialMarkdown="# Snapshot" onClose={vi.fn()} />)

    expect(screen.getByRole('dialog')).toBeTruthy()
    expect((screen.getByRole('textbox', { name: 'Markdown 内容' }) as HTMLTextAreaElement).value).toBe('# Snapshot')
    expect(editorState.lastProps).toMatchObject({
      markdown: '# Snapshot',
      spellCheck: false,
      suppressHtmlProcessing: true,
      trim: false
    })
    expect(pluginMocks.diffSourcePlugin).toHaveBeenCalledWith({ viewMode: 'rich-text' })
    expect(terminalMarkdownPluginMock).toHaveBeenCalledOnce()
    expect(pluginMocks.codeMirrorPlugin).toHaveBeenCalledWith(expect.objectContaining({
      autoLoadLanguageSupport: false
    }))
    expect(pluginMocks.linkDialogPlugin).toHaveBeenCalledWith(expect.objectContaining({
      onClickLinkCallback: expect.any(Function)
    }))
  })

  it('localizes interpolated labels and configures both toolbar contexts', () => {
    render(<TerminalMarkdownDialog initialMarkdown="content" onClose={vi.fn()} />)
    const translate = editorState.lastProps?.translation as (
      key: string,
      fallback: string,
      interpolations?: Record<string, string>
    ) => string
    expect(translate('toolbar.undo', 'Undo {{shortcut}}', { shortcut: 'Ctrl+Z' })).toBe('Undo Ctrl+Z')
    expect(translate('unknown', 'Fallback {{value}}', { value: 'label' })).toBe('Fallback label')

    const toolbarOptions = pluginMocks.toolbarPlugin.mock.calls[0]?.[0] as {
      toolbarContents: () => {
        props: {
          children: {
            props: {
              options: Array<{
                contents?: () => ReactNode
                fallback?: () => ReactNode
                when?: (editor: { editorType: string }) => boolean
              }>
            }
          }
        }
      }
    }
    const contexts = toolbarOptions.toolbarContents().props.children.props.options
    expect(contexts[0].when?.({ editorType: 'codeblock' })).toBe(true)
    expect(contexts[0].when?.({ editorType: 'root' })).toBe(false)
    render(<>{contexts[0].contents?.()}{contexts[1].fallback?.()}</>)
  })

  it('copies the edited Markdown rather than the opening snapshot', async () => {
    render(<TerminalMarkdownDialog initialMarkdown="# Before" onClose={vi.fn()} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Markdown 内容' }), {
      target: { value: '## After\n\ntrimmed' }
    })

    fireEvent.click(screen.getByRole('button', { name: 'Copy Markdown' }))

    await waitFor(() => expect(writeClipboardTextMock).toHaveBeenCalledWith('## After\n\ntrimmed'))
    expect(toastSuccessMock).toHaveBeenCalledWith('Copied Markdown')
    expect(toastErrorMock).not.toHaveBeenCalled()
  })

  it('reports clipboard failures without closing the editor', async () => {
    writeClipboardTextMock.mockRejectedValue(new Error('permission denied'))
    const onClose = vi.fn()
    render(<TerminalMarkdownDialog initialMarkdown="content" onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: 'Copy Markdown' }))

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith('Could not write to the system clipboard'))
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('preserves unparsable source for copying and guides the user to source view', async () => {
    render(<TerminalMarkdownDialog initialMarkdown="valid before error" onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '触发解析错误' }))

    expect(screen.getByText('Could not parse some content as rich text')).toBeTruthy()
    expect(screen.getByText(/Markdown source view/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Copy Markdown' }))

    await waitFor(() => expect(writeClipboardTextMock).toHaveBeenCalledWith('raw <broken> markdown'))
  })

  it('prevents links inside the editor from navigating the Electron page', () => {
    render(<TerminalMarkdownDialog initialMarkdown="[docs](https://example.com)" onClose={vi.fn()} />)
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })

    act(() => screen.getByRole('link', { name: '文档链接' }).dispatchEvent(click))

    expect(click.defaultPrevented).toBe(true)
  })

  it('supports explicit and overlay close paths', () => {
    const onClose = vi.fn()
    render(<TerminalMarkdownDialog initialMarkdown="content" onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    fireEvent.click(screen.getByRole('button', { name: '关闭浮层' }))

    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('restores the terminal focus after the dialog closes', () => {
    const onRestoreFocus = vi.fn()
    render(
      <TerminalMarkdownDialog
        initialMarkdown="content"
        onClose={vi.fn()}
        onRestoreFocus={onRestoreFocus}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '完成关闭动画' }))

    expect(onRestoreFocus).toHaveBeenCalledOnce()
    expect(dialogCloseEvents.at(-1)?.preventDefault).toHaveBeenCalled()
  })

  it('discards local edits when unmounted and accepts a fresh reopening snapshot', () => {
    const first = render(<TerminalMarkdownDialog initialMarkdown="first snapshot" onClose={vi.fn()} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Markdown 内容' }), {
      target: { value: 'temporary edit' }
    })
    first.unmount()

    render(<TerminalMarkdownDialog initialMarkdown="second snapshot" onClose={vi.fn()} />)

    expect((screen.getByRole('textbox', { name: 'Markdown 内容' }) as HTMLTextAreaElement).value).toBe('second snapshot')
  })

  it('stops the link dialog callback from triggering any page navigation', () => {
    render(<TerminalMarkdownDialog initialMarkdown="content" onClose={vi.fn()} />)
    const linkOptions = pluginMocks.linkDialogPlugin.mock.calls[0]?.[0] as { onClickLinkCallback: () => unknown }

    expect(linkOptions.onClickLinkCallback()).toBeUndefined()
  })

  it('falls back to the edited state when the editor ref is temporarily unavailable', async () => {
    editorState.getMarkdownReturnsUndefined = true
    render(<TerminalMarkdownDialog initialMarkdown="# Snapshot" onClose={vi.fn()} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Markdown 内容' }), {
      target: { value: '## Updated' }
    })

    fireEvent.click(screen.getByRole('button', { name: 'Copy Markdown' }))

    await waitFor(() => expect(writeClipboardTextMock).toHaveBeenCalledWith('## Updated'))
    expect(writeClipboardTextMock).not.toHaveBeenCalledWith('# Snapshot')
    expect(toastSuccessMock).toHaveBeenCalledWith('Copied Markdown')
  })

  it('closes without a focus-restore callback and does not prevent the default autofocus', () => {
    render(<TerminalMarkdownDialog initialMarkdown="content" onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '完成关闭动画' }))

    expect(dialogCloseEvents.at(-1)?.preventDefault).not.toHaveBeenCalled()
  })
})
