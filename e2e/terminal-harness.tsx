import { useState } from 'react'
import ReactDOM from 'react-dom/client'
import { I18nextProvider } from 'react-i18next'
import { AppToaster } from '../src/renderer/components/AppToaster'
import { TerminalOutputPane, TerminalPane } from '../src/renderer/components/TerminalPane'
import type { TerminalSession } from '../src/renderer/utils'
import { i18n, syncI18nLanguage } from '../src/renderer/i18n'
import { TooltipProvider } from '../src/renderer/components/ui/tooltip'
import '../src/renderer/styles.css'

syncI18nLanguage('en')

type AttachedEvent = { sessionId: string; taskId: string; nodeId: string }
type DataEvent = AttachedEvent & { stream: 'stdout' | 'stderr'; content: string }

const attachedHandlers = new Set<(event: AttachedEvent) => void>()
const dataHandlers = new Set<(event: DataEvent) => void>()

window.cliLoom = {
  isInputReady: async () => true,
  onTerminalAttached: (handler: (event: AttachedEvent) => void) => {
    attachedHandlers.add(handler)
    return () => attachedHandlers.delete(handler)
  },
  onTerminalData: (handler: (event: DataEvent) => void) => {
    dataHandlers.add(handler)
    return () => dataHandlers.delete(handler)
  },
  resizeProcess: async () => undefined
} as unknown as NonNullable<Window['cliLoom']>

const longLogicalLine = 'REFLOW-SENTINEL ' + 'markdown-terminal-content '.repeat(12).trimEnd()
const history = Array.from({ length: 36 }, (_, index) => `history-${String(index + 1).padStart(2, '0')}`)
const transcript = [
  '# Terminal E2E',
  '',
  '中文与 emoji 👩‍💻🙂',
  '',
  '[文档链接](https://example.com)',
  '',
  ...history,
  longLogicalLine,
  '',
  '| 功能 | 状态 |',
  '| --- | --- |',
  '| 复制 | 完成 |',
  '',
  '```ts',
  "const value = 'terminal'",
  '```'
].join('\r\n')
const plainTextOverflow = Array.from(
  { length: 40 },
  (_, index) => `plain-output-${String(index + 1).padStart(2, '0')} ${'code '.repeat(12).trimEnd()}`
).join('\n')

const session: TerminalSession = {
  id: 'e2e-session',
  task_id: 'e2e-task',
  node_id: 'e2e-node',
  kind: 'interactive',
  command: 'bash',
  cwd: '/repo',
  status: 'running',
  transcript
}

function emitTerminalData(content: string) {
  for (const handler of dataHandlers) {
    handler({
      content,
      nodeId: session.node_id,
      sessionId: session.id,
      stream: 'stdout',
      taskId: session.task_id
    })
  }
}

function Harness() {
  const [mounted, setMounted] = useState(true)
  const [narrow, setNarrow] = useState(false)
  const [sentInput, setSentInput] = useState('')

  return (
    <I18nextProvider i18n={i18n}>
      <TooltipProvider>
        <main className="h-screen overflow-y-auto bg-background p-4 text-foreground">
        <div className="mb-3 flex gap-2">
          <button data-testid="toggle-width" onClick={() => setNarrow((value) => !value)} type="button">
            切换终端宽度
          </button>
          <button
            data-testid="enter-alternate"
            onClick={() => emitTerminalData('\u001b[?1049h# Alternate Buffer\r\n中文🙂')}
            type="button"
          >
            进入 alternate buffer
          </button>
          <button
            data-testid="leave-alternate"
            onClick={() => emitTerminalData('\u001b[?1049l')}
            type="button"
          >
            离开 alternate buffer
          </button>
          <button data-testid="toggle-mounted" onClick={() => setMounted((value) => !value)} type="button">
            切换终端挂载状态
          </button>
          <button
            data-testid="emit-detached"
            onClick={() => emitTerminalData('DETACHED-OUTPUT-SENTINEL\r\n')}
            type="button"
          >
            向离屏终端输出
          </button>
        </div>
        <output data-testid="sent-input">{sentInput}</output>
        <div
          className="mt-3 h-[700px] transition-[width]"
          data-testid="terminal-shell"
          style={{ width: narrow ? 320 : 1120 }}
        >
          {mounted && (
            <TerminalPane
              session={session}
              onRetry={async () => undefined}
              onSendInput={(_sessionId, input) => setSentInput((value) => value + input)}
            />
          )}
        </div>
        <div className="mt-3 grid h-32 w-[652px] grid-cols-2 gap-3">
          <div className="min-h-0 min-w-0" data-testid="plain-output-short">
            <TerminalOutputPane id="plain-output-short" text="short plain output" />
          </div>
          <div className="min-h-0 min-w-0" data-testid="plain-output-overflowing">
            <TerminalOutputPane id="plain-output-overflowing" text={plainTextOverflow} />
          </div>
        </div>
        <AppToaster />
      </main>
      </TooltipProvider>
    </I18nextProvider>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(<Harness />)
