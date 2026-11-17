// More Summon point clouds: jellyfish, koi, phoenix, galaxy, heart, crystal, mushroom, planet,
// DNA, lotus, flame spirit and text. Same conventions as shapes.ts (radius-1, y up, aux for animation).
import { Builder, rng, mix3, smooth, norm, cross, add, scl, type Cloud, type V3 } from './shapes'

// ---------------------------------------------------------------- jellyfish: pulsing bell + trailing tentacles
// aux = (0 bell | 1 arm/tentacle, bell latitude or position along the tentacle, phase)
export function jellyfish(count: number, seed = 21): Cloud {
  const R = rng(seed)
  const b = new Builder()
  const TMAX = 1.35
  const nBell = Math.floor(count * 0.42), nArms = Math.floor(count * 0.13)
  for (let i = 0; i < nBell; i++) {
    const th = Math.acos(1 - R() * (1 - Math.cos(TMAX)))
    const ph = R() * Math.PI * 2
    let r = Math.sin(th) * (1 + 0.06 * Math.sin(ph * 8))
    let y = Math.cos(th) * 0.7 + 0.2
    if (th > 1.15) { r += (th - 1.15) * 0.4; y -= (th - 1.15) * 0.3 }
    const inner = R() < 0.2
    const k = inner ? R() : 0.94 + R() * 0.06
    const canal = Math.pow(Math.max(0, Math.cos(ph * 8)), 30)
    let c: V3 = mix3([0.55, 0.35, 1.0], [1.0, 0.55, 0.85], smooth(0.4, 1.0, th / TMAX))
    c = mix3(c, [1.0, 0.85, 1.0], Math.min(1, canal * 0.7 + (th < 0.3 ? 0.5 : 0)))
    if (inner) c = scl(c, 0.45)
    b.add([Math.cos(ph) * r * k, 0.2 + (y - 0.2) * k, Math.sin(ph) * r * k], c, [0, th / TMAX, 0])
  }
  for (let i = 0; i < nArms; i++) {
    const a = (Math.floor(R() * 4) / 4) * Math.PI * 2 + 0.4
    const s = R()
    const frill = Math.sin(s * 25 + a) * 0.07 * (1 - s * 0.5)
    const p: V3 = [
      Math.cos(a) * 0.08 * (1 + s) + Math.cos(a + 1.57) * frill + (R() - 0.5) * 0.06,
      0.3 - s * 1.3,
      Math.sin(a) * 0.08 * (1 + s) + Math.sin(a + 1.57) * frill + (R() - 0.5) * 0.06,
    ]
    b.add(p, mix3([1.0, 0.7, 0.9], [0.9, 0.4, 0.8], s), [1, s, a])
  }
  const K = 18
  const lens = Array.from({ length: K }, () => 1.8 + R() * 0.8)
  const rest = count - b.n
  for (let i = 0; i < rest; i++) {
    const k = Math.floor(R() * K)
    const ph = (k / K) * Math.PI * 2
    const s = R()
    const rr = 1.12 * (1 - s * 0.15)
    const p: V3 = [Math.cos(ph) * rr + (R() - 0.5) * 0.024, 0.32 - s * lens[k], Math.sin(ph) * rr + (R() - 0.5) * 0.024]
    b.add(p, scl(mix3([0.65, 0.85, 1.0], [0.45, 0.3, 0.85], s), 1 - s * 0.45), [1, s, ph])
  }
  return b.finish()
}

