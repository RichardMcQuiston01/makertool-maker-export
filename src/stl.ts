/**
 * STL writers. STL is a bare triangle soup with no colour or units (slicers
 * assume millimetres), so every body in the model is written as one solid.
 * Binary is the compact default; ASCII is there for readers that need it.
 */
import {
  docToMeshes,
  triangleNormal,
  type Model3dOptions,
  type Triangle,
} from './mesh.ts'
import type { ExportDoc } from './types.ts'

export const STL_MIME = 'model/stl'

export interface StlOptions extends Model3dOptions {
  /** Solid name (ASCII) / header text (binary). Defaults to `model`. */
  name?: string
}

function allTriangles(doc: ExportDoc, options: StlOptions): Triangle[] {
  return docToMeshes(doc, options).meshes.flatMap((m) => m.triangles)
}

function solidName(name: string | undefined): string {
  // Printable ASCII without spaces, so `solid <name>` parses everywhere.
  return (name ?? 'model').replace(/[^\x21-\x7e]+/g, '_') || 'model'
}

/** The extruded document as binary STL. */
export function renderStl(
  doc: ExportDoc,
  options: StlOptions = {},
): Uint8Array {
  const triangles = allTriangles(doc, options)
  const out = new Uint8Array(84 + triangles.length * 50)
  const view = new DataView(out.buffer)
  // The header must not start with "solid", or readers take it for ASCII.
  const header = `maker-export ${solidName(options.name)}`.slice(0, 80)
  for (let i = 0; i < header.length; i++) out[i] = header.charCodeAt(i)
  view.setUint32(80, triangles.length, true)
  let at = 84
  for (const triangle of triangles) {
    const n = triangleNormal(triangle)
    for (const v of [n, ...triangle]) {
      view.setFloat32(at, v.x, true)
      view.setFloat32(at + 4, v.y, true)
      view.setFloat32(at + 8, v.z, true)
      at += 12
    }
    at += 2 // attribute byte count, unused
  }
  return out
}

function num(value: number): string {
  const rounded = Number(value.toFixed(4))
  return (rounded === 0 ? 0 : rounded).toString()
}

/** The extruded document as ASCII STL. */
export function renderStlAscii(
  doc: ExportDoc,
  options: StlOptions = {},
): string {
  const name = solidName(options.name)
  const lines: string[] = [`solid ${name}`]
  for (const triangle of allTriangles(doc, options)) {
    const n = triangleNormal(triangle)
    lines.push(
      `  facet normal ${num(n.x)} ${num(n.y)} ${num(n.z)}`,
      '    outer loop',
    )
    for (const v of triangle) {
      lines.push(`      vertex ${num(v.x)} ${num(v.y)} ${num(v.z)}`)
    }
    lines.push('    endloop', '  endfacet')
  }
  lines.push(`endsolid ${name}`)
  return lines.join('\n') + '\n'
}
