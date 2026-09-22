import { describe, expect, it } from 'vitest'
import { MAX_TERMINAL_TRANSCRIPT_CHARS } from '../shared/terminalBuffer'
import { createInitialCommandEchoFilter, type TerminalOutputMapper } from './terminalStartupEcho'

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
})
