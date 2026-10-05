import { describe, expect, test } from 'vitest'
import { renderPdf, type ExportDoc } from './index.ts'

const doc: ExportDoc = {
  widthMm: 254,
  heightMm: 127,
  layers: [
    {
      kind: 'cut',
      paths: [
        {
          closed: true,
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
          ],
        },
      ],
    },
    {
      kind: 'engrave',
      fill: true,
      color: '#ff0000',
      paths: [
        {
          closed: true,
          points: [
            { x: 20, y: 20 },
            { x: 30, y: 20 },
            { x: 30, y: 30 },
          ],
        },
        {
          closed: true,
          points: [
            { x: 22, y: 22 },
            { x: 24, y: 22 },
            { x: 24, y: 24 },
          ],
        },
      ],
      texts: [
        { value: 'A (b) \\ é€', x: 50, y: 60, sizeMm: 10 },
        { value: 'AA', x: 100, y: 60, sizeMm: 10, anchor: 'end' },
      ],
    },
  ],
}

describe('renderPdf', () => {
  const pdf = renderPdf(doc, { title: 'Test' })

  test('is a well-formed single-page PDF the size of the sheet', () => {
    expect(pdf.startsWith('%PDF-1.4\n')).toBe(true)
    expect(pdf.endsWith('%%EOF\n')).toBe(true)
    // 254 × 127 mm = 720 × 360 pt.
    expect(pdf).toContain('/MediaBox [0 0 720 360]')
    expect(pdf).toContain('/BaseFont /Helvetica /Encoding /WinAnsiEncoding')
    expect(pdf).toContain('/Title (Test)')
    // Plain ASCII, so string length is byte length.
    expect([...pdf].every((c) => c.charCodeAt(0) < 0x80)).toBe(true)
  })

  test('the cross-reference table points at every object', () => {
    const startxref = Number(/startxref\n(\d+)\n/.exec(pdf)?.[1])
    expect(pdf.slice(startxref, startxref + 4)).toBe('xref')
    const offsets = [
      ...pdf.slice(startxref).matchAll(/(\d{10}) 00000 n /g),
    ].map((m) => Number(m[1]))
    expect(offsets).toHaveLength(6)
    offsets.forEach((offset, i) => {
      expect(pdf.slice(offset).startsWith(`${i + 1} 0 obj\n`)).toBe(true)
    })
    const length = Number(/\/Length (\d+) >>\nstream\n/.exec(pdf)?.[1])
    const start = pdf.indexOf('stream\n') + 'stream\n'.length
    expect(pdf.slice(start + length)).toMatch(/^endstream/)
  })

  test('draws in mm, y-down: hairline strokes, one even-odd fill per layer', () => {
    expect(pdf).toContain('q 2.8346 0 0 -2.8346 0 360 cm\n0.0254 w')
    expect(pdf).toContain('0 0 1 RG\n0 0 m\n10 0 l\n10 10 l\nh\nS\n')
    expect(pdf).toContain('1 0 0 rg\n20 20 m')
    expect(pdf.split('f*').length - 1).toBe(1)
    expect(renderPdf(doc, { strokeWidthMm: 0.2 })).toContain('0.2 w')
  })

  test('text is Helvetica, escaped, centred on its caps and anchored', () => {
    // ( ) \ escaped; é as WinAnsi octal; € not in Latin-1, so "?".
    expect(pdf).toContain('(A \\(b\\) \\\\ \\351?) Tj')
    // Baseline drops half the cap height (0.718 × 10 / 2) below y.
    expect(pdf).toContain('1 0 0 rg\nBT /F1 1 Tf 10 0 0 -10 50 63.59 Tm')
    // "AA" is 2 × 0.667 em = 13.34 mm wide, so it ends at x = 100.
    expect(pdf).toContain('10 0 0 -10 86.66 63.59 Tm (AA) Tj')
  })
})
