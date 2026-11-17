import * as THREE from 'three'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { GLSL } from '../../gfx/glsl'
import { makeTarget, clearTarget, PingPong } from '../../gfx/targets'
import { Bloom } from '../../gfx/Bloom'
import type { SceneDef, SceneInstance, SceneCreateCtx, FrameCtx, SceneImage, Params, Values } from '../types'
import type { Hand } from '../../input/hands/types'
import { flower, butterfly, tree, dragon, fromImage, KIND_ID, type Cloud, type Kind } from './shapes'
import { jellyfish, koi, phoenix, galaxy, heart, crystal, mushroom, planet, dna, lotus, flame, textCloud } from './shapes2'

// Summon: pinch to conjure glowing particle creatures (flowers, jellyfish, a dragon, a galaxy, your
// own PNGs…) inside a wireframe volume. By default the output is a clean void and the fingertip
// reticle is your cursor; the camera only drives the hands. Open the hand to dissolve, fist to
// implode, point to leave it floating.

const FOV = 35
const CAM_Z = 6
const HH = CAM_Z * Math.tan((FOV / 2) * Math.PI / 180) // half visible height at z = 0

const KINDS: Kind[] = ['flower', 'butterfly', 'tree', 'dragon', 'jellyfish', 'koi', 'phoenix', 'galaxy', 'heart', 'crystal', 'mushroom', 'planet', 'dna', 'lotus', 'flame', 'text']
const OBJECT_OPTIONS = ['Cycle', 'Random', 'Flower', 'Butterfly', 'Tree', 'Dragon', 'Jellyfish', 'Koi', 'Phoenix', 'Galaxy', 'Heart', 'Crystal', 'Mushroom', 'Planet', 'DNA', 'Lotus', 'Flame spirit', 'Text', 'Image']
const LABEL_KIND: Record<string, Kind> = {
  Flower: 'flower', Butterfly: 'butterfly', Tree: 'tree', Dragon: 'dragon', Jellyfish: 'jellyfish', Koi: 'koi', Phoenix: 'phoenix',
  Galaxy: 'galaxy', Heart: 'heart', Crystal: 'crystal', Mushroom: 'mushroom', Planet: 'planet', DNA: 'dna', Lotus: 'lotus',
  'Flame spirit': 'flame', Text: 'text', Image: 'image',
}
const NAMES: Record<Kind, string> = {
  flower: 'LILY', butterfly: 'BUTTERFLY', tree: 'TREE', dragon: 'DRAGON', image: 'IMAGE', jellyfish: 'JELLYFISH', koi: 'KOI',
  phoenix: 'PHOENIX', galaxy: 'GALAXY', heart: 'HEART', crystal: 'CRYSTAL', mushroom: 'MUSHROOM', planet: 'PLANET', dna: 'DNA',
  lotus: 'LOTUS', flame: 'FLAME SPIRIT', text: 'TEXT',
}
const BACKGROUNDS = ['Void', 'Gradient', 'Grid floor', 'Image', 'Camera']
const STYLES = ['Dot', 'Star', 'Square', 'Ring', 'Glow']
const STYLE_SIZE = [1, 2.3, 0.85, 1.7, 2.1]
const COLOR_MODES = ['Natural', 'Tint', 'Rainbow', 'Palette']
const BEHAVIOURS = ['Hold', 'Orbit', 'Float up', 'Lazy']

const BG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tSrc, tGlow, tImg;
uniform vec4 uXf;
uniform float uMode, uTime, uAspect, uImgAspect, uStars, uDim, uDesat, uVig, uGridSpeed, uGridDensity;
uniform vec3 uColA, uColB, uGrid;
${GLSL.common}
${GLSL.color}
${GLSL.noise}
float starLayer(vec2 q, float scale, float dens, float t) {
  vec2 g = q * scale;
  vec2 id = floor(g);
  vec2 f = fract(g) - 0.5;
  float h = hash12(id + 7.3);
  if (h > dens) return 0.0;
  vec2 o = (hash22(id) - 0.5) * 0.7;
  float d = length(f - o);
  float tw = 0.55 + 0.45 * sin(t * (0.8 + h * 30.0) + h * 400.0);
  return smoothstep(0.11, 0.0, d) * tw * (0.35 + 0.65 * h / dens);
}
float stars(vec2 q, float t) { return starLayer(q, 140.0, 0.12, t) * 0.7 + starLayer(q, 55.0, 0.05, t * 0.7) + starLayer(q, 22.0, 0.025, t * 0.5) * 1.3; }
vec3 grade(vec3 c) {
  c = mix(c, vec3(luma(c)), uDesat);
  return c * (1.0 - uDim);
}
void main() {
  vec2 q = vec2((vUv.x - 0.5) * uAspect, vUv.y - 0.5);
  vec3 c;
  if (uMode < 0.5) {
    // void: near-black with a faint drifting nebula and star dust
    c = uColA * (1.0 - 0.6 * length(q));
    float neb = vnoise(q * 2.3 + vec2(uTime * 0.01, 0.0)) * vnoise(q * 4.1 - vec2(0.0, uTime * 0.013) + 3.0);
    c += uColB * 0.55 * smoothstep(0.08, 0.6, neb);
    c += vec3(0.85, 0.9, 1.0) * stars(q, uTime) * uStars;
  } else if (uMode < 1.5) {
    c = mix(uColB, uColA, smoothstep(0.0, 1.0, vUv.y));
    c += uColB * 0.25 * exp(-dot(q, q) * 3.0);
    c += vec3(1.0) * stars(q, uTime) * uStars * 0.5;
  } else if (uMode < 2.5) {
    // retro perspective grid floor
    float hz = 0.4;
    c = mix(uColB, uColA, smoothstep(hz, 1.0, vUv.y));
    c += vec3(0.9, 0.9, 1.0) * stars(q, uTime) * uStars * smoothstep(hz + 0.02, hz + 0.25, vUv.y);
    if (vUv.y < hz) {
      float d = hz - vUv.y;
      float z = 0.09 / d;
      vec2 g = vec2((vUv.x - 0.5) * uAspect * z * 2.4, z + uTime * uGridSpeed) * uGridDensity;
      vec2 fw = max(fwidth(g), vec2(1e-4));
      vec2 gl = abs(fract(g - 0.5) - 0.5) / fw;
      float line = 1.0 - min(min(gl.x, gl.y) / 1.3, 1.0);
      float fade = exp(-z * 0.35);
      c = uColA * 0.7 + uGrid * 0.06;
      c += uGrid * line * (0.15 + 0.95 * fade) * smoothstep(0.0, 0.03, d);
    }
    c += uGrid * exp(-abs(vUv.y - hz) * 70.0) * 0.7;
  } else if (uMode < 3.5) {
    vec2 iu = vUv - 0.5;
    if (uImgAspect > uAspect) iu.x *= uAspect / uImgAspect; else iu.y *= uImgAspect / uAspect;
    iu += 0.5;
    iu.y = 1.0 - iu.y;
    c = grade(texture(tImg, iu).rgb);
  } else {
    c = grade(texture(tSrc, coverUV(vUv, uXf)).rgb);
  }
  vec2 v = vUv - 0.5;
  c *= 1.0 - uVig * dot(v, v) * 1.8;
  c += texture(tGlow, vUv).rgb;
  gl_FragColor = vec4(c, 1.0);
}`

const OBJ_VERT = /* glsl */ `
attribute vec3 acol;
attribute vec3 aux;
attribute float seed;
uniform float uTime, uClock, uMorph, uDissolve, uImplode, uSize, uStyleSize, uPx, uKind, uCurl, uColorMode, uTwinkle, uSizeJit;
uniform vec3 uOrigin, uPivot, uTint, uPalA, uPalB, uPalC;
varying vec3 vColor;
varying float vA;
varying float vHot;
${GLSL.color}
${GLSL.noise}

float gA, gBoost, gMul, gUseCol;
vec3 gCol;

vec3 rotY(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(c * p.x - s * p.z, p.y, s * p.x + c * p.z); }
vec3 rotX(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(p.x, c * p.y - s * p.z, s * p.y + c * p.z); }
vec3 flameColor(float h, float rf) {
  vec3 c = mix(vec3(1.0, 0.95, 0.75), vec3(1.0, 0.55, 0.1), smoothstep(0.1, 0.6, h * 0.8 + rf * 0.5));
  c = mix(c, vec3(0.95, 0.15, 0.05), smoothstep(0.5, 0.8, h));
  return mix(c, vec3(0.55, 0.12, 0.75), smoothstep(0.82, 1.0, h));
}

