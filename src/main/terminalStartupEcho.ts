import type { ShellFamily } from '../shared/shell'
import { MAX_TERMINAL_TRANSCRIPT_CHARS } from '../shared/terminalBuffer'

export type TerminalOutputMapper = {
  map: (content: string) => string
  flush: () => string
}

export type InitialCommandEchoFilter = TerminalOutputMapper & {
  isPending: () => boolean
}

export type StartupEchoContext = {
  family?: ShellFamily
  platform?: NodeJS.Platform
  cols?: number
}

const CARRIAGE_RETURN_CODE = 13
const LINE_FEED_CODE = 10
const ESCAPE_CODE = 27

// The complete macOS system Bash migration notice emitted before the first
// prompt when /bin/bash is not the user's login shell. Only this exact block
// plus adjacent blank lines is tolerated between the bare echo and the first
// prompted command; unknown or truncated banners fall back to passthrough.
const ZSH_MIGRATION_BANNER = [
  'The default interactive shell is now zsh.',
  'To update your account to use zsh, please run `chsh -s /bin/zsh`.',
  'For more details, please visit https://support.apple.com/kb/HT208050.'
]

const MAX_BANNER_BLANK_LINES = 2
const MAX_BOUNDARY_PAD_SPACES = 2
const MAX_DRAW_BACKTRACKS = 8

type StartupLineAttempt =
  | { kind: 'ok'; drawStart: number; lineEnd: number; drawColumn: number }
  | { kind: 'fail' }
  | { kind: 'incomplete' }

type DrawAttempt =
  | { kind: 'ok' }
  | { kind: 'fail' }
  | { kind: 'incomplete' }

type ControlKind =
  | { type: 'erase-fragment' }
  | { type: 'sgr' }
  | { type: 'paste-toggle' }
  | { type: 'positioning'; column: number; row?: number }
  | { type: 'prefix-control' }
  | { type: 'other' }

type DrawUnit =
  | { type: 'text'; char: string; start: number }
  | { type: 'cr' }
  | { type: 'control'; kind: ControlKind; start: number }

type Tolerance = {
  drawFragments: boolean
  banner: boolean
  crSegments: boolean
  pasteToggles: boolean
  positioning: false | { cols: number }
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

function resolveTolerance(context: StartupEchoContext | undefined): Tolerance {
  const posixLike = !context?.family || context.family === 'posix'
  const cols = typeof context?.cols === 'number' && context.cols > 0 ? context.cols : 100
  return {
    drawFragments: posixLike,
    banner: posixLike && context?.platform === 'darwin',
    crSegments: posixLike && context?.platform === 'darwin',
    pasteToggles: posixLike && context?.platform === 'win32',
    positioning: posixLike && context?.platform === 'win32' && cols !== null
      ? { cols }
      : false
  }
}

// Compact wcwidth covering the ranges observed in real terminal redraws: CJK
// ideographs and extensions, fullwidth forms, Hangul, and emoji. It only feeds
// the column-boundary cursor-positioning checks, never text recovery.
function charWidthAt(text: string, index: number): number {
  const unit = text.charCodeAt(index)
  if (unit >= 0xdc00 && unit <= 0xdfff && index > 0) {
    const previous = text.charCodeAt(index - 1)
    if (previous >= 0xd800 && previous <= 0xdbff) return 0
  }
  const code = text.codePointAt(index) ?? text.charCodeAt(index)
  if (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0x303e) ||
    (code >= 0x3041 && code <= 0x33ff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xa000 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1f64f) ||
    (code >= 0x1f680 && code <= 0x1f6ff) ||
    (code >= 0x1f900 && code <= 0x1f9ff) ||
    code >= 0x20000
  ) {
    return 2
  }
  return 1
}

function isWideCharAt(text: string, index: number): boolean {
  return charWidthAt(text, index) === 2
}

