import { describe, expect, test } from 'vitest'
import {
  generateExportFiles,
  planGcode,
  renderGcode,
  ringSignedArea,
  type ExportDoc,
  type ExportPath,
  type GcodeOptions,
  type Point2,
} from './index.ts'

interface Move {
  code: 'G0' | 'G1' | 'G2' | 'G3'
  from: { x: number; y: number; z: number }
  to: { x: number; y: number; z: number }
  center?: Point2
  line: number
}

interface Program {
  moves: Move[]
  /** Every non-motion word line (M3, G4 …), in order, with its line index. */
  commands: { text: string; line: number }[]
  lines: string[]
}

/** A small interpreter for the subset of G-code the writer emits. */
function run(gcode: string): Program {
  const lines = gcode.trim().split('\n')
  const moves: Move[] = []
  const commands: { text: string; line: number }[] = []
  let at = { x: 0, y: 0, z: 0 }
  let modal: Move['code'] = 'G0'
  lines.forEach((raw, index) => {
    const text = raw.replace(/\(.*?\)/g, '').trim()
    if (text === '') return
    const words = new Map<string, number>()
    let motion: Move['code'] | undefined
    for (const word of text.split(/\s+/)) {
      const letter = word[0]
      const value = Number(word.slice(1))
      expect(Number.isFinite(value), `bad word ${word}`).toBe(true)
      if (letter === 'G' && value <= 3) motion = `G${value}` as Move['code']
      else words.set(letter, value)
    }
    const hasAxis = ['X', 'Y', 'Z'].some((a) => words.has(a))
    if (motion) modal = motion
    if (!motion && !hasAxis) {
      commands.push({ text, line: index })
      return
    }
    const to = {
      x: words.get('X') ?? at.x,
      y: words.get('Y') ?? at.y,
      z: words.get('Z') ?? at.z,
    }
    const move: Move = { code: modal, from: at, to, line: index }
    if (modal === 'G2' || modal === 'G3') {
      move.center = { x: at.x + words.get('I')!, y: at.y + words.get('J')! }
    }
    moves.push(move)
    at = to
  })
  return { moves, commands, lines }
}

/** Points along a move (arcs sampled every few degrees). */
function trace(move: Move): Point2[] {
  if (!move.center) return [move.to]
  const c = move.center
  const r = Math.hypot(move.from.x - c.x, move.from.y - c.y)
  const a0 = Math.atan2(move.from.y - c.y, move.from.x - c.x)
  const a1 = Math.atan2(move.to.y - c.y, move.to.x - c.x)
  let sweep = a1 - a0
  if (move.code === 'G2') while (sweep >= 0) sweep -= 2 * Math.PI
  else while (sweep <= 0) sweep += 2 * Math.PI
  const steps = Math.ceil(Math.abs(sweep) / 0.05)
  const out: Point2[] = []
  for (let i = 1; i <= steps; i++) {
    const a = a0 + (sweep * i) / steps
    out.push({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) })
  }
  return out
}

/** The XY path cut at exactly depth `z` (contiguous runs joined). */
function cutAt(program: Program, z: number): Point2[][] {
  const runs: Point2[][] = []
  let current: Point2[] | null = null
  for (const m of program.moves) {
    const flat =
      m.from.z === m.to.z && (m.from.x !== m.to.x || m.from.y !== m.to.y)
    if (m.code !== 'G0' && flat && Math.abs(m.to.z - z) < 1e-9) {
      if (!current) {
        current = [{ x: m.from.x, y: m.from.y }]
        runs.push(current)
      }
      current.push(...trace(m))
    } else {
      current = null
    }
  }
  return runs
}

function bounds(points: Point2[]): {
  minX: number
  minY: number
  maxX: number
  maxY: number
} {
  return {
    minX: Math.min(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)),
    maxX: Math.max(...points.map((p) => p.x)),
    maxY: Math.max(...points.map((p) => p.y)),
  }
}

function rect(x: number, y: number, w: number, h: number): ExportPath {
  return {
    closed: true,
    points: [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ],
  }
}

function circle(cx: number, cy: number, r: number, n = 72): ExportPath {
  return {
    closed: true,
    points: Array.from({ length: n }, (_, i) => ({
      x: cx + r * Math.cos((2 * Math.PI * i) / n),
      y: cy + r * Math.sin((2 * Math.PI * i) / n),
    })),
  }
}

/** A 40 × 30 plate (doc y-down) with a 10 × 10 window and a 12 mm round hole. */
const plate: ExportDoc = {
  widthMm: 100,
  heightMm: 50,
  layers: [
    {
      kind: 'cut',
      paths: [rect(10, 10, 40, 30), rect(15, 15, 10, 10), circle(38, 25, 6)],
    },
  ],
}

const R = 3.175 / 2

