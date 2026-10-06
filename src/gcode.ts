/**
 * G-code writer for CNC routers and for torch-style cutters (plasma,
 * waterjet, oxy-fuel): profile cuts only, no pocketing or V-carving.
 *
 * - **Cut** layers: closed paths are combined even-odd into parts and holes,
 *   then offset by the tool radius (router) or half the kerf (torch) so parts
 *   come out at size: outlines are cut on the outside, holes on the inside.
 *   Open cut paths are followed on their centreline.
 * - **Engrave** layers (router only): every path is followed on its
 *   centreline at the engrave depth, e.g. with a V-bit.
 * - Order: engraving, then open cuts, then every hole, then every outline, so
 *   parts stay held by the sheet until last. Within each group the nearest
 *   next cut is taken.
 * - Router: depth passes of `stepDownMm` down to `cutDepthMm`, with holding
 *   tabs left on the final passes of each outline.
 * - Torch: `M3`/`M5` switch the torch, with a pierce delay and a short
 *   lead-in from the scrap side so the pierce mark stays off the part.
 * - Curves are output as `G2`/`G3` arcs (fitted with {@link fitArcs}).
 *
 * Machine coordinates are millimetres, absolute, with X0 Y0 at the sheet's
 * bottom-left corner and Z0 at the top of the stock. Check every setting
 * against your machine before running a program: wrong feeds, depths or tool
 * sizes break bits and ruin stock.
 */
import ClipperLib, { type Path, type Paths } from 'clipper-lib'
import { fitArcs } from './arcs.ts'
import { regionShapes, ringSignedArea, type Shape2D } from './mesh.ts'
import { outlineDocText, type Point2, type TextOutliner } from './text.ts'
import type { ExportDoc, ExportLayer } from './types.ts'

export const GCODE_MIME = 'text/x-gcode'

/** `router`: spindle, depth passes, tabs. `torch`: plasma/waterjet style. */
export type GcodeProcess = 'router' | 'torch'

/**
 * Router cut direction. `conventional` is gentler on flexible hobby machines;
 * `climb` gives a cleaner edge on rigid ones. Torch cuts always run with the
 * part on the right (outlines clockwise, holes anticlockwise).
 */
export type CutDirection = 'conventional' | 'climb'

export interface GcodeTabs {
  /** Tabs per outline. Defaults to 4 (fewer on small parts). */
  count?: number
  /** Width of each tab of material left, mm. Defaults to 6. */
  widthMm?: number
  /** Height of each tab above the bottom of the cut, mm. Defaults to 1.5. */
  heightMm?: number
}

export interface GcodeOptions {
  /** Defaults to `router`. */
  process?: GcodeProcess
  /** Router bit diameter, mm. Defaults to 3.175 (1/8"). */
  toolDiameterMm?: number
  /** Torch kerf width, mm. Defaults to 1.5. */
  kerfMm?: number
  /** `outside` (default) offsets for the tool; `none` cuts on the lines. */
  compensation?: 'outside' | 'none'
  /** Router only. Defaults to `conventional`. */
  direction?: CutDirection
  /** Router stock thickness, mm. Defaults to 6. */
  materialThicknessMm?: number
  /** Router cut depth, mm. Defaults to the thickness plus 0.3 (cut through). */
  cutDepthMm?: number
  /** Router depth per pass, mm. Defaults to 1.5. */
  stepDownMm?: number
  /** Router engraving depth, mm. Defaults to 0.5. */
  engraveDepthMm?: number
  /** Router travel height above the stock, mm. Defaults to 5. */
  safeZMm?: number
  /** Cutting feed, mm/min. Defaults to 1000 (router) or 2500 (torch). */
  feedMmPerMin?: number
  /** Router plunge feed, mm/min. Defaults to 300. */
  plungeMmPerMin?: number
  /** Router spindle speed, rpm. Defaults to 18000. */
  spindleRpm?: number
  /** Router holding tabs on outlines; `false` for none. */
  tabs?: GcodeTabs | false
  /** Torch pierce delay, seconds. Defaults to 0.5. */
  pierceDelayS?: number
  /** Torch lead-in length, mm. Defaults to 2. */
  leadInMm?: number
  /** Output curves as G2/G3 arcs. Defaults to true. */
  arcs?: boolean
  /** Outlines text so it can be cut or engraved; without it text is skipped. */
  outliner?: TextOutliner
  /** Program name, written as a comment. */
  title?: string
}

