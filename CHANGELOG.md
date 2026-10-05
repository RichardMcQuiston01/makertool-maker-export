# CHANGELOG

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **DXF for CNC, waterjet and plasma:** `renderDxf(doc, options)` takes
  `arcs: true` to fit circular arcs (and whole circles) onto curved runs
  within `arcToleranceMm` (default 0.01 mm), and `version: 'R12'` for the
  AC1009 dialect older controllers need. Default output is unchanged.
- **HPGL** (`renderHpgl`, `.plt`) for vinyl and drag-knife cutters and pen
  plotters, with a pen per layer kind and an optional overcut.
- **PDF** (`renderPdf`, `.pdf`): single-page vector PDF with hairline
  strokes, solid fill layers and native Helvetica text, with no dependencies.
- `generateExportFiles` offers `hpgl` and `pdf`, and passes per-format writer
  options through `formatOptions`. PDF is allowed for every machine, and HPGL
  for vinyl. Default selections are unchanged.
- `fitArcs` and its `BulgeVertex` / `FittedPath` types are exported.

## [0.2.0] - 2026-10-05

### Added

- **3D printing export:** `renderStl` (binary), `renderStlAscii` and
  `render3mf` extrude a design into solids. The cut layers become a base plate
  (`thicknessMm`, default 3 mm, holes kept open even-odd), and each engrave
  layer becomes raised artwork (`engraveHeightMm`, default 1 mm). 3MF keeps
  each body as its own coloured part for multi-colour printing. Text is
  extruded when an `outliner` is given.
- `docToMeshes` and the mesh helpers behind it (`ringsToShapes`,
  `triangulateShape`, `extrudeShapes`, `triangleNormal`), plus a small stored
  ZIP writer (`createZip`, `crc32`).

### Changed

- First runtime dependency: `earcut`, for triangulation.
- Node 20.19 or later is now required (was 18), because `earcut` is
  ESM-only and the CommonJS build loads it with `require`.

## [0.1.1] - 2026-10-05

First release published to npm. (`v0.1.0` was tagged, but its publish
failed, so 0.1.0 never reached the registry.)

### Added

- Synced with Maker Template Pro's export core:
  - **Filled engraving:** `ExportLayer.fill` makes the SVG writer paint a
    layer's closed paths solid, merging its contours into one even-odd path so
    letter counters stay open.
  - **Atomm support:** `renderSvg(doc, { profile: 'atomm' })` (Atomm's
    processing colours, `ATOMM_COLOR`), `exportForAtomm` for Atomm's export
    hook, and `findAtommSvgIssues`.

## [0.1.0] - 2026-09-28

### Added

- Initial release, extracted from Maker Template Pro's shared export core
  (`src/export/core`) with no API changes.
- The neutral `ExportDoc` model: sheet size plus `cut`/`engrave` layers of
  paths and text, each tagged with a machine target.
- Writers for SVG, DXF, LightBurn (`.lbrn2`, engrave layers filled) and xTool
  XCS, plus `generateExportFiles` for combined or per-machine (split) export.
- Text and curve helpers: `flattenCommands`, `flattenStrokes`,
  `outlineTextFromCommands` and `outlineDocText`.
