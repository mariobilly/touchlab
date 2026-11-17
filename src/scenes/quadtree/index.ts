import * as THREE from 'three'
import { GLSL } from '../../gfx/glsl'
import type { SceneDef, SceneInstance, FrameCtx } from '../types'

// Recursive quadtree of outline squares, subdivided per pixel in one fragment shader.
// For each level we hash the cell and decide whether it splits from a noise field plus a
// per-level bias; split decisions fade in so new cells don't pop.
const FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform vec2 uRes;
uniform float uTime, uBoilTime, uSeed;
uniform float uDepth, uThreshold, uBias, uNoiseScale, uLine, uLineFalloff, uFillP, uFillRate, uOutline;
uniform float uWobble, uWobbleFreq, uMargin, uInvert, uSrcAmt, uFillFrame, uGlow;
uniform vec3 uFg, uBg;
uniform sampler2D tSrc; uniform vec4 uXf;
uniform vec3 uHands[4];   // xy = point in square space, z = strength
uniform float uAttractR, uAttractS, uLevelFall, uRandom, uFlicker, uGap, uLeafOnly, uBgNoise;
${GLSL.all}

float srcContrast(vec2 p, float cs) {
  // local luminance contrast of the source around p (in square space)
  vec2 q = p;
  float a = luma(texture(tSrc, coverUV(q, uXf)).rgb);
  float b = luma(texture(tSrc, coverUV(q + vec2(cs * 0.5, 0.0), uXf)).rgb);
  float c = luma(texture(tSrc, coverUV(q + vec2(0.0, cs * 0.5), uXf)).rgb);
  return abs(a - b) + abs(a - c) + a * 0.25;
}

