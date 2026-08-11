const { spawn } = require('node:child_process')
const path = require('node:path')

const playwrightCli = path.join(path.dirname(require.resolve('playwright/package.json')), 'cli.js')
const playwrightArgs = [playwrightCli, 'test', ...process.argv.slice(2)]
const needsVirtualDisplay = process.platform === 'linux' && !process.env.DISPLAY
const command = needsVirtualDisplay ? 'xvfb-run' : process.execPath
const args = needsVirtualDisplay
  ? ['-a', process.execPath, ...playwrightArgs]
  : playwrightArgs

const child = spawn(command, args, {
  env: process.env,
  stdio: 'inherit'
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 1)
})
