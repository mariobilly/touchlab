// Guillotine layout for Cell Poster: a binary tree of cuts whose ratios animate, with leaves that
// carry how each cell samples the source. Coordinates are area-normalized, y down.

export function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 0 offset · 1 stretch-X · 2 stretch-Y · 3 scan (per-band drift) · 4 mirror · 5 zoom */
export type CellMode = 0 | 1 | 2 | 3 | 4 | 5

export interface Leaf {
  mode: CellMode
  ox: number; oy: number
  tox: number; toy: number
  extra: number
  /** scan cells: drift amount and direction (0 = columns slide vertically, 1 = rows slide sideways) */
  scan: number
  scanDir: number
  seed: number
  /** image shown at rest, and the current cell-by-cell transition (from → to, starting at t0; t0 < 0 = idle) */
  img: number
  from: number
  to: number
  t0: number
  wipe: number
  born: number
  label: string | null
  data: string[]
}

export interface Node {
  id: number
  axis: 0 | 1
  ratio: number
  target: number
  base: number
  strip: boolean
  a: Node | null
  b: Node | null
  leaf: Leaf | null
  next: number
  x: number; y: number; w: number; h: number
}

export interface LeafOpts {
  offsetAmt: number
  displaceChance: number
  stretchMix: number
  scanMix: number
  zoomMix: number
  zoomMax: number
  mirrorMix: number
  labelChance: number
}

export interface GrowOpts {
  aspect: number
  minSize: number
  stripChance: number
}

const q24 = (r: number) => Math.round(r * 24) / 24

export class Layout {
  root: Node
  private nextId = 1
  rand: () => number
  /** Which image a new cell shows (set by the scene: current image in Cycle, random in Mix). */
  pickImage: () => number = () => 0

  constructor(seed: number, public leafOpts: LeafOpts, public growOpts: GrowOpts) {
    this.rand = mulberry32(seed)
    this.root = this.leafNode(0, 1, 1)
  }

  private hex(n: number) { return Math.floor(this.rand() * 16 ** n).toString(16).padStart(n, '0') }

  makeLeaf(now: number, w: number, h: number): Leaf {
    const r = this.rand
    const o = this.leafOpts
    const tot = 1 + o.stretchMix + o.scanMix + o.zoomMix + o.mirrorMix
    let x = r() * tot
    let mode: CellMode = 0
    if ((x -= 1) < 0) mode = 0
    else if ((x -= o.stretchMix) < 0) mode = (h * 1.0 > w * this.growOpts.aspect ? 2 : 1) as CellMode
    else if ((x -= o.scanMix) < 0) mode = 3
    else if ((x -= o.zoomMix) < 0) mode = 5
    else mode = 4
    if ((mode === 1 || mode === 2) && r() < 0.25) mode = (3 - mode) as CellMode
    const disp = r() < o.displaceChance
    const tox = disp ? (r() * 2 - 1) * o.offsetAmt : 0
    const toy = disp ? (r() * 2 - 1) * o.offsetAmt * 0.6 : 0
    const extra = mode === 5 ? 1.4 + r() * Math.max(0, o.zoomMax - 1.4) : r()
    const label = r() < o.labelChance ? `// pose${100 + Math.floor(r() * 900)}` : null
    const data: string[] = []
    if (label && r() < 0.6) for (let i = 0, n = 2 + Math.floor(r() * 5); i < n; i++) data.push(`${i}: 0.${this.hex(3)}${Math.floor(r() * 1e9)}`)
    const img = this.pickImage()
    return { mode, ox: tox, oy: toy, tox, toy, extra, scan: 0.3 + r() * 0.7, scanDir: r() < 0.7 ? 0 : 1, seed: r(), born: now, label, data, img, from: img, to: img, t0: -1, wipe: 0 }
  }

  leafNode(now: number, w: number, h: number): Node {
    return { id: this.nextId++, axis: 0, ratio: 0.5, target: 0.5, base: 0.5, strip: false, a: null, b: null, leaf: this.makeLeaf(now, w, h), next: 0, x: 0, y: 0, w, h }
  }

