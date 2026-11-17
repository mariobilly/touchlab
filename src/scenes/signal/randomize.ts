import type { Values } from '../types'

// Curated randomizer for Signal Error: pick one style family, then vary inside ranges that are
// known to look good together. Every "look" param is set (from a neutral base) so results don't
// inherit leftovers from the previous roll. Mask / hand settings stay as the user set them.

type Range = [number, number] | number
interface Family { name: string; weight: number; set: Record<string, Range | string | boolean> }

const BASE: Values = {
  intensity: 1, tear: 0.3, tearFreq: 2.5, tearSharp: 2.2, burst: 0.2, skew: 0.05, hHold: 0, wrap: true, roll: 0, vblank: 0.03,
  rainbow: 0.85, bands: 7, hueSpread: 1.3, hueSpeed: 0.12, hueOffset: 0, chromaBands: 0.7, lumaDetail: 0.55, greyAbove: 0.52,
  keepBright: 0.75, saturation: 0.15, contrast: 1.15, bleed: 0.6, ringing: 0.5, interlace: 0.35, persistence: 0.15,
  scanlines: 0.45, lineSize: 4, snow: 0.08, dropouts: 0.4, headSwitch: 0.5, blackLift: 0.04, vignette: 0.25,
}

const FAMILIES: Family[] = [
  { name: 'Rainbow VHS', weight: 3, set: {
    rainbow: [0.75, 1], bands: [5, 12], hueSpread: [0.8, 2.2], hueSpeed: [-0.25, 0.3], chromaBands: [0.4, 1.2], tear: [0.2, 0.6],
    interlace: [0.2, 0.5], keepBright: [0.5, 0.9], saturation: [0.05, 0.3], lineSize: [3, 6], persistence: [0.08, 0.3] } },
  { name: 'Posterized', weight: 2, set: {
    rainbow: [0.85, 1], bands: [2, 5], hueSpread: [0.5, 1.3], hueSpeed: [-0.08, 0.08], chromaBands: [0, 0.3], keepBright: [0, 0.4],
    lumaDetail: [0.7, 1], interlace: [0, 0.2], scanlines: [0.3, 0.65], lineSize: [3, 8], tear: [0.05, 0.3], burst: [0, 0.2], dropouts: [0, 0.3] } },
  { name: 'Chroma storm', weight: 2, set: {
    rainbow: [0.9, 1], bands: [10, 24], hueSpread: [1.5, 3.5], hueSpeed: [0.2, 0.6], chromaBands: [1, 2], persistence: [0.3, 0.6],
    bleed: [1, 2], keepBright: [0.1, 0.5], tear: [0.4, 0.9], ringing: [0.6, 1.2] } },
  { name: 'Rolling hold', weight: 1.5, set: {
    hHold: [0.6, 1.4], roll: [0.1, 0.45], skew: [0.05, 0.25], tear: [0.3, 0.7], rainbow: [0.6, 0.95], bands: [6, 12], vblank: [0.03, 0.08] } },
  { name: 'Dead channel', weight: 1, set: {
    rainbow: [0.1, 0.35], snow: [0.35, 0.65], tear: [0.6, 1.2], burst: [0.4, 0.9], dropouts: [1, 2], roll: [0.2, 0.7],
    saturation: [0, 0.2], contrast: [0.7, 1], keepBright: [0, 0.3], interlace: [0.5, 0.8], blackLift: [0.05, 0.12] } },
  { name: 'Subtle tape', weight: 1.5, set: {
    intensity: [0.3, 0.6], rainbow: [0.05, 0.25], saturation: [0.7, 1.1], tear: [0.08, 0.25], burst: [0, 0.1], scanlines: [0.15, 0.35],
    snow: [0.02, 0.06], bleed: [0.3, 0.9], chromaBands: [0.1, 0.4], dropouts: [0.1, 0.4], keepBright: [0.2, 0.6] } },
  { name: 'Broadcast loss', weight: 1, set: {
    headSwitch: [0.7, 1], vblank: [0.03, 0.1], roll: [0.5, 1.2], dropouts: [0.8, 1.6], rainbow: [0.4, 0.75], burst: [0.3, 0.7], snow: [0.12, 0.3] } },
]

export function randomizeSignal(rnd: () => number, current: Values): Partial<Values> {
  const total = FAMILIES.reduce((s, f) => s + f.weight, 0)
  let pick = rnd() * total
  let fam = FAMILIES[0]
  for (const f of FAMILIES) { if ((pick -= f.weight) <= 0) { fam = f; break } }
  const out: Values = { ...BASE }
  // light global variety on top of the family
  out.hueOffset = rnd()
  out.vignette = 0.15 + rnd() * 0.25
  out.tearFreq = 1.5 + rnd() * 3.5
  out.tearSharp = 1.6 + rnd() * 2
  out.greyAbove = 0.42 + rnd() * 0.2
  for (const [k, v] of Object.entries(fam.set)) {
    if (Array.isArray(v)) out[k] = v[0] + rnd() * (v[1] - v[0])
    else out[k] = v
  }
  out.bands = Math.round(Number(out.bands))
  // a clean double image reads best at hold ≈ 1
  if (fam.name === 'Rolling hold' && rnd() < 0.5) out.hHold = 1
  // never touch the user's mask / hand choices
  for (const k of ['personMask', 'rainbowOn', 'otherAmt', 'detailKeep', 'handAmount']) delete out[k]
  void current
  return out
}
