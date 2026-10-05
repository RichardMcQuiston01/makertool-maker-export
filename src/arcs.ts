/**
 * Arc fitting for the CNC-style writers. Our paths are polylines (curves are
 * flattened into short segments), but waterjet, plasma and router controllers
 * cut a run of tiny segments by slowing at every vertex, which leaves faceted
 * edges. Fitting circular arcs back onto those runs gives smooth motion and much
 * smaller files.
 *
 * The result is DXF's own model: vertices that each carry a *bulge* for the
 * segment that follows (0 = straight; otherwise tan(sweep / 4), positive =
 * counter-clockwise), or a whole circle when a closed path is one.
 *
 * Work in y-up coordinates (flip before fitting) so bulge signs come out the
 * way DXF reads them.
 */
import type { Point2 } from './text.ts'

/** A polyline vertex; `bulge` shapes the segment to the next vertex. */
export interface BulgeVertex {
  x: number
  y: number
  bulge: number
}

export type FittedPath =
  | { kind: 'circle'; cx: number; cy: number; r: number }
  | { kind: 'polyline'; vertices: BulgeVertex[]; closed: boolean }

export const DEFAULT_ARC_TOLERANCE_MM = 0.01

/** Longest run one arc may replace; bounds the (quadratic) fitting cost. */
const MAX_RUN = 1000
/** Arcs flatter than this radius (mm) are treated as straight lines. */
const MAX_RADIUS = 1e5
/**
 * Most a single segment may turn about the arc's centre. Flattened curves turn
 * a few degrees per segment; a deliberate polygon (square, hexagon) turns far
 * more, so its corners are never mistaken for an arc.
 */
const MAX_STEP = Math.PI / 6
/**
 * How far a segment's midpoint may sit off the arc, as a multiple of the
 * tolerance. The segments are chords of the curve they were sampled from, so
 * they sag inside it; the arc restores the curve, but only modest sag is
 * accepted, so coarse polygons stay polygons.
 */
const CHORD_SAG_FACTOR = 10

interface Circle {
  cx: number
  cy: number
  r: number
}

/** The circle through three points, or null when they are collinear. */
function circleThrough(a: Point2, b: Point2, c: Point2): Circle | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y))
  if (Math.abs(d) < 1e-12) return null
  const a2 = a.x * a.x + a.y * a.y
  const b2 = b.x * b.x + b.y * b.y
  const c2 = c.x * c.x + c.y * c.y
  const cx = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d
  const cy = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d
  const r = Math.hypot(a.x - cx, a.y - cy)
  return r > MAX_RADIUS ? null : { cx, cy, r }
}

function offCircle(p: Point2, c: Circle): number {
  return Math.abs(Math.hypot(p.x - c.cx, p.y - c.cy) - c.r)
}

function midpoint(a: Point2, b: Point2): Point2 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

/** Signed angle from a to b, in (-π, π]. */
function turn(from: number, to: number): number {
  let d = to - from
  while (d <= -Math.PI) d += 2 * Math.PI
  while (d > Math.PI) d -= 2 * Math.PI
  return d
}

/**
 * The bulge of an arc through `pts[i..j]`, or null when they don't lie on one
 * arc: every vertex within `tol` of it, every segment midpoint within the
 * chord-sag allowance, each segment turning one way by at most
 * {@link MAX_STEP}, and the whole sweep at most a half turn.
 */
function arcBulge(
  pts: Point2[],
  i: number,
  j: number,
  tol: number,
): number | null {
  const c = circleThrough(pts[i], pts[(i + j) >> 1], pts[j])
  if (!c) return null
  let sweep = 0
  let dir = 0
  let prev = Math.atan2(pts[i].y - c.cy, pts[i].x - c.cx)
  for (let k = i + 1; k <= j; k++) {
    if (offCircle(pts[k], c) > tol) return null
    if (offCircle(midpoint(pts[k - 1], pts[k]), c) > tol * CHORD_SAG_FACTOR) {
      return null
    }
    const angle = Math.atan2(pts[k].y - c.cy, pts[k].x - c.cx)
    const step = turn(prev, angle)
    const sign = Math.sign(step)
    if (sign === 0 || (dir !== 0 && sign !== dir)) return null
    if (Math.abs(step) > MAX_STEP) return null
    dir = sign
    sweep += Math.abs(step)
    prev = angle
  }
  if (sweep > Math.PI + 1e-9) return null
  return dir * Math.tan(sweep / 4)
}

/** Whether `pts[i..j]` run straight from i to j, within `tol`, never doubling back. */
function isStraight(pts: Point2[], i: number, j: number, tol: number): boolean {
  const a = pts[i]
  const dx = pts[j].x - a.x
  const dy = pts[j].y - a.y
  const lengthSq = dx * dx + dy * dy
  if (lengthSq === 0) return false
  const length = Math.sqrt(lengthSq)
  let lastT = 0
  for (let k = i + 1; k <= j; k++) {
    const p = pts[k]
    const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq
    if (t < lastT) return false
    lastT = t
    if (Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / length > tol)
      return false
  }
  return true
}

