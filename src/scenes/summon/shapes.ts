// Procedural point clouds for the Summon scene. Every generator returns positions normalized to
// fit inside a radius-1 ball (y up), per-point colours and an `aux` vec3 the vertex shader uses
// for animation (wing side, spine parameter, height…). No external assets.

export interface Cloud {
  pos: Float32Array
  col: Float32Array
  aux: Float32Array
  count: number
}

export type Kind =
  | 'flower' | 'butterfly' | 'tree' | 'dragon' | 'image' | 'jellyfish' | 'koi' | 'phoenix' | 'galaxy'
  | 'heart' | 'crystal' | 'mushroom' | 'planet' | 'dna' | 'lotus' | 'flame' | 'text'
export const KIND_ID: Record<Kind, number> = {
  flower: 0, butterfly: 1, tree: 2, dragon: 3, image: 4, jellyfish: 5, koi: 6, phoenix: 7, galaxy: 8,
  heart: 9, crystal: 10, mushroom: 11, planet: 12, dna: 13, lotus: 14, flame: 15, text: 16,
}

export type V3 = [number, number, number]

export function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export class Builder {
  pos: number[] = []
  col: number[] = []
  aux: number[] = []
  add(p: V3, c: V3, a: V3 = [0, 0, 0]) {
    this.pos.push(p[0], p[1], p[2])
    this.col.push(c[0], c[1], c[2])
    this.aux.push(a[0], a[1], a[2])
  }
  get n() { return this.pos.length / 3 }
  /** Center on the bounding box and scale into a radius-1 ball. Returns the applied transform. */
  finish(normalize = true): Cloud & { center: V3; scale: number } {
    const n = this.n
    if (!normalize) return { pos: new Float32Array(this.pos), col: new Float32Array(this.col), aux: new Float32Array(this.aux), count: n, center: [0, 0, 0], scale: 1 }
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
    for (let i = 0; i < n; i++) {
      const x = this.pos[i * 3], y = this.pos[i * 3 + 1], z = this.pos[i * 3 + 2]
      if (x < minX) minX = x; if (x > maxX) maxX = x
      if (y < minY) minY = y; if (y > maxY) maxY = y
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z
    }
    const c: V3 = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2]
    let r = 1e-6
    for (let i = 0; i < n; i++) {
      const d = Math.hypot(this.pos[i * 3] - c[0], this.pos[i * 3 + 1] - c[1], this.pos[i * 3 + 2] - c[2])
      if (d > r) r = d
    }
    const s = 1 / r
    const pos = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (this.pos[i * 3] - c[0]) * s
      pos[i * 3 + 1] = (this.pos[i * 3 + 1] - c[1]) * s
      pos[i * 3 + 2] = (this.pos[i * 3 + 2] - c[2]) * s
    }
    return { pos, col: new Float32Array(this.col), aux: new Float32Array(this.aux), count: n, center: c, scale: s }
  }
}

export const mix3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
export const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
export const smooth = (e0: number, e1: number, x: number) => { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t) }
export const norm = (v: V3): V3 => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l] }
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const scl = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s]

