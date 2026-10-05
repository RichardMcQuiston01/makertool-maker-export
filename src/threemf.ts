/**
 * 3MF writer. Unlike STL, 3MF carries units, names and colours: each body
 * (the base plate and every engrave layer) is its own mesh object coloured
 * after its layer, grouped as parts of one object, so a slicer loads them
 * together and can give each part its own filament for multi-colour printing.
 */
import { docToMeshes, type Mesh, type Model3dOptions } from './mesh.ts'
import { escapeXml } from './svg.ts'
import type { ExportDoc } from './types.ts'
import { createZip } from './zip.ts'

export const THREE_MF_MIME = 'model/3mf'

export interface ThreeMfOptions extends Model3dOptions {
  /** Model title (3MF metadata and the grouped object's name). Defaults to `model`. */
  name?: string
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>
`

const RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>
`

/** `#rgb`/`#rrggbb` → 3MF's `#RRGGBB`; anything else falls back to grey. */
function displayColor(color: string): string {
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(color)
  if (short)
    return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toUpperCase()
  return /^#[0-9a-f]{6}$/i.test(color) ? color.toUpperCase() : '#808080'
}

function num(value: number): string {
  const rounded = Number(value.toFixed(4))
  return (rounded === 0 ? 0 : rounded).toString()
}

/** One mesh as indexed vertices + triangles, sharing coincident corners. */
function meshXml(mesh: Mesh): string {
  const index = new Map<string, number>()
  const vertices: string[] = []
  const triangles: string[] = []
  const vertexId = (x: number, y: number, z: number): number => {
    // Corners shared between triangles are the very same numbers, so the raw
    // values make a cheap key; only new vertices pay for formatting.
    const key = `${x} ${y} ${z}`
    let id = index.get(key)
    if (id === undefined) {
      id = vertices.length
      index.set(key, id)
      vertices.push(`<vertex x="${num(x)}" y="${num(y)}" z="${num(z)}"/>`)
    }
    return id
  }
  for (const [a, b, c] of mesh.triangles) {
    const v1 = vertexId(a.x, a.y, a.z)
    const v2 = vertexId(b.x, b.y, b.z)
    const v3 = vertexId(c.x, c.y, c.z)
    if (v1 !== v2 && v2 !== v3 && v1 !== v3) {
      triangles.push(`<triangle v1="${v1}" v2="${v2}" v3="${v3}"/>`)
    }
  }
  return [
    '      <mesh>',
    '        <vertices>',
    ...vertices.map((v) => `          ${v}`),
    '        </vertices>',
    '        <triangles>',
    ...triangles.map((t) => `          ${t}`),
    '        </triangles>',
    '      </mesh>',
  ].join('\n')
}

/** The `3D/3dmodel.model` document for the extruded design. */
export function render3mfModel(
  doc: ExportDoc,
  options: ThreeMfOptions = {},
): string {
  const title = options.name ?? 'model'
  const { meshes } = docToMeshes(doc, options)
  // id 1 is the material group; mesh objects follow; the group comes last.
  const materials = meshes.map(
    (m) =>
      `      <base name="${escapeXml(m.name)}" displaycolor="${displayColor(m.color)}"/>`,
  )
  const objects = meshes.map((m, i) =>
    [
      `    <object id="${i + 2}" type="model" name="${escapeXml(m.name)}" pid="1" pindex="${i}">`,
      meshXml(m),
      '    </object>',
    ].join('\n'),
  )
  let buildId = 2
  if (meshes.length > 1) {
    buildId = meshes.length + 2
    objects.push(
      [
        `    <object id="${buildId}" type="model" name="${escapeXml(title)}">`,
        '      <components>',
        ...meshes.map((_, i) => `        <component objectid="${i + 2}"/>`),
        '      </components>',
        '    </object>',
      ].join('\n'),
    )
  }
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">',
    `  <metadata name="Title">${escapeXml(title)}</metadata>`,
    '  <metadata name="Application">@richardmcquiston01/maker-export</metadata>',
    '  <resources>',
    ...(meshes.length > 0
      ? ['    <basematerials id="1">', ...materials, '    </basematerials>']
      : []),
    ...objects,
    '  </resources>',
    '  <build>',
    ...(meshes.length > 0 ? [`    <item objectid="${buildId}"/>`] : []),
    '  </build>',
    '</model>',
    '',
  ].join('\n')
}

/** The extruded design as a 3MF package. */
export function render3mf(
  doc: ExportDoc,
  options: ThreeMfOptions = {},
): Uint8Array {
  const encoder = new TextEncoder()
  return createZip([
    { name: '[Content_Types].xml', data: encoder.encode(CONTENT_TYPES) },
    { name: '_rels/.rels', data: encoder.encode(RELS) },
    {
      name: '3D/3dmodel.model',
      data: encoder.encode(render3mfModel(doc, options)),
    },
  ])
}