// Consumes one complete escape sequence starting at text[sequenceStart]
// (text[sequenceStart] === ESC). Returns the index just past the sequence, or
// null when the buffer ends before the sequence is complete.
function scanControlSequence(text: string, sequenceStart: number): number | null {
  const length = text.length
  if (sequenceStart + 1 >= length) return null
  const introducer = text.charCodeAt(sequenceStart + 1)
  if (introducer === 0x5b) {
    // CSI: parameter and intermediate bytes until the final byte (0x40-0x7e).
    for (let index = sequenceStart + 2; index < length; index++) {
      const code = text.charCodeAt(index)
      if (code >= 0x40 && code <= 0x7e) return index + 1
      if (code === ESCAPE_CODE || code < 0x20) return index
    }
    return null
  }
  if (introducer === 0x5d) {
    // OSC: BEL or ST (ESC \) terminated.
    for (let index = sequenceStart + 2; index < length; index++) {
      const code = text.charCodeAt(index)
      if (code === 0x07) return index + 1
      if (code === ESCAPE_CODE) {
        if (index + 1 >= length) return null
        return text.charCodeAt(index + 1) === 0x5c ? index + 2 : index + 1
      }
    }
    return null
  }
  // Two-character escape (for example ESC 7 / ESC 8 / ESC M).
  return sequenceStart + 2
}

function classifyControlSequence(text: string, start: number, end: number): ControlKind {
  const introducer = text.charCodeAt(start + 1)
  const body = text.slice(start + 2, end - 1)
  const finalByte = text.charAt(end - 1)
  if (introducer === 0x5d) return { type: 'prefix-control' }
  if (introducer !== 0x5b) return { type: 'other' }
  if (finalByte === 'm' && /^[\d;]*$/.test(body)) return { type: 'sgr' }
  if (finalByte === 'K') {
    return body === '' || body === '0' ? { type: 'erase-fragment' } : { type: 'other' }
  }
  if (finalByte === 'h' || finalByte === 'l') {
    if (body === '?2004') return { type: 'paste-toggle' }
    return /^\?(25|1034|1004|9001)$/.test(body) ? { type: 'prefix-control' } : { type: 'other' }
  }
  if (finalByte === 'J') {
    return body === '' || body === '0' || body === '2' || body === '3'
      ? { type: 'prefix-control' }
      : { type: 'other' }
  }
  if ((finalByte === 'H' || finalByte === 'f' || finalByte === 'G') && /^[\d;]*$/.test(body)) {
    const parameters = body.split(';')
    if (parameters.length > (finalByte === 'G' ? 1 : 2)) return { type: 'other' }
    const columnParameter = finalByte === 'G'
      ? parameters[0]
      : parameters.length > 1
        ? parameters[1]
        : '1'
    const column = Number.parseInt(columnParameter || '1', 10)
    const row = finalByte === 'G' ? undefined : Number.parseInt(parameters[0] || '1', 10)
    return Number.isFinite(column) && column >= 1 &&
      (row === undefined || (Number.isFinite(row) && row >= 1))
      ? { type: 'positioning', column, row }
      : { type: 'other' }
  }
  return { type: 'other' }
}

function parseLineEnding(text: string, start: number): 'crlf' | 'lf' | 'cr' | null {
  const code = text.charCodeAt(start)
  if (code === CARRIAGE_RETURN_CODE) {
    return text.charCodeAt(start + 1) === LINE_FEED_CODE ? 'crlf' : 'cr'
  }
  return code === LINE_FEED_CODE ? 'lf' : null
}

function consumeLineEnding(text: string, start: number): number {
  const ending = parseLineEnding(text, start)
  if (ending === 'crlf') return start + 2
  if (ending === null) return start
  return start + 1
}

// On macOS the migration notice may be surrounded by blank lines. Blank-line
// and banner skipping only happen together: without a matching banner the
// candidate never crosses a line boundary.
function skipStartupPreamble(
  text: string,
  offset: number,
  tolerance: Tolerance
): { offset: number } | { incomplete: true } {
  if (!tolerance.banner) return { offset }

  let cursor = offset
  let leadingBlanks = 0
  while (
    leadingBlanks < MAX_BANNER_BLANK_LINES &&
    (parseLineEnding(text, cursor) === 'lf' || parseLineEnding(text, cursor) === 'crlf')
  ) {
    cursor = consumeLineEnding(text, cursor)
    leadingBlanks += 1
  }

  for (const bannerLine of ZSH_MIGRATION_BANNER) {
    if (!text.startsWith(bannerLine, cursor)) {
      if (
        cursor >= text.length ||
        bannerLine.startsWith(text.slice(cursor, cursor + bannerLine.length))
      ) {
        return { incomplete: true }
      }
      return { offset }
    }
    cursor += bannerLine.length
    const ending = parseLineEnding(text, cursor)
    if (ending === null) {
      return cursor >= text.length ? { incomplete: true } : { offset }
    }
    if (ending === 'cr' && cursor + 1 >= text.length) return { incomplete: true }
    if (ending !== 'crlf' && ending !== 'lf') return { offset }
    cursor = consumeLineEnding(text, cursor)
  }

  let trailingBlanks = 0
  while (
    trailingBlanks < MAX_BANNER_BLANK_LINES &&
    (parseLineEnding(text, cursor) === 'lf' || parseLineEnding(text, cursor) === 'crlf')
  ) {
    cursor = consumeLineEnding(text, cursor)
    trailingBlanks += 1
  }
  return { offset: cursor }
}

