import { describe, expect, test } from 'vitest'
import {
  generateExportFiles,
  type ExportDoc,
  type TextOutliner,
} from './index.ts'

/** A design with laser cut panels and a vinyl-cutter text label. */
function mixedDoc(): ExportDoc {
  return {
    widthMm: 100,
    heightMm: 80,
    layers: [
      {
        machine: 'laser',
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
        machine: 'vinyl',
        kind: 'cut',
        paths: [],
        texts: [{ value: 'LOGO', x: 50, y: 40, sizeMm: 10, anchor: 'middle' }],
      },
    ],
  }
}

describe('generateExportFiles — combined', () => {
  test('one file per format, containing the whole design', () => {
    const files = generateExportFiles(mixedDoc(), {
      mode: 'combined',
      baseName: 'design',
      formats: ['svg', 'lightburn'],
    })
    expect(files.map((f) => f.name)).toEqual(['design.svg', 'design.lbrn2'])
    // The combined SVG carries both the laser panel and the vinyl text.
    const svg = files.find((f) => f.name === 'design.svg')!.content
    expect(svg).toContain('<path')
    expect(svg).toContain('LOGO')
  })

  test('duplicate formats are de-duplicated', () => {
    const files = generateExportFiles(mixedDoc(), {
      mode: 'combined',
      baseName: 'd',
      formats: ['svg', 'svg'],
    })
    expect(files).toHaveLength(1)
  })
})

describe('generateExportFiles — split', () => {
  test('one file per machine in that machine’s default formats', () => {
    const files = generateExportFiles(mixedDoc(), {
      mode: 'split',
      baseName: 'box',
    })
    // laser defaults → svg + dxf; vinyl default → svg.
    expect(files.map((f) => f.name).sort()).toEqual([
      'box-laser.dxf',
      'box-laser.svg',
      'box-vinyl.svg',
    ])
    // Each machine's file only carries its own elements.
    const laserSvg = files.find((f) => f.name === 'box-laser.svg')!.content
    expect(laserSvg).toContain('<path')
    expect(laserSvg).not.toContain('LOGO')
    const vinylSvg = files.find((f) => f.name === 'box-vinyl.svg')!.content
    expect(vinylSvg).toContain('LOGO')
    expect(vinylSvg).not.toContain('<path')
  })

  test('per-machine format choices override defaults', () => {
    const files = generateExportFiles(mixedDoc(), {
      mode: 'split',
      baseName: 'box',
      formats: { laser: ['lightburn', 'xcs'] },
    })
    const names = files.map((f) => f.name)
    expect(names).toContain('box-laser.lbrn2')
    expect(names).toContain('box-laser.xcs')
    expect(names).not.toContain('box-laser.svg')
    // Vinyl still falls back to its default.
    expect(names).toContain('box-vinyl.svg')
  })

  test('text is outlined for LightBurn but stays native in SVG', () => {
    // A stub outliner emits a recognisable triangle path per text.
    const outliner: TextOutliner = (t) => [
      {
        closed: true,
        points: [
          { x: t.x, y: t.y },
          { x: t.x + 5, y: t.y },
          { x: t.x + 5, y: t.y + 5 },
        ],
      },
    ]
    const doc: ExportDoc = {
      widthMm: 100,
      heightMm: 100,
      layers: [
        {
          machine: 'laser',
          kind: 'engrave',
          paths: [],
          texts: [{ value: 'HI', x: 10, y: 10, sizeMm: 8 }],
        },
      ],
    }
    const files = generateExportFiles(
      doc,
      { mode: 'combined', baseName: 'd', formats: ['svg', 'lightburn'] },
      outliner,
    )
    const svg = files.find((f) => f.name === 'd.svg')!.content
    const lbrn = files.find((f) => f.name === 'd.lbrn2')!.content
    // SVG keeps editable native text; LightBurn has no text, but now carries a
    // vectorised path shape from the outliner.
    expect(svg).toContain('>HI</text>')
    expect(lbrn).toContain('<Shape Type="Path"')
  })

  test('without an outliner, LightBurn simply omits text', () => {
    const doc: ExportDoc = {
      widthMm: 100,
      heightMm: 100,
      layers: [
        {
          machine: 'laser',
          kind: 'engrave',
          paths: [],
          texts: [{ value: 'HI', x: 10, y: 10, sizeMm: 8 }],
        },
      ],
    }
    const files = generateExportFiles(doc, {
      mode: 'combined',
      baseName: 'd',
      formats: ['lightburn'],
    })
    expect(files[0].content).not.toContain('<Shape Type="Path"')
  })

  test('formats a machine cannot use are dropped', () => {
    // Vinyl cannot export LightBurn/XCS; requesting them yields no vinyl file.
    const files = generateExportFiles(mixedDoc(), {
      mode: 'split',
      baseName: 'box',
      formats: { vinyl: ['lightburn'] },
    })
    expect(files.some((f) => f.name.startsWith('box-vinyl'))).toBe(false)
    // Laser still emits its defaults.
    expect(files.some((f) => f.name.startsWith('box-laser'))).toBe(true)
  })

  test('HPGL and PDF are available, and format options reach the writers', () => {
    const doc: ExportDoc = {
      widthMm: 30,
      heightMm: 30,
      layers: [
        {
          kind: 'cut',
          machine: 'vinyl',
          paths: [
            {
              closed: true,
              points: Array.from({ length: 48 }, (_, i) => ({
                x: 15 + 10 * Math.cos((2 * Math.PI * i) / 48),
                y: 15 + 10 * Math.sin((2 * Math.PI * i) / 48),
              })),
            },
          ],
        },
      ],
    }
    const files = generateExportFiles(doc, {
      mode: 'split',
      baseName: 'decal',
      formats: { vinyl: ['hpgl', 'pdf', 'dxf'] },
      formatOptions: { dxf: { arcs: true }, pdf: { title: 'Decal' } },
    })
    expect(files.map((f) => [f.name, f.mime])).toEqual([
      ['decal-vinyl.plt', 'application/vnd.hp-hpgl'],
      ['decal-vinyl.pdf', 'application/pdf'],
      ['decal-vinyl.dxf', 'application/dxf'],
    ])
    expect(files[0].content.startsWith('IN;')).toBe(true)
    expect(files[1].content).toContain('/Title (Decal)')
    expect(files[2].content).toContain('\nCIRCLE\n')
  })
})
