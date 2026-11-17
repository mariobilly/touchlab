import * as THREE from 'three'
import { GLSL } from '../../gfx/glsl'
import { PingPong, makeTarget } from '../../gfx/targets'
import type { SceneDef, SceneInstance, FrameCtx, SceneCreateCtx } from '../types'
import { randomizeSignal } from './randomize'

// Analog signal errors in one pass with previous-frame feedback: per-line sync tearing,
// hold-loss skew, vertical roll, YIQ chroma bleed and ringing, luminance-banded rainbow
// hue, interlace combing, scanlines, snow, dropouts and head-switching noise.
const FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tSrc, tPrev, tMask, tHeld;
uniform vec4 uXf;
uniform vec2 uRes;
uniform float uTime, uFrame, uScale;
uniform float uIntensity, uTear, uTearFreq, uTearSharp, uBurst, uSkew, uHold, uWrap, uRollPos, uRoll, uVblank;
uniform float uRainbow, uBands, uHueSpread, uHueSpeed, uHueOffset, uChromaBands, uKeepBright, uSat, uBleed, uRing;
uniform float uInterlace, uScan, uLineSize, uSnow, uDrop, uHeadSwitch, uLift, uVig, uPersist, uFreeze, uLoss, uContrast;
uniform float uHasMask, uTarget, uGreyAbove, uLumaDetail, uOtherAmt, uDetailKeep;
${GLSL.all}

vec3 src(vec2 q) { return texture(tSrc, coverUV(q, uXf)).rgb; }

