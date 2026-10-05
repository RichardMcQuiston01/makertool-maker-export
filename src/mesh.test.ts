import { describe, expect, test } from 'vitest'
import {
  docToMeshes,
  ringsToShapes,
  type ExportDoc,
  type ExportPath,
  type Triangle,
} from './index.ts'

function square(x: number, y: number, w: number, h = w): ExportPath {
  return {
    closed: true,
    points: [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ],
  }
}

/** Signed volume by the divergence theorem (positive = outward-facing). */
function volume(triangles: Triangle[]): number {
  let v = 0
  for (const [a, b, c] of triangles) {
    v +=
      (a.x * (b.y * c.z - b.z * c.y) -
        a.y * (b.x * c.z - b.z * c.x) +
        a.z * (b.x * c.y - b.y * c.x)) /
      6
  }
  return v
}

/** Every directed edge is matched by exactly one edge running back. */
function isClosedManifold(triangles: Triangle[]): boolean {
  const key = (p: { x: number; y: number; z: number }): string =>
    `${p.x},${p.y},${p.z}`
  const edges = new Map<string, number>()
  for (const t of triangles) {
    for (let i = 0; i < 3; i++) {
      const e = `${key(t[i])}>${key(t[(i + 1) % 3])}`
      edges.set(e, (edges.get(e) ?? 0) + 1)
    }
  }
  for (const [e, n] of edges) {
    const [a, b] = e.split('>')
    if (n !== 1 || edges.get(`${b}>${a}`) !== 1) return false
  }
  return true
}

function plate(): ExportDoc {
  return {
    widthMm: 50,
    heightMm: 40,
    layers: [
      // A 30 mm plate with a 10 mm hole, wound clockwise in y-down.
      { kind: 'cut', paths: [square(0, 0, 30), square(10, 10, 10)] },
      { kind: 'engrave', paths: [square(2, 2, 4)], color: '#ff0000' },
    ],
  }
}

describe('ringsToShapes', () => {
  test('nested rings alternate solid and hole, even-odd', () => {
    const ring = (s: number) =>
      square(-s / 2, -s / 2, s).points.map((p) => ({ x: p.x, y: p.y }))
    const shapes = ringsToShapes([ring(40), ring(30), ring(20), ring(10)])
    expect(shapes).toHaveLength(2)
    expect(shapes.map((s) => s.holes.length)).toEqual([1, 1])
  })

  test('drops degenerate rings and a repeated closing point', () => {
    const shapes = ringsToShapes([
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 0 },
      ],
      [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
    ])
    expect(shapes).toHaveLength(1)
    expect(shapes[0].outer).toHaveLength(3)
  })
})

