import { describe, expect, it } from 'vitest'
import { MAX_TERMINAL_TRANSCRIPT_CHARS } from '../shared/terminalBuffer'
import {
  createInitialCommandEchoFilter,
  type StartupEchoContext,
  type TerminalOutputMapper
} from './terminalStartupEcho'
import {
  CAPTURED_PROGRAM_OUTPUT,
  CAPTURED_ZSH_BANNER,
  DARWIN_STARTUP_CONTEXT,
  MACOS_CAPTURED_COMMAND,
  MACOS_CAPTURED_REDRAW,
  MACOS_CAPTURED_STREAM,
  WIN32_80_COLUMN_STREAM,
  WIN32_CAPTURED_COMMAND,
  WIN32_CAPTURED_PREFIX,
  WIN32_CAPTURED_REDRAW,
  WIN32_CAPTURED_STREAM,
  WIN32_STARTUP_CONTEXT
} from './terminalStartupEchoFixtures'

const DARWIN_CONTEXT = DARWIN_STARTUP_CONTEXT
const WIN32_CONTEXT = WIN32_STARTUP_CONTEXT
const MACOS_COMMAND = MACOS_CAPTURED_COMMAND
const MACOS_STREAM = MACOS_CAPTURED_STREAM
// The filter itself restores the raw executed command; display expansion is
// the ProcessRunner display mapper's job.
const MACOS_EXPECTED = [
  '\r\n',
  ...CAPTURED_ZSH_BANNER.flatMap((line) => [line, '\r\n']),
  '\u001b[?1034hCLILOOM$ ',
  MACOS_CAPTURED_COMMAND,
  '\r\n',
  CAPTURED_PROGRAM_OUTPUT
].join('')
const WIN32_COMMAND = WIN32_CAPTURED_COMMAND
const WIN32_STREAM = WIN32_CAPTURED_STREAM
const WIN32_EXPECTED = `${WIN32_CAPTURED_PREFIX}CLILOOM$ ${WIN32_CAPTURED_COMMAND}\r\n${CAPTURED_PROGRAM_OUTPUT}`

const COMMAND = `printf '%s' "UI 改动\${CLILOOM_INTERNAL_VALUE_0}"; exit`
const DISPLAY_COMMAND = `printf '%s' "UI 改动实际参数"; exit`
const PROMPT = '\u001b]0;cliloom\u0007\u001b[32muser@host:/repo\u001b[0m$ '
const PROGRAM_OUTPUT = '程序输出 😀 done\r\n'

const DRAW_FRAGMENT = ' \u001b[K'
const DRAW_FRAGMENT_ZERO = ' \u001b[0K'

function insertFragments(
  command: string,
  insertions: Array<{ afterIndex: number; fragment: string }>
): string {
  const sorted = [...insertions].sort((a, b) => b.afterIndex - a.afterIndex)
  let redrawn = command
  for (const insertion of sorted) {
    redrawn = redrawn.slice(0, insertion.afterIndex) + insertion.fragment + redrawn.slice(insertion.afterIndex)
  }
  return redrawn
}

// Mirrors the captured Bash behavior: the padding space plus erase-to-end-of-line
// sequence is inserted before wide glyphs, so the fragment's leading space ends
// up adjacent to the command's own spaces.
const PADDED_REDRAWN = insertFragments(COMMAND, [
  { afterIndex: COMMAND.indexOf('改'), fragment: DRAW_FRAGMENT },
  { afterIndex: COMMAND.indexOf('${'), fragment: DRAW_FRAGMENT }
])

const MULTIPLE_FRAGMENT_REDRAWN = insertFragments(COMMAND, [
  { afterIndex: COMMAND.indexOf('改'), fragment: DRAW_FRAGMENT },
  { afterIndex: COMMAND.indexOf('动') + 1, fragment: DRAW_FRAGMENT_ZERO },
  { afterIndex: COMMAND.indexOf('exit') - 1, fragment: DRAW_FRAGMENT }
])