// ---------------------------------------------------------------- flower (stargazer lily cluster)
function lilyBloom(b: Builder, R: () => number, n: number, origin: V3, size: number, tiltX: number, tiltZ: number, spin: number) {
  const ct = Math.cos(tiltX), st = Math.sin(tiltX), cz = Math.cos(tiltZ), sz = Math.sin(tiltZ)
  const xf = (p: V3): V3 => {
    // spin about y, then tilt about x and z, then translate
    const cs = Math.cos(spin), ss = Math.sin(spin)
    let x = p[0] * cs + p[2] * ss, y = p[1], z = -p[0] * ss + p[2] * cs
    const y1 = y * ct - z * st, z1 = y * st + z * ct
    y = y1; z = z1
    const x2 = x * cz - y * sz, y2 = x * sz + y * cz
    return [origin[0] + x2 * size, origin[1] + y2 * size, origin[2] + z * size]
  }
  const petals = 6
  const nPetal = Math.floor(n * 0.86 / petals)
  for (let k = 0; k < petals; k++) {
    const phi = (k / petals) * Math.PI * 2 + (k % 2) * 0.08
    const L = k % 2 ? 0.95 : 1.05
    const W = k % 2 ? 0.2 : 0.26
    for (let i = 0; i < nPetal; i++) {
      // area-weighted sample of a lanceolate petal: u along the length, v across
      let u = 0, v = 0, w = 0
      for (let tries = 0; tries < 8; tries++) {
        u = R(); v = R() * 2 - 1
        w = Math.pow(Math.sin(Math.PI * Math.pow(u, 0.8)), 0.9) * (1 - 0.25 * u)
        if (R() < w) break
      }
      // the petal opens outward and recurves at the tip
      const theta = 0.45 + 1.55 * u * u
      // integrate the curve: approximate arc position
      const steps = 6
      let px = 0, py = 0
      for (let s = 1; s <= steps; s++) {
        const uu = (u * s) / steps
        const th = 0.45 + 1.55 * uu * uu
        px += Math.sin(th) * (L * u) / steps
        py += Math.cos(th) * (L * u) / steps
      }
      const across = v * w * W
      const cup = -Math.abs(v) * v * 0 - v * v * w * 0.06 // shallow cup along the midrib
      const local: V3 = [px, py + cup * Math.sin(theta), across]
      // rotate around y by phi (radial direction = x)
      const cp = Math.cos(phi), sp = Math.sin(phi)
      const p: V3 = [local[0] * cp - local[2] * sp, local[1] - Math.abs(v) * 0.02, local[0] * sp + local[2] * cp]
      // stargazer colouring: magenta center stripe, pink body, white ruffled edge, dark spots
      const edge = smooth(0.55, 0.95, Math.abs(v)) * 0.8 + smooth(0.82, 1, u) * 0.6
      let c: V3 = mix3([0.85, 0.06, 0.38], [1.0, 0.38, 0.62], smooth(0.0, 0.5, Math.abs(v) + u * 0.3))
      c = mix3(c, [1.0, 0.93, 0.96], clamp01(edge))
      if (u < 0.15) c = mix3([0.55, 0.85, 0.35], c, u / 0.15)
      if (u > 0.12 && u < 0.6 && Math.abs(v) < 0.55 && R() < 0.06) c = [0.45, 0.02, 0.12]
      b.add(xf(p), c, [0, 0, u])
    }
  }
  // stamens with brown anthers + pistil
  const nSt = Math.max(0, n - nPetal * petals)
  for (let i = 0; i < nSt; i++) {
    const k = Math.floor(R() * 7)
    const phi = (k / 6) * Math.PI * 2 + 0.3
    const u = R()
    const len = k === 6 ? 0.55 : 0.6
    const r = k === 6 ? 0 : 0.22 * u
    let p: V3 = [Math.cos(phi) * r, 0.05 + u * len, Math.sin(phi) * r]
    let c: V3 = k === 6 ? [0.75, 0.95, 0.6] : [0.85, 0.95, 0.7]
    if (u > 0.9) {
      p = add(p, [(R() - 0.5) * 0.06, (R() - 0.5) * 0.03, (R() - 0.5) * 0.06])
      c = k === 6 ? [0.9, 1.0, 0.7] : [0.75, 0.32, 0.12]
    }
    b.add(xf(p), c, [0, 0, 0])
  }
}

function stem(b: Builder, R: () => number, n: number, from: V3, to: V3, bend: V3, radius: number, color: V3) {
  for (let i = 0; i < n; i++) {
    const t = R()
    const q = 1 - t
    const p: V3 = [
      q * q * from[0] + 2 * q * t * bend[0] + t * t * to[0],
      q * q * from[1] + 2 * q * t * bend[1] + t * t * to[1],
      q * q * from[2] + 2 * q * t * bend[2] + t * t * to[2],
    ]
    const a = R() * Math.PI * 2
    const rr = radius * (0.7 + 0.3 * R())
    b.add([p[0] + Math.cos(a) * rr, p[1], p[2] + Math.sin(a) * rr], mix3(color, [color[0] * 0.6, color[1] * 0.75, color[2] * 0.6], R()), [0, 0, 0])
  }
}

