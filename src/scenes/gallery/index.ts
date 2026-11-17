import * as THREE from 'three'
import { FsPass } from '../../gfx/FsPass'
import { makeTarget } from '../../gfx/targets'
import type { SceneDef, SceneInstance, FrameCtx, SceneCreateCtx, SceneImage, Params } from '../types'
import type { Hand } from '../../input/hands/types'
import { Atlas, SLOTS } from './atlas'
import { POSTERS, POSTER_NAMES, drawPoster, mulberry32 } from './posters'

// Interactive photo gallery: up to 120 cards (one InstancedMesh, images in one atlas) flowing
// through a diagonal ribbon, helix, cloud, wall or stack. The user's uploaded images replace
// the built-in posters. Hands scroll, orbit, zoom and drag cards; a click or pinch-tap on a card
// flies it forward to fill the frame (prev / next / close) over a dimmed, blurred gallery.

const MAX = 120
const BUILTIN = POSTERS.length
const MAX_GRABS = 16
const LAYOUTS = ['Ribbon', 'Helix', 'Cloud', 'Wall', 'Stack']
const FOV = 40
const BASE_DIST = 6
const TAU = Math.PI * 2
const HOLD_TO_DRAG = 0.25

const VERT = /* glsl */ `
attribute vec2 aSize;
attribute vec4 aRect;
attribute vec4 aFx;
uniform float uPad;
uniform vec2 uShadowOff;
varying vec2 vLocal;
varying vec2 vSize;
varying vec4 vRect;
varying vec4 vFx;
varying float vDepth;
void main() {
  vec2 full = aSize + vec2(uPad * 2.0) + abs(uShadowOff);
  vec2 local = position.xy * full + uShadowOff * 0.5;
  vLocal = local;
  vSize = aSize;
  vRect = aRect;
  vFx = aFx;
  vec4 mv = modelViewMatrix * instanceMatrix * vec4(local, 0.0, 1.0);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`

const FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tAtlas;
uniform float uRadius, uBorder, uShadow, uBlur, uFogNear, uFogRange, uFogAmt;
uniform vec2 uShadowOff;
uniform vec3 uFogColor, uBorderColor, uHiColor;
varying vec2 vLocal;
varying vec2 vSize;
varying vec4 vRect;
varying vec4 vFx;
varying float vDepth;
float sdRoundBox(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
void main() {
  float m = min(vSize.x, vSize.y);
  float r = min(uRadius * m, 0.5 * m);
  float d = sdRoundBox(vLocal, vSize * 0.5, r);
  float aa = max(fwidth(d), 1e-5);
  float a = 1.0 - smoothstep(-aa, aa, d);
  float ds = sdRoundBox(vLocal - uShadowOff, vSize * 0.5, r);
  float sa = uShadow * (1.0 - smoothstep(-uBlur, uBlur, ds)) * 0.42;
  vec2 uv = vLocal / vSize + 0.5;
  vec2 tuv = vec2(mix(vRect.x, vRect.z, uv.x), mix(vRect.y, vRect.w, 1.0 - uv.y));
  vec3 img = texture(tAtlas, tuv).rgb;
  float bw = uBorder * m + vFx.x * 0.012 * m;
  float inner = 1.0 - smoothstep(-bw - aa, -bw + aa, d);
  vec3 bc = mix(uBorderColor, uHiColor, vFx.x);
  vec3 col = mix(bc, img, bw > 0.0 ? inner : 1.0);
  col += vFx.x * 0.06;
  col = mix(col, vec3(1.0), vFx.y);
  float fog = clamp((vDepth - uFogNear) / uFogRange, 0.0, 1.0) * uFogAmt;
  col = mix(col, uFogColor, fog);
  sa *= 1.0 - fog;
  float outA = a + sa * (1.0 - a);
  if (outA < 0.003) discard;
  vec3 outC = col * a / max(outA, 1e-4);
  gl_FragColor = vec4(outC, outA * vFx.z);
}`

const BG_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform vec3 uBg;
uniform vec2 uRes;
uniform float uDots, uDotStep, uDotR, uVig;
void main() {
  vec2 px = vUv * uRes;
  vec3 col = uBg;
  float l = dot(uBg, vec3(0.299, 0.587, 0.114));
  vec3 dotCol = l > 0.5 ? uBg * 0.6 : uBg + vec3(0.1);
  vec2 g = mod(px - uRes * 0.5, uDotStep) - uDotStep * 0.5;
  float dotA = (1.0 - smoothstep(uDotR - 0.8, uDotR + 0.8, length(g))) * uDots;
  col = mix(col, dotCol, dotA);
  vec2 q = vUv - 0.5;
  col *= 1.0 - uVig * dot(q, q) * 1.4;
  gl_FragColor = vec4(col, 1.0);
}`

// Full-frame viewer: one image as a rotated rounded rect in pixel space (y down), with its own
// drop shadow. The texture has flipY off, so image v grows downward like the pixels.
const VIEW_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tImg;
uniform vec2 uRes, uCenter, uHalf, uShadowOff;
uniform vec4 uUvRect;
uniform float uRot, uRadius, uBorder, uShadow, uShadowBlur, uAlpha;
uniform vec3 uBorderColor;
float sdRoundBox(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
void main() {
  vec2 px = vec2(vUv.x, 1.0 - vUv.y) * uRes;
  vec2 d = px - uCenter;
  float c = cos(uRot), s = sin(uRot);
  vec2 l = vec2(c * d.x + s * d.y, -s * d.x + c * d.y);
  float r = min(uRadius, min(uHalf.x, uHalf.y));
  float sd = sdRoundBox(l, uHalf, r);
  float a = 1.0 - smoothstep(-0.75, 0.75, sd);
  float sh = uShadow * (1.0 - smoothstep(-uShadowBlur, uShadowBlur, sdRoundBox(l - uShadowOff, uHalf, r))) * 0.55;
  float outA = a + sh * (1.0 - a);
  if (outA * uAlpha < 0.002) discard;
  vec2 luv = clamp(l / (uHalf * 2.0) + 0.5, 0.0, 1.0);
  vec3 img = texture(tImg, mix(uUvRect.xy, uUvRect.zw, luv)).rgb;
  float inner = 1.0 - smoothstep(-uBorder - 0.75, -uBorder + 0.75, sd);
  vec3 col = uBorder > 0.3 ? mix(uBorderColor, img, inner) : img;
  gl_FragColor = vec4(col * a / max(outA, 1e-4), outA * uAlpha);
}`

const BLUR_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tSrc; uniform vec2 uDir;
void main() {
  vec3 c = texture(tSrc, vUv).rgb * 0.227027;
  c += texture(tSrc, vUv + uDir * 1.3846).rgb * 0.316216;
  c += texture(tSrc, vUv - uDir * 1.3846).rgb * 0.316216;
  c += texture(tSrc, vUv + uDir * 3.2307).rgb * 0.070270;
  c += texture(tSrc, vUv - uDir * 3.2307).rgb * 0.070270;
  gl_FragColor = vec4(c, 1.0);
}`

const BACKDROP_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tSharp; uniform sampler2D tBlur;
uniform float uBlur, uDim;
void main() {
  vec3 c = mix(texture(tSharp, vUv).rgb, texture(tBlur, vUv).rgb, uBlur);
  vec2 q = vUv - 0.5;
  c *= 1.0 - uDim * (0.82 + dot(q, q) * 0.7);
  gl_FragColor = vec4(c, 1.0);
}`

const CAPTION_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tCap; uniform vec2 uRes; uniform vec4 uRect; uniform float uAlpha;
void main() {
  vec2 px = vec2(vUv.x, 1.0 - vUv.y) * uRes;
  vec2 uv = (px - uRect.xy) / uRect.zw;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) discard;
  vec4 t = texture(tCap, uv);
  gl_FragColor = vec4(t.rgb, t.a * uAlpha);
}`

interface Card {
  img: number
  u: number; w: number; d: number; tilt: number; tiltY: number
  dir: THREE.Vector3; cloud: THREE.Vector3
  pos: THREE.Vector3; quat: THREE.Quaternion; scale: number
  tgt: THREE.Vector3; tq: THREE.Quaternion
  flash: number; hi: number; hiT: number; delayUntil: number; lastU: number
  depth: number; sx: number; sy: number; ss: number
  born: boolean
}

interface HandState {
  pinchT: number; palmX: number; palmY: number; moved: number
  cand: number; grabbed: number; offX: number; offY: number; dollied: boolean
}

interface Upload { id: string; name: string; slot: number; bitmap: ImageBitmap; w: number; h: number }
interface Grab { slot: number; name: string; canvas: HTMLCanvasElement }
interface Rect { cx: number; cy: number; hw: number; hh: number; rot: number; uv: [number, number, number, number]; radius: number; border: number; shadow: number }

const smooth = (e0: number, e1: number, x: number) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t) }
const ease = (t: number) => { const x = Math.min(1, Math.max(0, t)); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2 }
const fract = (x: number) => x - Math.floor(x)
const gauss = (r: () => number) => (r() + r() + r() - 1.5) / 1.5
const lerp = (a: number, b: number, k: number) => a + (b - a) * k
const clampAspect = (a: number) => Math.min(2, Math.max(0.5, a))
/** uv window that cover-crops an image of aspect `img` to aspect `to`. */
function coverUV(img: number, to: number): [number, number, number, number] {
  if (img > to) { const w = to / img; return [(1 - w) / 2, 0, (1 + w) / 2, 1] }
  const h = img / to
  return [0, (1 - h) / 2, 1, (1 + h) / 2]
}
const stripExt = (n: string) => n.replace(/\.[a-z0-9]{2,5}$/i, '')