function mapAll(filter: TerminalOutputMapper, chunks: string[]): string {
  let output = ''
  for (const chunk of chunks) output += filter.map(chunk)
  return output
}

function splitInto(content: string, size: number): string[] {
  const chunks: string[] = []
  for (let index = 0; index < content.length; index += size) {
    chunks.push(content.slice(index, index + size))
  }
  return chunks
}

describe('createInitialCommandEchoFilter', () => {
  it('returns null for an empty command', () => {
    expect(createInitialCommandEchoFilter('')).toBeNull()
  })

  it('holds an incomplete bare echo prefix and releases it once on flush', () => {
    const filter = createInitialCommandEchoFilter(COMMAND)!
    expect(filter.map(COMMAND.slice(0, 12))).toBe('')
    expect(filter.map(COMMAND.slice(12, 30))).toBe('')
    expect(filter.flush()).toBe(COMMAND.slice(0, 30))
    expect(filter.flush()).toBe('')
    expect(filter.map('later')).toBe('later')
  })

  it('releases non-echo output in the same map call without waiting for a newline', () => {
    const filter = createInitialCommandEchoFilter(COMMAND)!
    expect(filter.map('Password: ')).toBe('Password: ')
    expect(filter.map('more input')).toBe('more input')
    expect(filter.flush()).toBe('')
  })

  it('releases a held command prefix as soon as following text diverges without a newline', () => {
    const filter = createInitialCommandEchoFilter(COMMAND)!
    const prefix = COMMAND.slice(0, 20)
    expect(filter.map(prefix)).toBe('')
    expect(filter.map('x divergence\r\n')).toBe(`${prefix}x divergence\r\n`)
    expect(filter.map('later data')).toBe('later data')
    expect(filter.flush()).toBe('')
  })

  it('keeps passthrough for a single redrawn command with no bare echo', () => {
    const filter = createInitialCommandEchoFilter(COMMAND)!
    const stream = `${PROMPT}${COMMAND}\r\n${PROGRAM_OUTPUT}`
    expect(mapAll(filter, [stream])).toBe(stream)
  })

  it('keeps passthrough for a single fragmented command with no bare echo', () => {
    const filter = createInitialCommandEchoFilter(COMMAND)!
    const stream = `${PROMPT}${PADDED_REDRAWN}\r\n${PROGRAM_OUTPUT}`
    expect(mapAll(filter, [stream])).toBe(stream)
  })

  it('keeps banner output untouched even when it mentions command-like text', () => {
    const filter = createInitialCommandEchoFilter(COMMAND)!
    const banner = `welcome to printf '%s' shell\r\nsecond line\r\n`
    expect(mapAll(filter, [banner])).toBe(banner)
  })
})