vec3 animate(vec3 p, float sd) {
  int k = int(uKind + 0.5);
  float t = uTime;
  if (k == 0) {                                   // lily: breathe + sway
    p.x += sin(t * 1.3 + p.y * 2.0) * 0.025 * (p.y + 1.0);
    p *= 1.0 + 0.025 * sin(t * 2.0 + length(p) * 4.0);
  } else if (k == 1) {                            // butterfly: wings flap around the body axis
    if (aux.y > 0.5) {
      float a = (sin(t * 9.0) * 0.5 + 0.5) * 1.25 - 0.15;
      float ax = abs(p.x);
      p = vec3(sign(p.x) * ax * cos(a), p.y, p.z + ax * sin(a));
    }
  } else if (k == 2) {                            // tree: sway grows with height
    float h = clamp(p.y * 0.5 + 0.5, 0.0, 1.0);
    p.x += sin(t * 1.1 + p.y * 1.7) * 0.07 * h * h;
    p.z += cos(t * 0.9 + p.y) * 0.035 * h * h;
    p += (hash33(vec3(sd * 31.0, floor(t * 6.0), 1.0)) - 0.5) * 0.006 * h;
  } else if (k == 3) {                            // dragon: slither + wing beat
    if (abs(aux.y) < 0.5 && aux.x > 0.0) {
      float s = aux.x;
      p.z += sin(t * 2.4 - s * 9.0) * 0.08 * s;
      p.y += cos(t * 2.4 - s * 9.0) * 0.035 * s;
    }
    if (abs(aux.y) > 0.5) {
      vec3 q = rotX(p - uPivot, sin(t * 3.2) * 0.5 * aux.y);
      p = uPivot + q;
    }
  } else if (k == 4) {                            // image: gentle float
    p.z += sin(t * 1.5 + p.x * 3.0) * 0.02;
  } else if (k == 5) {                            // jellyfish: bell pulse, trailing tentacles
    float c = pow(0.5 + 0.5 * sin(t * 2.2), 2.0);
    if (aux.x < 0.5) {
      float rim = aux.y;
      p.xz *= 1.0 - 0.17 * c * rim * rim;
      p.y += 0.05 * c * (1.0 - rim);
      gBoost = c * 0.35 * rim;
    } else {
      float s = aux.y, ph = aux.z;
      p.x += sin(t * 1.7 - s * 5.0 + ph) * 0.09 * s;
      p.z += cos(t * 1.3 - s * 4.0 + ph * 1.3) * 0.07 * s;
      p.y += c * 0.05 * s;
      p.xz *= 1.0 - 0.1 * c * (1.0 - s);
    }
    p.y += sin(t * 2.2 - 1.2) * 0.04;
  } else if (k == 6) {                            // koi: body wave toward the tail, fins flap
    float u = aux.x;
    p.x += sin(t * 4.2 - u * 4.5) * 0.11 * pow(u + 0.15, 1.6);
    if (abs(abs(aux.y) - 2.0) < 0.5) p.z += sin(t * 5.0 + aux.y) * 0.08 * abs(p.x);
    p.y += sin(t * 1.1) * 0.02;
  } else if (k == 7) {                            // phoenix: wing beat, flowing tail, rising embers
    if (abs(aux.y) > 0.5) {
      float side = aux.y;
      float a = sin(t * 3.4) * 0.6 + 0.15;
      vec3 piv = vec3(uPivot.x * side, uPivot.y, uPivot.z);
      vec3 q = p - piv;
      float ax = abs(q.x);
      p = piv + vec3(sign(q.x) * ax * cos(a), q.y + ax * sin(t * 3.4) * 0.18, q.z + ax * sin(a));
    } else if (aux.x > 0.0) {
      float s = aux.x;
      p.x += sin(t * 2.0 - s * 4.0 + aux.z) * 0.12 * s;
      p.z += cos(t * 1.6 - s * 3.0 + aux.z) * 0.08 * s;
    } else if (aux.x < -0.5) {
      float h = fract(aux.z + t * 0.25);
      p.y += h * 1.2 - 0.3;
      p.x += sin(t * 2.0 + aux.z * 20.0) * 0.05 * h;
      gA = sin(h * 3.14159);
    }
    p.y += sin(t * 3.4 - 1.0) * 0.03;
  } else if (k == 8) {                            // galaxy: differential rotation, then tilt
    float r = max(0.08, aux.x);
    // near-rigid pattern rotation so the arms never wind up into rings
    p = rotY(p, -t * 0.22 - 0.05 / (0.3 + r) * sin(t * 0.2));
    p = rotX(p, 1.0);
  } else if (k == 9) {                            // heart: double-thump beat
    float ph = fract(t * 1.15);
    float b = exp(-pow((ph - 0.08) / 0.05, 2.0)) + 0.6 * exp(-pow((ph - 0.3) / 0.06, 2.0));
    p *= 1.0 + 0.13 * b;
    gBoost = b * 0.6;
  } else if (k == 10) {                           // crystal: light climbing each prism
    gBoost = smoothstep(0.75, 1.0, sin(t * 2.0 - aux.x * 7.0 + aux.z)) * (aux.y > 0.5 ? 1.2 : 0.8);
  } else if (k == 11) {                           // mushroom: spores drift up and loop
    if (aux.x > 0.5) {
      float h = fract(aux.z + t * 0.12);
      p.y += h * 0.9;
      p.x += sin(t * 1.3 + aux.z * 30.0) * 0.06 * h;
      gA = sin(h * 3.14159);
      gBoost = 0.4;
    } else {
      p *= 1.0 + 0.012 * sin(t * 1.7 + p.y * 3.0);
    }
  } else if (k == 12) {                           // planet: spin, ring orbits, tilt, day/night
    if (aux.x < 0.5) p = rotY(p, t * 0.35);
    else p = rotY(p, t * 0.5 / pow(max(aux.y, 0.5), 1.5));
    p = rotX(p, 0.42);
    float c2 = cos(0.3), s2 = sin(0.3);
    p = vec3(c2 * p.x - s2 * p.y, s2 * p.x + c2 * p.y, p.z);
    if (aux.x < 0.5) gMul = 0.2 + 0.95 * max(0.0, dot(normalize(p), normalize(vec3(-0.5, 0.4, 0.75))));
  } else if (k == 13) {                           // DNA: rotate the helix, sparkles twinkle
    p = rotY(p, t * 0.8);
    if (aux.y > 1.5) gA = 0.3 + 0.7 * pow(0.5 + 0.5 * sin(t * 3.0 + aux.z * 40.0), 4.0);
  } else if (k == 14) {                           // lotus: petals open and close, pad ripples
    if (aux.x > 0.5 && aux.x < 1.5) {
      float o = sin(t * 0.9) * 0.5 + 0.5;
      float kk = aux.y * aux.z;
      p.xz *= 1.0 + 0.12 * o * kk;
      p.y -= 0.05 * o * kk * aux.z;
    } else if (aux.x > 1.5 && aux.x < 2.5) {
      p.y += sin(aux.y * 6.0 - t * 1.5) * 0.012;
    } else if (aux.x > 2.5) {
      gA = 0.5 + 0.5 * sin(aux.y * 12.0 - t * 2.0);
    }
  } else if (k == 15) {                           // flame spirit: endless upward flow
    if (aux.y < 2.0) {
      float rf = (aux.y - 1.0) / 0.9;
      float h = fract(aux.x + t * 0.32 * (0.75 + sd * 0.5));
      float a = aux.z + h * 1.8 + sin(t * 3.0 + h * 7.0) * 0.25;
      float prof = 0.5 * pow(sin(3.14159 * min(1.0, h * 1.1 + 0.02)), 0.7) * (1.0 - 0.55 * h);
      prof = max(prof, 0.035) * (1.0 + 0.18 * sin(a * 5.0 + t * 5.0 - h * 9.0));
      p = vec3(rf * prof * cos(a) + sin(t * 2.3 + h * 5.0) * 0.06 * h, -1.0 + 2.0 * h, rf * prof * sin(a) * 0.7);
      gCol = flameColor(h, rf) * 1.35;
      gUseCol = 1.0;
      gA = smoothstep(1.0, 0.6, h) * smoothstep(0.0, 0.05, h);
      gBoost = 0.35 * (1.0 - h);
    } else if (aux.y < 3.5) {
      gA = step(0.05, fract(t * 0.23 + 0.3));
      p.y += sin(t * 2.0) * 0.02;
    } else {
      float h = fract(aux.x + t * 0.4);
      p = vec3(p.x + sin(t * 3.0 + aux.z * 10.0) * 0.1 * h, 0.9 + h * 0.7, p.z);
      gA = 1.0 - h;
    }
  } else if (k == 16) {                           // text: a slow wave runs through the letters
    p.z += sin(t * 2.0 + aux.x * 3.0) * 0.06;
    p.y += sin(t * 1.6 + aux.x * 2.5) * 0.03;
  }
  return p;
}

