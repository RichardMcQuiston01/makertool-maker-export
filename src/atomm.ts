/**
 * Atomm export adapter: turn a neutral {@link ExportDoc} into the files Atomm's
 * `export` lifecycle hook returns (see https://dev.atomm.com/docs/export).
 *
 * Atomm calls the hook once per dropdown action and tells us the `intent`:
 *  - `openInStudio` — one editable SVG for xTool Studio, in Atomm's processing
 *    colours so the platform can pre-assign each element's processing type.
 *  - `download` — every file the user should get on disk (the platform zips
 *    more than one): the same Atomm SVG, any extra formats requested, and a
 *    per-machine file for elements bound for non-laser machines.
 *
 * Framework-free: returns strings, not `Blob`s; the generator shell wraps them
 * (`new Blob([file.content], { type: file.mime })`) because the hook contract
 * is `{ filename, blob }`.
 */
import {
  generateExportFiles,
  type ExportFormatId,
  type ExportFile,
} from './multimodal.ts'
import { renderSvg } from './svg.ts'
import type { TextOutliner } from './text.ts'
import {
  layerHasGeometry,
  layerMachine,
  type ExportDoc,
  type ExportLayer,
} from './types.ts'

/** Which Atomm export-dropdown item triggered the hook. */
export type AtommExportIntent = 'download' | 'openInStudio'

/** One file to hand back to Atomm. */
export interface AtommFile {
  /** Includes the extension; contains no path separators. */
  filename: string
  mime: string
  content: string
}

/** Options for {@link exportForAtomm}. */
export interface AtommExportOptions {
  /** Filename stem, without extension (e.g. `bookmark-halloween`). */
  baseName: string
  /**
   * Extra formats added to a `download` (the Atomm SVG is always included).
   * Ignored for `openInStudio`, which is always a single SVG.
   */
  extraFormats?: ExportFormatId[]
  /**
   * Vectorises text. When supplied, text becomes solid glyph outlines (a fill
   * engrave) in every output, which Studio handles more reliably than native
   * `<text>`; without it, SVG keeps native text and LightBurn/XCS omit it.
   */
  outliner?: TextOutliner
}

/** Success carries the files; failure carries a message safe to show a user. */
export type AtommExportResult =
  { ok: true; files: AtommFile[] } | { ok: false; error: string }

/** Whether any layer of `doc` carries geometry. */
function hasGeometry(doc: ExportDoc): boolean {
  return doc.layers.some(layerHasGeometry)
}

/** A copy of `doc` containing only the layers that match `keep`. */
function filterLayers(
  doc: ExportDoc,
  keep: (layer: ExportLayer) => boolean,
): ExportDoc {
  return { ...doc, layers: doc.layers.filter(keep) }
}

/**
 * Vectorise text for Atomm. Engrave text becomes its own fill layer (solid
 * glyphs); cut text stays stroked. Putting glyphs on a separate layer keeps any
 * stroked line-engrave paths on the original layer from being filled.
 */
function outlineTextForAtomm(
  doc: ExportDoc,
  outliner: TextOutliner,
): ExportDoc {
  const layers: ExportLayer[] = []
  for (const layer of doc.layers) {
    const texts = layer.texts ?? []
    if (texts.length === 0) {
      layers.push(layer)
      continue
    }
    const glyphPaths = texts.flatMap((text) => outliner(text))
    const rest: ExportLayer = { ...layer, texts: [] }
    if (layer.kind === 'engrave') {
      layers.push(rest)
      layers.push({
        kind: 'engrave',
        machine: layer.machine,
        paths: glyphPaths,
        fill: true,
      })
    } else {
      layers.push({ ...rest, paths: [...layer.paths, ...glyphPaths] })
    }
  }
  return { ...doc, layers }
}

/** The Atomm-profile SVG for `doc`, vectorising text when an outliner exists. */
function atommSvg(doc: ExportDoc, outliner?: TextOutliner): string {
  const prepared: ExportDoc =
    outliner === undefined ? doc : outlineTextForAtomm(doc, outliner)
  return renderSvg(prepared, { profile: 'atomm' })
}

/** Strip path separators and surrounding space so the name is a valid stem. */
function cleanBaseName(baseName: string): string {
  return baseName.replace(/[\\/]+/g, '-').trim()
}

function toAtommFile(file: ExportFile): AtommFile {
  return { filename: file.name, mime: file.mime, content: file.content }
}

/**
 * Build the file set for one Atomm export action. Check `ok` on the result: an
 * empty design or an unusable file name returns a descriptive error instead of
 * producing an empty export.
 */