type StartupScan =
  | { kind: 'ok'; offset: number }
  | { kind: 'fail' }
  | { kind: 'incomplete' }

// Consumes the known interactive-shell startup control prefix: window title
// (OSC), SGR, erase/home cursor initialization, and private mode toggles such
// as bracketed paste, focus reporting, win32 input mode, or Bash's meta-key
// mode (ESC[?1034h).
function scanStartupControlPrefix(text: string, offset: number): StartupScan {
  let cursor = offset
  for (;;) {
    if (text.charCodeAt(cursor) !== ESCAPE_CODE) return { kind: 'ok', offset: cursor }
    const end = scanControlSequence(text, cursor)
    if (end === null) return { kind: 'incomplete' }
    const kind = classifyControlSequence(text, cursor, end)
    if (kind.type === 'other') return { kind: 'fail' }
    cursor = end
  }
}

type PromptScan =
  | { kind: 'ok'; promptEnd: number; promptColumn: number }
  | { kind: 'fail' }
  | { kind: 'incomplete' }

// Recognizes the first POSIX-style prompt on a logical line: any run of text,
// SGR, and OSC units that ends with the two characters `$ ` or `# `. Also
// reports the terminal column the prompt occupies so draw cursor positioning
// can be validated against real columns.
function scanPrompt(text: string, offset: number, limit: number): PromptScan {
  let cursor = offset
  let column = 0
  for (;;) {
    if (cursor >= limit) return { kind: 'fail' }
    const code = text.charCodeAt(cursor)
    if (code === CARRIAGE_RETURN_CODE || code === LINE_FEED_CODE) return { kind: 'fail' }
    if (code === ESCAPE_CODE) {
      const end = scanControlSequence(text, cursor)
      if (end === null || end > limit) return { kind: 'incomplete' }
      const kind = classifyControlSequence(text, cursor, end)
      if (kind.type !== 'sgr' && text.charCodeAt(cursor + 1) !== 0x5d) return { kind: 'fail' }
      cursor = end
      continue
    }
    if ((code === 0x24 || code === 0x23) && text.charCodeAt(cursor + 1) === 0x20) {
      return { kind: 'ok', promptEnd: cursor + 2, promptColumn: column + 2 }
    }
    column += charWidthAt(text, cursor)
    cursor += 1
  }
}

// Attempts to locate [optional migration banner][control prefix][prompt]
// [command draw] at the start of the logical line beginning at `offset`. The
// draw line must already be terminated by LF; otherwise the candidate stays
// pending. When `requireControlPrefix` is set, the first prompted draw is only
// accepted after a known control prefix, so plain interactive text such as
// password prompts is released immediately.
function attemptStartupLine(
  text: string,
  offset: number,
  tolerance: Tolerance,
  requireControlPrefix: boolean,
  command: string
): StartupLineAttempt {
  const preamble = skipStartupPreamble(text, offset, tolerance)
  if ('incomplete' in preamble) return { kind: 'incomplete' }

  const prefix = scanStartupControlPrefix(text, preamble.offset)
  if (prefix.kind !== 'ok') return prefix
  if (requireControlPrefix && prefix.offset === preamble.offset) return { kind: 'fail' }

  const lineEndIndex = text.indexOf('\n', prefix.offset)
  if (lineEndIndex < 0) return { kind: 'incomplete' }
  const drawLineEnd = text.charCodeAt(lineEndIndex - 1) === CARRIAGE_RETURN_CODE
    ? lineEndIndex - 1
    : lineEndIndex

  const prompt = scanPrompt(text, prefix.offset, drawLineEnd)
  if (prompt.kind !== 'ok') {
    // Preserve the pre-existing exact path for custom prompts after a bare
    // echo. Without that echo, only a recognizable POSIX prompt is accepted.
    const exactStart = drawLineEnd - command.length
    if (
      prompt.kind === 'fail' && !requireControlPrefix &&
      exactStart >= prefix.offset &&
      text.slice(exactStart, drawLineEnd) === command &&
      !/[\r\n\u001b]/.test(text.slice(prefix.offset, exactStart))
    ) {
      return { kind: 'ok', drawStart: exactStart, lineEnd: drawLineEnd, drawColumn: 0 }
    }
    return prompt
  }
  return {
    kind: 'ok',
    drawStart: prompt.promptEnd,
    lineEnd: drawLineEnd,
    drawColumn: prompt.promptColumn
  }
}