void main() {
  gA = 1.0; gBoost = 0.0; gMul = 1.0; gUseCol = 0.0; gCol = vec3(1.0);
  vec3 p = animate(position, seed);
  // summon: particles leave the fingertip and swirl into the shape, staggered by seed
  float m = clamp(uMorph * 1.7 - seed * 0.7, 0.0, 1.0);
  m = 1.0 - pow(1.0 - m, 3.0);
  vec3 start = uOrigin + (hash33(vec3(seed * 71.3, seed * 13.1, 7.0)) - 0.5) * 0.22;
  vec3 pos = mix(start, p, m);
  pos += curl3(p * 1.3 + vec3(uTime * 0.6)) * 0.22 * (1.0 - m) * m * 4.0;
  // dissolve: curl-noise burst drifting upward
  float d = clamp(uDissolve * 1.35 - seed * 0.35, 0.0, 1.0);
  if (d > 0.0) {
    vec3 out_ = normalize(p + vec3(0.0001));
    pos += curl3(pos * 1.2 + vec3(0.0, uTime * 0.35, seed * 3.0)) * d * uCurl * 0.32 + out_ * d * 0.4 + vec3(0.0, d * d * 0.6, 0.0);
  }
  pos = mix(pos, vec3(0.0), uImplode * uImplode);
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
  float jit = 1.0 + (fract(seed * 137.13) - 0.5) * 2.0 * uSizeJit;
  gl_PointSize = max(0.5, uSize * uStyleSize * uPx * (0.65 + seed * 0.7) * jit * (1.0 + d * 0.6) / -mv.z);
  // colour modes
  vec3 base = gUseCol > 0.5 ? gCol : acol;
  float lum = dot(base, vec3(0.3, 0.59, 0.11));
  vec3 col;
  if (uColorMode < 0.5) col = base;
  else if (uColorMode < 1.5) col = uTint * (0.25 + 1.1 * lum);
  else if (uColorMode < 2.5) col = hsv2rgb(vec3(fract(seed * 0.12 + position.y * 0.22 + uClock * 0.08), 0.75, 0.35 + 0.9 * lum));
  else {
    float tt = fract(lum * 1.3 + position.y * 0.18 + seed * 0.08);
    col = (tt < 0.5 ? mix(uPalA, uPalB, tt * 2.0) : mix(uPalB, uPalC, tt * 2.0 - 1.0)) * (0.45 + 0.9 * lum);
  }
  float tw = mix(1.0, 0.15 + 1.7 * pow(0.5 + 0.5 * sin(uClock * (1.2 + seed * 3.5) + seed * 91.0), 4.0), uTwinkle);
  vHot = uImplode + (1.0 - m) * step(0.001, uMorph) * 0.15 + gBoost;
  vColor = mix(col * gMul, vec3(1.0), d * 0.35 + uImplode * 0.7 + (1.0 - m) * 0.3);
  vA = gA * tw * (1.0 - smoothstep(0.35, 1.0, d)) * (1.0 - smoothstep(0.85, 1.0, uImplode)) * mix(0.25, 1.0, smoothstep(0.0, 0.3, m));
}`

const OBJ_FRAG = /* glsl */ `
precision highp float;
uniform float uGlow, uBright, uStyle, uStyleGain;
varying vec3 vColor;
varying float vA;
varying float vHot;
void main() {
  vec2 q = gl_PointCoord - 0.5;
  float d = length(q);
  float a;
  if (uStyle < 0.5) {
    a = exp(-d * d * 30.0) + exp(-d * d * 7.0) * 0.35 * uGlow;
  } else if (uStyle < 1.5) {
    float rays = exp(-abs(q.x) * 42.0) * exp(-abs(q.y) * 5.5) + exp(-abs(q.y) * 42.0) * exp(-abs(q.x) * 5.5);
    a = exp(-d * d * 70.0) * 1.2 + rays * 0.9 + exp(-d * d * 9.0) * 0.15 * uGlow;
  } else if (uStyle < 2.5) {
    float m = max(abs(q.x), abs(q.y));
    a = (1.0 - smoothstep(0.26, 0.34, m)) * 0.85 + exp(-d * d * 8.0) * 0.15 * uGlow;
  } else if (uStyle < 3.5) {
    a = exp(-pow((d - 0.3) * 13.0, 2.0)) + exp(-d * d * 8.0) * 0.12 * uGlow;
  } else {
    a = exp(-d * d * 9.0) * 0.5 + exp(-d * d * 3.5) * 0.2 * uGlow;
  }
  a *= vA * uBright * 0.45 * uStyleGain * (1.0 + vHot);
  if (a < 0.002) discard;
  gl_FragColor = vec4(vColor * a, 1.0);
}`

const DOT_VERT = /* glsl */ `
uniform float uPx;
void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_PointSize = uPx; }`
const DOT_FRAG = /* glsl */ `
precision highp float;
uniform float uOpacity;
void main() {
  float d = length(gl_PointCoord - 0.5);
  gl_FragColor = vec4(vec3(1.0), smoothstep(0.5, 0.36, d) * uOpacity);
}`

const RET_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`
const RET_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform vec3 uColor;
uniform float uA, uPinch;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float glow = exp(-d * d * 6.0) * 0.22;
  float dot_ = smoothstep(0.07, 0.04, d);
  float ring = exp(-pow((d - 0.42 + uPinch * 0.18) * 24.0, 2.0)) * 0.5;
  gl_FragColor = vec4(uColor * (glow + dot_ + ring) * uA, 1.0);
}`

const TRAIL = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tCur, tPrev;
uniform float uDecay;
void main() { gl_FragColor = vec4(max(texture(tCur, vUv).rgb, texture(tPrev, vUv).rgb * uDecay), 1.0); }`

/** Re-drawable text sprite on its own canvas. */
class Label {
  readonly canvas = document.createElement('canvas')
  private ctx = this.canvas.getContext('2d')!
  readonly tex = new THREE.CanvasTexture(this.canvas)
  readonly mesh: THREE.Mesh
  private text = ''
  aspect = 1
  constructor(private color = '#ffffff', private px = 26) {
    this.canvas.width = 512
    this.canvas.height = 48
    this.tex.colorSpace = THREE.NoColorSpace
    this.tex.minFilter = THREE.LinearFilter
    this.tex.generateMipmaps = false
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthTest: false, depthWrite: false }))
    this.mesh.geometry.translate(0.5, 0, 0)
  }
  set(text: string, color = this.color) {
    if (text === this.text && color === this.color) return
    this.text = text
    this.color = color
    const c = this.ctx
    const font = `500 ${this.px}px "JetBrains Mono", Consolas, monospace`
    c.font = font
    const w = Math.ceil(c.measureText(text).width) + 16
    if (this.canvas.width !== w) { this.canvas.width = w; c.font = font }
    c.clearRect(0, 0, this.canvas.width, this.canvas.height)
    c.textBaseline = 'middle'
    c.shadowColor = 'rgba(0,0,0,0.85)'
    c.shadowBlur = 6
    c.fillStyle = this.color
    c.fillText(text, 8, this.canvas.height / 2 + 1)
    this.aspect = this.canvas.width / this.canvas.height
    this.tex.dispose()
    this.tex.needsUpdate = true
  }
  place(x: number, y: number, h: number, opacity = 1) {
    this.mesh.position.set(x, y, 0)
    this.mesh.scale.set(h * this.aspect, h, 1)
    ;(this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity
    this.mesh.visible = opacity > 0.002
  }
  dispose() { this.tex.dispose(); this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose() }
}

type ObjState = 'summon' | 'held' | 'released' | 'placed' | 'dissolve' | 'implode'
interface Entry { kind: Kind; imageId?: string }
interface Obj {
  kind: Kind
  name: string
  pts: THREE.Points
  mat: THREE.ShaderMaterial
  state: ObjState
  stateT: number
  heldT: number
  morph: number
  dissolve: number
  implode: number
  pos: THREE.Vector3
  target: THREE.Vector3
  scale: number
  targetScale: number
  rotZ: number
  targetRotZ: number
  spin: number
  hand: number | null
  label: Label | null
  count: number
  born: number
  unit: number
  units: number
  ringA: number
  ringR: number
  geoKey: string
  group: number
}
interface HandSlot { pinchT: number; objs: Obj[]; lostT: number; pinch: THREE.Vector3 | null; charge: number }

const hexOf = (p: Params, id: string) => new THREE.Color().setRGB(...p.c(id))

