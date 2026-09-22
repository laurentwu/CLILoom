'use strict'

const { execFileSync } = require('node:child_process')

module.exports = function prepareSession() {
  if (process.platform !== 'linux' || process.env.CLILOOM_E2E_ISOLATED_BUS !== '1') return
  // Xvfb starts inside dbus-run-session. Update only this isolated bus's
  // activation environment so portal helpers inherit the new display too.
  const variables = ['DISPLAY', 'XAUTHORITY'].filter((key) => process.env[key])
  if (variables.length === 0) throw new Error('Linux Electron E2E requires a display')
  execFileSync('dbus-update-activation-environment', variables, {
    env: process.env,
    stdio: 'inherit'
  })
}
