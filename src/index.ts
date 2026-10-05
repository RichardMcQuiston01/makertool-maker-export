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
