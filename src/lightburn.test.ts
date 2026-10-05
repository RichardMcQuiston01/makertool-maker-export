import { describe, expect, test } from 'vitest'
import { renderLightBurn, type ExportDoc } from './index.ts'

/** A closed square of side `s` with its top-left at (x, y). */
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

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

describe('renderLightBurn', () => {
  test('emits a project with one cut setting and one path shape', () => {
    const doc: ExportDoc = {
      widthMm: 100,
      heightMm: 100,
      layers: [square(0, 0, 10)],
    }
    const out = renderLightBurn(doc)
    expect(out.startsWith('<?xml')).toBe(true)
    expect(out).toContain('<LightBurnProject')
    expect(count(out, '<CutSetting')).toBe(1)
    expect(out).toContain('<CutSetting type="Cut">')
    expect(out).toContain('<name Value="CUT"/>')
    expect(count(out, '<Shape Type="Path"')).toBe(1)
    // A closed 4-point square: 4 vertices, 4 line primitives (incl. the close).
    expect(count(out, '<V ')).toBe(4)
    expect(count(out, '<P T="L"')).toBe(4)
    expect(out).toContain('CutIndex="0"')
  })

  test('an open path has one fewer primitive than it has vertices', () => {
    const doc: ExportDoc = {
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
                { x: 10, y: 10 },
              ],
            },
          ],
        },
      ],
    }
    const out = renderLightBurn(doc)
    expect(count(out, '<V ')).toBe(3)
    expect(count(out, '<P T="L"')).toBe(2)
  })

  test('y is flipped into LightBurn (y-up) space against the sheet height', () => {
    const doc: ExportDoc = {
      widthMm: 100,
      heightMm: 80,
      layers: [
        {
          kind: 'cut',
          paths: [
            {
              closed: false,
              points: [
                { x: 5, y: 0 },
                { x: 5, y: 80 },
              ],
            },
          ],
        },
      ],
    }
    const out = renderLightBurn(doc)
    // y=0 → vy=80 (top of sheet); y=80 → vy=0 (bottom).
    expect(out).toContain('<V vx="5" vy="80"/>')
    expect(out).toContain('<V vx="5" vy="0"/>')
  })

  test('cut and engrave become separate, indexed cut settings', () => {
    const doc: ExportDoc = {
      widthMm: 100,
      heightMm: 100,
      layers: [
        square(0, 0, 10),
        {
          kind: 'engrave',
          paths: [
            {
              closed: true,
              points: [
                { x: 20, y: 20 },
                { x: 30, y: 20 },
                { x: 30, y: 30 },
              ],
            },
          ],
        },
      ],
    }
    const out = renderLightBurn(doc)
    expect(count(out, '<CutSetting')).toBe(2)
    expect(out).toContain('<CutSetting type="Cut">')
    expect(out).toContain('<CutSetting type="Scan">')
    expect(out).toContain('<name Value="ENGRAVE"/>')
    // Cut is index 0, engrave index 1; the engrave shape references CutIndex 1.
    expect(out).toContain('CutIndex="1"')
  })

  test('a document with no geometry still yields a valid empty project', () => {
    const out = renderLightBurn({ widthMm: 10, heightMm: 10, layers: [] })
    expect(out).toContain('<LightBurnProject')
    expect(out).toContain('</LightBurnProject>')
    expect(count(out, '<Shape')).toBe(0)
    expect(count(out, '<CutSetting')).toBe(0)
  })
})
