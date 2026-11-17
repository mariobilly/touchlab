import * as THREE from 'three'
import { GLSL } from '../../gfx/glsl'
import { PingPong, makeTarget, clearTarget } from '../../gfx/targets'
import { Bloom } from '../../gfx/Bloom'
import type { SceneDef, SceneInstance, SceneCreateCtx, FrameCtx } from '../types'

// Ghost Cloud: the source becomes a cream point cloud (luma + edges decide where points live),
// pushed into fake depth and smeared by a feedback accumulator into long motion streaks.

const ANALYSIS = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tSrc, tPrev, tMask;
uniform vec4 uXf;
uniform vec2 uTexel;
uniform float uSmooth, uHasMask, uInvert, uLo, uHi, uFirst;
${GLSL.common}
${GLSL.color}
float L(vec2 uv) { return luma(texture(tSrc, coverUV(uv, uXf)).rgb); }
void main() {
  float c = L(vUv);
  float tl = L(vUv + uTexel * vec2(-1.0, 1.0)), t = L(vUv + uTexel * vec2(0.0, 1.0)), tr = L(vUv + uTexel * vec2(1.0, 1.0));
  float l = L(vUv + uTexel * vec2(-1.0, 0.0)), r = L(vUv + uTexel * vec2(1.0, 0.0));
  float bl = L(vUv + uTexel * vec2(-1.0, -1.0)), b = L(vUv + uTexel * vec2(0.0, -1.0)), br = L(vUv + uTexel * vec2(1.0, -1.0));
  float gx = (tr + 2.0 * r + br) - (tl + 2.0 * l + bl);
  float gy = (tl + 2.0 * t + tr) - (bl + 2.0 * b + br);
  float e = clamp(length(vec2(gx, gy)) * 1.6, 0.0, 1.0);
  float lv = uInvert > 0.5 ? 1.0 - c : c;
  float lum = smoothstep(uLo, uHi, lv);
  float m = uHasMask > 0.5 ? smoothstep(0.25, 0.75, texture(tMask, coverUV(vUv, uXf)).r) : 1.0;
  vec4 cur = vec4(lum, e, m, c);
  vec4 prev = texture(tPrev, vUv);
  gl_FragColor = uFirst > 0.5 ? cur : mix(cur, prev, uSmooth);
}`

const POINTS_VERT = /* glsl */ `
uniform sampler2D tAna;
uniform float uMaskFill, uThreshold, uEdgeMix, uSize, uPx, uJitter, uJitterSpeed, uTime, uDepth, uOrbit, uTilt, uAspect, uBurst, uScatter;
uniform vec2 uCenter;
varying float vW;
varying float vSeed;
${GLSL.noise}
void main() {
  vec2 uv = position.xy;
  float seed = position.z;
  vec4 a = texture(tAna, uv);
  float w = clamp(mix(a.r, a.g, uEdgeMix) + uMaskFill, 0.0, 1.0) * a.b;
  float vis = smoothstep(uThreshold, uThreshold + 0.08, w + (seed - 0.5) * 0.08);
  vW = w * vis;
  vSeed = seed;
  if (vis <= 0.002) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
  vec3 p = vec3(uv * 2.0 - 1.0, 0.0);
  p.x *= uAspect;
  p.z = (a.a - 0.5) * uDepth + (seed - 0.5) * uDepth * 0.15;
  // curl-noise jitter: weak areas fray more, like a noisy depth sensor
  vec2 jit = curl2(vec3(uv * 5.0 + seed * 0.37, uTime * uJitterSpeed + seed * 3.0));
  p.xy += jit * uJitter * 0.0035 * (0.4 + (1.0 - w) * 1.2);
  // scatter burst away from the center
  vec2 c = vec2((uCenter.x * 2.0 - 1.0) * uAspect, uCenter.y * 2.0 - 1.0);
  vec3 rnd = hash33(vec3(seed * 91.7, uv * 53.1)) - 0.5;
  vec3 dir = normalize(vec3(p.xy - c, 0.0) + rnd * 0.9 + vec3(0.0, 0.0, 0.0001));
  p += dir * uBurst * uScatter * (0.15 + seed * 0.85);
  // slow orbit for parallax (fake 3D camera)
  float ca = cos(uOrbit), sa = sin(uOrbit);
  p = vec3(ca * p.x + sa * p.z, p.y, -sa * p.x + ca * p.z);
  float ct = cos(uTilt), st = sin(uTilt);
  p = vec3(p.x, ct * p.y - st * p.z, st * p.y + ct * p.z);
  float persp = 3.2 / (3.2 - p.z);
  vec2 ndc = p.xy * persp;
  ndc.x /= uAspect;
  gl_Position = vec4(ndc, 0.0, 1.0);
  gl_PointSize = max(1.0, uSize * uPx * (0.5 + 0.9 * w) * persp);
}`

const POINTS_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uColor;
uniform float uBright;
varying float vW;
varying float vSeed;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.05, d);
  float b = uBright * (0.5 + 0.7 * vW) * (0.75 + vSeed * 0.5);
  gl_FragColor = vec4(uColor * a * b, 1.0);
}`

