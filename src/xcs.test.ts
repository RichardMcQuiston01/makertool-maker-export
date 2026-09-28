import { describe, expect, test } from 'vitest'
import { renderXcs, LAYER_COLOR, type ExportDoc } from './index.ts'

interface XcsDisplay {
  type: string
  dPath?: string
  layerColor?: string
  isClosePath?: boolean
  scale?: { x: number; y: number }
  graphicX?: number
  graphicY?: number
  x?: number
  y?: number
  width?: number
  height?: number
}
interface XcsProject {
  canvasId: string
  canvas: { layerData: Record<string, unknown>; displays: XcsDisplay[] }[]
}

function square(x: number, y: number, s: number): ExportDoc['layers'][number] {
  return {
    kind: 'cut',
    paths: [
      {
        closed: true,
        points: [
          { x, y },
          { x: x + s, y },
          { x: x + s, y: y + s },
          { x, y: y + s },
        ],
      },
    ],
  }
}

describe('renderXcs', () => {
  test('produces a valid XCS project (parseable, with a canvas array)', () => {
    const out = renderXcs({
      widthMm: 100,
      heightMm: 100,
      layers: [square(10, 20, 30)],
    })
    const project = JSON.parse(out) as XcsProject
    // Mirrors the reference library's assertXcsFormat contract.
    expect(typeof project).toBe('object')
    expect(Array.isArray(project.canvas)).toBe(true)
    expect(project.canvas).toHaveLength(1)
    expect(project.canvas[0].displays).toHaveLength(1)
  })

  test('a polyline becomes a PATH display with an absolute-mm dPath', () => {
    const out = renderXcs({
      widthMm: 100,
      heightMm: 100,
      layers: [square(10, 20, 30)],
    })
    const d = (JSON.parse(out) as XcsProject).canvas[0].displays[0]
    expect(d.type).toBe('PATH')
    expect(d.isClosePath).toBe(true)
    // Absolute mm, y-down (no flip); closed → trailing Z.
    expect(d.dPath).toBe('M10 20L40 20L40 50L10 50Z')
    // dPath is local to the graphic origin, which we pin at (0,0) with scale 1.
    expect(d.graphicX).toBe(0)
    expect(d.graphicY).toBe(0)
    expect(d.scale).toEqual({ x: 1, y: 1 })
    // Bounding box → position + size.
    expect(d.x).toBe(10)
    expect(d.y).toBe(20)
    expect(d.width).toBe(30)
    expect(d.height).toBe(30)
  })

  test('layers map to xTool layer colours, keyed in the layer table', () => {
    const out = renderXcs({
      widthMm: 100,
      heightMm: 100,
      layers: [
        square(0, 0, 10),
        {
          kind: 'engrave',
          paths: [
            {
              closed: false,
              points: [
                { x: 5, y: 5 },
                { x: 8, y: 8 },
              ],
            },
          ],
        },
      ],
    })
    const project = JSON.parse(out) as XcsProject
    const [cut, engrave] = project.canvas[0].displays
    expect(cut.layerColor).toBe(LAYER_COLOR.cut)
    expect(engrave.layerColor).toBe(LAYER_COLOR.engrave)
    expect(Object.keys(project.canvas[0].layerData).sort()).toEqual(
      [LAYER_COLOR.cut, LAYER_COLOR.engrave].sort(),
    )
  })

  test('an open path omits the closing Z', () => {
    const out = renderXcs({
      widthMm: 50,
      heightMm: 50,
      layers: [
        {
          kind: 'cut',
          paths: [
            {
              closed: false,
              points: [
                { x: 0, y: 0 },
                { x: 10, y: 0 },
              ],
            },
          ],
        },
      ],
    })
    const d = (JSON.parse(out) as XcsProject).canvas[0].displays[0]
    expect(d.dPath).toBe('M0 0L10 0')
    expect(d.isClosePath).toBe(false)
  })

  test('output is deterministic for a given document', () => {
    const doc: ExportDoc = {
      widthMm: 100,
      heightMm: 100,
      layers: [square(1, 2, 3)],
    }
    expect(renderXcs(doc)).toBe(renderXcs(doc))
  })

  test('an empty document is still a valid, empty canvas', () => {
    const project = JSON.parse(
      renderXcs({ widthMm: 10, heightMm: 10, layers: [] }),
    ) as XcsProject
    expect(Array.isArray(project.canvas)).toBe(true)
    expect(project.canvas[0].displays).toHaveLength(0)
  })
})
