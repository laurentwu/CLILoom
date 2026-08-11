import { describe, expect, it } from 'vitest'
import { clampWindowBounds } from './windowState'

const fallback = { x: 0, y: 0, width: 1_920, height: 1_080 }

describe('clampWindowBounds', () => {
  it('preserves bounds that already fit inside a display', () => {
    expect(clampWindowBounds(
      { x: 120, y: 80, width: 1_000, height: 720 },
      [fallback],
      fallback
    )).toEqual({ x: 120, y: 80, width: 1_000, height: 720 })
  })

  it('uses the display with the greatest overlap and clamps the window into it', () => {
    const left = { x: 0, y: 0, width: 1_000, height: 800 }
    const right = { x: 1_000, y: 0, width: 1_000, height: 800 }

    expect(clampWindowBounds(
      { x: 900, y: 100, width: 400, height: 500 },
      [left, right],
      fallback
    )).toEqual({ x: 1_000, y: 100, width: 400, height: 500 })
  })

  it('chooses the nearest display for an off-screen window and enforces minimum size', () => {
    const left = { x: 0, y: 0, width: 1_000, height: 800 }
    const right = { x: 1_200, y: 0, width: 1_000, height: 800 }

    expect(clampWindowBounds(
      { x: 1_100, y: 100, width: 100, height: 100 },
      [left, right],
      fallback
    )).toEqual({ x: 1_200, y: 100, width: 320, height: 240 })
  })

  it('uses the fallback area when no display work areas are available', () => {
    const area = { x: 100, y: 50, width: 800, height: 600 }

    expect(clampWindowBounds(
      { x: -1_000, y: -1_000, width: 1_200, height: 900 },
      [],
      area
    )).toEqual(area)
  })
})
