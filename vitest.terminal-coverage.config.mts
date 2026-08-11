import { mergeConfig } from 'vite'
import { defineConfig } from 'vitest/config'
import viteConfig from './vite.config.mts'

export default mergeConfig(viteConfig, defineConfig({
  test: {
    include: [
      'src/renderer/clipboard.test.ts',
      'src/renderer/terminalText.test.ts',
      'src/renderer/components/TerminalContextMenu.test.tsx',
      'src/renderer/components/TerminalMarkdownDialog.test.tsx',
      'src/renderer/components/TerminalPane.test.tsx',
      'src/renderer/components/TerminalPane.interaction.test.tsx',
      'src/renderer/components/XtermTerminal.test.tsx'
    ],
    coverage: {
      include: [
        'src/renderer/clipboard.ts',
        'src/renderer/terminalText.ts',
        'src/renderer/components/TerminalContextMenu.tsx',
        'src/renderer/components/TerminalMarkdownDialog.tsx',
        'src/renderer/components/TerminalPane.tsx',
        'src/renderer/components/XtermTerminal.tsx'
      ],
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: 'coverage/terminal',
      thresholds: {
        branches: 90,
        functions: 90,
        lines: 95,
        statements: 95
      }
    }
  }
}))