void main() {
  float I = uIntensity;
  float lineH = max(1.0, uLineSize * uScale);
  float row = floor(gl_FragCoord.y / lineH);
  float rows = uRes.y / lineH;
  float loss = uLoss;

  // ---- vertical roll + vblank bar ----
  float yy = fract(vUv.y + uRollPos);
  float vb = uRoll > 0.0005 ? 1.0 - smoothstep(0.0, 0.004, yy - uVblank) : 0.0;

  // ---- horizontal sync: per-line tear, block bursts, hold-loss skew ----
  float t = uTime;
  float n = snoise(vec2(row * uTearFreq * 0.004, t * 1.7));
  float off = (uTear + loss * 1.5) * sign(n) * pow(abs(n), uTearSharp) * 0.12;
  off += uTear * 0.018 * sin(row * 0.045 + t * 2.3) * (0.6 + 0.4 * sin(t * 0.7));
  float blk = floor(row / 9.0);
  float bt = floor(t * 7.0);
  float bh = hash12(vec2(blk, bt));
  if (bh > 1.0 - (uBurst + loss) * 0.22) off += (hash12(vec2(blk + 3.1, bt + 7.0)) - 0.5) * 0.45 * (uBurst + loss);
  off += uSkew * (yy - 0.5) * 0.5;
  // head-switching noise at the bottom of the frame
  float hs = smoothstep(0.065, 0.0, vUv.y) * uHeadSwitch;
  off += hs * (0.06 + (hash12(vec2(row, uFrame)) - 0.5) * 0.05);
  float x = vUv.x * (1.0 + uHold) + off * I + uHold * 0.5 * sin(t * 0.3);
  float outside = 0.0;
  if (uWrap > 0.5) x = fract(x);
  else outside = 1.0 - step(0.0, x) * step(x, 1.0);
  vec2 q = vec2(x, yy);

  // ---- YIQ decode: luma with ringing, chroma low-passed and delayed (bleed) ----
  float px = 1.0 / uRes.x;
  vec3 c0 = src(q);
  float Y = luma(c0);
  float yb = 0.5 * (luma(src(q + vec2(2.5 * px * uScale, 0.0))) + luma(src(q - vec2(2.5 * px * uScale, 0.0))));
  Y += uRing * I * (Y - yb) * 2.0;
  vec2 iq = vec2(0.0);
  float bleed = (uBleed * I + 0.05) * 14.0 * px * uScale;
  for (int k = 0; k < 6; k++) iq += rgb2yiq(src(q - vec2(bleed * float(k), 0.0))).yz;
  iq /= 6.0;
  Y = (Y - 0.5) * uContrast + 0.5;

  // ---- rainbow luma banding + moving chroma bands ----
  float bands = max(1.0, uBands);
  float band = floor(clamp(Y, 0.0, 0.999) * bands) / bands;
  float rn = row / rows;
  // horizontal streaks: noise stretched along x, plus broad drifting bands
  float cb = snoise(vec2(rn * 6.0, t * 0.3)) * uChromaBands * 0.8
           + snoise(vec2((vUv.x + off) * 1.3 + t * 0.15, rn * 70.0 + t * 0.4)) * uChromaBands * 0.45;
  float hue = band * uHueSpread + t * uHueSpeed + uHueOffset + cb;
  vec3 rb = rainbow(fract(hue));
  rb = pow(rb, vec3(0.75)) * mix(1.0, 0.22 + 1.1 * Y, uLumaDetail);
  float m = 1.0;
  if (uHasMask > 0.5) {
    float pm = texture(tMask, coverUV(q, uXf)).r;
    m = uTarget > 1.5 ? mix(1.0, uOtherAmt, pm) : uTarget > 0.5 ? mix(uOtherAmt, 1.0, pm) : 1.0;
  }
  float w = uRainbow * (1.0 - uKeepBright * smoothstep(uGreyAbove, uGreyAbove + 0.22, Y)) * m;
  if (uDetailKeep > 0.0) {
    // without a person mask, keep detailed areas grey and let flat areas take the rainbow
    vec2 o = vec2(7.0 * px * uScale, 7.0 / uRes.y * uScale);
    float e = abs(Y - luma(src(q + vec2(o.x, 0.0)))) + abs(Y - luma(src(q - vec2(o.x, 0.0))))
            + abs(Y - luma(src(q + vec2(0.0, o.y)))) + abs(Y - luma(src(q - vec2(0.0, o.y))));
    w *= 1.0 - uDetailKeep * smoothstep(0.04, 0.22, e);
  }
  vec3 base = yiq2rgb(vec3(Y, iq * uSat));
  vec3 col = mix(base, rb, clamp(w, 0.0, 1.0));

  // ---- scanlines, snow, dropouts (applied to the fresh field only, so feedback never compounds them) ----
  float fy = fract(gl_FragCoord.y / lineH);
  col *= 1.0 - uScan * (0.5 - 0.5 * cos(fy * 6.28318));
  float sn = hash12(gl_FragCoord.xy + vec2(uFrame * 17.0, uFrame * 3.0)) - 0.5;
  col += sn * (uSnow * I + loss * 0.9);
  col = mix(col, vec3(hash12(gl_FragCoord.xy * 0.37 + uFrame)), clamp(loss * loss * 0.6, 0.0, 1.0));
  float dh = hash12(vec2(row, floor(uFrame * 0.5)));
  if (dh > 1.0 - (uDrop * I * 0.04 + loss * 0.08)) {
    float s0 = hash12(vec2(row + 1.7, floor(uFrame * 0.5)));
    float dx = vUv.x - s0;
    if (dx > 0.0) col = mix(col, vec3(1.0), exp(-dx * (6.0 + 30.0 * hash11(row))) * 0.95);
  }
  col += hs * (hash12(vec2(gl_FragCoord.x * 0.05, row + uFrame)) - 0.3) * 0.8;
  col = mix(col, vec3(0.02), vb);
  col = mix(col, vec3(0.0), outside);
  col = col * (1.0 - uLift) + uLift;
  vec2 vc = vUv - 0.5;
  col *= 1.0 - uVig * dot(vc, vc) * 1.6;
  col *= 1.0 - loss * 0.25;
  col = clamp(col, 0.0, 1.0);

  // ---- feedback with the previous output: interlace combing, smear, frozen-frame glitch ----
  vec2 pv = vUv;
  if (mod(row, 2.0) > 0.5) col = mix(col, texture(tPrev, pv).rgb, uInterlace);
  col = mix(col, texture(tPrev, pv - vec2(2.0 * px * uScale, 0.0)).rgb, uPersist);
  if (uFreeze > 0.001) {
    float fb = hash12(vec2(floor(row / 14.0), floor(t * 12.0)));
    vec2 fo = vec2((fb - 0.5) * 0.06 * step(0.75, fb), 0.0);
    vec3 held = texture(tHeld, fract(pv + fo)).rgb;
    held += (hash12(gl_FragCoord.xy + uFrame) - 0.5) * 0.06;
    col = mix(col, held, uFreeze * 0.97);
  }
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`

function create(ctx: SceneCreateCtx): SceneInstance {
  const pp = new PingPong(ctx.width, ctx.height, false)
  pp.clear(ctx.renderer)
  const held = makeTarget(ctx.width, ctx.height)
  let grabHeld = false
  const u: Record<string, THREE.IUniform> = {
    tSrc: { value: null }, tPrev: { value: pp.read.texture }, tMask: { value: null }, tHeld: { value: held.texture },
    uXf: { value: new THREE.Vector4(1, 1, 0, 0) },
    uRes: { value: new THREE.Vector2(ctx.width, ctx.height) },
    uTime: { value: 0 }, uFrame: { value: 0 }, uScale: { value: 1 },
    uIntensity: { value: 1 }, uTear: { value: 0.3 }, uTearFreq: { value: 2 }, uTearSharp: { value: 2 }, uBurst: { value: 0.3 },
    uSkew: { value: 0 }, uHold: { value: 0 }, uWrap: { value: 1 }, uRollPos: { value: 0 }, uRoll: { value: 0 }, uVblank: { value: 0.03 },
    uRainbow: { value: 0.8 }, uBands: { value: 8 }, uHueSpread: { value: 1 }, uHueSpeed: { value: 0.1 }, uHueOffset: { value: 0 },
    uChromaBands: { value: 0.5 }, uKeepBright: { value: 0.6 }, uSat: { value: 0.2 }, uBleed: { value: 0.5 }, uRing: { value: 0.4 },
    uInterlace: { value: 0.5 }, uScan: { value: 0.4 }, uLineSize: { value: 3 }, uSnow: { value: 0.08 }, uDrop: { value: 0.3 },
    uHeadSwitch: { value: 0.5 }, uLift: { value: 0.03 }, uVig: { value: 0.4 }, uPersist: { value: 0.2 }, uFreeze: { value: 0 },
    uLoss: { value: 0 }, uContrast: { value: 1 }, uHasMask: { value: 0 }, uTarget: { value: 0 }, uGreyAbove: { value: 0.5 }, uLumaDetail: { value: 0.5 }, uOtherAmt: { value: 0.1 }, uDetailKeep: { value: 0 },
  }
  const pass = ctx.shared.pass(FRAG, u)
  let t = 0
  let rollPos = 0
  let loss = 0
  let freeze = 0
  let hueHand = 0

  return {
    resize(w, h) {
      pp.setSize(w, h)
      pp.clear(ctx.renderer)
      held.setSize(w, h)
      u.uRes.value.set(w, h)
    },
    update(f: FrameCtx) {
      const p = f.p
      const dt = f.time.dt
      t += dt
      // hands
      const amt = p.n('handAmount')
      let tear = p.n('tear')
      let bands = p.n('bands')
      let fistHeld = false
      let hueTarget = 0
      for (const h of f.hands.hands) {
        const k = h.presence * amt
        tear += (1 - h.palm.y) * 1.6 * k
        hueTarget += (h.palm.x - 0.5) * 1.5 * k
        bands = bands * (1 + (h.openness - 0.6) * 1.4 * k)
        if (h.fist) fistHeld = true
      }
      for (const e of f.hands.events) if (e.type === 'pinchStart') loss = 1
      for (const id of f.pulses) if (id === 'loss' || id === 'pulse') loss = 1
      hueHand += (hueTarget - hueHand) * Math.min(1, dt * 4)
      loss = Math.max(0, loss - dt * 1.4)
      if (fistHeld && freeze < 0.02) grabHeld = true
      freeze += ((fistHeld ? 1 : 0) - freeze) * Math.min(1, dt * 8)
      const roll = p.n('roll') + loss * 0.6
      rollPos = (rollPos + roll * dt * (0.4 + 0.6 * Math.abs(Math.sin(t * 0.9)))) % 1

      u.tSrc.value = f.source.tex
      u.uXf.value.copy(f.source.uvXform)
      u.tPrev.value = pp.read.texture
      u.tMask.value = f.source.mask
      // stills are not segmented (and a mask left over from another source would be wrong),
      // so they fall back to keeping detailed areas grey
      const maskOk = !!f.source.mask && p.b('personMask') && f.source.kind !== 'image'
      u.uHasMask.value = maskOk ? 1 : 0
      u.uDetailKeep.value = maskOk ? p.n('detailKeep') * 0.4 : Math.max(p.n('detailKeep'), p.b('personMask') ? 0.75 : 0)
      u.uTarget.value = ['All', 'Person', 'Background'].indexOf(p.s('rainbowOn'))
      u.uTime.value = t
      u.uFrame.value = f.frozen ? u.uFrame.value : f.time.frame
      u.uScale.value = f.scale
      u.uIntensity.value = p.n('intensity')
      u.uTear.value = tear
      u.uTearFreq.value = p.n('tearFreq')
      u.uTearSharp.value = p.n('tearSharp')
      u.uBurst.value = p.n('burst')
      u.uSkew.value = p.n('skew')
      u.uHold.value = p.n('hHold')
      u.uWrap.value = p.b('wrap') ? 1 : 0
      u.uRollPos.value = rollPos
      u.uRoll.value = roll
      u.uVblank.value = p.n('vblank')
      u.uRainbow.value = p.n('rainbow')
      u.uBands.value = Math.max(1, Math.round(bands))
      u.uHueSpread.value = p.n('hueSpread')
      u.uHueSpeed.value = p.n('hueSpeed')
      u.uHueOffset.value = p.n('hueOffset') + hueHand
      u.uChromaBands.value = p.n('chromaBands')
      u.uKeepBright.value = p.n('keepBright')
      u.uGreyAbove.value = p.n('greyAbove')
      u.uLumaDetail.value = p.n('lumaDetail')
      u.uOtherAmt.value = p.n('otherAmt')
      u.uSat.value = p.n('saturation')
      u.uBleed.value = p.n('bleed')
      u.uRing.value = p.n('ringing')
      u.uContrast.value = p.n('contrast')
      u.uInterlace.value = p.n('interlace')
      u.uScan.value = p.n('scanlines')
      u.uLineSize.value = p.n('lineSize')
      u.uSnow.value = p.n('snow')
      u.uDrop.value = p.n('dropouts')
      u.uHeadSwitch.value = p.n('headSwitch')
      u.uLift.value = p.n('blackLift')
      u.uVig.value = p.n('vignette')
      u.uPersist.value = p.n('persistence')
      u.uFreeze.value = freeze
      u.uLoss.value = loss
    },
    render(f, target) {
      if (grabHeld) { f.shared.copy(pp.read.texture, held); grabHeld = false }
      pass.render(f.renderer, pp.write)
      f.shared.copy(pp.write.texture, target)
      pp.swap()
    },
    status() { return loss > 0.05 ? 'signal lost' : freeze > 0.5 ? 'frame held' : '' },
    dispose() { pass.dispose(); pp.dispose(); held.dispose() },
  }
}

// Inspired by a TouchDesigner reel by Nicklas Mathews.
const signal: SceneDef = {
  id: 'signal',
  name: 'Signal Error',
  tag: 'analog glitch',
  blurb: 'Analog video falling apart in real time: sync tearing, rolling frames, chroma bleed and luminance mapped to saturated rainbow bands.',
  color: '#ff3df2',
  needs: { hands: true, handMapping: 'frame', segmentation: true },
  randomize: randomizeSignal,
  params: [
    { id: 'intensity', label: 'Intensity', group: 'Signal', type: 'float', min: 0, max: 2, step: 0.01, default: 1 },
    { id: 'tear', label: 'Sync tear', group: 'Signal', type: 'float', min: 0, max: 2, step: 0.01, default: 0.35 },
    { id: 'tearFreq', label: 'Tear detail', group: 'Signal', type: 'float', min: 0.1, max: 10, step: 0.01, default: 2.5 },
    { id: 'tearSharp', label: 'Tear sharpness', group: 'Signal', type: 'float', min: 0.5, max: 6, step: 0.01, default: 2.2 },
    { id: 'burst', label: 'Block bursts', group: 'Signal', type: 'float', min: 0, max: 1, step: 0.01, default: 0.25 },
    { id: 'skew', label: 'Hold-loss skew', group: 'Signal', type: 'float', min: -1, max: 1, step: 0.01, default: 0.06 },
    { id: 'hHold', label: 'Horizontal hold', group: 'Signal', type: 'float', min: 0, max: 2, step: 0.01, default: 0 },
    { id: 'wrap', label: 'Wrap around', group: 'Signal', type: 'bool', default: true },
    { id: 'roll', label: 'Vertical roll', group: 'Signal', type: 'float', min: 0, max: 2, step: 0.01, default: 0 },
    { id: 'vblank', label: 'Vblank bar', group: 'Signal', type: 'float', min: 0, max: 0.15, step: 0.001, default: 0.03 },
    { id: 'rainbow', label: 'Rainbow', group: 'Color', type: 'float', min: 0, max: 1, step: 0.01, default: 0.85 },
    { id: 'bands', label: 'Luma bands', group: 'Color', type: 'int', min: 1, max: 32, default: 7 },
    { id: 'hueSpread', label: 'Hue spread', group: 'Color', type: 'float', min: 0, max: 4, step: 0.01, default: 1.3 },
    { id: 'hueSpeed', label: 'Hue cycle', group: 'Color', type: 'float', min: -1, max: 1, step: 0.01, default: 0.12 },
    { id: 'hueOffset', label: 'Hue offset', group: 'Color', type: 'float', min: 0, max: 1, step: 0.01, default: 0 },
    { id: 'chromaBands', label: 'Chroma streaks', group: 'Color', type: 'float', min: 0, max: 2, step: 0.01, default: 0.7 },
    { id: 'keepBright', label: 'Keep subject grey', group: 'Color', type: 'float', min: 0, max: 1, step: 0.01, default: 0.75 },
    { id: 'lumaDetail', label: 'Luma in rainbow', group: 'Color', type: 'float', min: 0, max: 1, step: 0.01, default: 0.55 },
    { id: 'greyAbove', label: 'Grey above luma', group: 'Color', type: 'float', min: 0, max: 1, step: 0.01, default: 0.52 },
    { id: 'saturation', label: 'Source color', group: 'Color', type: 'float', min: 0, max: 2, step: 0.01, default: 0.15 },
    { id: 'contrast', label: 'Contrast', group: 'Color', type: 'float', min: 0.3, max: 2, step: 0.01, default: 1.15 },
    { id: 'bleed', label: 'Chroma bleed', group: 'Color', type: 'float', min: 0, max: 2, step: 0.01, default: 0.6 },
    { id: 'ringing', label: 'Ringing', group: 'Color', type: 'float', min: 0, max: 2, step: 0.01, default: 0.5 },
    { id: 'interlace', label: 'Interlace', group: 'Texture', type: 'float', min: 0, max: 1, step: 0.01, default: 0.35 },
    { id: 'persistence', label: 'Smear', group: 'Texture', type: 'float', min: 0, max: 0.9, step: 0.01, default: 0.15 },
    { id: 'scanlines', label: 'Scanlines', group: 'Texture', type: 'float', min: 0, max: 1, step: 0.01, default: 0.45 },
    { id: 'lineSize', label: 'Line size', group: 'Texture', type: 'float', min: 1, max: 12, step: 0.5, default: 4 },
    { id: 'snow', label: 'Snow', group: 'Texture', type: 'float', min: 0, max: 1, step: 0.01, default: 0.08 },
    { id: 'dropouts', label: 'Dropouts', group: 'Texture', type: 'float', min: 0, max: 2, step: 0.01, default: 0.4 },
    { id: 'headSwitch', label: 'Head switching', group: 'Texture', type: 'float', min: 0, max: 1, step: 0.01, default: 0.5 },
    { id: 'blackLift', label: 'Black lift', group: 'Texture', type: 'float', min: 0, max: 0.3, step: 0.005, default: 0.04 },
    { id: 'vignette', label: 'Vignette', group: 'Texture', type: 'float', min: 0, max: 1, step: 0.01, default: 0.25 },
    { id: 'personMask', label: 'Person mask', group: 'Mask', type: 'bool', default: true },
    { id: 'rainbowOn', label: 'Rainbow on', group: 'Mask', type: 'enum', options: ['All', 'Person', 'Background'], default: 'Background' },
    { id: 'detailKeep', label: 'Keep detail grey', group: 'Mask', type: 'float', min: 0, max: 1, step: 0.01, default: 0.2 },
    { id: 'otherAmt', label: 'Rainbow elsewhere', group: 'Mask', type: 'float', min: 0, max: 1, step: 0.01, default: 0.12 },
    { id: 'handAmount', label: 'Hand influence', group: 'Hands', type: 'float', min: 0, max: 2, step: 0.01, default: 1 },
    { id: 'loss', label: 'Signal loss', group: 'Signal', type: 'pulse', default: 0 },
  ],
  presets: {
    'Rainbow VHS': {},
    'No mask': { personMask: false, rainbowOn: 'All' },
    'Rolling hold': { hHold: 1, roll: 0.25, tear: 0.5, skew: 0.15, rainbow: 0.9, bands: 9 },
    'Dead channel': { personMask: false, rainbowOn: 'All', rainbow: 0.25, saturation: 0, snow: 0.55, tear: 0.9, burst: 0.7, dropouts: 1.6, roll: 0.6, interlace: 0.7, keepBright: 0, contrast: 0.8, blackLift: 0.08 },
    'Subtle tape': { personMask: false, rainbowOn: 'All', intensity: 0.45, rainbow: 0.12, saturation: 0.9, tear: 0.15, burst: 0.05, chromaBands: 0.25, scanlines: 0.25, snow: 0.04, dropouts: 0.2, keepBright: 0.3 },
    'Chroma storm': { rainbowOn: 'All', rainbow: 1, keepBright: 0.2, bands: 16, hueSpread: 2.4, hueSpeed: 0.4, chromaBands: 1.6, tear: 0.7, persistence: 0.55, bleed: 1.4 },
  },
  gestures: [
    'Hand height → more sync tearing',
    'Hand left / right → shift the rainbow hue',
    'Open / close hand → more or fewer luma bands',
    'Pinch → signal-loss burst',
    'Fist → hold the frame (frozen-frame glitch)',
    'Enter → signal-loss burst',
  ],
  create,
}

export default signal