/** A straight move or a circular arc, in machine coordinates (y-up). */
export type ToolpathSegment =
  | { type: 'line'; from: Point2; to: Point2 }
  | {
      type: 'arc'
      from: Point2
      to: Point2
      center: Point2
      clockwise: boolean
    }

export type GcodeOperationKind = 'engrave' | 'open' | 'hole' | 'outline'

export interface GcodeOperation {
  kind: GcodeOperationKind
  /** The tool-centre path. Closed operations end where they start. */
  segments: ToolpathSegment[]
  closed: boolean
  /** Torch lead-in start point, off the part on the scrap side. */
  leadIn?: Point2
  /** Distances along the path, [start, end] mm, where tabs lift the tool. */
  tabs: [number, number][]
}

/** Every setting, defaults filled in and checked. */
export type ResolvedGcodeOptions = Required<
  Omit<GcodeOptions, 'tabs' | 'outliner' | 'title' | 'materialThicknessMm'>
> & {
  tabs: Required<GcodeTabs> | false
  title: string
}

export interface GcodePlan {
  settings: ResolvedGcodeOptions
  operations: GcodeOperation[]
  /** Things the program leaves out or can't do, in plain words. */
  warnings: string[]
}

/** Integer units per mm for Clipper (0.1 µm). */
const SCALE = 1e4
/** Height above the stock the router drops to before plunging, mm. */
const RETRACT_MM = 1

function positiveOr(
  name: string,
  value: number | undefined,
  fallback: number,
  allowZero = false,
): number {
  if (value === undefined) return fallback
  if (!Number.isFinite(value) || value < 0 || (!allowZero && value === 0)) {
    throw new Error(
      `G-code: ${name} must be ${allowZero ? 'zero or more' : 'greater than 0'} (got ${value}).`,
    )
  }
  return value
}

/** Fill in defaults and reject settings that can't make a safe program. */
export function resolveGcodeOptions(
  options: GcodeOptions = {},
): ResolvedGcodeOptions {
  const process: GcodeProcess = options.process === 'torch' ? 'torch' : 'router'
  const torch = process === 'torch'
  const thickness = positiveOr(
    'material thickness',
    options.materialThicknessMm,
    6,
  )
  const settings: ResolvedGcodeOptions = {
    process,
    toolDiameterMm: positiveOr('tool diameter', options.toolDiameterMm, 3.175),
    kerfMm: positiveOr('kerf', options.kerfMm, 1.5, true),
    compensation: options.compensation === 'none' ? 'none' : 'outside',
    direction: options.direction === 'climb' ? 'climb' : 'conventional',
    cutDepthMm: positiveOr('cut depth', options.cutDepthMm, thickness + 0.3),
    stepDownMm: positiveOr('step-down', options.stepDownMm, 1.5),
    engraveDepthMm: positiveOr('engrave depth', options.engraveDepthMm, 0.5),
    safeZMm: positiveOr('safe Z', options.safeZMm, 5),
    feedMmPerMin: positiveOr(
      'feed rate',
      options.feedMmPerMin,
      torch ? 2500 : 1000,
    ),
    plungeMmPerMin: positiveOr('plunge rate', options.plungeMmPerMin, 300),
    spindleRpm: positiveOr('spindle speed', options.spindleRpm, 18000),
    tabs:
      options.tabs === false || torch
        ? false
        : {
            count: Math.round(positiveOr('tab count', options.tabs?.count, 4)),
            widthMm: positiveOr('tab width', options.tabs?.widthMm, 6),
            heightMm: positiveOr('tab height', options.tabs?.heightMm, 1.5),
          },
    pierceDelayS: positiveOr('pierce delay', options.pierceDelayS, 0.5, true),
    leadInMm: torch ? positiveOr('lead-in', options.leadInMm, 2, true) : 0,
    arcs: options.arcs !== false,
    title: (options.title ?? 'maker-export').replace(/[()]/g, ''),
  }
  if (settings.safeZMm < RETRACT_MM) {
    throw new Error(`G-code: safe Z must be at least ${RETRACT_MM} mm.`)
  }
  return settings
}

