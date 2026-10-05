/**
 * Turning text into vector outlines for the writers that can't place native
 * text (LightBurn/XCS carry paths only). The glyph→command step needs a font, so
 * it stays in the app layer (see `src/lib/textOutliner.ts`); everything here is
 * pure — it takes already-extracted path commands and produces {@link ExportPath}
 * outlines — so it's framework-free and unit-testable with synthetic input.
 *
 * Coordinates are millimetres, y-down (canvas convention), matching the rest of
 * the export model and how `opentype.js` `getPath(text, 0, 0, size)` lays glyphs
 * out (baseline at y = 0, ascenders negative).
 */
import type { ExportDoc, ExportPath, ExportText } from './types.ts'

export interface Point2 {
  x: number
  y: number
}

/** A minimal subset of an opentype.js path command. */
export interface PathCommand {
  type: 'M' | 'L' | 'C' | 'Q' | 'Z'
  x?: number
  y?: number
  x1?: number
  y1?: number
  x2?: number
  y2?: number
}

/** Turns an {@link ExportText} into its outline paths. */
export type TextOutliner = (text: ExportText) => ExportPath[]

function quad(p0: Point2, c: Point2, p2: Point2, segments: number): Point2[] {
  const out: Point2[] = []
  for (let i = 1; i <= segments; i++) {
    const t = i / segments
    const mt = 1 - t
    out.push({
      x: mt * mt * p0.x + 2 * mt * t * c.x + t * t * p2.x,
      y: mt * mt * p0.y + 2 * mt * t * c.y + t * t * p2.y,
    })
  }
  return out
}

function cubic(
  p0: Point2,
  c1: Point2,
  c2: Point2,
  p3: Point2,
  segments: number,
): Point2[] {
  const out: Point2[] = []
  for (let i = 1; i <= segments; i++) {
    const t = i / segments
    const mt = 1 - t
    out.push({
      x:
        mt * mt * mt * p0.x +
        3 * mt * mt * t * c1.x +
        3 * mt * t * t * c2.x +
        t * t * t * p3.x,
      y:
        mt * mt * mt * p0.y +
        3 * mt * mt * t * c1.y +
        3 * mt * t * t * c2.y +
        t * t * t * p3.y,
    })
  }
  return out
}

/** Flatten path commands into closed rings (curves sampled into segments). */
export function flattenCommands(
  commands: PathCommand[],
  curveSegments = 8,
): Point2[][] {
  const rings: Point2[][] = []
  let ring: Point2[] = []
  let cur: Point2 = { x: 0, y: 0 }
  const finish = (): void => {
    if (ring.length >= 3) rings.push(ring)
    ring = []
  }
  for (const c of commands) {
    switch (c.type) {
      case 'M':
        finish()
        cur = { x: c.x ?? 0, y: c.y ?? 0 }
        ring = [cur]
        break
      case 'L':
        cur = { x: c.x ?? 0, y: c.y ?? 0 }
        ring.push(cur)
        break
      case 'Q': {
        const p2 = { x: c.x ?? 0, y: c.y ?? 0 }
        ring.push(
          ...quad(cur, { x: c.x1 ?? 0, y: c.y1 ?? 0 }, p2, curveSegments),
        )
        cur = p2
        break
      }
      case 'C': {
        const p3 = { x: c.x ?? 0, y: c.y ?? 0 }
        ring.push(
          ...cubic(
            cur,
            { x: c.x1 ?? 0, y: c.y1 ?? 0 },
            { x: c.x2 ?? 0, y: c.y2 ?? 0 },
            p3,
            curveSegments,
          ),
        )
        cur = p3
        break
      }
      case 'Z':
        finish()
        break
    }
  }
  finish()
  return rings
}

/**
 * Flatten path commands into polylines, one per subpath, keeping each
 * subpath's open/closed state. Unlike {@link flattenCommands} (which treats
 * every contour as a closed glyph ring and drops ones under 3 points), open
 * strokes — a subpath with no `Z` — stay open and 2-point lines are kept, so
 * line art such as a leaf's vein survives. A command after `Z` with no `M`
 * starts a new subpath at the closed one's start point, as in SVG.
 */
