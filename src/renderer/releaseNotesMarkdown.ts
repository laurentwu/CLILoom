const LEADING_BLOCK_TAG = /^\s*<(?:p|div|section|article|main|h[1-6]|ul|ol|li|blockquote|pre|table|hr|br)\b/i

const HEADING_TAGS: Record<string, number> = {
  h1: 1,
  h2: 2,
  h3: 3,
  h4: 4,
  h5: 5,
  h6: 6
}

export function releaseNotesToMarkdown(notes: string): string {
  if (!LEADING_BLOCK_TAG.test(notes)) return notes
  const body = new DOMParser().parseFromString(notes, 'text/html').body
  const converted = normalizeBlocks(convertBlocks(body))
  return converted || notes
}

function convertBlocks(element: Element): string {
  let result = ''
  for (const node of Array.from(element.childNodes)) result += convertNode(node)
  return result
}

function convertNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return escapeMarkdown(node.textContent ?? '')
  if (node.nodeType !== Node.ELEMENT_NODE) return ''
  return convertElement(node as Element)
}

function convertElement(element: Element): string {
  const tag = element.tagName.toLowerCase()
  const headingLevel = HEADING_TAGS[tag]
  if (headingLevel !== undefined) {
    const text = inlineContent(element).trim()
    return text ? `\n\n${'#'.repeat(headingLevel)} ${text}\n\n` : ''
  }
  switch (tag) {
    case 'p': {
      const text = inlineContent(element).trim()
      return text ? `\n\n${text}\n\n` : ''
    }
    case 'div':
    case 'section':
    case 'article':
    case 'main':
      return `\n${convertBlocks(element)}\n`
    case 'br':
      return '\n'
    case 'hr':
      return '\n\n---\n\n'
    case 'ul':
    case 'ol':
      return convertList(element, 0)
    case 'li': {
      const text = inlineContent(element).trim()
      return text ? `\n- ${text}\n` : ''
    }
    case 'blockquote': {
      const content = normalizeBlocks(convertBlocks(element))
      if (!content) return ''
      const quoted = content.split('\n').map((line) => (line ? `> ${line}` : '>')).join('\n')
      return `\n\n${quoted}\n\n`
    }
    case 'pre': {
      const code = element.querySelector('code')
      const language = /(?:^|\s)language-([\w+-]+)/.exec(code?.className ?? '')?.[1] ?? ''
      const text = (code?.textContent ?? element.textContent ?? '').replace(/\n+$/, '')
      return text ? `\n\n\`\`\`${language}\n${text}\n\`\`\`\n\n` : ''
    }
    case 'table':
      return convertTable(element)
    default:
      return inlineContent(element)
  }
}

function convertList(element: Element, depth: number): string {
  const ordered = element.tagName.toLowerCase() === 'ol'
  const indent = '  '.repeat(depth)
  const lines: string[] = []
  let index = 1
  for (const child of Array.from(element.children)) {
    const tag = child.tagName.toLowerCase()
    if (tag === 'li') {
      const marker = ordered ? `${index++}.` : '-'
      lines.push(`${indent}${marker} ${listItemContent(child, depth)}`)
    } else if (tag === 'ul' || tag === 'ol') {
      lines.push(convertList(child, depth + 1))
    }
  }
  return lines.length > 0 ? `\n\n${lines.join('\n')}\n\n` : ''
}

function listItemContent(item: Element, depth: number): string {
  let inline = ''
  const nested: string[] = []
  for (const node of Array.from(item.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      inline += escapeMarkdown(node.textContent ?? '')
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as Element
      const tag = element.tagName.toLowerCase()
      if (tag === 'ul' || tag === 'ol') nested.push(convertList(element, depth + 1))
      else inline += inlineElement(element)
    }
  }
  const label = inline.trim().replaceAll('\n', ' ')
  return nested.length > 0 ? `${label}\n${nested.join('\n')}` : label
}

function convertTable(table: Element): string {
  const rows: string[] = []
  for (const row of Array.from(table.querySelectorAll('tr'))) {
    const cells = Array.from(row.children)
      .filter((cell) => {
        const tag = cell.tagName.toLowerCase()
        return tag === 'th' || tag === 'td'
      })
      .map((cell) => inlineContent(cell).trim().replaceAll('|', '\\|'))
    if (cells.length > 0) rows.push(cells.join(' | '))
  }
  return rows.length > 0 ? `\n\n${rows.join('\n')}\n\n` : ''
}

function inlineContent(element: Element): string {
  let result = ''
  for (const node of Array.from(element.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) result += escapeMarkdown(node.textContent ?? '')
    else if (node.nodeType === Node.ELEMENT_NODE) result += inlineElement(node as Element)
  }
  return result
}

function inlineElement(element: Element): string {
  const tag = element.tagName.toLowerCase()
  switch (tag) {
    case 'strong':
    case 'b': {
      const inner = inlineContent(element).trim()
      return inner ? `**${inner}**` : ''
    }
    case 'em':
    case 'i': {
      const inner = inlineContent(element).trim()
      return inner ? `*${inner}*` : ''
    }
    case 'del':
    case 's':
    case 'strike': {
      const inner = inlineContent(element).trim()
      return inner ? `~~${inner}~~` : ''
    }
    case 'code': {
      const text = element.textContent ?? ''
      if (!text) return ''
      return text.includes('`') ? '``' + text + '``' : '`' + text + '`'
    }
    case 'a': {
      const label = inlineContent(element).trim()
      const href = element.getAttribute('href') ?? ''
      if (!/^(https?:\/\/|mailto:|\/|#)/i.test(href)) return label
      const safeLabel = label.replaceAll('[', '\\[').replaceAll(']', '\\]')
      return `[${safeLabel}](${href})`
    }
    case 'br':
      return '\n'
    case 'img':
      return element.getAttribute('alt') ?? ''
    case 'script':
    case 'style':
      return element.outerHTML
    default:
      return inlineContent(element)
  }
}

function escapeMarkdown(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('*', '\\*')
    .replaceAll('_', '\\_')
    .replaceAll('`', '\\`')
    .replaceAll('[', '\\[')
    .replaceAll(']', '\\]')
}

function normalizeBlocks(value: string): string {
  return value
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
