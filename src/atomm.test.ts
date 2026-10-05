import { describe, expect, test } from 'vitest'
import {
  ATOMM_COLOR,
  exportForAtomm,
  findAtommSvgIssues,
  renderSvg,
  type AtommExportResult,
  type AtommFile,
  type ExportDoc,
  type ExportPath,
  type TextOutliner,
} from './index.ts'

const square: ExportPath = {
  closed: true,
  points: [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    { x: 20, y: 20 },
    { x: 0, y: 20 },
  ],
}

const line: ExportPath = {
  closed: false,
  points: [
    { x: 2, y: 10 },
    { x: 18, y: 10 },
  ],
}

const doc: ExportDoc = {
  widthMm: 100,
  heightMm: 60,
  layers: [
    // A user colour override that must NOT leak into the Atomm output.
    { kind: 'cut', color: '#00ff00', paths: [square] },
    { kind: 'engrave', paths: [line] },
    { kind: 'engrave', fill: true, paths: [square] },
  ],
}

/** A trivial outliner: every text becomes one small closed square at (x, y). */
const outliner: TextOutliner = (text) => [
  {
    closed: true,
    points: [
      { x: text.x, y: text.y },
      { x: text.x + 1, y: text.y },
      { x: text.x + 1, y: text.y + 1 },
    ],
  },
]

function filesOf(result: AtommExportResult): AtommFile[] {
  if (!result.ok) throw new Error(`expected ok result, got: ${result.error}`)
  return result.files
}

describe('renderSvg atomm profile', () => {
  const out: string = renderSvg(doc, { profile: 'atomm' })

  test('cut is a red stroke, ignoring the layer colour override', () => {
    expect(out).toContain(`fill="none" stroke="${ATOMM_COLOR.cut}"`)
    expect(out).not.toContain('#00ff00')
  })

  test('line engrave is a blue stroke and fill engrave is a blue fill', () => {
    expect(out).toContain(`fill="none" stroke="${ATOMM_COLOR.lineEngrave}"`)
    expect(out).toContain(`fill="${ATOMM_COLOR.fillEngrave}" stroke="none"`)
  })

  test('an open path on a fill layer stays a stroke', () => {
    const svg: string = renderSvg(
      {
        widthMm: 10,
        heightMm: 10,
        layers: [{ kind: 'engrave', fill: true, paths: [line] }],
      },
      { profile: 'atomm' },
    )
    expect(svg).toContain(`fill="none" stroke="${ATOMM_COLOR.lineEngrave}"`)
  })

  test('a cut layer is never filled, even when flagged', () => {
    const svg: string = renderSvg(
      {
        widthMm: 10,
        heightMm: 10,
        layers: [{ kind: 'cut', fill: true, paths: [square] }],
      },
      { profile: 'atomm' },
    )
    expect(svg).toContain(`fill="none" stroke="${ATOMM_COLOR.cut}"`)
  })

  test('engrave text is solid blue; cut text is a red outline', () => {
    const svg: string = renderSvg(
      {
        widthMm: 50,
        heightMm: 50,
        layers: [
          {
            kind: 'engrave',
            paths: [],
            texts: [{ value: 'Hi', x: 5, y: 5, sizeMm: 4 }],
          },
          {
            kind: 'cut',
            paths: [],
            texts: [{ value: 'Cut', x: 5, y: 20, sizeMm: 4 }],
          },
        ],
      },
      { profile: 'atomm' },
    )
    expect(svg).toContain(`fill="${ATOMM_COLOR.fillEngrave}" stroke="none"`)
    expect(svg).toContain(`fill="none" stroke="${ATOMM_COLOR.cut}"`)
  })

  test('passes the Atomm SVG lint', () => {
    expect(findAtommSvgIssues(out)).toEqual([])
  })
})

describe('renderSvg default profile', () => {
  test('a fill layer paints closed paths solid in the layer colour', () => {
    const svg: string = renderSvg({
      widthMm: 10,
      heightMm: 10,
      layers: [
        { kind: 'engrave', color: '#123456', fill: true, paths: [square] },
      ],
    })
    expect(svg).toContain('fill="#123456" stroke="none"')
  })
})

describe('fill layers with holes', () => {
  const outer: ExportPath = {
    closed: true,
    points: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ],
  }
  const counter: ExportPath = {
    closed: true,
    points: [
      { x: 3, y: 3 },
      { x: 7, y: 3 },
      { x: 7, y: 7 },
      { x: 3, y: 7 },
    ],
  }

  test('contours merge into one even-odd path so counters stay open', () => {
    const svg: string = renderSvg(
      {
        widthMm: 10,
        heightMm: 10,
        layers: [{ kind: 'engrave', fill: true, paths: [outer, counter] }],
      },
      { profile: 'atomm' },
    )
    expect(svg.match(/<path /g)?.length).toBe(1)
    expect(svg).toContain('fill-rule="evenodd"')
    expect(svg.match(/M /g)?.length).toBe(2)
    expect(findAtommSvgIssues(svg)).toEqual([])
  })
})

