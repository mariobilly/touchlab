import * as THREE from 'three'
import { GLSL } from '../../gfx/glsl'
import { Layout, type Node, type Leaf } from './layout'
import type { SceneDef, SceneInstance, FrameCtx, SceneCreateCtx, SceneImage, Params } from '../types'

// Cell Poster: the user's portraits (1–4 stills) cut into a living guillotine grid, framed as an
// editorial poster. Stills never change, so cells stay alive through motion instead of time:
// drifting offsets, scanning stretch columns, per-band "scan" slides and breathing zooms.
// With several images, Cycle swaps the whole grid cell by cell; Mix lets cells pull from all.

const MAX = 220
const SLOTS = 4

const VERT = /* glsl */ `
attribute vec4 aRect;   // output uv (GL, y up): x, y, w, h
attribute vec4 aCell;   // area uv (GL, y up): x, y, w, h
attribute vec4 aMode;   // mode, offset.x, offset.y, extra
attribute vec4 aMisc;   // flash, scan amount, seed, scan direction
attribute vec4 aImg;    // from image, to image, transition progress, wipe direction
uniform vec2 uRes;
varying vec2 vL;
varying vec4 vCell, vMode, vMisc, vImg;
varying vec2 vSizePx;
void main() {
  vec2 l = position.xy + 0.5;
  vL = l;
  vCell = aCell; vMode = aMode; vMisc = aMisc; vImg = aImg;
  vSizePx = aRect.zw * uRes;
  vec2 p = aRect.xy + l * aRect.zw;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`

const FRAG = /* glsl */ `
precision highp float;
varying vec2 vL;
varying vec4 vCell, vMode, vMisc, vImg;
varying vec2 vSizePx;
uniform sampler2D tImg0, tImg1, tImg2, tImg3;
uniform vec4 uXf[4];
uniform float uLine, uLineAlpha, uStretch, uScanAmt, uScanSpeed, uDrift, uFlashAmt, uTime;
uniform vec3 uLineColor, uBlank, uEmptyLine, uWipeColor;
${GLSL.common}

vec2 mirrorWrap(vec2 q) { return 1.0 - abs(1.0 - mod(q, 2.0)); }
// Image bitmaps upload top row first (flipY does not apply to ImageBitmap), so flip v here.
vec3 img(float i, vec2 q) {
  q = mirrorWrap(q);
  vec3 c;
  if (i < 0.5) { vec2 u = coverUV(q, uXf[0]); c = texture(tImg0, vec2(u.x, 1.0 - u.y)).rgb; }
  else if (i < 1.5) { vec2 u = coverUV(q, uXf[1]); c = texture(tImg1, vec2(u.x, 1.0 - u.y)).rgb; }
  else if (i < 2.5) { vec2 u = coverUV(q, uXf[2]); c = texture(tImg2, vec2(u.x, 1.0 - u.y)).rgb; }
  else { vec2 u = coverUV(q, uXf[3]); c = texture(tImg3, vec2(u.x, 1.0 - u.y)).rgb; }
  return c;
}

vec3 cellColor(float i, vec2 l) {
  vec4 c = vCell;
  float mode = vMode.x;
  vec2 off = vMode.yz;
  float ex = vMode.w;
  float seed = vMisc.z;
  float t = uTime;
  vec2 q0 = c.xy + l * c.zw;
  vec2 drift = vec2(sin(t * 0.23 + seed * 6.283), cos(t * 0.19 + seed * 4.1)) * 0.012 * uDrift;
  vec2 q;
  if (mode < 0.5) {
    q = q0 + off + drift;
  } else if (mode < 1.5) {     // stretch-X: one scanning column smeared sideways
    float cx = c.x + clamp(ex + sin(t * 0.17 * uScanSpeed + seed * 6.283) * 0.3 * uDrift, 0.02, 0.98) * c.z;
    q = vec2(mix(q0.x, cx, uStretch), q0.y) + off;
  } else if (mode < 2.5) {     // stretch-Y: one scanning row smeared vertically
    float cy = c.y + clamp(ex + sin(t * 0.15 * uScanSpeed + seed * 6.283) * 0.3 * uDrift, 0.02, 0.98) * c.w;
    q = vec2(q0.x, mix(q0.y, cy, uStretch)) + off;
  } else if (mode < 3.5) {     // scan: bands of the cell slide out of phase (slit-scan feel for stills)
    float n = 5.0 + floor(seed * 19.0);
    float a = vMisc.w > 0.5 ? l.y : l.x;
    float band = floor(a * n);
    float ph = sin(t * uScanSpeed * (0.5 + seed) + band * (0.6 + seed * 1.4) + seed * 6.283);
    float amt = uScanAmt * vMisc.y * 0.16;
    q = q0 + off + (vMisc.w > 0.5 ? vec2(ph * amt, 0.0) : vec2(0.0, ph * amt));
  } else if (mode < 4.5) {     // mirror
    q = vec2(c.x + (1.0 - l.x) * c.z, q0.y) + off + drift;
  } else {                     // zoom: breathing magnification around a drifting center
    float z = max(1.0, ex) * (1.0 + 0.08 * uDrift * sin(t * 0.37 + seed * 6.283));
    q = c.xy + c.zw * 0.5 + off * 0.5 + drift * 2.0 + (l - 0.5) * c.zw / z;
  }
  return img(i, q);
}

void main() {
  vec2 l = vL;
  vec2 dpx = min(l, 1.0 - l) * vSizePx;
  float d = min(dpx.x, dpx.y);
  float line = 1.0 - smoothstep(uLine * 0.5, uLine * 0.5 + 0.9, d);
  if (vMode.x < -0.5) {        // empty state: blank outlined cells
    gl_FragColor = vec4(mix(uBlank, uEmptyLine, line * 0.9), 1.0);
    return;
  }
  vec3 col;
  float k = vImg.z;
  if (k <= 0.0) col = cellColor(vImg.x, l);
  else if (k >= 1.0) col = cellColor(vImg.y, l);
  else {
    // cell-by-cell wipe: the next image slides in from one edge behind a thin accent line
    float w = vImg.w;
    float ke = k * k * (3.0 - 2.0 * k);
    float s = w < 0.5 ? l.x : w < 1.5 ? 1.0 - l.x : w < 2.5 ? l.y : 1.0 - l.y;
    vec2 dir = w < 0.5 ? vec2(1.0, 0.0) : w < 1.5 ? vec2(-1.0, 0.0) : w < 2.5 ? vec2(0.0, 1.0) : vec2(0.0, -1.0);
    col = s < ke ? cellColor(vImg.y, l + dir * (1.0 - ke) * 0.35) : cellColor(vImg.x, l - dir * ke * 0.08);
    float span = w < 1.5 ? vSizePx.x : vSizePx.y;
    float edge = 1.0 - smoothstep(0.0, 1.6, abs(s - ke) * span);
    col = mix(col, uWipeColor, edge * step(0.001, ke) * step(ke, 0.999));
  }
  col += vMisc.x * uFlashAmt * 0.55;
  col = mix(col, uLineColor, line * uLineAlpha);
  gl_FragColor = vec4(col, 1.0);
}`