describe('docToMeshes', () => {
  test('extrudes the cut layer into a closed plate with its hole open', () => {
    const { meshes } = docToMeshes(plate(), { thicknessMm: 2 })
    const [base, raised] = meshes
    expect(base.name).toBe('CUT')
    expect(base.color).toBe('#0000ff')
    expect(isClosedManifold(base.triangles)).toBe(true)
    expect(volume(base.triangles)).toBeCloseTo((900 - 100) * 2, 6)
    const zs = base.triangles.flat().map((p) => p.z)
    expect(Math.min(...zs)).toBe(0)
    expect(Math.max(...zs)).toBe(2)

    expect(raised.name).toBe('ENGRAVE')
    expect(raised.color).toBe('#ff0000')
    expect(isClosedManifold(raised.triangles)).toBe(true)
    expect(volume(raised.triangles)).toBeCloseTo(16 * 1, 6)
    const rz = raised.triangles.flat().map((p) => p.z)
    expect(Math.min(...rz)).toBe(2)
    expect(Math.max(...rz)).toBe(3)
  })

  test('holes with collinear edges still give a closed solid', () => {
    // Two letters on one baseline: earcut drops the collinear corners from the
    // plate's caps, which must be stitched back in.
    const doc: ExportDoc = {
      widthMm: 40,
      heightMm: 20,
      layers: [
        {
          kind: 'cut',
          paths: [
            square(0, 0, 40, 20),
            ...[4, 12, 20, 28].map((x) => square(x, 6, 6)),
            {
              closed: true,
              points: [
                { x: 6, y: 14 },
                { x: 9, y: 16 },
                { x: 7, y: 16 },
                { x: 5, y: 16 },
                { x: 3, y: 16 },
              ],
            },
          ],
        },
      ],
    }
    const [mesh] = docToMeshes(doc).meshes
    expect(isClosedManifold(mesh.triangles)).toBe(true)
    expect(volume(mesh.triangles)).toBeCloseTo((800 - 4 * 36 - 6) * 3, 6)
  })

  test('flips y so the sheet reads the right way up', () => {
    const { meshes } = docToMeshes(plate())
    const ys = meshes[1].triangles.flat().map((p) => p.y)
    // Engraving 2–6 mm from the top of a 40 mm sheet.
    expect(Math.min(...ys)).toBe(34)
    expect(Math.max(...ys)).toBe(38)
  })

  test('engraving without a plate sits on the bed; omitEngrave drops it', () => {
    const engraveOnly: ExportDoc = {
      widthMm: 10,
      heightMm: 10,
      layers: [{ kind: 'engrave', paths: [square(0, 0, 5)] }],
    }
    const [mesh] = docToMeshes(engraveOnly, { engraveHeightMm: 0.6 }).meshes
    expect(Math.min(...mesh.triangles.flat().map((p) => p.z))).toBe(0)
    expect(volume(mesh.triangles)).toBeCloseTo(25 * 0.6, 6)
    expect(docToMeshes(engraveOnly, { omitEngrave: true }).meshes).toEqual([])
    expect(docToMeshes(plate(), { omitEngrave: true }).meshes).toHaveLength(1)
  })

  test('skips open paths and un-outlined text, counting them', () => {
    const doc: ExportDoc = {
      widthMm: 10,
      heightMm: 10,
      layers: [
        {
          kind: 'cut',
          paths: [{ ...square(0, 0, 5), closed: false }],
          texts: [{ value: 'Hi', x: 1, y: 8, sizeMm: 4 }],
        },
      ],
    }
    const model = docToMeshes(doc)
    expect(model.meshes).toEqual([])
    expect(model.skippedOpenPaths).toBe(1)
    expect(model.skippedTexts).toBe(1)

    const outlined = docToMeshes(doc, {
      outliner: (t) => [square(t.x, t.y - t.sizeMm, t.sizeMm)],
    })
    expect(outlined.skippedTexts).toBe(0)
    expect(volume(outlined.meshes[0].triangles)).toBeCloseTo(16 * 3, 6)
  })

  test('bad sizes fall back to the defaults', () => {
    const { meshes } = docToMeshes(plate(), {
      thicknessMm: -1,
      engraveHeightMm: Number.NaN,
    })
    expect(Math.max(...meshes[1].triangles.flat().map((p) => p.z))).toBe(4)
  })

  test('each engrave layer is its own body', () => {
    const doc = plate()
    doc.layers.push({ kind: 'engrave', paths: [square(20, 2, 4)] })
    const names = docToMeshes(doc).meshes.map((m) => m.name)
    expect(names).toEqual(['CUT', 'ENGRAVE 1', 'ENGRAVE 2'])
  })

  test('touching and overlapping shapes still make closed solids', () => {
    // QR-style modules sharing edges, and two squares overlapping.
    const doc: ExportDoc = {
      widthMm: 40,
      heightMm: 40,
      layers: [
        {
          kind: 'engrave',
          paths: [
            square(0, 0, 5),
            square(5, 0, 5),
            square(5, 5, 5),
            square(20, 20, 10),
            square(25, 25, 10),
          ],
        },
      ],
    }
    const [mesh] = docToMeshes(doc).meshes
    expect(isClosedManifold(mesh.triangles)).toBe(true)
    // Three 25 mm² modules, plus the two 100 mm² squares even-odd: their
    // 25 mm² overlap is left open, as an even-odd fill draws it.
    expect(volume(mesh.triangles)).toBeCloseTo((75 + 200 - 2 * 25) * 1, 1)
  })

  test('a letter counter inside overlapping artwork stays open', () => {
    const doc: ExportDoc = {
      widthMm: 40,
      heightMm: 40,
      layers: [
        {
          kind: 'cut',
          paths: [square(0, 0, 20), square(5, 5, 10), square(15, 15, 10)],
        },
      ],
    }
    const [mesh] = docToMeshes(doc).meshes
    expect(isClosedManifold(mesh.triangles)).toBe(true)
    // 400 − 100 (counter) + 100 − 2 × 25 (the third square, even-odd).
    expect(volume(mesh.triangles)).toBeCloseTo((400 - 100 + 100 - 50) * 3, 0)
  })
})