function create(ctx: SceneCreateCtx): SceneInstance {
  let W = ctx.width, H = ctx.height
  let aspect = W / H
  const glowRT = makeTarget(W, H, { float: true })
  const bloomRT = makeTarget(W, H, { float: true })
  const trail = new PingPong(W, H, true)
  let trailFresh = true
  const bloom = new Bloom(W, H)

  const bgU: Record<string, THREE.IUniform> = {
    tSrc: { value: null }, tGlow: { value: null }, tImg: { value: null }, uXf: { value: new THREE.Vector4() },
    uMode: { value: 0 }, uTime: { value: 0 }, uAspect: { value: aspect }, uImgAspect: { value: 1 }, uStars: { value: 0.6 },
    uDim: { value: 0.1 }, uDesat: { value: 0.1 }, uVig: { value: 0.4 }, uGridSpeed: { value: 0.4 }, uGridDensity: { value: 7 },
    uColA: { value: new THREE.Color() }, uColB: { value: new THREE.Color() }, uGrid: { value: new THREE.Color() },
  }
  const bgPass = ctx.shared.pass(BG, bgU)
  const trailU: Record<string, THREE.IUniform> = { tCur: { value: null }, tPrev: { value: null }, uDecay: { value: 0.8 } }
  const trailPass = ctx.shared.pass(TRAIL, trailU)
  const blackTex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1)
  blackTex.needsUpdate = true

  const cam = new THREE.PerspectiveCamera(FOV, aspect, 0.1, 60)
  cam.position.set(0, 0, CAM_Z)
  const objScene = new THREE.Scene()
  const boxScene = new THREE.Scene()
  const ovScene = new THREE.Scene()
  const ovCam = new THREE.OrthographicCamera(0, aspect, 1, 0, -10, 10)

  // ---- wire box with corner dots
  const boxGroup = new THREE.Group()
  const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1))
  const boxGeo = new LineSegmentsGeometry().fromEdgesGeometry(edges)
  edges.dispose()
  const boxMat = new LineMaterial({ color: 0xffffff, linewidth: 1.6, transparent: true, opacity: 0.8, depthTest: false, depthWrite: false })
  boxGroup.add(new LineSegments2(boxGeo, boxMat))
  const corners: THREE.Vector3[] = []
  for (const x of [-0.5, 0.5]) for (const y of [-0.5, 0.5]) for (const z of [-0.5, 0.5]) corners.push(new THREE.Vector3(x, y, z))
  const dotGeo = new THREE.BufferGeometry().setFromPoints(corners)
  const dotMat = new THREE.ShaderMaterial({ vertexShader: DOT_VERT, fragmentShader: DOT_FRAG, uniforms: { uPx: { value: 10 }, uOpacity: { value: 0.95 } }, transparent: true, depthTest: false, depthWrite: false })
  boxGroup.add(new THREE.Points(dotGeo, dotMat))
  boxScene.add(boxGroup)
  const boxLabels = [new Label('#ffffff'), new Label('#ffffff'), new Label('#cfe9ff')]
  for (const l of boxLabels) ovScene.add(l.mesh)
  const boxPos = new THREE.Vector3()
  let boxSpin = 0
  let labelClock = 0

  // ---- fingertip reticles: the user's cursor in the output (screen space)
  const ringPts: number[] = []
  const SEG = 48
  for (let i = 0; i < SEG; i++) {
    if (i % 4 === 3) continue
    const a0 = (i / SEG) * Math.PI * 2, a1 = ((i + 1) / SEG) * Math.PI * 2
    ringPts.push(Math.cos(a0), Math.sin(a0), 0, Math.cos(a1), Math.sin(a1), 0)
  }
  for (const [x, y] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) ringPts.push(x * 1.3, y * 1.3, 0, x * 1.75, y * 1.75, 0)
  const ringGeo = new LineSegmentsGeometry().setPositions(ringPts)
  const glowGeo = new THREE.PlaneGeometry(1, 1)
  const reticles = [0, 1].map(() => {
    const g = new THREE.Group()
    const glowMat = new THREE.ShaderMaterial({
      vertexShader: RET_VERT, fragmentShader: RET_FRAG,
      uniforms: { uColor: { value: new THREE.Color('#7ff3ff') }, uA: { value: 1 }, uPinch: { value: 0 } },
      blending: THREE.AdditiveBlending, transparent: true, depthTest: false, depthWrite: false,
    })
    const glow = new THREE.Mesh(glowGeo, glowMat)
    glow.scale.setScalar(4.2)
    const ringMat = new LineMaterial({ color: 0x7ff3ff, linewidth: 1.6, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false })
    const ring = new LineSegments2(ringGeo, ringMat)
    const arcMat = new LineMaterial({ color: 0xff6ad5, linewidth: 2.6, transparent: true, opacity: 1, depthTest: false, depthWrite: false })
    const arcGeo = new LineSegmentsGeometry()
    const arc = new LineSegments2(arcGeo, arcMat)
    g.add(glow, ring, arc)
    g.visible = false
    ovScene.add(g)
    const label = new Label('#9ff7ff', 24)
    ovScene.add(label.mesh)
    return { g, ring, ringMat, arc, arcGeo, arcMat, glowMat, label, k: -1 }
  })
  const setArc = (r: (typeof reticles)[number], k: number) => {
    const n = Math.max(2, Math.round(40 * k))
    if (n === r.k) return
    r.k = n
    const pts: number[] = []
    for (let i = 0; i < n; i++) {
      const a0 = Math.PI / 2 - (i / 40) * Math.PI * 2, a1 = Math.PI / 2 - ((i + 1) / 40) * Math.PI * 2
      pts.push(Math.cos(a0) * 1.45, Math.sin(a0) * 1.45, 0, Math.cos(a1) * 1.45, Math.sin(a1) * 1.45, 0)
    }
    r.arcGeo.setPositions(pts)
  }

  // ---- shapes & images
  const geoCache = new Map<string, { geo: THREE.BufferGeometry; count: number; pivot: THREE.Vector3 }>()
  let images: SceneImage[] = []
  const bgTextures = new Map<string, THREE.Texture>()
  const toGeo = (c: Cloud) => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(c.pos, 3))
    g.setAttribute('acol', new THREE.BufferAttribute(c.col, 3))
    g.setAttribute('aux', new THREE.BufferAttribute(c.aux, 3))
    const seed = new Float32Array(c.count)
    for (let i = 0; i < c.count; i++) seed[i] = Math.random()
    g.setAttribute('seed', new THREE.BufferAttribute(seed, 1))
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 3)
    return g
  }
  const keyOf = (e: Entry, count: number, text: string) => e.kind === 'image' ? `image:${e.imageId}` : e.kind === 'text' ? `text:${text}:${count}` : `${e.kind}:${count}`
  const getGeo = (e: Entry, count: number, text: string) => {
    const key = keyOf(e, count, text)
    let g = geoCache.get(key)
    if (!g) {
      let cloud: Cloud
      let pivot = new THREE.Vector3()
      switch (e.kind) {
        case 'flower': cloud = flower(count); break
        case 'butterfly': cloud = butterfly(count); break
        case 'tree': cloud = tree(count); break
        case 'dragon': { const d = dragon(count); cloud = d; pivot = new THREE.Vector3(...d.pivot); break }
        case 'jellyfish': cloud = jellyfish(count); break
        case 'koi': cloud = koi(count); break
        case 'phoenix': { const d = phoenix(count); cloud = d; pivot = new THREE.Vector3(...d.pivot); break }
        case 'galaxy': cloud = galaxy(count); break
        case 'heart': cloud = heart(count); break
        case 'crystal': cloud = crystal(count); break
        case 'mushroom': cloud = mushroom(count); break
        case 'planet': cloud = planet(count); break
        case 'dna': cloud = dna(count); break
        case 'lotus': cloud = lotus(count); break
        case 'flame': cloud = flame(count); break
        case 'text': cloud = textCloud(text, count); break
        case 'image': {
          const im = images.find(i => i.id === e.imageId)
          cloud = im ? fromImage(im.bitmap, im.width, im.height, 40000) : flower(count)
          break
        }
      }
      g = { geo: toGeo(cloud), count: cloud.count, pivot }
      geoCache.set(key, g)
    }
    return { ...g, key }
  }

  const objects: Obj[] = []
  const slots: HandSlot[] = [0, 1].map(() => ({ pinchT: 0, objs: [], lostT: 0, pinch: null, charge: 0 }))
  let cycle = 0
  let imgCycle = 0
  let lastRandom = ''
  let t = 0
  let lastSummonT = -10
  let groupId = 0
  let lastP: Params | null = null

  const screenToWorld = (nx: number, ny: number, out = new THREE.Vector3()) => out.set((nx * 2 - 1) * HH * aspect, (1 - ny * 2) * HH, 0)
  const tmpV = new THREE.Vector3()
  const toOverlay = (v: THREE.Vector3) => {
    tmpV.copy(v).project(cam)
    return [((tmpV.x + 1) / 2) * aspect, (tmpV.y + 1) / 2] as const
  }

  const allEntries = (): Entry[] => [...KINDS.map(kind => ({ kind })), ...images.map(im => ({ kind: 'image' as Kind, imageId: im.id }))]
  const entryName = (e: Entry) => {
    if (e.kind !== 'image') return NAMES[e.kind]
    const i = images.findIndex(im => im.id === e.imageId)
    return `IMAGE ${i + 1}`
  }
  const nextEntry = (p: Params, peek = false): Entry => {
    const o = p.s('object')
    if (o === 'Cycle') {
      const list = allEntries()
      const e = list[cycle % list.length]
      if (!peek) cycle++
      return e
    }
    if (o === 'Random') {
      const list = allEntries()
      let e = list[Math.floor(Math.random() * list.length)]
      for (let i = 0; i < 4 && keyOf(e, 0, '') === lastRandom; i++) e = list[Math.floor(Math.random() * list.length)]
      if (!peek) lastRandom = keyOf(e, 0, '')
      return e
    }
    if (o === 'Image') {
      if (!images.length) return { kind: 'flower' }
      const slot = Math.round(p.n('imageSlot'))
      if (slot >= 1) return { kind: 'image', imageId: images[Math.min(slot, images.length) - 1].id }
      const e = { kind: 'image' as Kind, imageId: images[imgCycle % images.length].id }
      if (!peek) imgCycle++
      return e
    }
    return { kind: LABEL_KIND[o] ?? 'flower' }
  }

  const makeMat = (kind: Kind, pivot: THREE.Vector3) => new THREE.ShaderMaterial({
    vertexShader: OBJ_VERT, fragmentShader: OBJ_FRAG,
    uniforms: {
      uTime: { value: 0 }, uClock: { value: 0 }, uMorph: { value: 0 }, uDissolve: { value: 0 }, uImplode: { value: 0 }, uSize: { value: 1 },
      uStyleSize: { value: 1 }, uPx: { value: 1 }, uKind: { value: KIND_ID[kind] }, uCurl: { value: 1 }, uColorMode: { value: 0 },
      uTwinkle: { value: 0 }, uSizeJit: { value: 0 }, uOrigin: { value: new THREE.Vector3() }, uPivot: { value: pivot.clone() },
      uTint: { value: new THREE.Color() }, uPalA: { value: new THREE.Color() }, uPalB: { value: new THREE.Color() }, uPalC: { value: new THREE.Color() },
      uGlow: { value: 1 }, uBright: { value: 1 }, uStyle: { value: 0 }, uStyleGain: { value: 1 },
    },
    blending: THREE.AdditiveBlending, transparent: true, depthTest: false, depthWrite: false,
  })
  // Warm-up: compile the particle shader at scene switch and build shapes in the background
  // (one per couple of frames) so the first pinch never hitches.
  const warmGeo = new THREE.BufferGeometry()
  warmGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3))
  const warmMat = makeMat('flower', new THREE.Vector3())
  {
    const warm = new THREE.Points(warmGeo, warmMat)
    warm.frustumCulled = false
    const sc = new THREE.Scene()
    sc.add(warm)
    try { ctx.renderer.compile(sc, cam) } catch {}
  }
  const warmQueue: Kind[] = [...KINDS]

  const spawnOne = (e: Entry, p: Params, at: THREE.Vector3, hand: number | null, scale: number, unit: number, units: number): Obj => {
    const count = Math.round(p.n('points') * 1000)
    const g = getGeo(e, count, p.s('text'))
    const mat = makeMat(e.kind, g.pivot)
    const pts = new THREE.Points(g.geo, mat)
    pts.frustumCulled = false
    objScene.add(pts)
    let label: Label | null = null
    const name = entryName(e)
    if (unit === 0) {
      label = new Label('#ffffff', 24)
      label.set(`${name}${units > 1 ? ' ×' + units : ''} // ${(g.count * units).toLocaleString('en-US')} pts`)
      ovScene.add(label.mesh)
    }
    const ringA = (unit / units) * Math.PI * 2 + Math.random() * 0.3
    const ringR = units > 1 ? scale * p.n('unitSpread') * (0.85 + Math.random() * 0.3) : 0
    const s = units > 1 ? scale * 0.6 * (0.85 + Math.random() * 0.3) : scale
    const o: Obj = {
      kind: e.kind, name, pts, mat, state: 'summon', stateT: 0, heldT: 0, morph: 0, dissolve: 0, implode: 0,
      pos: at.clone(), target: at.clone(), scale: s * 0.3, targetScale: s, rotZ: 0, targetRotZ: 0,
      spin: (Math.random() - 0.5) * 0.6, hand, label, count: g.count, born: t + unit * 0.37, unit, units, ringA, ringR, geoKey: g.key, group: groupId,
    }
    if (units > 1) o.pos.add(new THREE.Vector3(Math.cos(ringA) * ringR, 0, Math.sin(ringA) * ringR * 0.6))
    objects.push(o)
    return o
  }
  const spawnGroup = (e: Entry, p: Params, at: THREE.Vector3, hand: number | null, scale: number): Obj[] => {
    const units = Math.max(1, Math.min(8, Math.round(p.n('units'))))
    groupId++
    const out: Obj[] = []
    for (let i = 0; i < units; i++) out.push(spawnOne(e, p, at, hand, scale, i, units))
    return out
  }

  const release = (o: Obj, how: 'dissolve' | 'implode' | 'placed') => {
    o.hand = null
    o.state = how
    o.stateT = 0
    if (how === 'placed') {
      const placed = objects.filter(x => x.state === 'placed').sort((a, b) => a.born - b.born)
      const max = Math.max(1, Math.round(lastP?.n('maxObjects') ?? 6)) * Math.max(1, Math.round(lastP?.n('units') ?? 1))
      while (placed.length > max) { const old = placed.shift()!; old.state = 'dissolve'; old.stateT = 0 }
    }
  }
  const releaseAll = (s: HandSlot, how: 'dissolve' | 'implode' | 'placed') => { for (const o of s.objs) release(o, how); s.objs = [] }

  const removeObj = (o: Obj) => {
    objScene.remove(o.pts)
    o.mat.dispose()
    if (o.label) { ovScene.remove(o.label.mesh); o.label.dispose() }
    objects.splice(objects.indexOf(o), 1)
  }

  const objScaleFor = (p: Params, hand: Hand | null) => {
    let s = p.n('objSize') * HH
    if (hand && p.b('handScale')) s *= Math.min(1.8, Math.max(0.55, hand.size / 0.13))
    return s
  }

  /** Where a held unit wants to be, for the chosen behaviour. */
  const heldTarget = (o: Obj, pinch: THREE.Vector3, anchorScale: number, p: Params, out: THREE.Vector3) => {
    const beh = p.s('behaviour')
    const up = anchorScale * 0.75
    let ox = 0, oy = 0, oz = 0
    if (o.units > 1) {
      const a = o.ringA + t * 0.7
      ox = Math.cos(a) * o.ringR
      oy = Math.sin(a * 1.7 + o.ringA) * o.ringR * 0.35
      oz = Math.sin(a) * o.ringR * 0.6
    }
    if (beh === 'Orbit') {
      const a = t * 1.6 + o.ringA
      const R = anchorScale * 1.25 + o.ringR * 0.5
      return out.set(pinch.x + Math.cos(a) * R, pinch.y + anchorScale * 0.35 + Math.sin(a * 0.5) * anchorScale * 0.2 + oy * 0.5, Math.sin(a) * R * 0.7)
    }
    if (beh === 'Float up') {
      const rise = Math.min(o.heldT * 0.5, 1.2) * anchorScale
      return out.set(pinch.x + ox + Math.sin(t * 1.3 + o.ringA) * 0.15 * anchorScale, pinch.y + up + oy + rise, oz)
    }
    return out.set(pinch.x + ox, pinch.y + up + oy, oz)
  }

  /** Per-kind presentation: some creatures face you and sway, others turn on a turntable. */
  const pose = (o: Obj, p: Params) => {
    const spin = p.n('spin')
    const osc = Math.min(1, spin / 0.35)
    const turn = t * spin * (0.6 + o.spin)
    const ph = t + o.born
    let rx = 0, ry = turn, rz = o.rotZ
    switch (o.kind) {
      case 'butterfly': rx = -0.25; ry = Math.sin(ph * 0.6) * 0.55 * osc; break
      case 'phoenix': case 'dragon': case 'flame': ry = Math.sin(ph * 0.45) * 0.45 * osc; break
      case 'koi': rx = -0.35; ry = Math.sin(ph * 0.5) * 0.35 * osc; break
      case 'galaxy': case 'planet': case 'dna': ry = Math.sin(ph * 0.3) * 0.15 * osc; break
      case 'heart': ry = Math.sin(ph * 0.8) * 0.5 * osc; break
      case 'text': case 'image': ry = Math.sin(ph * 0.5) * 0.35 * osc; break
      case 'lotus': rx = 0.55; break
      case 'mushroom': rx = 0.12; break
      case 'jellyfish': rx = 0.15; rz += Math.sin(ph * 0.7) * 0.08; break
    }
    o.pts.rotation.set(rx, ry, rz)
  }

  const setTexOf = (im: SceneImage) => {
    let tex = bgTextures.get(im.id)
    if (!tex) {
      tex = new THREE.Texture(im.bitmap)
      tex.flipY = false
      tex.colorSpace = THREE.NoColorSpace
      tex.minFilter = THREE.LinearFilter
      tex.generateMipmaps = false
      tex.needsUpdate = true
      bgTextures.set(im.id, tex)
    }
    return tex
  }

  return {
    resize(w, h) {
      W = w; H = h; aspect = w / h
      glowRT.setSize(w, h)
      bloomRT.setSize(w, h)
      trail.setSize(w, h)
      trailFresh = true
      bloom.setSize(w, h)
      cam.aspect = aspect
      cam.updateProjectionMatrix()
      ovCam.right = aspect
      ovCam.updateProjectionMatrix()
    },
    update(f: FrameCtx) {
      const p = f.p
      lastP = p
      const dt = f.time.dt
      t += dt
      if (warmQueue.length && f.time.frame % 2 === 0) getGeo({ kind: warmQueue.shift()! }, Math.round(p.n('points') * 1000), p.s('text'))
      const beh = p.s('behaviour')

      // ---- per-hand state machine
      const present = new Set<number>()
      for (const hand of f.hands.hands) {
        const id = Math.min(1, hand.id)
        present.add(id)
        const s = slots[id]
        s.lostT = 0
        const px = (hand.index.x + hand.thumb.x) / 2, py = (hand.index.y + hand.thumb.y) / 2
        const pw = screenToWorld(px, py, s.pinch ?? new THREE.Vector3())
        s.pinch = pw
        const scale = objScaleFor(p, hand)
        if (hand.pinching) {
          s.pinchT += dt
          s.charge = Math.min(1, s.pinchT / 0.15)
          if (!s.objs.length && s.pinchT >= 0.15 && dt > 0) {
            s.objs = spawnGroup(nextEntry(p), p, pw.clone().add(new THREE.Vector3(0, scale * 0.75, 0)), id, scale)
            lastSummonT = t
          }
        } else {
          s.pinchT = 0
          s.charge = 0
          for (const o of s.objs) if (o.state === 'summon' || o.state === 'held') { o.state = 'released'; o.stateT = 0 }
        }
        if (s.objs.length) {
          for (const o of s.objs) {
            if (o.state === 'summon' || o.state === 'held' || o.state === 'released') {
              heldTarget(o, pw, scale, p, o.target)
              o.targetScale = o.units > 1 ? o.targetScale : scale
              o.targetRotZ = -hand.roll * 0.8
            }
          }
          const lead = s.objs[0]
          if (lead.state === 'released') {
            if (hand.fist) releaseAll(s, 'implode')
            else if (hand.point) releaseAll(s, 'placed')
            else if (hand.open || lead.stateT > 0.35) releaseAll(s, p.b('releasePlaces') ? 'placed' : 'dissolve')
          }
        }
      }
      for (let id = 0; id < 2; id++) {
        if (present.has(id)) continue
        const s = slots[id]
        s.pinchT = 0
        s.charge = 0
        if (s.objs.length) {
          s.lostT += dt
          if (s.lostT > 0.4) releaseAll(s, 'dissolve')
        }
      }
      for (const e of f.hands.events) {
        if (e.type === 'fist') {
          const s = slots[Math.min(1, e.hand)]
          if (!s.objs.length) {
            const placed = objects.filter(o => o.state === 'placed')
            const last = placed[placed.length - 1]
            if (last) for (const o of placed) if (o.group === last.group) release(o, 'implode')
          }
        }
      }
      // Enter / pulse → next object (swap what's held)
      if (f.pulses.length) {
        let swapped = false
        for (let id = 0; id < 2; id++) {
          const s = slots[id]
          const lead = s.objs[0]
          if (lead && (lead.state === 'held' || lead.state === 'summon')) {
            const at = lead.pos.clone()
            const sc = s.objs.length > 1 ? lead.targetScale / 0.6 : lead.targetScale
            releaseAll(s, 'dissolve')
            s.objs = spawnGroup(nextEntry(p), p, at, id, sc)
            swapped = true
          }
        }
        if (!swapped && !f.hands.hands.length) {
          // no hand: summon into the box so Enter always shows something
          spawnGroup(nextEntry(p), p, screenToWorld(p.n('boxX'), p.n('boxY')), null, objScaleFor(p, null))
        } else if (!swapped) {
          nextEntry(p)
        }
      }

      // ---- objects
      const morphDur = Math.max(0.05, p.n('morphTime'))
      const dissDur = Math.max(0.05, p.n('dissolveTime'))
      const followK = beh === 'Lazy' ? 2.2 : 14
      const style = Math.max(0, STYLES.indexOf(p.s('style')))
      const cmode = Math.max(0, COLOR_MODES.indexOf(p.s('colorMode')))
      const tint = hexOf(p, 'tint'), pa = hexOf(p, 'palA'), pb = hexOf(p, 'palB'), pc = hexOf(p, 'palC')
      for (const o of [...objects]) {
        o.stateT += dt
        if (o.state === 'held') o.heldT += dt
        if (o.state === 'summon') {
          o.morph = Math.min(1, o.morph + dt / morphDur)
          if (o.morph >= 1) o.state = o.hand === null ? 'placed' : 'held'
        } else if (o.state !== 'dissolve' && o.state !== 'implode') {
          o.morph = Math.min(1, o.morph + dt / morphDur)
        }
        if (o.state === 'dissolve') {
          o.dissolve = Math.min(1, o.dissolve + dt / dissDur)
          if (o.dissolve >= 1) { removeObj(o); continue }
        }
        if (o.state === 'implode') {
          o.implode = Math.min(1, o.implode + dt / 0.45)
          if (o.implode >= 1) { removeObj(o); continue }
        }
        const follow = (o.state === 'summon' || o.state === 'held' || o.state === 'released') && o.hand !== null
        const k = 1 - Math.exp(-dt * (follow ? followK : 6))
        if (follow) {
          o.pos.lerp(o.target, k)
          o.rotZ += (o.targetRotZ - o.rotZ) * (1 - Math.exp(-dt * 8))
        } else if (o.state === 'placed' || (o.state === 'summon' && o.hand === null)) {
          o.pos.y += Math.sin(t * 1.3 + o.born) * 0.0015
          o.rotZ *= 1 - Math.min(1, dt * 1.5)
        }
        o.scale += (o.targetScale - o.scale) * (1 - Math.exp(-dt * 10))
        o.pts.position.copy(o.pos)
        o.pts.scale.setScalar(o.scale)
        pose(o, p)
        o.pts.updateMatrixWorld()
        const u = o.mat.uniforms
        u.uTime.value = t + o.born * 3.1
        u.uClock.value = t
        u.uMorph.value = o.morph
        u.uDissolve.value = o.dissolve
        u.uImplode.value = o.implode
        u.uSize.value = p.n('pointSize')
        u.uStyleSize.value = STYLE_SIZE[style]
        u.uStyle.value = style
        u.uStyleGain.value = 1 / Math.pow(STYLE_SIZE[style], 1.7)
        u.uPx.value = H * 0.0125
        u.uCurl.value = p.n('curl')
        u.uGlow.value = p.n('glow')
        u.uBright.value = p.n('brightness')
        u.uColorMode.value = cmode
        u.uTwinkle.value = p.n('twinkle')
        u.uSizeJit.value = p.n('sizeJitter')
        u.uTint.value.copy(tint)
        u.uPalA.value.copy(pa)
        u.uPalB.value.copy(pb)
        u.uPalC.value.copy(pc)
        // particles stream out of the fingertip (object-local)
        const slot = slots.find(s => s.objs.includes(o))
        const origin = slot?.pinch ? slot.pinch.clone() : o.pos.clone()
        u.uOrigin.value.copy(o.pts.worldToLocal(origin))
      }

      // ---- box
      const boxMode = p.s('box')
      boxGroup.visible = boxMode !== 'off'
      boxSpin += dt * p.n('boxSpin')
      const bs = p.n('boxSize') * 2 * HH
      let bx = p.n('boxX'), by = p.n('boxY')
      if (boxMode === 'follow' && f.hands.hands[0]) { bx = f.hands.hands[0].palm.x; by = f.hands.hands[0].palm.y - 0.05 }
      const want = screenToWorld(bx, by)
      boxPos.lerp(want, boxMode === 'follow' ? 1 - Math.exp(-dt * 4) : 1)
      boxGroup.position.copy(boxPos)
      boxGroup.scale.setScalar(bs)
      boxGroup.rotation.set(0.32 + Math.sin(boxSpin * 0.7) * 0.06, 0.55 + boxSpin, 0)
      boxGroup.updateMatrixWorld()
      boxMat.linewidth = 1.6 * f.scale
      boxMat.opacity = p.n('boxOpacity')
      dotMat.uniforms.uPx.value = 11 * f.scale
      dotMat.uniforms.uOpacity.value = Math.min(1, p.n('boxOpacity') + 0.15)
      boxMat.resolution.set(W, H)

      // ---- labels (overlay)
      const showLabels = p.b('labels')
      const lh = 0.0135
      labelClock += dt
      if (labelClock > 0.25 || dt === 0) {
        labelClock = 0
        const c0 = corners[3].clone().applyMatrix4(boxGroup.matrixWorld)
        boxLabels[0].set(`x ${(c0.x / HH).toFixed(2)}  y ${(c0.y / HH).toFixed(2)}  z ${(c0.z / HH).toFixed(2)}`)
        const c1 = corners[4].clone().applyMatrix4(boxGroup.matrixWorld)
        boxLabels[1].set(`x ${(c1.x / HH).toFixed(2)}  y ${(c1.y / HH).toFixed(2)}  z ${(c1.z / HH).toFixed(2)}`)
        const live = objects.filter(o => o.state !== 'dissolve' && o.state !== 'implode').length
        boxLabels[2].set(`SUMMON.VOL // ${String(live).padStart(2, '0')} OBJ // NEXT ${entryName(nextEntry(p, true))}`)
      }
      for (const [i, ci] of [[0, 3], [1, 4], [2, 2]] as const) {
        const [ox, oy] = toOverlay(corners[ci].clone().applyMatrix4(boxGroup.matrixWorld))
        boxLabels[i].place(ox + 0.012, oy + (i === 2 ? 0.02 : 0.012), lh, showLabels && boxGroup.visible ? 0.9 : 0)
      }
      for (const o of objects) {
        if (!o.label) continue
        const [ox, oy] = toOverlay(new THREE.Vector3(o.scale * 0.75, o.scale * 0.95, 0).add(o.pos))
        const fade = o.state === 'dissolve' ? 1 - o.dissolve : o.state === 'implode' ? 1 - o.implode : Math.min(1, o.morph * 2)
        o.label.place(ox, oy, lh, showLabels ? 0.9 * fade : 0)
      }

      // ---- reticles (the cursor)
      for (let id = 0; id < 2; id++) {
        const r = reticles[id]
        const hand = f.hands.hands.find(h => Math.min(1, h.id) === id)
        r.g.visible = !!hand && p.b('reticle')
        r.label.place(0, 0, lh, 0)
        if (!hand || !r.g.visible) continue
        const px = (hand.index.x + hand.thumb.x) / 2, py = (hand.index.y + hand.thumb.y) / 2
        const rad = 0.016 + (1 - hand.pinch) * 0.011
        r.g.position.set(px * aspect, 1 - py, 0)
        r.g.scale.setScalar(rad)
        r.ring.rotation.z = t * 0.8
        const s = slots[id]
        const active = hand.pinching || s.objs.length > 0
        const col = active ? 0xff6ad5 : 0x7ff3ff
        r.ringMat.color.setHex(col)
        r.glowMat.uniforms.uColor.value.setHex(col)
        r.glowMat.uniforms.uA.value = hand.presence
        r.glowMat.uniforms.uPinch.value = hand.pinch
        r.ringMat.opacity = 0.9 * hand.presence
        r.ringMat.linewidth = 1.6 * f.scale
        r.arcMat.linewidth = 2.6 * f.scale
        r.ringMat.resolution.set(W, H)
        r.arcMat.resolution.set(W, H)
        const k = s.objs.length ? 1 : s.charge
        r.arc.visible = k > 0.01
        if (r.arc.visible) setArc(r, k)
        const lead = s.objs[0]
        const text = lead ? `${lead.name} ${lead.state === 'summon' ? Math.round(lead.morph * 100) + '%' : beh.toUpperCase()}` : hand.pinching ? 'PINCH' : hand.fist ? 'FIST' : hand.point ? 'POINT' : 'READY'
        r.label.set(text, active ? '#ffb3ec' : '#9ff7ff')
        r.label.place(px * aspect + rad * 2.2, 1 - py - rad * 1.5, lh * 0.9, showLabels ? 0.85 * hand.presence : 0)
      }

      // ---- background
      let mode = Math.max(0, BACKGROUNDS.indexOf(p.s('background')))
      let img: THREE.Texture | null = null
      if (mode === 3) {
        const i = Math.round(p.n('bgImage'))
        const im = images.length ? images[Math.max(0, Math.min(images.length, i) - 1)] : null
        if (im) { img = setTexOf(im); bgU.uImgAspect.value = im.width / Math.max(1, im.height) } else mode = 0
      }
      bgU.uMode.value = mode
      bgU.tImg.value = img ?? blackTex
      bgU.tSrc.value = f.source.tex
      bgU.uXf.value.copy(f.source.uvXform)
      bgU.uTime.value = f.time.t
      bgU.uAspect.value = aspect
      bgU.uStars.value = p.n('stars')
      bgU.uDim.value = p.n('bgDim')
      bgU.uDesat.value = p.n('bgDesat')
      bgU.uVig.value = p.n('vignette')
      bgU.uGridSpeed.value = p.n('gridSpeed')
      bgU.uColA.value.setRGB(...p.c('bgA'))
      bgU.uColB.value.setRGB(...p.c('bgB'))
      bgU.uGrid.value.setRGB(...p.c('gridColor'))
      trailU.uDecay.value = p.n('trails')
    },
    render(f, target) {
      const r = f.renderer
      clearTarget(r, glowRT, 0x000000)
      r.setRenderTarget(glowRT)
      r.render(objScene, cam)
      let glowTex: THREE.Texture = glowRT.texture
      if (f.p.n('trails') > 0.01) {
        if (trailFresh) { trail.clear(r, 0x000000); trailFresh = false }
        trailU.tCur.value = glowRT.texture
        trailU.tPrev.value = trail.read.texture
        trailPass.render(r, trail.write)
        trail.swap()
        glowTex = trail.read.texture
      } else {
        trailFresh = true
      }
      const bl = f.p.n('bloom')
      if (bl > 0.001) {
        bloom.render(r, glowTex, bloomRT, { threshold: 0.45, strength: bl, radius: 2.2 })
        bgU.tGlow.value = bloomRT.texture
      } else {
        bgU.tGlow.value = glowTex
      }
      bgPass.render(r, target)
      r.setRenderTarget(target)
      r.render(boxScene, cam)
      r.render(ovScene, ovCam)
    },
    status() {
      const live = objects.filter(o => o.state !== 'dissolve' && o.state !== 'implode').length
      const next = lastP ? entryName(nextEntry(lastP, true)) : ''
      return `${live} object${live === 1 ? '' : 's'}${next ? ' · next ' + next : ''}`
    },
    setImages(list) {
      images = list
      const ids = new Set(list.map(i => i.id))
      for (const [id, tex] of bgTextures) if (!ids.has(id)) { tex.dispose(); bgTextures.delete(id) }
      for (const [key, g] of geoCache) {
        if (!key.startsWith('image:') || ids.has(key.slice(6))) continue
        if (objects.some(o => o.geoKey === key)) continue
        g.geo.dispose()
        geoCache.delete(key)
      }
    },
    click(x, y) {
      // a quick click summons where you clicked (ignored right after a pinch-summon)
      if (!lastP || t - lastSummonT < 0.6) return false
      spawnGroup(nextEntry(lastP), lastP, screenToWorld(x, y), null, objScaleFor(lastP, null))
      return true
    },
    dispose() {
      for (const o of [...objects]) removeObj(o)
      warmGeo.dispose(); warmMat.dispose()
      for (const e of geoCache.values()) e.geo.dispose()
      geoCache.clear()
      for (const tex of bgTextures.values()) tex.dispose()
      glowRT.dispose(); bloomRT.dispose(); trail.dispose(); bloom.dispose(); bgPass.dispose(); trailPass.dispose(); blackTex.dispose()
      boxGeo.dispose(); boxMat.dispose(); dotGeo.dispose(); dotMat.dispose()
      ringGeo.dispose(); glowGeo.dispose()
      for (const r of reticles) { r.arcGeo.dispose(); r.label.dispose(); r.ringMat.dispose(); r.arcMat.dispose(); r.glowMat.dispose() }
      for (const l of boxLabels) l.dispose()
    },
  }
}

