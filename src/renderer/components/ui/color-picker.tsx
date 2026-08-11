import * as React from 'react'

import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

function expandHex(hex: string): string {
  return hex.length === 4
    ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
    : hex
}

function clamp255(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)))
}

function linearToSrgb(channel: number): number {
  const normalized = Math.max(0, Math.min(1, channel))
  return normalized >= 0.0031308
    ? 1.055 * Math.pow(normalized, 1 / 2.4) - 0.055
    : 12.92 * normalized
}

function oklabToHex(L: number, a: number, b: number): string {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.291485548 * b
  const l3 = l_ ** 3
  const m3 = m_ ** 3
  const s3 = s_ ** 3
  const r = 4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3
  const g = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3
  const bl = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3
  const hex = [r, g, bl]
    .map((channel) => clamp255(linearToSrgb(channel) * 255))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
  return `#${hex}`
}

function angleToDegrees(token: string): number {
  const value = Number.parseFloat(token)
  if (token.endsWith('grad')) return value * 0.9
  if (token.endsWith('rad')) return (value * 180) / Math.PI
  if (token.endsWith('turn')) return value * 360
  return value
}

function channelValue(token: string, fallback = 0): number {
  if (token === 'none' || token === '') return fallback
  if (token.endsWith('%')) return Number.parseFloat(token) / 100
  return Number.parseFloat(token)
}

/**
 * Convert a CSS color (hex, rgb/rgba, hsl/hsla, named) to a 6-digit hex string
 * the native color input can consume. oklch/oklab values are converted via the
 * standard OKLab → linear sRGB math so builtin oklch tokens render correctly.
 */
export function colorToHex(color: string): string {
  const trimmed = color.trim()
  if (HEX_RE.test(trimmed)) return expandHex(trimmed)
  if (trimmed.startsWith('#')) return '#000000'

  const fnMatch = trimmed.match(/^(oklch|oklab)\(([^)]*)\)$/i)
  if (fnMatch) {
    const [fn, body] = [fnMatch[1].toLowerCase(), fnMatch[2]]
    const parts = body.split('/').map((part) => part.trim())
    const channels = parts[0].split(/\s+/).filter(Boolean)
    const L = channelValue(channels[0] ?? '0')
    const aRaw = channels[1] ? channelValue(channels[1]) : 0
    const bRaw = channels[2] ? channelValue(channels[2]) : 0
    if (fn === 'oklch') {
      const hue = channels[2] ? angleToDegrees(channels[2]) : 0
      const c = aRaw
      const a = c * Math.cos((hue * Math.PI) / 180)
      const b = c * Math.sin((hue * Math.PI) / 180)
      return oklabToHex(L, a, b)
    }
    return oklabToHex(L, aRaw, bRaw)
  }

  const probe = document.createElement('span')
  probe.style.color = ''
  probe.style.color = trimmed
  if (probe.style.color === '') return '#000000'
  document.body.appendChild(probe)
  const computed = window.getComputedStyle(probe).color
  document.body.removeChild(probe)
  const match = computed.match(/rgba?\(([^)]+)\)/)
  if (!match) return '#000000'
  const [r, g, b] = match[1].split(',').map((part) => Number.parseFloat(part.trim()))
  return `#${clamp255(r)}${clamp255(g)}${clamp255(b)}`
}

export type ColorPickerProps = {
  value: string
  onChange: (value: string) => void
  className?: string
  disabled?: boolean
  label?: string
}

function ColorPicker({ value, onChange, className, disabled, label }: ColorPickerProps) {
  const hex = React.useMemo(() => {
    try {
      return colorToHex(value)
    } catch {
      return '#000000'
    }
  }, [value])

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <input
        aria-label={label}
        className="size-8 shrink-0 cursor-pointer rounded-md border border-input bg-transparent p-0 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={disabled}
        type="color"
        value={hex}
        onChange={(event) => onChange(event.target.value)}
      />
      <Input
        aria-label={label ? `${label} (text)` : undefined}
        className="h-8 font-mono text-xs"
        disabled={disabled}
        spellCheck={false}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}

export { ColorPicker }