function dedupe(points: Point2[], closed: boolean): Point2[] {
  const out: Point2[] = []
  for (const p of points) {
    const last = out[out.length - 1]
    if (!last || last.x !== p.x || last.y !== p.y) out.push(p)
  }
  if (closed) {
    while (
      out.length > 1 &&
      out[0].x === out[out.length - 1].x &&
      out[0].y === out[out.length - 1].y
    ) {
      out.pop()
    }
  }
  return out
}

/**
 * Where to start a closed path so no arc straddles the seam: its sharpest
 * corner, or, on a smooth outline (a rounded rectangle), the start of its
 * longest segment, which is a straight run rather than mid-curve.
 */
function seamVertex(pts: Point2[]): number {
  let sharpest = 0
  let sharpestTurn = 0
  let longest = 0
  let longestLength = 0
  for (let k = 0; k < pts.length; k++) {
    const a = pts[(k - 1 + pts.length) % pts.length]
    const b = pts[k]
    const c = pts[(k + 1) % pts.length]
    const t = Math.abs(
      turn(Math.atan2(b.y - a.y, b.x - a.x), Math.atan2(c.y - b.y, c.x - b.x)),
    )
    if (t > sharpestTurn) {
      sharpestTurn = t
      sharpest = k
    }
    const length = Math.hypot(c.x - b.x, c.y - b.y)
    if (length > longestLength) {
      longestLength = length
      longest = k
    }
  }
  return sharpestTurn > MAX_STEP ? sharpest : longest
}

/** A closed path that is one whole circle, by the same rules as an arc. */
function wholeCircle(pts: Point2[], tol: number): Circle | null {
  if (pts.length < 12) return null
  const n = pts.length
  const c = circleThrough(
    pts[0],
    pts[Math.floor(n / 3)],
    pts[Math.floor((2 * n) / 3)],
  )
  if (!c) return null
  let sweep = 0
  let dir = 0
  for (let k = 0; k < n; k++) {
    const a = pts[k]
    const b = pts[(k + 1) % n]
    if (offCircle(a, c) > tol) return null
    if (offCircle(midpoint(a, b), c) > tol * CHORD_SAG_FACTOR) return null
    const step = turn(
      Math.atan2(a.y - c.cy, a.x - c.cx),
      Math.atan2(b.y - c.cy, b.x - c.cx),
    )
    const sign = Math.sign(step)
    if (sign === 0 || (dir !== 0 && sign !== dir)) return null
    if (Math.abs(step) > MAX_STEP) return null
    dir = sign
    sweep += Math.abs(step)
  }
  // Exactly one lap.
  return Math.abs(sweep - 2 * Math.PI) < 1e-6 ? c : null
}

/**
 * Replace runs of a polyline with arcs (and straight runs with single lines)
 * wherever they match. Corners and endpoints are kept exactly, and every
 * original vertex lies within `tolerance` mm of the fitted outline. Between
 * vertices an arc follows the curve the points were sampled from, so it may sit
 * up to 10 × `tolerance` off the original straight segments (their chord sag).
 */
export function fitArcs(
  points: Point2[],
  closed: boolean,
  tolerance: number = DEFAULT_ARC_TOLERANCE_MM,
): FittedPath {
  const tol = tolerance > 0 ? tolerance : DEFAULT_ARC_TOLERANCE_MM
  let pts = dedupe(points, closed)
  if (closed) {
    const circle = wholeCircle(pts, tol)
    if (circle) return { kind: 'circle', ...circle }
  }
  if (pts.length < 3) {
    return {
      kind: 'polyline',
      vertices: pts.map((p) => ({ ...p, bulge: 0 })),
      closed,
    }
  }
  if (closed) {
    const start = seamVertex(pts)
    pts = [...pts.slice(start), ...pts.slice(0, start), pts[start]]
  }

  const vertices: BulgeVertex[] = []
  const last = pts.length - 1
  let i = 0
  while (i < last) {
    let end = i + 1
    let bulge = 0
    for (let j = i + 2; j <= Math.min(last, i + MAX_RUN); j++) {
      if (isStraight(pts, i, j, tol)) {
        end = j
        bulge = 0
        continue
      }
      const b = arcBulge(pts, i, j, tol)
      if (b === null) break
      end = j
      bulge = b
    }
    vertices.push({ x: pts[i].x, y: pts[i].y, bulge })
    i = end
  }
  // A closed path ends back at its start, which DXF's closed flag supplies.
  if (!closed) vertices.push({ x: pts[last].x, y: pts[last].y, bulge: 0 })
  return { kind: 'polyline', vertices, closed }
}
