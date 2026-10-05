/**
 * HPGL (`.plt`) writer for vinyl cutters, drag-knife sign cutters and pen
 * plotters (Graphtec, Roland, and most cutters' "HPGL mode").
 *
 * HPGL has no layers or colours, only pens, so each layer kind gets a pen
 * number (CUT = 1, ENGRAVE = 2 by default; on a cutter, pen 1 is usually the
 * knife). Coordinates are plotter units of 0.025 mm (40 per mm), y-up, with
 * the origin at the sheet's bottom-left corner. HPGL can't place text, so text
 * must be outlined first (pass the doc through `outlineDocText`); unoutlined
 * text is left out.
 */
import type { ExportDoc, ExportLayerKind, ExportPoint } from './types.ts'

export const HPGL_MIME = 'application/vnd.hp-hpgl'

/** Plotter units per millimetre. */
export const HPGL_UNITS_PER_MM = 40

export interface HpglOptions {
  /** Layer kinds to plot. Defaults to every kind. */
  kinds?: ExportLayerKind[]
  /** Pen per layer kind. Defaults to CUT = 1, ENGRAVE = 2. */
  pens?: Partial<Record<ExportLayerKind, number>>
  /**
   * Cut this far past the start of each closed path, mm, so a drag knife fully
   * separates the shape where the cut begins and ends. Defaults to 0 (many
   * cutters add their own overcut).
   */
  overcutMm?: number
}

const DEFAULT_PENS: Record<ExportLayerKind, number> = { cut: 1, engrave: 2 }

/** `length` mm further along a closed ring, starting from its first point. */
function overcut(points: ExportPoint[], length: number): ExportPoint[] {
  const out: ExportPoint[] = []
  let left = length
  for (let k = 1; k <= points.length && left > 0; k++) {
    const a = points[k - 1]
    const b = points[k % points.length]
    const step = Math.hypot(b.x - a.x, b.y - a.y)
    if (step === 0) continue
    if (step >= left) {
      const t = left / step
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
      break
    }
    out.push(b)
    left -= step
  }
  return out
}

/** Render a neutral document to HPGL. */
export function renderHpgl(doc: ExportDoc, options: HpglOptions = {}): string {
  const kinds = options.kinds ?? ['cut', 'engrave']
  const pens = { ...DEFAULT_PENS, ...options.pens }
  const extra = Math.max(0, options.overcutMm ?? 0)
  const unit = (p: ExportPoint): string =>
    `${Math.round(p.x * HPGL_UNITS_PER_MM)},${Math.round(
      (doc.heightMm - p.y) * HPGL_UNITS_PER_MM,
    )}`

  const commands: string[] = ['IN', 'PA']
  let pen = 0
  for (const layer of doc.layers) {
    if (!kinds.includes(layer.kind)) continue
    for (const path of layer.paths) {
      if (path.points.length < 2) continue
      if (pens[layer.kind] !== pen) {
        pen = pens[layer.kind]
        commands.push(`SP${pen}`)
      }
      const points = [...path.points]
      if (path.closed) {
        points.push(path.points[0])
        if (extra > 0) points.push(...overcut(path.points, extra))
      }
      commands.push(`PU${unit(points[0])}`)
      commands.push(`PD${points.slice(1).map(unit).join(',')}`)
    }
  }
  commands.push('PU0,0', 'SP0')
  return commands.map((c) => `${c};`).join('\n') + '\n'
}
