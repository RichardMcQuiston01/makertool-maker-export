import { describe, expect, test } from 'vitest'
import { fitArcs, type BulgeVertex, type Point2 } from './index.ts'

function circlePoints(cx: number, cy: number, r: number, n: number): Point2[] {
  return Array.from({ length: n }, (_, i) => ({
    x: cx + r * Math.cos((2 * Math.PI * i) / n),
    y: cy + r * Math.sin((2 * Math.PI * i) / n),
  }))
}

/** Counter-clockwise rounded rectangle: straight sides, quarter-circle corners. */
function roundedRect(w: number, h: number, r: number, seg: number): Point2[] {
  const pts: Point2[] = []
  const corners: [number, number][] = [
    [w - r, r],
    [w - r, h - r],
    [r, h - r],
    [r, r],
  ]
  corners.forEach(([cx, cy], k) => {
    for (let i = 0; i <= seg; i++) {
      const a = -Math.PI / 2 + (Math.PI / 2) * (k + i / seg)
      pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) })
    }
  })
  return pts
}

/** Points along the fitted outline, arcs sampled from their bulges. */
function sample(vertices: BulgeVertex[], closed: boolean): Point2[] {
  const out: Point2[] = []
  const count = closed ? vertices.length : vertices.length - 1
  for (let i = 0; i < count; i++) {
    const a = vertices[i]
    const b = vertices[(i + 1) % vertices.length]
    const sweep = 4 * Math.atan(a.bulge)
    const chord = Math.hypot(b.x - a.x, b.y - a.y)
    for (let s = 0; s < 32; s++) {
      const t = s / 32
      if (a.bulge === 0) {
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
        continue
      }
      // Centre sits off the chord midpoint, to the left for a CCW arc.
      const r = chord / (2 * Math.sin(sweep / 2))
      const mx = (a.x + b.x) / 2
      const my = (a.y + b.y) / 2
      const d = r * Math.cos(sweep / 2)
      const cx = mx - (d * (b.y - a.y)) / chord
      const cy = my + (d * (b.x - a.x)) / chord
      const a0 = Math.atan2(a.y - cy, a.x - cx)
      const ang = a0 + sweep * t
      out.push({
        x: cx + Math.abs(r) * Math.cos(ang),
        y: cy + Math.abs(r) * Math.sin(ang),
      })
    }
  }
  if (!closed) out.push(vertices[vertices.length - 1])
  return out
}

function distanceToPolyline(p: Point2, pts: Point2[], closed: boolean): number {
  let best = Infinity
  const n = closed ? pts.length : pts.length - 1
  for (let i = 0; i < n; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const t = Math.max(
      0,
      Math.min(
        1,
        ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1),
      ),
    )
    best = Math.min(best, Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t))
  }
  return best
}

describe('fitArcs', () => {
  test('a closed path that is a whole circle becomes a circle', () => {
    const fitted = fitArcs(circlePoints(5, 6, 4, 64), true)
    expect(fitted.kind).toBe('circle')
    if (fitted.kind !== 'circle') return
    expect(fitted.cx).toBeCloseTo(5, 6)
    expect(fitted.cy).toBeCloseTo(6, 6)
    expect(fitted.r).toBeCloseTo(4, 6)
  })

  test('a rounded rectangle becomes four lines and four quarter arcs', () => {
    const points = roundedRect(60, 30, 5, 12)
    const fitted = fitArcs(points, true)
    expect(fitted.kind).toBe('polyline')
    if (fitted.kind !== 'polyline') return
    expect(fitted.vertices).toHaveLength(8)
    const bulges = fitted.vertices.map((v) => v.bulge).filter((b) => b !== 0)
    expect(bulges).toHaveLength(4)
    // A counter-clockwise quarter turn: tan(90° / 4).
    for (const b of bulges) expect(b).toBeCloseTo(Math.tan(Math.PI / 8), 3)
  })

  test('clockwise arcs get negative bulges', () => {
    const points = [...roundedRect(60, 30, 5, 12)].reverse()
    const fitted = fitArcs(points, true)
    if (fitted.kind !== 'polyline') throw new Error('expected a polyline')
    const bulges = fitted.vertices.map((v) => v.bulge).filter((b) => b !== 0)
    for (const b of bulges) expect(b).toBeCloseTo(-Math.tan(Math.PI / 8), 3)
  })

  test('the fitted outline stays within tolerance of the original, both ways', () => {
    const tolerance = 0.02
    // A wavy open path: sine runs, a sharp corner and a straight tail.
    const points: Point2[] = []
    for (let i = 0; i <= 120; i++)
      points.push({ x: i / 4, y: 3 * Math.sin(i / 12) })
    points.push({ x: 30, y: 10 }, { x: 40, y: 10 }, { x: 50, y: 10 })
    const fitted = fitArcs(points, false, tolerance)
    if (fitted.kind !== 'polyline') throw new Error('expected a polyline')
    expect(fitted.vertices.length).toBeLessThan(points.length / 3)
    const fittedPts = sample(fitted.vertices, false)
    // Every original vertex is within tolerance of the fitted outline...
    for (const p of points) {
      expect(distanceToPolyline(p, fittedPts, false)).toBeLessThanOrEqual(
        tolerance + 1e-3,
      )
    }
    // ...which strays from the original segments by no more than chord sag.
    for (const p of fittedPts) {
      expect(distanceToPolyline(p, points, false)).toBeLessThanOrEqual(
        tolerance * 10,
      )
    }
    // Endpoints and the corner are kept exactly.
    expect(fitted.vertices[0]).toEqual({
      x: 0,
      y: 0,
      bulge: expect.any(Number),
    })
    expect(fitted.vertices.at(-1)).toEqual({ x: 50, y: 10, bulge: 0 })
    expect(fitted.vertices.some((v) => v.x === 30 && v.y === 10)).toBe(true)
  })

  test('a polygon is never mistaken for a circle', () => {
    for (const sides of [4, 6, 8]) {
      const fitted = fitArcs(circlePoints(0, 0, 20, sides), true)
      expect(fitted.kind).toBe('polyline')
      if (fitted.kind !== 'polyline') return
      expect(fitted.vertices.every((v) => v.bulge === 0)).toBe(true)
    }
  })

  test('collinear runs collapse to one line; sharp polygons are unchanged', () => {
    const line = fitArcs(
      [0, 1, 2, 3, 4].map((x) => ({ x, y: 0 })),
      false,
    )
    if (line.kind !== 'polyline') throw new Error('expected a polyline')
    expect(line.vertices).toEqual([
      { x: 0, y: 0, bulge: 0 },
      { x: 4, y: 0, bulge: 0 },
    ])
    const triangle = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 5, y: 8 },
    ]
    const fitted = fitArcs(triangle, true)
    if (fitted.kind !== 'polyline') throw new Error('expected a polyline')
    expect(fitted.vertices.map((v) => v.bulge)).toEqual([0, 0, 0])
    expect(fitted.vertices).toHaveLength(3)
  })
})
