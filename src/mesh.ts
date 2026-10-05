/**
 * Turning a flat {@link ExportDoc} into 3D solids for the 3D-printing writers
 * (STL, 3MF). The document is 2D, so it is extruded:
 *
 * - Every **cut** layer's closed paths, combined even-odd (so a letter's counter
 *   or a hanging hole stays open), become the base plate, `thicknessMm` thick.
 * - Every **engrave** layer's closed paths become raised lettering/artwork on
 *   top of the plate, `engraveHeightMm` tall (or sit on the bed when the
 *   document has no cut geometry). Each engrave layer is its own body, so a
 *   multi-colour 3MF can print it in its own filament.
 *
 * Open paths have no area, so they can't become solids; they are skipped and
 * counted in {@link Model3d.skippedOpenPaths}. Text must be outlined first —
 * pass a {@link TextOutliner} — otherwise it is skipped and counted too.
 *
 * Output is millimetres, z-up, right-handed, with the sheet's bottom-left
 * corner at the origin (the doc's y-down coordinates are flipped against
 * {@link ExportDoc.heightMm}). Every body is closed and manifold, with
 * outward-facing (counter-clockwise) triangles.
 */
import earcut from 'earcut'
import { outlineDocText, type Point2, type TextOutliner } from './text.ts'
import {
  layerColor,
  LAYER_NAME,
  type ExportDoc,
  type ExportLayer,
} from './types.ts'

/** A point in millimetres, z-up. */
export interface Vec3 {
  x: number
  y: number
  z: number
}

/** Three corners, counter-clockwise seen from outside the solid. */
export type Triangle = [Vec3, Vec3, Vec3]

/** One closed solid, named and coloured after the layer(s) it came from. */
export interface Mesh {
  name: string
  /** `#rrggbb`. */
  color: string
  triangles: Triangle[]
}

export interface Model3dOptions {
  /** Base plate (cut layers) thickness, mm. Defaults to 3. */
  thicknessMm?: number
  /** Raised engraving height above the plate, mm. Defaults to 1. */
  engraveHeightMm?: number
  /** Leave the engrave layers out entirely. Defaults to false. */
  omitEngrave?: boolean
  /** Outlines text so it can be extruded; without it text is skipped. */
  outliner?: TextOutliner
}

export interface Model3d {
  meshes: Mesh[]
  /** Open paths left out because they enclose no area. */
  skippedOpenPaths: number
  /** Text elements left out because no outliner was given. */
  skippedTexts: number
}

/** A filled region: one counter-clockwise outer ring and its clockwise holes. */
export interface Shape2D {
  outer: Point2[]
  holes: Point2[][]
}

export const DEFAULT_THICKNESS_MM = 3
export const DEFAULT_ENGRAVE_HEIGHT_MM = 1

/** Shoelace signed area (positive = counter-clockwise, y-up). */
export function ringSignedArea(ring: Point2[]): number {
  let area = 0
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]
    const q = ring[(i + 1) % ring.length]
    area += p.x * q.y - q.x * p.y
  }
  return area / 2
}

/** Ray-cast point-in-polygon. */
function pointInRing(p: Point2, ring: Point2[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]
    const b = ring[j]
    if (
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside
    }
  }
  return inside
}

function orientRing(ring: Point2[], wantCcw: boolean): Point2[] {
  const isCcw = ringSignedArea(ring) > 0
  return isCcw === wantCcw ? ring : [...ring].reverse()
}

/**
 * Snap to a 0.0001 mm grid (what the writers print), then drop consecutive
 * duplicates and a repeated closing point, so walls never get zero-width faces.
 */
function cleanRing(points: Point2[]): Point2[] {
  const snap = (v: number): number => Math.round(v * 1e4) / 1e4 + 0
  const out: Point2[] = []
  for (const raw of points) {
    const p = { x: snap(raw.x), y: snap(raw.y) }
    const last = out[out.length - 1]
    if (!last || last.x !== p.x || last.y !== p.y) out.push(p)
  }
  while (
    out.length > 1 &&
    out[0].x === out[out.length - 1].x &&
    out[0].y === out[out.length - 1].y
  ) {
    out.pop()
  }
  return out
}

/**
 * Group rings into filled shapes, even-odd: a ring nested inside an even number
 * of others is an outer, an odd number a hole. Each hole belongs to the
 * smallest outer that contains it. Outers come back counter-clockwise and holes
 * clockwise. Degenerate rings (under three points or no area) are dropped.
 */
