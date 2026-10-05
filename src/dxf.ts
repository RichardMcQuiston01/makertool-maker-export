/**
 * Generic DXF writer for the neutral export model — enough to hand a laser,
 * CNC router, waterjet or plasma table a real cut file, not a general DXF
 * library.
 *
 * Emits a HEADER, a TABLES section defining CUT and ENGRAVE layers (so the
 * kind→process mapping survives), and an ENTITIES section: one polyline per
 * path plus a TEXT entity per text. DXF is y-up, so every y is flipped across
 * the sheet height.
 *
 * - `version: 'R2000'` (default) writes AC1015 with LWPOLYLINEs and declares
 *   millimetres. `'R12'` writes AC1009 with classic POLYLINE/VERTEX entities
 *   for older controllers and shop software (R12 has no units field; values
 *   are millimetres).
 * - `arcs: true` fits circular arcs onto runs of short segments (see
 *   {@link fitArcs}), so curves cut smoothly instead of as hundreds of tiny
 *   lines, and writes a closed path that is a whole circle as a CIRCLE.
 */
import {
  DEFAULT_ARC_TOLERANCE_MM,
  fitArcs,
  type BulgeVertex,
  type FittedPath,
} from './arcs.ts'
import {
  type ExportDoc,
  type ExportLayerKind,
  type ExportText,
} from './types.ts'

export type DxfVersion = 'R2000' | 'R12'

export interface DxfOptions {
  /** DXF dialect. Defaults to `R2000`. */
  version?: DxfVersion
  /** Fit arcs (and whole circles) onto curved runs. Defaults to false. */
  arcs?: boolean
  /** Largest deviation an arc may add, mm. Defaults to 0.01. */
  arcToleranceMm?: number
}

const LAYER_OF: Record<ExportLayerKind, string> = {
  cut: 'CUT',
  engrave: 'ENGRAVE',
}
// AutoCAD Color Index: 5 = blue (cut), 7 = black/white (engrave).
const COLOR_OF: Record<ExportLayerKind, number> = { cut: 5, engrave: 7 }

/** Emit a DXF group code / value pair. */
function pair(code: number, value: string | number): string {
  return `${code}\n${value}\n`
}

/** Format a coordinate for DXF (fixed precision, no exponent noise). */
function n(value: number): string {
  return Number(value.toFixed(4)).toString()
}

/**
 * DXF group-code-1 text must be a single line of printable characters. Drop
 * control characters (newlines, tabs, DEL, …) so the file stays valid, then
 * collapse the resulting whitespace runs. Done per code point rather than with a
 * control-character regex so the source carries no literal control bytes.
 */
function sanitizeText(text: string): string {
  let out = ''
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    out += code >= 0x20 && code !== 0x7f ? ch : ' '
  }
  return out.replace(/ {2,}/g, ' ').slice(0, 250).trim()
}

function header(version: DxfVersion): string {
  if (version === 'R12') {
    return (
      pair(0, 'SECTION') +
      pair(2, 'HEADER') +
      pair(9, '$ACADVER') +
      pair(1, 'AC1009') +
      pair(0, 'ENDSEC')
    )
  }
  return (
    pair(0, 'SECTION') +
    pair(2, 'HEADER') +
    pair(9, '$ACADVER') +
    pair(1, 'AC1015') +
    pair(9, '$INSUNITS') +
    pair(70, 4) +
    pair(0, 'ENDSEC')
  )
}

function layerEntry(name: string, color: number, version: DxfVersion): string {
  return (
    pair(0, 'LAYER') +
    (version === 'R12'
      ? ''
      : pair(100, 'AcDbSymbolTableRecord') +
        pair(100, 'AcDbLayerTableRecord')) +
    pair(2, name) +
    pair(70, 0) +
    pair(62, color) +
    pair(6, 'CONTINUOUS')
  )
}

function tables(version: DxfVersion): string {
  // R12 readers expect the CONTINUOUS line type the layers name to be defined.
  const lineTypes =
    version === 'R12'
      ? pair(0, 'TABLE') +
        pair(2, 'LTYPE') +
        pair(70, 1) +
        pair(0, 'LTYPE') +
        pair(2, 'CONTINUOUS') +
        pair(70, 0) +
        pair(3, 'Solid line') +
        pair(72, 65) +
        pair(73, 0) +
        pair(40, 0) +
        pair(0, 'ENDTAB')
      : ''
  return (
    pair(0, 'SECTION') +
    pair(2, 'TABLES') +
    lineTypes +
    pair(0, 'TABLE') +
    pair(2, 'LAYER') +
    pair(70, 2) +
    layerEntry(LAYER_OF.cut, COLOR_OF.cut, version) +
    layerEntry(LAYER_OF.engrave, COLOR_OF.engrave, version) +
    pair(0, 'ENDTAB') +
    pair(0, 'ENDSEC')
  )
}