  leaves(n: Node = this.root, out: Node[] = []): Node[] {
    if (n.leaf) out.push(n)
    else { this.leaves(n.a!, out); this.leaves(n.b!, out) }
    return out
  }

  /** Assigns rects to every node from the current (animated) ratios. */
  place(n: Node = this.root, x = 0, y = 0, w = 1, h = 1) {
    n.x = x; n.y = y; n.w = w; n.h = h
    if (n.leaf) return
    if (n.axis === 0) {
      const wa = w * n.ratio
      this.place(n.a!, x, y, wa, h)
      this.place(n.b!, x + wa, y, w - wa, h)
    } else {
      const ha = h * n.ratio
      this.place(n.a!, x, y, w, ha)
      this.place(n.b!, x, y + ha, w, h - ha)
    }
  }

  private canSplit(n: Node) {
    const A = this.growOpts.aspect
    return Math.max(n.w * A, n.h) > this.growOpts.minSize * 2.2
  }

  split(n: Node, now: number): boolean {
    const r = this.rand
    const A = this.growOpts.aspect
    const pw = n.w * A, ph = n.h
    let axis: 0 | 1 = pw > ph ? 0 : 1
    if (r() < 0.18) axis = (1 - axis) as 0 | 1
    const len = axis === 0 ? pw : ph
    if (len < this.growOpts.minSize * 2.2) axis = (1 - axis) as 0 | 1
    const len2 = axis === 0 ? pw : ph
    if (len2 < this.growOpts.minSize * 2.2) return false
    // thin strip bursts along x (the sliced columns in the reel)
    if (axis === 0 && n.w * n.h < 0.16 && r() < this.growOpts.stripChance && pw > this.growOpts.minSize * 4) {
      const k = Math.min(12, 3 + Math.floor(r() * 7), Math.floor(pw / (this.growOpts.minSize * 0.35)))
      if (k >= 3) { this.strips(n, k, now); return true }
    }
    const minR = Math.min(0.45, this.growOpts.minSize / len2)
    const ratio = Math.min(1 - minR, Math.max(minR, q24(0.2 + r() * 0.6)))
    const leaf = n.leaf!
    n.leaf = null
    n.axis = axis
    n.ratio = n.target = n.base = ratio
    n.strip = false
    n.next = now + 1 + r() * 4
    const wa = axis === 0 ? n.w * ratio : n.w, ha = axis === 1 ? n.h * ratio : n.h
    n.a = { ...this.leafNode(now, wa, ha), leaf: r() < 0.5 ? { ...leaf, born: leaf.born } : this.makeLeaf(now, wa, ha) }
    n.b = this.leafNode(now, axis === 0 ? n.w - wa : n.w, axis === 1 ? n.h - ha : n.h)
    return true
  }

  private strips(n: Node, k: number, now: number) {
    const r = this.rand
    const widths = Array.from({ length: k }, () => 0.25 + r())
    const sharedLeaf = this.makeLeaf(now, n.w / k, n.h)
    // strips share a sampling idea (mostly stretch / scan) and one image so they read as one sliced block
    const stripMode: CellMode = r() < 0.5 ? 2 : r() < 0.6 ? 3 : 0
    const build = (node: Node, i: number) => {
      if (i === k - 1) {
        node.leaf = { ...this.makeLeaf(now, n.w / k, n.h), mode: stripMode, tox: sharedLeaf.tox + (r() - 0.5) * 0.04, toy: sharedLeaf.toy, img: sharedLeaf.img, from: sharedLeaf.img, to: sharedLeaf.img }
        node.a = node.b = null
        return
      }
      const rest = widths.slice(i).reduce((s, v) => s + v, 0)
      node.leaf = null
      node.axis = 0
      node.ratio = node.target = node.base = widths[i] / rest
      node.strip = true
      node.next = now + 0.5 + r() * 3
      node.a = this.leafNode(now, n.w / k, n.h)
      node.a.leaf = { ...node.a.leaf!, mode: stripMode, tox: sharedLeaf.tox + (r() - 0.5) * 0.04, toy: sharedLeaf.toy, label: null, data: [], img: sharedLeaf.img, from: sharedLeaf.img, to: sharedLeaf.img }
      node.b = this.leafNode(now, n.w, n.h)
      build(node.b, i + 1)
    }
    build(n, 0)
  }