const FEEDBACK = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tPrev, tPts;
uniform float uMode, uLen, uDecay, uAspect, uGain;
uniform vec2 uDir, uCenter;
void main() {
  vec2 v;
  if (uMode < 0.5) {
    v = uDir;
  } else {
    vec2 d = vUv - uCenter;
    d.x *= uAspect;
    if (uMode < 1.5) v = d * uLen * 3.0;                 // radial: everything streams outward
    else if (uMode < 2.5) v = -d * uLen * 3.0;           // zoom: pulled in toward the center
    else v = vec2(-d.y, d.x) * uLen * 3.0;               // swirl
    v.x /= uAspect;
  }
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 10; i++) {
    float k = float(i) / 9.0;
    acc += texture(tPrev, vUv - v * k).rgb;
  }
  acc /= 10.0;
  vec3 pts = texture(tPts, vUv).rgb;
  gl_FragColor = vec4(acc * uDecay + pts * uGain, 1.0);
}`

const COMPOSITE = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tAcc, tPts;
uniform vec3 uBg, uTint, uColor;
uniform float uExposure, uGrain, uVig, uTime, uPtsMix, uRes;
${GLSL.noise}
void main() {
  // accumulated light → one intensity, re-coloured so dense areas saturate to cream, not white
  float a = dot(texture(tAcc, vUv).rgb, vec3(0.3333));
  float p = dot(texture(tPts, vUv).rgb, vec3(0.3333));
  float ia = 1.0 - exp(-a * uExposure);
  float ip = 1.0 - exp(-p * uPtsMix * uExposure);
  vec3 m = max(uTint * ia, uColor * ip);
  m = m + (vec3(1.0) - m) * pow(max(ia, ip), 6.0) * 0.35;
  // a faint cool lift in the darks, like the reel's slate backdrop
  vec3 bg = uBg * (1.0 + 0.12 * (vnoise(vUv * 3.0 + uTime * 0.05) - 0.5));
  vec3 col = vec3(1.0) - (vec3(1.0) - bg) * (vec3(1.0) - m);
  vec2 q = vUv - 0.5;
  col *= 1.0 - uVig * dot(q, q) * 1.6;
  float g = hash12(vUv * uRes + fract(uTime * 13.17) * 917.0) - 0.5;
  col += g * uGrain * 0.12;
  gl_FragColor = vec4(col, 1.0);
}`

function anaSize(aspect: number): [number, number] {
  return aspect < 1 ? [Math.round(640 * aspect), 640] : [640, Math.round(640 / aspect)]
}

function buildGrid(count: number, aspect: number) {
  const gh = Math.max(4, Math.round(Math.sqrt(count / aspect)))
  const gw = Math.max(4, Math.round(count / gh))
  const pos = new Float32Array(gw * gh * 3)
  let i = 0
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      pos[i++] = (x + Math.random()) / gw
      pos[i++] = (y + Math.random()) / gh
      pos[i++] = Math.random()
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6)
  return { geo: g, n: gw * gh }
}