// ---------------------------------------------------------------- koi: top view, head up
// aux = (position along the fish 0 head..1.45 tail tip, fin flag: 1 tail, ±2 pectoral, 0)
export function koi(count: number, seed = 31): Cloud {
  const R = rng(seed)
  const b = new Builder()
  const width = (u: number) => 0.32 * Math.pow(Math.sin(Math.PI * Math.pow(u * 0.92 + 0.04, 0.75)), 0.9) * (1 - 0.35 * u)
  const nBody = Math.floor(count * 0.62)
  let made = 0
  while (made < nBody) {
    const u = R()
    const w = width(u)
    if (R() > w / 0.3) continue
    const v = R() * 2 - 1
    const top = R() < 0.78
    const z = (top ? 1 : -1) * Math.sqrt(Math.max(0, 1 - v * v)) * w * 0.5
    const n = Math.sin(u * 9 + 1.3) * Math.cos(v * 3 + u * 4) + Math.sin(u * 17 + v * 2) * 0.4
    let c: V3 = [0.97, 0.94, 0.9]
    if (n > 0.25 || (u < 0.12 && Math.abs(v) < 0.6)) c = [1.0, 0.32, 0.06]
    if (n < -0.8 && u > 0.2 && u < 0.85) c = [0.16, 0.1, 0.1]
    if (u > 0.04 && u < 0.08 && Math.abs(Math.abs(v) - 0.62) < 0.1 && top) c = [0.05, 0.05, 0.05]
    if (!top) c = scl(c, 0.6)
    b.add([v * w, 1 - u * 2, z], c, [u, 0, 0])
    made++
  }
  const nDors = Math.floor(count * 0.05)
  for (let i = 0; i < nDors; i++) {
    const u = 0.3 + R() * 0.4
    b.add([(R() - 0.5) * 0.02, 1 - u * 2, width(u) * 0.5 + R() * 0.07], [1.0, 0.55, 0.25], [u, 0, 0])
  }
  const nPec = Math.floor(count * 0.1)
  const w0 = width(0.28)
  for (let i = 0; i < nPec; i++) {
    const side = R() < 0.5 ? -1 : 1
    let a = R(), bb = R()
    if (a + bb > 1) { a = 1 - a; bb = 1 - bb }
    const base: V3 = [side * w0 * 0.9, 0.44, 0]
    const t1: V3 = [side * (w0 + 0.38), 0.18, 0.02]
    const t2: V3 = [side * (w0 + 0.18), 0.02, 0.02]
    const p = add(base, add(scl([t1[0] - base[0], t1[1] - base[1], t1[2]], a), scl([t2[0] - base[0], t2[1] - base[1], t2[2]], bb)))
    const ray = Math.pow(Math.abs(Math.cos(Math.atan2(p[1] - 0.44, p[0] - base[0]) * 9)), 6)
    b.add(p, scl(mix3([1, 0.9, 0.85], [1, 0.55, 0.3], a + bb), 0.55 + ray * 0.35), [0.28, side * 2, 0])
  }
  const rest = count - b.n
  for (let i = 0; i < rest; i++) {
    const ut = R()
    const v = R() * 2 - 1
    if (ut > 0.88 + 0.12 * Math.abs(Math.sin(v * 3.2))) continue
    const spread = 0.06 + ut * 0.45
    const ray = Math.pow(Math.abs(Math.cos(v * 7)), 4)
    b.add([v * spread, -1 - ut * 0.75, 0.02 + (R() - 0.5) * 0.02], scl(mix3([1, 0.75, 0.55], [1, 0.4, 0.15], ut), 0.5 + ray * 0.4), [1 + ut * 0.45, 1, 0])
  }
  return b.finish()
}

