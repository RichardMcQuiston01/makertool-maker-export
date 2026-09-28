# CHANGELOG

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