function create(ctx: SceneCreateCtx): SceneInstance {
  let W = ctx.width, H = ctx.height
  let aspect = W / H
  let [aw, ah] = anaSize(aspect)
  const ana = new PingPong(aw, ah, true)
  let ptsRT = makeTarget(W, H, { float: true })
  const acc = new PingPong(W, H, true)
  let comp = makeTarget(W, H, { float: true })
  const bloom = new Bloom(W, H)
  let first = true

  const anaU: Record<string, THREE.IUniform> = {
    tSrc: { value: null }, tPrev: { value: null }, tMask: { value: null }, uXf: { value: new THREE.Vector4() },
    uTexel: { value: new THREE.Vector2(1 / aw, 1 / ah) }, uSmooth: { value: 0.5 }, uHasMask: { value: 0 }, uInvert: { value: 0 },
    uLo: { value: 0.1 }, uHi: { value: 0.8 }, uFirst: { value: 1 },
  }
  const anaPass = ctx.shared.pass(ANALYSIS, anaU)

  const ptsU: Record<string, THREE.IUniform> = {
    tAna: { value: null }, uMaskFill: { value: 0 }, uThreshold: { value: 0.2 }, uEdgeMix: { value: 0.4 }, uSize: { value: 2 }, uPx: { value: 1 },
    uJitter: { value: 1 }, uJitterSpeed: { value: 0.3 }, uTime: { value: 0 }, uDepth: { value: 0.6 }, uOrbit: { value: 0 }, uTilt: { value: 0 },
    uAspect: { value: aspect }, uBurst: { value: 0 }, uScatter: { value: 0.5 }, uCenter: { value: new THREE.Vector2(0.5, 0.5) },
    uColor: { value: new THREE.Color() }, uBright: { value: 1 },
  }
  const ptsMat = new THREE.ShaderMaterial({
    vertexShader: POINTS_VERT, fragmentShader: POINTS_FRAG, uniforms: ptsU,
    blending: THREE.AdditiveBlending, transparent: true, depthTest: false, depthWrite: false,
  })
  let grid = buildGrid(230_000, aspect)
  let gridKey = `230|${aspect.toFixed(3)}`
  const points = new THREE.Points(grid.geo, ptsMat)
  points.frustumCulled = false
  const ptsScene = new THREE.Scene()
  ptsScene.add(points)
  const cam = new THREE.Camera()

  const fbU: Record<string, THREE.IUniform> = {
    tPrev: { value: null }, tPts: { value: null }, uMode: { value: 0 }, uLen: { value: 0.02 }, uDecay: { value: 0.85 },
    uAspect: { value: aspect }, uGain: { value: 0.3 }, uDir: { value: new THREE.Vector2() }, uCenter: { value: new THREE.Vector2(0.5, 0.5) },
  }
  const fbPass = ctx.shared.pass(FEEDBACK, fbU)
  const compU: Record<string, THREE.IUniform> = {
    tAcc: { value: null }, tPts: { value: null }, uBg: { value: new THREE.Color() }, uTint: { value: new THREE.Color() },
    uColor: { value: new THREE.Color() }, uExposure: { value: 1.2 }, uGrain: { value: 0.5 }, uVig: { value: 0.5 }, uTime: { value: 0 }, uPtsMix: { value: 1 }, uRes: { value: H },
  }
  const compPass = ctx.shared.pass(COMPOSITE, compU)

  const center = new THREE.Vector2(0.5, 0.5)
  const wind = new THREE.Vector2()
  let burst = 0
  let t = 0
  let holding = false
  let hasMask = false

  const MODES = ['directional', 'radial', 'zoom', 'swirl']

  return {
    resize(w, h) {
      W = w; H = h
      aspect = w / h;
      [aw, ah] = anaSize(aspect)
      ana.setSize(aw, ah)
      ptsRT.setSize(w, h)
      acc.setSize(w, h)
      comp.setSize(w, h)
      bloom.setSize(w, h)
      anaU.uTexel.value.set(1 / aw, 1 / ah)
      first = true
    },
    update(f: FrameCtx) {
      const p = f.p
      const dt = f.time.dt
      t += dt
      // rebuild the grid when density or aspect changes
      const n = Math.round(p.n('density'))
      const key = `${n}|${aspect.toFixed(3)}`
      if (key !== gridKey) {
        grid.geo.dispose()
        grid = buildGrid(n * 1000, aspect)
        points.geometry = grid.geo
        gridKey = key
      }
      // hands: palm = streak center, palm velocity = wind, pinch = hold trails, fist = scatter
      const hands = f.hands.hands
      let tx = p.n('centerX'), ty = p.n('centerY')
      if (!hands.length) { tx += Math.sin(f.time.t * 0.31) * 0.06; ty += Math.cos(f.time.t * 0.23) * 0.05 }
      let wx = 0, wy = 0
      holding = false
      for (const hd of hands) {
        tx = hd.palm.x; ty = 1 - hd.palm.y
        wx += hd.vel.x * hd.presence
        wy += -hd.vel.y * hd.presence
        if (hd.pinching && p.b('pinchHold')) holding = true
      }
      const k = Math.min(1, dt * 6)
      center.x += (tx - center.x) * k
      center.y += (ty - center.y) * k
      const wk = Math.min(1, dt * 4)
      wind.x += (wx - wind.x) * wk
      wind.y += (wy - wind.y) * wk
      for (const e of f.hands.events) if (e.type === 'fist') burst = 1
      if (f.pulses.length) burst = 1
      burst *= Math.exp(-dt * 2.2)

      // analysis
      hasMask = !!f.source.mask && p.b('personMask')
      anaU.tSrc.value = f.source.tex
      anaU.tMask.value = f.source.mask
      anaU.uHasMask.value = hasMask ? 1 : 0
      anaU.uXf.value.copy(f.source.uvXform)
      anaU.uSmooth.value = dt > 0 ? p.n('smoothing') : 1
      anaU.uInvert.value = p.b('invert') ? 1 : 0
      anaU.uLo.value = p.n('lumaLo')
      anaU.uHi.value = Math.max(p.n('lumaLo') + 0.01, p.n('lumaHi'))

      // particles
      const [cr, cg, cb] = p.c('color')
      ptsU.uColor.value.setRGB(cr, cg, cb)
      ptsU.uThreshold.value = p.n('threshold')
      ptsU.uMaskFill.value = hasMask ? p.n('maskFill') : 0
      ptsU.uEdgeMix.value = p.n('edgeMix')
      ptsU.uSize.value = p.n('pointSize')
      ptsU.uPx.value = H / 1920
      ptsU.uJitter.value = p.n('jitter')
      ptsU.uJitterSpeed.value = p.n('jitterSpeed')
      ptsU.uTime.value = t
      ptsU.uDepth.value = p.n('depth')
      ptsU.uOrbit.value = Math.sin(t * 0.27) * p.n('orbit')
      ptsU.uTilt.value = Math.sin(t * 0.19 + 1.3) * p.n('orbit') * 0.35
      ptsU.uAspect.value = aspect
      ptsU.uBurst.value = burst
      ptsU.uScatter.value = p.n('scatter')
      ptsU.uCenter.value.copy(center)
      ptsU.uBright.value = p.n('brightness')

      // trails
      const mode = MODES.indexOf(p.s('mode'))
      const ang = (p.n('angle') * Math.PI) / 180
      const len = p.n('streak')
      const windAmt = p.n('wind')
      const windLen = Math.hypot(wind.x, wind.y) * windAmt
      fbU.uMode.value = Math.max(0, mode)
      fbU.uLen.value = len + windLen * 0.02
      fbU.uDir.value.set(Math.cos(ang) * len + wind.x * windAmt * 0.02, Math.sin(ang) * len + wind.y * windAmt * 0.02)
      fbU.uCenter.value.copy(center)
      fbU.uAspect.value = aspect
      // holding: trails barely fade and new points add only faintly, so the smear freezes without blowing out
      const decay = holding ? 0.985 : p.n('decay')
      fbU.uDecay.value = decay
      fbU.uGain.value = holding ? 0.025 : 1 - decay * 0.85

      const [br, bgc, bb] = p.c('bgColor')
      compU.uBg.value.setRGB(br, bgc, bb)
      const [tr, tg, tb] = p.c('trailTint')
      compU.uTint.value.setRGB(tr, tg, tb)
      compU.uColor.value.setRGB(cr, cg, cb)
      compU.uExposure.value = p.n('exposure')
      compU.uGrain.value = p.n('grain')
      compU.uVig.value = p.n('vignette')
      compU.uTime.value = f.time.t
      compU.uPtsMix.value = p.n('pointMix')
      compU.uRes.value = H
    },
    render(f, target) {
      const r = f.renderer
      const frozen = f.time.dt === 0 && !first
      if (!frozen) {
        // 1. analysis (temporal smoothing via ping-pong)
        anaU.tPrev.value = ana.read.texture
        anaU.uFirst.value = first ? 1 : 0
        anaPass.render(r, ana.write)
        ana.swap()
        // 2. points
        ptsU.tAna.value = ana.read.texture
        clearTarget(r, ptsRT, 0x000000)
        r.setRenderTarget(ptsRT)
        r.render(ptsScene, cam)
        // 3. feedback trails
        if (first) acc.clear(r, 0x000000)
        fbU.tPrev.value = acc.read.texture
        fbU.tPts.value = ptsRT.texture
        fbPass.render(r, acc.write)
        acc.swap()
        first = false
      }
      // 4. composite + bloom
      compU.tAcc.value = acc.read.texture
      compU.tPts.value = ptsRT.texture
      const bl = f.p.n('bloom')
      if (bl > 0.001) {
        compPass.render(r, comp)
        bloom.render(r, comp.texture, target, { threshold: 0.62, strength: bl, radius: 1.6 })
      } else {
        compPass.render(r, target)
      }
    },
    status() {
      return `${(grid.n / 1000).toFixed(0)}k pts${holding ? ' · holding trails' : ''}${hasMask ? ' · person mask' : ''}`
    },
    dispose() {
      ana.dispose(); acc.dispose(); ptsRT.dispose(); comp.dispose(); bloom.dispose()
      anaPass.dispose(); fbPass.dispose(); compPass.dispose()
      grid.geo.dispose(); ptsMat.dispose()
    },
  }
}

