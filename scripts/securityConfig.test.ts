import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  applyDevelopmentCsp,
  applyDevelopmentCspToEntry,
  DEVELOPMENT_CSP,
  PRODUCTION_CSP
} from '../vite.config.mts'

function readProjectFile(relativePath: string): string {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8')
}

describe('renderer security configuration', () => {
  it('ships both renderer entry points with the strict production CSP', () => {
    for (const entryPoint of ['index.html', 'assistant.html']) {
      const html = readProjectFile(entryPoint)
      expect(html).toContain(`http-equiv="Content-Security-Policy"`)
      expect(html).toContain(`content="${PRODUCTION_CSP}"`)
      expect(html).not.toContain("script-src 'self' 'unsafe-inline'")
    }
  })

  it('relaxes only the development policy needed by the Vite client', () => {
    const productionHtml = readProjectFile('index.html')
    const developmentHtml = applyDevelopmentCsp(productionHtml)

    expect(developmentHtml).toContain(`content="${DEVELOPMENT_CSP}"`)
    expect(developmentHtml).not.toContain(`content="${PRODUCTION_CSP}"`)
    expect(developmentHtml).toContain('ws://127.0.0.1:5173')
    expect(developmentHtml).toContain("object-src 'none'")
    expect(applyDevelopmentCspToEntry('<html>fixture</html>', '/e2e/terminal.html'))
      .toBe('<html>fixture</html>')
  })

  it('binds Vite to a fixed loopback port and starts Electron with its sandbox', () => {
    const viteConfig = readProjectFile('vite.config.mts')
    const packageJson = JSON.parse(readProjectFile('package.json')) as {
      scripts: Record<string, string>
    }
    const developmentLauncher = readProjectFile('scripts/electron-dev.cjs')

    expect(viteConfig).toMatch(/host:\s*'127\.0\.0\.1'/)
    expect(viteConfig).toMatch(/strictPort:\s*true/)
    expect(packageJson.scripts.dev).toBe('vite')
    expect(packageJson.scripts['electron:dev']).not.toContain('0.0.0.0')
    expect(developmentLauncher).not.toContain('--no-sandbox')
  })
})