// Curated looks for the 🎲 button: object + palette + style + behaviour combos that read well.
const LOOKS: Partial<Values>[] = [
  { object: 'Galaxy', colorMode: 'Natural', style: 'Star', background: 'Void', twinkle: 0.6, bloom: 1.0, stars: 0.9, behaviour: 'Hold' },
  { object: 'Jellyfish', colorMode: 'Palette', palA: '#3be8ff', palB: '#b04bff', palC: '#ff5fd2', style: 'Glow', background: 'Gradient', bgA: '#020617', bgB: '#0b2a4a', behaviour: 'Float up' },
  { object: 'Koi', colorMode: 'Natural', style: 'Dot', background: 'Gradient', bgA: '#03141a', bgB: '#0b3b3a', units: 3, behaviour: 'Orbit' },
  { object: 'Phoenix', colorMode: 'Natural', style: 'Star', background: 'Void', trails: 0.6, bloom: 1.3, behaviour: 'Float up' },
  { object: 'Heart', colorMode: 'Tint', tint: '#ff2d6f', style: 'Glow', units: 5, behaviour: 'Orbit', background: 'Void' },
  { object: 'Crystal', colorMode: 'Palette', palA: '#7cf8ff', palB: '#8a5cff', palC: '#ffffff', style: 'Square', background: 'Grid floor', gridColor: '#7a3cff' },
  { object: 'Mushroom', colorMode: 'Natural', style: 'Dot', background: 'Void', twinkle: 0.3, behaviour: 'Hold' },
  { object: 'Planet', colorMode: 'Natural', style: 'Dot', background: 'Void', stars: 1.0, behaviour: 'Lazy' },
  { object: 'DNA', colorMode: 'Rainbow', style: 'Ring', background: 'Grid floor', gridColor: '#00e5ff', behaviour: 'Hold' },
  { object: 'Lotus', colorMode: 'Natural', style: 'Glow', background: 'Gradient', bgA: '#140a1f', bgB: '#3a1240', behaviour: 'Float up' },
  { object: 'Flame spirit', colorMode: 'Natural', style: 'Glow', trails: 0.55, background: 'Void', behaviour: 'Lazy' },
  { object: 'Butterfly', units: 6, behaviour: 'Orbit', colorMode: 'Rainbow', style: 'Star', background: 'Gradient', bgA: '#05060c', bgB: '#1d2a55' },
  { object: 'Flower', colorMode: 'Natural', style: 'Dot', background: 'Gradient', bgA: '#05060c', bgB: '#2a1650', behaviour: 'Hold' },
  { object: 'Dragon', colorMode: 'Natural', style: 'Star', background: 'Grid floor', gridColor: '#ff3355', trails: 0.4, behaviour: 'Lazy' },
  { object: 'Text', colorMode: 'Rainbow', style: 'Star', background: 'Void', behaviour: 'Hold' },
  { object: 'Tree', colorMode: 'Palette', palA: '#ffd36e', palB: '#ff7aa8', palC: '#9b7bff', style: 'Glow', background: 'Gradient', bgA: '#07040f', bgB: '#251036' },
  { object: 'Cycle', colorMode: 'Natural', style: 'Dot', units: 3, behaviour: 'Orbit', background: 'Void' },
]
const WORDS = ['HELLO', 'MAGIC', 'DREAM', 'TOUCH', 'GLOW', 'WOW', 'HI']

