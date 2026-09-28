/**
 * LightBurn project (`.lbrn2`) writer. Emits a `<LightBurnProject>` with one
 * `<CutSetting>` per processing kind present (so the CUT/ENGRAVE split survives
 * the round trip) and one `<Shape Type="Path">` per polyline, built from
 * `<V>` vertices and `<P>` line primitives.
 *
 * LightBurn's coordinate space is y-UP, so every y is flipped across the sheet
 * height; the design then sits in the positive quadrant matching the sheet.
 *
 * Not a general LightBurn library — just enough to hand LightBurn a real cut
 * file. Only straight line segments are emitted (our paths are already
 * flattened polylines), so no bezier primitives are needed.
 */
import {
  LAYER_NAME,
  usedLayerKinds,
  type ExportDoc,
  type ExportLayerKind,
  type ExportPath,
} from './types.ts'

/** Round to 3 decimals, dropping trailing zeros, to keep the file compact. */
function f(n: number): string {
  return Number(n.toFixed(3)).toString()
}

/** Escape a string for an XML attribute value. */
function attr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * LightBurn cut settings are addressed by index; a shape's `CutIndex` points at
 * one. We assign the used kinds contiguous indices in a stable order so the
 * mapping is deterministic. `Cut` is a vector cut; `Scan` is a raster/engrave
 * fill.
 */
function cutIndexMap(kinds: ExportLayerKind[]): Map<ExportLayerKind, number> {
  return new Map(kinds.map((kind, i) => [kind, i]))
}

function cutSetting(kind: ExportLayerKind, index: number): string {
  const type = kind === 'cut' ? 'Cut' : 'Scan'
  return (
    `  <CutSetting type="${type}">\n` +
    `    <index Value="${index}"/>\n` +
    `    <name Value="${attr(LAYER_NAME[kind])}"/>\n` +
    `    <priority Value="${index}"/>\n` +
    `  </CutSetting>\n`
  )
}

/** One `<Shape Type="Path">` from a polyline, with y flipped into LightBurn space. */
function pathShape(
  path: ExportPath,
  cutIndex: number,
  flipY: (y: number) => number,
): string {
  const pts = path.points
  if (pts.length < 2) return ''
  const verts = pts
    .map((p) => `    <V vx="${f(p.x)}" vy="${f(flipY(p.y))}"/>\n`)
    .join('')
  // Line primitives between consecutive vertices; the closing segment joins the
  // last vertex back to the first.
  const segEnd = path.closed ? pts.length : pts.length - 1
  let prims = ''
  for (let i = 0; i < segEnd; i++) {
    const a = i
    const b = (i + 1) % pts.length
    prims += `    <P T="L" p0="${a}" p1="${b}"/>\n`
  }
  return (
    `  <Shape Type="Path" CutIndex="${cutIndex}">\n` +
    `    <XForm>1 0 0 1 0 0</XForm>\n` +
    verts +
    prims +
    `  </Shape>\n`
  )
}

/** Render a neutral document to a LightBurn `.lbrn2` XML string. */
export function renderLightBurn(doc: ExportDoc): string {
  const kinds = usedLayerKinds(doc)
  const indexOf = cutIndexMap(kinds)
  const flipY = (y: number): number => doc.heightMm - y

  const settings = kinds
    .map((kind) => cutSetting(kind, indexOf.get(kind) as number))
    .join('')

  let shapes = ''
  for (const layer of doc.layers) {
    const cutIndex = indexOf.get(layer.kind)
    if (cutIndex === undefined) continue
    for (const path of layer.paths) {
      shapes += pathShape(path, cutIndex, flipY)
    }
  }

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<LightBurnProject AppVersion="1.6.00" FormatVersion="1" MaterialHeight="0" MirrorX="False" MirrorY="False">\n` +
    settings +
    shapes +
    `</LightBurnProject>\n`
  )
}
