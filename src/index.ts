/**
 * Public surface of `@richardmcquiston01/maker-export`. Tools resolve their
 * design into an {@link ExportDoc} and call these writers (or the multi-modal
 * engine); the neutral model keeps the format writers shared instead of
 * duplicated per tool.
 *
 * Framework-free by design: nothing here imports React or touches the DOM, so
 * it runs the same in the browser, Node, and Bun.
 */
export * from './types.ts'
export {
  renderSvg,
  escapeXml,
  type SvgOptions,
  type SvgProfile,
} from './svg.ts'
export { renderDxf, type DxfOptions, type DxfVersion } from './dxf.ts'
export {
  fitArcs,
  DEFAULT_ARC_TOLERANCE_MM,
  type BulgeVertex,
  type FittedPath,
} from './arcs.ts'
export {
  renderHpgl,
  HPGL_MIME,
  HPGL_UNITS_PER_MM,
  type HpglOptions,
} from './hpgl.ts'
export { renderPdf, PDF_MIME, type PdfOptions } from './pdf.ts'
export {
  renderGcode,
  planGcode,
  resolveGcodeOptions,
  segmentLength,
  GCODE_MIME,
  type CutDirection,
  type GcodeOperation,
  type GcodeOperationKind,
  type GcodeOptions,
  type GcodePlan,
  type GcodeProcess,
  type GcodeTabs,
  type ResolvedGcodeOptions,
  type ToolpathSegment,
} from './gcode.ts'
export { renderLightBurn } from './lightburn.ts'
export { renderXcs } from './xcs.ts'
export {
  flattenCommands,
  flattenStrokes,
  outlineTextFromCommands,
  outlineDocText,
  type PathCommand,
  type Point2,
  type TextOutliner,
} from './text.ts'
export {
  generateExportFiles,
  FILE_FORMATS,
  ALL_FORMATS,
  MACHINE_FORMATS,
  MACHINE_DEFAULT_FORMATS,
  type ExportFormatId,
  type ExportFile,
  type ExportOptions,
  type FormatOptions,
} from './multimodal.ts'
export {
  exportForAtomm,
  findAtommSvgIssues,
  type AtommExportIntent,
  type AtommExportOptions,
  type AtommExportResult,
  type AtommFile,
} from './atomm.ts'
export {
  docToMeshes,
  extrudeShapes,
  ringsToShapes,
  regionShapes,
  triangulateShape,
  triangleNormal,
  ringSignedArea,
  DEFAULT_THICKNESS_MM,
  DEFAULT_ENGRAVE_HEIGHT_MM,
  type Mesh,
  type Model3d,
  type Model3dOptions,
  type Shape2D,
  type Triangle,
  type Vec3,
} from './mesh.ts'
export { renderStl, renderStlAscii, STL_MIME, type StlOptions } from './stl.ts'
export {
  render3mf,
  render3mfModel,
  THREE_MF_MIME,
  type ThreeMfOptions,
} from './threemf.ts'
export { createZip, crc32, type ZipEntry } from './zip.ts'
