import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

export const PRODUCTION_CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'"
export const DEVELOPMENT_CSP = "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; connect-src 'self' ws://127.0.0.1:5173; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'"

export function applyDevelopmentCsp(html: string): string {
  const productionAttribute = `content="${PRODUCTION_CSP}"`
  if (!html.includes(productionAttribute)) {
    throw new Error('Renderer HTML is missing the production Content Security Policy')
  }
  return html.replace(productionAttribute, `content="${DEVELOPMENT_CSP}"`)
}

export function applyDevelopmentCspToEntry(html: string, requestPath: string): string {
  if (!['/', '/index.html', '/assistant.html'].includes(requestPath)) return html
  return applyDevelopmentCsp(html)
}

function developmentCspPlugin(): Plugin {
  return {
    name: 'cliloom-development-csp',
    apply: 'serve',
    transformIndexHtml: (html, context) => applyDevelopmentCspToEntry(html, context.path)
  }
}

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), developmentCspPlugin()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src/renderer', import.meta.url))
    }
  },
  build: {
    outDir: 'dist/renderer',
    emptyOutDir: true,
    rolldownOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        assistant: fileURLToPath(new URL('./assistant.html', import.meta.url))
      }
    }
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true
  }
})