  /** Splits weighted-random leaves under `root` until it has `count` leaves (at most `maxSteps` splits). */
  grow(count: number, now: number, root: Node = this.root, maxSteps = 400) {
    let ls = this.leaves(root)
    let steps = 0
    while (ls.length < count && steps++ < maxSteps) {
      const cands = ls.filter(l => this.canSplit(l))
      if (!cands.length) break
      const A = this.growOpts.aspect
      const ws = cands.map(l => Math.pow(l.w * A * l.h, 1.25))
      let pick = this.rand() * ws.reduce((s, v) => s + v, 0)
      let chosen = cands[0]
      for (let i = 0; i < cands.length; i++) { if ((pick -= ws[i]) <= 0) { chosen = cands[i]; break } }
      this.split(chosen, now)
      this.place()
      ls = this.leaves(root)
    }
  }

  /** Merges one pair of sibling leaves. */
  shrinkOne(): boolean {
    const pairs: Node[] = []
    const walk = (n: Node) => {
      if (n.leaf) return
      if (n.a!.leaf && n.b!.leaf) pairs.push(n)
      else { walk(n.a!); walk(n.b!) }
    }
    walk(this.root)
    if (!pairs.length) return false
    const n = pairs[Math.floor(this.rand() * pairs.length)]
    n.leaf = n.a!.w * n.a!.h >= n.b!.w * n.b!.h ? n.a!.leaf : n.b!.leaf
    n.a = n.b = null
    return true
  }

  /** Re-randomizes the subtree at `n`, keeping roughly the same number of cells. */
  rebuild(n: Node, now: number, count?: number) {
    const c = count ?? Math.max(2, this.leaves(n).length)
    n.leaf = this.makeLeaf(now, n.w, n.h)
    n.a = n.b = null
    this.grow(c, now, n)
  }

  internals(n: Node = this.root, out: { node: Node; depth: number; size: number }[] = [], depth = 0): { node: Node; depth: number; size: number }[] {
    if (n.leaf) return out
    out.push({ node: n, depth, size: this.leaves(n).length })
    this.internals(n.a!, out, depth + 1)
    this.internals(n.b!, out, depth + 1)
    return out
  }

  /** Leaf containing the point (area coords, y down). */
  hit(x: number, y: number, n: Node = this.root): Node | null {
    if (x < n.x || y < n.y || x > n.x + n.w || y > n.y + n.h) return null
    if (n.leaf) return n
    return this.hit(x, y, n.a!) ?? this.hit(x, y, n.b!)
  }

  parentOf(target: Node, n: Node = this.root): Node | null {
    if (n.leaf) return null
    if (n.a === target || n.b === target) return n
    return this.parentOf(target, n.a!) ?? this.parentOf(target, n.b!)
  }

  /** Animates split ratios and cell offsets. */
  animate(now: number, dt: number, animate: number, slideSpeed: number) {
    const r = this.rand
    const k = 1 - Math.exp(-dt * slideSpeed)
    const walk = (n: Node) => {
      if (n.leaf) {
        const l = n.leaf
        l.ox += (l.tox - l.ox) * k
        l.oy += (l.toy - l.oy) * k
        return
      }
      if (animate > 0 && now > n.next) {
        n.target = n.strip
          ? Math.min(0.9, Math.max(0.05, n.base * (0.7 + r() * 0.6)))
          : Math.min(0.82, Math.max(0.18, q24(n.base + (r() - 0.5) * 0.5 * animate)))
        n.next = now + (1.2 + r() * 5) / animate
      }
      n.ratio += (n.target - n.ratio) * k
      walk(n.a!); walk(n.b!)
    }
    walk(this.root)
  }

  retargetOffsets(amt: number, chance: number) {
    for (const l of this.leaves()) {
      if (this.rand() < 0.35) {
        const disp = this.rand() < chance
        l.leaf!.tox = disp ? (this.rand() * 2 - 1) * amt : 0
        l.leaf!.toy = disp ? (this.rand() * 2 - 1) * amt * 0.6 : 0
      }
    }
  }
}
