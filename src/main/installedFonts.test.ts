import { describe, expect, it, vi } from 'vitest'
import { InstalledFontService, normalizeInstalledFontFamilies } from './installedFonts'

describe('installed font families', () => {
  it('normalizes, validates, deduplicates and sorts font family names', () => {
    const longFamily = `Long ${'Family '.repeat(10)}`.trim()
    const punctuatedFamily = 'Foundry\'s & Co. Mono'
    expect(normalizeInstalledFontFamilies([
      '  Zed Mono  ',
      'Alpha Sans',
      'alpha sans',
      punctuatedFamily,
      longFamily,
      '文泉驛（等寬）',
      '',
      'Unsafe\nFont',
      42,
      'Beta Serif'
    ])).toEqual([
      'Alpha Sans',
      'Beta Serif',
      punctuatedFamily,
      longFamily,
      'Zed Mono',
      '文泉驛（等寬）'
    ])
    expect(normalizeInstalledFontFamilies({ fonts: [] })).toEqual([])
  })

  it('shares a successful enumeration request and caches its result', async () => {
    const enumerate = vi.fn(async () => ['Fira Code', 'Iosevka'])
    const service = new InstalledFontService(enumerate)

    await expect(Promise.all([service.list(), service.list()])).resolves.toEqual([
      ['Fira Code', 'Iosevka'],
      ['Fira Code', 'Iosevka']
    ])
    await expect(service.list()).resolves.toEqual(['Fira Code', 'Iosevka'])
    expect(enumerate).toHaveBeenCalledOnce()
  })

  it('allows enumeration to be retried after a failure', async () => {
    const enumerate = vi.fn()
      .mockRejectedValueOnce(new Error('font service unavailable'))
      .mockResolvedValueOnce(['Fira Code'])
    const service = new InstalledFontService(enumerate)

    await expect(service.list()).rejects.toThrow('font service unavailable')
    await expect(service.list()).resolves.toEqual(['Fira Code'])
    expect(enumerate).toHaveBeenCalledTimes(2)
  })

  it('treats an empty enumeration as a retryable failure', async () => {
    const enumerate = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(['Fira Code'])
    const service = new InstalledFontService(enumerate)

    await expect(service.list()).rejects.toThrow('No installed font families were found')
    await expect(service.list()).resolves.toEqual(['Fira Code'])
    expect(enumerate).toHaveBeenCalledTimes(2)
  })
})
