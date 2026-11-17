import { LM } from './types'

/** Gesture analysis of 21 landmarks (x, y, z interleaved). Works in any 2D space with uniform scale. */
export interface GestureReading {
  scale: number
  pinchDist: number
  pinch: number
  extended: boolean[]
  extendedCount: number
  openness: number
  fistLike: boolean
  pointLike: boolean
  openLike: boolean
  roll: number
}

const d2 = (lm: ArrayLike<number>, a: number, b: number, sx = 1) => {
  const dx = (lm[a * 3] - lm[b * 3]) * sx
  const dy = lm[a * 3 + 1] - lm[b * 3 + 1]
  return Math.hypot(dx, dy)
}
const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

/**
 * @param lm landmarks; x and y should be in a space with equal units (pass `sx` = image aspect
 *   if x/y are normalized to a non-square image).
 */
export function readGesture(lm: ArrayLike<number>, sx = 1): GestureReading {
  const scale = Math.max(1e-4, d2(lm, LM.WRIST, LM.MIDDLE_MCP, sx))
  const pinchDist = d2(lm, LM.THUMB_TIP, LM.INDEX_TIP, sx) / scale
  const pinch = 1 - smooth(0.25, 0.8, pinchDist)
  const fingers: [number, number][] = [
    [LM.INDEX_TIP, LM.INDEX_PIP], [LM.MIDDLE_TIP, LM.MIDDLE_PIP], [LM.RING_TIP, LM.RING_PIP], [LM.PINKY_TIP, LM.PINKY_PIP],
  ]
  const extended = fingers.map(([tip, pip]) => d2(lm, tip, LM.WRIST, sx) > 1.15 * d2(lm, pip, LM.WRIST, sx))
  const thumbExt = d2(lm, LM.THUMB_TIP, LM.PINKY_MCP, sx) > d2(lm, LM.THUMB_IP, LM.PINKY_MCP, sx) * 1.05
  extended.unshift(thumbExt)
  const extendedCount = extended.filter(Boolean).length
  // openness: mean tip distance from palm center relative to scale
  const pcx = (lm[0] + lm[LM.INDEX_MCP * 3] + lm[LM.PINKY_MCP * 3]) / 3
  const pcy = (lm[1] + lm[LM.INDEX_MCP * 3 + 1] + lm[LM.PINKY_MCP * 3 + 1]) / 3
  let tipSum = 0
  for (const t of [LM.INDEX_TIP, LM.MIDDLE_TIP, LM.RING_TIP, LM.PINKY_TIP]) {
    tipSum += Math.hypot((lm[t * 3] - pcx) * sx, lm[t * 3 + 1] - pcy) / scale
  }
  const meanTip = tipSum / 4
  const openness = smooth(0.55, 1.15, meanTip)
  const nonThumb = extended.slice(1).filter(Boolean).length
  const fistLike = nonThumb === 0 && meanTip < 0.95
  const pointLike = extended[1] && !extended[2] && !extended[3] && !extended[4] && pinchDist > 0.5
  const openLike = nonThumb >= 4 && extendedCount >= 4 && pinchDist > 0.6
  const vx = (lm[LM.MIDDLE_MCP * 3] - lm[0]) * sx
  const vy = lm[LM.MIDDLE_MCP * 3 + 1] - lm[1]
  const roll = Math.atan2(vx, -vy)
  return { scale, pinchDist, pinch, extended, extendedCount, openness, fistLike, pointLike, openLike, roll }
}

/** Hysteresis + debounce for one hand's discrete gestures. */
export class GestureLatch {
  pinching = false
  state: 'none' | 'open' | 'fist' | 'point' = 'none'
  private cand: 'none' | 'open' | 'fist' | 'point' = 'none'
  private candSince = 0
  /** Returns events fired on this update. */
  update(r: GestureReading, now: number): ('pinchStart' | 'pinchEnd' | 'open' | 'fist' | 'point')[] {
    const ev: ('pinchStart' | 'pinchEnd' | 'open' | 'fist' | 'point')[] = []
    if (!this.pinching && r.pinchDist < 0.35) { this.pinching = true; ev.push('pinchStart') }
    else if (this.pinching && r.pinchDist > 0.5) { this.pinching = false; ev.push('pinchEnd') }
    const c = this.pinching ? 'none' : r.fistLike ? 'fist' : r.openLike ? 'open' : r.pointLike ? 'point' : 'none'
    if (c !== this.cand) { this.cand = c; this.candSince = now }
    if (c !== this.state && now - this.candSince >= 120) {
      this.state = c
      if (c !== 'none') ev.push(c)
    }
    return ev
  }
  reset() { this.pinching = false; this.state = 'none'; this.cand = 'none' }
}
