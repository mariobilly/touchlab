import { OneEuro } from './OneEuro'
import { readGesture, GestureLatch } from './Gestures'
import { mapPoint, type UvXform } from './Mapping'
import type { Hand, HandsState, GestureEvent } from './types'
import { LM } from './types'
import type { MouseHands } from './MouseHands'

type Delegate = 'CPU' | 'GPU'

/** Wraps one vision worker (hands or segmentation) and feeds it frames without ever queueing. */
class VisionWorker {
  status: 'off' | 'loading' | 'ready' | 'error' = 'off'
  message = ''
  delegate: Delegate = 'CPU'
  ms = 0
  rate = 0
  private worker: Worker | null = null
  private busy = false
  private lastSent = -1
  private id = 0
  private count = 0
  private rateT0 = performance.now()
  onResult: ((data: any) => void) | null = null

  constructor(private task: 'hands' | 'segment') {}

  start(delegate: Delegate) {
    if (this.worker) return
    this.status = 'loading'
    this.worker = new Worker(new URL('./vision.worker.ts', import.meta.url), { type: 'module' })
    this.worker.onmessage = (e) => this.handle(e.data)
    this.worker.onerror = (e) => { this.status = 'error'; this.message = e.message || 'Worker failed' }
    const base = new URL('./', location.href).href
    this.worker.postMessage({ type: 'init', task: this.task, base, delegate })
  }

  stop() {
    this.worker?.terminate()
    this.worker = null
    this.status = 'off'
    this.busy = false
  }

  private handle(d: any) {
    if (d.type === 'ready') { this.status = 'ready'; this.delegate = d.delegate; return }
    if (d.type === 'error') { this.status = 'error'; this.message = d.message; this.busy = false; return }
    this.busy = false
    if (typeof d.ms === 'number') this.ms = this.ms * 0.8 + d.ms * 0.2
    this.count++
    const now = performance.now()
    if (now - this.rateT0 > 1000) { this.rate = this.count * 1000 / (now - this.rateT0); this.count = 0; this.rateT0 = now }
    if (d.type !== 'skip') this.onResult?.(d)
  }

  /** Sends the newest frame if the worker is idle and the frame is new. */
  pump(src: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement, frameKey: number, maxW = 640) {
    if (!this.worker || this.status !== 'ready' || this.busy || frameKey === this.lastSent) return
    const sw = src instanceof HTMLVideoElement ? src.videoWidth : src instanceof HTMLImageElement ? src.naturalWidth : src.width
    const sh = src instanceof HTMLVideoElement ? src.videoHeight : src instanceof HTMLImageElement ? src.naturalHeight : src.height
    if (!sw || !sh) return
    this.busy = true
    this.lastSent = frameKey
    const scale = Math.min(1, maxW / sw)
    const w = Math.max(2, Math.round(sw * scale)), h = Math.max(2, Math.round(sh * scale))
    createImageBitmap(src, { resizeWidth: w, resizeHeight: h, resizeQuality: 'low' }).then(bmp => {
      if (!this.worker) { bmp.close(); this.busy = false; return }
      this.worker.postMessage({ type: 'frame', id: ++this.id, bitmap: bmp, ts: performance.now() }, [bmp])
    }).catch(() => { this.busy = false })
  }
}

interface Slot {
  id: number
  raw: Float32Array // smoothed landmarks in image space
  filters: OneEuro[]
  latch: GestureLatch
  lastSeen: number
  lastResultT: number
  alive: boolean
  palm: { x: number; y: number } | null
  vel: { x: number; y: number }
}

/**
 * Turns raw MediaPipe results into a stable two-hand state: slot identity by nearest wrist,
 * One Euro smoothing, gesture hysteresis, short fade-out after loss, and mapping into the
 * active scene's output space. Falls back to the mouse when no camera hand is visible.
 */
export class HandTracker {
  readonly hands = new VisionWorker('hands')
  readonly seg = new VisionWorker('segment')
  delegate: Delegate = 'CPU'
  smoothing = 1.0
  /** Image aspect (w/h) of the last processed frame. */
  private imgAspect = 16 / 9
  private slots: Slot[] = [0, 1].map(id => ({
    id, raw: new Float32Array(63), filters: Array.from({ length: 63 }, () => new OneEuro(1.0, 0.02)),
    latch: new GestureLatch(), lastSeen: 0, lastResultT: 0, alive: false, palm: null, vel: { x: 0, y: 0 },
  }))
  private pendingEvents: { slot: number; type: GestureEvent['type'] }[] = []
  lastDetections = 0
  /** Camera hands in camera-image space (x right on the unmirrored frame, y down), for the hands panel. */
  camHands: { id: number; lm: Float32Array; presence: number; gesture: string }[] = []
  mask: { data: Float32Array; w: number; h: number; version: number } | null = null

  constructor() {
    this.hands.onResult = (d) => this.onHands(d)
    this.seg.onResult = (d) => {
      if (!d.mask) return
      this.mask = { data: d.mask, w: d.w, h: d.h, version: (this.mask?.version ?? 0) + 1 }
    }
  }

  setSmoothing(v: number) {
    this.smoothing = v
    const minCutoff = 0.4 + (1 - v) * 3
    for (const s of this.slots) for (const f of s.filters) { f.minCutoff = minCutoff; f.beta = 0.01 + (1 - v) * 0.05 }
  }