describe('exportForAtomm', () => {
  test('openInStudio returns exactly one Atomm SVG of the laser geometry', () => {
    const files: AtommFile[] = filesOf(
      exportForAtomm(doc, 'openInStudio', { baseName: 'tag' }),
    )
    expect(files).toHaveLength(1)
    expect(files[0].filename).toBe('tag.svg')
    expect(files[0].mime).toBe('image/svg+xml')
    expect(files[0].content).toContain(ATOMM_COLOR.cut)
  })

  test('download adds extra formats and a per-machine file for other machines', () => {
    const mixed: ExportDoc = {
      ...doc,
      layers: [
        ...doc.layers,
        { kind: 'cut', machine: 'vinyl', paths: [square] },
      ],
    }
    const files: AtommFile[] = filesOf(
      exportForAtomm(mixed, 'download', {
        baseName: 'tag',
        extraFormats: ['svg', 'dxf'],
      }),
    )
    const names: string[] = files.map((file) => file.filename)
    expect(names).toEqual(['tag.svg', 'tag.dxf', 'tag-vinyl.svg'])
    // The vinyl slice is not part of the laser file.
    const laserSvg: string = files[0].content
    expect(laserSvg.split('<path ').length - 1).toBe(3)
  })

  test('download with only the Atomm SVG returns a single file', () => {
    const files: AtommFile[] = filesOf(
      exportForAtomm(doc, 'download', { baseName: 'tag' }),
    )
    expect(files.map((file) => file.filename)).toEqual(['tag.svg'])
  })

  test('an outliner turns engrave text into a separate fill layer', () => {
    const withText: ExportDoc = {
      widthMm: 50,
      heightMm: 50,
      layers: [
        {
          kind: 'engrave',
          paths: [line],
          texts: [{ value: 'Hi', x: 5, y: 5, sizeMm: 4 }],
        },
      ],
    }
    const files: AtommFile[] = filesOf(
      exportForAtomm(withText, 'openInStudio', { baseName: 'tag', outliner }),
    )
    const svg: string = files[0].content
    expect(svg).not.toContain('<text')
    // The line stays a blue stroke; the glyph outline becomes a blue fill.
    expect(svg).toContain(`fill="none" stroke="${ATOMM_COLOR.lineEngrave}"`)
    expect(svg).toContain(`fill="${ATOMM_COLOR.fillEngrave}" stroke="none"`)
  })

  test('an empty design is a descriptive error, not an empty file', () => {
    const result: AtommExportResult = exportForAtomm(
      { widthMm: 10, heightMm: 10, layers: [{ kind: 'cut', paths: [] }] },
      'download',
      { baseName: 'tag' },
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('Nothing to export')
  })

  test('path separators in the base name are neutralised; empty is an error', () => {
    const files: AtommFile[] = filesOf(
      exportForAtomm(doc, 'openInStudio', { baseName: 'a/b\\c' }),
    )
    expect(files[0].filename).toBe('a-b-c.svg')
    const result: AtommExportResult = exportForAtomm(doc, 'download', {
      baseName: '  ',
    })
    expect(result.ok).toBe(false)
  })

  test('a vinyl-only design still opens in Studio', () => {
    const vinylOnly: ExportDoc = {
      widthMm: 10,
      heightMm: 10,
      layers: [{ kind: 'cut', machine: 'vinyl', paths: [square] }],
    }
    const files: AtommFile[] = filesOf(
      exportForAtomm(vinylOnly, 'openInStudio', { baseName: 'v' }),
    )
    expect(files[0].content).toContain('<path ')
  })
})

describe('findAtommSvgIssues', () => {
  test('flags <use>, <defs>, unreadable colours, and non-mm sizing', () => {
    const bad: string =
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50">' +
      '<defs><path id="p" d="M0 0L1 1"/></defs>' +
      '<use href="#p"/>' +
      '<path d="M0 0L5 5" fill="none" stroke="red"/>' +
      '<path d="M0 0L5 5" stroke="currentColor"/>' +
      '</svg>'
    const issues: string = findAtommSvgIssues(bad).join('\n')
    expect(issues).toContain('<use>')
    expect(issues).toContain('<defs>')
    expect(issues).toContain('currentColor')
    expect(issues).toContain('"red"')
    expect(issues).toContain('viewBox')
    expect(issues).toContain('mm')
  })
})