describe('planGcode', () => {
  test('offsets outlines outward and holes inward by the tool radius', () => {
    const plan = planGcode(plate, { tabs: false })
    expect(plan.warnings).toEqual([])
    expect(plan.operations.map((op) => op.kind)).toEqual([
      'hole',
      'hole',
      'outline',
    ])
    const sample = (kind: string): Point2[][] =>
      plan.operations
        .filter((op) => op.kind === kind)
        .map((op) =>
          op.segments.flatMap((s) =>
            trace({
              code: s.type === 'arc' ? (s.clockwise ? 'G2' : 'G3') : 'G1',
              from: { ...s.from, z: 0 },
              to: { ...s.to, z: 0 },
              center: s.type === 'arc' ? s.center : undefined,
              line: 0,
            }),
          ),
        )
    const [outline] = sample('outline')
    const b = bounds(outline)
    // Doc y-down 10..40 becomes machine y-up 10..40 (height 50).
    expect(b.minX).toBeCloseTo(10 - R, 2)
    expect(b.maxX).toBeCloseTo(50 + R, 2)
    expect(b.minY).toBeCloseTo(10 - R, 2)
    expect(b.maxY).toBeCloseTo(40 + R, 2)
    const holes = sample('hole').map(bounds)
    const window = holes.find((h) => h.maxX < 30)!
    expect(window.minX).toBeCloseTo(15 + R, 2)
    expect(window.maxX).toBeCloseTo(25 - R, 2)
    expect(window.minY).toBeCloseTo(25 + R, 2)
    expect(window.maxY).toBeCloseTo(35 - R, 2)
    const round = holes.find((h) => h.minX > 30)!
    expect(round.maxX - round.minX).toBeCloseTo(12 - 2 * R, 2)
  })

  test('cuts on the line with compensation off', () => {
    const plan = planGcode(plate, { tabs: false, compensation: 'none' })
    const outline = plan.operations.find((op) => op.kind === 'outline')!
    const xs = outline.segments.flatMap((s) => [s.from.x, s.to.x])
    expect(Math.min(...xs)).toBeCloseTo(10, 6)
    expect(Math.max(...xs)).toBeCloseTo(50, 6)
  })

  test('warns about holes narrower than the tool, text and merged parts', () => {
    const doc: ExportDoc = {
      widthMm: 100,
      heightMm: 50,
      layers: [
        {
          kind: 'cut',
          paths: [
            rect(10, 10, 20, 20),
            rect(15, 15, 2, 10),
            rect(31, 10, 5, 5),
          ],
          texts: [{ value: 'Hi', x: 0, y: 0, sizeMm: 5 }],
        },
      ],
    }
    const { warnings } = planGcode(doc)
    expect(warnings).toContain(
      "1 hole is narrower than the tool and won't be cut.",
    )
    expect(warnings).toContain(
      'Some parts are closer together than the tool, so they are cut as one outline.',
    )
    expect(warnings.some((w) => w.startsWith('1 text item was left out'))).toBe(
      true,
    )
  })

  test('rejects settings that cannot make a safe program', () => {
    expect(() => planGcode(plate, { toolDiameterMm: 0 })).toThrow(
      'G-code: tool diameter must be greater than 0 (got 0).',
    )
    expect(() => planGcode(plate, { stepDownMm: -1 })).toThrow(
      'G-code: step-down must be greater than 0 (got -1).',
    )
    expect(() => planGcode(plate, { feedMmPerMin: Number.NaN })).toThrow(
      /feed rate/,
    )
    expect(() => planGcode(plate, { safeZMm: 0.5 })).toThrow(/safe Z/)
  })

  test('fits arcs to curves: a round hole is two half-circle arcs', () => {
    const plan = planGcode(plate, { tabs: false })
    const round = plan.operations.find(
      (op) => op.kind === 'hole' && op.segments.every((s) => s.type === 'arc'),
    )
    expect(round?.segments).toHaveLength(2)
    const lines = planGcode(plate, { tabs: false, arcs: false })
    expect(
      lines.operations.every((op) =>
        op.segments.every((s) => s.type === 'line'),
      ),
    ).toBe(true)
  })
})