function leaf(b: Builder, R: () => number, n: number, base: V3, dir: V3, len: number, width: number) {
  const d = norm(dir)
  const side = norm(cross(d, [0, 0, 1]))
  for (let i = 0; i < n; i++) {
    let u = 0, v = 0, w = 0
    for (let tries = 0; tries < 8; tries++) {
      u = R(); v = R() * 2 - 1
      w = Math.sin(Math.PI * Math.pow(u, 0.7))
      if (R() < w) break
    }
    const droop = -u * u * len * 0.35
    const p = add(add(base, scl(d, u * len)), add(scl(side, v * w * width), [0, droop, v * v * w * width * 0.3]))
    const c = mix3([0.12, 0.42, 0.12], [0.35, 0.72, 0.25], smooth(0, 1, 1 - Math.abs(v) + u * 0.2))
    b.add(p, Math.abs(v) < 0.06 ? [0.5, 0.8, 0.4] : c, [0, 0, 0])
  }
}

export function flower(count: number, seed = 7): Cloud {
  const R = rng(seed)
  const b = new Builder()
  lilyBloom(b, R, Math.floor(count * 0.5), [0, 0.35, 0], 1.0, 0.95, 0.12, 0.2)
  lilyBloom(b, R, Math.floor(count * 0.22), [0.75, -0.15, -0.2], 0.62, 1.05, -0.7, 1.1)
  // buds
  for (const [bx, by, bz, s] of [[-0.55, 0.05, 0.2, 0.32], [0.35, 0.75, -0.3, 0.26]] as const) {
    const nb = Math.floor(count * 0.03)
    for (let i = 0; i < nb; i++) {
      const u = R(), a = R() * Math.PI * 2
      const r = Math.sin(Math.PI * Math.pow(u, 0.6)) * 0.28 * s
      b.add([bx + Math.cos(a) * r, by + u * s * 1.6 - s * 0.4, bz + Math.sin(a) * r], mix3([0.45, 0.75, 0.35], [1.0, 0.45, 0.65], u), [0, 0, 0])
    }
  }
  const nStem = Math.floor(count * 0.08)
  stem(b, R, nStem, [0, 0.3, 0], [0.05, -1.7, 0.05], [-0.1, -0.6, 0], 0.03, [0.25, 0.55, 0.2])
  stem(b, R, Math.floor(nStem * 0.4), [0.7, -0.2, -0.2], [0.02, -0.9, 0.02], [0.45, -0.75, -0.1], 0.022, [0.25, 0.55, 0.2])
  stem(b, R, Math.floor(nStem * 0.25), [-0.55, -0.1, 0.2], [0.0, -0.75, 0.05], [-0.4, -0.6, 0.1], 0.018, [0.25, 0.55, 0.2])
  const rest = Math.max(0, count - b.n)
  const leaves: [V3, V3, number, number][] = [
    [[0.0, -0.9, 0.0], [-1, 0.5, 0.2], 0.9, 0.12],
    [[0.02, -1.2, 0.02], [1, 0.45, -0.3], 0.85, 0.11],
    [[0.0, -0.55, 0.0], [0.9, 0.9, 0.4], 0.7, 0.1],
    [[0.01, -1.45, 0.0], [-0.9, 0.3, -0.4], 0.75, 0.11],
  ]
  leaves.forEach(([base, dir, len, w]) => leaf(b, R, Math.floor(rest / leaves.length), base, dir, len, w))
  return b.finish()
}

