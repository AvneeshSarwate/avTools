// Lane layout: which expression lanes are showing and where they sit. The
// lanes take the bottom of the Konva stage under the note grid (Ableton's
// lanes under the MIDI Note Editor), so everything that asks where the grid
// ends goes through noteAreaHeight here and in viewport.getNoteAreaHeight.
import type { ExpressionArea, ExpressionLane, PianoRollState } from './state'

/** Lane height in CSS px (each lane). */
export const LANE_HEIGHT = 64
/** Inner padding so the 0 and 127 lines are not on the lane edges. */
export const LANE_PADDING = 6

/** Lanes per mode, top to bottom: Notes mode has velocity, MPE mode pressure and timbre. */
const MODE_LANES: Record<'notes' | 'mpe', ExpressionLane[]> = {
  notes: ['velocity'],
  mpe: ['pressure', 'timbre']
}

export interface LaneGeometry {
  lane: ExpressionLane
  top: number
  height: number
}

export function visibleLanes(state: PianoRollState): ExpressionLane[] {
  const { enabled, mode, lanesVisible } = state.expression
  if (!enabled) return []
  return MODE_LANES[mode].filter((lane) => lanesVisible[lane])
}

export function lanesHeight(state: PianoRollState): number {
  return visibleLanes(state).length * LANE_HEIGHT
}

/** Height of the note grid: the stage minus the lanes under it. */
export function noteAreaHeight(state: PianoRollState): number {
  const stage = state.stage
  if (!stage) return 0
  return Math.max(0, stage.height() - lanesHeight(state))
}

export function laneGeometries(state: PianoRollState): LaneGeometry[] {
  let top = noteAreaHeight(state)
  return visibleLanes(state).map((lane) => {
    const geometry = { lane, top, height: LANE_HEIGHT }
    top += LANE_HEIGHT
    return geometry
  })
}

/** The expression area under a stage y: the pitch area (note grid) or a lane. */
export function areaAt(state: PianoRollState, y: number): ExpressionArea | null {
  if (y < noteAreaHeight(state)) return 'pitch'
  const geometry = laneGeometries(state).find((g) => y >= g.top && y < g.top + g.height)
  return geometry ? geometry.lane : null
}

/** Lane value range: velocity 1..127, pressure and timbre 0..127. */
export function laneRange(lane: ExpressionLane): { min: number; max: number } {
  return lane === 'velocity' ? { min: 1, max: 127 } : { min: 0, max: 127 }
}

export function laneValueToY(geometry: LaneGeometry, value: number): number {
  const { min, max } = laneRange(geometry.lane)
  const plot = geometry.height - LANE_PADDING * 2
  return geometry.top + LANE_PADDING + (1 - (value - min) / (max - min)) * plot
}

export function laneYToValue(geometry: LaneGeometry, y: number): number {
  const { min, max } = laneRange(geometry.lane)
  const plot = geometry.height - LANE_PADDING * 2
  const value = min + (1 - (y - geometry.top - LANE_PADDING) / plot) * (max - min)
  return Math.max(min, Math.min(max, value))
}

/** Value change per pixel of vertical drag in a lane. */
export function laneValuePerPixel(geometry: LaneGeometry): number {
  const { min, max } = laneRange(geometry.lane)
  return (max - min) / (geometry.height - LANE_PADDING * 2)
}