const OVERLAY = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tOverlay;
void main() { gl_FragColor = texture(tOverlay, vUv); }`

interface Area { x: number; y: number; w: number; h: number } // GL uv, y up
interface PosterGeom {
  area: Area
  wide: boolean
  title: { x: number; y: number; size: number }
  sub: { x: number; y: number; size: number }
  data: { x: number; y: number; w: number; h: number; cols: number }
}

function posterGeom(W: number, H: number, mode: string, margin: number): PosterGeom {
  if (mode !== 'Poster') {
    return { area: { x: 0, y: 0, w: 1, h: 1 }, wide: W >= H, title: { x: 0, y: 0, size: 0 }, sub: { x: 0, y: 0, size: 0 }, data: { x: 0, y: 0, w: 0, h: 0, cols: 0 } }
  }
  if (W / H < 0.9) {
    const m = margin * W
    const top = m * 0.55
    const textBlock = Math.min(0.52 * W, 0.42 * H)
    const bottom = H - textBlock
    const area = { x: m / W, y: 1 - bottom / H, w: (W - 2 * m) / W, h: (bottom - top) / H }
    return {
      area, wide: false,
      title: { x: m, y: bottom + 0.088 * W, size: 0.075 * W },
      sub: { x: m, y: bottom + 0.118 * W, size: 0.0145 * W },
      data: { x: m, y: bottom + 0.165 * W, w: W - 2 * m, h: H - (bottom + 0.165 * W) - 0.03 * W, cols: 8 },
    }
  }
  const m = margin * H
  const split = W * 0.64
  const area = { x: m / W, y: m / H, w: (split - m) / W, h: (H - 2 * m) / H }
  const tx = split + m * 0.8
  return {
    area, wide: true,
    title: { x: tx, y: m + 0.1 * H, size: 0.085 * H },
    sub: { x: tx, y: m + 0.14 * H, size: 0.016 * H },
    data: { x: tx, y: m + 0.19 * H, w: W - m - tx, h: H - m - (m + 0.19 * H), cols: 4 },
  }
}

/** Cover-fit an image of aspect `ia` into an area of aspect `aa` (GL uv), with zoom ≥ 1 and pan −1..1. */
function coverXf(ia: number, aa: number, zoom: number, panX: number, panY: number, out: THREE.Vector4) {
  let w = 1, h = 1
  if (ia > aa) w = aa / ia
  else h = ia / aa
  w /= Math.max(1, zoom)
  h /= Math.max(1, zoom)
  const cx = 0.5 + panX * (1 - w) / 2
  const cy = 0.5 - panY * (1 - h) / 2
  out.set(w, h, cx - w / 2, cy - h / 2)
}

function create(ctx: SceneCreateCtx): SceneInstance {
  let W = ctx.width, H = ctx.height
  const seed = Math.floor(Math.random() * 1e9)
  const layout = new Layout(seed,
    { offsetAmt: 0.12, displaceChance: 0.55, stretchMix: 0.3, scanMix: 0.2, zoomMix: 0.15, zoomMax: 2.5, mirrorMix: 0.05, labelChance: 0.2 },
    { aspect: 1, minSize: 0.03, stripChance: 0.25 })

  // ---- images ----
  const blank = new THREE.DataTexture(new Uint8Array([233, 231, 225, 255]), 1, 1, THREE.RGBAFormat)
  blank.needsUpdate = true
  let images: { id: string; tex: THREE.Texture; aspect: number }[] = []
  let cur = 0
  let multi = 'Cycle'

  // ---- instanced cells ----
  const base = new THREE.PlaneGeometry(1, 1)
  const geo = new THREE.InstancedBufferGeometry()
  geo.index = base.index
  geo.setAttribute('position', base.getAttribute('position'))
  const mk = () => { const a = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4); a.setUsage(THREE.DynamicDrawUsage); return a }
  const aRect = mk(), aCell = mk(), aMode = mk(), aMisc = mk(), aImg = mk()
  geo.setAttribute('aRect', aRect)
  geo.setAttribute('aCell', aCell)
  geo.setAttribute('aMode', aMode)
  geo.setAttribute('aMisc', aMisc)
  geo.setAttribute('aImg', aImg)
  geo.instanceCount = 0
  const u: Record<string, THREE.IUniform> = {
    uRes: { value: new THREE.Vector2(W, H) },
    tImg0: { value: blank }, tImg1: { value: blank }, tImg2: { value: blank }, tImg3: { value: blank },
    uXf: { value: Array.from({ length: SLOTS }, () => new THREE.Vector4(1, 1, 0, 0)) },
    uLine: { value: 1 }, uLineAlpha: { value: 0.9 }, uStretch: { value: 0.9 }, uScanAmt: { value: 0.6 }, uScanSpeed: { value: 1 },
    uDrift: { value: 1 }, uFlashAmt: { value: 0.5 }, uTime: { value: 0 },
    uLineColor: { value: new THREE.Color(0xf4f1ea) }, uBlank: { value: new THREE.Color(0xe2dfd8) },
    uEmptyLine: { value: new THREE.Color(0xb7b2a8) }, uWipeColor: { value: new THREE.Color(0xd0281c) },
  }
  const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: u, depthTest: false, depthWrite: false })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.frustumCulled = false
  const scene = new THREE.Scene()
  scene.add(mesh)
  const cam = new THREE.Camera()

  // ---- poster overlay (page, title, data columns, cell labels, empty-state message) ----
  const canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = H
  const c2 = canvas.getContext('2d')!
  const overlayTex = new THREE.CanvasTexture(canvas)
  overlayTex.colorSpace = THREE.NoColorSpace
  overlayTex.minFilter = THREE.LinearFilter
  overlayTex.generateMipmaps = false
  const overlay = ctx.shared.pass(OVERLAY, { tOverlay: { value: overlayTex } }, { transparent: true, blending: THREE.NormalBlending })

  let geom = posterGeom(W, H, 'Poster', 0.065)
  let t = 0
  let lastOverlay = -1
  let lastReshuffle = 0
  let lastOffsets = 0
  let lastCycle = 0
  let built = false
  let frozenLayout = false
  let cellCount = 0
  let tc = 0
  let areaAspect = 1
  const rows: string[][] = []
  const marks: boolean[][] = []
  const rnd = Math.random

  layout.pickImage = () => {
    const n = images.length
    if (n <= 1) return 0
    return multi === 'Mix' ? Math.floor(layout.rand() * n) : cur
  }

  function makeRow() {
    const r = rnd()
    const hx = () => Math.floor(rnd() * 65536).toString(16).padStart(4, '0')
    if (r < 0.25) return `0x${hx()}${hx()}`
    if (r < 0.5) return `${(rnd()).toFixed(6)}`
    if (r < 0.7) return `c${Math.floor(rnd() * 160).toString().padStart(3, '0')} ${(rnd()).toFixed(3)}`
    if (r < 0.85) return `${hx()}.${hx()}`
    return `${Math.floor(rnd() * 999)}`.padStart(3, '0')
  }

  function syncOpts(p: Params) {
    layout.leafOpts.offsetAmt = p.n('offsetAmt')
    layout.leafOpts.displaceChance = p.n('displaceChance')
    layout.leafOpts.stretchMix = p.n('stretchMix')
    layout.leafOpts.scanMix = p.n('scanMix')
    layout.leafOpts.zoomMix = p.n('zoomMix')
    layout.leafOpts.zoomMax = p.n('zoomMax')
    layout.leafOpts.mirrorMix = p.n('mirrorMix')
    layout.leafOpts.labelChance = p.b('labels') ? 0.2 : 0
    layout.growOpts.aspect = areaAspect
    layout.growOpts.minSize = p.n('minSize')
    layout.growOpts.stripChance = p.n('stripChance')
  }

  function rebuildAll(now: number, count: number) {
    layout.root = layout.leafNode(now, 1, 1)
    layout.place()
    layout.grow(count, now)
  }

  function rebuildRandom(now: number) {
    const ints = layout.internals().filter(i => i.depth > 0 && i.size <= Math.max(4, cellCount * 0.45))
    if (!ints.length) return
    const ws = ints.map(i => 1 / (1 + i.size * 0.15))
    let pick = rnd() * ws.reduce((s, v) => s + v, 0)
    for (let i = 0; i < ints.length; i++) {
      if ((pick -= ws[i]) <= 0) { layout.rebuild(ints[i].node, now); break }
    }
  }

  function rebuildAt(now: number, x: number, y: number) {
    layout.place()
    const leaf = layout.hit(x, y)
    if (!leaf) { rebuildRandom(now); return }
    let n: Node = leaf
    for (let i = 0; i < 2; i++) { const pa = layout.parentOf(n); if (pa && pa !== layout.root) n = pa }
    if (n === leaf) { layout.rebuild(leaf, now, 3); return }
    layout.rebuild(n, now, Math.max(3, layout.leaves(n).length + Math.floor(rnd() * 4) - 1))
  }

  /** Image currently visible in a cell (mid-transition counts as whichever covers most of it). */
  function shown(l: Leaf) {
    if (l.t0 < 0) return l.img
    return t - l.t0 > 0.5 * transDur() ? l.to : l.from
  }
  let transDurV = 0.45
  const transDur = () => transDurV

  /** Starts a cell-by-cell transition of every cell to `pick(cell)`, rippling out from (ox, oy) in area coords (y down). */
  function transition(pick: (l: Leaf) => number, ox: number, oy: number, stagger: number) {
    layout.place()
    for (const n of layout.leaves()) {
      const l = n.leaf!
      const to = pick(l)
      const from = shown(l)
      if (to === from && l.t0 < 0) continue
      const cx = n.x + n.w / 2, cy = n.y + n.h / 2
      const dx = (cx - ox) * areaAspect, dy = cy - oy
      const dist = Math.hypot(dx, dy)
      l.from = from
      l.to = to
      l.img = to
      l.t0 = t + dist * stagger + rnd() * 0.12
      // wipe away from the origin: cells right of it reveal left→right, below it top→bottom
      l.wipe = Math.abs(dx) > Math.abs(dy) ? (dx >= 0 ? 0 : 1) : (dy >= 0 ? 3 : 2)
    }
  }

  function nextImage(ox = 0.5, oy = 0.5, stagger = 1.1) {
    const n = images.length
    if (n < 2) return false
    if (multi === 'Mix') {
      transition(() => Math.floor(rnd() * n), ox, oy, stagger)
    } else {
      cur = (cur + 1) % n
      transition(() => cur, ox, oy, stagger)
    }
    lastCycle = t
    return true
  }

  /** Pinch / click / Enter at a point (area coords): next image when there are several (Cycle), else reshuffle there. */
  function act(x: number, y: number) {
    if (images.length >= 2 && multi === 'Cycle') nextImage(x, y)
    else rebuildAt(t, x, y)
  }

  function drawOverlay(p: Params, now: number) {
    const ctx2 = c2
    ctx2.clearRect(0, 0, W, H)
    const accent = p.s('accent')
    const g = geom
    const ax = g.area.x * W, ay = (1 - g.area.y - g.area.h) * H, aw = g.area.w * W, ah = g.area.h * H
    const empty = images.length === 0
    const z = (n: number) => String(n).padStart(2, '0')
    if (p.s('layout') === 'Poster') {
      ctx2.fillStyle = p.s('pageColor')
      ctx2.fillRect(0, 0, W, H)
      ctx2.clearRect(ax, ay, aw, ah)
      ctx2.fillStyle = accent
      ctx2.textBaseline = 'alphabetic'
      const fit = (text: string, size: number, family: string, maxW: number) => {
        ctx2.font = `400 ${size}px ${family}`
        const w = ctx2.measureText(text).width
        if (w > maxW) ctx2.font = `400 ${Math.max(4, size * maxW / w)}px ${family}`
      }
      fit(p.s('title'), g.title.size, '"Playfair Display", Georgia, serif', g.data.w)
      ctx2.fillText(p.s('title'), g.title.x - g.title.size * 0.04, g.title.y)
      fit(p.s('subtitle').toUpperCase(), g.sub.size, '"IBM Plex Mono", monospace', g.wide ? g.data.w : g.data.w * 0.66)
      ctx2.fillText(p.s('subtitle').toUpperCase(), g.title.x, g.sub.y)
      if (p.b('showData')) {
        const d = g.data
        const fs = Math.max(5, (g.wide ? H : W) * 0.0088)
        const lh = fs * 1.55
        const nRows = Math.max(1, Math.floor(d.h / lh))
        const cw = d.w / d.cols
        while (rows.length < d.cols) { rows.push([]); marks.push([]) }
        ctx2.font = `400 ${fs}px "IBM Plex Mono", monospace`
        for (let ci = 0; ci < d.cols; ci++) {
          const col = rows[ci], mk = marks[ci]
          while (col.length < nRows) { col.push(makeRow()); mk.push(rnd() < 0.03) }
          col.length = nRows; mk.length = nRows
          for (let ri = 0; ri < nRows; ri++) {
            if (rnd() < 0.12) { col[ri] = makeRow(); mk[ri] = rnd() < 0.025 }
            const x = d.x + ci * cw, y = d.y + ri * lh
            ctx2.globalAlpha = 0.85
            ctx2.fillText(col[ri], x, y + fs)
            if (mk[ri]) ctx2.fillRect(x + cw * 0.62, y + fs * 0.25, cw * 0.12, fs * 0.8)
            else if ((ri + ci) % 5 === 0) ctx2.fillText('·', x + cw * 0.7, y + fs)
          }
        }
        ctx2.globalAlpha = 1
        ctx2.font = `400 ${fs * 1.1}px "IBM Plex Mono", monospace`
        const s = Math.floor(now), fr = Math.floor((now % 1) * 30)
        const imgTxt = empty ? 'NO IMAGE' : `IMG ${multi === 'Mix' && images.length > 1 ? 'MIX' : cur + 1}/${images.length}`
        const tcText = `TC ${z(Math.floor(s / 3600))}:${z(Math.floor(s / 60) % 60)}:${z(s % 60)}:${z(fr)} · ${cellCount} CELLS · ${imgTxt}`
        if (g.wide) ctx2.fillText(tcText, g.title.x, g.sub.y + g.sub.size * 2)
        else {
          ctx2.textAlign = 'right'
          ctx2.fillText(tcText, g.title.x + d.w, g.sub.y)
          ctx2.textAlign = 'left'
        }
      }
    }
    if (empty) {
      // empty state: outlined image area + a clear call to action in the red mono type
      const fs = Math.max(9, Math.min(aw, ah) * 0.045)
      ctx2.strokeStyle = '#8f8a80'
      ctx2.lineWidth = Math.max(1, W / 900)
      ctx2.strokeRect(ax + 0.5, ay + 0.5, aw - 1, ah - 1)
      const lines = [p.s('emptyText') || 'LOAD 1–4 IMAGES', 'portraits work best · drop them here', 'or use the Portraits strip in the panel →']
      ctx2.textAlign = 'center'
      ctx2.textBaseline = 'middle'
      const cx = ax + aw / 2, cy = ay + ah / 2
      ctx2.font = `600 ${fs}px "IBM Plex Mono", monospace`
      const bw = Math.min(aw * 0.92, ctx2.measureText(lines[0]).width + fs * 2.4)
      ctx2.fillStyle = p.s('pageColor')
      ctx2.fillRect(cx - bw / 2, cy - fs * 1.5, bw, fs * 4.4)
      ctx2.strokeStyle = accent
      ctx2.strokeRect(cx - bw / 2, cy - fs * 1.5, bw, fs * 4.4)
      ctx2.fillStyle = accent
      ctx2.fillText(lines[0], cx, cy - fs * 0.35)
      ctx2.font = `400 ${fs * 0.42}px "IBM Plex Mono", monospace`
      ctx2.fillText(lines[1].toUpperCase(), cx, cy + fs * 1.05)
      ctx2.fillText(lines[2].toUpperCase(), cx, cy + fs * 1.75)
      ctx2.font = `400 ${fs * 0.36}px "IBM Plex Mono", monospace`
      ctx2.textAlign = 'left'
      ctx2.textBaseline = 'alphabetic'
      ctx2.fillText(`// awaiting input · ${z(Math.floor(now) % 60)}:${z(Math.floor((now % 1) * 30))}`, ax + fs * 0.5, ay + fs * 0.9)
    } else if (p.b('labels')) {
      const fs = Math.max(6, Math.min(W, H) * 0.0105)
      ctx2.font = `400 ${fs}px "IBM Plex Mono", monospace`
      ctx2.fillStyle = accent
      ctx2.textBaseline = 'alphabetic'
      for (const n of layout.leaves()) {
        const l = n.leaf!
        if (!l.label) continue
        const x = ax + n.x * aw, y = ay + n.y * ah, w = n.w * aw, h = n.h * ah
        if (w < fs * 9 || h < fs * 3) continue
        ctx2.fillText(l.label, x + fs * 0.6, y + fs * 1.5)
        let yy = y + fs * 3
        for (const line of l.data) {
          if (yy > y + h - fs * 0.5) break
          ctx2.fillText(rnd() < 0.08 ? line.replace(/\d/g, () => String(Math.floor(rnd() * 10))) : line, x + fs * 0.6, yy)
          yy += fs * 1.35
        }
      }
    }
    overlayTex.needsUpdate = true
  }

  return {
    setImages(list: SceneImage[]) {
      const prevN = images.length
      const keep = new Map(images.map(i => [i.id, i]))
      const next = list.slice(0, SLOTS).map(im => {
        const old = keep.get(im.id)
        if (old) { keep.delete(im.id); return old }
        const tex = new THREE.Texture(im.bitmap as unknown as HTMLImageElement)
        tex.flipY = false
        tex.colorSpace = THREE.NoColorSpace
        tex.minFilter = THREE.LinearMipmapLinearFilter
        tex.magFilter = THREE.LinearFilter
        tex.generateMipmaps = true
        tex.anisotropy = 4
        tex.needsUpdate = true
        return { id: im.id, tex, aspect: im.width / Math.max(1, im.height) }
      })
      for (const old of keep.values()) old.tex.dispose()
      images = next
      for (let i = 0; i < SLOTS; i++) u[`tImg${i}`].value = images[i]?.tex ?? blank
      const n = images.length
      if (!n) { cur = 0; return }
      // jump to a newly added image; keep indices valid after removals
      if (n > prevN && prevN > 0 && multi === 'Cycle') {
        cur = n - 1
        transition(() => cur, 0.5, 0.5, 0.9)
        lastCycle = t
      } else {
        cur = Math.min(cur, n - 1)
        const pick = multi === 'Mix' && n > 1 ? () => Math.floor(rnd() * n) : () => cur
        for (const node of layout.leaves()) {
          const l = node.leaf!
          if (l.img >= n || l.from >= n || l.to >= n || prevN === 0 || multi === 'Mix') { const v = pick(); l.img = l.from = l.to = v; l.t0 = -1 }
        }
      }
    },
    click(x, y) {
      const a = geom.area
      act((x - a.x) / a.w, (y - (1 - a.y - a.h)) / a.h)
      return true
    },
    resize(w, h) {
      W = w; H = h
      u.uRes.value.set(w, h)
      canvas.width = w; canvas.height = h
      overlayTex.dispose()
      lastOverlay = -1
    },
    update(f: FrameCtx) {
      const p = f.p
      const dt = f.time.dt
      t += dt
      geom = posterGeom(W, H, p.s('layout'), p.n('margin'))
      areaAspect = (geom.area.w * W) / (geom.area.h * H)
      syncOpts(p)
      transDurV = p.n('transition')
      const n = images.length
      const empty = n === 0

      // multi-image mode switch
      const m = p.s('multi')
      if (m !== multi) {
        multi = m
        if (n > 1) transition(multi === 'Mix' ? () => Math.floor(rnd() * n) : () => cur, 0.5, 0.5, 0.6)
      }
      for (let i = 0; i < SLOTS; i++) coverXf(images[i]?.aspect ?? 1, areaAspect, p.n('zoom'), p.n('panX'), p.n('panY'), u.uXf.value[i])

      // hands
      let target = p.n('cells')
      let stretch = p.n('stretch')
      let scanAmt = p.n('scanAmount')
      frozenLayout = false
      const hs = f.hands.hands
      for (const h of hs) {
        const k = h.presence * p.n('handAmount')
        stretch += (h.palm.x - stretch) * k
        scanAmt += ((1 - h.palm.y) * 1.6 - scanAmt) * k
        if (h.open && f.hands.mode === 'camera' && p.b('openFreeze')) frozenLayout = true
      }
      if (hs.length >= 2) target = Math.round(4 + Math.min(1, Math.max(0, (f.hands.twoDist - 0.08) / 0.8)) * 156)
      tc += (target - tc) * Math.min(1, dt * 3 + (built ? 0 : 1))

      if (!built) { rebuildAll(t, Math.round(tc)); built = true; lastReshuffle = t; lastCycle = t }
      const area = geom.area
      if (!empty) {
        for (const e of f.hands.events) {
          if (e.type !== 'pinchStart') continue
          act((e.x - area.x) / area.w, (e.y - (1 - area.y - area.h)) / area.h)
        }
      }
      for (const id of f.pulses) {
        if (id === 'reshuffleAll') rebuildAll(t, Math.round(tc))
        else if (id === 'next') nextImage(rnd(), rnd())
        else if (id === 'pulse' && n >= 2 && multi === 'Cycle') nextImage(rnd(), rnd())
        else rebuildRandom(t)
      }
      const every = p.n('reshuffleEvery')
      const cycleEvery = p.n('cycleEvery')
      if (!frozenLayout && !f.frozen) {
        if (every > 0 && t - lastReshuffle > every) { rebuildRandom(t); lastReshuffle = t }
        if (cycleEvery > 0 && n >= 2 && t - lastCycle > cycleEvery) nextImage(rnd(), rnd())
        if (t - lastOffsets > Math.max(1.5, every * 0.8)) { layout.retargetOffsets(p.n('offsetAmt'), p.n('displaceChance')); lastOffsets = t }
        layout.animate(t, dt, p.n('animate'), p.n('slideSpeed'))
        const cnt = layout.leaves().length
        const want = Math.round(tc)
        if (cnt < want) layout.grow(Math.min(want, cnt + 2), t)
        else if (cnt > want + 1) { layout.shrinkOne(); if (cnt > want + 6) layout.shrinkOne() }
      }
      layout.place()

      // instance data
      const leaves = layout.leaves().slice(0, MAX)
      cellCount = leaves.length
      const R = aRect.array as Float32Array, C = aCell.array as Float32Array, M = aMode.array as Float32Array
      const X = aMisc.array as Float32Array, I = aImg.array as Float32Array
      const flashK = p.n('flash')
      const dur = Math.max(0.05, transDurV)
      leaves.forEach((nd, i) => {
        const l = nd.leaf!
        const cy = 1 - nd.y - nd.h
        C[i * 4] = nd.x; C[i * 4 + 1] = cy; C[i * 4 + 2] = nd.w; C[i * 4 + 3] = nd.h
        R[i * 4] = area.x + nd.x * area.w; R[i * 4 + 1] = area.y + cy * area.h; R[i * 4 + 2] = nd.w * area.w; R[i * 4 + 3] = nd.h * area.h
        M[i * 4] = empty ? -1 : l.mode; M[i * 4 + 1] = l.ox; M[i * 4 + 2] = -l.oy; M[i * 4 + 3] = l.extra
        X[i * 4] = flashK > 0 && !empty ? Math.exp(-(t - l.born) * 5) : 0; X[i * 4 + 1] = l.scan; X[i * 4 + 2] = l.seed; X[i * 4 + 3] = l.scanDir
        let k = 1
        if (l.t0 >= 0) {
          k = Math.min(1, Math.max(0, (t - l.t0) / dur))
          if (k >= 1) { l.from = l.to = l.img; l.t0 = -1 }
        }
        I[i * 4] = Math.min(SLOTS - 1, l.from); I[i * 4 + 1] = Math.min(SLOTS - 1, l.to); I[i * 4 + 2] = k; I[i * 4 + 3] = l.wipe
      })
      geo.instanceCount = leaves.length
      for (const a of [aRect, aCell, aMode, aMisc, aImg]) { a.needsUpdate = true; a.addUpdateRange(0, leaves.length * 4) }

      u.uLine.value = Math.max(0.8, p.n('lineWidth') * f.scale)
      u.uLineAlpha.value = p.n('lineAlpha')
      u.uStretch.value = stretch
      u.uScanAmt.value = scanAmt
      u.uScanSpeed.value = p.n('scanSpeed')
      u.uDrift.value = p.n('drift')
      u.uFlashAmt.value = flashK
      u.uTime.value = t
      u.uLineColor.value.setRGB(...p.c('lineColor'))
      u.uWipeColor.value.setRGB(...p.c('accent'))
      const pc = p.c('pageColor')
      u.uBlank.value.setRGB(pc[0] * 0.965, pc[1] * 0.965, pc[2] * 0.965)

      // overlay at ~10 Hz
      if (lastOverlay < 0 || (t - lastOverlay > 0.1 && !f.frozen)) {
        drawOverlay(p, t)
        lastOverlay = t
      }
    },
    render(f, target) {
      f.renderer.setRenderTarget(target)
      f.renderer.render(scene, cam)
      overlay.render(f.renderer, target)
    },
    status() {
      if (!images.length) return 'no images · load 1–4'
      return `${cellCount} cells · ${images.length > 1 ? (multi === 'Mix' ? `mix of ${images.length}` : `img ${cur + 1}/${images.length}`) : '1 image'}${frozenLayout ? ' · held' : ''}`
    },
    dispose() {
      geo.dispose(); base.dispose(); mat.dispose()
      for (const i of images) i.tex.dispose()
      blank.dispose()
      overlay.dispose(); overlayTex.dispose()
    },
  }
}

