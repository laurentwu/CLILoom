import { useMemo, useRef, useState, type MouseEvent } from 'react'
import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  ChangeCodeMirrorLanguage,
  CodeToggle,
  ConditionalContents,
  CreateLink,
  DiffSourceToggleWrapper,
  InsertCodeBlock,
  InsertTable,
  InsertThematicBreak,
  ListsToggle,
  MDXEditor,
  Separator as EditorSeparator,
  StrikeThroughSupSubToggles,
  UndoRedo,
  codeBlockPlugin,
  codeMirrorPlugin,
  diffSourcePlugin,
  headingsPlugin,
  linkDialogPlugin,
  linkPlugin,
  listsPlugin,
  markdownShortcutPlugin,
  quotePlugin,
  tablePlugin,
  thematicBreakPlugin,
  toolbarPlugin,
  type MDXEditorMethods,
  type Translation
} from '@mdxeditor/editor'
import { AlertTriangle, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { writeClipboardText } from '../clipboard'
import { i18n } from '../i18n'
import { terminalMarkdownPlugin } from '../terminalMarkdown'
import type { TranslationKey } from '../../shared/i18n/types'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import '@mdxeditor/editor/style.css'

const editorKeyCatalog: Record<string, TranslationKey> = {
  'codeBlock.language': 'terminal:markdown.codeBlockLanguage',
  'codeBlock.selectLanguage': 'terminal:markdown.codeBlockSelectLanguage',
  'contentArea.editableMarkdown': 'terminal:markdown.editableMarkdown',
  'createLink.cancelTooltip': 'terminal:markdown.linkCancelTooltip',
  'createLink.saveTooltip': 'terminal:markdown.linkSaveTooltip',
  'createLink.text': 'terminal:markdown.linkText',
  'createLink.textTooltip': 'terminal:markdown.linkTextTooltip',
  'createLink.title': 'terminal:markdown.linkTitle',
  'createLink.titleTooltip': 'terminal:markdown.linkTitleTooltip',
  'createLink.urlPlaceholder': 'terminal:markdown.linkUrlPlaceholder',
  'dialog.close': 'terminal:markdown.dialogClose',
  'dialogControls.cancel': 'common:action.cancel',
  'dialogControls.save': 'common:action.save',
  'toolbar.blockTypeSelect.placeholder': 'terminal:markdown.blockTypePlaceholder',
  'toolbar.blockTypeSelect.selectBlockTypeTooltip': 'terminal:markdown.blockTypeSelectTooltip',
  'toolbar.blockTypes.heading': 'terminal:markdown.blockTypeHeading',
  'toolbar.blockTypes.paragraph': 'terminal:markdown.blockTypeParagraph',
  'toolbar.blockTypes.quote': 'terminal:markdown.blockTypeQuote',
  'toolbar.bold': 'terminal:markdown.bold',
  'toolbar.bulletedList': 'terminal:markdown.bulletedList',
  'toolbar.checkList': 'terminal:markdown.checkList',
  'toolbar.codeBlock': 'terminal:markdown.codeBlockInsert',
  'toolbar.inlineCode': 'terminal:markdown.inlineCode',
  'toolbar.italic': 'terminal:markdown.italic',
  'toolbar.link': 'terminal:markdown.linkCreate',
  'toolbar.numberedList': 'terminal:markdown.numberedList',
  'toolbar.redo': 'terminal:markdown.redo',
  'toolbar.removeBold': 'terminal:markdown.removeBold',
  'toolbar.removeInlineCode': 'terminal:markdown.removeInlineCode',
  'toolbar.removeItalic': 'terminal:markdown.removeItalic',
  'toolbar.removeStrikethrough': 'terminal:markdown.removeStrikethrough',
  'toolbar.richText': 'terminal:markdown.richText',
  'toolbar.source': 'terminal:markdown.source',
  'toolbar.strikethrough': 'terminal:markdown.strikethrough',
  'toolbar.table': 'terminal:markdown.table',
  'toolbar.thematicBreak': 'terminal:markdown.thematicBreak',
  'toolbar.toggleGroup': 'terminal:markdown.toggleGroup',
  'toolbar.undo': 'terminal:markdown.undo'
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
  '': i18n.t('terminal:markdown.blockTypePlainText'),
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

export function TerminalMarkdownDialog({
  initialMarkdown,
  onClose,
  onRestoreFocus
}: {
  initialMarkdown: string
  onClose: () => void
  onRestoreFocus?: () => void
}) {
  const editorRef = useRef<MDXEditorMethods>(null)
  const [markdown, setMarkdown] = useState(initialMarkdown)
  const [parseError, setParseError] = useState<string | null>(null)
  const plugins = useMemo(() => [
    terminalMarkdownPlugin(),
    headingsPlugin(),
    listsPlugin(),
    quotePlugin(),
    thematicBreakPlugin(),
    linkPlugin(),
    linkDialogPlugin({ onClickLinkCallback: () => undefined }),
    tablePlugin(),
    codeBlockPlugin({ defaultCodeBlockLanguage: '' }),
    codeMirrorPlugin({
      autoLoadLanguageSupport: false,
      codeBlockLanguages
    }),
    diffSourcePlugin({ viewMode: 'rich-text' }),
    markdownShortcutPlugin(),
    toolbarPlugin({
      toolbarContents: () => (
        <DiffSourceToggleWrapper options={['rich-text', 'source']}>
          <ConditionalContents
            options={[
              {
                when: (editor) => editor?.editorType === 'codeblock',
                contents: () => <ChangeCodeMirrorLanguage />
              },
              {
                fallback: () => (
                  <>
                    <UndoRedo />
                    <EditorSeparator />
                    <BlockTypeSelect />
                    <BoldItalicUnderlineToggles options={['Bold', 'Italic']} />
                    <StrikeThroughSupSubToggles options={['Strikethrough']} />
                    <CodeToggle />
                    <EditorSeparator />
                    <ListsToggle />
                    <CreateLink />
                    <InsertTable />
                    <InsertThematicBreak />
                    <InsertCodeBlock />
                  </>
                )
              }
            ]}
          />
        </DiffSourceToggleWrapper>
      )
    })
  ], [])

  const copyMarkdown = async () => {
    const currentMarkdown = parseError
      ? markdown
      : editorRef.current?.getMarkdown() ?? markdown
    try {
      await writeClipboardText(currentMarkdown)
      toast.success(i18n.t('terminal:toast.copiedMarkdown'))
    } catch {
      toast.error(i18n.t('errors:clipboard.writeFailed'))
    }
  }

  const preventLinkNavigation = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target
    if (target instanceof Element && target.closest('a')) event.preventDefault()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="terminal-markdown-dialog flex h-[min(90vh,56rem)] max-h-[calc(100dvh-2rem)] w-[min(92vw,72rem)] max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(92vw,72rem)]"
        onCloseAutoFocus={(event) => {
          if (!onRestoreFocus) return
          event.preventDefault()
          onRestoreFocus()
        }}
        showCloseButton={false}
      >
        <DialogHeader className="shrink-0 border-b px-4 py-3">
          <DialogTitle>{i18n.t('terminal:markdown.dialog.title')}</DialogTitle>
          <DialogDescription>{i18n.t('terminal:markdown.dialog.description')}</DialogDescription>
        </DialogHeader>

        {parseError && (
          <Alert className="mx-4 mt-3 w-auto shrink-0" variant="destructive">
            <AlertTriangle />
            <AlertTitle>{i18n.t('terminal:markdown.parseWarningTitle')}</AlertTitle>
            <AlertDescription>
              {i18n.t('terminal:markdown.parseWarningDescription')}
            </AlertDescription>
          </Alert>
        )}

        <div
          className="min-h-0 flex-1 overflow-hidden"
          onClickCapture={preventLinkNavigation}
        >
          <MDXEditor
            ref={editorRef}
            className="terminal-markdown-editor mdxeditor-full-height h-full"
            contentEditableClassName="terminal-markdown-content"
            markdown={initialMarkdown}
            onChange={(value) => {
              setMarkdown(value)
              setParseError(null)
            }}
            onError={({ error, source }) => {
              setMarkdown(source)
              setParseError(error)
            }}
            plugins={plugins}
            placeholder={i18n.t('terminal:markdown.placeholder')}
            spellCheck={false}
            suppressHtmlProcessing
            translation={translate}
            trim={false}
          />
        </div>

        <DialogFooter className="mx-0 mb-0 shrink-0 rounded-b-xl px-4 py-3">
          <Button variant="outline" onClick={() => void copyMarkdown()}>
            <Copy data-icon="inline-start" />
            {i18n.t('terminal:markdown.copyMarkdown')}
          </Button>
          <Button onClick={onClose}>{i18n.t('common:action.close')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