void main() {
  vec2 frag = vUv * uRes;
  // square region (or full frame) in pixels
  float side = uFillFrame > 0.5 ? max(uRes.x, uRes.y) : min(uRes.x, uRes.y) * (1.0 - uMargin * 2.0);
  vec2 origin = uFillFrame > 0.5 ? (uRes - vec2(side)) * 0.5 : (uRes - vec2(side)) * 0.5;
  vec2 p = (frag - origin) / side;                  // 0..1 inside the square
  float px = 1.0 / side;                             // one pixel in square units
  vec3 col = uBg;
  if (p.x < -px * 2.0 || p.y < -px * 2.0 || p.x > 1.0 + px * 2.0 || p.y > 1.0 + px * 2.0) {
    gl_FragColor = vec4(mix(uBg, uFg, uInvert), 1.0);
    return;
  }
  float ink = 0.0;     // line coverage
  float fill = 0.0;    // fill coverage
  float fillLine = 0.0;
  float alive = 1.0;   // fade factor for the current level
  int maxL = int(uDepth);
  for (int l = 0; l <= 9; l++) {
    if (l > maxL) break;
    float fl = float(l);
    float n = exp2(fl);
    vec2 cell = floor(p * n);
    vec2 f = fract(p * n);
    if (cell.x < 0.0 || cell.y < 0.0 || cell.x >= n || cell.y >= n) break;
    vec2 center = (cell + 0.5) / n;
    float cid = hash13(vec3(cell, fl + uSeed));
    // hand-drawn wobble: each cell gets its own jagged outline, pulled inward by angular noise
    vec2 g = f - 0.5;
    if (uWobble > 0.0) {
      float ang = atan(g.y, g.x);
      float r = snoise(vec3(cos(ang) * uWobbleFreq * 0.25, sin(ang) * uWobbleFreq * 0.25, cid * 40.0 + uBoilTime));
      g *= 1.0 + abs(r) * uWobble * 0.22 * min(1.0, 0.3 + fl * 0.2) + uGap * 2.0;
    } else {
      g *= 1.0 + uGap * 2.0;
    }
    vec2 dd = (0.5 - abs(g)) / n;          // square units, >0 inside the (inset) square
    float d = min(dd.x, dd.y) / px;        // pixels
    float lw = max(0.7, uLine * pow(uLineFalloff, fl));
    float edge = 1.0 - smoothstep(lw * 0.5 - 0.5, lw * 0.5 + 0.7, abs(d));
    // fill decision for this cell (re-rolled at uFillRate, each cell on its own phase)
    float fh = hash13(vec3(cell + uSeed * 13.0, fl * 7.0 + floor(uTime * uFillRate + cid * 7.0)));
    if (l > 1 && fh < uFillP) {
      float inner = 1.0 - smoothstep(lw * uOutline * 0.5 - 0.5, lw * uOutline * 0.5 + 0.7, abs(d));
      fill = alive * step(0.0, d);
      fillLine = max(fillLine, inner * alive);
      ink = max(ink, edge * alive);
      break;
    }
    if (l == maxL) { ink = max(ink, edge * alive); break; }
    // split decision: smooth noise field mixed with an animated per-cell random value
    float nz = snoise(vec3(center * uNoiseScale * (1.0 + fl * 0.6) + uSeed + fl * 17.0, uTime + fl * 3.1)) * 0.5 + 0.5;
    float ht = uTime * uFlicker + cid * 10.0;
    float h0 = hash13(vec3(cell, fl * 11.0 + floor(ht))), h1 = hash13(vec3(cell, fl * 11.0 + floor(ht) + 1.0));
    float hr = mix(h0, h1, smoothstep(0.0, 1.0, fract(ht)));
    float att = 0.0;
    for (int i = 0; i < 4; i++) {
      vec3 hnd = uHands[i];
      if (hnd.z <= 0.0) continue;
      float dist = length(center - hnd.xy);
      att += hnd.z * uAttractS * exp(-dist * dist / (uAttractR * uAttractR));
    }
    float sc = uSrcAmt > 0.0 ? srcContrast(center, 1.0 / n) * uSrcAmt : 0.0;
    float score = mix(nz, hr, uRandom) + att + sc + uBias - fl * uLevelFall;
    float k = smoothstep(uThreshold - 0.05, uThreshold + 0.05, score);
    // parents' outlines stay unless "leaf only" (each leaf drawn as its own square)
    ink = max(ink, edge * alive * mix(1.0, 1.0 - k, uLeafOnly));
    if (k <= 0.0) break;
    alive *= k;
  }
  vec3 fg = uFg;
  vec3 bg = uBg + uBgNoise * (0.5 + 0.5 * fbm(vec3(p * 3.0, uTime * 0.3 + uSeed))) * vec3(0.35);
  col = bg;
  col = mix(col, uBg, fill);
  col = mix(col, fg, clamp(max(ink * (1.0 - fill), fillLine), 0.0, 1.0));
  // soft glow on bright lines
  col += fg * uGlow * ink * 0.15;
  col = mix(col, vec3(1.0) - col, uInvert);
  gl_FragColor = vec4(col, 1.0);
}`

function create(ctx: { renderer: THREE.WebGLRenderer; width: number; height: number; shared: import('../types').Shared }): SceneInstance {
  const uniforms: Record<string, THREE.IUniform> = {
    uRes: { value: new THREE.Vector2(ctx.width, ctx.height) },
    uTime: { value: 0 }, uBoilTime: { value: 0 }, uSeed: { value: Math.random() * 100 },
    uDepth: { value: 6 }, uThreshold: { value: 0.5 }, uBias: { value: 0 }, uNoiseScale: { value: 2 },
    uLine: { value: 2 }, uLineFalloff: { value: 0.8 }, uFillP: { value: 0.1 }, uFillRate: { value: 1 }, uOutline: { value: 2 },
    uWobble: { value: 0 }, uWobbleFreq: { value: 6 }, uMargin: { value: 0.04 }, uInvert: { value: 0 }, uSrcAmt: { value: 0 },
    uFillFrame: { value: 0 }, uGlow: { value: 0.5 },
    uFg: { value: new THREE.Color(1, 1, 1) }, uBg: { value: new THREE.Color(0, 0, 0) },
    tSrc: { value: null }, uXf: { value: new THREE.Vector4(1, 1, 0, 0) },
    uHands: { value: [0, 1, 2, 3].map(() => new THREE.Vector3()) },
    uAttractR: { value: 0.15 }, uAttractS: { value: 0.6 }, uLevelFall: { value: 0.03 }, uRandom: { value: 0.5 }, uFlicker: { value: 0.3 }, uGap: { value: 0 }, uLeafOnly: { value: 0 }, uBgNoise: { value: 0 },
  }
  const pass = ctx.shared.pass(FRAG, uniforms)
  let t = 0
  let frozenByHand = false

  return {
    resize(w, h) { uniforms.uRes.value.set(w, h) },
    update(f: FrameCtx) {
      const p = f.p
      frozenByHand = f.hands.hands.some(h => h.pinching) && p.b('pinchFreeze')
      if (!frozenByHand) t += f.time.dt * p.n('speed')
      for (const e of f.hands.events) if (e.type === 'open' && p.b('openReseed')) uniforms.uSeed.value = Math.random() * 100
      if (f.pulses.length) uniforms.uSeed.value = Math.random() * 100
      uniforms.uTime.value = t
      const boil = p.n('boilFps')
      uniforms.uBoilTime.value = boil > 0 ? Math.floor(f.time.t * boil) * 0.37 : t
      uniforms.uDepth.value = p.n('depth')
      uniforms.uThreshold.value = p.n('threshold')
      uniforms.uBias.value = p.n('bias')
      uniforms.uLevelFall.value = p.n('levelFall')
      uniforms.uRandom.value = p.n('randomness')
      uniforms.uFlicker.value = p.n('flicker')
      uniforms.uGap.value = p.n('gap')
      uniforms.uLeafOnly.value = p.b('leafOnly') ? 1 : 0
      uniforms.uBgNoise.value = p.n('bgNoise')
      uniforms.uNoiseScale.value = p.n('noiseScale')
      uniforms.uLine.value = p.n('lineWidth') * f.scale
      uniforms.uLineFalloff.value = p.n('lineFalloff')
      uniforms.uFillP.value = p.n('fillProb')
      uniforms.uFillRate.value = p.n('fillRate')
      uniforms.uOutline.value = p.n('outline')
      uniforms.uWobble.value = p.n('wobble')
      uniforms.uWobbleFreq.value = p.n('wobbleFreq')
      uniforms.uMargin.value = p.n('margin')
      uniforms.uInvert.value = p.b('invert') ? 1 : 0
      uniforms.uSrcAmt.value = p.n('sourceAmt')
      uniforms.uFillFrame.value = p.b('fillFrame') ? 1 : 0
      uniforms.uGlow.value = p.n('glow')
      uniforms.uFg.value.setRGB(...p.c('lineColor'))
      uniforms.uBg.value.setRGB(...p.c('bgColor'))
      uniforms.uAttractR.value = p.n('attractRadius')
      uniforms.uAttractS.value = p.n('attractStrength')
      uniforms.tSrc.value = f.source.tex
      uniforms.uXf.value.copy(f.source.uvXform)
      // hands → attractor points in square space (fingertips)
      const W = f.width, H = f.height
      const side = p.b('fillFrame') ? Math.max(W, H) : Math.min(W, H) * (1 - p.n('margin') * 2)
      const ox = (W - side) / 2, oy = (H - side) / 2
      const pts: [number, number, number][] = []
      for (const hand of f.hands.hands) {
        pts.push([hand.index.x, hand.index.y, hand.presence])
        pts.push([hand.thumb.x, hand.thumb.y, hand.presence * 0.6])
      }
      for (let i = 0; i < 4; i++) {
        const v = uniforms.uHands.value[i] as THREE.Vector3
        const q = pts[i]
        if (!q) { v.set(0, 0, 0); continue }
        v.set((q[0] * W - ox) / side, ((1 - q[1]) * H - oy) / side, q[2])
      }
    },
    render(f, target) { pass.render(f.renderer, target) },
    status() { return frozenByHand ? 'frozen by pinch' : '' },
    dispose() { pass.dispose() },
  }
}

// Inspired by a TouchDesigner reel by Simon Alexander-Adams.
const quadtree: SceneDef = {
  id: 'quadtree',
  name: 'Quadtree',
  tag: 'recursive squares',
  blurb: 'Recursive squares that split and merge on a noise field. Your fingertips pull detail toward them; the Wobbly preset boils like hand-drawn ink.',
  color: '#3fa9ff',
  needs: { hands: true, handMapping: 'frame' },
  params: [
    { id: 'depth', label: 'Max depth', group: 'Structure', type: 'int', min: 1, max: 9, default: 7 },
    { id: 'threshold', label: 'Split threshold', group: 'Structure', type: 'float', min: 0, max: 1.2, step: 0.01, default: 0.3 },
    { id: 'bias', label: 'Split bias', group: 'Structure', type: 'float', min: -0.5, max: 0.5, step: 0.01, default: 0.05 },
    { id: 'levelFall', label: 'Depth falloff', group: 'Structure', type: 'float', min: 0, max: 0.2, step: 0.005, default: 0.035 },
    { id: 'randomness', label: 'Randomness', group: 'Structure', type: 'float', min: 0, max: 1, step: 0.01, default: 0.55 },
    { id: 'flicker', label: 'Cell change rate', group: 'Structure', type: 'float', min: 0, max: 4, step: 0.01, default: 0.35 },
    { id: 'noiseScale', label: 'Noise scale', group: 'Structure', type: 'float', min: 0.2, max: 8, step: 0.01, default: 2.2 },
    { id: 'speed', label: 'Speed', group: 'Structure', type: 'float', min: 0, max: 2, step: 0.01, default: 0.25 },
    { id: 'sourceAmt', label: 'Source detail', group: 'Structure', type: 'float', min: 0, max: 3, step: 0.01, default: 0 },
    { id: 'lineWidth', label: 'Line width', group: 'Look', type: 'float', min: 0.5, max: 10, step: 0.1, default: 3 },
    { id: 'lineFalloff', label: 'Line falloff', group: 'Look', type: 'float', min: 0.4, max: 1, step: 0.01, default: 0.72 },
    { id: 'fillProb', label: 'Fill amount', group: 'Look', type: 'float', min: 0, max: 0.6, step: 0.01, default: 0.12 },
    { id: 'fillRate', label: 'Fill change rate', group: 'Look', type: 'float', min: 0, max: 8, step: 0.1, default: 0.6 },
    { id: 'outline', label: 'Fill outline', group: 'Look', type: 'float', min: 1, max: 5, step: 0.1, default: 2.2 },
    { id: 'gap', label: 'Cell gap', group: 'Look', type: 'float', min: 0, max: 0.15, step: 0.002, default: 0 },
    { id: 'leafOnly', label: 'Leaves only', group: 'Look', type: 'bool', default: false },
    { id: 'bgNoise', label: 'Background noise', group: 'Look', type: 'float', min: 0, max: 1, step: 0.01, default: 0 },
    { id: 'glow', label: 'Glow', group: 'Look', type: 'float', min: 0, max: 2, step: 0.01, default: 0.4 },
    { id: 'lineColor', label: 'Line color', group: 'Look', type: 'color', default: '#f4f6ff' },
    { id: 'bgColor', label: 'Background', group: 'Look', type: 'color', default: '#000000' },
    { id: 'invert', label: 'Invert', group: 'Look', type: 'bool', default: false },
    { id: 'margin', label: 'Margin', group: 'Look', type: 'float', min: 0, max: 0.2, step: 0.005, default: 0.03 },
    { id: 'fillFrame', label: 'Fill whole frame', group: 'Look', type: 'bool', default: true },
    { id: 'wobble', label: 'Wobble', group: 'Hand-drawn', type: 'float', min: 0, max: 3, step: 0.01, default: 0 },
    { id: 'wobbleFreq', label: 'Wobble detail', group: 'Hand-drawn', type: 'float', min: 1, max: 30, step: 0.1, default: 9 },
    { id: 'boilFps', label: 'Boil fps', group: 'Hand-drawn', type: 'float', min: 0, max: 24, step: 1, default: 0 },
    { id: 'attractRadius', label: 'Attract radius', group: 'Hands', type: 'float', min: 0.02, max: 0.5, step: 0.005, default: 0.14 },
    { id: 'attractStrength', label: 'Attract strength', group: 'Hands', type: 'float', min: 0, max: 2, step: 0.01, default: 0.7 },
    { id: 'pinchFreeze', label: 'Pinch freezes', group: 'Hands', type: 'bool', default: true },
    { id: 'openReseed', label: 'Open palm reseeds', group: 'Hands', type: 'bool', default: true },
    { id: 'reseed', label: 'Reseed', group: 'Structure', type: 'pulse', default: 0 },
  ],
  presets: {
    Clean: {},
    'Framed square': { fillFrame: false, margin: 0.05 },
    Wobbly: { wobble: 1.2, wobbleFreq: 9, boilFps: 6, lineWidth: 2.6, lineFalloff: 0.8, fillProb: 0.14, gap: 0.06, depth: 6, threshold: 0.36, randomness: 0.7, leafOnly: true, bgNoise: 0.45 },
    Dense: { depth: 9, threshold: 0.3, bias: 0.15, lineWidth: 1.6, lineFalloff: 0.82, fillProb: 0.06 },
    'Source-driven': { sourceAmt: 1.6, threshold: 0.62, noiseScale: 1.2, speed: 0.15, fillFrame: true },
    Blueprint: { lineColor: '#d8ecff', bgColor: '#0b2a6b', fillProb: 0.05, glow: 0.2 },
  },
  // Random look: pick a style family, then vary structure and line within ranges that read well.
  randomize(rnd) {
    const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)]
    const r = (lo: number, hi: number) => lo + (hi - lo) * rnd()
    const palettes: [string, string][] = [
      ['#f4f6ff', '#000000'], ['#f4f6ff', '#000000'], ['#d8ecff', '#0b2a6b'], ['#111111', '#efe9dc'],
      ['#29e6ff', '#05070c'], ['#ff3df2', '#0a0410'], ['#ffd166', '#141008'], ['#9dffb0', '#03110a'], ['#ff5a3c', '#f3efe6'],
    ]
    const [lineColor, bgColor] = pick(palettes)
    const style = pick(['clean', 'clean', 'wobbly', 'dense', 'sparse', 'boxy'])
    const base = {
      lineColor, bgColor, invert: false,
      depth: Math.round(r(5, 8)), threshold: r(0.24, 0.42), bias: r(-0.05, 0.12), levelFall: r(0.01, 0.06),
      randomness: r(0.3, 0.85), flicker: r(0.1, 0.9), noiseScale: r(1, 4.5), speed: r(0.1, 0.5),
      lineWidth: r(1.6, 3.6), lineFalloff: r(0.65, 0.85), fillProb: r(0.04, 0.2), fillRate: r(0.2, 1.5), outline: r(1.6, 3),
      glow: r(0.1, 0.8), gap: 0, leafOnly: false, bgNoise: 0, wobble: 0, boilFps: 0,
    }
    if (style === 'wobbly') Object.assign(base, { wobble: r(0.7, 1.8), wobbleFreq: r(5, 14), boilFps: Math.round(r(4, 10)), gap: r(0.03, 0.08), leafOnly: true, bgNoise: r(0.2, 0.6), depth: Math.round(r(5, 7)) })
    if (style === 'dense') Object.assign(base, { depth: 9, threshold: r(0.22, 0.32), bias: r(0.08, 0.2), lineWidth: r(1.2, 2), fillProb: r(0.02, 0.08) })
    if (style === 'sparse') Object.assign(base, { depth: Math.round(r(4, 6)), threshold: r(0.4, 0.55), lineWidth: r(3, 6), fillProb: r(0.15, 0.35) })
    if (style === 'boxy') Object.assign(base, { gap: r(0.02, 0.06), leafOnly: rnd() < 0.5, outline: r(2.5, 4), fillProb: r(0.2, 0.4) })
    return base
  },
  gestures: [
    'Fingertips → pull subdivision toward them',
    'Pinch → freeze time',
    'Open palm → reseed the pattern',
    'Mouse → move = fingertip, hold left = pinch',
  ],
  create,
}

export default quadtree