// ---------------------------------------------------------------- phoenix: fire bird with spread wings and a long tail
// aux = (tail param s > 0 | -1 ember | 0, wing side ±1 | 0, plume index / ember phase / wing distance)
export const PHOENIX_SHOULDER: V3 = [0.12, 0.35, 0]
export function phoenix(count: number, seed = 41): Cloud & { pivot: V3 } {
  const R = rng(seed)
  const b = new Builder()
  const sph = (c: V3, r: V3): V3 => {
    const a = R() * Math.PI * 2, e = Math.acos(R() * 2 - 1), k = Math.cbrt(R())
    return [c[0] + Math.sin(e) * Math.cos(a) * r[0] * k, c[1] + Math.cos(e) * r[1] * k, c[2] + Math.sin(e) * Math.sin(a) * r[2] * k]
  }
  const nBody = Math.floor(count * 0.12)
  for (let i = 0; i < nBody; i++) {
    const p = sph([0, 0.15, 0], [0.14, 0.38, 0.14])
    b.add(p, mix3([1, 0.4, 0.08], [1, 0.82, 0.35], Math.min(1, smooth(-0.1, 0.12, p[2]) * 0.6 + R() * 0.3)), [0, 0, 0])
  }
  const nHead = Math.floor(count * 0.06)
  for (let i = 0; i < nHead; i++) {
    const k = R()
    if (k < 0.55) b.add(sph([0, 0.66, 0.02], [0.11, 0.11, 0.11]), [1, 0.6, 0.15], [0, 0, 0])
    else if (k < 0.65) { const u = R(); b.add([0, 0.64 - u * 0.05, 0.1 + u * 0.12], [1, 0.85, 0.4], [0, 0, 0]) }
    else if (k < 0.7) { const s = R() < 0.5 ? -1 : 1; b.add([s * 0.05, 0.69, 0.1], [1, 1, 0.85], [0, 0, 0]) }
    else {
      const j = Math.floor(R() * 5), u = R()
      const ang = -0.6 + j * 0.3
      b.add([Math.sin(ang) * u * 0.25, 0.74 + u * 0.32 - u * u * 0.1, -0.05 - u * 0.12], u > 0.85 ? [1, 0.95, 0.6] : [1, 0.5, 0.1], [0, 0, 0])
    }
  }
  const nWing = Math.floor(count * 0.45)
  const F = 22
  for (let i = 0; i < nWing; i++) {
    const side = R() < 0.5 ? -1 : 1
    const a = Math.floor(R() * F) / (F - 1)
    const q = 1 - a
    // arm: quadratic bezier shoulder → elbow → tip
    const P: V3 = [side * (q * q * 0.12 + 2 * q * a * 0.62 + a * a * 1.45), q * q * 0.35 + 2 * q * a * 0.66 + a * a * 0.95, 0.12 * Math.sin(Math.PI * a)]
    const dir = norm([side * (0.25 + a * 0.9), -1 + a * 0.55, 0])
    const len = 0.75 * (1 - a * 0.55) + 0.1
    const v = R()
    const perp: V3 = [-dir[1], dir[0] * side, 0]
    const p = add(add(P, scl(dir, len * v)), scl(perp, (R() - 0.5) * 0.05 * (1 - v)))
    let c: V3 = mix3([0.9, 0.08, 0.04], [1, 0.45, 0.05], smooth(0, 0.6, v))
    c = mix3(c, [1, 0.88, 0.35], smooth(0.75, 1, v))
    if (v < 0.08) c = [1, 0.6, 0.2]
    b.add(p, c, [0, side, Math.abs(p[0]) - PHOENIX_SHOULDER[0]])
  }
  const nEmber = Math.floor(count * 0.03)
  const nTail = count - b.n - nEmber
  for (let i = 0; i < nTail; i++) {
    const k = Math.floor(R() * 5)
    const s = R()
    const L = 1.9 + (2 - Math.abs(k - 2)) * 0.25
    const w = 0.03 + 0.08 * s
    const p: V3 = [(k - 2) * 0.22 * s + 0.12 * Math.sin(s * Math.PI * 1.5 + k) + (R() - 0.5) * w, -0.2 - s * L, -0.08 * s + (R() - 0.5) * 0.04]
    let c: V3 = mix3([1, 0.3, 0.05], [1, 0.75, 0.2], s)
    if (s > 0.9) c = R() < 0.4 ? [0.4, 0.95, 1] : [1, 0.95, 0.55]
    b.add(p, c, [Math.max(0.01, s), 0, k])
  }
  for (let i = 0; i < nEmber; i++) b.add([(R() - 0.5) * 1.6, (R() - 0.5) * 1.6, (R() - 0.5) * 0.6], [1, 0.6, 0.2], [-1, 0, R()])
  const out = b.finish()
  const sh = PHOENIX_SHOULDER
  return { ...out, pivot: [(sh[0] - out.center[0]) * out.scale, (sh[1] - out.center[1]) * out.scale, (sh[2] - out.center[2]) * out.scale] }
}

