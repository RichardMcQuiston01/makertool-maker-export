/**
 * xTool Creative Space project (`.xcs`) writer. An `.xcs` file is a plain JSON
 * document describing a canvas of "display" objects; this emits one `PATH`
 * display per polyline, plus the surrounding project/canvas/layer scaffolding
 * xTool Studio expects.
 *
 * Schema and conventions were taken from the sibling reference project
 * `RichardMcQuiston01/unofficial-xcs-writer` (its `src/glyphs.ts` documents the
 * placement math and its `xcs_samples/*.xcs` the field layout). The key one:
 * a PATH's `dPath` is expressed in coordinates *local to its `graphicX/graphicY`
 * pen origin*, not pre-translated to the canvas. We set `graphicX/Y = 0` and
 * `scale = 1`, so the dPath simply carries absolute millimetre coordinates
 * (canvas y-DOWN, matching our neutral model — no flip needed).
 *
 * v1 emits paths only; text displays (which need per-character glyph outline
 * data) are a follow-up.
 */
import {
  LAYER_COLOR,
  LAYER_NAME,
  usedLayerKinds,
  type ExportDoc,
  type ExportLayerKind,
  type ExportPath,
} from './types.ts'

/** Round to 2 decimals, dropping trailing zeros. */
function f(n: number): string {
  return Number(n.toFixed(2)).toString()
}

/** `#rrggbb` → the 0xRRGGBB integer xTool stores in numeric colour fields. */
function hexToInt(hex: string): number {
  return parseInt(hex.replace('#', ''), 16)
}

/**
 * Deterministic UUID-shaped id from a counter, so a given document always
 * produces byte-identical output (stable diffs, testable) rather than depending
 * on `crypto.randomUUID`. xTool only needs these ids to be unique strings.
 */
function idFor(seed: number): string {
  const hex = seed.toString(16).padStart(12, '0')
  return `00000000-0000-4000-8000-${hex}`
}

interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

function boundsOf(path: ExportPath): Bounds {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of path.points) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  return { minX, minY, maxX, maxY }
}

/** `M … L … [Z]` in absolute mm (canvas y-down), local to graphic origin (0,0). */
function dPathOf(path: ExportPath): string {
  const [first, ...rest] = path.points
  let d = `M${f(first.x)} ${f(first.y)}`
  for (const p of rest) d += `L${f(p.x)} ${f(p.y)}`
  if (path.closed) d += 'Z'
  return d
}

/** Build one PATH display object for a polyline. */
function pathDisplay(
  path: ExportPath,
  kind: ExportLayerKind,
  seed: number,
  zOrder: number,
): Record<string, unknown> {
  const b = boundsOf(path)
  const color = LAYER_COLOR[kind]
  const id = idFor(seed)
  return {
    id,
    name: null,
    type: 'PATH',
    x: Number(f(b.minX)),
    y: Number(f(b.minY)),
    angle: 0,
    scale: { x: 1, y: 1 },
    skew: { x: 0, y: 0 },
    pivot: { x: 0, y: 0 },
    localSkew: { x: 0, y: 0 },
    offsetX: Number(f(b.minX)),
    offsetY: Number(f(b.minY)),
    lockRatio: true,
    isClosePath: path.closed,
    zOrder,
    groupTags: [],
    groupTag: id,
    layerTag: color,
    layerColor: color,
    visible: true,
    originColor: color,
    enableTransform: true,
    visibleState: true,
    lockState: false,
    resourceOrigin: '',
    customData: {},
    rootComponentId: '',
    minCanvasVersion: '0.0.0',
    alpha: 1,
    fill: { paintType: 'color', visible: false, color: 0, alpha: 1 },
    stroke: {
      paintType: 'color',
      visible: true,
      color: hexToInt(color),
      alpha: 1,
      width: 1,
      cap: 'butt',
      join: 'miter',
      miterLimit: 4,
      alignment: 0.5,
    },
    effects: [],
    width: Number(f(b.maxX - b.minX)),
    height: Number(f(b.maxY - b.minY)),
    isFill: false,
    lineColor: hexToInt(color),
    fillColor: color,
    points: [],
    dPath: dPathOf(path),
    fillRule: 'nonzero',
    graphicX: 0,
    graphicY: 0,
    isCompoundPath: false,
  }
}

/** Render a neutral document to an `.xcs` JSON string. */
export function renderXcs(doc: ExportDoc): string {
  const kinds = usedLayerKinds(doc)
  const canvasId = idFor(1)

  // Layer table, keyed by the layer's hex colour (xTool's layer identity).
  const layerData: Record<string, unknown> = {}
  kinds.forEach((kind, i) => {
    layerData[LAYER_COLOR[kind]] = {
      name: LAYER_NAME[kind],
      order: i + 1,
      visible: true,
    }
  })

  const displays: Record<string, unknown>[] = []
  let seed = 2 // 1 is the canvas id
  let z = 1
  for (const layer of doc.layers) {
    if (!kinds.includes(layer.kind)) continue
    for (const path of layer.paths) {
      if (path.points.length < 2) continue
      displays.push(pathDisplay(path, layer.kind, seed++, z++))
    }
  }

  const project = {
    canvasId,
    extId: '',
    extName: '',
    device: '{"id":"","power":[],"data":{"dataType":"Map","value":[]}}',
    version: '1.7.0',
    created: 0,
    modify: 0,
    ua: 'maker-template-pro',
    meta: [],
    cover: '',
    canvas: [
      {
        id: canvasId,
        title: 'Canvas 1',
        layerData,
        groupData: {},
        displays,
        extendInfo: {
          version: '2.15.108',
          minCanvasVersion: '0.0.0',
          displayProcessConfigMap: {},
          rulerPluginData: { rulerGuide: [] },
          type: '2d',
          gridOptions: { color: 'normal', isShow: true },
        },
      },
    ],
    minRequiredVersion: '2.6.0',
    appMinRequiredVersion: '',
    webMinRequiredVersion: '',
  }

  return JSON.stringify(project)
}
