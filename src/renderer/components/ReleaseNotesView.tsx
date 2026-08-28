import { useMemo, useState, type MouseEvent } from 'react'
import {
  MDXEditor,
  codeBlockPlugin,
  codeMirrorPlugin,
  headingsPlugin,
  linkPlugin,
  listsPlugin,
  quotePlugin,
  tablePlugin,
  thematicBreakPlugin,
  type Translation
} from '@mdxeditor/editor'
import { i18n } from '../i18n'
import { releaseNotesToMarkdown } from '../releaseNotesMarkdown'
import { terminalMarkdownPlugin } from '../terminalMarkdown'
import type { TranslationKey } from '../../shared/i18n/types'
import '@mdxeditor/editor/style.css'

const editorKeyCatalog: Record<string, TranslationKey> = {
  'contentArea.editableMarkdown': 'settings:update.releaseNotes'
}

const translate: Translation = (key, defaultValue, interpolations = {}) => {
  const catalogKey = editorKeyCatalog[key]
  if (!catalogKey) {
    let value = defaultValue
    for (const [name, replacement] of Object.entries(interpolations)) {
      value = value.replaceAll(`{{${name}}}`, String(replacement))
    }
    return value
  }
  return i18n.t(catalogKey, interpolations as Record<string, unknown>)
}

const codeBlockLanguages = {
  '': 'Plain Text',
  bash: 'Bash',
  css: 'CSS',
  html: 'HTML',
  javascript: 'JavaScript',
  js: 'JavaScript',
  json: 'JSON',
  markdown: 'Markdown',
  md: 'Markdown',
  shell: 'Shell',
  sh: 'Shell',
  tsx: 'TypeScript React',
  typescript: 'TypeScript',
  ts: 'TypeScript',
  yaml: 'YAML',
  yml: 'YAML'
}

export function ReleaseNotesView({ markdown }: { markdown: string }) {
  const [parseFailure, setParseFailure] = useState<{ markdown: string; source: string } | null>(null)
  const renderedMarkdown = useMemo(() => releaseNotesToMarkdown(markdown), [markdown])
  const plugins = useMemo(() => [
    terminalMarkdownPlugin(),
    headingsPlugin(),
    listsPlugin(),
    quotePlugin(),
    thematicBreakPlugin(),
    linkPlugin(),
    tablePlugin(),
    codeBlockPlugin({ defaultCodeBlockLanguage: '' }),
    codeMirrorPlugin({ autoLoadLanguageSupport: false, codeBlockLanguages })
  ], [])

  const failedSource = parseFailure?.markdown === renderedMarkdown ? parseFailure.source : null

  const preventLinkNavigation = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target
    if (target instanceof Element && target.closest('a')) event.preventDefault()
  }

  if (failedSource !== null) {
    return (
      <p className="h-full overflow-y-auto whitespace-pre-wrap break-words [overflow-wrap:anywhere] p-3 text-sm text-muted-foreground">
        {failedSource}
      </p>
    )
  }

  return (
    <div className="h-full" onClickCapture={preventLinkNavigation}>
      <MDXEditor
        key={renderedMarkdown}
        className="release-notes-editor mdxeditor-full-height h-full"
        contentEditableClassName="release-notes-content"
        markdown={renderedMarkdown}
        onError={({ source }) => setParseFailure({ markdown: renderedMarkdown, source })}
        plugins={plugins}
        readOnly
        spellCheck={false}
        suppressHtmlProcessing
        translation={translate}
        trim={false}
      />
    </div>
  )
}