// ---------------------------------------------------------------- spiral galaxy: disk in xz (the shader spins and tilts it)
// aux = (radius in the disk, 0, 0)
export function galaxy(count: number, seed = 51): Cloud {
  const R = rng(seed)
  const b = new Builder()
  const gauss = () => { let u = 0; for (let i = 0; i < 4; i++) u += R(); return (u - 2) / 1.15 }
  const arms = 2
  const nCore = Math.floor(count * 0.18), nHalo = Math.floor(count * 0.08)
  for (let i = 0; i < nCore; i++) {
    const p: V3 = [gauss() * 0.13, gauss() * 0.07, gauss() * 0.13]
    b.add(p, mix3([1, 0.95, 0.85], [1, 0.75, 0.45], R()), [Math.hypot(p[0], p[2]), 0, 0])
  }
  const nDisk = count - nCore - nHalo
  for (let i = 0; i < nDisk; i++) {
    let r = 0.1 + Math.pow(R(), 0.9) * 1.0
    const arm = Math.floor(R() * arms)
    let th = (arm / arms) * Math.PI * 2 + Math.log(r / 0.1) * 2.3 + gauss() * 0.32 * (1 - r * 0.3)
    r += gauss() * 0.04
    const y = gauss() * 0.025 * (1.2 - r)
    let c: V3 = mix3([1, 0.85, 0.7], [0.55, 0.72, 1.0], smooth(0.15, 0.9, r))
    const roll = R()
    if (roll < 0.06) c = [1, 0.35, 0.65]
    else if (roll < 0.14) { c = [0.22, 0.16, 0.26]; th -= 0.12 }
    b.add([Math.cos(th) * r, y, Math.sin(th) * r], c, [Math.abs(r), 0, 0])
  }
  for (let i = 0; i < nHalo; i++) {
    const a = R() * Math.PI * 2, e = Math.acos(R() * 2 - 1), r = 0.3 + R() * 0.9
    b.add([Math.sin(e) * Math.cos(a) * r, Math.cos(e) * r * 0.5, Math.sin(e) * Math.sin(a) * r], [0.4, 0.42, 0.5], [r, 0, 0])
  }
  return b.finish()
}

// ---------------------------------------------------------------- beating heart (implicit heart curve, inflated)
// aux = (closeness to the centre 0..1, 0, 0)
export function heart(count: number, seed = 61): Cloud {
  const R = rng(seed)
  const b = new Builder()
  let made = 0
  while (made < count) {
    const x = (R() * 2 - 1) * 1.2, y = -1.1 + R() * 2.4
    const f = Math.pow(x * x + y * y - 1, 3) - x * x * y * y * y
    if (f >= 0) continue
    const depth = 0.42 * Math.pow(Math.min(1, -f), 0.25)
    const z = R() < 0.75 ? (R() < 0.7 ? depth : -depth) : (R() * 2 - 1) * depth
    const inner = Math.min(1, Math.pow(-f, 0.3))
    let c: V3 = mix3([1, 0.38, 0.58], [0.8, 0.02, 0.12], inner)
    if (x < -0.25 && y > 0.3 && z > 0.12) c = mix3(c, [1, 0.82, 0.9], 0.55)
    b.add([x, y, z], c, [inner, 0, 0])
    made++
  }
  return b.finish()
}

