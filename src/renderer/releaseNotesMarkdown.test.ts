// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { releaseNotesToMarkdown } from './releaseNotesMarkdown'

describe('releaseNotesToMarkdown', () => {
  it('passes plain markdown and text through untouched', () => {
    const notes = "## What's Changed\n\n- item **bold**\n\n```bash\nnpm run test\n```"
    expect(releaseNotesToMarkdown(notes)).toBe(notes)
    expect(releaseNotesToMarkdown('a < b and c > d')).toBe('a < b and c > d')
    expect(releaseNotesToMarkdown('<script>alert(1)</script>')).toBe('<script>alert(1)</script>')
  })

  it('converts GitHub atom-feed release notes into markdown', () => {
    const notes = [
      '<p dir="auto">All macOS and Windows assets in this release are currently unsigned.</p>',
      '<h2 dir="auto">What&#39;s Changed</h2>',
      '<ul dir="auto">',
      '<li dir="auto">Fix update dialog by @laurentwu in <a class="issue-link js-issue-link" href="https://github.com/laurentwu/CLILoom/pull/14">#14</a></li>',
      '<li dir="auto"><strong>Full Changelog</strong>: <a href="https://github.com/laurentwu/CLILoom/compare/v0.1.0...v0.1.1">v0.1.0...v0.1.1</a></li>',
      '</ul>'
    ].join('')
    expect(releaseNotesToMarkdown(notes)).toBe(
      [
        'All macOS and Windows assets in this release are currently unsigned.',
        '',
        "## What's Changed",
        '',
        '- Fix update dialog by @laurentwu in [#14](https://github.com/laurentwu/CLILoom/pull/14)',
        '- **Full Changelog**: [v0.1.0...v0.1.1](https://github.com/laurentwu/CLILoom/compare/v0.1.0...v0.1.1)'
      ].join('\n')
    )
  })

  it('converts headings, ordered lists, quotes, code blocks, and rules', () => {
    const notes = [
      '<div class="markdown-body">',
      '<h3>Fixes</h3>',
      '<ol><li>first</li><li>second</li></ol>',
      '<blockquote><p>quoted words</p></blockquote>',
      '<pre><code class="language-bash">npm run test\n</code></pre>',
      '<hr>',
      '</div>'
    ].join('')
    expect(releaseNotesToMarkdown(notes)).toBe(
      [
        '### Fixes',
        '',
        '1. first',
        '2. second',
        '',
        '> quoted words',
        '',
        '```bash',
        'npm run test',
        '```',
        '',
        '---'
      ].join('\n')
    )
  })

  it('escapes markdown syntax in text and keeps unsafe constructs inert', () => {
    expect(releaseNotesToMarkdown('<p>a*b _c_ [d] `e`</p>')).toBe('a\\*b \\_c\\_ \\[d\\] \\`e\\`')
    expect(releaseNotesToMarkdown('<p><a href="javascript:alert(1)">click</a></p>')).toBe('click')
    expect(releaseNotesToMarkdown('<p><img src="https://example.com/pixel.png" alt="logo"></p>')).toBe('logo')
  })
})