export function ringsToShapes(rings: Point2[][]): Shape2D[] {
  const meta = rings
    .map(cleanRing)
    .filter((ring) => ring.length >= 3 && ringSignedArea(ring) !== 0)
    .map((ring) => ({ ring, area: Math.abs(ringSignedArea(ring)), depth: 0 }))
  for (const m of meta) {
    for (const other of meta) {
      if (
        other !== m &&
        other.area > m.area &&
        pointInRing(m.ring[0], other.ring)
      )
        m.depth++
    }
  }
  const outers = meta.filter((m) => m.depth % 2 === 0)
  const holes = meta.filter((m) => m.depth % 2 === 1)
  return outers.map((outer) => ({
    outer: orientRing(outer.ring, true),
    holes: holes
      // A hole belongs to the outer exactly one level up...
      .filter((h) => h.depth === outer.depth + 1)
      // ...and of the outers at that depth, only one can contain it.
      .filter((h) => h.area < outer.area && pointInRing(h.ring[0], outer.ring))
      .map((h) => orientRing(h.ring, false)),
  }))
}

type Tri2 = [Point2, Point2, Point2]

/** Below this (mm²) a triangle is treated as having no area. */
const DEGENERATE_AREA = 1e-10
/** A vertex this close (mm) to an edge's line lies on it. */
const ON_EDGE_TOLERANCE = 1e-7

/**
 * Buckets the shape's vertices on a grid so each triangle edge only tests the
 * vertices it passes near, not all of them.
 */
function vertexGrid(points: Point2[]): (a: Point2, b: Point2) => Point2[] {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of points) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  const cell = Math.max(
    Math.sqrt(((maxX - minX) * (maxY - minY)) / points.length),
    1e-3,
  )
  const cols = Math.floor((maxX - minX) / cell) + 1
  const rows = Math.floor((maxY - minY) / cell) + 1
  const cells: Point2[][] = Array.from({ length: cols * rows }, () => [])
  for (const p of points) {
    const ix = Math.floor((p.x - minX) / cell)
    const iy = Math.floor((p.y - minY) / cell)
    cells[iy * cols + ix].push(p)
  }
  // Which query last visited each cell, so a cell is only tested once per edge.
  const visited = new Int32Array(cols * rows)
  let query = 0
  return (a, b) => {
    query++
    const dx = b.x - a.x
    const dy = b.y - a.y
    const lengthSq = dx * dx + dy * dy
    const length = Math.sqrt(lengthSq)
    const found: { p: Point2; t: number }[] = []
    const steps = Math.max(1, Math.ceil(length / cell))
    for (let s = 0; s <= steps; s++) {
      const cx = Math.floor((a.x + (dx * s) / steps - minX) / cell)
      const cy = Math.floor((a.y + (dy * s) / steps - minY) / cell)
      for (
        let iy = Math.max(cy - 1, 0);
        iy <= Math.min(cy + 1, rows - 1);
        iy++
      ) {
        for (
          let ix = Math.max(cx - 1, 0);
          ix <= Math.min(cx + 1, cols - 1);
          ix++
        ) {
          const k = iy * cols + ix
          if (visited[k] === query) continue
          visited[k] = query
          for (const p of cells[k]) {
            const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq
            if (t <= 0 || t >= 1) continue
            const off = Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / length
            if (off <= ON_EDGE_TOLERANCE) found.push({ p, t })
          }
        }
      }
    }
    return found.sort((u, v) => u.t - v.t).map((f) => f.p)
  }
}

/**
 * Triangulate a shape into counter-clockwise 2D triangles that meet edge to
 * edge. earcut can drop a vertex that ends up collinear — two letters sharing a
 * baseline, say — leaving it on another triangle's edge (a T-junction), which
 * would open a crack between the cap and the walls. Such triangles are split
 * by fanning from their centroid through every vertex on their edges, and
 * zero-area slivers are dropped.
 */
export function triangulateShape(shape: Shape2D): Tri2[] {
  const points = [shape.outer, ...shape.holes].flat()
  const coords: number[] = []
  const holeIndices: number[] = []
  for (const p of shape.outer) coords.push(p.x, p.y)
  for (const hole of shape.holes) {
    holeIndices.push(coords.length / 2)
    for (const p of hole) coords.push(p.x, p.y)
  }
  const indices = earcut(coords, holeIndices.length ? holeIndices : undefined)
  const pointsOn = vertexGrid(points)
  const triangles: Tri2[] = []
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = [indices[i], indices[i + 1], indices[i + 2]].map(
      (j) => points[j],
    )
    const area = ringSignedArea([a, b, c])
    if (Math.abs(area) <= DEGENERATE_AREA) continue
    const corners = area > 0 ? [a, b, c] : [a, c, b]
    const boundary = corners.flatMap((p, k) => [
      p,
      ...pointsOn(p, corners[(k + 1) % 3]),
    ])
    if (boundary.length === 3) {
      triangles.push(corners as Tri2)
      continue
    }
    const centroid = {
      x: (a.x + b.x + c.x) / 3,
      y: (a.y + b.y + c.y) / 3,
    }
    boundary.forEach((p, k) => {
      triangles.push([centroid, p, boundary[(k + 1) % boundary.length]])
    })
  }
  return triangles
}