function create(ctx: SceneCreateCtx): SceneInstance {
  const renderer = ctx.renderer
  const atlas = new Atlas(renderer)
  for (let i = 0; i < BUILTIN; i++) atlas.put(i, POSTERS[i].aspect, (c, w, h) => drawPoster(i, c, w, h))
  const freeSlots: number[] = []
  for (let s = SLOTS - 1; s >= BUILTIN; s--) freeSlots.push(s)
  let uploads: Upload[] = []
  const grabs: Grab[] = []
  let grabCount = 0

  // ---------- GPU objects ----------
  const geo = new THREE.BufferGeometry()
  const plane = new THREE.PlaneGeometry(1, 1)
  geo.index = plane.index
  geo.setAttribute('position', plane.getAttribute('position'))
  geo.setAttribute('uv', plane.getAttribute('uv'))
  const aSize = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 2), 2).setUsage(THREE.DynamicDrawUsage)
  const aRect = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4).setUsage(THREE.DynamicDrawUsage)
  const aFx = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4).setUsage(THREE.DynamicDrawUsage)
  geo.setAttribute('aSize', aSize)
  geo.setAttribute('aRect', aRect)
  geo.setAttribute('aFx', aFx)
  const uniforms: Record<string, THREE.IUniform> = {
    tAtlas: { value: atlas.tex }, uPad: { value: 0.05 }, uShadowOff: { value: new THREE.Vector2(0.02, -0.03) },
    uRadius: { value: 0.05 }, uBorder: { value: 0.02 }, uShadow: { value: 0.5 }, uBlur: { value: 0.04 },
    uFogNear: { value: 5 }, uFogRange: { value: 6 }, uFogAmt: { value: 0.4 },
    uFogColor: { value: new THREE.Color() }, uBorderColor: { value: new THREE.Color(1, 1, 1) }, uHiColor: { value: new THREE.Color('#ff3df2') },
  }
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, uniforms,
    transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
  })
  const mesh = new THREE.InstancedMesh(geo, mat, MAX)
  mesh.frustumCulled = false
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  const scene = new THREE.Scene()
  scene.add(mesh)
  const cam = new THREE.PerspectiveCamera(FOV, ctx.width / ctx.height, 0.05, 100)

  const bg = new FsPass(BG_FRAG, {
    uBg: { value: new THREE.Color() }, uRes: { value: new THREE.Vector2(ctx.width, ctx.height) },
    uDots: { value: 0 }, uDotStep: { value: 26 }, uDotR: { value: 1.6 }, uVig: { value: 0.4 },
  })
  const flashPass = new FsPass(/* glsl */ `
    precision highp float; varying vec2 vUv; uniform float uA;
    void main() { gl_FragColor = vec4(vec3(1.0), uA); }`, { uA: { value: 0 } }, { transparent: true, blending: THREE.AdditiveBlending })
  const viewPass = new FsPass(VIEW_FRAG, {
    tImg: { value: null }, uRes: { value: new THREE.Vector2(ctx.width, ctx.height) }, uCenter: { value: new THREE.Vector2() },
    uHalf: { value: new THREE.Vector2(1, 1) }, uShadowOff: { value: new THREE.Vector2() }, uUvRect: { value: new THREE.Vector4(0, 0, 1, 1) },
    uRot: { value: 0 }, uRadius: { value: 0 }, uBorder: { value: 0 }, uShadow: { value: 0 }, uShadowBlur: { value: 20 }, uAlpha: { value: 1 },
    uBorderColor: { value: new THREE.Color(1, 1, 1) },
  }, { transparent: true, blending: THREE.NormalBlending })
  const blurPass = new FsPass(BLUR_FRAG, { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } })
  const backdropPass = new FsPass(BACKDROP_FRAG, { tSharp: { value: null }, tBlur: { value: null }, uBlur: { value: 0 }, uDim: { value: 0 } })
  const captionPass = new FsPass(CAPTION_FRAG, {
    tCap: { value: null }, uRes: { value: new THREE.Vector2(ctx.width, ctx.height) }, uRect: { value: new THREE.Vector4() }, uAlpha: { value: 0 },
  }, { transparent: true, blending: THREE.NormalBlending })
  let galRT = makeTarget(ctx.width, ctx.height)
  let blurA = makeTarget(ctx.width / 4, ctx.height / 4)
  let blurB = makeTarget(ctx.width / 4, ctx.height / 4)

  // ---------- cards ----------
  let rng = mulberry32(42)
  const cards: Card[] = []
  const seedCard = (c: Card, r: () => number, i: number) => {
    c.u = (i + r() * 0.85) / MAX
    c.w = gauss(r)
    c.d = gauss(r)
    c.tilt = r() * 2 - 1
    c.tiltY = r() * 2 - 1
    c.dir.set(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1).normalize()
    const rr = Math.cbrt(0.15 + r() * 0.85)
    c.cloud.set(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1).normalize().multiplyScalar(rr)
  }
  for (let i = 0; i < MAX; i++) {
    const c: Card = {
      img: i % BUILTIN, u: 0, w: 0, d: 0, tilt: 0, tiltY: 0, dir: new THREE.Vector3(), cloud: new THREE.Vector3(),
      pos: new THREE.Vector3(), quat: new THREE.Quaternion(), scale: 0, tgt: new THREE.Vector3(), tq: new THREE.Quaternion(),
      flash: 0, hi: 0, hiT: 0, delayUntil: 0, lastU: 0, depth: 0, sx: 0, sy: 0, ss: 0, born: false,
    }
    seedCard(c, rng, i)
    cards.push(c)
  }

  /** Images the gallery shows, in order: the user's uploads (or the built-ins), then frame grabs. */
  const rotation = () => [...(uploads.length ? uploads.map(u => u.slot) : [...Array(BUILTIN).keys()]), ...grabs.map(g => g.slot)]
  let rotationLen = BUILTIN
  const assignImages = (flashNew: Set<number> | null) => {
    const rot = rotation()
    rotationLen = rot.length
    // every run of `rot.length` consecutive cards shows each image once, in a fresh random
    // order per run (so "Repeat to fill" off still shows every image exactly once)
    let perm: number[] = []
    for (let ci = 0; ci < MAX; ci++) {
      if (ci % rot.length === 0) perm = [...rot].sort(() => rng() - 0.5)
      const img = perm[ci % rot.length]
      if (flashNew?.has(img) && cards[ci].img !== img) cards[ci].flash = 1
      cards[ci].img = img
    }
  }
  assignImages(null)

  const allocSlot = () => {
    if (!freeSlots.length) {
      // out of slots: recycle the oldest frame grab
      const old = grabs.shift()
      if (old) { atlas.free(old.slot); freeSlots.push(old.slot); dropTex(old.slot) }
    }
    return freeSlots.pop() ?? BUILTIN
  }
  const releaseSlot = (slot: number) => { atlas.free(slot); if (!freeSlots.includes(slot)) freeSlots.push(slot); dropTex(slot) }

  // ---------- full-resolution textures for the viewer ----------
  const texCache = new Map<number, { tex: THREE.Texture; used: number }>()
  function dropTex(slot: number) { const e = texCache.get(slot); if (e) { e.tex.dispose(); texCache.delete(slot) } }
  function imageInfo(slot: number): { aspect: number; name: string } {
    const up = uploads.find(u => u.slot === slot)
    if (up) return { aspect: up.w / up.h, name: stripExt(up.name) }
    const g = grabs.find(g => g.slot === slot)
    if (g) return { aspect: g.canvas.width / g.canvas.height, name: g.name }
    if (slot < BUILTIN) return { aspect: atlas.slots[slot]?.aspect ?? POSTERS[slot].aspect, name: POSTER_NAMES[slot] ?? 'Poster' }
    return { aspect: atlas.slots[slot]?.aspect ?? 0.75, name: '' }
  }
  function viewTex(slot: number): THREE.Texture {
    const hit = texCache.get(slot)
    if (hit) { hit.used = performance.now(); return hit.tex }
    let tex: THREE.Texture
    const up = uploads.find(u => u.slot === slot)
    const g = grabs.find(g => g.slot === slot)
    if (up) tex = new THREE.Texture(up.bitmap)
    else if (g) tex = new THREE.CanvasTexture(g.canvas)
    else {
      // built-in poster re-drawn at 3× the card resolution
      const s = atlas.slots[slot]
      const a = s?.aspect ?? POSTERS[slot % BUILTIN].aspect
      const { w, h } = Atlas.fit(a)
      const cv = document.createElement('canvas')
      cv.width = w * 3
      cv.height = h * 3
      const c2 = cv.getContext('2d', { willReadFrequently: true })!
      c2.scale(3, 3)
      drawPoster(slot % BUILTIN, c2, w, h)
      tex = new THREE.CanvasTexture(cv)
    }
    tex.flipY = false
    tex.colorSpace = THREE.NoColorSpace
    tex.generateMipmaps = true
    tex.minFilter = THREE.LinearMipmapLinearFilter
    tex.magFilter = THREE.LinearFilter
    tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
    tex.needsUpdate = true
    texCache.set(slot, { tex, used: performance.now() })
    // keep a handful of full-res textures around
    if (texCache.size > 6) {
      const oldest = [...texCache.entries()].sort((a, b) => a[1].used - b[1].used)[0]
      if (oldest && oldest[0] !== slot) dropTex(oldest[0])
    }
    return tex
  }

  // ---------- caption texture ----------
  const capCanvas = document.createElement('canvas')
  const capCtx = capCanvas.getContext('2d')!
  const capTex = new THREE.CanvasTexture(capCanvas)
  capTex.flipY = false
  capTex.colorSpace = THREE.NoColorSpace
  capTex.minFilter = THREE.LinearFilter
  capTex.generateMipmaps = false
  let capKey = ''
  function drawCaption(text: string, scale: number) {
    const key = `${text}|${scale.toFixed(2)}`
    if (key === capKey) return
    capKey = key
    const fs = Math.round(26 * scale)
    capCtx.font = `500 ${fs}px Inter, system-ui, sans-serif`
    const w = Math.ceil(capCtx.measureText(text).width + fs * 1.6)
    const h = Math.ceil(fs * 2)
    capCanvas.width = Math.max(4, w)
    capCanvas.height = Math.max(4, h)
    capCtx.clearRect(0, 0, capCanvas.width, capCanvas.height)
    capCtx.font = `500 ${fs}px Inter, system-ui, sans-serif`
    capCtx.fillStyle = 'rgba(0,0,0,0.38)'
    const r = h / 2
    capCtx.beginPath()
    capCtx.roundRect(0, 0, capCanvas.width, capCanvas.height, r)
    capCtx.fill()
    capCtx.fillStyle = 'rgba(255,255,255,0.92)'
    capCtx.textBaseline = 'middle'
    capCtx.textAlign = 'center'
    capCtx.fillText(text, capCanvas.width / 2, capCanvas.height / 2 + 1)
    capTex.dispose()
    capTex.needsUpdate = true
  }

  // ---------- state ----------
  let W = ctx.width, H = ctx.height, pxScale = 1
  let scroll = 0, scrollVel = 0
  let yaw = 0, pitch = 0, camDist = BASE_DIST, camDistT = BASE_DIST
  let gather = false, burst = 0, screenFlash = 0
  let lastLayout = ''
  let dolly: { d0: number; cam0: number } | null = null
  const hs: HandState[] = [0, 1].map(() => ({ pinchT: 0, palmX: 0, palmY: 0, moved: 0, cand: -1, grabbed: -1, offX: 0, offY: 0, dollied: false }))
  let active = 0
  let shown = 0
  let lastDrag = -1
  const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), fwd = new THREE.Vector3()
  const tmpE = new THREE.Euler(), tmpM = new THREE.Matrix4(), one = new THREE.Vector3(1, 1, 1), tmpQ = new THREE.Quaternion()
  let P: Params | null = null

  // viewer: `t` 0 = in the gallery, 1 = filling the frame
  let viewer: { slot: number; card: number; t: number; target: number } | null = null
  let nav: { fromSlot: number; dir: number; t: number } | null = null
  let navCooldown = 0
  let stillT = 0
  const pendingActions: (() => void)[] = []

  const halfY = () => BASE_DIST * Math.tan((FOV * Math.PI) / 360)

  function target(c: Card, i: number, n: number, layout: string, t: number, p: Params, out: { fade: number; scale: number }) {
    const hy = halfY(), hx = hy * (W / H)
    const sp = p.n('spacing')
    const tiltAmt = p.n('tilt')
    out.fade = 1
    out.scale = 1
    if (gather) layout = 'Stack'
    if (layout === 'Ribbon') {
      const u = fract(c.u * (MAX / n) + scroll)
      if (Math.abs(u - c.lastU) > 0.5) c.born = false // wrapped: snap instead of flying across
      c.lastU = u
      const L = 2 * Math.hypot(hx, hy) * 1.15 * sp
      const a = (p.n('ribbonAngle') * Math.PI) / 180
      const along = (u - 0.5) * L
      const wave = p.n('wave')
      const off = wave * 0.7 * Math.sin(u * TAU * 1.3 + t * 0.35) + c.w * p.n('ribbonWidth') * 0.6
      const z = c.d * p.n('depthSpread') + Math.sin(u * TAU * 2 + t * 0.2) * 0.25 * wave
      c.tgt.set(Math.cos(a) * along - Math.sin(a) * off, Math.sin(a) * along + Math.cos(a) * off, z)
      tmpE.set(c.tiltY * 0.35 * tiltAmt, c.tilt * 0.4 * tiltAmt, c.tilt * 0.5 * tiltAmt)
      c.tq.setFromEuler(tmpE)
      out.fade = smooth(0, 0.05, u) * smooth(1, 0.95, u)
    } else if (layout === 'Helix') {
      const u = (c.u * MAX) / n
      const ang = u * TAU * 3 + scroll * TAU
      const R = Math.min(hx, hy) * 0.95 * sp
      c.tgt.set(R * Math.cos(ang), (u - 0.5) * hy * 2.3 * sp, R * Math.sin(ang))
      tmpE.set(0, Math.PI / 2 - ang, c.tilt * 0.15 * tiltAmt)
      c.tq.setFromEuler(tmpE)
    } else if (layout === 'Cloud') {
      const ang = scroll * TAU + t * 0.04
      tmpV.set(c.cloud.x * hx * 0.85 * sp, c.cloud.y * hy * 0.85 * sp, c.cloud.z * 1.6 * sp)
      tmpV.applyAxisAngle(tmpV2.set(0, 1, 0), ang)
      c.tgt.copy(tmpV)
      tmpE.set(c.tiltY * 0.3 * tiltAmt, c.tilt * 0.3 * tiltAmt, c.tilt * 0.4 * tiltAmt)
      c.tq.setFromEuler(tmpE)
    } else if (layout === 'Wall') {
      const cs = p.n('cardSize')
      const cw = cs * 0.92 * sp, ch = cs * 1.12 * sp
      const cols = Math.max(2, Math.floor((2 * hx * 0.96) / cw))
      const rows = Math.ceil(n / cols)
      const row = Math.floor(i / cols), col = i % cols
      const rr = fract((row + 0.5) / rows + scroll) * rows
      if (Math.abs(rr - c.lastU) > rows * 0.5) c.born = false
      c.lastU = rr
      c.tgt.set((col - (cols - 1) / 2) * cw, (rows / 2 - rr) * ch, 0)
      tmpE.set(0, 0, c.tilt * 0.06 * tiltAmt)
      c.tq.setFromEuler(tmpE)
      out.fade = smooth(0, 0.6, rr) * smooth(rows, rows - 0.6, rr)
      // landscape cards shrink to fit their cell
      const aspect = atlas.slots[c.img]?.aspect ?? 0.75
      out.scale = Math.min(1, (cw * 0.92) / (cs * aspect))
    } else {
      // stack: a loose pile in the middle; scroll cycles which card is on top
      const k = fract(i / n + scroll * 0.25)
      c.tgt.set(c.w * 0.12, c.d * 0.12, k * 0.9 - 0.3)
      tmpE.set(0, 0, c.tilt * 0.35)
      c.tq.setFromEuler(tmpE)
      out.scale = 1.7
    }
    if (burst > 0.001) c.tgt.addScaledVector(c.dir, burst * 2.6)
  }

  function project(c: Card) {
    tmpV.copy(c.pos).project(cam)
    c.sx = (tmpV.x + 1) / 2
    c.sy = (1 - tmpV.y) / 2
    c.depth = tmpV2.copy(c.pos).sub(cam.position).dot(fwd)
    c.ss = c.scale / Math.max(0.1, c.depth * 2 * Math.tan((FOV * Math.PI) / 360))
  }

  /** Card under (x, y) in output coords, nearest-to-camera first; -1 if none within reach. */
  function nearest(x: number, y: number, maxR: number) {
    let best = -1, bd = Infinity
    const asp = W / H
    for (let i = 0; i < active; i++) {
      const c = cards[i]
      if (c.scale < 0.02 || c.depth <= 0.1) continue
      const d = Math.hypot((c.sx - x) * asp, c.sy - y)
      const r = Math.max(maxR, c.ss * 0.55)
      const score = d - c.depth * 0.002
      if (d < r && score < bd) { bd = score; best = i }
    }
    return best
  }

  function unproject(x: number, y: number, depth: number, out: THREE.Vector3) {
    out.set(x * 2 - 1, -(y * 2 - 1), 0.5).unproject(cam).sub(cam.position).normalize()
    const t = depth / Math.max(1e-3, out.dot(fwd))
    return out.multiplyScalar(t).add(cam.position)
  }

  function grabSource(f: FrameCtx, x: number, y: number) {
    const el = f.source.element
    if (!el) return
    const sw = el instanceof HTMLVideoElement ? el.videoWidth : el instanceof HTMLImageElement ? el.naturalWidth : (el as HTMLCanvasElement).width
    const sh = el instanceof HTMLVideoElement ? el.videoHeight : el instanceof HTMLImageElement ? el.naturalHeight : (el as HTMLCanvasElement).height
    if (!sw || !sh) return
    // keep a full-resolution 3:4 copy for the viewer; the card gets a cell-sized version
    const a = 3 / 4
    let cw = sw, ch = sw / a
    if (ch > sh) { ch = sh; cw = sh * a }
    const big = document.createElement('canvas')
    big.width = Math.round(Math.min(1080, cw))
    big.height = Math.round(big.width / a)
    const bc = big.getContext('2d')!
    if (f.source.uvXform.x < 0) { bc.translate(big.width, 0); bc.scale(-1, 1) }
    bc.drawImage(el, (sw - cw) / 2, (sh - ch) / 2, cw, ch, 0, 0, big.width, big.height)
    while (grabs.length >= MAX_GRABS) { const old = grabs.shift()!; releaseSlot(old.slot) }
    const slot = allocSlot()
    atlas.put(slot, a, (c, w, h) => c.drawImage(big, 0, 0, w, h))
    grabs.push({ slot, name: `Frame grab ${++grabCount}`, canvas: big })
    rotationLen = rotation().length
    let ci = nearest(x, y, 10)
    if (ci < 0) ci = 0
    cards[ci].img = slot
    cards[ci].flash = 1
    screenFlash = 0.45
  }

  // ---------- viewer ----------
  const viewList = () => rotation()
  function openCard(ci: number) {
    if (ci < 0 || !cards[ci]) return
    viewer = { slot: cards[ci].img, card: ci, t: viewer?.card === ci ? viewer.t : 0, target: 1 }
    nav = null
    stillT = 0
    viewTex(viewer.slot)
  }
  function closeViewer() { if (viewer) viewer.target = 0; stillT = 0 }
  function step(dir: number) {
    if (!viewer || viewer.target === 0) return
    const list = viewList()
    if (list.length < 2) return
    const at = Math.max(0, list.indexOf(viewer.slot))
    const next = list[(at + dir + list.length) % list.length]
    nav = { fromSlot: viewer.slot, dir, t: 0 }
    viewer.slot = next
    viewer.t = 1
    viewTex(next)
    // fly back into a visible card that shows this image (or let the current card take it)
    let best = -1, bd = Infinity
    for (let i = 0; i < active; i++) {
      const c = cards[i]
      if (c.img !== next || c.scale < 0.05 || c.sx < 0 || c.sx > 1 || c.sy < 0 || c.sy > 1) continue
      const d = Math.hypot(c.sx - 0.5, c.sy - 0.5)
      if (d < bd) { bd = d; best = i }
    }
    if (best >= 0) viewer.card = best
    else cards[viewer.card].img = next
    stillT = 0
  }
  /** Final full-frame rect of an image in pixels. */
  function fullRect(slot: number, p: Params, out: Rect) {
    const { aspect } = imageInfo(slot)
    const fill = p.s('openFit') === 'Fill'
    const capSpace = !fill && p.b('caption') ? 64 * pxScale : 0
    if (fill) {
      out.cx = W / 2; out.cy = H / 2; out.hw = W / 2; out.hh = H / 2
      out.uv = coverUV(aspect, W / H)
      out.radius = 0
      out.shadow = 0
    } else {
      const m = p.n('openMargin')
      const aw = W - 2 * m * Math.min(W, H), ah = H - 2 * m * Math.min(W, H) - capSpace
      let w = aw, h = aw / aspect
      if (h > ah) { h = ah; w = ah * aspect }
      out.cx = W / 2; out.cy = (H - capSpace) / 2; out.hw = w / 2; out.hh = h / 2
      out.uv = [0, 0, 1, 1]
      out.radius = p.n('radius') * Math.min(w, h) * 0.35
      out.shadow = 1
    }
    out.rot = 0
    out.border = 0
  }
  /** Where a card currently sits on screen, as a rect in pixels. */
  function cardRect(ci: number, p: Params, out: Rect) {
    const c = cards[ci]
    const slot = atlas.slots[c.img]
    const ca = slot?.aspect ?? 0.75
    const hh = Math.max(1, c.ss * H) / 2
    out.cx = c.sx * W; out.cy = c.sy * H; out.hh = hh; out.hw = hh * ca
    tmpQ.copy(cam.quaternion).invert().multiply(c.quat)
    tmpE.setFromQuaternion(tmpQ, 'XYZ')
    out.rot = -tmpE.z
    out.uv = coverUV(imageInfo(c.img).aspect, ca)
    out.radius = p.n('radius') * Math.min(out.hw, out.hh) * 2
    out.border = p.n('border') * Math.min(out.hw, out.hh) * 2
    out.shadow = Math.min(1, p.n('shadow') * 1.5)
  }
  const rA: Rect = { cx: 0, cy: 0, hw: 1, hh: 1, rot: 0, uv: [0, 0, 1, 1], radius: 0, border: 0, shadow: 0 }
  const rB: Rect = { ...rA, uv: [0, 0, 1, 1] }
  const rC: Rect = { ...rA, uv: [0, 0, 1, 1] }
  function mixRect(a: Rect, b: Rect, k: number, out: Rect) {
    out.cx = lerp(a.cx, b.cx, k); out.cy = lerp(a.cy, b.cy, k)
    out.hw = lerp(a.hw, b.hw, k); out.hh = lerp(a.hh, b.hh, k)
    out.rot = lerp(a.rot, b.rot, k)
    out.uv = [lerp(a.uv[0], b.uv[0], k), lerp(a.uv[1], b.uv[1], k), lerp(a.uv[2], b.uv[2], k), lerp(a.uv[3], b.uv[3], k)]
    out.radius = lerp(a.radius, b.radius, k); out.border = lerp(a.border, b.border, k); out.shadow = lerp(a.shadow, b.shadow, k)
  }
  function drawView(f: FrameCtx, tgt: THREE.WebGLRenderTarget, slot: number, r: Rect, alpha: number, p: Params) {
    const u = viewPass.uniforms
    u.tImg.value = viewTex(slot)
    u.uRes.value.set(W, H)
    u.uCenter.value.set(r.cx, r.cy)
    u.uHalf.value.set(Math.max(0.5, r.hw), Math.max(0.5, r.hh))
    u.uRot.value = r.rot
    u.uUvRect.value.set(...r.uv)
    u.uRadius.value = r.radius
    u.uBorder.value = r.border
    u.uBorderColor.value.setRGB(...p.c('borderColor'))
    u.uShadow.value = r.shadow * p.n('openShadow')
    u.uShadowBlur.value = 36 * pxScale
    u.uShadowOff.value.set(0, 22 * pxScale)
    u.uAlpha.value = alpha
    viewPass.render(f.renderer, tgt)
  }

  return {
    resize(w, h) {
      W = w; H = h
      cam.aspect = w / h
      cam.updateProjectionMatrix()
      bg.uniforms.uRes.value.set(w, h)
      galRT.setSize(w, h)
      blurA.setSize(Math.max(1, Math.round(w / 4)), Math.max(1, Math.round(h / 4)))
      blurB.setSize(Math.max(1, Math.round(w / 4)), Math.max(1, Math.round(h / 4)))
    },

    setImages(images: SceneImage[]) {
      const keep = new Set(images.map(i => i.id))
      for (const u of uploads) if (!keep.has(u.id)) releaseSlot(u.slot)
      const prev = new Map(uploads.map(u => [u.id, u]))
      const fresh = new Set<number>()
      const next: Upload[] = []
      for (const im of images) {
        const old = prev.get(im.id)
        if (old) { next.push({ ...old, bitmap: im.bitmap, name: im.name }); continue }
        if (next.length >= SLOTS - BUILTIN - MAX_GRABS && !freeSlots.length) break
        const slot = allocSlot()
        const aspect = clampAspect(im.width / Math.max(1, im.height))
        const ia = im.width / Math.max(1, im.height)
        atlas.put(slot, aspect, (c, w, h) => {
          const uv = coverUV(ia, w / h)
          c.imageSmoothingQuality = 'high'
          c.drawImage(im.bitmap, uv[0] * im.width, uv[1] * im.height, (uv[2] - uv[0]) * im.width, (uv[3] - uv[1]) * im.height, 0, 0, w, h)
        })
        fresh.add(slot)
        next.push({ id: im.id, name: im.name, slot, bitmap: im.bitmap, w: im.width, h: im.height })
      }
      uploads = next
      // the viewer can't keep showing an image that was removed
      if (viewer && !rotation().includes(viewer.slot)) { viewer = null; nav = null }
      assignImages(fresh.size ? fresh : null)
      if (fresh.size) screenFlash = 0.2
    },

    click(x: number, y: number) {
      // a press that turned into a drag is not a click
      if (hs.some(s => s.grabbed >= 0) || performance.now() / 1000 - lastDrag < 0.2) return true
      if (viewer && viewer.target === 1) {
        if (x < 1 / 3) pendingActions.push(() => step(-1))
        else if (x > 2 / 3) pendingActions.push(() => step(1))
        else pendingActions.push(closeViewer)
        return true
      }
      const ci = nearest(x, y, 0.03)
      if (ci < 0) return false
      pendingActions.push(() => openCard(ci))
      return true
    },

    update(f: FrameCtx) {
      const p = f.p
      P = p
      const dt = f.time.dt
      const t = f.time.t
      const nowR = performance.now() / 1000
      pxScale = f.scale
      atlas.flush(f.renderer)
      const repeat = p.b('repeatFill') || !uploads.length
      const n = Math.min(MAX, Math.max(1, Math.round(p.n('count'))), repeat ? MAX : Math.max(1, rotationLen))
      const layout = LAYOUTS.includes(p.s('layout')) ? p.s('layout') : 'Ribbon'
      if (layout !== lastLayout) {
        if (lastLayout) cards.forEach((c, i) => { c.delayUntil = nowR + (i / MAX) * 0.7 })
        lastLayout = layout
      }
      for (const a of pendingActions.splice(0)) a()
      for (const pl of f.pulses) {
        if (pl === 'grab') grabSource(f, 0.5, 0.5)
        else if (pl === 'openNext') {
          if (viewer && viewer.target === 1) step(1)
          else { let best = -1, bd = Infinity; for (let i = 0; i < active; i++) { const c = cards[i]; if (c.scale < 0.05) continue; const d = Math.hypot(c.sx - 0.5, c.sy - 0.5) - c.ss; if (d < bd) { bd = d; best = i } } openCard(best) }
        } else if (pl === 'close') closeViewer()
        else if (pl === 'shuffle' || pl === 'pulse') {
          rng = mulberry32(Math.floor(Math.random() * 1e9))
          cards.forEach((c, i) => { seedCard(c, rng, i); c.delayUntil = nowR + Math.random() * 0.5; c.born = true })
          assignImages(null)
        }
      }
      const viewing = !!viewer

      // ---------- hands ----------
      const hands = f.hands.hands
      const mouse = f.hands.mode === 'mouse'
      const byId = (id: number) => hands.find(h => h.id === id)
      const bothPinch = hands.length >= 2 && hands[0].pinching && hands[1].pinching
      for (const e of f.hands.events) {
        const s = hs[e.hand] ?? hs[0]
        if (e.type === 'pinchStart') {
          // palm-relative: the palm stays put while fingers pinch (fingertips jump)
          const h = byId(e.hand)
          s.pinchT = nowR; s.palmX = h?.palm.x ?? e.x; s.palmY = h?.palm.y ?? e.y; s.moved = 0; s.dollied = false
          const other = hands.find(o => o.id !== e.hand)
          s.cand = other?.pinching || viewing ? -1 : nearest(e.x, e.y, 0.07)
          s.grabbed = -1
        } else if (e.type === 'pinchEnd') {
          const tap = nowR - s.pinchT < 0.4 && s.moved < 0.04 && !s.dollied && s.grabbed < 0
          if (s.grabbed >= 0) lastDrag = nowR
          // the mouse's quick clicks arrive through click(); taps here are real hands only
          if (tap && !mouse) {
            if (viewer && viewer.target === 1) closeViewer()
            else if (s.cand >= 0) openCard(s.cand)
            else if (p.b('pinchSnap')) grabSource(f, e.x, e.y)
          }
          s.grabbed = -1
          s.cand = -1
        } else if (e.type === 'fist') {
          if (!viewing) gather = true
        } else if (e.type === 'open') {
          if (gather) { gather = false; burst = 1 }
        }
      }
      if (gather && !hands.some(h => h.fist) && hands.length === 0) gather = false
      for (const h of hands) {
        const s = hs[h.id]
        if (!s) continue
        if (h.pinching) {
          s.moved = Math.max(s.moved, Math.hypot((h.palm.x - s.palmX) * (W / H), h.palm.y - s.palmY))
          // a pinch becomes a drag once it is held or moved (so a quick tap/click can open instead)
          if (s.grabbed < 0 && s.cand >= 0 && !viewing && !dolly && (nowR - s.pinchT > HOLD_TO_DRAG || s.moved > 0.03)) {
            s.grabbed = s.cand
            s.offX = cards[s.grabbed].sx - h.palm.x
            s.offY = cards[s.grabbed].sy - h.palm.y
          }
        } else {
          if (s.grabbed >= 0) lastDrag = nowR
          s.grabbed = -1
        }
      }
      // two-hand dolly
      if (bothPinch && !viewing) {
        if (!dolly) {
          dolly = { d0: Math.max(0.02, f.hands.twoDist), cam0: camDistT }
          hs.forEach(s => { s.dollied = true; s.grabbed = -1; s.cand = -1 })
        }
        camDistT = Math.min(14, Math.max(1.6, dolly.cam0 * (dolly.d0 / Math.max(0.02, f.hands.twoDist))))
      } else dolly = null
      const swiper = hands.find(h => !h.pinching && (h.open || h.openness > 0.75)) as Hand | undefined
      // viewer gestures (camera hands): swipe = prev/next, open palm held still = close
      if (viewer && viewer.target === 1 && !mouse) {
        if (swiper) {
          const vx = swiper.vel.x * (W / H)
          const speed = Math.hypot(vx, swiper.vel.y)
          if (Math.abs(vx) > 1.1 && Math.abs(vx) > Math.abs(swiper.vel.y) * 1.3 && nowR > navCooldown && viewer.t > 0.8) {
            step(vx < 0 ? 1 : -1)
            navCooldown = nowR + 0.7
          }
          if (speed < 0.3 && viewer.t >= 1 && !nav) stillT += dt
          else stillT = 0
          if (stillT > 1.1) closeViewer()
        } else stillT = 0
      }
      // swipe → scroll with inertia (not while an image is open)
      const ang = (p.n('ribbonAngle') * Math.PI) / 180
      const sdir = layout === 'Ribbon' ? [Math.cos(ang), -Math.sin(ang)] : layout === 'Wall' ? [0, -1] : [1, 0]
      const drift = hands.length && !viewing ? 0 : p.n('autoDrift')
      if (swiper && !gather && !viewing) {
        const proj = swiper.vel.x * (W / H) * sdir[0] + swiper.vel.y * sdir[1]
        const gain = (layout === 'Ribbon' ? 0.32 : layout === 'Wall' ? 0.25 : -0.22) * p.n('swipeGain')
        const tv = Math.abs(proj) > 0.05 ? proj * gain : scrollVel * Math.exp(-dt * (1 - p.n('inertia')) * 8)
        scrollVel += (tv - scrollVel) * (1 - Math.exp(-dt * 10))
      } else {
        scrollVel = drift + (scrollVel - drift) * Math.exp(-dt * (1 - p.n('inertia')) * 8)
      }
      if (!f.frozen) scroll += scrollVel * dt
      // orbit from hand roll / height (frozen while an image is open)
      const orb = p.n('orbit')
      const lead = viewing ? undefined : hands.find(h => !h.pinching) ?? hands[0]
      const yawT = lead ? Math.max(-0.7, Math.min(0.7, lead.roll * 0.8)) * orb : Math.sin(t * 0.13) * 0.12 * orb
      const pitchT = lead ? (lead.palm.y - 0.5) * 0.7 * orb : Math.sin(t * 0.09) * 0.05 * orb
      const k = 1 - Math.exp(-dt * 3)
      yaw += (yawT - yaw) * k
      pitch += (pitchT - pitch) * k
      camDist += (camDistT - camDist) * (1 - Math.exp(-dt * 6))
      cam.position.set(camDist * Math.sin(yaw) * Math.cos(pitch), camDist * Math.sin(pitch), camDist * Math.cos(yaw) * Math.cos(pitch))
      cam.lookAt(0, 0, 0)
      cam.updateMatrixWorld()
      cam.getWorldDirection(fwd)
      burst *= Math.exp(-dt * 2.2)
      screenFlash *= Math.exp(-dt * 6)

      // ---------- viewer clock ----------
      if (viewer) {
        const dur = 0.65 / Math.max(0.2, p.n('openSpeed'))
        viewer.t = Math.min(1, Math.max(0, viewer.t + (viewer.target ? 1 : -1) * dt / dur))
        if (viewer.target === 0 && viewer.t <= 0) { viewer = null; nav = null }
      }
      if (nav) {
        nav.t += dt / (0.5 / Math.max(0.2, p.n('openSpeed')))
        if (nav.t >= 1) nav = null
      }

      // ---------- cards follow their targets ----------
      const cs = p.n('cardSize')
      const hover = p.n('hoverScale')
      const out = { fade: 1, scale: 1 }
      for (const c of cards) c.hiT = 0
      if (!viewing) {
        for (const h of hands) {
          const s = hs[h.id]
          if (s && s.grabbed >= 0) { cards[s.grabbed].hiT = 1; continue }
          if (gather || h.fist || dolly) continue
          if (h.point || mouse || h.pinch > 0.5) {
            const ci = nearest(h.index.x, h.index.y, 0.06)
            if (ci >= 0) cards[ci].hiT = 1
          }
        }
      }
      active = 0
      shown = 0
      for (let i = 0; i < MAX; i++) {
        const c = cards[i]
        const alive = i < n
        if (!alive && c.scale < 0.002) { c.born = false; continue }
        const delayed = nowR < c.delayUntil
        let ts = 0
        if (alive) {
          target(c, i, n, layout, t, p, out)
          ts = cs * out.scale * out.fade
        }
        const grabbedBy = hs.findIndex(s => s.grabbed === i)
        if (grabbedBy >= 0) {
          const h = byId(grabbedBy)
          const s0 = hs[grabbedBy]
          if (h) {
            const depth = Math.max(1, tmpV.copy(c.tgt).sub(cam.position).dot(fwd) - 0.6)
            unproject(h.palm.x + s0.offX, h.palm.y + s0.offY, depth, c.tgt)
            c.tq.copy(cam.quaternion)
            ts = cs * hover * 1.15
          }
        }
        c.hi += (c.hiT - c.hi) * (1 - Math.exp(-dt * 12))
        ts *= 1 + c.hi * (hover - 1) * (grabbedBy >= 0 ? 0 : 1)
        if (c.hi > 0.01 && grabbedBy < 0) c.tgt.addScaledVector(fwd, -0.35 * c.hi)
        if (!c.born) {
          c.pos.copy(c.tgt); c.quat.copy(c.tq); c.scale = alive ? 0 : c.scale; c.born = true
        }
        if (!delayed || grabbedBy >= 0) {
          const rate = grabbedBy >= 0 ? 20 : gather ? 7 : 5.5
          const kk = 1 - Math.exp(-dt * rate)
          c.pos.lerp(c.tgt, kk)
          c.quat.slerp(c.tq, kk)
        }
        c.scale += (ts - c.scale) * (1 - Math.exp(-dt * 6))
        c.flash *= Math.exp(-dt * 3)
        project(c)
        if (alive) { active = Math.max(active, i + 1); shown++ }
      }
      if (hands.length === 0) for (const s of hs) { s.grabbed = -1; s.cand = -1 }

      // ---------- write instances back-to-front (the open card is drawn by the viewer) ----------
      const hidden = viewer ? viewer.card : -1
      const live = cards.filter((c, i) => i !== hidden && c.scale > 0.002 && c.depth > cam.near)
      live.sort((a, b) => b.depth - a.depth)
      const sz = aSize.array as Float32Array, rc = aRect.array as Float32Array, fx = aFx.array as Float32Array
      live.forEach((c, j) => {
        const slot = atlas.slots[c.img] ?? atlas.slots[0]!
        tmpM.compose(c.pos, c.quat, one)
        mesh.setMatrixAt(j, tmpM)
        sz[j * 2] = c.scale * slot.aspect
        sz[j * 2 + 1] = c.scale
        rc.set(slot.rect, j * 4)
        fx[j * 4] = c.hi
        fx[j * 4 + 1] = Math.min(1, c.flash)
        fx[j * 4 + 2] = 1
        fx[j * 4 + 3] = 0
      })
      mesh.count = live.length
      mesh.instanceMatrix.needsUpdate = true
      aSize.needsUpdate = true
      aRect.needsUpdate = true
      aFx.needsUpdate = true

      // ---------- uniforms ----------
      const bgc = p.c('bgColor')
      uniforms.uFogColor.value.setRGB(...bgc)
      uniforms.uFogNear.value = camDist - 0.5
      uniforms.uFogRange.value = 7
      uniforms.uFogAmt.value = p.n('fog')
      uniforms.uRadius.value = p.n('radius')
      uniforms.uBorder.value = p.n('border')
      uniforms.uBorderColor.value.setRGB(...p.c('borderColor'))
      if (p.b('hiShow')) uniforms.uHiColor.value.setRGB(...p.c('hiColor'))
      else uniforms.uHiColor.value.copy(uniforms.uBorderColor.value)
      uniforms.uShadow.value = p.n('shadow')
      uniforms.uBlur.value = cs * 0.12
      uniforms.uShadowOff.value.set(cs * 0.05, -cs * 0.08)
      uniforms.uPad.value = cs * 0.14
      bg.uniforms.uBg.value.setRGB(...bgc)
      bg.uniforms.uDots.value = p.b('paperDots') ? 1 : 0
      bg.uniforms.uDotStep.value = 34 * f.scale
      bg.uniforms.uDotR.value = 2.2 * f.scale
      bg.uniforms.uVig.value = p.n('vignette')
      flashPass.uniforms.uA.value = screenFlash
    },

    render(f, tgt) {
      const r = f.renderer
      const p = P ?? f.p
      if (!viewer) {
        bg.render(r, tgt)
        r.setRenderTarget(tgt)
        r.render(scene, cam)
        if (screenFlash > 0.01) flashPass.render(r, tgt)
        return
      }
      // gallery → offscreen, then a dimmed / blurred backdrop
      bg.render(r, galRT)
      r.setRenderTarget(galRT)
      r.render(scene, cam)
      const e = ease(viewer.t)
      const blurAmt = p.n('openBlur') * e
      if (blurAmt > 0.001) {
        blurPass.uniforms.tSrc.value = galRT.texture
        blurPass.uniforms.uDir.value.set(0, 0)
        blurPass.render(r, blurA)
        const rad = 1 + p.n('openBlur') * 2.5
        for (let i = 0; i < 3; i++) {
          blurPass.uniforms.tSrc.value = blurA.texture
          blurPass.uniforms.uDir.value.set((rad * (i + 1)) / blurA.width, 0)
          blurPass.render(r, blurB)
          blurPass.uniforms.tSrc.value = blurB.texture
          blurPass.uniforms.uDir.value.set(0, (rad * (i + 1)) / blurA.height)
          blurPass.render(r, blurA)
        }
      }
      backdropPass.uniforms.tSharp.value = galRT.texture
      backdropPass.uniforms.tBlur.value = blurA.texture
      backdropPass.uniforms.uBlur.value = blurAmt > 0.001 ? Math.min(1, blurAmt * 1.2) : 0
      backdropPass.uniforms.uDim.value = p.n('openDim') * e
      backdropPass.render(r, tgt)

      // the image: from its card to the full frame, or sliding to the next one
      if (nav) {
        const k = ease(nav.t)
        fullRect(nav.fromSlot, p, rA)
        rA.cx -= nav.dir * W * k
        drawView(f, tgt, nav.fromSlot, rA, 1 - k * 0.35, p)
        fullRect(viewer.slot, p, rB)
        rB.cx += nav.dir * W * (1 - k)
        drawView(f, tgt, viewer.slot, rB, 0.65 + k * 0.35, p)
      } else {
        cardRect(viewer.card, p, rA)
        fullRect(viewer.slot, p, rB)
        mixRect(rA, rB, e, rC)
        drawView(f, tgt, viewer.slot, rC, 1, p)
      }
      // caption
      if (p.b('caption')) {
        const list = viewList()
        const info = imageInfo(viewer.slot)
        const idx = list.indexOf(viewer.slot) + 1
        drawCaption(`${info.name || 'Image'}   ${idx} / ${list.length}`, pxScale)
        fullRect(viewer.slot, p, rB)
        const cw = capCanvas.width, ch = capCanvas.height
        const fill = p.s('openFit') === 'Fill'
        const cy = fill ? H - 90 * pxScale - ch : Math.min(H - ch - 16 * pxScale, rB.cy + rB.hh + 18 * pxScale)
        captionPass.uniforms.tCap.value = capTex
        captionPass.uniforms.uRes.value.set(W, H)
        captionPass.uniforms.uRect.value.set(W / 2 - cw / 2, cy, cw, ch)
        captionPass.uniforms.uAlpha.value = smooth(0.6, 1, viewer.t) * (nav ? 1 - Math.sin(Math.PI * nav.t) * 0.8 : 1)
        captionPass.render(r, tgt)
      }
      if (screenFlash > 0.01) flashPass.render(r, tgt)
    },

    status() {
      const base = `${shown} cards${uploads.length ? ` · ${uploads.length} yours` : ''}`
      if (viewer) { const list = viewList(); return `${base} · viewing ${list.indexOf(viewer.slot) + 1}/${list.length}` }
      return base
    },

    dispose() {
      atlas.dispose()
      geo.dispose()
      plane.dispose()
      mat.dispose()
      bg.dispose()
      flashPass.dispose()
      viewPass.dispose()
      blurPass.dispose()
      backdropPass.dispose()
      captionPass.dispose()
      capTex.dispose()
      galRT.dispose(); blurA.dispose(); blurB.dispose()
      for (const e of texCache.values()) e.tex.dispose()
      texCache.clear()
    },
  }
}