// ---------------------------------------------------------------- butterfly (Temple Fay curve)
export function butterfly(count: number, seed = 11): Cloud {
  const R = rng(seed)
  const b = new Builder()
  // polar butterfly: r(θ) = e^{sin θ} − 2cos 4θ + sin⁵((2θ − π)/24); negative radii are dropped so
  // the four lobes on the diagonals become clean fore- and hind-wings around a vertical body.
  const curve = (th: number) => Math.max(0, Math.exp(Math.sin(th)) - 2 * Math.cos(4 * th) + Math.pow(Math.sin((2 * th - Math.PI) / 24), 5))
  const nWing = Math.floor(count * 0.88)
  let made = 0
  while (made < nWing) {
    const th = R() * Math.PI * 2
    const r0 = curve(th)
    if (r0 <= 0.05 || R() > r0 / 4.2) continue // area-weighted: bigger lobes get more points
    const f = Math.sqrt(R())
    const x = Math.cos(th) * r0 * f
    const y = Math.sin(th) * r0 * f
    if (Math.abs(x) < 0.06) continue
    // morpho blue: dark base by the body → electric blue → cyan sheen, dark border with white dots
    let c: V3 = mix3([0.02, 0.06, 0.3], [0.06, 0.42, 1.0], smooth(0.08, 0.5, f))
    c = mix3(c, [0.4, 0.92, 1.0], smooth(0.5, 0.8, f) * 0.55)
    const vein = Math.pow(Math.abs(Math.sin(th * 18)), 24) * smooth(0.2, 0.6, f)
    c = scl(c, 1 - vein * 0.7)
    if (f > 0.9) {
      c = [0.03, 0.08, 0.28]
      if (R() < 0.12 && f > 0.94) c = [0.95, 0.97, 1.0]
    }
    const z = (R() - 0.5) * 0.04
    b.add([x, y, z], c, [x, 1, 0])
    made++
  }
  // body, head, antennae
  const rest = count - b.n
  for (let i = 0; i < rest; i++) {
    const k = R()
    if (k < 0.7) {
      const u = R()
      const y = -1.9 + u * 3.0
      const rad = 0.14 * Math.sin(Math.PI * Math.pow(u, 0.8)) + 0.03
      const a = R() * Math.PI * 2
      b.add([Math.cos(a) * rad, y, Math.sin(a) * rad], mix3([0.05, 0.05, 0.12], [0.25, 0.35, 0.6], R()), [0, 0, 0])
    } else if (k < 0.85) {
      const a = R() * Math.PI * 2, e = Math.acos(R() * 2 - 1)
      b.add([Math.sin(e) * Math.cos(a) * 0.2, 1.25 + Math.cos(e) * 0.2, Math.sin(e) * Math.sin(a) * 0.2], [0.15, 0.2, 0.4], [0, 0, 0])
    } else {
      const s = R() < 0.5 ? -1 : 1, u = R()
      b.add([s * (0.08 + u * 0.7), 1.35 + u * 1.3 - u * u * 0.35, 0.02], u > 0.93 ? [0.8, 0.9, 1] : [0.2, 0.3, 0.55], [0, 0, 0])
    }
  }
  return b.finish()
}

// ---------------------------------------------------------------- tree (recursive branches + leaf clusters)
export function tree(count: number, seed = 5): Cloud {
  const R = rng(seed)
  const branches: { a: V3; b: V3; r: number; depth: number }[] = []
  const tips: { p: V3; r: number }[] = []
  const grow = (a: V3, dir: V3, len: number, r: number, depth: number) => {
    const bEnd = add(a, scl(dir, len))
    branches.push({ a, b: bEnd, r, depth })
    if (depth >= 6) { tips.push({ p: bEnd, r: 0.09 + R() * 0.07 }); return }
    if (depth >= 5) tips.push({ p: bEnd, r: 0.08 + R() * 0.06 })
    const kids = depth < 2 ? 3 : 2 + (R() < 0.4 ? 1 : 0)
    for (let k = 0; k < kids; k++) {
      const ang = (0.35 + R() * 0.45) * (depth === 0 ? 0.9 : 1)
      const around = (k / kids) * Math.PI * 2 + R() * 1.2
      // perpendicular basis around dir
      const up: V3 = Math.abs(dir[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]
      const p1 = norm(cross(dir, up))
      const p2 = cross(dir, p1)
      let nd = add(scl(dir, Math.cos(ang)), scl(add(scl(p1, Math.cos(around)), scl(p2, Math.sin(around))), Math.sin(ang)))
      nd = norm(add(nd, [0, 0.25, 0]))
      grow(bEnd, nd, len * (0.68 + R() * 0.12), r * 0.62, depth + 1)
    }
  }
  grow([0, -1.6, 0], [0, 1, 0], 0.95, 0.14, 0)
  const b = new Builder()
  // wood: points proportional to length × radius
  const nWood = Math.floor(count * 0.36)
  const weights = branches.map(br => Math.hypot(br.b[0] - br.a[0], br.b[1] - br.a[1], br.b[2] - br.a[2]) * (br.r + 0.01))
  const total = weights.reduce((s, w) => s + w, 0)
  branches.forEach((br, i) => {
    const n = Math.round((weights[i] / total) * nWood)
    const d = norm([br.b[0] - br.a[0], br.b[1] - br.a[1], br.b[2] - br.a[2]])
    const up: V3 = Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]
    const p1 = norm(cross(d, up)), p2 = cross(d, p1)
    for (let k = 0; k < n; k++) {
      const t = R()
      const a = R() * Math.PI * 2
      const rr = br.r * (1 - t * 0.35)
      const c = mix3([0.5, 0.3, 0.14], [0.85, 0.62, 0.38], R() * 0.6 + (Math.cos(a) > 0.3 ? 0.35 : 0))
      const p = add(mix3(br.a, br.b, t), add(scl(p1, Math.cos(a) * rr), scl(p2, Math.sin(a) * rr)))
      b.add(p, c, [p[1], 0, 0])
    }
  })
  // foliage: fuzzy spheres at the twig tips
  const nLeaf = count - b.n
  for (let i = 0; i < nLeaf; i++) {
    const tip = tips[Math.floor(R() * tips.length)]
    const a = R() * Math.PI * 2, e = Math.acos(R() * 2 - 1), rr = tip.r * Math.pow(R(), 0.6)
    const p: V3 = [tip.p[0] + Math.sin(e) * Math.cos(a) * rr, tip.p[1] + Math.cos(e) * rr * 0.75, tip.p[2] + Math.sin(e) * Math.sin(a) * rr]
    const g = R()
    // sunlit top of each puff is lighter
    const lit = smooth(-0.6, 0.9, Math.cos(e))
    const c: V3 = g < 0.06 ? [0.85, 0.8, 0.3] : mix3([0.06, 0.35, 0.08], [0.45, 0.85, 0.25], clamp01(g * 0.5 + lit * 0.6))
    b.add(p, c, [p[1], 0, 0])
  }
  return b.finish()
}