describe('createInitialCommandEchoFilter exact redraw matching', () => {
  it('preserves exact matching after a bare echo with a custom prompt', () => {
    const filter = createInitialCommandEchoFilter(COMMAND)!
    const stream = `${COMMAND}\r\ncustom> ${COMMAND}\r\n`
    expect(mapAll(filter, Array.from(stream))).toBe(`custom> ${COMMAND}\r\n`)
  })
  it('removes the bare echo after an exact redraw with CRLF', () => {
    const filter = createInitialCommandEchoFilter(COMMAND)!
    const stream = `${COMMAND}\r\n${PROMPT}${COMMAND}\r\n${PROGRAM_OUTPUT}`
    expect(mapAll(filter, [stream])).toBe(`${PROMPT}${COMMAND}\r\n${PROGRAM_OUTPUT}`)
    expect(filter.flush()).toBe('')
  })

  it('removes the bare echo after an exact redraw with LF', () => {
    const filter = createInitialCommandEchoFilter(COMMAND)!
    const stream = `${COMMAND}\n${PROMPT}${COMMAND}\n${PROGRAM_OUTPUT}`
    expect(mapAll(filter, [stream])).toBe(`${PROMPT}${COMMAND}\n${PROGRAM_OUTPUT}`)
  })

  it('restores the bare echo when the next line is not a redraw', () => {
    const filter = createInitialCommandEchoFilter(COMMAND)!
    const stream = `${COMMAND}\r\n$ ready\r\n${PROGRAM_OUTPUT}`
    expect(mapAll(filter, [stream])).toBe(stream)
  })

  it('restores the bare echo when the stream ends before a redraw', () => {
    const filter = createInitialCommandEchoFilter(COMMAND)!
    expect(filter.map(`${COMMAND}\r\n${PROMPT}${COMMAND.slice(0, 10)}`)).toBe('')
    expect(filter.flush()).toBe(`${COMMAND}\r\n${PROMPT}${COMMAND.slice(0, 10)}`)
    expect(filter.flush()).toBe('')
  })

  it('keeps the exact-only behavior for commands containing control characters', () => {
    const command = 'printf \u001b[1m bold\nsecond'
    const filter = createInitialCommandEchoFilter(command)!
    const exact = `${command}\r\n$ ${command}\r\nout\r\n`
    expect(mapAll(filter, [exact])).toBe(`$ ${command}\r\nout\r\n`)

    const fragmented = createInitialCommandEchoFilter(command)!
    const redrawn = `${command.slice(0, 8)}${DRAW_FRAGMENT}${command.slice(8)}`
    const stream = `${command}\r\n$ ${redrawn}\r\nout\r\n`
    expect(mapAll(fragmented, [stream])).toBe(stream)
  })
})

