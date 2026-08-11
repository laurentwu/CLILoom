import { afterEach, describe, expect, it, vi } from 'vitest'
import { readClipboardText, writeClipboardText } from './clipboard'

describe('clipboard helpers', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reads plain text from the supplied clipboard', async () => {
    const clipboard = {
      readText: vi.fn().mockResolvedValue('paste me'),
      writeText: vi.fn()
    }

    await expect(readClipboardText(clipboard)).resolves.toBe('paste me')
  })

  it('writes the exact text without trimming it', async () => {
    const clipboard = {
      readText: vi.fn(),
      writeText: vi.fn().mockResolvedValue(undefined)
    }

    await writeClipboardText('  copy me\n', clipboard)

    expect(clipboard.writeText).toHaveBeenCalledWith('  copy me\n')
  })

  it('passes clipboard read and write rejections through to the caller', async () => {
    const error = new Error('permission denied')
    const clipboard = {
      readText: vi.fn().mockRejectedValue(error),
      writeText: vi.fn().mockRejectedValue(error)
    }

    await expect(readClipboardText(clipboard)).rejects.toBe(error)
    await expect(writeClipboardText('value', clipboard)).rejects.toBe(error)
  })

  it('uses navigator.clipboard by default', async () => {
    const clipboard = {
      readText: vi.fn().mockResolvedValue('system value'),
      writeText: vi.fn().mockResolvedValue(undefined)
    }
    vi.stubGlobal('navigator', { clipboard })

    await expect(readClipboardText()).resolves.toBe('system value')
    await writeClipboardText('new system value')

    expect(clipboard.writeText).toHaveBeenCalledWith('new system value')
  })

  it('rejects cleanly when the system clipboard API is unavailable', async () => {
    vi.stubGlobal('navigator', {})

    await expect(readClipboardText()).rejects.toThrow('System clipboard is unavailable')
    await expect(writeClipboardText('value')).rejects.toThrow('System clipboard is unavailable')
  })
})
