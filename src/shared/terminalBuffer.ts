export const MAX_TERMINAL_TRANSCRIPT_CHARS = 1_000_000
export const MAX_PERSISTED_TERMINAL_TRANSCRIPT_CHARS = 256_000
export const MAX_PROCESS_RESULT_CHARS = 256_000
export const MAX_TERMINAL_IPC_BATCH_CHARS = 64_000

export type TerminalTranscriptSnapshot = {
  transcript: string
  cursor: number | null
}

export type TerminalDataEvent = {
  sessionId: string
  taskId: string
  nodeId: string
  stream: 'stdout' | 'stderr'
  content: string
  cursor: number
}

export function tailText(text: string, maxChars: number): string {
  if (maxChars <= 0) return ''
  return text.length <= maxChars ? text : text.slice(-maxChars)
}

export function appendBoundedText(current: string, chunk: string, maxChars: number): string {
  if (maxChars <= 0) return ''
  if (chunk.length >= maxChars) return chunk.slice(-maxChars)

  const overflow = current.length + chunk.length - maxChars
  return overflow > 0 ? current.slice(overflow) + chunk : current + chunk
}
