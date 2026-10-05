/**
 * Vector PDF writer: one page the size of the sheet, with every path drawn in
 * its layer's colour. It's the format sign, waterjet and print shops most often
 * ask for alongside DXF, and laser print drivers (Epilog, Trotec, Glowforge)
 * read it directly.
 *
 * Paths are stroked as 0.001″ hairlines by default, which print-driver lasers
 * treat as vector cuts. Fill layers are painted solid, even-odd, like the SVG
 * writer. Text is real PDF text in Helvetica (one of the 14 standard fonts, so
 * nothing is embedded), placed and anchored the way the SVG writer places it;
 * pass the doc through `outlineDocText` first if the text must be outlines.
 *
 * The file is plain ASCII, so it fits the string `ExportFile.content`.
 */
import { layerColor, type ExportDoc, type ExportText } from './types.ts'

export const PDF_MIME = 'application/pdf'

export interface PdfOptions {
  /** Stroke width, mm. Defaults to 0.0254 (0.001″, a laser "hairline"). */
  strokeWidthMm?: number
  /** Document title (PDF metadata). */
  title?: string
}

const PT_PER_MM = 72 / 25.4

/**
 * Helvetica advance widths (per 1000 em) for WinAnsi codes 32–126, from the
 * standard Adobe font metrics. Used to anchor `middle`/`end` text.
 */
const HELVETICA_WIDTHS: number[] = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278,
  278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584,
  584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556,
  833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278,
  278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222,
  500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500,
  500, 334, 260, 334, 584,
]
/** Helvetica cap height per em; text is centred on its caps, as in the SVG. */
const HELVETICA_CAP_HEIGHT = 0.718

function num(value: number): string {
  const rounded = Number(value.toFixed(4))
  return (rounded === 0 ? 0 : rounded).toString()
}

/** `#rgb`/`#rrggbb` as PDF colour components; anything else is black. */
function rgb(color: string): string {
  let hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color)?.[1] ?? '000000'
  if (hex.length === 3) hex = [...hex].map((c) => c + c).join('')
  return [0, 2, 4]
    .map((i) => num(parseInt(hex.slice(i, i + 2), 16) / 255))
    .join(' ')
}

/**
 * Text as WinAnsi bytes: printable ASCII as is, Latin-1 letters by code, and
 * anything else (control characters, characters WinAnsi lacks) as `?`.
 */
function winAnsi(value: string): number[] {
  const codes: number[] = []
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0
    if (code >= 0x20 && code <= 0x7e) codes.push(code)
    else if (code >= 0xa0 && code <= 0xff) codes.push(code)
    else if (code >= 0x20) codes.push(0x3f)
  }
  return codes
}

/** A PDF literal string; everything outside printable ASCII is escaped. */
function literal(codes: number[]): string {
  let out = '('
  for (const code of codes) {
    if (code === 0x28 || code === 0x29 || code === 0x5c) {
      out += `\\${String.fromCharCode(code)}`
    } else if (code >= 0x20 && code <= 0x7e) {
      out += String.fromCharCode(code)
    } else {
      out += `\\${code.toString(8).padStart(3, '0')}`
    }
  }
  return out + ')'
}

function textWidthEm(codes: number[]): number {
  // Latin-1 letters have no entry; most are as wide as a lowercase letter.
  return codes.reduce((w, c) => w + (HELVETICA_WIDTHS[c - 32] ?? 556), 0) / 1000
}

/** Text operators, in the page's mm, y-down user space. */
function textOps(text: ExportText, color: string): string {
  const codes = winAnsi(text.value)
  if (codes.length === 0) return ''
  const size = text.sizeMm
  const width = textWidthEm(codes) * size
  const shift =
    text.anchor === 'middle' ? width / 2 : text.anchor === 'end' ? width : 0
  const r = ((text.rotationDeg ?? 0) * Math.PI) / 180
  const cos = Math.cos(r)
  const sin = Math.sin(r)
  // Along the baseline (x) and "down" the glyphs, in y-down space.
  const drop = (HELVETICA_CAP_HEIGHT * size) / 2
  const x = text.x - shift * cos - drop * sin
  const y = text.y - shift * sin + drop * cos
  // Glyph space is y-up; the page is flipped, so the text matrix flips back.
  const matrix = [size * cos, size * sin, size * sin, -size * cos, x, y]
  return (
    `${rgb(color)} rg\nBT /F1 1 Tf ${matrix.map(num).join(' ')} Tm ` +
    `${literal(codes)} Tj ET\n`
  )
}

function pathOps(points: { x: number; y: number }[], closed: boolean): string {
  const [first, ...rest] = points
  let out = `${num(first.x)} ${num(first.y)} m\n`
  for (const p of rest) out += `${num(p.x)} ${num(p.y)} l\n`
  return closed ? `${out}h\n` : out
}

/** Render a neutral document to a single-page vector PDF. */
export function renderPdf(doc: ExportDoc, options: PdfOptions = {}): string {
  const widthPt = doc.widthMm * PT_PER_MM
  const heightPt = doc.heightMm * PT_PER_MM
  const stroke = options.strokeWidthMm ?? 0.0254

  // Draw in millimetres, y-down, like every other writer: scale and flip once.
  let content =
    `q ${num(PT_PER_MM)} 0 0 ${num(-PT_PER_MM)} 0 ${num(heightPt)} cm\n` +
    `${num(stroke)} w 1 J 1 j\n`
  for (const layer of doc.layers) {
    const color = layerColor(layer)
    const filled = layer.fill === true && layer.kind !== 'cut'
    let fills = ''
    for (const path of layer.paths) {
      if (path.points.length < 2) continue
      if (filled && path.closed) {
        fills += pathOps(path.points, true)
      } else {
        content += `${rgb(color)} RG\n${pathOps(path.points, path.closed)}S\n`
      }
    }
    // One even-odd fill per layer, so letter counters stay open.
    if (fills !== '') content += `${rgb(color)} rg\n${fills}f*\n`
    for (const text of layer.texts ?? []) content += textOps(text, color)
  }
  content += 'Q\n'

  const title = literal(winAnsi(options.title ?? 'Cut file'))
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(widthPt)} ${num(heightPt)}] ` +
      '/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    `<< /Title ${title} /Producer (@richardmcquiston01/maker-export) >>`,
  ]
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((body, i) => {
    offsets.push(out.length)
    out += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = out.length
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) {
    out += `${offset.toString().padStart(10, '0')} 00000 n \n`
  }
  out +=
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 6 0 R >>\n` +
    `startxref\n${xref}\n%%EOF\n`
  return out
}
