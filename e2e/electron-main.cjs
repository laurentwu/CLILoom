const { app, BrowserWindow, session } = require('electron')

app.commandLine.appendSwitch('disable-gpu')

app.whenReady().then(async () => {
  const allowedPermissions = new Set(['clipboard-read', 'clipboard-sanitized-write'])
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => (
    allowedPermissions.has(permission)
  ))
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(allowedPermissions.has(permission))
  })

  const window = new BrowserWindow({
    height: 900,
    show: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    },
    width: 1280
  })
  await window.loadURL(process.env.CLILOOM_E2E_URL || 'http://127.0.0.1:41731/e2e/terminal.html')
})

app.on('window-all-closed', () => app.quit())
