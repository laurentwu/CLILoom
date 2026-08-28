// @vitest-environment jsdom

import { cleanup, render, waitFor } from '@testing-library/react'
import { act } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { i18n } from '../i18n'
import { ReleaseNotesView } from './ReleaseNotesView'

const markdownNotes = [
  'All macOS and Windows assets in this release are currently unsigned.',
  '',
  "## What's Changed",
  '',
  '* Fix update dialog by @laurentwu in #14',
  '* **Full Changelog**: https://github.com/laurentwu/CLILoom/compare/v0.1.0...v0.1.1',
  '',
  '<script>alert(1)</script>',
  '',
  '```bash',
  'npm run test',
  '```'
].join('\n')

const atomHtmlNotes = [
  '<p dir="auto">All macOS and Windows assets in this release are currently unsigned.</p>',
  '<h2 dir="auto">What&#39;s Changed</h2>',
  '<ul dir="auto">',
  '<li dir="auto">Fix update dialog by @laurentwu in <a class="issue-link js-issue-link" href="https://github.com/laurentwu/CLILoom/pull/14">#14</a></li>',
  '<li dir="auto"><strong>Full Changelog</strong>: <a href="https://github.com/laurentwu/CLILoom/compare/v0.1.0...v0.1.1">v0.1.0...v0.1.1</a></li>',
  '</ul>'
].join('')

function releaseNotesContent(container: HTMLElement): HTMLElement {
  const content = container.querySelector('.release-notes-content')
  expect(content).toBeTruthy()
  return content as HTMLElement
}

describe('ReleaseNotesView rendering', () => {
  afterEach(async () => {
    cleanup()
    await i18n.changeLanguage('en')
  })

  it('renders GitHub-style release notes as rich text with inert HTML', async () => {
    const { container } = render(
      <div style={{ height: 400 }}>
        <ReleaseNotesView markdown={markdownNotes} />
      </div>
    )

    const content = releaseNotesContent(container)
    await waitFor(() => expect(content.textContent).toContain("What's Changed"))

    expect(content.getAttribute('contenteditable')).toBe('false')
    expect(container.querySelector('h2')?.textContent).toContain("What's Changed")
    expect(container.querySelectorAll('ul li')).toHaveLength(2)
    expect(container.querySelector('strong')?.textContent).toBe('Full Changelog')
    expect(container.querySelector('a')?.getAttribute('href')).toBe(
      'https://github.com/laurentwu/CLILoom/compare/v0.1.0...v0.1.1'
    )
    expect(container.querySelector('script')).toBeNull()
    expect(content.textContent).toContain('<script>alert(1)</script>')
    expect(container.querySelector('.cm-content')?.textContent).toContain('npm run test')
  })

  it('renders atom-feed HTML release notes as rich text', async () => {
    const { container } = render(
      <div style={{ height: 400 }}>
        <ReleaseNotesView markdown={atomHtmlNotes} />
      </div>
    )

    const content = releaseNotesContent(container)
    await waitFor(() => expect(content.textContent).toContain("What's Changed"))

    expect(container.querySelector('h2')?.textContent).toContain("What's Changed")
    expect(container.querySelectorAll('ul li')).toHaveLength(2)
    expect(container.querySelector('strong')?.textContent).toBe('Full Changelog')
    const hrefs = Array.from(container.querySelectorAll('a')).map((anchor) => anchor.getAttribute('href'))
    expect(hrefs).toContain('https://github.com/laurentwu/CLILoom/pull/14')
    expect(hrefs).toContain('https://github.com/laurentwu/CLILoom/compare/v0.1.0...v0.1.1')
    expect(content.textContent).not.toContain('<h2')
    expect(content.textContent).not.toContain('<li')
    expect(container.querySelector('script')).toBeNull()
  })

  it('updates the rendered notes when the update state changes', async () => {
    const { container, rerender } = render(
      <div style={{ height: 400 }}>
        <ReleaseNotesView markdown={atomHtmlNotes} />
      </div>
    )
    const content = releaseNotesContent(container)
    await waitFor(() => expect(content.textContent).toContain("What's Changed"))

    rerender(
      <div style={{ height: 400 }}>
        <ReleaseNotesView markdown={'<p dir="auto">Ready to install</p>'} />
      </div>
    )

    await waitFor(() => expect(releaseNotesContent(container).textContent).toContain('Ready to install'))
  })

  it('labels the read-only area with the localized release notes title', async () => {
    await i18n.changeLanguage('en')
    const { container, rerender } = render(
      <div style={{ height: 400 }}>
        <ReleaseNotesView markdown={markdownNotes} />
      </div>
    )
    const content = await waitFor(() => {
      const element = container.querySelector<HTMLElement>('[data-lexical-editor]')
      expect(element).toBeTruthy()
      return element as HTMLElement
    })

    expect(content.getAttribute('aria-label')).toBe('Release notes')

    await i18n.changeLanguage('zh')
    rerender(
      <div style={{ height: 400 }}>
        <ReleaseNotesView markdown={markdownNotes} />
      </div>
    )

    expect(content.getAttribute('aria-label')).toBe('版本说明')
  })

  it('prevents rendered links from navigating the Electron page', async () => {
    const { container } = render(<ReleaseNotesView markdown={markdownNotes} />)
    const link = await waitFor(() => {
      const anchor = container.querySelector('a')
      expect(anchor).toBeTruthy()
      return anchor as HTMLAnchorElement
    })
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })

    act(() => link.dispatchEvent(click))

    expect(click.defaultPrevented).toBe(true)
  })
})