// ---------------------------------------------------------------- dragon (serpentine body + wings)
function catmull(pts: V3[], t: number): V3 {
  const n = pts.length - 1
  const f = Math.min(n - 1e-6, Math.max(0, t * n))
  const i = Math.floor(f), u = f - i
  const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[Math.min(n, i + 1)], p3 = pts[Math.min(n, i + 2)]
  const q = (k: number) => 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * u + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * u * u + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * u * u * u)
  return [q(0), q(1), q(2)]
}

export const DRAGON_SHOULDER: V3 = [-0.12, 0.18, 0]

export function dragon(count: number, seed = 3): Cloud & { pivot: V3 } {
  const R = rng(seed)
  const spine: V3[] = [
    [-0.72, 0.62, 0.15], [-0.58, 0.72, 0.1], [-0.42, 0.55, 0.0], [-0.3, 0.3, -0.02], [-0.12, 0.15, 0.0], [0.08, 0.05, 0.05],
    [0.28, -0.05, 0.06], [0.48, -0.2, 0.0], [0.62, -0.42, -0.1], [0.6, -0.68, -0.18], [0.42, -0.82, -0.12], [0.26, -0.78, -0.02],
  ]
  const radius = (s: number) => {
    if (s < 0.06) return 0.075
    if (s < 0.22) return 0.055 + (s - 0.06) * 0.25
    if (s < 0.5) return 0.095 + Math.sin(((s - 0.22) / 0.28) * Math.PI) * 0.045
    return Math.max(0.008, 0.095 * Math.pow(1 - (s - 0.5) / 0.5, 1.4))
  }
  const b = new Builder()
  const nBody = Math.floor(count * 0.42)
  for (let i = 0; i < nBody; i++) {
    // sample s with density ∝ radius
    let s = 0
    for (let tries = 0; tries < 6; tries++) { s = 0.04 + R() * 0.96; if (R() < radius(s) / 0.14) break }
    const p = catmull(spine, s)
    const p2 = catmull(spine, Math.min(1, s + 0.01))
    const T = norm([p2[0] - p[0], p2[1] - p[1], p2[2] - p[2]])
    const N = norm(cross(T, [0, 0, 1]))
    const B = cross(T, N)
    const a = R() * Math.PI * 2
    const r = radius(s) * (0.85 + 0.15 * R())
    const off = add(scl(N, Math.cos(a) * r), scl(B, Math.sin(a) * r))
    const belly = Math.cos(a) < -0.3 // underside
    let c: V3 = belly ? [1.0, 0.42, 0.12] : mix3([0.55, 0.02, 0.03], [0.95, 0.1, 0.06], R())
    // scale ridges
    if (Math.sin(s * 160) > 0.85) c = scl(c, 0.6)
    b.add(add(p, off), c, [s, 0, 0])
  }
  // dorsal spikes
  const nSpike = Math.floor(count * 0.05)
  for (let i = 0; i < nSpike; i++) {
    const k = Math.floor(R() * 26)
    const s = 0.06 + (k / 26) * 0.88
    const p = catmull(spine, s)
    const p2 = catmull(spine, Math.min(1, s + 0.01))
    const T = norm([p2[0] - p[0], p2[1] - p[1], p2[2] - p[2]])
    const N = norm(cross(T, [0, 0, 1]))
    const u = R()
    const h = radius(s) * 1.4 + 0.02
    const tip = add(p, scl(N, -radius(s) - h * u))
    b.add(add(tip, scl(T, (R() - 0.5) * 0.02 * (1 - u))), [0.4 + u * 0.4, 0.03, 0.03], [s, 0, 0])
  }
  // head: snout ellipsoid, jaw, horns, glowing eyes
  const head: V3 = [-0.8, 0.6, 0.18]
  const nHead = Math.floor(count * 0.08)
  for (let i = 0; i < nHead; i++) {
    const k = R()
    if (k < 0.62) {
      const a = R() * Math.PI * 2, e = Math.acos(R() * 2 - 1)
      const p: V3 = [head[0] + Math.sin(e) * Math.cos(a) * 0.16, head[1] + Math.cos(e) * 0.065, head[2] + Math.sin(e) * Math.sin(a) * 0.07]
      b.add(p, mix3([0.7, 0.03, 0.03], [1, 0.2, 0.08], R()), [0, 0, 0])
    } else if (k < 0.8) {
      const u = R()
      const p: V3 = [head[0] - 0.05 - u * 0.12, head[1] - 0.07 - u * 0.04, head[2] + (R() - 0.5) * 0.08]
      b.add(p, [0.95, 0.35, 0.1], [0, 0, 0])
    } else if (k < 0.96) {
      const s = R() < 0.5 ? -1 : 1, u = R()
      const p: V3 = [head[0] + 0.1 + u * 0.18, head[1] + 0.06 + u * 0.16 - u * u * 0.05, head[2] + s * (0.04 + u * 0.05)]
      b.add(p, [0.35 + u * 0.4, 0.15, 0.08], [0, 0, 0])
    } else {
      const s = R() < 0.5 ? -1 : 1
      b.add([head[0] - 0.02 + (R() - 0.5) * 0.02, head[1] + 0.035, head[2] + s * 0.06], [1, 0.9, 0.2], [0, 0, 0])
    }
  }
  // legs
  const nLeg = Math.floor(count * 0.04)
  for (let i = 0; i < nLeg; i++) {
    const s = R() < 0.5 ? 0.38 : 0.6
    const p = catmull(spine, s)
    const u = R()
    const side = R() < 0.5 ? -1 : 1
    const q: V3 = [p[0] + u * 0.05, p[1] - 0.08 - u * 0.22, p[2] + side * 0.07]
    b.add(add(q, [(R() - 0.5) * 0.03, 0, (R() - 0.5) * 0.03]), u > 0.88 ? [0.95, 0.85, 0.7] : [0.75, 0.05, 0.04], [s, 0, 0])
  }
  // wings: four finger bones from the shoulder, membrane fans between them
  const nWing = count - b.n
  const sh = DRAGON_SHOULDER
  for (const side of [-1, 1]) {
    const zDir = side
    const fingers: V3[] = [
      [sh[0] - 0.55, sh[1] + 0.95, sh[2] + zDir * 0.25],
      [sh[0] - 0.05, sh[1] + 1.05, sh[2] + zDir * 0.4],
      [sh[0] + 0.42, sh[1] + 0.82, sh[2] + zDir * 0.45],
      [sh[0] + 0.72, sh[1] + 0.38, sh[2] + zDir * 0.35],
      [sh[0] + 0.55, sh[1] - 0.05, sh[2] + zDir * 0.1],
    ]
    const elbow: V3 = [sh[0] - 0.22, sh[1] + 0.48, sh[2] + zDir * 0.18]
    const half = Math.floor(nWing / 2)
    for (let i = 0; i < half; i++) {
      const k = R()
      let p: V3
      let c: V3
      if (k < 0.12) {
        // bones: shoulder → elbow → finger tips
        const f = Math.floor(R() * fingers.length)
        const u = R()
        p = R() < 0.25 ? mix3(sh, elbow, u) : mix3(elbow, fingers[f], u)
        c = [1.0, 0.35, 0.12]
      } else {
        // membrane: triangle (elbow, finger f, finger f+1) with a scalloped trailing edge
        const f = Math.floor(R() * (fingers.length - 1))
        let a = R(), bb = R()
        if (a + bb > 1) { a = 1 - a; bb = 1 - bb }
        const base = f === fingers.length - 2 ? sh : elbow
        p = add(base, add(scl([fingers[f][0] - base[0], fingers[f][1] - base[1], fingers[f][2] - base[2]], a), scl([fingers[f + 1][0] - base[0], fingers[f + 1][1] - base[1], fingers[f + 1][2] - base[2]], bb)))
        const edge = a + bb
        if (edge > 0.85 && R() < 0.6) continue
        c = mix3([0.7, 0.04, 0.04], [1.0, 0.22, 0.08], clamp01(edge * 0.7 + R() * 0.3))
      }
      const dist = Math.hypot(p[0] - sh[0], p[1] - sh[1])
      b.add(p, c, [0, side, dist])
    }
  }
  const out = b.finish()
  const pivot: V3 = [(sh[0] - out.center[0]) * out.scale, (sh[1] - out.center[1]) * out.scale, (sh[2] - out.center[2]) * out.scale]
  return { ...out, pivot }
}