describe('createInitialCommandEchoFilter tolerant redraw matching', () => {
  it('recognizes a redraw padded with draw fragments and restores the original command', () => {
    const filter = createInitialCommandEchoFilter(COMMAND)!
    const stream = `${COMMAND}\r\n${PROMPT}${PADDED_REDRAWN}\r\n${PROGRAM_OUTPUT}`
    expect(mapAll(filter, [stream])).toBe(`${PROMPT}${COMMAND}\r\n${PROGRAM_OUTPUT}`)
    expect(filter.flush()).toBe('')
  })

  it('recognizes multiple fragments including the explicit ESC[0K form', () => {
    const filter = createInitialCommandEchoFilter(COMMAND)!
    const stream = `${COMMAND}\r\n${PROMPT}${MULTIPLE_FRAGMENT_REDRAWN}\r\n${PROGRAM_OUTPUT}`
    expect(mapAll(filter, [stream])).toBe(`${PROMPT}${COMMAND}\r\n${PROGRAM_OUTPUT}`)
  })

  it('recognizes consecutive fragments between command characters', () => {
    const filter = createInitialCommandEchoFilter(COMMAND)!
    const redrawn = insertFragments(COMMAND, [
      { afterIndex: COMMAND.indexOf('改'), fragment: `${DRAW_FRAGMENT}${DRAW_FRAGMENT_ZERO}` }
    ])
    const stream = `${COMMAND}\r\n${PROMPT}${redrawn}\r\n${PROGRAM_OUTPUT}`
    expect(mapAll(filter, [stream])).toBe(`${PROMPT}${COMMAND}\r\n${PROGRAM_OUTPUT}`)
  })

  it('keeps the command result consistent when there are no variables to expand', () => {
    const filter = createInitialCommandEchoFilter(DISPLAY_COMMAND)!
    const redrawn = insertFragments(DISPLAY_COMMAND, [
      { afterIndex: DISPLAY_COMMAND.indexOf('改'), fragment: DRAW_FRAGMENT }
    ])
    const stream = `${DISPLAY_COMMAND}\r\n$ ${redrawn}\r\n${PROGRAM_OUTPUT}`
    expect(mapAll(filter, [stream])).toBe(`$ ${DISPLAY_COMMAND}\r\n${PROGRAM_OUTPUT}`)
  })

  it('preserves original spaces adjacent to draw fragments', () => {
    const command = 'echo two  spaces 改动 done'
    const redrawnSpacesBefore = insertFragments(command, [
      { afterIndex: command.indexOf(' 改动'), fragment: DRAW_FRAGMENT }
    ])
    const redrawnSpacesAfter = insertFragments(command, [
      { afterIndex: command.indexOf('  ') + 1, fragment: DRAW_FRAGMENT }
    ])
    for (const redrawn of [redrawnSpacesBefore, redrawnSpacesAfter]) {
      const filter = createInitialCommandEchoFilter(command)!
      const stream = `${command}\r\n$ ${redrawn}\r\n`
      expect(mapAll(filter, [stream])).toBe(`$ ${command}\r\n`)
    }
  })

  it('does not treat unknown control sequences as draw fragments', () => {
    const filter = createInitialCommandEchoFilter(COMMAND)!
    const redrawn = insertFragments(COMMAND, [
      { afterIndex: COMMAND.indexOf('改'), fragment: ' \u001b[1K' }
    ])
    const stream = `${COMMAND}\r\n${PROMPT}${redrawn}\r\n${PROGRAM_OUTPUT}`
    expect(mapAll(filter, [stream])).toBe(stream)
  })

  it('does not remove the bare echo when real characters follow the redrawn command', () => {
    const filter = createInitialCommandEchoFilter(COMMAND)!
    const stream = `${COMMAND}\r\n${PROMPT}${PADDED_REDRAWN} extra\r\n${PROGRAM_OUTPUT}`
    expect(mapAll(filter, [stream])).toBe(stream)
  })

  it('does not remove the bare echo for a redraw prefix that stops early', () => {
    const filter = createInitialCommandEchoFilter(COMMAND)!
    const partial = insertFragments(COMMAND.slice(0, COMMAND.length - 5), [
      { afterIndex: COMMAND.slice(0, COMMAND.length - 5).indexOf('改'), fragment: DRAW_FRAGMENT }
    ])
    const stream = `${COMMAND}\r\n${PROMPT}${partial}\r\n${PROGRAM_OUTPUT}`
    expect(mapAll(filter, [stream])).toBe(stream)
  })

  it('does not search beyond the first logical line after the bare echo', () => {
    const filter = createInitialCommandEchoFilter(COMMAND)!
    const stream = `${COMMAND}\r\n$ unrelated\r\n${PROMPT}${PADDED_REDRAWN}\r\n`
    expect(mapAll(filter, [stream])).toBe(stream)
  })

  it('passes later repeated occurrences through after a successful match', () => {
    const filter = createInitialCommandEchoFilter(COMMAND)!
    const first = `${COMMAND}\r\n${PROMPT}${PADDED_REDRAWN}\r\n`
    expect(mapAll(filter, [first])).toBe(`${PROMPT}${COMMAND}\r\n`)
    const repeated = `${COMMAND}\r\n${COMMAND}\r\n`
    expect(filter.map(repeated)).toBe(repeated)
    expect(filter.flush()).toBe('')
  })

  it('recognizes the redraw across exhaustive split positions of the fixture', () => {
    const stream = `${COMMAND}\r\n${PROMPT}${PADDED_REDRAWN}\r\n${PROGRAM_OUTPUT}`
    const expected = `${PROMPT}${COMMAND}\r\n${PROGRAM_OUTPUT}`
    for (let split = 0; split <= stream.length; split++) {
      const filter = createInitialCommandEchoFilter(COMMAND)!
      const output = mapAll(filter, [stream.slice(0, split), stream.slice(split)])
      expect(output, `split at ${split}`).toBe(expected)
      expect(filter.flush(), `flush after split at ${split}`).toBe('')
    }
  })

  it('recognizes the redraw with character, 7-character and mixed chunk sizes', () => {
    const stream = `${COMMAND}\r\n${PROMPT}${MULTIPLE_FRAGMENT_REDRAWN}\r\n${PROGRAM_OUTPUT}`
    const expected = `${PROMPT}${COMMAND}\r\n${PROGRAM_OUTPUT}`
    for (const size of [1, 7, 1024]) {
      const filter = createInitialCommandEchoFilter(COMMAND)!
      expect(mapAll(filter, splitInto(stream, size)), `chunk size ${size}`).toBe(expected)
    }
    const filter = createInitialCommandEchoFilter(COMMAND)!
    const firstPass = mapAll(filter, [
      stream.slice(0, 3),
      stream.slice(3, 8),
      stream.slice(8, 45),
      stream.slice(45)
    ])
    expect(firstPass).toBe(expected)
    expect(filter.map(stream)).toBe(stream)
  })

  it('handles surrogate pairs split across chunks', () => {
    const command = 'printf "😀 改动 🚀 done"'
    const filter = createInitialCommandEchoFilter(command)!
    const redrawn = insertFragments(command, [
      { afterIndex: command.indexOf('🚀'), fragment: DRAW_FRAGMENT }
    ])
    const emojiStart = command.indexOf('😀')
    const chunks = [
      `${command}\r\n$ ${redrawn.slice(0, emojiStart)}`,
      redrawn.slice(emojiStart, emojiStart + 1),
      `${redrawn.slice(emojiStart + 1)}\r\n`
    ]
    expect(mapAll(filter, chunks)).toBe(`$ ${command}\r\n`)
  })

  it('releases buffered content once the transcript cap is exceeded and stays in passthrough', () => {
    const filter = createInitialCommandEchoFilter(COMMAND)!
    expect(filter.map(`${COMMAND}\r\n`)).toBe('')
    const filler = 'x'.repeat(MAX_TERMINAL_TRANSCRIPT_CHARS)
    const released = filter.map(filler)
    expect(released.startsWith(`${COMMAND}\r\n`)).toBe(true)
    expect(released.endsWith(filler.slice(-4))).toBe(true)
    expect(filter.map('tail')).toBe('tail')
    expect(filter.flush()).toBe('')
  })

  it('releases an oversized bare-echo prefix once it passes the transcript cap', () => {
    const command = 'c'.repeat(MAX_TERMINAL_TRANSCRIPT_CHARS + 50)
    const filter = createInitialCommandEchoFilter(command)!
    const heldPrefix = command.slice(0, MAX_TERMINAL_TRANSCRIPT_CHARS - 10)
    expect(filter.map(heldPrefix)).toBe('')
    expect(filter.map(command.slice(MAX_TERMINAL_TRANSCRIPT_CHARS - 10))).toBe(command)
    expect(filter.map(' divergence')).toBe(' divergence')
    expect(filter.flush()).toBe('')
  })

  it('keeps the scan linear for a highly repetitive candidate line without a redraw', () => {
    const command = 'a'.repeat(20_000)
    const stream = `${command}\r\n$ ${'a'.repeat(40_000)}b\r\nafter\r\n`
    const filter = createInitialCommandEchoFilter(command)!
    const startedAt = Date.now()
    expect(filter.map(stream)).toBe(stream)
    expect(Date.now() - startedAt).toBeLessThan(2_000)
    expect(filter.flush()).toBe('')
  })

  it('finds a redraw after a long repetitive prefix in linear time', () => {
    const command = 'a'.repeat(20_000)
    const prompt = `${'b'.repeat(40_000)}$ `
    const stream = `${command}\r\n${prompt}${command}\r\n`
    const filter = createInitialCommandEchoFilter(command)!
    const startedAt = Date.now()
    expect(filter.map(stream)).toBe(`${prompt}${command}\r\n`)
    expect(Date.now() - startedAt).toBeLessThan(2_000)
    expect(filter.flush()).toBe('')
  })

  it('handles long bare echoes and redraws one character at a time without rescanning prefixes', () => {
    const command = 'a'.repeat(40_000)
    const stream = `${command}\r\n$ ${command}\r\n`
    const filter = createInitialCommandEchoFilter(command)!
    const startedAt = Date.now()
    expect(mapAll(filter, Array.from(stream))).toBe(`$ ${command}\r\n`)
    expect(Date.now() - startedAt).toBeLessThan(2_000)
  })
})

