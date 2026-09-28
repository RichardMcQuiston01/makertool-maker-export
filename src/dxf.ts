/**
 * Generic DXF (AC1015 / AutoCAD 2000) writer for the neutral export model —
 * enough to hand a laser or CNC a real cut file, not a general DXF library.
 *
 * Emits a HEADER (units = millimetres), a TABLES section defining CUT and
 * ENGRAVE layers (so the kind→process mapping survives), and an ENTITIES
 * section: one closed/open LWPOLYLINE per path plus a TEXT entity per text.
 * DXF is y-up, so every y is flipped across the sheet height.
 */
import {
  type ExportDoc,
  type ExportLayerKind,
  type ExportText,
} from './types.ts'

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

function header(): string {
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

function layerEntry(name: string, color: number): string {
  return (
    pair(0, 'LAYER') +
    pair(100, 'AcDbSymbolTableRecord') +
    pair(100, 'AcDbLayerTableRecord') +
    pair(2, name) +
    pair(70, 0) +
    pair(62, color) +
    pair(6, 'CONTINUOUS')
  )
}

function tables(): string {
  return (
    pair(0, 'SECTION') +
    pair(2, 'TABLES') +
    pair(0, 'TABLE') +
    pair(2, 'LAYER') +
    pair(70, 2) +
    layerEntry(LAYER_OF.cut, COLOR_OF.cut) +
    layerEntry(LAYER_OF.engrave, COLOR_OF.engrave) +
    pair(0, 'ENDTAB') +
    pair(0, 'ENDSEC')
  )
}

function polyline(
  points: { x: number; y: number }[],
  closed: boolean,
  layer: string,
  flipY: (y: number) => number,
): string {
  let out =
    pair(0, 'LWPOLYLINE') +
    pair(100, 'AcDbEntity') +
    pair(8, layer) +
    pair(100, 'AcDbPolyline') +
    pair(90, points.length) +
    pair(70, closed ? 1 : 0)
  for (const p of points) {
    out += pair(10, n(p.x)) + pair(20, n(flipY(p.y)))
  }
  return out
}

function textEntity(
  text: ExportText,
  layer: string,
  flipY: (y: number) => number,
): string {
  const value = sanitizeText(text.value)
  if (value === '') return ''
  const y = n(flipY(text.y))
  const justify = text.anchor === 'middle' ? 1 : text.anchor === 'end' ? 2 : 0
  // DXF is y-up with CCW-positive rotation; the writer flips y, so a clockwise
  // (screen) rotation maps to the negated angle.
  const rotation = text.rotationDeg ? pair(50, n(-text.rotationDeg)) : ''
  return (
    pair(0, 'TEXT') +
    pair(100, 'AcDbEntity') +
    pair(8, layer) +
    pair(100, 'AcDbText') +
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
    pair(100, 'AcDbText')
  )
}

/** Render a neutral document to a DXF string. */
export function renderDxf(doc: ExportDoc): string {
  const flipY = (y: number): number => doc.heightMm - y
  let entities = pair(0, 'SECTION') + pair(2, 'ENTITIES')
  for (const layer of doc.layers) {
    const name = LAYER_OF[layer.kind]
    for (const path of layer.paths) {
      if (path.points.length > 0) {
        entities += polyline(path.points, path.closed, name, flipY)
      }
    }
    for (const text of layer.texts ?? []) {
      entities += textEntity(text, name, flipY)
    }
  }
  entities += pair(0, 'ENDSEC')
  return header() + tables() + entities + pair(0, 'EOF')
}
