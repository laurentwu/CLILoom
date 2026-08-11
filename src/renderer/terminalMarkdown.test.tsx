// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MDXEditor } from '@mdxeditor/editor'
import { terminalMarkdownPlugin } from './terminalMarkdown'

describe('terminalMarkdownPlugin', () => {
  afterEach(cleanup)

  it('imports angle-bracket placeholders as text in rich-text mode', async () => {
    const onError = vi.fn()

    render(
      <MDXEditor
        markdown={'usage: command <file> [options]'}
        onError={onError}
        plugins={[terminalMarkdownPlugin()]}
        suppressHtmlProcessing
      />
    )

    const editor = await screen.findByRole('textbox', { name: 'editable markdown' })
    expect(editor.textContent).toBe('usage: command <file> [options]')
    expect(onError).not.toHaveBeenCalled()
  })

  it('renders block HTML and remote-resource tags as inert text', async () => {
    const onError = vi.fn()

    render(
      <MDXEditor
        markdown={'<img src="https://example.com/pixel.png">'}
        onError={onError}
        plugins={[terminalMarkdownPlugin()]}
        suppressHtmlProcessing
      />
    )

    const editor = await screen.findByRole('textbox', { name: 'editable markdown' })
    await waitFor(() => expect(editor.textContent).toBe('<img src="https://example.com/pixel.png">'))
    expect(editor.querySelector('img')).toBeNull()
    expect(onError).not.toHaveBeenCalled()
  })
})