function flip(points: Point2[], heightMm: number): Point2[] {
  return points.map((p) => ({ x: p.x, y: heightMm - p.y }))
}

function orient(ring: Point2[], ccw: boolean): Point2[] {
  return ringSignedArea(ring) > 0 === ccw ? ring : [...ring].reverse()
}

/**
 * Offset parts outward (and so holes inward) by `delta` mm with round
 * corners. Parts closer than 2 × delta merge; holes narrower than it vanish.
 */
function offsetShapes(
  shapes: Shape2D[],
  delta: number,
): { outers: Point2[][]; holes: Point2[][] } {
  if (delta <= 0) {
    return {
      outers: shapes.map((s) => s.outer),
      holes: shapes.flatMap((s) => s.holes),
    }
  }
  const toInt = (ring: Point2[]): Path =>
    ring.map((p) => ({
      X: Math.round(p.x * SCALE),
      Y: Math.round(p.y * SCALE),
    }))
  const offset = new ClipperLib.ClipperOffset(2, 0.002 * SCALE)
  offset.AddPaths(
    // Clipper reads orientation: outers anticlockwise, holes clockwise.
    shapes.flatMap((s) => [
      toInt(orient(s.outer, true)),
      ...s.holes.map((h) => toInt(orient(h, false))),
    ]),
    ClipperLib.JoinType.jtRound,
    ClipperLib.EndType.etClosedPolygon,
  )
  const solution: Paths = []
  offset.Execute(solution, delta * SCALE)
  const outers: Point2[][] = []
  const holes: Point2[][] = []
  for (const path of solution) {
    const ring = path.map((p) => ({ x: p.X / SCALE, y: p.Y / SCALE }))
    if (ring.length < 3) continue
    if (ClipperLib.Clipper.Orientation(path)) outers.push(ring)
    else holes.push(ring)
  }
  return { outers, holes }
}

/** Arc centre for a bulged segment a → b (y-up; positive bulge = CCW). */
function bulgeCenter(a: Point2, b: Point2, bulge: number): Point2 {
  const sweep = 4 * Math.atan(bulge)
  const dx = b.x - a.x
  const dy = b.y - a.y
  const chord = Math.hypot(dx, dy)
  const r = chord / (2 * Math.sin(sweep / 2))
  const d = r * Math.cos(sweep / 2)
  return {
    x: (a.x + b.x) / 2 - (d * dy) / chord,
    y: (a.y + b.y) / 2 + (d * dx) / chord,
  }
}

/** A path as tool moves, with arcs fitted when `arcs` is on. */
function toSegments(
  points: Point2[],
  closed: boolean,
  arcs: boolean,
): ToolpathSegment[] {
  const lines = (): ToolpathSegment[] => {
    const count = closed ? points.length : points.length - 1
    const out: ToolpathSegment[] = []
    for (let i = 0; i < count; i++) {
      out.push({
        type: 'line',
        from: points[i],
        to: points[(i + 1) % points.length],
      })
    }
    return out
  }
  if (!arcs) return lines()
  const fitted = fitArcs(points, closed)
  if (fitted.kind === 'circle') {
    const clockwise = ringSignedArea(points) < 0
    const c = { x: fitted.cx, y: fitted.cy }
    const right = { x: c.x + fitted.r, y: c.y }
    const left = { x: c.x - fitted.r, y: c.y }
    return [
      { type: 'arc', from: right, to: left, center: c, clockwise },
      { type: 'arc', from: left, to: right, center: c, clockwise },
    ]
  }
  const v = fitted.vertices
  const count = fitted.closed ? v.length : v.length - 1
  const out: ToolpathSegment[] = []
  for (let i = 0; i < count; i++) {
    const a = { x: v[i].x, y: v[i].y }
    const b = { x: v[(i + 1) % v.length].x, y: v[(i + 1) % v.length].y }
    if (v[i].bulge === 0) {
      out.push({ type: 'line', from: a, to: b })
    } else {
      out.push({
        type: 'arc',
        from: a,
        to: b,
        center: bulgeCenter(a, b, v[i].bulge),
        clockwise: v[i].bulge < 0,
      })
    }
  }
  return out
}

