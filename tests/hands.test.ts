import { describe, it, expect } from 'vitest'
import { readGesture, GestureLatch } from '../src/input/hands/Gestures'
import { OneEuro } from '../src/input/hands/OneEuro'
import { mapPoint, coverXform } from '../src/input/hands/Mapping'

// Synthetic 21-point hands (wrist→middle MCP = 1 unit, y down) in a square image.
const OPEN: [number, number][] = [
  [0, 0], [-0.3, -0.2], [-0.55, -0.45], [-0.75, -0.65], [-0.92, -0.82],
  [-0.32, -0.95], [-0.38, -1.35], [-0.41, -1.6], [-0.43, -1.82],
  [0, -1], [0, -1.45], [0, -1.72], [0, -1.95],
  [0.28, -0.93], [0.32, -1.33], [0.34, -1.57], [0.36, -1.77],
  [0.52, -0.82], [0.6, -1.1], [0.64, -1.3], [0.67, -1.47],
]
const curl = (m: [number, number]): [number, number][] => [[m[0], m[1] - 0.3], [m[0] * 0.9, m[1] - 0.1], [m[0] * 0.8, m[1] + 0.1]]
const FIST: [number, number][] = [OPEN[0], [-0.3, -0.2], [-0.45, -0.5], [-0.35, -0.75], [-0.12, -0.8],
  OPEN[5], ...curl(OPEN[5]), OPEN[9], ...curl(OPEN[9]), OPEN[13], ...curl(OPEN[13]), OPEN[17], ...curl(OPEN[17])]
const PINCH = OPEN.map((p, i): [number, number] => (i === 4 ? [-0.6, -1.15] : i === 8 ? [-0.62, -1.2] : i === 3 ? [-0.72, -0.85] : i === 7 ? [-0.55, -1.4] : p))
const POINT = FIST.map((p, i): [number, number] => (i >= 5 && i <= 8 ? OPEN[i] : p))

function lm(pose: [number, number][], scale = 0.1, ox = 0.5, oy = 0.7, rot = 0) {
  const a = new Float32Array(63)
  const c = Math.cos(rot), s = Math.sin(rot)
  pose.forEach(([x, y], i) => {
    a[i * 3] = ox + (x * c - y * s) * scale
    a[i * 3 + 1] = oy + (x * s + y * c) * scale
  })
  return a
}

describe('gestures', () => {
  it('classifies open, fist, pinch and point', () => {
    const o = readGesture(lm(OPEN))
    expect(o.openLike).toBe(true)
    expect(o.fistLike).toBe(false)
    expect(o.openness).toBeGreaterThan(0.6)
    const f = readGesture(lm(FIST))
    expect(f.fistLike).toBe(true)
    expect(f.openLike).toBe(false)
    expect(f.openness).toBeLessThan(0.3)
    const p = readGesture(lm(PINCH))
    expect(p.pinchDist).toBeLessThan(0.35)
    expect(p.pinch).toBeGreaterThan(0.8)
    const pt = readGesture(lm(POINT))
    expect(pt.pointLike).toBe(true)
  })

  it('is scale and rotation invariant', () => {
    const small = readGesture(lm(OPEN, 0.05))
    const big = readGesture(lm(OPEN, 0.3, 0.5, 0.8, 0.6))
    expect(small.openLike).toBe(true)
    expect(big.openLike).toBe(true)
    expect(big.roll).toBeCloseTo(0.6, 1)
  })

  it('latch uses hysteresis and debounces', () => {
    const latch = new GestureLatch()
    expect(latch.update(readGesture(lm(PINCH)), 0)).toContain('pinchStart')
    // a slightly opened pinch (between thresholds) keeps pinching
    const half = PINCH.map((p, i): [number, number] => (i === 4 ? [-0.75, -0.82] : p))
    const r = readGesture(lm(half))
    expect(r.pinchDist).toBeGreaterThan(0.35)
    expect(r.pinchDist).toBeLessThan(0.5)
    expect(latch.update(r, 16)).not.toContain('pinchEnd')
    expect(latch.update(readGesture(lm(OPEN)), 32)).toContain('pinchEnd')
    // open needs ~120 ms of stability
    expect(latch.update(readGesture(lm(OPEN)), 60)).not.toContain('open')
    expect(latch.update(readGesture(lm(OPEN)), 200)).toContain('open')
    expect(latch.state).toBe('open')
  })
})

describe('OneEuro', () => {
  it('passes the first sample through and smooths jitter', () => {
    const f = new OneEuro(1, 0.0)
    expect(f.filter(5, 0.016)).toBe(5)
    let out = 0
    for (let i = 0; i < 30; i++) out = f.filter(5 + (i % 2 ? 0.1 : -0.1), 0.016)
    expect(Math.abs(out - 5)).toBeLessThan(0.05)
  })
  it('follows a real move', () => {
    const f = new OneEuro(1, 0.05)
    f.filter(0, 0.016)
    let out = 0
    for (let i = 0; i < 60; i++) out = f.filter(1, 0.016)
    expect(out).toBeGreaterThan(0.95)
  })
})

describe('mapping', () => {
  it('cover transform crops the wider side and round-trips', () => {
    const xf = coverXform(16 / 9, 9 / 16, false)
    expect(xf.sy).toBeCloseTo(1)
    expect(xf.sx).toBeCloseTo((9 / 16) / (16 / 9))
    // the image center maps to the output center
    const [x, y] = mapPoint(0.5, 0.5, 'video', false, xf)
    expect(x).toBeCloseTo(0.5)
    expect(y).toBeCloseTo(0.5)
    // a point at the left edge of the visible crop lands at output x = 0
    const left = 0.5 - xf.sx / 2
    expect(mapPoint(left, 0.3, 'video', false, xf)[0]).toBeCloseTo(0)
  })
  it('mirrors in both modes', () => {
    const xf = coverXform(16 / 9, 9 / 16, true)
    const [x1] = mapPoint(0.5 + xf.sx * -0.25, 0.5, 'video', true, xf)
    expect(x1).toBeCloseTo(0.25)
    expect(mapPoint(0.2, 0.4, 'frame', true, xf)).toEqual([0.8, 0.4])
    expect(mapPoint(0.2, 0.4, 'frame', false, xf)).toEqual([0.2, 0.4])
  })
  it('zoom narrows the visible window', () => {
    const a = coverXform(1, 1, false, 1)
    const b = coverXform(1, 1, false, 2)
    expect(b.sx).toBeCloseTo(a.sx / 2)
    expect(mapPoint(0.5, 0.5, 'video', false, b)).toEqual([0.5, 0.5])
  })
})