// Inspired by a TouchDesigner reel by william.
const summon: SceneDef = {
  id: 'summon',
  name: 'Summon',
  tag: 'particle creatures',
  blurb: 'Pinch the air to conjure glowing particle creatures (lily, jellyfish, koi, phoenix, galaxy, your own PNGs…) at your fingertip. Open your hand to dissolve, fist to implode, point to leave it floating.',
  color: '#4fbf6a',
  needs: { hands: true, handMapping: (p) => (p.s('background') === 'Camera' ? 'video' : 'frame') },
  images: { max: 8, label: 'Particle images', hint: 'PNGs with transparency work best' },
  randomize(rnd) {
    const look = { ...LOOKS[Math.floor(rnd() * LOOKS.length)] }
    look.twinkle = look.twinkle ?? Math.round(rnd() * 50) / 100
    look.sizeJitter = Math.round(rnd() * 60) / 100
    look.pointSize = Math.round((0.8 + rnd() * 0.5) * 100) / 100
    look.spin = Math.round((0.15 + rnd() * 0.5) * 100) / 100
    look.units = look.units ?? (rnd() < 0.25 ? 2 + Math.floor(rnd() * 3) : 1)
    if (look.object === 'Text') look.text = WORDS[Math.floor(rnd() * WORDS.length)]
    if (rnd() < 0.35 && look.trails === undefined) look.trails = Math.round(rnd() * 50) / 100
    return look
  },
  params: [
    { id: 'object', label: 'Object', group: 'Summon', type: 'enum', options: OBJECT_OPTIONS, default: 'Cycle' },
    { id: 'imageSlot', label: 'Image # (0 = all)', group: 'Summon', type: 'int', min: 0, max: 8, default: 0, random: false },
    { id: 'text', label: 'Text', group: 'Summon', type: 'text', default: 'HELLO' },
    { id: 'units', label: 'Units per pinch', group: 'Summon', type: 'int', min: 1, max: 8, default: 1 },
    { id: 'unitSpread', label: 'Swarm radius', group: 'Summon', type: 'float', min: 0.4, max: 3, step: 0.01, default: 1.4 },
    { id: 'behaviour', label: 'When held', group: 'Summon', type: 'enum', options: BEHAVIOURS, default: 'Hold' },
    { id: 'objSize', label: 'Object scale', group: 'Summon', type: 'float', min: 0.08, max: 0.8, step: 0.01, default: 0.3 },
    { id: 'handScale', label: 'Hand size scales', group: 'Summon', type: 'bool', default: true },
    { id: 'points', label: 'Points (k)', group: 'Summon', type: 'float', min: 4, max: 80, step: 1, default: 22, random: false },
    { id: 'spin', label: 'Auto-rotate', group: 'Summon', type: 'float', min: 0, max: 2, step: 0.01, default: 0.35 },
    { id: 'morphTime', label: 'Summon time', group: 'Summon', type: 'float', min: 0.1, max: 3, step: 0.05, default: 0.8 },
    { id: 'dissolveTime', label: 'Dissolve time', group: 'Summon', type: 'float', min: 0.2, max: 5, step: 0.05, default: 1.5 },
    { id: 'curl', label: 'Dissolve swirl', group: 'Summon', type: 'float', min: 0, max: 4, step: 0.01, default: 1.2 },
    { id: 'maxObjects', label: 'Max placed', group: 'Summon', type: 'int', min: 1, max: 12, default: 6, random: false },
    { id: 'releasePlaces', label: 'Release = place', group: 'Summon', type: 'bool', default: false },
    { id: 'next', label: 'Next object', group: 'Summon', type: 'pulse', default: 0 },
    { id: 'colorMode', label: 'Color mode', group: 'Particles', type: 'enum', options: COLOR_MODES, default: 'Natural' },
    { id: 'tint', label: 'Tint', group: 'Particles', type: 'color', default: '#7ff3ff' },
    { id: 'palA', label: 'Palette 1', group: 'Particles', type: 'color', default: '#29e6ff' },
    { id: 'palB', label: 'Palette 2', group: 'Particles', type: 'color', default: '#9b6bff' },
    { id: 'palC', label: 'Palette 3', group: 'Particles', type: 'color', default: '#ff3df2' },
    { id: 'style', label: 'Particle style', group: 'Particles', type: 'enum', options: STYLES, default: 'Dot' },
    { id: 'pointSize', label: 'Point size', group: 'Particles', type: 'float', min: 0.2, max: 4, step: 0.01, default: 1 },
    { id: 'sizeJitter', label: 'Size jitter', group: 'Particles', type: 'float', min: 0, max: 1, step: 0.01, default: 0.2 },
    { id: 'twinkle', label: 'Twinkle', group: 'Particles', type: 'float', min: 0, max: 1, step: 0.01, default: 0.15 },
    { id: 'brightness', label: 'Brightness', group: 'Particles', type: 'float', min: 0.1, max: 3, step: 0.01, default: 1 },
    { id: 'glow', label: 'Halo', group: 'Particles', type: 'float', min: 0, max: 3, step: 0.01, default: 1 },
    { id: 'bloom', label: 'Bloom', group: 'Particles', type: 'float', min: 0, max: 3, step: 0.01, default: 0.8 },
    { id: 'trails', label: 'Afterimage', group: 'Particles', type: 'float', min: 0, max: 0.97, step: 0.01, default: 0 },
    { id: 'background', label: 'Background', group: 'Background', type: 'enum', options: BACKGROUNDS, default: 'Void' },
    { id: 'bgA', label: 'Color A (top)', group: 'Background', type: 'color', default: '#05060c' },
    { id: 'bgB', label: 'Color B (glow)', group: 'Background', type: 'color', default: '#2a1650' },
    { id: 'gridColor', label: 'Grid color', group: 'Background', type: 'color', default: '#9b5cff' },
    { id: 'gridSpeed', label: 'Grid speed', group: 'Background', type: 'float', min: 0, max: 2, step: 0.01, default: 0.4 },
    { id: 'stars', label: 'Star dust', group: 'Background', type: 'float', min: 0, max: 2, step: 0.01, default: 0.6 },
    { id: 'bgImage', label: 'Image #', group: 'Background', type: 'int', min: 1, max: 8, default: 1, random: false },
    { id: 'bgDim', label: 'Image/camera dim', group: 'Background', type: 'float', min: 0, max: 1, step: 0.01, default: 0.45 },
    { id: 'bgDesat', label: 'Desaturate', group: 'Background', type: 'float', min: 0, max: 1, step: 0.01, default: 0.2 },
    { id: 'vignette', label: 'Vignette', group: 'Background', type: 'float', min: 0, max: 1.5, step: 0.01, default: 0.6 },
    { id: 'box', label: 'Wire box', group: 'Box & HUD', type: 'enum', options: ['fixed', 'follow', 'off'], default: 'fixed' },
    { id: 'boxSize', label: 'Box size', group: 'Box & HUD', type: 'float', min: 0.1, max: 0.9, step: 0.01, default: 0.36 },
    { id: 'boxX', label: 'Box X', group: 'Box & HUD', type: 'float', min: 0, max: 1, step: 0.01, default: 0.5 },
    { id: 'boxY', label: 'Box Y', group: 'Box & HUD', type: 'float', min: 0, max: 1, step: 0.01, default: 0.55 },
    { id: 'boxSpin', label: 'Box spin', group: 'Box & HUD', type: 'float', min: -1, max: 1, step: 0.01, default: 0.06 },
    { id: 'boxOpacity', label: 'Box opacity', group: 'Box & HUD', type: 'float', min: 0, max: 1, step: 0.01, default: 0.6 },
    { id: 'labels', label: 'Labels', group: 'Box & HUD', type: 'bool', default: true },
    { id: 'reticle', label: 'Fingertip cursor', group: 'Box & HUD', type: 'bool', default: false },
  ],
  presets: {
    Summon: {},
    'Camera backdrop': { background: 'Camera', bgDim: 0.12, bgDesat: 0.15, vignette: 0.45, bloom: 0.7 },
    'Deep space': { object: 'Galaxy', style: 'Star', twinkle: 0.6, stars: 1.2, bloom: 1.1, box: 'off' },
    'Neon grid': { background: 'Grid floor', colorMode: 'Palette', style: 'Star', trails: 0.45, bloom: 1.2 },
    Swarm: { object: 'Butterfly', units: 6, behaviour: 'Orbit', colorMode: 'Rainbow', unitSpread: 1.6 },
    'Clean (no HUD)': { box: 'off', labels: false, reticle: false },
    Garden: { object: 'Cycle', releasePlaces: true, maxObjects: 8, background: 'Gradient' },
  },
  gestures: [
    'Pinch & hold → summon at your fingertip',
    'Open hand → dissolve it into particles',
    'Fist → implode it',
    'Point while releasing → leave it floating',
    'Click the output / Enter → summon the next object',
    'Upload PNGs in the panel → they become summonable',
  ],
  create,
}

export default summon