function arcSweep(seg: Extract<ToolpathSegment, { type: 'arc' }>): number {
  const a0 = Math.atan2(seg.from.y - seg.center.y, seg.from.x - seg.center.x)
  const a1 = Math.atan2(seg.to.y - seg.center.y, seg.to.x - seg.center.x)
  let sweep = a1 - a0
  if (seg.clockwise) {
    while (sweep >= 0) sweep -= 2 * Math.PI
  } else {
    while (sweep <= 0) sweep += 2 * Math.PI
  }
  return sweep
}

export function segmentLength(seg: ToolpathSegment): number {
  if (seg.type === 'line') {
    return Math.hypot(seg.to.x - seg.from.x, seg.to.y - seg.from.y)
  }
  const r = Math.hypot(seg.from.x - seg.center.x, seg.from.y - seg.center.y)
  return Math.abs(arcSweep(seg)) * r
}

/** The point `distance` mm along a segment. */
function pointAlong(seg: ToolpathSegment, distance: number): Point2 {
  const length = segmentLength(seg)
  const t = length === 0 ? 0 : distance / length
  if (seg.type === 'line') {
    return {
      x: seg.from.x + (seg.to.x - seg.from.x) * t,
      y: seg.from.y + (seg.to.y - seg.from.y) * t,
    }
  }
  const r = Math.hypot(seg.from.x - seg.center.x, seg.from.y - seg.center.y)
  const a = Math.atan2(seg.from.y - seg.center.y, seg.from.x - seg.center.x)
  const angle = a + arcSweep(seg) * t
  return {
    x: seg.center.x + r * Math.cos(angle),
    y: seg.center.y + r * Math.sin(angle),
  }
}

/** Split a path at the given distances, tagging the pieces inside `tabs`. */
function piecesWithTabs(
  segments: ToolpathSegment[],
  tabs: [number, number][],
): { segment: ToolpathSegment; inTab: boolean }[] {
  const cuts = tabs.flat().sort((p, q) => p - q)
  const inTab = (d: number): boolean => tabs.some(([s, e]) => d > s && d < e)
  const out: { segment: ToolpathSegment; inTab: boolean }[] = []
  let start = 0
  for (const seg of segments) {
    const length = segmentLength(seg)
    const marks = cuts.filter(
      (d) => d > start + 1e-9 && d < start + length - 1e-9,
    )
    let from = seg.from
    let done = 0
    for (const d of [...marks.map((m) => m - start), length]) {
      const to = d === length ? seg.to : pointAlong(seg, d)
      const piece: ToolpathSegment =
        seg.type === 'line' ? { type: 'line', from, to } : { ...seg, from, to }
      out.push({ segment: piece, inTab: inTab(start + (done + d) / 2) })
      from = to
      done = d
    }
    start += length
  }
  return out
}

/** Evenly spaced tab intervals, or none when the outline is too small. */
function tabIntervals(
  segments: ToolpathSegment[],
  settings: ResolvedGcodeOptions,
): [number, number][] {
  if (!settings.tabs) return []
  const total = segments.reduce((n, s) => n + segmentLength(s), 0)
  const lifted = settings.tabs.widthMm + settings.toolDiameterMm
  const count = Math.min(settings.tabs.count, Math.floor(total / (2 * lifted)))
  const intervals: [number, number][] = []
  for (let i = 0; i < count; i++) {
    const center = (total * (i + 0.5)) / count
    intervals.push([center - lifted / 2, center + lifted / 2])
  }
  return intervals
}

function reverseSegments(segments: ToolpathSegment[]): ToolpathSegment[] {
  return [...segments]
    .reverse()
    .map((s) =>
      s.type === 'line'
        ? { type: 'line', from: s.to, to: s.from }
        : { ...s, from: s.to, to: s.from, clockwise: !s.clockwise },
    )
}

