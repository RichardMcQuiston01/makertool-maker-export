# Maker Export

Framework-free export engine for maker tools. Describe a design once, as a
neutral **`ExportDoc`** (a sheet size plus layers of cut and engrave
geometry), then write it out as:

| Format    | Writer            | File     | Used by                                                |
| --------- | ----------------- | -------- | ------------------------------------------------------ |
| SVG       | `renderSvg`       | `.svg`   | Anything; vinyl and print tools                        |
| DXF       | `renderDxf`       | `.dxf`   | CAD, CNC, waterjet, plasma, most laser software        |
| LightBurn | `renderLightBurn` | `.lbrn2` | LightBurn (engrave layers fill)                        |
| xTool XCS | `renderXcs`       | `.xcs`   | xTool Creative Space                                   |
| HPGL      | `renderHpgl`      | `.plt`   | Vinyl and drag-knife cutters, pen plotters             |
| PDF       | `renderPdf`       | `.pdf`   | Shops, print-driver lasers (Epilog, Trotec, Glowforge) |
| STL       | `renderStl`       | `.stl`   | 3D printing: any slicer                                |
| 3MF       | `render3mf`       | `.3mf`   | 3D printing, multi-colour                              |

It has no DOM or framework code, so it runs the same in the browser, in Node
(20.19+), and in Bun. Its one runtime dependency is
[earcut](https://github.com/mapbox/earcut), which triangulates the 3D formats. It was extracted from the
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

### Filled engraving

Set `fill: true` on an engrave layer to have the SVG writer paint its closed
paths (and text) solid instead of stroking them, with each layer's contours
merged into one even-odd path so letter counters stay open. DXF, LightBurn and
XCS still write the outlines.

### Atomm

`renderSvg(doc, { profile: 'atomm' })` writes the SVG in
[Atomm](https://www.atomm.com)'s processing colours (red stroke = cut, blue
stroke = line engrave, blue fill = fill engrave) so the platform can pre-assign
each element's processing type. `exportForAtomm(doc, intent, { baseName })`
builds the file set Atomm's `export` hook expects (`'openInStudio'`: one SVG;
`'download'`: the SVG plus any `extraFormats` and per-machine files) and
returns a result with descriptive errors. `findAtommSvgIssues(svg)` lists the
SVG features Atomm silently ignores.

### Text

SVG keeps `texts` as live text. For formats where text should be outlines,
pass a `TextOutliner` (a function from an `ExportText` to outline paths) as
the third argument to `generateExportFiles`. The package stays font-free, so
you supply the outlines. `outlineTextFromCommands(commands, text)` helps build
one: give it a font library's path commands for the text laid out at the
origin (e.g. opentype.js `font.getPath(text.value, 0, 0, text.sizeMm).commands`)
and it returns closed outline paths placed, anchored and rotated exactly as the
SVG writer places live text.

### 3D printing (STL and 3MF)

The 3D writers extrude the flat design into solids:

- the **cut** layers' closed paths, combined even-odd (so holes and letter
  counters stay open), become a base plate `thicknessMm` thick (default 3);
- each **engrave** layer's closed paths become raised artwork
  `engraveHeightMm` tall (default 1) on top of the plate, or on the bed when
  there is no plate. `omitEngrave: true` leaves them out.

```ts
import { render3mf, renderStl } from '@richardmcquiston01/maker-export'

const stl: Uint8Array = renderStl(doc, { thicknessMm: 2, name: 'tag' })
const threeMf: Uint8Array = render3mf(doc, {
  thicknessMm: 2,
  engraveHeightMm: 0.6,
  outliner, // so text is extruded too
})
```

`renderStl` writes binary STL (`renderStlAscii` writes ASCII); STL has no
colour, so every body goes into one solid. `render3mf` keeps each body as a
separate part coloured after its layer, grouped as one object, so a slicer can
print the engraving in a second filament. Both return bytes, so wrap them in a
`Blob` (`STL_MIME`, `THREE_MF_MIME`) to download. Output is millimetres and
z-up, and every body is a closed, manifold solid.

Open paths enclose no area, so they're skipped, as is text unless you pass an
`outliner`. `docToMeshes(doc, options)` returns the triangles themselves,
along with how many paths and texts were skipped, so a UI can warn about them.

### CNC, waterjet and plasma (DXF options)

`renderDxf(doc)` writes AutoCAD 2000 DXF with every path as a polyline of
straight segments. Two options make it friendlier to cutting machines:

- `arcs: true` fits circular arcs back onto curved runs (and writes a closed
  path that's a whole circle as a `CIRCLE`). Controllers cut a run of tiny
  segments by slowing at every vertex, which leaves faceted edges; arcs cut
  smoothly, and the file is a fraction of the size. Every original vertex stays
  within `arcToleranceMm` (default 0.01 mm) of the result, corners are kept
  exactly, and deliberate polygons are never turned into circles.
- `version: 'R12'` writes the older AC1009 dialect (`POLYLINE`/`VERTEX`)
  that some controllers and shop software still require.

```ts
renderDxf(doc, { arcs: true, version: 'R12' })
// or, through the multi-format API:
generateExportFiles(doc, {
  mode: 'split',
  baseName: 'part',
  formatOptions: { dxf: { arcs: true } },
})
```

`fitArcs(points, closed, tolerance)` is exported for writers of other
formats.

### Vinyl cutters (HPGL)

`renderHpgl(doc, options)` writes HPGL in plotter units (0.025 mm), y-up. HPGL
has pens, not layers: CUT plots with pen 1 and ENGRAVE with pen 2 (`pens`
changes that, and `kinds` limits which layers are plotted). `overcutMm` cuts
that far past the start of each closed shape, so a drag knife separates it
cleanly. HPGL can't place text, so pass an outliner (or `outlineDocText`) to
include text.

### PDF

`renderPdf(doc, options)` writes a one-page vector PDF the size of the sheet.
Paths are 0.001″ hairlines (`strokeWidthMm` changes that), which print-driver
lasers treat as vector cuts; fill layers are painted solid. Text is real
Helvetica text (a standard PDF font, so nothing is embedded), placed and
anchored like the SVG writer's. The PDF is plain ASCII, so it's an ordinary
string like the other formats.

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
