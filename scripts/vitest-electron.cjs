const { spawn } = require('node:child_process')
const path = require('node:path')
const electron = require('electron')

const vitestCli = path.join(
  path.dirname(require.resolve('vitest/package.json')),
  'vitest.mjs'
)

const child = spawn(
  electron,
  [vitestCli, 'run', ...process.argv.slice(2)],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      CLILOOM_TEST_NODE_EXECUTABLE: process.execPath
    }
  }
)

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 0)
})