// Inspired by a TouchDesigner reel by Julián.
const ghost: SceneDef = {
  id: 'ghost',
  name: 'Ghost Cloud',
  tag: 'streaking point cloud',
  blurb: 'The performer dissolves into a cream point cloud on dark slate, dragged into long motion streaks. Move your hand to blow the particles around; pinch to hold the trails.',
  color: '#f1e7cf',
  needs: { hands: true, handMapping: 'video', segmentation: true },
  params: [
    { id: 'personMask', label: 'Isolate person', group: 'Analysis', type: 'bool', default: true },
    { id: 'maskFill', label: 'Body fill', group: 'Analysis', type: 'float', min: 0, max: 1, step: 0.01, default: 0.3 },
    { id: 'threshold', label: 'Threshold', group: 'Analysis', type: 'float', min: 0, max: 1, step: 0.01, default: 0.22 },
    { id: 'edgeMix', label: 'Edges ↔ light', group: 'Analysis', type: 'float', min: 0, max: 1, step: 0.01, default: 0.35 },
    { id: 'lumaLo', label: 'Black level', group: 'Analysis', type: 'float', min: 0, max: 1, step: 0.01, default: 0.12 },
    { id: 'lumaHi', label: 'White level', group: 'Analysis', type: 'float', min: 0, max: 1, step: 0.01, default: 0.75 },
    { id: 'invert', label: 'Invert light', group: 'Analysis', type: 'bool', default: false },
    { id: 'smoothing', label: 'Temporal smooth', group: 'Analysis', type: 'float', min: 0, max: 0.95, step: 0.01, default: 0.35 },
    { id: 'density', label: 'Points (k)', group: 'Particles', type: 'int', min: 20, max: 500, step: 5, default: 230 },
    { id: 'pointSize', label: 'Point size', group: 'Particles', type: 'float', min: 0.5, max: 8, step: 0.05, default: 2.4 },
    { id: 'jitter', label: 'Jitter', group: 'Particles', type: 'float', min: 0, max: 6, step: 0.01, default: 1.1 },
    { id: 'jitterSpeed', label: 'Jitter speed', group: 'Particles', type: 'float', min: 0, max: 3, step: 0.01, default: 0.4 },
    { id: 'depth', label: 'Depth push', group: 'Particles', type: 'float', min: 0, max: 2, step: 0.01, default: 0.7 },
    { id: 'orbit', label: 'Camera orbit', group: 'Particles', type: 'float', min: 0, max: 1, step: 0.01, default: 0.22 },
    { id: 'brightness', label: 'Brightness', group: 'Particles', type: 'float', min: 0, max: 3, step: 0.01, default: 1.1 },
    { id: 'mode', label: 'Streak mode', group: 'Trails', type: 'enum', options: ['directional', 'radial', 'zoom', 'swirl'], default: 'directional' },
    { id: 'streak', label: 'Streak length', group: 'Trails', type: 'float', min: 0, max: 0.08, step: 0.001, default: 0.009 },
    { id: 'angle', label: 'Wind angle', group: 'Trails', type: 'float', min: -180, max: 180, step: 1, default: 180 },
    { id: 'decay', label: 'Trail decay', group: 'Trails', type: 'float', min: 0, max: 0.99, step: 0.005, default: 0.84 },
    { id: 'wind', label: 'Hand wind', group: 'Trails', type: 'float', min: 0, max: 3, step: 0.01, default: 1 },
    { id: 'centerX', label: 'Center X', group: 'Trails', type: 'float', min: 0, max: 1, step: 0.01, default: 0.5 },
    { id: 'centerY', label: 'Center Y', group: 'Trails', type: 'float', min: 0, max: 1, step: 0.01, default: 0.52 },
    { id: 'color', label: 'Point color', group: 'Look', type: 'color', default: '#f1e7cf' },
    { id: 'trailTint', label: 'Trail tint', group: 'Look', type: 'color', default: '#cfc2ab' },
    { id: 'bgColor', label: 'Background', group: 'Look', type: 'color', default: '#2b3036' },
    { id: 'exposure', label: 'Exposure', group: 'Look', type: 'float', min: 0.2, max: 4, step: 0.01, default: 1.6 },
    { id: 'pointMix', label: 'Sharp points', group: 'Look', type: 'float', min: 0, max: 2, step: 0.01, default: 0.9 },
    { id: 'bloom', label: 'Bloom', group: 'Look', type: 'float', min: 0, max: 2, step: 0.01, default: 0.35 },
    { id: 'grain', label: 'Grain', group: 'Look', type: 'float', min: 0, max: 2, step: 0.01, default: 0.5 },
    { id: 'vignette', label: 'Vignette', group: 'Look', type: 'float', min: 0, max: 1.5, step: 0.01, default: 0.55 },
    { id: 'pinchHold', label: 'Pinch holds trails', group: 'Hands', type: 'bool', default: true },
    { id: 'scatter', label: 'Fist scatter', group: 'Hands', type: 'float', min: 0, max: 2, step: 0.01, default: 0.6 },
    { id: 'burst', label: 'Scatter burst', group: 'Hands', type: 'pulse', default: 0 },
  ],
  presets: {
    Ghost: {},
    Windblown: { mode: 'directional', angle: 180, streak: 0.024, decay: 0.92, jitter: 1.6, orbit: 0.12, edgeMix: 0.45 },
    'Zoom burst': { mode: 'radial', streak: 0.03, decay: 0.9, exposure: 1.4, bloom: 0.5, pointSize: 2 },
    'Fine dust': { density: 420, pointSize: 1.3, jitter: 2.4, decay: 0.6, streak: 0.006, edgeMix: 0.6, brightness: 0.8, pointMix: 1.2 },
    Swirl: { mode: 'swirl', streak: 0.02, decay: 0.9, orbit: 0.35 },
    'Raw light': { personMask: false, edgeMix: 0.15, threshold: 0.3, lumaLo: 0.35, lumaHi: 0.9 },
  },
  gestures: [
    'Palm → center of the streaks',
    'Move your hand fast → wind blows the particles',
    'Pinch → hold the trails',
    'Fist → scatter burst (Enter too)',
  ],
  create,
}

export default ghost