describe('createInitialCommandEchoFilter captured macOS Bash startup', () => {
  it('recognizes the migration banner and the CR-segmented redraw', () => {
    const filter = createInitialCommandEchoFilter(MACOS_COMMAND, DARWIN_CONTEXT)!
    expect(filter.isPending()).toBe(true)
    const first = filter.map(MACOS_STREAM.slice(0, 200))
    expect(first).toBe('')
    expect(filter.isPending()).toBe(true)
    expect(first + filter.map(MACOS_STREAM.slice(200))).toBe(MACOS_EXPECTED)
    expect(filter.isPending()).toBe(false)
    expect(filter.flush()).toBe('')
    expect(filter.map(MACOS_COMMAND)).toBe(MACOS_COMMAND)
  })

  it('produces the same result for every split position of the captured stream', () => {
    for (let split = 0; split <= MACOS_STREAM.length; split++) {
      const filter = createInitialCommandEchoFilter(MACOS_COMMAND, DARWIN_CONTEXT)!
      const output = mapAll(filter, [MACOS_STREAM.slice(0, split), MACOS_STREAM.slice(split)])
      expect(output, `split at ${split}`).toBe(MACOS_EXPECTED)
      expect(filter.flush(), `flush after split at ${split}`).toBe('')
    }
    for (const size of [1, 7, 1024]) {
      const filter = createInitialCommandEchoFilter(MACOS_COMMAND, DARWIN_CONTEXT)!
      expect(mapAll(filter, splitInto(MACOS_STREAM, size)), `chunk size ${size}`).toBe(MACOS_EXPECTED)
    }
  })

  it('falls back when the banner is unknown or truncated', () => {
    const unknownBanner = MACOS_STREAM.replace(
      CAPTURED_ZSH_BANNER[0],
      'A completely different notice.'
    )
    const filter = createInitialCommandEchoFilter(MACOS_COMMAND, DARWIN_CONTEXT)!
    expect(filter.map(unknownBanner)).toBe(unknownBanner)
    expect(filter.isPending()).toBe(false)

    const truncated = createInitialCommandEchoFilter(MACOS_COMMAND, DARWIN_CONTEXT)!
    const cut = MACOS_STREAM.slice(
      0,
      MACOS_STREAM.indexOf('https://support.apple.com') + 12
    )
    expect(truncated.map(cut)).toBe('')
    expect(truncated.isPending()).toBe(true)
    expect(truncated.flush()).toBe(cut)
  })

  it('keeps the CR-segment tolerance exclusive to darwin', () => {
    const linuxContext: StartupEchoContext = { family: 'posix', platform: 'linux', cols: 40 }
    const filter = createInitialCommandEchoFilter(MACOS_COMMAND, linuxContext)!
    expect(filter.map(MACOS_STREAM)).toBe(MACOS_STREAM)
    expect(filter.isPending()).toBe(false)
  })

  it('does not search for the redraw beyond a non-matching first line', () => {
    const stream = `${MACOS_COMMAND}\r\n$ unrelated\r\n${MACOS_CAPTURED_REDRAW}\r\n`
    const filter = createInitialCommandEchoFilter(MACOS_COMMAND, DARWIN_CONTEXT)!
    expect(filter.map(stream)).toBe(stream)
  })

  it('falls back when a CR segment does not reproduce the command', () => {
    const broken = MACOS_STREAM.replace('\rt 与 npm run typecheck', '\rx 与 npm run typecheck')
    const filter = createInitialCommandEchoFilter(MACOS_COMMAND, DARWIN_CONTEXT)!
    expect(filter.map(broken)).toBe(broken)
  })
})

