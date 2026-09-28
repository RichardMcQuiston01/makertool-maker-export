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
})
