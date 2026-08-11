const { spawn } = require('node:child_process')
const electron = require('electron')
const { assertLinuxSandboxAvailable } = require('./linux-sandbox.cjs')

try {
  assertLinuxSandboxAvailable(electron)
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
}

const child = spawn(electron, ['--disable-gpu', '.'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    VITE_DEV_SERVER_URL: 'http://127.0.0.1:5173'
  }
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 0)
})
