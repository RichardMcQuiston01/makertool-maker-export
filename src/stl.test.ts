import { describe, expect, test } from 'vitest'
import { renderStl, renderStlAscii, type ExportDoc } from './index.ts'

const doc: ExportDoc = {
  widthMm: 20,
  heightMm: 20,
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
  ],
}

describe('renderStl', () => {
  test('writes a binary STL: header, count, 50 bytes per facet', () => {
    const out = renderStl(doc, { name: 'my plate' })
    const view = new DataView(out.buffer)
    // A box: 2 triangles per face.
    expect(view.getUint32(80, true)).toBe(12)
    expect(out.length).toBe(84 + 12 * 50)
    const header = new TextDecoder().decode(out.slice(0, 80))
    expect(header.startsWith('solid')).toBe(false)
    expect(header).toContain('my_plate')
    // First facet is a top cap: normal +z, all corners at z = 3.
    expect(view.getFloat32(84 + 8, true)).toBe(1)
    expect(view.getFloat32(84 + 12 + 8, true)).toBe(3)
  })

  test('writes ASCII STL with outward normals', () => {
    const out = renderStlAscii(doc, { name: 'box' })
    expect(out.startsWith('solid box\n')).toBe(true)
    expect(out.trimEnd().endsWith('endsolid box')).toBe(true)
    expect(out.split('facet normal').length - 1).toBe(12)
    expect(out).toContain('facet normal 0 0 1')
    expect(out).toContain('facet normal 0 0 -1')
    expect(out).toContain('facet normal 0 -1 0')
    expect(out).toContain('vertex 10 20 3')
  })
})