// ---------------------------------------------------------------- crystal cluster
// aux = (height along its crystal, 1 on an edge, crystal index)
export function crystal(count: number, seed = 71): Cloud {
  const R = rng(seed)
  const b = new Builder()
  const xs: { base: V3; d: V3; len: number; rad: number; rot: number }[] = []
  for (let k = 0; k < 9; k++) {
    const d = k === 0 ? norm([0.05, 1, 0.02]) : norm([(R() - 0.5) * 1.1, 1, (R() - 0.5) * 0.8])
    xs.push({ base: [(R() - 0.5) * 0.5 * (k ? 1 : 0.2), -1, (R() - 0.5) * 0.4 * (k ? 1 : 0.2)], d, len: k === 0 ? 1.9 : 0.7 + R() * 0.9, rad: k === 0 ? 0.26 : 0.1 + R() * 0.1, rot: R() * 2 })
  }
  const nRock = Math.floor(count * 0.1)
  const weights = xs.map(x => x.len * x.rad)
  const tot = weights.reduce((a, c) => a + c, 0)
  xs.forEach((x, k) => {
    const n = Math.floor(((count - nRock) * weights[k]) / tot)
    const up: V3 = Math.abs(x.d[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0]
    const p1 = norm(cross(x.d, up)), p2 = cross(x.d, p1)
    const V = (j: number): V3 => { const a = x.rot + (j * Math.PI) / 3; return add(scl(p1, Math.cos(a)), scl(p2, Math.sin(a))) }
    for (let i = 0; i < n; i++) {
      const type = R()
      const tip = R() < 0.25
      const hb = 0.78
      const h = tip ? hb + R() * (1 - hb) : R() * hb
      const rs = tip ? 1 - (h - hb) / (1 - hb) : 1
      const j = Math.floor(R() * 6)
      const axis = add(x.base, scl(x.d, x.len * h))
      let p: V3
      let edge = 0
      if (type < 0.5) p = add(axis, scl(mix3(V(j), V(j + 1), R()), x.rad * rs))
      else if (type < 0.85) { p = add(axis, scl(V(j), x.rad * rs)); edge = 1 }
      else p = add(axis, scl(V(j), x.rad * rs * R() * 0.25))
      let c: V3 = mix3([0.35, 0.15, 0.75], [0.3, 0.85, 1.0], smooth(0, 0.8, h))
      c = mix3(c, [0.95, 1, 1], smooth(0.8, 1, h))
      if (edge) c = mix3(c, [0.9, 1, 1], 0.5)
      else if (type >= 0.85) c = mix3(c, [1, 1, 1], 0.6)
      else c = scl(c, 0.7)
      b.add(p, c, [h, edge, k])
    }
  })
  for (let i = 0; i < nRock; i++) {
    const a = R() * Math.PI * 2, r = Math.sqrt(R()) * 0.75
    b.add([Math.cos(a) * r, -1.02 + (R() - 0.5) * 0.08 * (1 - r), Math.sin(a) * r * 0.8], scl([0.4, 0.34, 0.38], 0.5 + R() * 0.4), [0, 0, 0])
  }
  return b.finish()
}

// ---------------------------------------------------------------- mushroom cluster (amanita) with glowing spores
// aux = (1 spore, 0, phase)
export function mushroom(count: number, seed = 81): Cloud {
  const R = rng(seed)
  const b = new Builder()
  const y0 = -1
  const shrooms = [
    { x: 0, z: 0, h: 1.1, capR: 0.75, capH: 0.42, tilt: 0 },
    { x: 0.78, z: 0.22, h: 0.55, capR: 0.38, capH: 0.22, tilt: 0.25 },
    { x: -0.65, z: 0.15, h: 0.42, capR: 0.3, capH: 0.18, tilt: -0.3 },
    { x: 0.32, z: -0.42, h: 0.3, capR: 0.22, capH: 0.13, tilt: 0.12 },
  ]
  const nSpore = Math.floor(count * 0.08), nMoss = Math.floor(count * 0.06)
  const budget = count - nSpore - nMoss
  const wsum = shrooms.reduce((a, m) => a + m.capR * m.capR + m.h * 0.05, 0)
  for (const m of shrooms) {
    const n = Math.floor((budget * (m.capR * m.capR + m.h * 0.05)) / wsum)
    const spots = Array.from({ length: 14 }, () => [Math.acos(1 - R() * 0.9), R() * Math.PI * 2] as const)
    const Y = y0 + m.h
    const stemR = m.capR * 0.17
    const ct = Math.cos(m.tilt), st = Math.sin(m.tilt)
    const place = (p: V3, c: V3) => {
      const x = p[0] * ct - (p[1] - y0) * st, y = y0 + p[0] * st + (p[1] - y0) * ct
      b.add([x + m.x, y, p[2] + m.z], c, [0, 0, 0])
    }
    for (let i = 0; i < n; i++) {
      const k = R()
      if (k < 0.55) {
        const th = Math.acos(1 - R()), ph = R() * Math.PI * 2
        const p: V3 = [Math.sin(th) * Math.cos(ph) * m.capR, Y - m.capH + Math.cos(th) * m.capH, Math.sin(th) * Math.sin(ph) * m.capR]
        let c: V3 = mix3([0.95, 0.12, 0.06], [1, 0.4, 0.1], smooth(1.2, 1.57, th))
        for (const [sth, sph] of spots) {
          const dd = Math.acos(Math.min(1, Math.sin(th) * Math.sin(sth) * Math.cos(ph - sph) + Math.cos(th) * Math.cos(sth)))
          if (dd < 0.13) { c = [1, 0.95, 0.88]; break }
        }
        place(p, c)
      } else if (k < 0.72) {
        const g = Math.floor(R() * 44), r = stemR + R() * (m.capR * 0.95 - stemR)
        const ph = (g / 44) * Math.PI * 2
        place([Math.cos(ph) * r, Y - m.capH - 0.01 + (r / m.capR) * 0.03, Math.sin(ph) * r], [0.95, 0.82, 0.65])
      } else {
        const u = R(), ph = R() * Math.PI * 2
        let rr = stemR * (1 + 0.45 * Math.pow(1 - u, 3))
        if (Math.abs(u - 0.75) < 0.04) rr *= 1.7
        place([Math.cos(ph) * rr, y0 + u * (m.h - m.capH), Math.sin(ph) * rr], mix3([0.92, 0.88, 0.8], [1, 0.98, 0.92], R()))
      }
    }
  }
  for (let i = 0; i < nMoss; i++) {
    const a = R() * Math.PI * 2, r = Math.sqrt(R()) * 1.15
    b.add([Math.cos(a) * r, y0 + (R() - 0.5) * 0.05, Math.sin(a) * r * 0.7], mix3([0.1, 0.35, 0.12], [0.3, 0.6, 0.2], R()), [0, 0, 0])
  }
  for (let i = 0; i < nSpore; i++) b.add([(R() - 0.5) * 1.8, y0 + 0.3 + R() * 1.2, (R() - 0.5) * 1.0], [0.5, 1, 0.75], [1, 0, R()])
  return b.finish()
}

// ---------------------------------------------------------------- ringed planet
// aux = (0 sphere | 1 ring, ring radius, 0)
export function planet(count: number, seed = 91): Cloud {
  const R = rng(seed)
  const b = new Builder()
  const nSphere = Math.floor(count * 0.55)
  const bands: V3[] = [[0.95, 0.86, 0.62], [0.85, 0.66, 0.42], [0.72, 0.52, 0.34], [0.98, 0.93, 0.78], [0.8, 0.6, 0.45]]
  for (let i = 0; i < nSphere; i++) {
    const a = R() * Math.PI * 2, y = R() * 2 - 1
    const rr = Math.sqrt(1 - y * y)
    const r = 0.6 * (R() < 0.9 ? 1 : 0.9 + R() * 0.1)
    const t = y * 7 + Math.sin(a * 3 + y * 10) * 0.15 + 50
    const bi = Math.floor(t) % bands.length
    const c = mix3(bands[bi], bands[(bi + 1) % bands.length], t - Math.floor(t))
    b.add([Math.cos(a) * rr * r, y * r, Math.sin(a) * rr * r], c, [0, 0.6, 0])
  }
  const rest = count - b.n
  let made = 0
  while (made < rest) {
    const r = 0.85 + R() * 0.75
    if (r > 1.22 && r < 1.28 && R() > 0.1) continue
    if (R() > 0.4 + 0.6 * smooth(0.85, 1.05, r)) continue
    const a = R() * Math.PI * 2
    const c = scl(mix3([0.88, 0.8, 0.66], [0.6, 0.55, 0.5], 0.5 + 0.5 * Math.sin(r * 40)), 0.85)
    b.add([Math.cos(a) * r, (R() - 0.5) * 0.012, Math.sin(a) * r], c, [1, r, 0])
    made++
  }
  return b.finish()
}

// ---------------------------------------------------------------- DNA double helix
// aux = (height, 0 strand | 1 rung | 2 sparkle, phase)
export function dna(count: number, seed = 101): Cloud {
  const R = rng(seed)
  const b = new Builder()
  const H = 3.2, R0 = 0.45, turns = 2.6
  const theta = (y: number) => ((y + H / 2) / H) * turns * Math.PI * 2
  const nStrand = Math.floor(count * 0.56), nRung = Math.floor(count * 0.36)
  for (let i = 0; i < nStrand; i++) {
    const B = R() < 0.5
    const y = -H / 2 + R() * H
    const th = theta(y) + (B ? Math.PI : 0)
    const bead = Math.abs((((y * 10) % 1) + 1) % 1 - 0.5) < 0.08
    const c: V3 = scl(B ? [1.0, 0.3, 0.8] : [0.2, 0.9, 1.0], bead ? 1.25 : 0.85)
    b.add([Math.cos(th) * R0 + (R() - 0.5) * 0.09, y + (R() - 0.5) * 0.09, Math.sin(th) * R0 + (R() - 0.5) * 0.09], c, [y, 0, 0])
  }
  const NR = 26
  const pairs: [V3, V3][] = [[[0.3, 1, 0.5], [1, 0.85, 0.2]], [[1, 0.4, 0.3], [0.4, 0.55, 1]]]
  for (let i = 0; i < nRung; i++) {
    const k = Math.floor(R() * NR)
    const y = -H / 2 + 0.05 + (k * (H - 0.1)) / (NR - 1)
    const th = theta(y)
    const v = R()
    const A: V3 = [Math.cos(th) * R0, y, Math.sin(th) * R0]
    const Bp: V3 = [-A[0], y, -A[2]]
    const pr = pairs[k % 2]
    const flip = k % 4 < 2
    const c = v < 0.5 ? pr[flip ? 0 : 1] : pr[flip ? 1 : 0]
    b.add(add(mix3(A, Bp, v), [(R() - 0.5) * 0.03, (R() - 0.5) * 0.03, (R() - 0.5) * 0.03]), c, [y, 1, 0])
  }
  const rest = count - b.n
  for (let i = 0; i < rest; i++) {
    const a = R() * Math.PI * 2, r = 0.5 + R() * 0.45
    b.add([Math.cos(a) * r, -H / 2 + R() * H, Math.sin(a) * r], [0.7, 0.8, 1], [0, 2, R()])
  }
  return b.finish()
}

// ---------------------------------------------------------------- lotus on a lily pad
// aux = (1 petal | 2 pad | 3 ripple | 0, layer openness or radius, position along petal or angle)
export function lotus(count: number, seed = 111): Cloud {
  const R = rng(seed)
  const b = new Builder()
  const layers = [
    { n: 5, len: 0.95, wid: 0.4, tilt0: 0.35, rot: 0, open: 0.35 },
    { n: 6, len: 1.12, wid: 0.46, tilt0: 0.8, rot: 0.45, open: 0.7 },
    { n: 7, len: 1.08, wid: 0.42, tilt0: 1.22, rot: 0.2, open: 1 },
  ]
  const nPetals = Math.floor(count * 0.74), nPod = Math.floor(count * 0.02), nStam = Math.floor(count * 0.025), nRipple = Math.floor(count * 0.02)
  const per = Math.floor(nPetals / layers.reduce((a, l) => a + l.n, 0))
  for (const L of layers) {
    for (let k = 0; k < L.n; k++) {
      const phi = L.rot + (k / L.n) * Math.PI * 2
      const cp = Math.cos(phi), sp = Math.sin(phi)
      for (let i = 0; i < per; i++) {
        let u = 0, v = 0, w = 0
        const rim = R() < 0.35
        if (rim) {
          // petal outline: both edges, densely
          u = R(); v = R() < 0.5 ? -1 : 1
          w = Math.pow(Math.sin(Math.PI * Math.pow(u, 0.65)), 0.9)
        } else {
          for (let tries = 0; tries < 8; tries++) {
            u = R(); v = R() * 2 - 1
            w = Math.pow(Math.sin(Math.PI * Math.pow(u, 0.65)), 0.9)
            if (R() < w) break
          }
        }
        let px = 0, py = 0
        for (let s = 1; s <= 6; s++) {
          const th = L.tilt0 + ((u * s) / 6) * 0.35
          px += (Math.sin(th) * L.len * u) / 6
          py += (Math.cos(th) * L.len * u) / 6
        }
        const lx = px - (1 - v * v) * w * 0.06
        const lz = v * w * L.wid
        // soft petal body with a bright pink-white rim so each petal reads as a shape
        let c: V3 = scl(mix3([0.6, 0.45, 0.5], [1.0, 0.35, 0.62], smooth(0.15, 0.9, u)), 0.6)
        if (rim) c = mix3([1, 0.82, 0.92], [1, 0.42, 0.7], smooth(0.2, 1, u))
        b.add([lx * cp - lz * sp, 0.05 + py, lx * sp + lz * cp], c, [1, L.open, u])
      }
    }
  }
  for (let i = 0; i < nPod; i++) {
    const a = R() * Math.PI * 2, r = Math.sqrt(R()) * 0.17
    const dot = Math.sin(a * 6) * Math.sin(r * 60) > 0.6
    b.add([Math.cos(a) * r, 0.16 + (R() - 0.5) * 0.02, Math.sin(a) * r], dot ? [0.3, 0.36, 0.08] : [0.5, 0.55, 0.18], [0, 0, 0])
  }
  for (let i = 0; i < nStam; i++) {
    const a = R() * Math.PI * 2, r = 0.18 + R() * 0.07, u = R()
    b.add([Math.cos(a) * r, 0.05 + u * 0.15, Math.sin(a) * r], u > 0.85 ? [0.8, 0.7, 0.3] : [0.6, 0.45, 0.12], [0, 0, 0])
  }
  const nPad = count - b.n - nRipple
  for (let i = 0; i < nPad; i++) {
    const a = 0.35 + R() * (Math.PI * 2 - 0.35), r = Math.sqrt(R()) * 1.2
    const vein = Math.pow(Math.abs(Math.cos(a * 11)), 30)
    b.add([Math.cos(a) * r, -0.12 + Math.pow(r / 1.2, 6) * 0.06, Math.sin(a) * r], mix3([0.1, 0.4, 0.14], [0.32, 0.68, 0.26], R() * 0.5 + vein * 0.5), [2, r, a])
  }
  for (let i = 0; i < nRipple; i++) {
    const a = R() * Math.PI * 2, r = 1.32 + R() * 0.25
    b.add([Math.cos(a) * r, -0.13, Math.sin(a) * r], [0.5, 0.8, 1], [3, r, 0])
  }
  return b.finish()
}

// ---------------------------------------------------------------- flame spirit
// Not normalized: the shader rebuilds each body point from aux = (h0, 1 + radial·0.9, angle) so the
// flame keeps flowing upward; aux.y = 3 marks the eyes, 4 the sparks.
export function flame(count: number, seed = 121): Cloud {
  const R = rng(seed)
  const b = new Builder()
  const prof = (h: number) => 0.5 * Math.pow(Math.sin(Math.PI * Math.min(1, h * 1.1 + 0.02)), 0.7) * (1 - 0.55 * h)
  const nEye = Math.floor(count * 0.04), nSpark = Math.floor(count * 0.04)
  const nBody = count - nEye - nSpark
  for (let i = 0; i < nBody; i++) {
    const h0 = Math.pow(R(), 0.85), a = R() * Math.PI * 2, rf = Math.pow(R(), 0.75)
    b.add([rf * prof(h0) * Math.cos(a), -1 + 2 * h0, rf * prof(h0) * Math.sin(a) * 0.7], [1, 0.6, 0.1], [h0, 1 + rf * 0.9, a])
  }
  for (let i = 0; i < nEye; i++) {
    const s = R() < 0.5 ? -1 : 1
    const a = R() * Math.PI * 2, r = Math.sqrt(R()) * 0.045
    b.add([s * 0.13 + Math.cos(a) * r, -0.16 + Math.sin(a) * r * 1.4, 0.3], [0.6, 0.95, 1], [0.4, 3, 0])
  }
  for (let i = 0; i < nSpark; i++) b.add([(R() - 0.5) * 0.5, 0.9, (R() - 0.5) * 0.3], [1, 0.55, 0.15], [R(), 4, R() * 6.28])
  return b.finish(false)
}

// ---------------------------------------------------------------- text
// aux = (x position, 0, 0) for the wave
export function textCloud(text: string, count: number): Cloud {
  const R = rng(9)
  const t = (text || ' ').slice(0, 24)
  const cv = document.createElement('canvas')
  cv.width = 1024
  cv.height = 256
  const ctx = cv.getContext('2d', { willReadFrequently: true })!
  let px = 190
  ctx.font = `700 ${px}px Inter, "Segoe UI", sans-serif`
  const w0 = ctx.measureText(t).width
  if (w0 > 980) { px = Math.floor((px * 980) / w0); ctx.font = `700 ${px}px Inter, "Segoe UI", sans-serif` }
  ctx.fillStyle = '#fff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(t, 512, 132)
  const d = ctx.getImageData(0, 0, 1024, 256).data
  const pix: number[] = []
  for (let y = 0; y < 256; y += 2) for (let x = 0; x < 1024; x += 2) if (d[(y * 1024 + x) * 4 + 3] > 128) pix.push(x, y)
  const b = new Builder()
  const n = pix.length / 2
  if (!n) { b.add([0, 0, 0], [1, 1, 1]); return b.finish() }
  for (let i = 0; i < count; i++) {
    const k = Math.floor(R() * n)
    const x = pix[k * 2] + (R() - 0.5) * 2, y = pix[k * 2 + 1] + (R() - 0.5) * 2
    b.add([(x - 512) / 512, -(y - 128) / 512, (R() - 0.5) * 0.06], mix3([1, 1, 1], [0.7, 0.85, 1], y / 256), [(x - 512) / 512, 0, 0])
  }
  return b.finish()
}
