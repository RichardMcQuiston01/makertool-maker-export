/**
 * Generic SVG writer for the neutral export model — a clean cut file (strokes
 * only, no decorative fills), sized in millimetres. SVG is y-down like the
 * model, so no coordinate flip is needed.
 *
 * Handles both paths and text, and honours each layer's colour override, so it
 * can render any tool's design (and any single-machine slice of one).
 */
import {
  layerColor,
  type ExportDoc,
  type ExportPath,
  type ExportText,
} from './types.ts'

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

function textEl(text: ExportText, color: string): string {
  const anchor =
    text.anchor === 'middle'
      ? 'middle'
      : text.anchor === 'end'
        ? 'end'
        : 'start'
  const rot = text.rotationDeg
    ? ` transform="rotate(${f(text.rotationDeg)} ${f(text.x)} ${f(text.y)})"`
    : ''
  return (
    `<text x="${f(text.x)}" y="${f(text.y)}"${rot} ` +
    `font-family="Arial, Helvetica, sans-serif" font-size="${f(text.sizeMm)}" ` +
    `fill="${escapeXml(color)}" text-anchor="${anchor}" ` +
    `dominant-baseline="central">${escapeXml(text.value)}</text>`
  )
}

/** Render a neutral document to a standalone SVG cut-file string. */
export function renderSvg(doc: ExportDoc): string {
  const W = doc.widthMm
  const H = doc.heightMm
  const parts: string[] = []
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f(W)} ${f(H)}" ` +
      `width="${f(W)}mm" height="${f(H)}mm" role="img" aria-label="Cut file">`,
  )
  for (const layer of doc.layers) {
    const color = layerColor(layer)
    for (const path of layer.paths) {
      const d = pathData(path)
      if (d) {
        parts.push(
          `<path d="${d}" fill="none" stroke="${escapeXml(color)}" stroke-width="0.4" />`,
        )
      }
    }
    for (const text of layer.texts ?? []) {
      parts.push(textEl(text, color))
    }
  }
  parts.push('</svg>')
  return parts.join('')
}
