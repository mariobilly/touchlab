import * as THREE from 'three'
import { Sources } from '../input/Sources'
import { HandTracker } from '../input/hands/HandTracker'
import { MouseHands } from '../input/hands/MouseHands'
import { coverXform } from '../input/hands/Mapping'
import { EMPTY_HANDS, type HandsState } from '../input/hands/types'
import { FsPass } from '../gfx/FsPass'
import { makeTarget, clearTarget } from '../gfx/targets'
import { ParamStore } from './Params'
import { ImageStore } from './ImageStore'
import { Recorder } from './Recorder'
import type { FrameCtx, SceneDef, SceneImage, SceneInstance, Shared, SourceFrame } from '../scenes/types'
import type { UvXform } from '../input/hands/Mapping'

export const ASPECTS = {
  '9:16': { w: 1080, h: 1920, label: '9:16 Reel' },
  '4:5': { w: 1080, h: 1350, label: '4:5 Feed' },
  '1:1': { w: 1080, h: 1080, label: '1:1 Square' },
  '16:9': { w: 1920, h: 1080, label: '16:9 Wide' },
} as const
export type AspectId = keyof typeof ASPECTS

const VIEW_KEY = 'touchlab.view.v1'

export interface ViewSettings {
  aspect: AspectId
  renderScale: number
  mirror: boolean
  zoom: number
  panX: number
  panY: number
  handsFrom: 'camera' | 'clip' | 'mouse' | 'off'
  smoothing: number
  fpsCap: number
  crossfade: boolean
  recFps: number
  countdown: boolean
  autoStop: number
  silentAudio: boolean
  delegate: 'CPU' | 'GPU'
  /** Hand skeleton drawn over the output preview (never recorded). */
  overlay: boolean
  /** Separate camera/hands panel next to the output. */
  handsPanel: boolean
  /** Draw the tracked hand skeleton over the camera in the hands panel. */
  panelSkeleton: boolean
  safeArea: boolean
}

const DEFAULT_VIEW: ViewSettings = {
  aspect: '9:16', renderScale: 0.75, mirror: true, zoom: 1, panX: 0, panY: 0, handsFrom: 'camera', smoothing: 0.6,
  fpsCap: 60, crossfade: true, recFps: 30, countdown: false, autoStop: 0, silentAudio: false, delegate: 'GPU', overlay: false, handsPanel: true, panelSkeleton: false, safeArea: false,
}

interface Live { def: SceneDef; inst: SceneInstance; params: ParamStore; target: THREE.WebGLRenderTarget; error: string }

export class Engine {
  readonly canvas: HTMLCanvasElement
  readonly renderer: THREE.WebGLRenderer
  readonly sources: Sources
  readonly tracker = new HandTracker()
  readonly mouse = new MouseHands()
  readonly recorder = new Recorder()
  readonly shared: Shared
  view: ViewSettings
  scenes: SceneDef[] = []
  live: Live | null = null
  private prev: Live | null = null
  private fadeT = 1
  private composite: FsPass
  private copyPass: FsPass
  private maskTex: THREE.DataTexture
  private maskVersion = -1
  private maskOn = false
  private clock = { t: 0, frame: 0 }
  private lastNow = 0
  private lastRender = 0
  private pulses: string[] = []
  hands: HandsState = EMPTY_HANDS
  frozen = false
  fps = 0
  frameMs = 0
  private fpsCount = 0
  private fpsT0 = 0
  readonly uvXform = new THREE.Vector4(1, 1, 0, 0)
  /** Called after every rendered frame (HUD). */
  onFrame: (() => void) | null = null
  /** Called when the active scene changes. */
  onScene: ((def: SceneDef) => void) | null = null
  forcedScale: number | null = null
  /** Hand mapping in use this frame, and the control camera's cover transform (for the hands panel). */
  handMapping: 'video' | 'frame' = 'frame'
  ctrlXf: UvXform = { sx: 1, sy: 1, ox: 0, oy: 0 }
  ctrlMirror = true
  /** Decoded scene images, cached by id so re-loads only decode new uploads. */
  private imageCache = new Map<string, { scene: string; img: SceneImage }>()
  /** Called after a scene's images were (re)loaded, with the count. */
  onImages: ((count: number) => void) | null = null