type DrawMatcherState = {
  unitIndex: number
  matched: number
  visualColumn: number
}

// Matches the draw region [drawStart, lineEnd) against the full command.
// Text units must reproduce the command character by character; only proven
// draw mechanics are tolerated between command characters: Bash padding
// fragments, the macOS Readline CR redraw segments (padding space plus an
// optional repeated wide glyph), and the Windows ConPTY bracketed-paste
// toggles plus column-boundary cursor positioning observed in captured logs.
// Every ambiguous boundary offers at most one alternative and the total
// number of retries is bounded, keeping the scan linear.
function matchCommandDraw(
  text: string,
  drawStart: number,
  lineEnd: number,
  command: string,
  tolerance: Tolerance,
  drawColumn: number
): DrawAttempt {
  const units = tokenizeDraw(text, drawStart, lineEnd)
  const alternatives: DrawMatcherState[] = []
  let pushes = 0

  const pushAlternative = (alternative: DrawMatcherState): void => {
    if (pushes < MAX_DRAW_BACKTRACKS) {
      pushes += 1
      alternatives.push(alternative)
    }
  }

  const retryOr = (failure: DrawAttempt): DrawAttempt | DrawMatcherState => {
    const alternative = alternatives.pop()
    return alternative ?? failure
  }

  let state: DrawMatcherState = { unitIndex: 0, matched: 0, visualColumn: drawColumn }
  while (state.unitIndex <= units.length) {
    if (state.unitIndex === units.length) {
      if (state.matched === command.length) return { kind: 'ok' }
      const resumed = retryOr({ kind: 'fail' })
      if ('kind' in resumed) return resumed
      state = resumed
      continue
    }

    const unit = units[state.unitIndex]

    // A completed invocation followed by anything other than its line ending
    // is not a proven startup draw. Keep suffixes and controls byte-for-byte.
    if (state.matched === command.length) return { kind: 'fail' }

    if (unit.type === 'text') {
      if (unit.char === command.charAt(state.matched)) {
        if (
          unit.char === ' ' &&
          isBoundaryPad(units, state.unitIndex, tolerance)
        ) {
          pushAlternative({
            unitIndex: state.unitIndex + 1,
            matched: state.matched,
            visualColumn: state.visualColumn + 1
          })
        }
        state.matched += 1
        state.visualColumn += charWidthAt(text, unit.start)
        state.unitIndex += 1
        continue
      }
      if (unit.char === ' ' && isBoundaryPad(units, state.unitIndex, tolerance)) {
        state.visualColumn += 1
        state.unitIndex += 1
        continue
      }
      const resumed = retryOr({ kind: 'fail' })
      if ('kind' in resumed) return resumed
      state = resumed
      continue
    }

    if (unit.type === 'control') {
      const column = acceptDrawControl(unit.kind, state.visualColumn, tolerance)
      if (column !== null) {
        state.visualColumn = column
        state.unitIndex += 1
        continue
      }
      const resumed = retryOr({ kind: 'fail' })
      if ('kind' in resumed) return resumed
      state = resumed
      continue
    }

    if (!tolerance.crSegments) {
      const resumed = retryOr({ kind: 'fail' })
      if ('kind' in resumed) return resumed
      state = resumed
      continue
    }

    // CR segment separator: everything drawn so far on the row is overwritten,
    // so the next segment either repeats the wide glyph that wrapped across
    // the boundary or continues with the next command character.
    const next = units[state.unitIndex + 1]
    const continueState: DrawMatcherState = {
      unitIndex: state.unitIndex + 1,
      matched: state.matched,
      visualColumn: 0
    }
    if (
      next &&
      next.type === 'text' &&
      state.matched > 0 &&
      next.char === command.charAt(state.matched - 1) &&
      isWideCharAt(text, next.start)
    ) {
      if (next.char === command.charAt(state.matched)) {
        pushAlternative(continueState)
      }
      state = {
        unitIndex: state.unitIndex + 2,
        matched: state.matched,
        visualColumn: charWidthAt(text, next.start)
      }
      continue
    }
    state = continueState
  }

  return { kind: 'fail' }
}