  private onHands(d: { hands: { lm: Float32Array }[]; w: number; h: number }) {
    const now = performance.now()
    this.imgAspect = d.w / d.h
    this.lastDetections = d.hands.length
    const dets = d.hands.map(h => h.lm)
    const used = new Set<number>()
    // match each live slot to its nearest detection by wrist position
    const live = this.slots.filter(s => s.alive)
    const pairs: { s: Slot; i: number; dist: number }[] = []
    for (const s of live) dets.forEach((lm, i) => pairs.push({ s, i, dist: Math.hypot(lm[0] - s.raw[0], lm[1] - s.raw[1]) }))
    pairs.sort((a, b) => a.dist - b.dist)
    const matched = new Set<Slot>()
    for (const p of pairs) {
      if (matched.has(p.s) || used.has(p.i) || p.dist > 0.35) continue
      matched.add(p.s); used.add(p.i)
      this.feed(p.s, dets[p.i], now)
    }
    dets.forEach((lm, i) => {
      if (used.has(i)) return
      const free = this.slots.find(s => !s.alive && !matched.has(s)) ?? this.slots.find(s => !matched.has(s))
      if (!free) return
      matched.add(free)
      free.alive = true
      free.filters.forEach(f => f.reset())
      free.latch.reset()
      free.palm = null
      this.feed(free, lm, now)
    })
  }

  private feed(s: Slot, lm: Float32Array, now: number) {
    const dt = s.lastResultT ? Math.min(0.2, (now - s.lastResultT) / 1000) : 0
    for (let i = 0; i < 63; i++) s.raw[i] = s.filters[i].filter(lm[i], dt)
    s.lastResultT = now
    s.lastSeen = now
    const r = readGesture(s.raw, this.imgAspect)
    for (const type of s.latch.update(r, now)) this.pendingEvents.push({ slot: s.id, type })
  }

  /**
   * Builds the hand state for this frame.
   * @param mapping scene mapping mode; `xf` the renderer's cover transform for the control image
   *   (only used in 'video' mode); `outAspect` output w/h.
   */
  sample(now: number, dt: number, mapping: 'video' | 'frame', mirror: boolean, xf: UvXform, outAspect: number, mouse: MouseHands | null, cameraOn: boolean): HandsState {
    const hands: Hand[] = []
    const events: GestureEvent[] = []
    const camHands: HandTracker['camHands'] = []
    this.camHands = camHands
    if (cameraOn) {
      for (const s of this.slots) {
        if (!s.alive) continue
        const age = now - s.lastSeen
        if (age > 150) { s.alive = false; s.latch.reset(); s.palm = null; continue }
        const presence = age < 60 ? 1 : 1 - (age - 60) / 90
        const h = this.toHand(s, presence, dt, mapping, mirror, xf, outAspect)
        hands.push(h)
        camHands.push({ id: s.id, lm: s.raw, presence, gesture: h.pinching ? 'PINCH' : h.fist ? 'FIST' : h.point ? 'POINT' : h.open ? 'OPEN' : '' })
      }
      for (const e of this.pendingEvents) {
        const h = hands.find(h => h.id === e.slot)
        if (h) events.push({ hand: e.slot, type: e.type, x: h.index.x, y: h.index.y })
      }
    }
    this.pendingEvents.length = 0
    let mode: HandsState['mode'] = cameraOn ? 'camera' : 'none'
    if (mouse && (mouse.forced || (hands.length === 0 && mouse.active(now)))) {
      const m = mouse.sample(now, dt, outAspect)
      if (m) {
        hands.length = 0
        hands.push(m.hand)
        events.length = 0
        events.push(...m.events)
        mode = 'mouse'
      }
    }
    hands.sort((a, b) => a.palm.x - b.palm.x)
    const twoDist = hands.length >= 2 ? Math.hypot((hands[0].palm.x - hands[1].palm.x) * outAspect, hands[0].palm.y - hands[1].palm.y) : 0
    return { hands, events, mode, twoDist }
  }

  private toHand(s: Slot, presence: number, dt: number, mapping: 'video' | 'frame', mirror: boolean, xf: UvXform, outAspect: number): Hand {
    const lm = new Float32Array(63)
    for (let i = 0; i < 21; i++) {
      const [x, y] = mapPoint(s.raw[i * 3], s.raw[i * 3 + 1], mapping, mirror, xf)
      lm[i * 3] = x; lm[i * 3 + 1] = y; lm[i * 3 + 2] = s.raw[i * 3 + 2]
    }
    const r = readGesture(s.raw, this.imgAspect)
    const pt = (i: number) => ({ x: lm[i * 3], y: lm[i * 3 + 1] })
    const palmIdx = [LM.WRIST, LM.INDEX_MCP, LM.MIDDLE_MCP, LM.RING_MCP, LM.PINKY_MCP]
    const palm = { x: 0, y: 0 }
    for (const i of palmIdx) { palm.x += lm[i * 3] / 5; palm.y += lm[i * 3 + 1] / 5 }
    if (s.palm && dt > 0) {
      const k = Math.min(1, dt * 12)
      s.vel.x += (((palm.x - s.palm.x) / dt) - s.vel.x) * k
      s.vel.y += (((palm.y - s.palm.y) / dt) - s.vel.y) * k
    }
    s.palm = palm
    // hand size in output-height units
    const sizeImg = r.scale // in image-height units (x scaled by aspect)
    const size = mapping === 'video' ? sizeImg / Math.abs(xf.sy) : sizeImg
    void outAspect
    return {
      id: s.id, presence, lm, palm, index: pt(LM.INDEX_TIP), thumb: pt(LM.THUMB_TIP),
      pinch: r.pinch, pinching: s.latch.pinching, openness: r.openness,
      open: s.latch.state === 'open', fist: s.latch.state === 'fist', point: s.latch.state === 'point',
      roll: mirror ? -r.roll : r.roll, size, vel: { ...s.vel },
    }
  }

  reset() {
    for (const s of this.slots) { s.alive = false; s.latch.reset(); s.palm = null }
    this.pendingEvents.length = 0
  }
}
