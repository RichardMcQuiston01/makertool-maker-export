/**
 * Multi-modal export: turn one {@link ExportDoc} into a set of downloadable
 * files. Two modes:
 *
 *  - **combined** — the whole design in each chosen format, one file per format
 *    (everything for every machine in a single file).
 *  - **split** — one file per machine, in the format(s) chosen for that machine,
 *    so each machine's software gets only its own elements (e.g. laser panels as
 *    `.lbrn2`, vinyl-cutter text as `.svg`).
 *
 * Which formats a machine can use is a fixed local policy ({@link MACHINE_FORMATS})
 * — the `machineTypeFileFormats` catalog it mirrors isn't populated yet.
 */
import { renderDxf } from './dxf.ts'
import { renderLightBurn } from './lightburn.ts'
import { renderSvg } from './svg.ts'
import { renderXcs } from './xcs.ts'
import { outlineDocText, type TextOutliner } from './text.ts'
import {
  docForMachine,
  usedMachines,
  type ExportDoc,
  type MachineTarget,
} from './types.ts'

export type { TextOutliner }

/** The file formats the export core can write. */
export type ExportFormatId = 'svg' | 'dxf' | 'lightburn' | 'xcs'

interface FormatSpec {
  label: string
  extension: string
  mime: string
  render: (doc: ExportDoc) => string
  /**
   * Whether this format needs text converted to outline paths before writing
   * (it can't place native text). When true and an outliner is supplied, text is
   * vectorised; when true and none is supplied, text is dropped from that format.
   */
  outlinesText: boolean
}

/** Registry of writable formats: label, extension, MIME, and writer. */
export const FILE_FORMATS: Record<ExportFormatId, FormatSpec> = {
  svg: {
    label: 'SVG',
    extension: 'svg',
    mime: 'image/svg+xml',
    render: renderSvg,
    outlinesText: false,
  },
  dxf: {
    label: 'DXF',
    extension: 'dxf',
    mime: 'application/dxf',
    render: renderDxf,
    outlinesText: false,
  },
  lightburn: {
    label: 'LightBurn',
    extension: 'lbrn2',
    mime: 'application/xml',
    render: renderLightBurn,
    outlinesText: true,
  },
  xcs: {
    label: 'XCS',
    extension: 'xcs',
    mime: 'application/json',
    render: renderXcs,
    outlinesText: true,
  },
}

/** Every format id, in display order. */
export const ALL_FORMATS: ExportFormatId[] = ['svg', 'dxf', 'lightburn', 'xcs']

/** Formats each machine target can export to (its software's supported set). */
export const MACHINE_FORMATS: Record<MachineTarget, ExportFormatId[]> = {
  laser: ['svg', 'dxf', 'lightburn', 'xcs'],
  cnc: ['dxf', 'svg'],
  vinyl: ['svg', 'dxf'],
  'uv-print': ['svg'],
  print: ['svg'],
}

/** A sensible default format selection per machine (a subset of the allowed). */
export const MACHINE_DEFAULT_FORMATS: Record<MachineTarget, ExportFormatId[]> =
  {
    laser: ['svg', 'dxf'],
    cnc: ['dxf'],
    vinyl: ['svg'],
    'uv-print': ['svg'],
    print: ['svg'],
  }

/** A produced file, ready to hand to a download helper. */
export interface ExportFile {
  name: string
  mime: string
  content: string
}

/** Options for {@link generateExportFiles}. */
export type ExportOptions =
  | { mode: 'combined'; baseName: string; formats: ExportFormatId[] }
  | {
      mode: 'split'
      baseName: string
      /** Formats per machine; a machine omitted here uses its defaults. */
      formats?: Partial<Record<MachineTarget, ExportFormatId[]>>
    }

function fileFor(
  doc: ExportDoc,
  format: ExportFormatId,
  name: string,
  outliner?: TextOutliner,
): ExportFile {
  const spec = FILE_FORMATS[format]
  // Paths-only formats get their text vectorised first, when an outliner is
  // available; otherwise text is simply omitted from that format.
  const rendered =
    spec.outlinesText && outliner ? outlineDocText(doc, outliner) : doc
  return {
    name: `${name}.${spec.extension}`,
    mime: spec.mime,
    content: spec.render(rendered),
  }
}

/**
 * Produce the export file set for a document. Formats not valid for a machine
 * (in split mode) are dropped, and duplicates are ignored, so callers can pass a
 * loose selection. Pass `outliner` to vectorise text for LightBurn/XCS (SVG/DXF
 * keep native, editable text either way).
 */
export function generateExportFiles(
  doc: ExportDoc,
  options: ExportOptions,
  outliner?: TextOutliner,
): ExportFile[] {
  if (options.mode === 'combined') {
    const formats = [...new Set(options.formats)]
    return formats.map((format) =>
      fileFor(doc, format, options.baseName, outliner),
    )
  }

  const files: ExportFile[] = []
  for (const machine of usedMachines(doc)) {
    const allowed = MACHINE_FORMATS[machine]
    const requested =
      options.formats?.[machine] ?? MACHINE_DEFAULT_FORMATS[machine]
    const formats = [...new Set(requested)].filter((fmt) =>
      allowed.includes(fmt),
    )
    if (formats.length === 0) continue
    const sub = docForMachine(doc, machine)
    for (const format of formats) {
      files.push(
        fileFor(sub, format, `${options.baseName}-${machine}`, outliner),
      )
    }
  }
  return files
}
