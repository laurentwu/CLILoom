export type TerminalTextSnapshot = {
  source: 'selection' | 'all'
  text: string
}

export type TerminalBufferLineLike = {
  readonly isWrapped: boolean
  readonly length: number
  getCell: (index: number) => TerminalBufferCellLike | undefined
  translateToString: (trimRight?: boolean, startColumn?: number, endColumn?: number) => string
}

export type TerminalBufferCellLike = {
  getChars: () => string
  getWidth: () => number
}

export type TerminalBufferLike = {
  readonly baseY: number
  readonly cursorY: number
  readonly length: number
  getLine: (index: number) => TerminalBufferLineLike | undefined
}

export type TerminalTextSourceLike = {
  readonly cols: number
  readonly buffer: { readonly active: TerminalBufferLike }
  getSelection: () => string
  hasSelection: () => boolean
}

type SelectionLike = {
  readonly anchorNode: Node | null
  readonly focusNode: Node | null
  readonly isCollapsed: boolean
  readonly rangeCount: number
  toString: () => string
}

type SelectionContainerLike = {
  contains: (node: Node | null) => boolean
}

type PhysicalTerminalLine = {
  isWrapped: boolean
  line?: TerminalBufferLineLike
}

function getMaximumLineEndColumn(line: TerminalBufferLineLike, columns: number): number {
  return Math.max(0, Math.min(columns, line.length))
}

function getContentEndColumn(line: TerminalBufferLineLike, columns: number): number {
  const maximumEndColumn = getMaximumLineEndColumn(line, columns)
  for (let index = maximumEndColumn - 1; index >= 0; index -= 1) {
    const cell = line.getCell(index)
    if (cell && cell.getChars() !== '') {
      return Math.min(maximumEndColumn, index + Math.max(1, cell.getWidth()))
    }
  }
  return 0
}

/**
 * Converts xterm's rendered active buffer to plain text. Physical rows created
 * by visual wrapping are joined back together while hard line breaks remain.
 */
export function serializeTerminalBuffer(buffer: TerminalBufferLike, columns: number): string {
  if (buffer.length <= 0 || columns <= 0) return ''

  const physicalLines: PhysicalTerminalLine[] = []
  let lastContentIndex = -1

  for (let index = 0; index < buffer.length; index += 1) {
    const line = buffer.getLine(index)
    physicalLines.push({ isWrapped: line?.isWrapped ?? false, line })
    if (line && getContentEndColumn(line, columns) > 0) lastContentIndex = index
  }

  const cursorIndex = Math.max(0, Math.min(buffer.length - 1, buffer.baseY + buffer.cursorY))
  const endIndex = Math.max(cursorIndex, lastContentIndex)
  const logicalLines: string[] = []
  let currentLine = ''
  let hasCurrentLine = false

  for (let index = 0; index <= endIndex; index += 1) {
    const physicalLine = physicalLines[index]
    if (!physicalLine.isWrapped && hasCurrentLine) {
      logicalLines.push(currentLine)
      currentLine = ''
    }

    const nextLine = physicalLines[index + 1]
    const continuesOnNextRow = index < endIndex && nextLine?.isWrapped === true
    const line = physicalLine.line
    if (line) {
      const endColumn = continuesOnNextRow
        ? getMaximumLineEndColumn(line, columns)
        : getContentEndColumn(line, columns)
      currentLine += line.translateToString(
        false,
        0,
        endColumn
      )
    }
    hasCurrentLine = true
  }

  if (hasCurrentLine) logicalLines.push(currentLine)
  return logicalLines.join('\n')
}

export function getTerminalTextSnapshot(terminal: TerminalTextSourceLike): TerminalTextSnapshot {
  if (terminal.hasSelection()) {
    return { source: 'selection', text: terminal.getSelection() }
  }

  return {
    source: 'all',
    text: serializeTerminalBuffer(terminal.buffer.active, terminal.cols)
  }
}

export function getSelectionTextWithin(
  container: SelectionContainerLike,
  selection: SelectionLike | null
): string | null {
  if (
    !selection ||
    selection.rangeCount === 0 ||
    selection.isCollapsed ||
    !selection.anchorNode ||
    !selection.focusNode ||
    !container.contains(selection.anchorNode) ||
    !container.contains(selection.focusNode)
  ) {
    return null
  }

  return selection.toString()
}