// A space that does not match the next command character is a redraw padding
// space only when it directly surrounds a tolerated draw mechanic: a CR
// segment separator or an accepted control-sequence class. Column values are
// not re-validated here; the main walk already accepted the control at its
// real column.
function isBoundaryPad(units: DrawUnit[], index: number, tolerance: Tolerance): boolean {
  const previous = index > 0 ? units[index - 1] : undefined
  if (previous && isToleratedDrawNeighbor(previous, tolerance)) return true

  let pads = 0
  let cursor = index
  while (cursor < units.length) {
    const candidate = units[cursor]
    if (candidate.type !== 'text' || candidate.char !== ' ') break
    pads += 1
    if (pads > MAX_BOUNDARY_PAD_SPACES) return false
    cursor += 1
  }
  if (cursor >= units.length) return false
  const neighbor = units[cursor]
  return neighbor.type !== 'text' && isToleratedDrawNeighbor(neighbor, tolerance)
}

function isToleratedDrawNeighbor(unit: DrawUnit, tolerance: Tolerance): boolean {
  if (unit.type === 'cr') return tolerance.crSegments
  if (unit.type !== 'control') return false
  switch (unit.kind.type) {
    case 'sgr':
      return true
    case 'erase-fragment':
      return tolerance.drawFragments
    case 'paste-toggle':
      return tolerance.pasteToggles
    case 'positioning':
      return tolerance.positioning !== false
    default:
      return false
  }
}

function acceptDrawControl(
  kind: ControlKind,
  visualColumn: number,
  tolerance: Tolerance
): number | null {
  if (kind.type === 'erase-fragment') return tolerance.drawFragments ? visualColumn : null
  if (kind.type === 'sgr') return visualColumn
  if (kind.type === 'paste-toggle') return tolerance.pasteToggles ? visualColumn : null
  if (kind.type === 'positioning') {
    if (!tolerance.positioning) return null
    const { cols } = tolerance.positioning
    if (visualColumn === 0 || visualColumn % cols !== 0) return null
    // Only a no-op reposition to the column the cursor already sits on (the
    // pending-wrap cell at the terminal edge) is accepted. ConPTY uses screen
    // coordinates after wrapping, while visualColumn counts the whole draw.
    // Reject an incorrect row too: it would overwrite earlier command text.
    if (kind.row !== undefined && kind.row !== visualColumn / cols) return null
    return kind.column === cols ? visualColumn : null
  }
  return null
}

// Splits the draw region into text, CR, and classified control units. The
// region never contains LF; CR only appears as a macOS segment separator.
function tokenizeDraw(text: string, start: number, end: number): DrawUnit[] {
  const units: DrawUnit[] = []
  let cursor = start
  while (cursor < end) {
    const code = text.charCodeAt(cursor)
    if (code === ESCAPE_CODE) {
      const sequenceEnd = scanControlSequence(text, cursor)
      units.push({
        type: 'control',
        kind: sequenceEnd === null
          ? { type: 'other' }
          : classifyControlSequence(text, cursor, Math.min(sequenceEnd, end)),
        start: cursor
      })
      cursor = sequenceEnd === null ? end : Math.min(sequenceEnd, end)
      continue
    }
    if (code === CARRIAGE_RETURN_CODE) {
      units.push({ type: 'cr' })
      cursor += 1
      continue
    }
    if (code === LINE_FEED_CODE) break
    units.push({ type: 'text', char: text.charAt(cursor), start: cursor })
    cursor += 1
  }
  return units
}

