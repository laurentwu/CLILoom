import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, it } from 'vitest'
import { i18n } from '../i18n'
import { StatusBadge } from './StatusBadge'

function render(node: React.ReactNode): string {
  return renderToStaticMarkup(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>)
}

describe('StatusBadge', () => {
  it('renders the normalized label and semantic tone', () => {
    i18n.changeLanguage('zh')
    const markup = render(<StatusBadge source="node" status="waiting-input" />)

    expect(markup).toContain('等待输入')
    expect(markup).toContain('data-status-source="node"')
    expect(markup).toContain('data-status-tone="waiting-input"')
    expect(markup).toContain('status-badge')
  })

  it('allows contextual text without changing the status tone', () => {
    const markup = render(<StatusBadge label="并行 2 路" status="running" />)

    expect(markup).toContain('并行 2 路')
    expect(markup).toContain('data-status-tone="running"')
  })

  it('renders unknown values with the neutral fallback', () => {
    const markup = render(<StatusBadge status="legacy-status" />)

    expect(markup).toContain('legacy-status')
    expect(markup).toContain('data-status-tone="neutral"')
  })
})
