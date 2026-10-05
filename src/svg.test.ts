import { describe, expect, test } from 'vitest'
import { renderSvg, type ExportDoc } from './index.ts'

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

describe('renderSvg', () => {
  test('renders paths as strokes and sizes the sheet in mm', () => {
    const doc: ExportDoc = {
      widthMm: 120,
      heightMm: 80,
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
      ],
    }
    const out = renderSvg(doc)
    expect(out).toContain('viewBox="0 0 120 80"')
    expect(out).toContain('width="120mm" height="80mm"')
    expect(count(out, '<path ')).toBe(1)
    expect(out).toContain('fill="none"')
    expect(out).toContain('Z"') // closed path
  })

  test('renders text with the requested anchor and honours colour overrides', () => {
    const doc: ExportDoc = {
      widthMm: 50,
      heightMm: 50,
      layers: [
        {
          kind: 'engrave',
          color: '#123456',
          paths: [],
          texts: [{ value: 'Hi', x: 25, y: 25, sizeMm: 8, anchor: 'middle' }],
        },
      ],
    }
    const out = renderSvg(doc)
    expect(out).toContain('<text')
    expect(out).toContain('text-anchor="middle"')
    expect(out).toContain('fill="#123456"')
    expect(out).toContain('>Hi</text>')
  })

  test('escapes text content', () => {
    const out = renderSvg({
      widthMm: 10,
      heightMm: 10,
      layers: [
        {
          kind: 'cut',
          paths: [],
          texts: [{ value: 'A & B <C>', x: 1, y: 1, sizeMm: 3 }],
        },
      ],
    })
    expect(out).toContain('A &amp; B &lt;C&gt;')
  })
})
