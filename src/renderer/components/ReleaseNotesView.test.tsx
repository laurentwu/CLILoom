// @vitest-environment jsdom

import { act } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { i18n } from '../i18n'

const editorState = vi.hoisted(() => ({
  lastProps: null as Record<string, unknown> | null,
  mountCount: 0
}))

const pluginMocks = vi.hoisted(() => ({
  codeBlockPlugin: vi.fn((options?: unknown) => ({ name: 'codeBlock', options })),
  codeMirrorPlugin: vi.fn((options?: unknown) => ({ name: 'codeMirror', options })),
  headingsPlugin: vi.fn(() => ({ name: 'headings' })),
  linkPlugin: vi.fn(() => ({ name: 'link' })),
  listsPlugin: vi.fn(() => ({ name: 'lists' })),
  quotePlugin: vi.fn(() => ({ name: 'quote' })),
  tablePlugin: vi.fn(() => ({ name: 'table' })),
  thematicBreakPlugin: vi.fn(() => ({ name: 'thematicBreak' }))
}))

const terminalMarkdownPluginMock = vi.hoisted(() => vi.fn(() => ({ name: 'terminalMarkdown' })))

vi.mock('@mdxeditor/editor', async () => {
  const React = await import('react')
  const MDXEditor = (props: Record<string, unknown>) => {
    React.useEffect(() => {
      editorState.mountCount += 1
    }, [])
    editorState.lastProps = props
    return React.createElement(
      'div',
      { 'data-testid': 'mock-mdx-editor' },
      React.createElement('a', { href: 'https://github.com/laurentwu/CLILoom' }, 'release link'),
      React.createElement('button', {
        onClick: () => (props.onError as ((value: { error: string; source: string }) => void) | undefined)?.({
          error: 'invalid markdown',
          source: 'raw <broken> notes'
        }),
        type: 'button'
      }, '触发解析错误')
    )
  }
  return { MDXEditor, ...pluginMocks }
})

vi.mock('../terminalMarkdown', () => ({
  terminalMarkdownPlugin: terminalMarkdownPluginMock
}))

import { ReleaseNotesView } from './ReleaseNotesView'

describe('ReleaseNotesView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    editorState.lastProps = null
    editorState.mountCount = 0
  })

  afterEach(async () => {
    cleanup()
    await i18n.changeLanguage('en')
  })

  it('renders release notes as read-only markdown without HTML processing', () => {
    render(<ReleaseNotesView markdown={"## What's Changed"} />)

    expect(screen.getByTestId('mock-mdx-editor')).toBeTruthy()
    expect(editorState.lastProps).toMatchObject({
      markdown: "## What's Changed",
      readOnly: true,
      spellCheck: false,
      suppressHtmlProcessing: true,
      trim: false
    })
    expect(terminalMarkdownPluginMock).toHaveBeenCalledOnce()
    expect(pluginMocks.headingsPlugin).toHaveBeenCalledOnce()
    expect(pluginMocks.listsPlugin).toHaveBeenCalledOnce()
    expect(pluginMocks.quotePlugin).toHaveBeenCalledOnce()
    expect(pluginMocks.thematicBreakPlugin).toHaveBeenCalledOnce()
    expect(pluginMocks.linkPlugin).toHaveBeenCalledOnce()
    expect(pluginMocks.tablePlugin).toHaveBeenCalledOnce()
    expect(pluginMocks.codeBlockPlugin).toHaveBeenCalledWith({ defaultCodeBlockLanguage: '' })
    expect(pluginMocks.codeMirrorPlugin).toHaveBeenCalledWith(expect.objectContaining({
      autoLoadLanguageSupport: false
    }))
  })

  it('converts atom-feed HTML notes into markdown before rendering', () => {
    render(<ReleaseNotesView markdown={'<p dir="auto">hello <strong>world</strong></p>'} />)

    expect(editorState.lastProps).toMatchObject({
      markdown: 'hello **world**'
    })
  })

  it('localizes the read-only content area label', async () => {
    await i18n.changeLanguage('zh')
    render(<ReleaseNotesView markdown="content" />)
    const translate = editorState.lastProps?.translation as (
      key: string,
      fallback: string,
      interpolations?: Record<string, string>
    ) => string

    expect(translate('contentArea.editableMarkdown', 'editable markdown')).toBe('版本说明')
    expect(translate('unknown', 'Fallback {{value}}', { value: 'label' })).toBe('Fallback label')

    await i18n.changeLanguage('en')
    expect(translate('contentArea.editableMarkdown', 'editable markdown')).toBe('Release notes')
  })

  it('remounts the editor when the release notes change', () => {
    const view = render(<ReleaseNotesView markdown="first" />)
    expect(editorState.mountCount).toBe(1)

    view.rerender(<ReleaseNotesView markdown="second" />)
    expect(editorState.mountCount).toBe(2)
    expect(editorState.lastProps).toMatchObject({ markdown: 'second' })
  })

  it('prevents release-note links from navigating the Electron page', () => {
    render(<ReleaseNotesView markdown="[docs](https://example.com)" />)
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })

    act(() => screen.getByRole('link', { name: 'release link' }).dispatchEvent(click))

    expect(click.defaultPrevented).toBe(true)
  })

  it('falls back to wrapping plain text when the markdown cannot be parsed', () => {
    render(<ReleaseNotesView markdown="broken notes" />)
    fireEvent.click(screen.getByRole('button', { name: '触发解析错误' }))

    const fallback = screen.getByText('raw <broken> notes')
    expect(fallback.tagName).toBe('P')
    expect(fallback.className).toContain('whitespace-pre-wrap')
    expect(fallback.className).toContain('break-words')
    expect(fallback.className).toContain('[overflow-wrap:anywhere]')
    expect(screen.queryByTestId('mock-mdx-editor')).toBeNull()
  })

  it('recovers the rendered view once the markdown changes after a parse failure', () => {
    const view = render(<ReleaseNotesView markdown="first" />)
    fireEvent.click(screen.getByRole('button', { name: '触发解析错误' }))
    expect(screen.getByText('raw <broken> notes')).toBeTruthy()

    view.rerender(<ReleaseNotesView markdown="second" />)

    expect(screen.getByTestId('mock-mdx-editor')).toBeTruthy()
    expect(screen.queryByText('raw <broken> notes')).toBeNull()
    expect(editorState.lastProps).toMatchObject({ markdown: 'second' })
  })
})