/** A polyline whose vertices are already y-up. */
function polyline(
  vertices: BulgeVertex[],
  closed: boolean,
  layer: string,
  version: DxfVersion,
): string {
  const bulge = (v: BulgeVertex): string =>
    v.bulge === 0 ? '' : pair(42, n(v.bulge))
  if (version === 'R12') {
    let out =
      pair(0, 'POLYLINE') +
      pair(8, layer) +
      pair(66, 1) +
      pair(10, 0) +
      pair(20, 0) +
      pair(30, 0) +
      pair(70, closed ? 1 : 0)
    for (const v of vertices) {
      out +=
        pair(0, 'VERTEX') +
        pair(8, layer) +
        pair(10, n(v.x)) +
        pair(20, n(v.y)) +
        pair(30, 0) +
        bulge(v)
    }
    return out + pair(0, 'SEQEND') + pair(8, layer)
  }
  let out =
    pair(0, 'LWPOLYLINE') +
    pair(100, 'AcDbEntity') +
    pair(8, layer) +
    pair(100, 'AcDbPolyline') +
    pair(90, vertices.length) +
    pair(70, closed ? 1 : 0)
  for (const v of vertices) {
    out += pair(10, n(v.x)) + pair(20, n(v.y)) + bulge(v)
  }
  return out
}

function circle(
  c: { cx: number; cy: number; r: number },
  layer: string,
  version: DxfVersion,
): string {
  return (
    pair(0, 'CIRCLE') +
    (version === 'R12' ? '' : pair(100, 'AcDbEntity')) +
    pair(8, layer) +
    (version === 'R12' ? '' : pair(100, 'AcDbCircle')) +
    pair(10, n(c.cx)) +
    pair(20, n(c.cy)) +
    pair(30, 0) +
    pair(40, n(c.r))
  )
}

function pathEntity(
  fitted: FittedPath,
  layer: string,
  version: DxfVersion,
): string {
  return fitted.kind === 'circle'
    ? circle(fitted, layer, version)
    : polyline(fitted.vertices, fitted.closed, layer, version)
}

function textEntity(
  text: ExportText,
  layer: string,
  flipY: (y: number) => number,
  version: DxfVersion,
): string {
  const value = sanitizeText(text.value)
  if (value === '') return ''
  const y = n(flipY(text.y))
  const justify = text.anchor === 'middle' ? 1 : text.anchor === 'end' ? 2 : 0
  // DXF is y-up with CCW-positive rotation; the writer flips y, so a clockwise
  // (screen) rotation maps to the negated angle.
  const rotation = text.rotationDeg ? pair(50, n(-text.rotationDeg)) : ''
  const r12 = version === 'R12'
  return (
    pair(0, 'TEXT') +
    (r12 ? '' : pair(100, 'AcDbEntity')) +
    pair(8, layer) +
    (r12 ? '' : pair(100, 'AcDbText')) +
    pair(10, n(text.x)) +
    pair(20, y) +
    pair(30, 0) +
    pair(40, n(text.sizeMm)) +
    pair(1, value) +
    rotation +
    pair(72, justify) +
    pair(11, n(text.x)) +
    pair(21, y) +
    pair(31, 0) +
    (r12 ? '' : pair(100, 'AcDbText'))
  )
}

/** Render a neutral document to a DXF string. */
export function renderDxf(doc: ExportDoc, options: DxfOptions = {}): string {
  const version: DxfVersion = options.version === 'R12' ? 'R12' : 'R2000'
  const tolerance = options.arcToleranceMm ?? DEFAULT_ARC_TOLERANCE_MM
  const flipY = (y: number): number => doc.heightMm - y
  let entities = pair(0, 'SECTION') + pair(2, 'ENTITIES')
  for (const layer of doc.layers) {
    const name = LAYER_OF[layer.kind]
    for (const path of layer.paths) {
      if (path.points.length === 0) continue
      const points = path.points.map((p) => ({ x: p.x, y: flipY(p.y) }))
      const fitted: FittedPath = options.arcs
        ? fitArcs(points, path.closed, tolerance)
        : {
            kind: 'polyline',
            vertices: points.map((p) => ({ ...p, bulge: 0 })),
            closed: path.closed,
          }
      entities += pathEntity(fitted, name, version)
    }
    for (const text of layer.texts ?? []) {
      entities += textEntity(text, name, flipY, version)
    }
  }
  entities += pair(0, 'ENDSEC')
  return header(version) + tables(version) + entities + pair(0, 'EOF')
}