function insideRing(p: Point2, ring: Point2[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]
    const b = ring[j]
    if (a.y > p.y !== b.y > p.y) {
      const x = a.x + ((p.y - a.y) * (b.x - a.x)) / (b.y - a.y)
      if (p.x < x) inside = !inside
    }
  }
  return inside
}

function distanceToRing(p: Point2, ring: Point2[]): number {
  let best = Infinity
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const lengthSq = dx * dx + dy * dy
    const t =
      lengthSq === 0
        ? 0
        : Math.max(
            0,
            Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq),
          )
    best = Math.min(
      best,
      Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t)),
    )
  }
  return best
}

/**
 * Lead-in start: up to `length` mm off the contour start, on the scrap side.
 * It is shortened until the pierce point sits clear of the contour, so a hole
 * smaller than the lead-in is pierced inside its slug, not across on the part.
 */
function leadInPoint(
  segments: ToolpathSegment[],
  ring: Point2[],
  kind: 'hole' | 'outline',
  length: number,
): Point2 | undefined {
  if (length <= 0 || segments.length === 0) return undefined
  const start = segments[0].from
  const ahead = pointAlong(
    segments[0],
    Math.min(0.5, segmentLength(segments[0])),
  )
  const tx = ahead.x - start.x
  const ty = ahead.y - start.y
  const t = Math.hypot(tx, ty) || 1
  // The ring's inside is on the left of travel when it runs anticlockwise.
  const insideLeft = ringSignedArea(ring) > 0
  // An outline's scrap is outside it; a hole's scrap is the slug inside.
  const scrapLeft = kind === 'hole' ? insideLeft : !insideLeft
  const nx = (scrapLeft ? -ty : ty) / t
  const ny = (scrapLeft ? tx : -tx) / t
  for (let l = length; l >= Math.min(length, 0.1); l /= 2) {
    const p = { x: start.x + nx * l, y: start.y + ny * l }
    if (
      insideRing(p, ring) === (kind === 'hole') &&
      distanceToRing(p, ring) >= l / 2 - 1e-9
    ) {
      return p
    }
  }
  return undefined
}

/**
 * Work out the toolpaths for a document without writing G-code: useful for
 * previews and for showing the warnings before export.
 */