export function flattenStrokes(
  commands: readonly PathCommand[],
  curveSegments = 8,
): ExportPath[] {
  const paths: ExportPath[] = []
  let points: Point2[] = []
  let start: Point2 = { x: 0, y: 0 }
  let cur: Point2 = { x: 0, y: 0 }
  const finish = (closed: boolean): void => {
    if (points.length >= 2) paths.push({ closed, points })
    points = []
  }
  const ensureStarted = (): void => {
    if (points.length === 0) points = [cur]
  }
  for (const c of commands) {
    switch (c.type) {
      case 'M':
        finish(false)
        cur = { x: c.x ?? 0, y: c.y ?? 0 }
        start = cur
        points = [cur]
        break
      case 'L':
        ensureStarted()
        cur = { x: c.x ?? 0, y: c.y ?? 0 }
        points.push(cur)
        break
      case 'Q': {
        ensureStarted()
        const p2 = { x: c.x ?? 0, y: c.y ?? 0 }
        points.push(
          ...quad(cur, { x: c.x1 ?? 0, y: c.y1 ?? 0 }, p2, curveSegments),
        )
        cur = p2
        break
      }
      case 'C': {
        ensureStarted()
        const p3 = { x: c.x ?? 0, y: c.y ?? 0 }
        points.push(
          ...cubic(
            cur,
            { x: c.x1 ?? 0, y: c.y1 ?? 0 },
            { x: c.x2 ?? 0, y: c.y2 ?? 0 },
            p3,
            curveSegments,
          ),
        )
        cur = p3
        break
      }
      case 'Z':
        finish(true)
        cur = start
        break
    }
  }
  finish(false)
  return paths
}

interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

function ringsBounds(rings: Point2[][]): Bounds | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const ring of rings) {
    for (const p of ring) {
      minX = Math.min(minX, p.x)
      minY = Math.min(minY, p.y)
      maxX = Math.max(maxX, p.x)
      maxY = Math.max(maxY, p.y)
    }
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null
}

/**
 * Outline `text` from glyph path commands laid out at the origin
 * (`getPath(value, 0, 0, sizeMm)`). Each glyph contour becomes a closed path,
 * translated so the block sits at `text.x` / `text.y` with the same anchoring as
 * the SVG writer: horizontal per `text.anchor` (default `start`), vertical
 * centred on `text.y` (matching `dominant-baseline: central`).
 */
export function outlineTextFromCommands(
  commands: PathCommand[],
  text: ExportText,
  curveSegments = 6,
): ExportPath[] {
  const rings = flattenCommands(commands, curveSegments)
  const b = ringsBounds(rings)
  if (!b) return []
  const anchor = text.anchor ?? 'start'
  const dx =
    anchor === 'middle'
      ? text.x - (b.minX + b.maxX) / 2
      : anchor === 'end'
        ? text.x - b.maxX
        : text.x - b.minX
  const dy = text.y - (b.minY + b.maxY) / 2
  // Rotate the placed glyphs about the anchor (x, y), clockwise in y-down space,
  // matching the SVG writer's rotate() and the editor's on-canvas rotation.
  const deg = text.rotationDeg ?? 0
  const r = (deg * Math.PI) / 180
  const cos = Math.cos(r)
  const sin = Math.sin(r)
  const place = (p: Point2): Point2 => {
    const px = p.x + dx
    const py = p.y + dy
    if (deg === 0) return { x: px, y: py }
    const ox = px - text.x
    const oy = py - text.y
    return { x: text.x + ox * cos - oy * sin, y: text.y + ox * sin + oy * cos }
  }
  return rings.map((ring) => ({
    closed: true,
    points: ring.map(place),
  }))
}

/**
 * A copy of `doc` with every layer's text converted to outline paths (appended
 * to that layer's paths, then cleared). Used before the paths-only writers so
 * text survives as cut/engrave geometry.
 */
export function outlineDocText(
  doc: ExportDoc,
  outliner: TextOutliner,
): ExportDoc {
  return {
    ...doc,
    layers: doc.layers.map((layer) => {
      if (!layer.texts || layer.texts.length === 0) return layer
      const outlined = layer.texts.flatMap((t) => outliner(t))
      return { ...layer, paths: [...layer.paths, ...outlined], texts: [] }
    }),
  }
}