  constructor(canvas: HTMLCanvasElement, scenes: SceneDef[]) {
    this.canvas = canvas
    this.scenes = scenes
    this.view = { ...DEFAULT_VIEW, ...this.loadView() }
    THREE.ColorManagement.enabled = false
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false })
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace
    this.renderer.toneMapping = THREE.NoToneMapping
    this.renderer.setPixelRatio(1)
    this.renderer.setClearColor(0x000000, 1)
    this.renderer.autoClear = false
    // new source: forget tracked hands and the previous source's person mask
    this.sources = new Sources(() => { this.tracker.reset(); this.tracker.mask = null; this.maskOn = false })

    const noise = new Uint8Array(256 * 256 * 4)
    for (let i = 0; i < noise.length; i++) noise[i] = Math.random() * 256
    const noiseTex = new THREE.DataTexture(noise, 256, 256, THREE.RGBAFormat)
    noiseTex.wrapS = noiseTex.wrapT = THREE.RepeatWrapping
    noiseTex.magFilter = THREE.LinearFilter
    noiseTex.minFilter = THREE.LinearFilter
    noiseTex.needsUpdate = true

    this.copyPass = new FsPass(/* glsl */ `
      precision highp float; varying vec2 vUv; uniform sampler2D tSrc;
      void main() { gl_FragColor = vec4(texture(tSrc, vUv).rgb, 1.0); }`, { tSrc: { value: null } })
    this.composite = new FsPass(/* glsl */ `
      precision highp float; varying vec2 vUv;
      uniform sampler2D tA; uniform sampler2D tB; uniform float uMix;
      void main() {
        vec3 a = texture(tA, vUv).rgb;
        vec3 b = texture(tB, vUv).rgb;
        gl_FragColor = vec4(mix(a, b, uMix), 1.0);
      }`, { tA: { value: null }, tB: { value: null }, uMix: { value: 1 } })
    this.shared = {
      pass: (frag, uniforms, opts) => new FsPass(frag, uniforms, opts),
      copy: (tex, target) => { this.copyPass.uniforms.tSrc.value = tex; this.copyPass.render(this.renderer, target) },
      noiseTex,
    }
    const md = new Uint8Array(4).fill(255)
    this.maskTex = new THREE.DataTexture(md, 1, 1, THREE.RedFormat)
    this.maskTex.magFilter = this.maskTex.minFilter = THREE.LinearFilter
    this.maskTex.needsUpdate = true
    this.applySize()
    this.mouse.attach(canvas)
    this.attachClick(canvas)
    this.tracker.setSmoothing(this.view.smoothing)
  }

  private loadView(): Partial<ViewSettings> {
    try { return JSON.parse(localStorage.getItem(VIEW_KEY) || '{}') } catch { return {} }
  }
  saveView() { try { localStorage.setItem(VIEW_KEY, JSON.stringify(this.view)) } catch {} }

  setView<K extends keyof ViewSettings>(k: K, v: ViewSettings[K]) {
    this.view[k] = v
    if (k === 'aspect' || k === 'renderScale') this.applySize()
    if (k === 'smoothing') this.tracker.setSmoothing(v as number)
    if (k === 'delegate') { this.tracker.hands.stop(); this.tracker.seg.stop() }
    if (k === 'handsFrom') this.tracker.reset()
    this.mouse.forced = this.view.handsFrom === 'mouse'
    this.saveView()
  }

  get outSize() { return ASPECTS[this.view.aspect] }
  get scale() { return this.forcedScale ?? this.view.renderScale }
  get width() { return Math.round(this.outSize.w * this.scale) }
  get height() { return Math.round(this.outSize.h * this.scale) }

  applySize() {
    const w = this.width, h = this.height
    this.renderer.setSize(w, h, false)
    for (const l of [this.live, this.prev]) {
      if (!l) continue
      l.target.setSize(w, h)
      try { l.inst.resize(w, h) } catch (e) { l.error = (e as Error).message }
    }
  }

  setScene(id: string) {
    const def = this.scenes.find(s => s.id === id)
    if (!def || def.id === this.live?.def.id) return
    if (this.prev) this.disposeLive(this.prev)
    this.prev = this.view.crossfade && this.live ? this.live : null
    if (!this.prev && this.live) this.disposeLive(this.live)
    const params = new ParamStore(def)
    const target = makeTarget(this.width, this.height)
    let inst: SceneInstance
    let error = ''
    try {
      inst = def.create({ renderer: this.renderer, width: this.width, height: this.height, shared: this.shared })
    } catch (e) {
      console.error(e)
      error = (e as Error).message
      inst = { resize() {}, update() {}, render() {}, dispose() {} }
    }
    this.live = { def, inst, params, target, error }
    this.fadeT = this.prev ? 0 : 1
    if (def.images) this.reloadImages()
    this.tracker.reset()
    try { localStorage.setItem('touchlab.scene', id) } catch {}
    this.onScene?.(def)
  }

  private disposeLive(l: Live) {
    try { l.inst.dispose() } catch (e) { console.warn(e) }
    l.target.dispose()
  }

  pulse(id = 'pulse') { this.pulses.push(id) }

  start() {
    this.fpsT0 = this.lastNow = performance.now()
    const loop = (now: number) => {
      requestAnimationFrame(loop)
      this.tick(now)
    }
    requestAnimationFrame(loop)
  }

  private sourceFrame(): SourceFrame {
    const s = this.sources
    const mirror = s.kind === 'webcam' && this.view.mirror
    const xf = coverXform(s.width / Math.max(1, s.height), this.outSize.w / this.outSize.h, mirror, this.view.zoom, this.view.panX, this.view.panY)
    this.uvXform.set(xf.sx, xf.sy, xf.ox, xf.oy)
    return {
      tex: s.tex, width: s.width, height: s.height, aspect: s.width / Math.max(1, s.height), uvXform: this.uvXform,
      mask: this.maskOn ? this.maskTex : null, frameId: s.frameId, moving: s.moving, element: s.element, kind: s.kind,
    }
  }

  private updateVision(now: number, dt: number) {
    const live = this.live!
    const v = this.view
    const wantHands = live.def.needs.hands || v.overlay || v.handsPanel
    const s = this.sources
    // hands
    const camOn = v.handsFrom === 'camera' && !!s.controlVideo()
    const clipVideo = v.handsFrom === 'clip' ? s.visualVideo() : null
    const handSrc = camOn ? s.controlVideo() : clipVideo
    if (wantHands && handSrc && v.handsFrom !== 'off' && v.handsFrom !== 'mouse') {
      if (this.tracker.hands.status === 'off') this.tracker.hands.start(v.delegate)
      const key = camOn ? s.camFrame : s.frameId
      this.tracker.hands.pump(handSrc, key)
    }
    // segmentation of the visual source
    const wantMask = !!live.def.needs.segmentation && live.params.raw['personMask'] === true
    this.maskOn = false
    if (wantMask) {
      if (this.tracker.seg.status === 'off') this.tracker.seg.start(v.delegate)
      // stills are segmented once (their frameId only changes when a new image loads)
      const el = s.kind === 'webcam' ? s.controlVideo() : s.kind === 'video' ? s.visualVideo() : s.kind === 'demo' ? s.demo.canvas : s.element instanceof HTMLImageElement ? s.element : null
      if (el) this.tracker.seg.pump(el, s.frameId, 512)
      const m = this.tracker.mask
      if (m && m.version !== this.maskVersion) {
        this.maskVersion = m.version
        const bytes = new Uint8Array(m.w * m.h)
        for (let y = 0; y < m.h; y++) {
          const src = (m.h - 1 - y) * m.w, dst = y * m.w
          for (let x = 0; x < m.w; x++) bytes[dst + x] = Math.max(0, Math.min(255, m.data[src + x] * 255))
        }
        if (this.maskTex.image.width !== m.w || this.maskTex.image.height !== m.h) {
          this.maskTex.dispose()
          this.maskTex = new THREE.DataTexture(bytes, m.w, m.h, THREE.RedFormat)
          this.maskTex.magFilter = this.maskTex.minFilter = THREE.LinearFilter
        } else {
          this.maskTex.image.data = bytes
        }
        this.maskTex.needsUpdate = true
      }
      this.maskOn = !!m
    }
    // control mapping uses the control image's own cover transform
    const ctrlEl = camOn ? s.camVideo : clipVideo
    const ca = ctrlEl ? ctrlEl.videoWidth / Math.max(1, ctrlEl.videoHeight) : 16 / 9
    const mirror = camOn ? v.mirror : false
    const xf = coverXform(ca, this.outSize.w / this.outSize.h, mirror, v.zoom, v.panX, v.panY)
    const hm = live.def.needs.handMapping
    this.handMapping = typeof hm === 'function' ? hm(live.params) : hm
    this.ctrlXf = xf
    this.ctrlMirror = mirror
    this.hands = this.tracker.sample(now, dt, this.handMapping, mirror, xf, this.outSize.w / this.outSize.h, v.handsFrom === 'off' ? null : this.mouse, !!handSrc)
  }

  private tick(now: number) {
    const v = this.view
    if (v.fpsCap > 0 && !this.recorder.state.startsWith('rec') && now - this.lastRender < 1000 / v.fpsCap - 2) return
    const dt = Math.min(0.1, Math.max(0.001, (now - this.lastNow) / 1000))
    this.lastNow = now
    this.lastRender = now
    const live = this.live
    if (!live) return
    const t0 = performance.now()
    if (!this.frozen) this.clock.t += dt
    this.clock.frame++
    this.sources.update(this.clock.t, this.frozen)
    this.updateVision(now, dt)
    const source = this.sourceFrame()
    const pulses = this.pulses.splice(0)
    const run = (l: Live, isPrev: boolean) => {
      l.params.step(dt)
      const f: FrameCtx = {
        renderer: this.renderer, width: this.width, height: this.height, aspect: this.outSize.w / this.outSize.h, scale: this.scale,
        time: { t: this.clock.t, dt: this.frozen ? 0 : dt, frame: this.clock.frame }, source, hands: isPrev ? EMPTY_HANDS : this.hands,
        p: l.params, pulses: isPrev ? [] : pulses, shared: this.shared, frozen: this.frozen, recording: this.recorder.state === 'recording',
      }
      if (l.error) return
      try {
        l.inst.update(f)
        clearTarget(this.renderer, l.target, 0x000000)
        l.inst.render(f, l.target)
      } catch (e) {
        console.error(e)
        l.error = (e as Error).message
      }
    }
    run(live, false)
    if (this.prev) {
      run(this.prev, true)
      this.fadeT += dt / 0.4
      if (this.fadeT >= 1) { this.disposeLive(this.prev); this.prev = null }
    }
    // composite to screen
    this.composite.uniforms.tA.value = (this.prev ?? live).target.texture
    this.composite.uniforms.tB.value = live.target.texture
    this.composite.uniforms.uMix.value = this.prev ? Math.min(1, this.fadeT) : 1
    clearTarget(this.renderer, null, 0x000000)
    this.composite.render(this.renderer, null)
    this.frameMs = this.frameMs * 0.9 + (performance.now() - t0) * 0.1
    this.fpsCount++
    if (now - this.fpsT0 > 500) { this.fps = this.fpsCount * 1000 / (now - this.fpsT0); this.fpsCount = 0; this.fpsT0 = now }
    this.onFrame?.()
  }

  /** Loads the active scene's uploaded images and hands them to the scene. */
  async reloadImages() {
    const live = this.live
    if (!live?.def.images) return
    const recs = await ImageStore.list(live.def.id)
    recs.forEach(r => URL.revokeObjectURL(r.url))
    const ids = new Set(recs.map(r => r.id))
    const missing = recs.filter(r => !this.imageCache.has(r.id)).map(r => r.id)
    if (missing.length) {
      for (const img of await ImageStore.load(live.def.id)) {
        if (!this.imageCache.has(img.id)) this.imageCache.set(img.id, { scene: live.def.id, img })
        else img.bitmap.close()
      }
    }
    // images deleted from this scene: free their bitmaps
    for (const [id, e] of this.imageCache) if (e.scene === live.def.id && !ids.has(id)) { e.img.bitmap.close(); this.imageCache.delete(id) }
    const list = recs.map(r => this.imageCache.get(r.id)?.img).filter((i): i is SceneImage => !!i)
    if (this.live !== live) return
    try { live.inst.setImages?.(list) } catch (e) { console.error(e); live.error = (e as Error).message }
    this.onImages?.(list.length)
    window.dispatchEvent(new CustomEvent('touchlab:images'))
  }

  /** A short click without dragging on the output goes to the scene's click handler. */
  private attachClick(canvas: HTMLCanvasElement) {
    let down: { x: number; y: number; t: number } | null = null
    canvas.addEventListener('pointerdown', e => { if (e.button === 0) down = { x: e.clientX, y: e.clientY, t: performance.now() } })
    canvas.addEventListener('pointerup', e => {
      if (e.button !== 0 || !down) return
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y)
      const quick = performance.now() - down.t < 350
      down = null
      if (moved > 6 || !quick) return
      const r = canvas.getBoundingClientRect()
      try { this.live?.inst.click?.((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height) } catch (err) { console.error(err) }
    })
  }

  get sceneError() { return this.live?.error ?? '' }
}
