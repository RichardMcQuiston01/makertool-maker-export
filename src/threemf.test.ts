import { describe, expect, test } from 'vitest'
import { render3mf, render3mfModel, type ExportDoc } from './index.ts'

function square(x: number, y: number, size: number) {
  return {
    closed: true,
    points: [
      { x, y },
      { x: x + size, y },
      { x: x + size, y: y + size },
      { x, y: y + size },
    ],
  }
}

const doc: ExportDoc = {
  widthMm: 20,
  heightMm: 20,
  layers: [
    { kind: 'cut', paths: [square(0, 0, 10)], color: '#2563eb' },
    { kind: 'engrave', paths: [square(2, 2, 3)], color: '#f00' },
  ],
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

describe('render3mfModel', () => {
  test('one coloured object per body, grouped as parts of one build item', () => {
    const xml = render3mfModel(doc, { name: 'Tag & co' })
    expect(xml).toContain('unit="millimeter"')
    expect(xml).toContain('<metadata name="Title">Tag &amp; co</metadata>')
    expect(xml).toContain('<base name="CUT" displaycolor="#2563EB"/>')
    expect(xml).toContain('<base name="ENGRAVE" displaycolor="#FF0000"/>')
    expect(xml).toContain(
      '<object id="2" type="model" name="CUT" pid="1" pindex="0">',
    )
    expect(xml).toContain(
      '<object id="3" type="model" name="ENGRAVE" pid="1" pindex="1">',
    )
    expect(xml).toContain('<component objectid="2"/>')
    expect(xml).toContain('<component objectid="3"/>')
    expect(xml).toContain('<item objectid="4"/>')
    // Each box shares its 8 corners across 12 triangles.
    expect(count(xml, '<vertex ')).toBe(16)
    expect(count(xml, '<triangle ')).toBe(24)
  })

  test('a single body is the build item itself', () => {
    const xml = render3mfModel({ ...doc, layers: [doc.layers[0]] })
    expect(xml).not.toContain('<components>')
    expect(xml).toContain('<item objectid="2"/>')
  })

  test('an empty design still writes a valid, empty model', () => {
    const xml = render3mfModel({ widthMm: 1, heightMm: 1, layers: [] })
    expect(xml).not.toContain('<basematerials')
    expect(xml).not.toContain('<item ')
  })
})

describe('render3mf', () => {
  test('packages the model with its content types and relationships', () => {
    const zip = new TextDecoder().decode(render3mf(doc))
    expect(zip.startsWith('PK')).toBe(true)
    for (const name of [
      '[Content_Types].xml',
      '_rels/.rels',
      '3D/3dmodel.model',
    ]) {
      // Local header + central directory (the model path is in .rels too).
      expect(count(zip, name)).toBeGreaterThanOrEqual(2)
    }
    expect(zip).toContain('Target="/3D/3dmodel.model"')
  })
})
