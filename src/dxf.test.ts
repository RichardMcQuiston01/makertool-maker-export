import { describe, expect, test } from 'vitest'
import { renderDxf, type ExportDoc } from './index.ts'

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

describe('renderDxf', () => {
  const doc: ExportDoc = {
    widthMm: 100,
    heightMm: 60,
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
              { x: 0, y: 10 },
            ],
          },
        ],
      },
      {
        kind: 'engrave',
        paths: [],
        texts: [{ value: 'Tag', x: 20, y: 30, sizeMm: 6, anchor: 'middle' }],
      },
    ],
  }

  test('emits the header, CUT/ENGRAVE layer table, and entities', () => {
    const out = renderDxf(doc)
    expect(out).toContain('AC1015')
    expect(out).toContain('CUT')
    expect(out).toContain('ENGRAVE')
    expect(count(out, 'LWPOLYLINE')).toBe(1)
    expect(count(out, '\n0\nTEXT\n')).toBe(1)
    expect(out.trimEnd().endsWith('EOF')).toBe(true)
  })

  test('a closed polyline is flagged closed and y is flipped', () => {
    const out = renderDxf(doc)
    // Closed flag: group code 70 value 1.
    expect(out).toContain('\n70\n1\n')
    // First vertex y=0 → flipped to sheet height 60.
    expect(out).toContain('\n20\n60\n')
  })

  test('control characters in text are stripped', () => {
    const out = renderDxf({
      widthMm: 10,
      heightMm: 10,
      layers: [
        {
          kind: 'engrave',
          paths: [],
          texts: [{ value: 'a\nb\tc', x: 0, y: 0, sizeMm: 3 }],
        },
      ],
    })
    // Newline/tab collapse to single spaces; no raw control bytes remain.
    expect(out).toContain('\n1\na b c\n')
  })

  const curved: ExportDoc = {
    widthMm: 40,
    heightMm: 40,
    layers: [
      {
        kind: 'cut',
        paths: [
          // A 64-segment circle and a rounded-corner tab.
          {
            closed: true,
            points: Array.from({ length: 64 }, (_, i) => ({
              x: 20 + 5 * Math.cos((2 * Math.PI * i) / 64),
              y: 20 + 5 * Math.sin((2 * Math.PI * i) / 64),
            })),
          },
          {
            closed: false,
            points: [
              { x: 0, y: 30 },
              ...Array.from({ length: 13 }, (_, i) => ({
                x: 10 + 4 * Math.sin((Math.PI / 2) * (i / 12)),
                y: 34 - 4 * Math.cos((Math.PI / 2) * (i / 12)),
              })),
              { x: 14, y: 40 },
            ],
          },
        ],
      },
    ],
  }

  test('arcs: a circle becomes a CIRCLE and curves carry bulges', () => {
    const out = renderDxf(curved, { arcs: true })
    expect(count(out, '\nCIRCLE\n')).toBe(1)
    // Centre flipped to y-up: (20, 40 - 20).
    expect(out).toContain(
      'CIRCLE\n100\nAcDbEntity\n8\nCUT\n100\nAcDbCircle\n10\n20\n20\n20\n30\n0\n40\n5\n',
    )
    expect(count(out, '\nLWPOLYLINE\n')).toBe(1)
    // The quarter turn is one bulged segment: start, arc start, arc end, end.
    expect(out).toContain('\n90\n4\n')
    expect(count(out, '\n42\n')).toBe(1)
  })

  test('without arcs, curves stay as exact polylines', () => {
    const out = renderDxf(curved)
    expect(count(out, '\nCIRCLE\n')).toBe(0)
    expect(count(out, '\n42\n')).toBe(0)
    expect(out).toContain('\n90\n64\n')
  })

  test('R12 writes classic POLYLINE/VERTEX entities and no subclass markers', () => {
    const out = renderDxf(doc, { version: 'R12' })
    expect(out).toContain('$ACADVER\n1\nAC1009\n')
    expect(out).not.toContain('$INSUNITS')
    expect(out).not.toContain('AcDb')
    expect(out).not.toContain('LWPOLYLINE')
    expect(out).toContain('0\nLTYPE\n2\nCONTINUOUS\n')
    expect(count(out, '\nPOLYLINE\n')).toBe(1)
    expect(count(out, '\nVERTEX\n')).toBe(4)
    expect(count(out, '\nSEQEND\n')).toBe(1)
    expect(out).toContain('\nTEXT\n8\nENGRAVE\n')
    expect(out.endsWith('0\nEOF\n')).toBe(true)

    const arcs = renderDxf(curved, { version: 'R12', arcs: true })
    expect(count(arcs, '\nCIRCLE\n8\nCUT\n')).toBe(1)
    expect(count(arcs, '\n42\n')).toBe(1)
  })
})