/** Extrude shapes straight up from `z0` to `z1` into closed solids. */
export function extrudeShapes(
  shapes: Shape2D[],
  z0: number,
  z1: number,
): Triangle[] {
  const at = (p: Point2, z: number): Vec3 => ({ x: p.x, y: p.y, z })
  const triangles: Triangle[] = []
  for (const shape of shapes) {
    for (const [a, b, c] of triangulateShape(shape)) {
      triangles.push([at(a, z1), at(b, z1), at(c, z1)]) // top, facing +z
      triangles.push([at(a, z0), at(c, z0), at(b, z0)]) // bottom, facing -z
    }
    // Outers run CCW and holes CW, so the solid is always on the left of each
    // edge and the wall faces right: outward.
    for (const ring of [shape.outer, ...shape.holes]) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i]
        const b = ring[(i + 1) % ring.length]
        triangles.push([at(a, z0), at(b, z0), at(b, z1)])
        triangles.push([at(a, z0), at(b, z1), at(a, z1)])
      }
    }
  }
  return triangles
}

function closedRings(layers: ExportLayer[], heightMm: number): Point2[][] {
  return layers.flatMap((layer) =>
    layer.paths
      .filter((path) => path.closed)
      // y-down sheet → y-up model.
      .map((path) => path.points.map((p) => ({ x: p.x, y: heightMm - p.y }))),
  )
}

function positive(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0
    ? value
    : fallback
}

/**
 * Extrude a document into solids: one base-plate mesh from the cut layers
 * (coloured after the first cut layer) and one raised mesh per engrave layer.
 * Meshes that would be empty are left out.
 */
export function docToMeshes(
  doc: ExportDoc,
  options: Model3dOptions = {},
): Model3d {
  const thickness = positive(options.thicknessMm, DEFAULT_THICKNESS_MM)
  const engraveHeight = positive(
    options.engraveHeightMm,
    DEFAULT_ENGRAVE_HEIGHT_MM,
  )
  const layers = doc.layers.filter(
    (l) => !(options.omitEngrave && l.kind === 'engrave'),
  )
  const skippedTexts = options.outliner
    ? 0
    : layers.reduce((n, l) => n + (l.texts?.length ?? 0), 0)
  const outlined = options.outliner
    ? outlineDocText({ ...doc, layers }, options.outliner).layers
    : layers
  const skippedOpenPaths = outlined.reduce(
    (n, l) => n + l.paths.filter((p) => !p.closed).length,
    0,
  )

  const meshes: Mesh[] = []
  const cutLayers = outlined.filter((l) => l.kind === 'cut')
  const plate = extrudeShapes(
    ringsToShapes(closedRings(cutLayers, doc.heightMm)),
    0,
    thickness,
  )
  if (plate.length > 0) {
    meshes.push({
      name: LAYER_NAME.cut,
      color: layerColor(cutLayers[0]),
      triangles: plate,
    })
  }
  const base = plate.length > 0 ? thickness : 0
  const engraveLayers = outlined.filter((l) => l.kind === 'engrave')
  engraveLayers.forEach((layer, i) => {
    const triangles = extrudeShapes(
      ringsToShapes(closedRings([layer], doc.heightMm)),
      base,
      base + engraveHeight,
    )
    if (triangles.length === 0) return
    meshes.push({
      name:
        engraveLayers.length > 1
          ? `${LAYER_NAME.engrave} ${i + 1}`
          : LAYER_NAME.engrave,
      color: layerColor(layer),
      triangles,
    })
  })
  return { meshes, skippedOpenPaths, skippedTexts }
}

/** Unit normal of a triangle (zero for a degenerate one). */
export function triangleNormal([a, b, c]: Triangle): Vec3 {
  const ux = b.x - a.x
  const uy = b.y - a.y
  const uz = b.z - a.z
  const vx = c.x - a.x
  const vy = c.y - a.y
  const vz = c.z - a.z
  const n = { x: uy * vz - uz * vy, y: uz * vx - ux * vz, z: ux * vy - uy * vx }
  const len = Math.hypot(n.x, n.y, n.z)
  return len === 0
    ? { x: 0, y: 0, z: 0 }
    : { x: n.x / len, y: n.y / len, z: n.z / len }
}
