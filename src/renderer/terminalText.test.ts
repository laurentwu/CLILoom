import { describe, expect, it, vi } from 'vitest'
import {
  getSelectionTextWithin,
  getTerminalTextSnapshot,
  serializeTerminalBuffer,
  type TerminalBufferLike,
  type TerminalBufferLineLike
} from './terminalText'

function createLine(
  text: string,
  isWrapped = false,
  contentLength = text.length
): TerminalBufferLineLike {
  const cells = Array.from(text, (character, index) => ({
    getChars: () => index < contentLength ? character : '',
    getWidth: () => 1
  }))
  return {
    isWrapped,
    length: text.length,
    getCell: (index) => cells[index],
    translateToString(trimRight = false, startColumn = 0, endColumn = text.length) {
      const value = text.slice(startColumn, endColumn)
      return trimRight ? value.trimEnd() : value
    }
  }
}

function createCellLine(
  cells: Array<{ chars: string; width: number }>,
  isWrapped = false
): TerminalBufferLineLike {
  return {
    isWrapped,
    length: cells.length,
    getCell: (index) => {
      const cell = cells[index]
      return cell
        ? { getChars: () => cell.chars, getWidth: () => cell.width }
        : undefined
    },
    translateToString(_trimRight = false, startColumn = 0, endColumn = cells.length) {
      return cells.slice(startColumn, endColumn).map((cell) => cell.chars).join('')
    }
  }
}

function createBuffer(
  lines: Array<TerminalBufferLineLike | undefined>,
  cursorIndex = lines.length - 1,
  baseY = 0
): TerminalBufferLike {
  return {
    baseY,
    cursorY: Math.max(0, cursorIndex - baseY),
    length: lines.length,
    getLine: (index) => lines[index]
  }
}

describe('serializeTerminalBuffer', () => {
  it('returns an empty string for an empty buffer without reading any line', () => {
    const getLine = vi.fn()
    const buffer: TerminalBufferLike = { baseY: 0, cursorY: 0, length: 0, getLine }

    expect(serializeTerminalBuffer(buffer, 20)).toBe('')
    expect(getLine).not.toHaveBeenCalled()
  })

  it.each([0, -3])('returns an empty string for a non-positive terminal width of %i', (columns) => {
    const buffer = createBuffer([createLine('has content')], 0)

    expect(serializeTerminalBuffer(buffer, columns)).toBe('')
  })

  it('treats a missing physical line as an empty hard break and keeps following content', () => {
    const buffer = createBuffer([
      undefined,
      createLine('after')
    ], 1)

    expect(serializeTerminalBuffer(buffer, 20)).toBe('\nafter')
  })

  it('joins visually wrapped rows without adding a markdown line break', () => {
    const buffer = createBuffer([
      createLine('# Headin'),
      createLine('g', true),
      createLine('paragraph')
    ])

    expect(serializeTerminalBuffer(buffer, 20)).toBe('# Heading\nparagraph')
  })

  it('preserves spaces at a soft-wrap boundary and trims terminal padding at a hard break', () => {
    const buffer = createBuffer([
      createLine('word   '),
      createLine('next   ', true, 4),
      createLine('done   ', false, 4)
    ])

    expect(serializeTerminalBuffer(buffer, 20)).toBe('word   next\ndone')
  })

  it('preserves explicit trailing spaces used by markdown hard line breaks', () => {
    const buffer = createBuffer([
      createLine('first  '),
      createLine('second')
    ])

    expect(serializeTerminalBuffer(buffer, 20)).toBe('first  \nsecond')
  })

  it('keeps hard blank lines through the cursor while dropping empty screen rows after it', () => {
    const buffer = createBuffer([
      createLine('first'),
      createLine(''),
      createLine('third'),
      createLine(''),
      createLine(''),
      createLine('')
    ], 3)

    expect(serializeTerminalBuffer(buffer, 20)).toBe('first\n\nthird\n')
  })

  it('includes non-empty screen content below a cursor moved upward', () => {
    const buffer = createBuffer([
      createLine('top'),
      createLine('cursor'),
      createLine('below'),
      createLine('')
    ], 1)

    expect(serializeTerminalBuffer(buffer, 20)).toBe('top\ncursor\nbelow')
  })

  it('respects the current terminal width after a resize', () => {
    const buffer = createBuffer([createLine('visible-stale-cells')], 0)

    expect(serializeTerminalBuffer(buffer, 7)).toBe('visible')
  })

  it('uses real terminal cell widths for double-width Chinese and emoji glyphs', () => {
    const buffer = createBuffer([
      createCellLine([
        { chars: '中', width: 2 },
        { chars: '', width: 0 },
        { chars: '👩‍💻', width: 2 },
        { chars: '', width: 0 },
        { chars: '!', width: 1 },
        { chars: '', width: 1 },
        { chars: '', width: 1 }
      ])
    ])

    expect(serializeTerminalBuffer(buffer, 7)).toBe('中👩‍💻!')
  })

  it('uses baseY plus cursorY when scrollback is present', () => {
    const buffer = createBuffer([
      createLine('history one'),
      createLine('history two'),
      createLine('history three'),
      createLine('screen one'),
      createLine('cursor'),
      createLine(''),
      createLine('')
    ], 4, 3)

    expect(serializeTerminalBuffer(buffer, 20)).toBe(
      'history one\nhistory two\nhistory three\nscreen one\ncursor'
    )
  })
})

describe('getTerminalTextSnapshot', () => {
  const buffer = createBuffer([createLine('all output')], 0)

  it('uses an active selection even when it contains only whitespace', () => {
    expect(getTerminalTextSnapshot({
      buffer: { active: buffer },
      cols: 20,
      getSelection: () => '  ',
      hasSelection: () => true
    })).toEqual({ source: 'selection', text: '  ' })
  })

  it('uses the active buffer when there is no selection', () => {
    expect(getTerminalTextSnapshot({
      buffer: { active: buffer },
      cols: 20,
      getSelection: () => '',
      hasSelection: () => false
    })).toEqual({ source: 'all', text: 'all output' })
  })

  it('follows xterm when the active buffer switches to alternate mode', () => {
    const normal = createBuffer([createLine('normal history')], 0)
    const alternate = createBuffer([createLine('alternate screen')], 0)
    let active = normal
    const terminal = {
      buffer: { get active() { return active } },
      cols: 20,
      getSelection: () => '',
      hasSelection: () => false
    }

    expect(getTerminalTextSnapshot(terminal).text).toBe('normal history')
    active = alternate
    expect(getTerminalTextSnapshot(terminal).text).toBe('alternate screen')
  })
})

describe('getSelectionTextWithin', () => {
  const insideA = {} as Node
  const insideB = {} as Node
  const outside = {} as Node
  const container = {
    contains: (node: Node | null) => node === insideA || node === insideB
  }

  it('returns a non-collapsed selection wholly inside the terminal output', () => {
    expect(getSelectionTextWithin(container, {
      anchorNode: insideA,
      focusNode: insideB,
      isCollapsed: false,
      rangeCount: 1,
      toString: () => 'selected'
    })).toBe('selected')
  })

  it('rejects selections that cross outside the terminal output', () => {
    expect(getSelectionTextWithin(container, {
      anchorNode: insideA,
      focusNode: outside,
      isCollapsed: false,
      rangeCount: 1,
      toString: () => 'crossed'
    })).toBeNull()
  })
})