export function createInitialCommandEchoFilter(
  command: string,
  context?: StartupEchoContext
): InitialCommandEchoFilter | null {
  if (!command) return null

  // Input written before an interactive shell initializes its prompt can be
  // echoed once by the TTY and then drawn again by the shell with its prompt.
  const echoedLines = [`${command}\r\n`, `${command}\n`]
  const tolerance = resolveTolerance(context)
  const tolerantRedraw = supportsRedrawTolerance(command)
  const firstDrawAllowed = tolerantRedraw && tolerance.pasteToggles
  let heldEcho = ''
  let pending = ''
  let pendingParts: string[] = []
  let pendingLength = 0
  let echoCandidates = echoedLines
  let state: 'matching-echo' | 'awaiting-redraw' | 'first-draw' | 'passthrough' = 'matching-echo'
  const collectPending = () => {
    pending += pendingParts.join('')
    pendingParts = []
  }

  const releasePending = (includeHeldEcho: boolean) => {
    collectPending()
    const mapped = `${includeHeldEcho ? heldEcho : ''}${pending}`
    heldEcho = ''
    pending = ''
    pendingLength = 0
    state = 'passthrough'
    return mapped
  }

  // Exact fallback for commands that embed control characters: no draw
  // mechanics are interpreted, the redraw must contain the literal command
  // within the current logical line.
  const resolveExactRedraw = (): string => {
    const redrawIndex = pending.indexOf(command)
    const nextLineEnd = pending.indexOf('\n')
    if (redrawIndex >= 0 && (nextLineEnd < 0 || redrawIndex <= nextLineEnd)) {
      return releasePending(false)
    }
    if (nextLineEnd >= 0) return releasePending(true)
    return ''
  }

  const resolveStartupLine = (): string => {
    if (!tolerantRedraw || !tolerance.drawFragments) return resolveExactRedraw()

    const attempt = attemptStartupLine(pending, 0, tolerance, state === 'first-draw', command)
    if (attempt.kind === 'incomplete') return ''
    if (attempt.kind === 'fail') return releasePending(state === 'awaiting-redraw')

    const draw = matchCommandDraw(
      pending,
      attempt.drawStart,
      attempt.lineEnd,
      command,
      tolerance,
      attempt.drawColumn
    )
    if (draw.kind === 'incomplete') return ''
    if (draw.kind === 'fail') return releasePending(state === 'awaiting-redraw')

    const mapped = `${pending.slice(0, attempt.drawStart)}${command}${pending.slice(attempt.lineEnd)}`
    heldEcho = ''
    pending = ''
    pendingLength = 0
    state = 'passthrough'
    return mapped
  }

  return {
    isPending: () => state !== 'passthrough',
    map(content) {
      if (state === 'passthrough') return content
      if (!content) return ''
      const previousLength = pendingLength
      pendingParts.push(content)
      pendingLength += content.length

      if (pendingLength + heldEcho.length > MAX_TERMINAL_TRANSCRIPT_CHARS) {
        return releasePending(state === 'awaiting-redraw')
      }

      if (state === 'matching-echo') {
        // Compare only the new bytes. Rechecking the entire accumulated bare
        // echo on every one-character PTY chunk would be quadratic.
        echoCandidates = echoCandidates.filter((candidate) => (
          candidate.slice(previousLength, pendingLength) ===
            content.slice(0, Math.max(0, candidate.length - previousLength))
        ))
        const echoedLine = echoCandidates.find((candidate) => pendingLength >= candidate.length)
        if (echoedLine) {
          collectPending()
          heldEcho = echoedLine
          pending = pending.slice(echoedLine.length)
          pendingLength = pending.length
          state = 'awaiting-redraw'
        } else if (echoCandidates.length > 0) {
          return ''
        } else if (firstDrawAllowed) {
          state = 'first-draw'
          collectPending()
          if (!pending.startsWith('\u001b')) return releasePending(false)
        } else {
          return releasePending(false)
        }
      }

      // Redraws are only committed once their logical line is complete. Scan
      // new chunks for LF, retaining chunks without repeatedly flattening or
      // scanning an arbitrarily long unfinished line. A macOS banner has a
      // fixed number of lines, so it adds only a constant number of scans.
      if (tolerantRedraw && tolerance.drawFragments && !content.includes('\n')) return ''
      collectPending()
      return resolveStartupLine()
    },
    flush() {
      if (state === 'passthrough') return ''
      return releasePending(state === 'awaiting-redraw')
    }
  }
}