// Inspired by TouchDesigner reels by Ivan Puñal García.
const uva: SceneDef = {
  id: 'uva',
  name: 'Cell Poster',
  tag: 'sliced image cells',
  blurb: 'Your portraits cut into a living guillotine grid: every cell offsets, smears, scans or zooms its slice of the image, framed as an editorial poster.',
  color: '#ff6b4a',
  needs: { hands: true, handMapping: 'frame', source: false },
  images: { max: 4, label: 'Portraits', hint: 'Load 1–4 images (portraits work best). Several images: Cycle swaps the whole grid cell by cell, Mix lets cells pull from all of them.' },
  params: [
    { id: 'multi', label: 'Multi-image', group: 'Images', type: 'enum', options: ['Cycle', 'Mix'], default: 'Cycle', random: false },
    { id: 'cycleEvery', label: 'Auto next (s)', group: 'Images', type: 'float', min: 0, max: 30, step: 0.5, default: 6, random: false },
    { id: 'transition', label: 'Cell transition (s)', group: 'Images', type: 'float', min: 0.1, max: 2, step: 0.01, default: 0.45 },
    { id: 'zoom', label: 'Image zoom', group: 'Images', type: 'float', min: 1, max: 3, step: 0.01, default: 1, random: [1, 1.4] },
    { id: 'panX', label: 'Image pan X', group: 'Images', type: 'float', min: -1, max: 1, step: 0.01, default: 0, random: false },
    { id: 'panY', label: 'Image pan Y', group: 'Images', type: 'float', min: -1, max: 1, step: 0.01, default: 0, random: false },
    { id: 'next', label: 'Next image', group: 'Images', type: 'pulse', default: 0 },
    { id: 'layout', label: 'Layout', group: 'Layout', type: 'enum', options: ['Poster', 'Full-bleed'], default: 'Poster', random: false },
    { id: 'cells', label: 'Cells', group: 'Layout', type: 'int', min: 2, max: 160, default: 34, random: [10, 90] },
    { id: 'minSize', label: 'Min cell size', group: 'Layout', type: 'float', min: 0.005, max: 0.2, step: 0.001, default: 0.03, random: [0.012, 0.06] },
    { id: 'stripChance', label: 'Strip bursts', group: 'Layout', type: 'float', min: 0, max: 1, step: 0.01, default: 0.3 },
    { id: 'reshuffleEvery', label: 'Reshuffle every (s)', group: 'Layout', type: 'float', min: 0, max: 20, step: 0.1, default: 2.6, random: [1, 8] },
    { id: 'animate', label: 'Slide amount', group: 'Layout', type: 'float', min: 0, max: 2, step: 0.01, default: 1 },
    { id: 'slideSpeed', label: 'Slide speed', group: 'Layout', type: 'float', min: 0.2, max: 10, step: 0.01, default: 3 },
    { id: 'reshuffle', label: 'Reshuffle part', group: 'Layout', type: 'pulse', default: 0 },
    { id: 'reshuffleAll', label: 'Reshuffle all', group: 'Layout', type: 'pulse', default: 0 },
    { id: 'offsetAmt', label: 'Offset', group: 'Cells', type: 'float', min: 0, max: 0.5, step: 0.005, default: 0.11, random: [0.03, 0.25] },
    { id: 'displaceChance', label: 'Displaced cells', group: 'Cells', type: 'float', min: 0, max: 1, step: 0.01, default: 0.6 },
    { id: 'drift', label: 'Drift', group: 'Cells', type: 'float', min: 0, max: 3, step: 0.01, default: 1 },
    { id: 'stretchMix', label: 'Stretch cells', group: 'Cells', type: 'float', min: 0, max: 2, step: 0.01, default: 0.35, random: [0, 1] },
    { id: 'stretch', label: 'Stretch amount', group: 'Cells', type: 'float', min: 0, max: 1, step: 0.01, default: 0.94, random: [0.6, 1] },
    { id: 'scanMix', label: 'Scan cells', group: 'Cells', type: 'float', min: 0, max: 2, step: 0.01, default: 0.25, random: [0, 1] },
    { id: 'scanAmount', label: 'Scan drift', group: 'Cells', type: 'float', min: 0, max: 2, step: 0.01, default: 0.6 },
    { id: 'scanSpeed', label: 'Scan speed', group: 'Cells', type: 'float', min: 0, max: 4, step: 0.01, default: 0.9, random: [0.3, 2] },
    { id: 'zoomMix', label: 'Zoom cells', group: 'Cells', type: 'float', min: 0, max: 2, step: 0.01, default: 0.2, random: [0, 0.8] },
    { id: 'zoomMax', label: 'Max zoom', group: 'Cells', type: 'float', min: 1.2, max: 5, step: 0.01, default: 2.4 },
    { id: 'mirrorMix', label: 'Mirror cells', group: 'Cells', type: 'float', min: 0, max: 2, step: 0.01, default: 0.06, random: [0, 0.3] },
    { id: 'lineWidth', label: 'Line width', group: 'Look', type: 'float', min: 0, max: 4, step: 0.05, default: 1.3, random: false },
    { id: 'lineAlpha', label: 'Line opacity', group: 'Look', type: 'float', min: 0, max: 1, step: 0.01, default: 0.85, random: false },
    { id: 'lineColor', label: 'Line color', group: 'Look', type: 'color', default: '#f4f1ea' },
    { id: 'flash', label: 'New-cell flash', group: 'Look', type: 'float', min: 0, max: 1, step: 0.01, default: 0.35 },
    { id: 'title', label: 'Title', group: 'Poster', type: 'text', default: 'CELLS' },
    { id: 'subtitle', label: 'Subtitle', group: 'Poster', type: 'text', default: 'Live visuals · realtime cell study · TouchLab' },
    { id: 'emptyText', label: 'Empty message', group: 'Poster', type: 'text', default: 'LOAD 1–4 IMAGES' },
    { id: 'pageColor', label: 'Page', group: 'Poster', type: 'color', default: '#e9e7e1' },
    { id: 'accent', label: 'Accent', group: 'Poster', type: 'color', default: '#d0281c' },
    { id: 'margin', label: 'Margin', group: 'Poster', type: 'float', min: 0.02, max: 0.15, step: 0.001, default: 0.065, random: false },
    { id: 'showData', label: 'Data columns', group: 'Poster', type: 'bool', default: true },
    { id: 'labels', label: 'Cell labels', group: 'Poster', type: 'bool', default: true },
    { id: 'handAmount', label: 'Hand influence', group: 'Hands', type: 'float', min: 0, max: 1, step: 0.01, default: 0.8, random: false },
    { id: 'openFreeze', label: 'Open palm holds', group: 'Hands', type: 'bool', default: true },
  ],
  presets: {
    Poster: {},
    'Full-bleed': { layout: 'Full-bleed', cells: 44 },
    'Mix grid': { multi: 'Mix', cells: 56, cycleEvery: 0, reshuffleEvery: 1.8 },
    'Scan heavy': { scanMix: 1.2, scanAmount: 1.2, scanSpeed: 1.4, cells: 70, stripChance: 0.5, stretchMix: 0.2, minSize: 0.015 },
    Calm: { cells: 14, animate: 0.25, slideSpeed: 0.8, reshuffleEvery: 9, offsetAmt: 0.05, stripChance: 0.1, flash: 0.1, drift: 0.5, scanSpeed: 0.4, cycleEvery: 10, transition: 0.9 },
    Shatter: { cells: 140, minSize: 0.01, offsetAmt: 0.22, reshuffleEvery: 0.8, slideSpeed: 6, stripChance: 0.4, cycleEvery: 3, transition: 0.25 },
  },
  gestures: [
    'Pinch → next image, rippling cell by cell from your fingers (one image: reshuffle there)',
    'Hand left / right → stretch amount',
    'Hand up / down → scan drift',
    'Open palm → hold the layout',
    'Two hands apart / together → more or fewer cells',
    'Click the output → same as pinch · Enter → next image / reshuffle',
  ],
  create,
}

export default uva
