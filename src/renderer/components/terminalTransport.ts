export type TerminalTransport = {
  subscribeData: (sessionId: string, callback: (content: string) => void) => (() => void) | undefined
  subscribeReady?: (sessionId: string, callback: () => void) => (() => void) | undefined
  isInputReady?: (sessionId: string) => Promise<boolean> | boolean
  write: (sessionId: string, input: string) => void
  resize: (sessionId: string, cols: number, rows: number) => void | Promise<unknown>
}
