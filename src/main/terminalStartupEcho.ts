import { MAX_TERMINAL_TRANSCRIPT_CHARS } from '../shared/terminalBuffer'

export type TerminalOutputMapper = {
  map: (content: string) => string
  flush: () => string
}

// Interactive shells redraw the startup command after the TTY already echoed
// the bare input line. While wrapping long lines, Bash inserts a padding space
// followed by an erase-to-end-of-line sequence before wide glyphs. Those draw
// fragments are the only tolerated difference between the echoed command and
// the redrawn one; a fragment's leading space belongs to the fragment itself.
const REDRAW_DRAW_FRAGMENTS = [' \u001b[0K', ' \u001b[K']

const CARRIAGE_RETURN_CODE = 13
const LINE_FEED_CODE = 10
const ESCAPE_CODE = 27

type RedrawSpan = {
  start: number
  end: number
}

// Tolerant redraw matching is only enabled for single-line commands that cannot
// contain the redraw fragments themselves.
function supportsRedrawTolerance(command: string): boolean {
  for (let index = 0; index < command.length; index++) {
    const code = command.charCodeAt(index)
    if (
      code === CARRIAGE_RETURN_CODE ||
      code === LINE_FEED_CODE ||
      code === ESCAPE_CODE
    ) {
      return false
    }
  }
  return true
}

function drawFragmentEndingAt(text: string, position: number): number {
  for (const fragment of REDRAW_DRAW_FRAGMENTS) {
    if (
      position >= fragment.length &&
      text.startsWith(fragment, position - fragment.length)
    ) {
      return fragment.length
    }
  }
  return 0
}

// Finds the span of a complete redrawn command inside the first logical line
// (text[0..lineEnd)). The span never contains CR, so its end is anchored
// immediately before the line's LF, or before the CR of a CRLF pair. Matching
// backwards from that single anchor keeps the scan linear even for highly
// repetitive candidate lines, and each fragment-versus-character choice is
// forced: a command cannot contain ESC, so treating a fragment's leading space
// as a command character (forward) or its trailing K as a command character
// (backward) can never complete a match. Fragments are only consumed between
// command characters, so a fragment after the last command character makes the
// candidate fail, exactly like the forward-exact semantics.
function findRedrawSpan(text: string, command: string, lineEnd: number): RedrawSpan | null {
  if (lineEnd < command.length) return null
  let end = lineEnd
  if (text.charCodeAt(lineEnd - 1) === CARRIAGE_RETURN_CODE) end = lineEnd - 1
  let position = end
  let matched = command.length
  while (matched > 0) {
    if (matched < command.length) {
      const fragmentLength = drawFragmentEndingAt(text, position)
      if (fragmentLength > 0) {
        position -= fragmentLength
        continue
      }
    }
    if (position > 0 && text.charCodeAt(position - 1) === command.charCodeAt(matched - 1)) {
      position -= 1
      matched -= 1
      continue
    }
    return null
  }
  return { start: position, end }
}

export function createInitialCommandEchoFilter(command: string): TerminalOutputMapper | null {
  if (!command) return null

  // Input written before an interactive shell initializes its prompt can be
  // echoed once by the TTY and then drawn again by the shell with its prompt.
  const echoedLines = [`${command}\r\n`, `${command}\n`]
  const tolerantRedraw = supportsRedrawTolerance(command)
  let heldEcho = ''
  let pending = ''
  let state: 'matching-echo' | 'awaiting-redraw' | 'passthrough' = 'matching-echo'

  const releasePending = (includeHeldEcho: boolean) => {
    const mapped = `${includeHeldEcho ? heldEcho : ''}${pending}`
    heldEcho = ''
    pending = ''
    state = 'passthrough'
    return mapped
  }

  const resolveRedraw = () => {
    if (tolerantRedraw) {
      const lineEnd = pending.indexOf('\n')
      if (lineEnd < 0) return ''
      const span = findRedrawSpan(pending, command, lineEnd)
      if (!span) return releasePending(true)
      const mapped = `${pending.slice(0, span.start)}${command}${pending.slice(span.end)}`
      heldEcho = ''
      pending = ''
      state = 'passthrough'
      return mapped
    }
    const redrawIndex = pending.indexOf(command)
    const nextLineEnd = pending.indexOf('\n')
    if (redrawIndex >= 0 && (nextLineEnd < 0 || redrawIndex <= nextLineEnd)) {
      return releasePending(false)
    }
    if (nextLineEnd >= 0) return releasePending(true)
    return ''
  }

  return {
    map(content) {
      if (state === 'passthrough') return content
      pending += content

      if (state === 'matching-echo') {
        const echoedLine = echoedLines.find((candidate) => pending.startsWith(candidate))
        if (echoedLine) {
          heldEcho = echoedLine
          pending = pending.slice(echoedLine.length)
          state = 'awaiting-redraw'
        } else if (echoedLines.some((candidate) => candidate.startsWith(pending))) {
          if (pending.length > MAX_TERMINAL_TRANSCRIPT_CHARS) {
            return releasePending(false)
          }
          return ''
        } else {
          return releasePending(false)
        }
      }

      const mapped = resolveRedraw()
      // After a release the held buffers are empty, so this only fires while
      // recognition is still holding an undecided candidate.
      if (pending.length + heldEcho.length > MAX_TERMINAL_TRANSCRIPT_CHARS) {
        return mapped + releasePending(true)
      }
      return mapped
    },
    flush() {
      if (state === 'passthrough') return ''
      return releasePending(state === 'awaiting-redraw')
    }
  }
}