describe('renderGcode (router)', () => {
  const options: GcodeOptions = {
    materialThicknessMm: 6,
    stepDownMm: 1.5,
    tabs: { count: 4, widthMm: 6, heightMm: 1.5 },
  }
  const program = run(renderGcode(plate, options))

  test('sets up units, spindle and a safe height, and ends cleanly', () => {
    expect(program.lines[program.lines.length - 1]).toBe('M2')
    const text = program.lines.join('\n')
    expect(text).toContain('G21 G90 G17 G94')
    expect(text).toContain('S18000 M3')
    expect(program.lines.slice(-4)).toEqual(['G0 Z5', 'M5', 'G0 X0 Y0', 'M2'])
  })

  test('never rapids below the retract height', () => {
    for (const m of program.moves.filter((m) => m.code === 'G0')) {
      const sideways = m.from.x !== m.to.x || m.from.y !== m.to.y
      const lowest = sideways ? Math.min(m.from.z, m.to.z) : m.to.z
      expect(lowest, program.lines[m.line]).toBeGreaterThanOrEqual(1)
    }
    // And never moves sideways while plunging.
    for (const m of program.moves) {
      if (m.from.z !== m.to.z) {
        expect([m.from.x, m.from.y]).toEqual([m.to.x, m.to.y])
      }
    }
  })

  test('steps down to the full depth, last pass exact', () => {
    const depths = [
      ...new Set(
        program.moves
          .filter((m) => m.code === 'G1' && m.to.z < 0 && m.from.z > m.to.z)
          .map((m) => m.to.z),
      ),
    ].sort((a, b) => b - a)
    expect(depths).toEqual([-1.5, -3, -4.5, -6, -6.3])
  })

  test('cuts every hole before the outline', () => {
    const firstCut = (zone: (p: Point2) => boolean): number =>
      program.moves.findIndex(
        (m) => m.code !== 'G0' && m.to.z < 0 && zone(m.to),
      )
    const outline = program.moves.findIndex(
      (m) => m.code !== 'G0' && m.to.z < 0 && m.to.x < 10,
    )
    expect(firstCut((p) => p.x > 15 && p.x < 25)).toBeLessThan(outline)
    expect(firstCut((p) => p.x > 33 && p.x < 43)).toBeLessThan(outline)
  })

  test('lifts over holding tabs on the outline only, on passes below them', () => {
    const tabTop = -6.3 + 1.5
    const lifts = program.moves.filter(
      (m) => m.from.z < m.to.z && Math.abs(m.to.z - tabTop) < 1e-9,
    )
    // Two passes (-6 and -6.3) run below the tab top; 4 tabs each.
    expect(lifts).toHaveLength(8)
    for (const lift of lifts) {
      const outside =
        lift.to.x < 10 || lift.to.x > 50 || lift.to.y < 10 || lift.to.y > 40
      expect(outside).toBe(true)
    }
    // Each tab leaves 6 mm of material: the lifted run is 6 mm + the tool.
    const overTab = cutAt(program, tabTop)
    expect(overTab).toHaveLength(8)
    for (const run of overTab) {
      let length = 0
      for (let i = 1; i < run.length; i++) {
        length += Math.hypot(run[i].x - run[i - 1].x, run[i].y - run[i - 1].y)
      }
      expect(length).toBeCloseTo(6 + 3.175, 1)
    }
  })

  test('arcs have a consistent radius', () => {
    const arcs = program.moves.filter((m) => m.center)
    expect(arcs.length).toBeGreaterThan(0)
    for (const m of arcs) {
      const c = m.center!
      expect(Math.hypot(m.to.x - c.x, m.to.y - c.y)).toBeCloseTo(
        Math.hypot(m.from.x - c.x, m.from.y - c.y),
        3,
      )
    }
  })

  test('conventional milling cuts outlines clockwise; climb reverses', () => {
    const area = (
      p: Program,
      pick: (b: ReturnType<typeof bounds>) => boolean,
    ) =>
      cutAt(p, -1.5)
        .filter((run) => pick(bounds(run)))
        .map((run) => ringSignedArea(run))
    const isOutline = (b: ReturnType<typeof bounds>): boolean => b.minX < 10
    const isHole = (b: ReturnType<typeof bounds>): boolean => b.minX > 10
    const conventional = run(renderGcode(plate, { tabs: false }))
    expect(area(conventional, isOutline).every((a) => a < 0)).toBe(true)
    expect(area(conventional, isHole).every((a) => a > 0)).toBe(true)
    const climb = run(renderGcode(plate, { tabs: false, direction: 'climb' }))
    expect(area(climb, isOutline).every((a) => a > 0)).toBe(true)
    expect(area(climb, isHole).every((a) => a < 0)).toBe(true)
  })

  test('engraves on the line at the engrave depth, before cutting', () => {
    const doc: ExportDoc = {
      ...plate,
      layers: [
        ...plate.layers,
        {
          kind: 'engrave',
          paths: [
            {
              closed: false,
              points: [
                { x: 60, y: 10 },
                { x: 90, y: 10 },
              ],
            },
          ],
        },
      ],
    }
    const p = run(renderGcode(doc, { engraveDepthMm: 0.4 }))
    const first = p.moves.find((m) => m.code !== 'G0' && m.to.z < 0)!
    expect(first.to.z).toBe(-0.4)
    const engraved = cutAt(p, -0.4)
    expect(engraved).toHaveLength(1)
    expect(bounds(engraved[0])).toEqual({
      minX: 60,
      minY: 40,
      maxX: 90,
      maxY: 40,
    })
  })

  test('warns in the program header', () => {
    const doc: ExportDoc = {
      ...plate,
      layers: [
        { ...plate.layers[0], texts: [{ value: 'x', x: 0, y: 0, sizeMm: 3 }] },
      ],
    }
    expect(renderGcode(doc)).toContain(
      '(Warning: 1 text item was left out: text needs outlining before it can be cut.)',
    )
  })
})

