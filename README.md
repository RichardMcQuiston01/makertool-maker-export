# Maker Export

Framework-free export engine for maker tools. Describe a design once, as a
neutral **`ExportDoc`** (a sheet size plus layers of cut and engrave
geometry), then write it out as:

| Format    | Writer            | File     | Used by                         |
| --------- | ----------------- | -------- | ------------------------------- |
| SVG       | `renderSvg`       | `.svg`   | Anything; vinyl and print tools |
| DXF       | `renderDxf`       | `.dxf`   | CAD, CNC, most laser software   |
| LightBurn | `renderLightBurn` | `.lbrn2` | LightBurn (engrave layers fill) |
| xTool XCS | `renderXcs`       | `.xcs`   | xTool Creative Space            |

It has no runtime dependencies and no DOM or framework code, so it runs the
same in the browser, in Node (18+), and in Bun. It was extracted from the
[Maker Template Pro](https://github.com/RichardMcQuiston01/maker-template-pro)
tools, where every tool exports through it.

## Install

```sh
npm install @richardmcquiston01/maker-export
```

## Usage

Coordinates are millimetres, y-down, with the origin at the top-left of the
sheet.

```ts
import {
  generateExportFiles,
  type ExportDoc,
} from '@richardmcquiston01/maker-export'

const doc: ExportDoc = {
  widthMm: 100,
  heightMm: 60,
  layers: [
    {
      kind: 'cut',
      paths: [
        {
          closed: true,
          points: [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 100, y: 60 },
            { x: 0, y: 60 },
          ],
        },
      ],
    },
    {
      kind: 'engrave',
      texts: [{ value: 'Hello', x: 50, y: 35, sizeMm: 12, anchor: 'middle' }],
      paths: [],
    },
  ],
}

// One file per format, every layer in each.
const files = generateExportFiles(doc, {
  mode: 'combined',
  baseName: 'sign',
  formats: ['svg', 'dxf', 'lightburn', 'xcs'],
})
for (const file of files) {
  console.log(file.name, file.mime, file.content.length) // 'sign.svg', …
}
```

Each writer can also be called on its own: `renderSvg(doc)`, `renderDxf(doc)`,
`renderLightBurn(doc)` and `renderXcs(doc)` each return the file's text.

### Machines and split export

Every layer has a `machine` (`'laser'` by default; also `'vinyl'`, `'cnc'`,
`'uv-print'` and `'print'`). In `split` mode, `generateExportFiles` writes one
set of files per machine used in the document, each holding only that
machine's layers and limited to formats that machine's software accepts
(`MACHINE_FORMATS`; a vinyl cutter gets SVG and DXF, for example):

```ts
generateExportFiles(doc, {
  mode: 'split',
  baseName: 'keychain',
  formats: { laser: ['lightburn'], vinyl: ['svg'] },
})
// → keychain-laser.lbrn2, keychain-vinyl.svg
```

### Text

SVG keeps `texts` as live text. For formats where text should be outlines,
pass a `TextOutliner` (a function from an `ExportText` to outline paths) as
the third argument to `generateExportFiles`. The package stays font-free, so
you supply the outlines. `outlineTextFromCommands(commands, text)` helps build
one: give it a font library's path commands for the text laid out at the
origin (e.g. opentype.js `font.getPath(text.value, 0, 0, text.sizeMm).commands`)
and it returns closed outline paths placed, anchored and rotated exactly as the
SVG writer places live text.

### Geometry helpers

- `flattenCommands(commands)` flattens path commands (lines, quadratic and
  cubic curves) into closed rings.
- `flattenStrokes(commands)` does the same, but keeps open subpaths open (a
  leaf's vein, for example) and marks each path's `closed` flag.

## Buy Me a Coffee

If this app, code, or repository has helped you or someone you know, please consider donating. I appreciate any help to offset the costs of development and/or AI Credits.

[**Donate via Stripe**](https://donate.stripe.com/00w5kD3Gj1Xo9v7gVOcs800), or scan:

[![Donate via Stripe](https://raw.githubusercontent.com/RichardMcQuiston01/makertool-maker-export/main/donate.svg)](https://donate.stripe.com/00w5kD3Gj1Xo9v7gVOcs800)

## License

Apache 2.0 — see [LICENSE](https://github.com/RichardMcQuiston01/makertool-maker-export/blob/main/LICENSE).

## Copyright

(c)2026 Richard McQuiston. All rights reserved.
