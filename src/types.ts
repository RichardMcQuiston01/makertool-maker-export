/**
 * Neutral geometry model shared by every export writer. A tool resolves its
 * design into an {@link ExportDoc} — layers of polylines tagged by processing
 * kind — and each writer (SVG, DXF, LightBurn, XCS, …) turns that one model
 * into its own file format. This keeps the format writers in one reusable place
 * instead of duplicated per tool.
 *
 * Framework-free: nothing here imports React or touches the DOM.
 *
 * Coordinates are millimetres, y-DOWN with the origin at the sheet's top-left
 * (the same convention SVG and the tools' internal geometry use). Writers whose
 * format is y-up (DXF, LightBurn) flip against {@link ExportDoc.heightMm}.
 *
 * v1 carries cut/engrave *paths* only. Text labels are intentionally left to the
 * SVG/DXF writers for now — faithful text in LightBurn/XCS needs vectorized
 * glyph outlines (XCS stores per-character path data), which is a follow-up.
 */

/** A point in millimetres (y-down, top-left origin). */
export interface ExportPoint {
  x: number
  y: number
}

/** A polyline. `closed` joins the last point back to the first. */
export interface ExportPath {
  points: ExportPoint[]
  closed: boolean
}

/** A text label placed at (x, y), sized by cap height. y-down, mm. */
export interface ExportText {
  value: string
  x: number
  y: number
  sizeMm: number
  /** Horizontal anchor relative to (x, y). Defaults to `start`. */
  anchor?: 'start' | 'middle' | 'end'
  /** Rotation about (x, y), degrees clockwise (y-down). Defaults to 0. */
  rotationDeg?: number
}

/**
 * How a layer's geometry is processed on the machine. `cut` is a through/vector
 * cut; `engrave` is a surface mark (raster/score). Layer colours in the output
 * formats map back to these so the intent survives the round trip.
 */
export type ExportLayerKind = 'cut' | 'engrave'

/**
 * Which kind of machine a layer's elements are destined for. This is what makes
 * export "multi-modal": elements tagged for different machines can be split into
 * separate per-machine files. Kept as a small local set (not the externally
 * synced `MachineType` catalog, which isn't populated yet) — it only needs to be
 * granular enough to pick file formats.
 */
export type MachineTarget = 'laser' | 'vinyl' | 'uv-print' | 'cnc' | 'print'

/**
 * One processing layer: its paths/texts share a machine, a processing kind, and
 * thus a colour. `machine` defaults to `laser` and `texts` to none, so callers
 * that only produce cut paths for one machine can omit both.
 */
export interface ExportLayer {
  kind: ExportLayerKind
  paths: ExportPath[]
  /** Text elements on this layer (rendered by writers that support text). */
  texts?: ExportText[]
  /** Destination machine; defaults to `laser`. */
  machine?: MachineTarget
  /** Colour override; defaults to {@link LAYER_COLOR} for the kind. */
  color?: string
}

/** A complete design ready to export: sheet size plus its layers. */
export interface ExportDoc {
  /** Sheet width (X extent), mm. */
  widthMm: number
  /** Sheet height (Y extent), mm — writers flip y against this. */
  heightMm: number
  layers: ExportLayer[]
}

/** Presentation colour for each processing kind, shared across writers. */
export const LAYER_COLOR: Record<ExportLayerKind, string> = {
  // Blue cut / black engrave — the long-standing laser convention, and what the
  // existing SVG/DXF output already uses.
  cut: '#0000ff',
  engrave: '#000000',
}

/** Human-facing layer name per kind (used in DXF/LightBurn layer tables). */
export const LAYER_NAME: Record<ExportLayerKind, string> = {
  cut: 'CUT',
  engrave: 'ENGRAVE',
}

/** Human-facing name for each machine target (for UI + filenames). */
export const MACHINE_LABEL: Record<MachineTarget, string> = {
  laser: 'Laser',
  vinyl: 'Vinyl cutter',
  'uv-print': 'UV printer',
  cnc: 'CNC',
  print: 'Printer',
}

/** A stable order for machine targets (used for deterministic output). */
export const MACHINE_ORDER: MachineTarget[] = [
  'laser',
  'cnc',
  'vinyl',
  'uv-print',
  'print',
]

/** A layer's destination machine (default `laser`). */
export function layerMachine(layer: ExportLayer): MachineTarget {
  return layer.machine ?? 'laser'
}

/** A layer's colour (its override, else the default for its kind). */
export function layerColor(layer: ExportLayer): string {
  return layer.color ?? LAYER_COLOR[layer.kind]
}

/** Whether a layer carries any geometry (paths or text). */
export function layerHasGeometry(layer: ExportLayer): boolean {
  return layer.paths.length > 0 || (layer.texts?.length ?? 0) > 0
}

/** The layer kinds actually present in a document, in a stable order. */
export function usedLayerKinds(doc: ExportDoc): ExportLayerKind[] {
  const order: ExportLayerKind[] = ['cut', 'engrave']
  return order.filter((kind) =>
    doc.layers.some((l) => l.kind === kind && layerHasGeometry(l)),
  )
}

/** The machine targets actually present in a document, in {@link MACHINE_ORDER}. */
export function usedMachines(doc: ExportDoc): MachineTarget[] {
  return MACHINE_ORDER.filter((machine) =>
    doc.layers.some((l) => layerMachine(l) === machine && layerHasGeometry(l)),
  )
}

/** A document containing only the layers destined for `machine`. */
export function docForMachine(
  doc: ExportDoc,
  machine: MachineTarget,
): ExportDoc {
  return {
    widthMm: doc.widthMm,
    heightMm: doc.heightMm,
    layers: doc.layers.filter((l) => layerMachine(l) === machine),
  }
}