// Inspired by a TouchDesigner reel by nayana.
const gallery: SceneDef = {
  id: 'gallery',
  name: 'Hand Gallery',
  tag: '3D photo ribbon',
  blurb: 'A 3D mood board of photo cards flowing through a diagonal ribbon. Add your own images below. Swipe to scroll, click or pinch-tap a card to open it full-frame, pinch and hold to drag one, make a fist to stack them.',
  color: '#ffb547',
  needs: { hands: true, handMapping: 'frame' },
  images: {
    max: 80,
    label: 'Your images',
    hint: 'Your photos replace the built-in posters. Click a card to open it full-frame; click the left / right third to browse.',
    maxSize: 1600,
  },
  params: [
    { id: 'layout', label: 'Layout', group: 'Layout', type: 'enum', options: LAYOUTS, default: 'Ribbon' },
    { id: 'count', label: 'Cards', group: 'Layout', type: 'int', min: 12, max: MAX, default: 110 },
    { id: 'repeatFill', label: 'Repeat to fill', group: 'Layout', type: 'bool', default: true },
    { id: 'spacing', label: 'Spacing', group: 'Layout', type: 'float', min: 0.4, max: 2, step: 0.01, default: 1 },
    { id: 'ribbonAngle', label: 'Ribbon angle', group: 'Layout', type: 'float', min: -90, max: 90, step: 1, default: 62, random: [35, 80] },
    { id: 'ribbonWidth', label: 'Ribbon width', group: 'Layout', type: 'float', min: 0, max: 2.5, step: 0.01, default: 0.9 },
    { id: 'wave', label: 'Wave', group: 'Layout', type: 'float', min: 0, max: 1.5, step: 0.01, default: 0.45 },
    { id: 'depthSpread', label: 'Depth spread', group: 'Layout', type: 'float', min: 0, max: 2, step: 0.01, default: 0.7 },
    { id: 'tilt', label: 'Card tilt', group: 'Layout', type: 'float', min: 0, max: 1.5, step: 0.01, default: 0.35 },
    { id: 'cardSize', label: 'Card size', group: 'Cards', type: 'float', min: 0.1, max: 1, step: 0.01, default: 0.34, random: [0.24, 0.5] },
    { id: 'radius', label: 'Corner radius', group: 'Cards', type: 'float', min: 0, max: 0.5, step: 0.005, default: 0.03 },
    { id: 'border', label: 'Border', group: 'Cards', type: 'float', min: 0, max: 0.1, step: 0.001, default: 0.018 },
    { id: 'borderColor', label: 'Border color', group: 'Cards', type: 'color', default: '#ffffff' },
    { id: 'hiShow', label: 'Highlight border', group: 'Cards', type: 'bool', default: false },
    { id: 'hiColor', label: 'Highlight', group: 'Cards', type: 'color', default: '#ff3df2' },
    { id: 'shadow', label: 'Shadow', group: 'Cards', type: 'float', min: 0, max: 1, step: 0.01, default: 0.55 },
    { id: 'openFit', label: 'Open as', group: 'Full-frame view', type: 'enum', options: ['Fit', 'Fill'], default: 'Fit', random: false },
    { id: 'openMargin', label: 'Margin', group: 'Full-frame view', type: 'float', min: 0, max: 0.2, step: 0.005, default: 0.06, random: false },
    { id: 'openDim', label: 'Dim gallery', group: 'Full-frame view', type: 'float', min: 0, max: 1, step: 0.01, default: 0.55, random: false },
    { id: 'openBlur', label: 'Blur gallery', group: 'Full-frame view', type: 'float', min: 0, max: 1, step: 0.01, default: 0.75, random: false },
    { id: 'openShadow', label: 'Image shadow', group: 'Full-frame view', type: 'float', min: 0, max: 1, step: 0.01, default: 0.7, random: false },
    { id: 'openSpeed', label: 'Fly speed', group: 'Full-frame view', type: 'float', min: 0.3, max: 2, step: 0.01, default: 1, random: false },
    { id: 'caption', label: 'Caption', group: 'Full-frame view', type: 'bool', default: true },
    { id: 'openNext', label: 'Open next', group: 'Full-frame view', type: 'pulse', default: 0 },
    { id: 'close', label: 'Close', group: 'Full-frame view', type: 'pulse', default: 0 },
    { id: 'bgColor', label: 'Background', group: 'Look', type: 'color', default: '#1c1b1f' },
    { id: 'paperDots', label: 'Dotted paper', group: 'Look', type: 'bool', default: false },
    { id: 'fog', label: 'Fog', group: 'Look', type: 'float', min: 0, max: 1, step: 0.01, default: 0.45 },
    { id: 'vignette', label: 'Vignette', group: 'Look', type: 'float', min: 0, max: 1, step: 0.01, default: 0.35 },
    { id: 'inertia', label: 'Inertia', group: 'Motion', type: 'float', min: 0, max: 0.99, step: 0.01, default: 0.9 },
    { id: 'swipeGain', label: 'Swipe strength', group: 'Motion', type: 'float', min: 0, max: 3, step: 0.01, default: 1 },
    { id: 'autoDrift', label: 'Auto drift', group: 'Motion', type: 'float', min: -0.2, max: 0.2, step: 0.001, default: 0.02, random: [-0.04, 0.04] },
    { id: 'orbit', label: 'Orbit amount', group: 'Motion', type: 'float', min: 0, max: 1, step: 0.01, default: 0.6 },
    { id: 'hoverScale', label: 'Pick-up scale', group: 'Motion', type: 'float', min: 1, max: 3, step: 0.01, default: 1.8 },
    { id: 'pinchSnap', label: 'Pinch-tap grabs frame', group: 'Motion', type: 'bool', default: true },
    { id: 'grab', label: 'Grab source frame', group: 'Layout', type: 'pulse', default: 0 },
    { id: 'shuffle', label: 'Shuffle', group: 'Layout', type: 'pulse', default: 0 },
  ],
  presets: {
    Ribbon: {},
    'Paper ribbon': { bgColor: '#f7f3ea', paperDots: true, shadow: 0.7, fog: 0.22, border: 0.03, vignette: 0.15 },
    Helix: { layout: 'Helix', count: 96, cardSize: 0.38, fog: 0.55, tilt: 0.2 },
    Wall: { layout: 'Wall', count: 84, cardSize: 0.42, tilt: 0.3, bgColor: '#f7f3ea', paperDots: true, shadow: 0.6, fog: 0.1, border: 0.03, vignette: 0.1 },
    'Dark cloud': { layout: 'Cloud', count: 120, cardSize: 0.3, bgColor: '#0b0b10', fog: 0.75, border: 0, radius: 0.08, shadow: 0 },
    Pile: { layout: 'Stack', count: 40, cardSize: 0.6, border: 0.04, bgColor: '#f7f3ea', paperDots: true, shadow: 0.8, fog: 0 },
  },
  gestures: [
    'Click / pinch-tap a card → open it full-frame',
    'While open → click left / right third or swipe to browse · click centre, pinch-tap or hold an open palm still to close',
    'Open palm swipe → scroll the gallery (keeps gliding)',
    'Tilt your hand / move it up-down → orbit the camera',
    'Point → highlight the card under your fingertip',
    'Pinch and hold a card → pull it out and drag it; release to send it back',
    'Pinch-tap empty space → grab the current source frame as a card',
    'Both hands pinching → move apart / together to zoom',
    'Fist → gather into a stack · open hand → burst',
  ],
  create,
}

export default gallery
