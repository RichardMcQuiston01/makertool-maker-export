/**
 * Minimal typings for the slice of `clipper-lib` (a JavaScript port of Angus
 * Johnson's Clipper 6) that the G-code writer uses: integer polygon offsetting
 * and orientation. The package ships no typings of its own.
 */
declare module 'clipper-lib' {
  export interface IntPoint {
    X: number
    Y: number
  }
  export type Path = IntPoint[]
  export type Paths = Path[]

  export const JoinType: { jtSquare: number; jtRound: number; jtMiter: number }
  export const EndType: {
    etOpenSquare: number
    etOpenRound: number
    etOpenButt: number
    etClosedLine: number
    etClosedPolygon: number
  }

  export class ClipperOffset {
    constructor(miterLimit?: number, arcTolerance?: number)
    AddPaths(paths: Paths, joinType: number, endType: number): void
    Execute(solution: Paths, delta: number): void
  }

  export class Clipper {
    static Orientation(path: Path): boolean
  }

  const ClipperLib: {
    ClipperOffset: typeof ClipperOffset
    Clipper: typeof Clipper
    JoinType: typeof JoinType
    EndType: typeof EndType
  }
  export default ClipperLib
}
