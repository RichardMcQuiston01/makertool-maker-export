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
export { renderDxf } from './dxf.ts'
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
