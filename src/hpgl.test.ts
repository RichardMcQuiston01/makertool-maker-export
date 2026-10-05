import { describe, expect, test } from 'vitest'
import { renderHpgl, type ExportDoc } from './index.ts'

const doc: ExportDoc = {
  widthMm: 100,
  heightMm: 50,
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
      paths: [
        {
          closed: false,
          points: [
            { x: 20, y: 20 },
            { x: 30, y: 20.0126 },
          ],
        },
      ],
      texts: [{ value: 'skipped', x: 0, y: 0, sizeMm: 5 }],
    },
  ],
}

describe('renderHpgl', () => {
  test('plots each path in 0.025 mm units, y-up, closing closed paths', () => {
    const lines = renderHpgl(doc).trim().split('\n')
    expect(lines).toEqual([
      'IN;',
      'PA;',
      'SP1;',
      'PU0,2000;',
      'PD400,2000,400,1600,0,1600,0,2000;',
      'SP2;',
      'PU800,1200;',
      'PD1200,1199;',
      'PU0,0;',
      'SP0;',
    ])
  })

  test('pens and kinds are configurable', () => {
    const out = renderHpgl(doc, { kinds: ['cut'], pens: { cut: 3 } })
    expect(out).toContain('SP3;')
    expect(out).not.toContain('SP2;')
    expect(out).not.toContain('PU800,1200;')
  })

  test('overcut continues past the start of closed paths only', () => {
    const out = renderHpgl(doc, { overcutMm: 2 })
    // Back to the start, then 2 mm further along the first edge.
    expect(out).toContain('PD400,2000,400,1600,0,1600,0,2000,80,2000;')
    expect(out).toContain('PD1200,1199;')
    // An overcut longer than the first edge carries on round the corner.
    const long = renderHpgl(doc, { kinds: ['cut'], overcutMm: 12 })
    expect(long).toContain('0,2000,400,2000,400,1920;')
  })
})
