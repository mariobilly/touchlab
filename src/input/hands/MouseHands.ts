import type { Hand, GestureEvent } from './types'

// Open right hand, palm to camera, fingers up. Units: wrist→middle-MCP = 1, y down.
const OPEN: [number, number][] = [
  [0, 0], [-0.3, -0.2], [-0.55, -0.45], [-0.75, -0.65], [-0.92, -0.82],
  [-0.32, -0.95], [-0.38, -1.35], [-0.41, -1.6], [-0.43, -1.82],
  [0, -1], [0, -1.45], [0, -1.72], [0, -1.95],
  [0.28, -0.93], [0.32, -1.33], [0.34, -1.57], [0.36, -1.77],
  [0.52, -0.82], [0.6, -1.1], [0.64, -1.3], [0.67, -1.47],
]
const curl = (mcp: [number, number]): [number, number][] => [[mcp[0], mcp[1] - 0.3], [mcp[0] * 0.9, mcp[1] - 0.1], [mcp[0] * 0.8, mcp[1] + 0.1]]
const FIST: [number, number][] = [
  OPEN[0], [-0.3, -0.2], [-0.45, -0.5], [-0.35, -0.75], [-0.12, -0.8],
  OPEN[5], ...curl(OPEN[5]), OPEN[9], ...curl(OPEN[9]), OPEN[13], ...curl(OPEN[13]), OPEN[17], ...curl(OPEN[17]),
]
const PINCH: [number, number][] = OPEN.map((p, i) => {
  if (i === 3) return [-0.72, -0.85]
  if (i === 4) return [-0.62, -1.15]
  if (i === 7) return [-0.55, -1.4]
  if (i === 8) return [-0.6, -1.2]
  return p
})
const POINT: [number, number][] = FIST.map((p, i) => (i >= 5 && i <= 8 ? OPEN[i] : p))

/** Mouse stand-in for one hand: move = hand, left button = pinch, right / Shift = fist, Alt = point, wheel = rotate. */
export class MouseHands {
  forced = false
  private x = 0.5
  private y = 0.5
  private inside = false
  private lastMove = -1e9
  private left = false
  private right = false
  private shift = false
  private alt = false
  private roll = 0
  private size = 0.11
  private prev = { left: false, fist: false, point: false }
  private vel = { x: 0, y: 0 }
  private lastPos: { x: number; y: number } | null = null
  private pose: [number, number][] = OPEN.map(p => [p[0], p[1]])
  private anchor: [number, number] = [(OPEN[4][0] + OPEN[8][0]) / 2, (OPEN[4][1] + OPEN[8][1]) / 2]

  attach(el: HTMLElement) {
    const pos = (e: PointerEvent | WheelEvent) => {
      const r = el.getBoundingClientRect()
      this.x = (e.clientX - r.left) / r.width
      this.y = (e.clientY - r.top) / r.height
      this.lastMove = performance.now()
    }
    el.addEventListener('pointermove', e => { pos(e); this.inside = true; this.shift = e.shiftKey; this.alt = e.altKey })
    el.addEventListener('pointerenter', () => { this.inside = true })
    el.addEventListener('pointerleave', () => { this.inside = false; this.left = false; this.right = false })
    el.addEventListener('pointerdown', e => {
      pos(e)
      el.setPointerCapture(e.pointerId)
      if (e.button === 0) this.left = true
      if (e.button === 2) this.right = true
      if (e.button === 1) this.alt = true
    })
    el.addEventListener('pointerup', e => {
      if (e.button === 0) this.left = false
      if (e.button === 2) this.right = false
      if (e.button === 1) this.alt = false
    })
    el.addEventListener('contextmenu', e => e.preventDefault())
    el.addEventListener('wheel', e => {
      pos(e)
      if (e.ctrlKey) this.size = Math.min(0.3, Math.max(0.05, this.size * (e.deltaY > 0 ? 0.92 : 1.08)))
      else this.roll = Math.max(-1.4, Math.min(1.4, this.roll + (e.deltaY > 0 ? 0.08 : -0.08)))
      e.preventDefault()
    }, { passive: false })
    window.addEventListener('keydown', e => { if (e.key === 'Shift') this.shift = true; if (e.key === 'Alt') this.alt = true })
    window.addEventListener('keyup', e => { if (e.key === 'Shift') this.shift = false; if (e.key === 'Alt') this.alt = false })
  }

