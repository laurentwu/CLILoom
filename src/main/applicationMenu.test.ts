import { describe, expect, it } from 'vitest'
import { buildApplicationMenuTemplate } from './applicationMenu'

function summarize(item: { type?: string; role?: string }): string {
  return item.type === 'separator' ? 'separator' : item.role ?? 'unknown'
}

describe('buildApplicationMenuTemplate', () => {
  it('fully removes the application menu on Windows and Linux', () => {
    expect(buildApplicationMenuTemplate('win32')).toBeNull()
    expect(buildApplicationMenuTemplate('linux')).toBeNull()
    expect(buildApplicationMenuTemplate('aix')).toBeNull()
    expect(buildApplicationMenuTemplate('freebsd')).toBeNull()
  })

  it('keeps the macOS standard menus so system roles keep working', () => {
    const template = buildApplicationMenuTemplate('darwin')
    expect(template).not.toBeNull()
    const roles = template!.map((item) => item.role)
    expect(roles).toEqual(['appMenu', 'editMenu', 'windowMenu'])
  })

  it('preserves editing roles under the macOS edit menu', () => {
    const template = buildApplicationMenuTemplate('darwin')!
    const editMenu = template.find((item) => item.role === 'editMenu')
    const submenu = editMenu?.submenu as Array<{ type?: string; role?: string }> | undefined
    expect(submenu?.map(summarize)).toEqual([
      'undo',
      'redo',
      'separator',
      'cut',
      'copy',
      'paste',
      'selectAll'
    ])
  })
})
