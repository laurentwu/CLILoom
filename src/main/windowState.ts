import type { Rectangle } from 'electron'
import type { WindowBounds } from '../shared/appSettings'

export function clampWindowBounds(
  bounds: WindowBounds,
  workAreas: Rectangle[],
  fallback: Rectangle
): WindowBounds {
  const displays = workAreas.length > 0 ? workAreas : [fallback]
  const target = displays
    .map((workArea) => ({ workArea, overlap: intersectionArea(bounds, workArea) }))
    .sort((left, right) => right.overlap - left.overlap)[0]
  const area = target.overlap > 0 ? target.workArea : nearestWorkArea(bounds, displays, fallback)
  const width = Math.min(Math.max(320, bounds.width), area.width)
  const height = Math.min(Math.max(240, bounds.height), area.height)
  return {
    x: Math.min(Math.max(bounds.x, area.x), area.x + area.width - width),
    y: Math.min(Math.max(bounds.y, area.y), area.y + area.height - height),
    width,
    height
  }
}

function intersectionArea(left: Rectangle, right: Rectangle): number {
  const width = Math.max(
    0,
    Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x)
  )
  const height = Math.max(
    0,
    Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y)
  )
  return width * height
}

function nearestWorkArea(
  bounds: WindowBounds,
  workAreas: Rectangle[],
  fallback: Rectangle
): Rectangle {
  const x = bounds.x + bounds.width / 2
  const y = bounds.y + bounds.height / 2
  return workAreas
    .map((area) => {
      const centerX = area.x + area.width / 2
      const centerY = area.y + area.height / 2
      return { area, distance: (centerX - x) ** 2 + (centerY - y) ** 2 }
    })
    .sort((left, right) => left.distance - right.distance)[0]?.area ?? fallback
}