describe('createInitialCommandEchoFilter captured Windows Git Bash startup', () => {
  it('recognizes the captured second-row boundary at 80 columns across every split', () => {
    for (let split = 0; split <= WIN32_80_COLUMN_STREAM.length; split++) {
      const filter = createInitialCommandEchoFilter(WIN32_CAPTURED_COMMAND, { ...WIN32_CONTEXT, cols: 80 })!
      expect(mapAll(filter, [WIN32_80_COLUMN_STREAM.slice(0, split), WIN32_80_COLUMN_STREAM.slice(split)]))
        .toBe(`${WIN32_CAPTURED_PREFIX}CLILOOM$ ${WIN32_CAPTURED_COMMAND}\r\n${CAPTURED_PROGRAM_OUTPUT}`)
    }
  })

  it.each([40, 80, 100, 120])('accepts only the actual row and column at a %i-column wrap', (cols) => {
    const before = `printf "${'a'.repeat(cols * 2 - 'CLILOOM$ '.length - 'printf "'.length - 1)}`
    const command = `${before}😀"; exit`
    const redraw = `${before} \u001b[?2004l\u001b[2;${cols}H 😀"; exit`
    const stream = `${WIN32_CAPTURED_PREFIX}CLILOOM$ ${redraw}\r\n`
    const filter = createInitialCommandEchoFilter(command, { ...WIN32_CONTEXT, cols })!
    expect(mapAll(filter, Array.from(stream))).toBe(`${WIN32_CAPTURED_PREFIX}CLILOOM$ ${command}\r\n`)
    for (const position of [`1;${cols}`, `3;${cols}`, `2;${cols - 1}`]) {
      const invalid = stream.replace(`[2;${cols}H`, `[${position}H`)
      const fallback = createInitialCommandEchoFilter(command, { ...WIN32_CONTEXT, cols })!
      expect(mapAll(fallback, Array.from(invalid))).toBe(invalid)
    }
  })

  it('normalizes the first prompted draw without a bare echo', () => {
    const filter = createInitialCommandEchoFilter(WIN32_COMMAND, WIN32_CONTEXT)!
    expect(filter.isPending()).toBe(true)
    expect(filter.map(WIN32_STREAM)).toBe(WIN32_EXPECTED)
    expect(filter.isPending()).toBe(false)
    expect(filter.flush()).toBe('')
    expect(filter.map(WIN32_COMMAND)).toBe(WIN32_COMMAND)
  })

  it('produces the same result for every split position of the captured stream', () => {
    for (let split = 0; split <= WIN32_STREAM.length; split++) {
      const filter = createInitialCommandEchoFilter(WIN32_COMMAND, WIN32_CONTEXT)!
      const output = mapAll(filter, [WIN32_STREAM.slice(0, split), WIN32_STREAM.slice(split)])
      expect(output, `split at ${split}`).toBe(WIN32_EXPECTED)
    }
    for (const size of [1, 7, 1024]) {
      const filter = createInitialCommandEchoFilter(WIN32_COMMAND, WIN32_CONTEXT)!
      expect(mapAll(filter, splitInto(WIN32_STREAM, size)), `chunk size ${size}`).toBe(WIN32_EXPECTED)
    }
  })

  it('holds the first draw until its line ends and releases it on flush', () => {
    const filter = createInitialCommandEchoFilter(WIN32_COMMAND, WIN32_CONTEXT)!
    const partial = WIN32_STREAM.slice(0, WIN32_STREAM.indexOf('\r\n'))
    expect(filter.map(partial)).toBe('')
    expect(filter.isPending()).toBe(true)
    expect(filter.flush()).toBe(partial)
    expect(filter.flush()).toBe('')
    expect(filter.isPending()).toBe(false)
  })

  it('falls back when cursor positioning targets a non-boundary column', () => {
    for (const column of [30, 41]) {
      const misplaced = WIN32_STREAM.replace('\u001b[1;40H', `\u001b[1;${column}H`)
      const filter = createInitialCommandEchoFilter(WIN32_COMMAND, WIN32_CONTEXT)!
      expect(filter.map(misplaced), `column ${column}`).toBe(misplaced)
      expect(filter.isPending()).toBe(false)
    }
  })

  it('falls back when the paste toggle or positioning appears in other contexts', () => {
    const darwinFilter = createInitialCommandEchoFilter(WIN32_COMMAND, DARWIN_CONTEXT)!
    expect(darwinFilter.map(WIN32_STREAM)).toBe(WIN32_STREAM)

    const linuxFilter = createInitialCommandEchoFilter(WIN32_COMMAND, {
      family: 'posix',
      platform: 'linux',
      cols: 40
    })!
    expect(linuxFilter.map(WIN32_STREAM)).toBe(WIN32_STREAM)
  })

  it('falls back when extra text follows the first draw', () => {
    const stream = `${WIN32_CAPTURED_PREFIX}CLILOOM$ ${WIN32_CAPTURED_REDRAW} extra\r\n`
    const filter = createInitialCommandEchoFilter(WIN32_COMMAND, WIN32_CONTEXT)!
    expect(filter.map(stream)).toBe(stream)
  })

  it('releases plain interactive prompts immediately without a control prefix', () => {
    const filter = createInitialCommandEchoFilter(WIN32_COMMAND, WIN32_CONTEXT)!
    expect(filter.map('Password: ')).toBe('Password: ')
    expect(filter.isPending()).toBe(false)
    expect(filter.map('wty@host:/repo$ ')).toBe('wty@host:/repo$ ')
  })
})

