/**
 * Generic SVG writer for the neutral export model — a clean cut file (strokes
 * only by default, no decorative fills), sized in millimetres. SVG is y-down
 * like the model, so no coordinate flip is needed.
 *
 * Handles both paths and text, and honours each layer's colour override, so it
 * can render any tool's design (and any single-machine slice of one).
 *
 * Two profiles:
 *  - `default` — each layer is drawn in its own colour (the kind's default or
 *    its override), stroked unless the layer asks to be filled.
 *  - `atomm` — colours are forced to Atomm's processing colours (cut = red
 *    stroke, line engrave = blue stroke, fill engrave = blue fill) so the
 *    platform can infer each element's processing type. Layer colour overrides
 *    are ignored on purpose: an arbitrary colour would land in Atomm's "Other
 *    vector" group and make the user assign every type by hand.
 */
import {
  ATOMM_COLOR,
  layerColor,
  type ExportDoc,
  type ExportLayer,
  type ExportPath,
  type ExportText,
} from './types.ts'

/** Which colour convention the SVG uses. */
export type SvgProfile = 'default' | 'atomm'

/** Options for {@link renderSvg}. */
export interface SvgOptions {
  /** Colour convention; defaults to `default`. */
  profile?: SvgProfile
}

/** The fill and stroke paint of one element (`none` for an unused channel). */
interface Paint {
  fill: string
  stroke: string
}

/** Round to 3 decimals, dropping trailing zeros. */
function f(n: number): string {
  return Number(n.toFixed(3)).toString()
}

/** Escape a string for XML text/attribute content. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function pathData(path: ExportPath): string {
  const pts = path.points
  if (pts.length === 0) return ''
  const [first, ...rest] = pts
  let d = `M ${f(first.x)} ${f(first.y)}`
  for (const p of rest) d += ` L ${f(p.x)} ${f(p.y)}`
  if (path.closed) d += ' Z'
  return d
}

/** Paint for a stroked (outline) element on `layer`. */
function strokePaint(layer: ExportLayer, profile: SvgProfile): Paint {
  if (profile === 'atomm') {
    const stroke: string =
      layer.kind === 'cut' ? ATOMM_COLOR.cut : ATOMM_COLOR.lineEngrave
    return { fill: 'none', stroke }
  }
  return { fill: 'none', stroke: layerColor(layer) }
}

/**
 * Paint for a filled element on `layer`. A cut layer is never filled (a cut is
 * always a stroke), so it falls back to its stroke paint.
 */
function fillPaint(layer: ExportLayer, profile: SvgProfile): Paint {
  if (profile === 'atomm') {
    if (layer.kind === 'cut') return strokePaint(layer, profile)
    return { fill: ATOMM_COLOR.fillEngrave, stroke: 'none' }
  }
  return { fill: layerColor(layer), stroke: 'none' }
}

/** Paint for a path: filled only when the layer is a fill layer and it is closed. */
function pathPaint(
  layer: ExportLayer,
  path: ExportPath,
  profile: SvgProfile,
): Paint {
  if (layer.fill === true && path.closed) return fillPaint(layer, profile)
  return strokePaint(layer, profile)
}

function textEl(
  text: ExportText,
  layer: ExportLayer,
  profile: SvgProfile,
): string {
  const anchor =
    text.anchor === 'middle'
      ? 'middle'
      : text.anchor === 'end'
        ? 'end'
        : 'start'
  const rot = text.rotationDeg
    ? ` transform="rotate(${f(text.rotationDeg)} ${f(text.x)} ${f(text.y)})"`
    : ''
  // Default profile keeps the long-standing look: glyphs painted in the layer
  // colour. Atomm text is always solid (a fill engrave) unless it is a cut.
  const paint: Paint =
    profile === 'atomm'
      ? fillPaint({ ...layer, fill: true }, profile)
      : { fill: layerColor(layer), stroke: '' }
  const strokeAttr: string =
    paint.stroke === '' ? '' : ` stroke="${escapeXml(paint.stroke)}"`
  return (
    `<text x="${f(text.x)}" y="${f(text.y)}"${rot} ` +
    `font-family="Arial, Helvetica, sans-serif" font-size="${f(text.sizeMm)}" ` +
    `fill="${escapeXml(paint.fill)}"${strokeAttr} text-anchor="${anchor}" ` +
    `dominant-baseline="central">${escapeXml(text.value)}</text>`
  )
}

/** Render a neutral document to a standalone SVG cut-file string. */
export function renderSvg(doc: ExportDoc, options: SvgOptions = {}): string {
  const profile: SvgProfile = options.profile ?? 'default'
  const W: number = doc.widthMm
  const H: number = doc.heightMm
  const parts: string[] = []
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f(W)} ${f(H)}" ` +
      `width="${f(W)}mm" height="${f(H)}mm" role="img" aria-label="Cut file">`,
  )
  for (const layer of doc.layers) {
    // Closed paths on a fill layer are merged into ONE even-odd path: glyph
    // counters (the hole in an "o") are separate contours, and painting each
    // contour as its own solid shape would fill them in.
    const filledData: string[] = []
    for (const path of layer.paths) {
      const d: string = pathData(path)
      if (d === '') continue
      if (layer.fill === true && path.closed && layer.kind !== 'cut') {
        filledData.push(d)
        continue
      }
      const paint: Paint = pathPaint(layer, path, profile)
      const width: string = paint.stroke === 'none' ? '' : ' stroke-width="0.4"'
      parts.push(
        `<path d="${d}" fill="${escapeXml(paint.fill)}" ` +
          `stroke="${escapeXml(paint.stroke)}"${width} />`,
      )
    }
    if (filledData.length > 0) {
      const paint: Paint = fillPaint(layer, profile)
      parts.push(
        `<path d="${filledData.join(' ')}" fill="${escapeXml(paint.fill)}" ` +
          `stroke="none" fill-rule="evenodd" />`,
      )
    }
    for (const text of layer.texts ?? []) {
      parts.push(textEl(text, layer, profile))
    }
  }
  parts.push('</svg>')
  return parts.join('')
}
