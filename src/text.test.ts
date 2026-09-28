import { describe, expect, test } from 'vitest'
import {
  flattenCommands,
  flattenStrokes,
  outlineTextFromCommands,
  outlineDocText,
  type ExportDoc,
  type PathCommand,
  type TextOutliner,
} from './index.ts'

// A 10×10 square glyph on the baseline: y-down, ascender negative — the shape
// opentype's getPath(value, 0, 0, size) produces.
const squareGlyph: PathCommand[] = [
  { type: 'M', x: 0, y: -10 },
  { type: 'L', x: 10, y: -10 },
  { type: 'L', x: 10, y: 0 },
  { type: 'L', x: 0, y: 0 },
  { type: 'Z' },
]

describe('flattenStrokes', () => {
  test('a closed subpath stays closed', () => {
    const paths = flattenStrokes(squareGlyph)
    expect(paths).toHaveLength(1)
    expect(paths[0].closed).toBe(true)
    expect(paths[0].points).toHaveLength(4)
  })

  test('an open stroke stays open and a 2-point line is kept', () => {
    const paths = flattenStrokes([
      { type: 'M', x: 0, y: 0 },
      { type: 'L', x: 5, y: 5 },
      { type: 'M', x: 1, y: 1 },
      { type: 'L', x: 2, y: 1 },
      { type: 'L', x: 3, y: 2 },
    ])
    expect(paths).toEqual([
      {
        closed: false,
        points: [
          { x: 0, y: 0 },
          { x: 5, y: 5 },
        ],
      },
      {
        closed: false,
        points: [
          { x: 1, y: 1 },
          { x: 2, y: 1 },
          { x: 3, y: 2 },
        ],
      },
    ])
  })

  test('closed and open subpaths in one path keep their own state', () => {
    const paths = flattenStrokes([
      ...squareGlyph,
      { type: 'M', x: 5, y: -10 },
      { type: 'L', x: 5, y: 0 },
    ])
    expect(paths.map((p) => p.closed)).toEqual([true, false])
  })

  test('curves are sampled and end on their end point', () => {
    const [path] = flattenStrokes(
      [
        { type: 'M', x: 0, y: 0 },
        { type: 'Q', x1: 5, y1: 10, x: 10, y: 0 },
        { type: 'C', x1: 12, y1: 5, x2: 18, y2: 5, x: 20, y: 0 },
      ],
      4,
    )
    expect(path.closed).toBe(false)
    expect(path.points).toHaveLength(1 + 4 + 4)
    expect(path.points[4]).toEqual({ x: 10, y: 0 })
    expect(path.points[8]).toEqual({ x: 20, y: 0 })
  })

  test("drawing on after Z starts a new subpath at the closed one's start", () => {
    const paths = flattenStrokes([...squareGlyph, { type: 'L', x: 5, y: 5 }])
    expect(paths[1]).toEqual({
      closed: false,
      points: [
        { x: 0, y: -10 },
        { x: 5, y: 5 },
      ],
    })
  })

  test('a lone move draws nothing', () => {
    expect(flattenStrokes([{ type: 'M', x: 1, y: 1 }])).toEqual([])
  })
})

describe('flattenCommands', () => {
  test('a closed polygon becomes one ring', () => {
    const rings = flattenCommands(squareGlyph)
    expect(rings).toHaveLength(1)
    expect(rings[0]).toHaveLength(4)
  })

  test('a quadratic curve is sampled into the requested segments', () => {
    const rings = flattenCommands(
      [
        { type: 'M', x: 0, y: 0 },
        { type: 'Q', x1: 5, y1: 10, x: 10, y: 0 },
        { type: 'Z' },
      ],
      8,
    )
    expect(rings[0]).toHaveLength(9) // start + 8 samples
  })
})

describe('outlineTextFromCommands', () => {
  test('places the glyph block at (x, y) with start anchor and central baseline', () => {
    const paths = outlineTextFromCommands(squareGlyph, {
      value: 'A',
      x: 100,
      y: 50,
      sizeMm: 10,
      anchor: 'start',
    })
    expect(paths).toHaveLength(1)
    expect(paths[0].closed).toBe(true)
    // bbox is x[0,10] y[-10,0]; start → dx = 100 - 0; central → dy = 50 - (-5).
    // First point (0,-10) → (100, 45).
    expect(paths[0].points[0]).toEqual({ x: 100, y: 45 })
  })

  test('honours the middle and end anchors horizontally', () => {
    const mid = outlineTextFromCommands(squareGlyph, {
      value: 'A',
      x: 100,
      y: 0,
      sizeMm: 10,
      anchor: 'middle',
    })
    // centre x = 5 → dx = 100 - 5 = 95 → first point x = 95.
    expect(mid[0].points[0].x).toBe(95)
    const end = outlineTextFromCommands(squareGlyph, {
      value: 'A',
      x: 100,
      y: 0,
      sizeMm: 10,
      anchor: 'end',
    })
    // max x = 10 → dx = 90 → first point x = 90.
    expect(end[0].points[0].x).toBe(90)
  })

  test('empty commands produce no paths', () => {
    expect(
      outlineTextFromCommands([], { value: '', x: 0, y: 0, sizeMm: 10 }),
    ).toHaveLength(0)
  })
})

describe('outlineDocText', () => {
  // A stub outliner: one 1mm dot path per text, so we can assert conversion.
  const stub: TextOutliner = (t) => [
    {
      closed: true,
      points: [
        { x: t.x, y: t.y },
        { x: t.x + 1, y: t.y },
        { x: t.x + 1, y: t.y + 1 },
      ],
    },
  ]

  test('converts each layer’s text to paths and clears the text', () => {
    const doc: ExportDoc = {
      widthMm: 100,
      heightMm: 100,
      layers: [
        {
          kind: 'engrave',
          machine: 'laser',
          paths: [
            {
              closed: false,
              points: [
                { x: 0, y: 0 },
                { x: 5, y: 5 },
              ],
            },
          ],
          texts: [
            { value: 'A', x: 10, y: 10, sizeMm: 8 },
            { value: 'B', x: 20, y: 20, sizeMm: 8 },
          ],
        },
      ],
    }
    const out = outlineDocText(doc, stub)
    const layer = out.layers[0]
    // Original path kept, plus one path per text; texts emptied.
    expect(layer.paths).toHaveLength(3)
    expect(layer.texts).toHaveLength(0)
    // The input document is not mutated.
    expect(doc.layers[0].texts).toHaveLength(2)
  })

  test('layers without text are returned unchanged', () => {
    const doc: ExportDoc = {
      widthMm: 10,
      heightMm: 10,
      layers: [{ kind: 'cut', machine: 'laser', paths: [], texts: [] }],
    }
    const out = outlineDocText(doc, stub)
    expect(out.layers[0]).toBe(doc.layers[0])
  })
})
