// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BUILTIN_SKIN_DARK_ID,
  BUILTIN_SKIN_LIGHT_ID,
  DEFAULT_CODE_FONT_FAMILY,
  defaultSkinContent,
  type BuiltinSkin,
  type SkinBackground
} from '../shared/skin'
import {
  applySkin,
  backgroundToCss,
  BUILTIN_SKIN_OPTIONS,
  DEFAULT_SKIN,
  initializeSkin,
  loadInitialSkin
} from './theme'
import { BUNDLED_CODE_FONT_FAMILY } from './fonts'

function readRoot(): CSSStyleDeclaration {
  return document.documentElement.style
}

beforeEach(() => {
  document.documentElement.className = ''
  document.documentElement.style.cssText = ''
  delete document.documentElement.dataset.skinId
})

describe('skin engine', () => {
  it('exposes a single light and single dark builtin option', () => {
    expect(BUILTIN_SKIN_OPTIONS).toHaveLength(2)
    expect(BUILTIN_SKIN_OPTIONS.filter((skin) => skin.mode === 'light')).toHaveLength(1)
    expect(BUILTIN_SKIN_OPTIONS.filter((skin) => skin.mode === 'dark')).toHaveLength(1)

    const light = BUILTIN_SKIN_OPTIONS.find((skin) => skin.mode === 'light')!
    const dark = BUILTIN_SKIN_OPTIONS.find((skin) => skin.mode === 'dark')!
    expect(light.background).toBe(backgroundToCss(defaultSkinContent('light').background))
    expect(dark.background).toBe(backgroundToCss(defaultSkinContent('dark').background))
    expect(light.background).not.toBe(defaultSkinContent('light').colors.primary)
    expect(dark.background).not.toBe(defaultSkinContent('dark').colors.primary)
  })

  it('applies light skin tokens and removes the dark class', () => {
    initializeSkin(DEFAULT_SKIN)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(readRoot().getPropertyValue('--primary')).toBe('oklch(0.205 0 0)')
    expect(readRoot().getPropertyValue('--app-background')).toBe('oklch(1 0 0)')
    expect(readRoot().getPropertyValue('--radius')).toBe('0.625rem')
    expect(document.documentElement.dataset.skinId).toBe(BUILTIN_SKIN_LIGHT_ID)
  })

  it('applies dark skin tokens and toggles the dark class', () => {
    const dark: BuiltinSkin = {
      ...defaultSkinContent('dark'),
      id: BUILTIN_SKIN_DARK_ID,
      builtin: true,
      nameKey: 'skin:builtin.dark.neutral'
    }
    applySkin(dark)
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(readRoot().getPropertyValue('--background')).toBe('oklch(0.145 0 0)')
    expect(readRoot().colorScheme).toBe('dark')
  })

  it('writes typography and spacing variables', () => {
    applySkin(DEFAULT_SKIN)
    expect(DEFAULT_CODE_FONT_FAMILY).toBe('JetBrains Mono')
    expect(readRoot().getPropertyValue('--font-code')).toContain(`'${BUNDLED_CODE_FONT_FAMILY}'`)
    expect(readRoot().getPropertyValue('--font-sans')).toBe('')
    expect(readRoot().getPropertyValue('--font-size-base')).toBe('16px')
    expect(readRoot().getPropertyValue('--font-line-height')).toBe('1.5')
    expect(readRoot().getPropertyValue('--spacing-scale')).toBe('1')
  })

  it('applies a custom code font with safe fallbacks and announces changes', () => {
    const listener = vi.fn()
    document.documentElement.addEventListener('cliloom:code-font-change', listener)
    const skin = {
      ...DEFAULT_SKIN,
      typography: { ...DEFAULT_SKIN.typography, codeFontFamily: 'Fira Code' }
    }

    applySkin(skin)

    expect(readRoot().getPropertyValue('--font-code')).toBe(
      `'Fira Code', '${BUNDLED_CODE_FONT_FAMILY}', ui-monospace, 'SFMono-Regular', 'Menlo', 'Monaco', 'Cascadia Mono', 'Consolas', 'Liberation Mono', 'DejaVu Sans Mono', monospace`
    )
    expect(listener).toHaveBeenCalledOnce()

    applySkin(skin)
    expect(listener).toHaveBeenCalledOnce()
    document.documentElement.removeEventListener('cliloom:code-font-change', listener)
  })

  it('renders gradient and solid backgrounds without leftover styles', () => {
    const solidBackground: SkinBackground = { kind: 'solid', color: 'oklch(1 0 0)' }
    const solid = { ...DEFAULT_SKIN, background: solidBackground }
    applySkin(solid)
    expect(readRoot().getPropertyValue('--app-background')).toBe('oklch(1 0 0)')

    const gradientBackground: SkinBackground = { kind: 'gradient', stops: ['#ff0000', '#0000ff'], angle: 90 }
    const gradient = { ...DEFAULT_SKIN, background: gradientBackground }
    applySkin(gradient)
    expect(readRoot().getPropertyValue('--app-background')).toBe('linear-gradient(90deg, #ff0000, #0000ff)')

    applySkin(solid)
    expect(readRoot().getPropertyValue('--app-background')).not.toContain('linear-gradient')
  })

  it('builds gradient css from a background descriptor', () => {
    expect(backgroundToCss({ kind: 'solid', color: '#fff' })).toBe('#fff')
    expect(backgroundToCss({ kind: 'gradient', stops: ['#fff', '#000'], angle: 45 })).toBe(
      'linear-gradient(45deg, #fff, #000)'
    )
  })

  it('falls back to the default skin when the IPC read fails', async () => {
    await expect(loadInitialSkin(async () => DEFAULT_SKIN)).resolves.toBe(DEFAULT_SKIN)
    await expect(
      loadInitialSkin(async () => {
        throw new Error('database unavailable')
      })
    ).resolves.toBe(DEFAULT_SKIN)
    await expect(loadInitialSkin(undefined)).resolves.toBe(DEFAULT_SKIN)
  })
})