describe('createInitialCommandEchoFilter recognition lifecycle', () => {
  it('preserves unknown startup controls and trailing draw controls', () => {
    for (const stream of [
      `${COMMAND}\r\n\u001b[9A$ ${COMMAND}\r\n`,
      `${COMMAND}\r\nuser\u001b[9A$ ${COMMAND}\r\n`,
      `${COMMAND}\r\n$ ${COMMAND}\u001b[0m\r\n`
    ]) {
      const filter = createInitialCommandEchoFilter(COMMAND)!
      expect(filter.map(stream) + filter.flush()).toBe(stream)
      expect(filter.isPending()).toBe(false)
    }
  })

  it('reports pending only until the recognizer reaches a final state', () => {
    const held = createInitialCommandEchoFilter(COMMAND)!
    expect(held.isPending()).toBe(true)
    expect(held.map(COMMAND.slice(0, 10))).toBe('')
    expect(held.isPending()).toBe(true)
    expect(held.map('x divergence\r\n')).toBe(`${COMMAND.slice(0, 10)}x divergence\r\n`)
    expect(held.isPending()).toBe(false)
    expect(held.map('later')).toBe('later')

    const succeeded = createInitialCommandEchoFilter(COMMAND)!
    succeeded.map(`${COMMAND}\r\n$ ${COMMAND}\r\n`)
    expect(succeeded.isPending()).toBe(false)

    const capped = createInitialCommandEchoFilter(COMMAND)!
    capped.map(`${COMMAND}\r\n`)
    capped.map('x'.repeat(MAX_TERMINAL_TRANSCRIPT_CHARS))
    expect(capped.isPending()).toBe(false)

    const flushed = createInitialCommandEchoFilter(COMMAND)!
    flushed.map(COMMAND.slice(0, 5))
    flushed.flush()
    expect(flushed.isPending()).toBe(false)
  })

  it('recognizes a root-style hash prompt', () => {
    const filter = createInitialCommandEchoFilter(COMMAND)!
    const stream = `${COMMAND}\r\nroot@host:/repo# ${COMMAND}\r\nout\r\n`
    expect(mapAll(filter, [stream])).toBe(`root@host:/repo# ${COMMAND}\r\nout\r\n`)
  })

  it('keeps exact-only semantics for non-POSIX shell families', () => {
    const context: StartupEchoContext = { family: 'powershell', platform: 'win32' }
    const fragmented = createInitialCommandEchoFilter(COMMAND, context)!
    const redrawn = insertFragments(COMMAND, [
      { afterIndex: COMMAND.indexOf('改'), fragment: DRAW_FRAGMENT }
    ])
    const stream = `${COMMAND}\r\nPS> ${redrawn}\r\n`
    expect(fragmented.map(stream)).toBe(stream)

    const exact = createInitialCommandEchoFilter(COMMAND, context)!
    const exactStream = `${COMMAND}\r\nPS> ${COMMAND}\r\n`
    expect(exact.map(exactStream)).toBe(`PS> ${COMMAND}\r\n`)
  })
})