describe('renderGcode (torch)', () => {
  const program = run(
    renderGcode(plate, { process: 'torch', kerfMm: 1.5, pierceDelayS: 0.5 }),
  )

  test('switches the torch on and off around each cut, with a pierce delay', () => {
    const codes = program.commands.map((c) => c.text)
    expect(codes.filter((c) => c === 'M3')).toHaveLength(3)
    expect(codes.filter((c) => c === 'M5')).toHaveLength(3)
    expect(codes.filter((c) => c === 'G4 P0.5')).toHaveLength(3)
    expect(program.moves.every((m) => m.from.z === 0 && m.to.z === 0)).toBe(
      true,
    )
    expect(program.lines.join('\n')).not.toMatch(/S\d+ M3/)
  })

  test('only moves the torch with it off, and pierces on the scrap side', () => {
    const on = new Set<number>()
    let lit = false
    for (const [i, line] of program.lines.entries()) {
      if (line === 'M3') lit = true
      if (line === 'M5') lit = false
      if (lit) on.add(i)
    }
    const pierces: Point2[] = []
    for (const m of program.moves) {
      if (m.code === 'G0') {
        expect(on.has(m.line)).toBe(false)
        pierces.push(m.to)
      } else {
        expect(on.has(m.line)).toBe(true)
      }
    }
    pierces.pop() // the final return to X0 Y0
    expect(pierces).toHaveLength(3)
    const inside = (
      p: Point2,
      x0: number,
      y0: number,
      x1: number,
      y1: number,
    ) => p.x > x0 && p.x < x1 && p.y > y0 && p.y < y1
    const [window, round, outline] = [
      pierces.find((p) => p.x < 26 && p.x > 14)!,
      pierces.find((p) => p.x > 31 && p.x < 45)!,
      pierces.find((p) => !inside(p, 9, 9, 51, 41))!,
    ]
    // Hole pierces sit inside the hole (the slug); the outline's outside it.
    expect(inside(window, 15, 25, 25, 35)).toBe(true)
    expect(Math.hypot(round.x - 38, round.y - 25)).toBeLessThan(6 - 0.75)
    expect(outline).toBeDefined()
  })

  test('shortens the lead-in to stay inside a small hole', () => {
    const doc: ExportDoc = {
      widthMm: 100,
      heightMm: 50,
      layers: [
        { kind: 'cut', paths: [rect(10, 10, 40, 30), circle(30, 25, 1.2)] },
      ],
    }
    const plan = planGcode(doc, { process: 'torch', kerfMm: 1.5, leadInMm: 3 })
    const hole = plan.operations.find((op) => op.kind === 'hole')!
    // The toolpath circle has radius 1.2 - 0.75 = 0.45 around (30, 25).
    expect(Math.hypot(hole.leadIn!.x - 30, hole.leadIn!.y - 25)).toBeLessThan(
      0.45,
    )
    const outline = plan.operations.find((op) => op.kind === 'outline')!
    const start = outline.segments[0].from
    expect(
      Math.hypot(outline.leadIn!.x - start.x, outline.leadIn!.y - start.y),
    ).toBeCloseTo(3, 6)
  })

  test("leaves engraving out: a torch can't engrave", () => {
    const doc: ExportDoc = {
      ...plate,
      layers: [
        ...plate.layers,
        { kind: 'engrave', paths: [rect(60, 10, 5, 5)] },
      ],
    }
    const plan = planGcode(doc, { process: 'torch' })
    expect(plan.operations.some((op) => op.kind === 'engrave')).toBe(false)
    expect(plan.warnings).toContain(
      "1 engraving path was left out: a torch can't engrave.",
    )
  })
})

describe('multi-modal export', () => {
  test('writes G-code as an .nc file for CNC', () => {
    const doc: ExportDoc = {
      ...plate,
      layers: [{ ...plate.layers[0], machine: 'cnc' }],
    }
    const files = generateExportFiles(doc, {
      mode: 'split',
      baseName: 'plate',
      formats: { cnc: ['gcode'] },
      formatOptions: { gcode: { process: 'torch' } },
    })
    expect(files.map((f) => [f.name, f.mime])).toEqual([
      ['plate-cnc.nc', 'text/x-gcode'],
    ])
    expect(files[0].content).toContain('(Torch: 1.5 mm kerf, M3 on / M5 off)')
  })
})