// ---------------------------------------------------------------- image → particles
export function fromImage(src: CanvasImageSource, srcW: number, srcH: number, maxPoints = 40000): Cloud {
  const S = 260
  const k = Math.min(1, S / Math.max(srcW, srcH))
  const w = Math.max(2, Math.round(srcW * k)), h = Math.max(2, Math.round(srcH * k))
  const cv = document.createElement('canvas')
  cv.width = w; cv.height = h
  const ctx = cv.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(src, 0, 0, w, h)
  const d = ctx.getImageData(0, 0, w, h).data
  // transparent PNG → alpha key; otherwise key out the average corner colour
  let transparent = 0
  for (let i = 3; i < d.length; i += 4) if (d[i] < 128) transparent++
  const useAlpha = transparent > w * h * 0.02
  const corner = [0, 0, 0]
  for (const [x, y] of [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]]) for (let c = 0; c < 3; c++) corner[c] += d[(y * w + x) * 4 + c] / 4
  const keep = (i: number) => useAlpha ? d[i + 3] >= 128 : Math.hypot(d[i] - corner[0], d[i + 1] - corner[1], d[i + 2] - corner[2]) > 40
  let valid = 0
  for (let i = 0; i < d.length; i += 4) if (keep(i)) valid++
  const reps = Math.max(1, Math.min(6, Math.floor(maxPoints / Math.max(1, valid))))
  const stride = valid > maxPoints ? Math.sqrt(valid / maxPoints) : 1
  const b = new Builder()
  const R = rng(1)
  for (let y = 0; y < h; y += stride) {
    for (let x = 0; x < w; x += stride) {
      const i = (Math.floor(y) * w + Math.floor(x)) * 4
      if (!keep(i)) continue
      const c: V3 = [d[i] / 255, d[i + 1] / 255, d[i + 2] / 255]
      const l = c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11
      for (let r = 0; r < reps; r++) {
        b.add([(x + R() - w / 2) / Math.max(w, h) * 2, -(y + R() - h / 2) / Math.max(w, h) * 2, (l - 0.5) * 0.18 + (R() - 0.5) * 0.03], c, [0, 0, 0])
      }
    }
  }
  if (b.n === 0) b.add([0, 0, 0], [1, 1, 1])
  return b.finish()
}