export function planGcode(
  doc: ExportDoc,
  options: GcodeOptions = {},
): GcodePlan {
  const settings = resolveGcodeOptions(options)
  const torch = settings.process === 'torch'
  const warnings: string[] = []

  const textCount = doc.layers.reduce((n, l) => n + (l.texts?.length ?? 0), 0)
  const layers: ExportLayer[] = options.outliner
    ? outlineDocText(doc, options.outliner).layers
    : doc.layers
  if (!options.outliner && textCount > 0) {
    warnings.push(
      `${textCount} text item${textCount === 1 ? ' was' : 's were'} left out: text needs outlining before it can be cut.`,
    )
  }

  const cut = layers.filter((l) => l.kind === 'cut')
  const engrave = layers.filter((l) => l.kind === 'engrave')
  const operations: GcodeOperation[] = []

  // Engraving: router only, every path on its centreline.
  const engravePaths = engrave
    .flatMap((l) => l.paths)
    .filter((p) => p.points.length > 1)
  if (torch && engravePaths.length > 0) {
    warnings.push(
      `${engravePaths.length} engraving path${engravePaths.length === 1 ? ' was' : 's were'} left out: a torch can't engrave.`,
    )
  } else {
    for (const path of engravePaths) {
      const points = flip(path.points, doc.heightMm)
      operations.push({
        kind: 'engrave',
        segments: toSegments(points, path.closed, settings.arcs),
        closed: path.closed,
        tabs: [],
      })
    }
  }

  // Open cut paths: followed on the line.
  for (const path of cut.flatMap((l) => l.paths)) {
    if (path.closed || path.points.length < 2) continue
    operations.push({
      kind: 'open',
      segments: toSegments(
        flip(path.points, doc.heightMm),
        false,
        settings.arcs,
      ),
      closed: false,
      tabs: [],
    })
  }

  // Closed cut paths: parts and holes, offset for the tool.
  const shapes = regionShapes(
    cut
      .flatMap((l) => l.paths)
      .filter((p) => p.closed)
      .map((p) => flip(p.points, doc.heightMm)),
  )
  const radius =
    settings.compensation === 'none'
      ? 0
      : (torch ? settings.kerfMm : settings.toolDiameterMm) / 2
  const { outers, holes } = offsetShapes(shapes, radius)
  const holeCount = shapes.reduce((n, s) => n + s.holes.length, 0)
  if (holes.length < holeCount) {
    const n = holeCount - holes.length
    warnings.push(
      `${n} hole${n === 1 ? ' is' : 's are'} narrower than the ${torch ? 'kerf' : 'tool'} and won't be cut.`,
    )
  }
  if (outers.length < shapes.length) {
    warnings.push(
      'Some parts are closer together than the tool, so they are cut as one outline.',
    )
  }
  // Conventional (and every torch cut): outlines clockwise, holes
  // anticlockwise, keeping the part on the right. Climb is the reverse.
  const climb = !torch && settings.direction === 'climb'
  let untabbed = 0
  for (const [kind, rings] of [
    ['hole', holes],
    ['outline', outers],
  ] as const) {
    for (const raw of rings) {
      const ring = orient(raw, kind === 'outline' ? climb : !climb)
      const segments = toSegments(ring, true, settings.arcs)
      const tabs = kind === 'outline' ? tabIntervals(segments, settings) : []
      if (kind === 'outline' && settings.tabs && tabs.length === 0) untabbed++
      operations.push({
        kind,
        segments,
        closed: true,
        leadIn: torch
          ? leadInPoint(segments, ring, kind, settings.leadInMm)
          : undefined,
        tabs,
      })
    }
  }
  if (untabbed > 0) {
    warnings.push(
      `${untabbed} part${untabbed === 1 ? ' is' : 's are'} too small for holding tabs and will come loose on the last pass.`,
    )
  }
  if (settings.tabs && settings.tabs.heightMm >= settings.cutDepthMm) {
    warnings.push('Tabs are as tall as the cut, so outlines never cut through.')
  }
  if (operations.length === 0) {
    warnings.push('Nothing to cut: the design has no cut or engrave paths.')
  }

  return { settings, operations: orderOperations(operations), warnings }
}

/** Group order, then nearest-next within each group; open paths may reverse. */
function orderOperations(operations: GcodeOperation[]): GcodeOperation[] {
  const order: GcodeOperationKind[] = ['engrave', 'open', 'hole', 'outline']
  const startOf = (op: GcodeOperation): Point2 =>
    op.leadIn ?? op.segments[0].from
  const out: GcodeOperation[] = []
  let at: Point2 = { x: 0, y: 0 }
  for (const kind of order) {
    const pending = operations.filter(
      (op) => op.kind === kind && op.segments.length > 0,
    )
    while (pending.length > 0) {
      let best = 0
      let bestDistance = Infinity
      let reverse = false
      pending.forEach((op, i) => {
        const s = startOf(op)
        const d = Math.hypot(s.x - at.x, s.y - at.y)
        if (d < bestDistance) {
          bestDistance = d
          best = i
          reverse = false
        }
        if (!op.closed) {
          const e = op.segments[op.segments.length - 1].to
          const de = Math.hypot(e.x - at.x, e.y - at.y)
          if (de < bestDistance) {
            bestDistance = de
            best = i
            reverse = true
          }
        }
      })
      const [op] = pending.splice(best, 1)
      const next = reverse
        ? { ...op, segments: reverseSegments(op.segments) }
        : op
      out.push(next)
      at = next.segments[next.segments.length - 1].to
    }
  }
  return out
}

function num(value: number): string {
  const rounded = Number(value.toFixed(4))
  return (rounded === 0 ? 0 : rounded).toString()
}

function move(seg: ToolpathSegment, feed?: number): string {
  const f = feed === undefined ? '' : ` F${num(feed)}`
  if (seg.type === 'line') {
    return `G1 X${num(seg.to.x)} Y${num(seg.to.y)}${f}`
  }
  const i = seg.center.x - seg.from.x
  const j = seg.center.y - seg.from.y
  return `${seg.clockwise ? 'G2' : 'G3'} X${num(seg.to.x)} Y${num(seg.to.y)} I${num(i)} J${num(j)}${f}`
}