export function exportForAtomm(
  doc: ExportDoc,
  intent: AtommExportIntent,
  options: AtommExportOptions,
): AtommExportResult {
  const baseName: string = cleanBaseName(options.baseName)
  if (baseName === '') {
    return {
      ok: false,
      error:
        'Cannot export: the file name is empty. Provide a base name such as "bookmark".',
    }
  }
  if (!hasGeometry(doc)) {
    return {
      ok: false,
      error:
        'Nothing to export: the design has no cut or engrave geometry yet. Generate or edit the design first.',
    }
  }

  const laserDoc: ExportDoc = filterLayers(
    doc,
    (layer) => layerMachine(layer) === 'laser',
  )
  const hasLaser: boolean = hasGeometry(laserDoc)

  if (intent === 'openInStudio') {
    // Studio opens one editable vector file. Prefer the laser elements; a design
    // with none (e.g. vinyl-only) still opens whatever geometry it has.
    const studioDoc: ExportDoc = hasLaser ? laserDoc : doc
    return {
      ok: true,
      files: [
        {
          filename: `${baseName}.svg`,
          mime: 'image/svg+xml',
          content: atommSvg(studioDoc, options.outliner),
        },
      ],
    }
  }

  const files: AtommFile[] = []
  if (hasLaser) {
    files.push({
      filename: `${baseName}.svg`,
      mime: 'image/svg+xml',
      content: atommSvg(laserDoc, options.outliner),
    })
    const extras: ExportFormatId[] = (options.extraFormats ?? []).filter(
      (format) => format !== 'svg',
    )
    if (extras.length > 0) {
      const extraFiles: ExportFile[] = generateExportFiles(
        laserDoc,
        { mode: 'combined', baseName, formats: extras },
        options.outliner,
      )
      files.push(...extraFiles.map(toAtommFile))
    }
  }

  const otherMachines: ExportDoc = filterLayers(
    doc,
    (layer) => layerMachine(layer) !== 'laser',
  )
  if (hasGeometry(otherMachines)) {
    const machineFiles: ExportFile[] = generateExportFiles(
      otherMachines,
      { mode: 'split', baseName },
      options.outliner,
    )
    files.push(...machineFiles.map(toAtommFile))
  }

  return { ok: true, files }
}

/** Tags whose child shapes Atomm never treats as paintable geometry. */
const IGNORED_CONTAINER_TAGS: readonly string[] = [
  'defs',
  'symbol',
  'clipPath',
  'mask',
  'marker',
  'pattern',
]

/**
 * Lint an SVG against Atomm's export rules and return human-readable problems
 * (empty = clean). Intended as a guard in tests for every tool's Atomm output,
 * since the traps are silent: `<use>` shapes never receive a processing type,
 * and unreadable colours drop elements into "Other vector".
 */
export function findAtommSvgIssues(svg: string): string[] {
  const issues: string[] = []

  if (/<use[\s/>]/.test(svg)) {
    issues.push(
      'Contains <use>: Atomm ignores shapes drawn by <use>, so they get no processing type. Emit real shapes instead.',
    )
  }
  for (const tag of IGNORED_CONTAINER_TAGS) {
    if (new RegExp(`<${tag}[\\s/>]`).test(svg)) {
      issues.push(
        `Contains <${tag}>: shapes inside it are never exported to Atomm. Move them to the top level.`,
      )
    }
  }
  if (/currentColor|var\(|hsl\(|@media/.test(svg)) {
    issues.push(
      'Uses currentColor, a CSS variable, hsl(), or @media: Atomm cannot read these colours, so the element lands in "Other vector".',
    )
  }
  const colorAttr: RegExp = /\b(fill|stroke)="([^"]*)"/g
  for (const match of svg.matchAll(colorAttr)) {
    const value: string = match[2].trim()
    const isNone: boolean = value === 'none'
    const isHex: boolean =
      /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value)
    const isRgb: boolean = /^rgba?\(\s*\d/.test(value)
    if (!isNone && !isHex && !isRgb) {
      issues.push(
        `Unrecognised ${match[1]} colour "${value}": use #RRGGBB or rgb(); named colours are not read.`,
      )
    }
  }
  const root: string = svg.slice(0, svg.indexOf('>') + 1)
  if (!/\bviewBox="/.test(root)) {
    issues.push('Root <svg> has no viewBox; Atomm expects a viewBox in mm.')
  }
  if (!/\bwidth="[\d.]+mm"/.test(root) || !/\bheight="[\d.]+mm"/.test(root)) {
    issues.push(
      'Root <svg> width/height are not in mm; the exported file must be 1:1 real size.',
    )
  }
  return issues
}
