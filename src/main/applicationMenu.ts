import type { MenuItemConstructorOptions } from 'electron'

export function buildApplicationMenuTemplate(platform: string): MenuItemConstructorOptions[] | null {
  if (platform === 'darwin') {
    return [
      { role: 'appMenu' },
      {
        role: 'editMenu',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' }
        ]
      },
      { role: 'windowMenu' }
    ]
  }
  return null
}