/** Depths for a router operation: step down to `depth`, last pass exact. */
function passDepths(depth: number, stepDown: number): number[] {
  const out: number[] = []
  for (let z = stepDown; z < depth - 1e-9; z += stepDown) out.push(-z)
  out.push(-depth)
  return out
}

function comment(text: string): string {
  return `(${text.replace(/[()]/g, '')})`
}

/** Render a G-code program for the document. */
export function renderGcode(
  doc: ExportDoc,
  options: GcodeOptions = {},
): string {
  const plan = planGcode(doc, options)
  const s = plan.settings
  const lines: string[] = [comment(s.title)]
  if (s.process === 'router') {
    lines.push(
      comment(
        `Router: ${num(s.toolDiameterMm)} mm tool, cut ${num(s.cutDepthMm)} mm deep in ${num(s.stepDownMm)} mm passes, ${s.direction} milling`,
      ),
    )
  } else {
    lines.push(comment(`Torch: ${num(s.kerfMm)} mm kerf, M3 on / M5 off`))
  }
  lines.push(
    comment(
      'Origin: X0 Y0 at the bottom-left of the sheet, Z0 at the top of the stock',
    ),
  )
  for (const warning of plan.warnings)
    lines.push(comment(`Warning: ${warning}`))
  lines.push('G21 G90 G17 G94')

  if (s.process === 'torch') {
    for (const op of plan.operations) {
      const start = op.segments[0].from
      const pierce = op.leadIn ?? start
      lines.push(`G0 X${num(pierce.x)} Y${num(pierce.y)}`, 'M3')
      if (s.pierceDelayS > 0) lines.push(`G4 P${num(s.pierceDelayS)}`)
      let feed: number | undefined = s.feedMmPerMin
      if (op.leadIn) {
        lines.push(
          `G1 X${num(start.x)} Y${num(start.y)} F${num(s.feedMmPerMin)}`,
        )
        feed = undefined
      }
      for (const seg of op.segments) {
        lines.push(move(seg, feed))
        feed = undefined
      }
      lines.push('M5')
    }
    lines.push('G0 X0 Y0', 'M2')
    return lines.join('\n') + '\n'
  }

  const safe = num(s.safeZMm)
  lines.push(`G0 Z${safe}`, `S${num(s.spindleRpm)} M3`, 'G4 P2')
  const tabTop = s.tabs ? -s.cutDepthMm + s.tabs.heightMm : -Infinity
  for (const op of plan.operations) {
    const depth = op.kind === 'engrave' ? s.engraveDepthMm : s.cutDepthMm
    const start = op.segments[0].from
    lines.push(
      `G0 Z${safe}`,
      `G0 X${num(start.x)} Y${num(start.y)}`,
      `G0 Z${num(RETRACT_MM)}`,
    )
    passDepths(depth, s.stepDownMm).forEach((z, pass) => {
      if (pass > 0 && !op.closed) {
        lines.push(
          `G0 Z${num(RETRACT_MM)}`,
          `G0 X${num(start.x)} Y${num(start.y)}`,
        )
      }
      lines.push(`G1 Z${num(z)} F${num(s.plungeMmPerMin)}`)
      let currentZ = z
      let feed: number | undefined = s.feedMmPerMin
      const pieces =
        op.tabs.length > 0 && z < tabTop
          ? piecesWithTabs(op.segments, op.tabs)
          : op.segments.map((segment) => ({ segment, inTab: false }))
      for (const { segment, inTab } of pieces) {
        const targetZ = inTab ? tabTop : z
        if (targetZ !== currentZ) {
          lines.push(`G1 Z${num(targetZ)} F${num(s.plungeMmPerMin)}`)
          currentZ = targetZ
          feed = s.feedMmPerMin
        }
        lines.push(move(segment, feed))
        feed = undefined
      }
      if (currentZ !== z) {
        lines.push(`G1 Z${num(z)} F${num(s.plungeMmPerMin)}`)
      }
    })
  }
  lines.push(`G0 Z${safe}`, 'M5', 'G0 X0 Y0', 'M2')
  return lines.join('\n') + '\n'
}