  // Just hovering is not a hand: only a held button acts as one (unless Hands = Mouse).
  // Camera hands always win when visible.
  active(now: number) { return this.inside && (this.left || this.right) }

  sample(now: number, dt: number, outAspect: number): { hand: Hand; events: GestureEvent[] } | null {
    if (!this.forced && !this.active(now)) return null
    const fist = this.right || this.shift
    const point = !fist && this.alt
    const pinch = !fist && !point && this.left
    const target = fist ? FIST : point ? POINT : pinch ? PINCH : OPEN
    const k = Math.min(1, dt * 18)
    for (let i = 0; i < 21; i++) {
      this.pose[i][0] += (target[i][0] - this.pose[i][0]) * k
      this.pose[i][1] += (target[i][1] - this.pose[i][1]) * k
    }
    // The cursor is the pinch point (between thumb and index tip), so a pinch lands exactly
    // under the cursor. Pointing puts the index tip there; a fist keeps the palm still.
    const mid = (a: [number, number], b: [number, number]): [number, number] => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    const want = fist ? mid(OPEN[4], OPEN[8]) : point ? this.pose[8] : mid(this.pose[4], this.pose[8])
    this.anchor[0] += (want[0] - this.anchor[0]) * k
    this.anchor[1] += (want[1] - this.anchor[1]) * k
    const s = this.size
    const c = Math.cos(this.roll), sn = Math.sin(this.roll)
    const tip = this.anchor
    const lm = new Float32Array(63)
    for (let i = 0; i < 21; i++) {
      const px = this.pose[i][0] - tip[0], py = this.pose[i][1] - tip[1]
      const rx = px * c - py * sn, ry = px * sn + py * c
      lm[i * 3] = this.x + (rx * s) / outAspect
      lm[i * 3 + 1] = this.y + ry * s
      lm[i * 3 + 2] = 0
    }
    const palm = { x: 0, y: 0 }
    for (const i of [0, 5, 9, 13, 17]) { palm.x += lm[i * 3] / 5; palm.y += lm[i * 3 + 1] / 5 }
    if (this.lastPos && dt > 0) {
      const kk = Math.min(1, dt * 12)
      this.vel.x += ((palm.x - this.lastPos.x) / dt - this.vel.x) * kk
      this.vel.y += ((palm.y - this.lastPos.y) / dt - this.vel.y) * kk
    }
    this.lastPos = palm
    const events: GestureEvent[] = []
    const ev = (type: GestureEvent['type']) => events.push({ hand: 0, type, x: this.x, y: this.y })
    if (pinch && !this.prev.left) ev('pinchStart')
    if (!pinch && this.prev.left) ev('pinchEnd')
    if (fist && !this.prev.fist) ev('fist')
    if (!fist && this.prev.fist) ev('open')
    if (point && !this.prev.point) ev('point')
    this.prev = { left: pinch, fist, point }
    const hand: Hand = {
      id: 0, presence: 1, lm, palm,
      index: { x: lm[24], y: lm[25] }, thumb: { x: lm[12], y: lm[13] },
      pinch: pinch ? 1 : 0, pinching: pinch, openness: fist ? 0 : point ? 0.35 : pinch ? 0.6 : 1,
      open: !fist && !point && !pinch, fist, point, roll: this.roll, size: s, vel: { ...this.vel },
    }
    return { hand, events }
  }
}
