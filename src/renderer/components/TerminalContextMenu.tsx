import type { ReactElement } from 'react'
import { ClipboardPaste, Copy, FileText } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { readClipboardText, writeClipboardText } from '../clipboard'
import type { TerminalTextSnapshot } from '../terminalText'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@/components/ui/context-menu'

type TerminalContextMenuProps = {
  children: ReactElement
  canPaste?: boolean
  getText: () => TerminalTextSnapshot
  onPaste?: (text: string) => boolean
  onRestoreFocus?: () => void
  onShowMarkdown: (text: string) => void
}

export function TerminalContextMenu({
  children,
  canPaste = false,
  getText,
  onPaste,
  onRestoreFocus,
  onShowMarkdown
}: TerminalContextMenuProps) {
  const { t } = useTranslation()
  const copy = async () => {
    const snapshot = getText()
    try {
      await writeClipboardText(snapshot.text)
      toast.success(snapshot.source === 'selection' ? t('terminal:toast.copiedSelection') : t('terminal:toast.copiedContent'))
    } catch {
      toast.error(t('errors:clipboard.writeFailed'))
    }
  }

  const paste = async () => {
    try {
      const text = await readClipboardText()
      if (text === '') return
      if (!onPaste?.(text)) toast.error(t('errors:terminal.notInputtable'))
    } catch {
      toast.error(t('errors:clipboard.readFailed'))
    }
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent
        onCloseAutoFocus={(event) => {
          if (!onRestoreFocus) return
          event.preventDefault()
          onRestoreFocus()
        }}
      >
        <ContextMenuItem onSelect={() => void copy()}>
          <Copy />
          {t('common:action.copy')}
        </ContextMenuItem>
        {canPaste && onPaste && (
          <ContextMenuItem onSelect={() => void paste()}>
            <ClipboardPaste />
            {t('common:action.paste')}
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => onShowMarkdown(getText().text)}>
          <FileText />
          {t('terminal:menu.showInRichEditor')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
