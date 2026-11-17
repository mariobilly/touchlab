import * as THREE from 'three'

// One big canvas texture holds every card image: 16 × 8 cells of 256 × 384 px.
export const CELL_W = 256
export const CELL_H = 384
export const COLS = 16
export const ROWS = 8
export const ATLAS_W = CELL_W * COLS
export const ATLAS_H = CELL_H * ROWS
export const SLOTS = COLS * ROWS
const PAD = 3

export interface Slot { rect: [number, number, number, number]; aspect: number }

/**
 * Card image atlas. `put` draws into a cell on the CPU canvas and queues the cell; `flush`
 * uploads queued cells with copyTextureToTexture (a full re-upload only on the first frame or
 * when many cells changed). flipY is off, so atlas v grows downward like the canvas.
 */
export class Atlas {
  readonly canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  readonly tex: THREE.CanvasTexture
  readonly slots: (Slot | null)[] = new Array(SLOTS).fill(null)
  private cell: HTMLCanvasElement
  private cellCtx: CanvasRenderingContext2D
  private pending = new Map<number, HTMLCanvasElement>()
  private initialized = false

  constructor(renderer: THREE.WebGLRenderer) {
    this.canvas = document.createElement('canvas')
    this.canvas.width = ATLAS_W
    this.canvas.height = ATLAS_H
    this.ctx = this.canvas.getContext('2d')!
    this.cell = document.createElement('canvas')
    this.cell.width = CELL_W
    this.cell.height = CELL_H
    this.cellCtx = this.cell.getContext('2d', { willReadFrequently: true })!
    this.tex = new THREE.CanvasTexture(this.canvas)
    this.tex.flipY = false
    this.tex.colorSpace = THREE.NoColorSpace
    this.tex.generateMipmaps = true
    this.tex.minFilter = THREE.LinearMipmapLinearFilter
    this.tex.magFilter = THREE.LinearFilter
    this.tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
  }

  /** Card size inside a cell for an aspect (w / h), clamped to fit. */
  static fit(aspect: number) {
    const a = Math.min(2, Math.max(0.5, aspect))
    let w = CELL_W - PAD * 2
    let h = w / a
    if (h > CELL_H - PAD * 2) { h = CELL_H - PAD * 2; w = h * a }
    return { w: Math.round(w), h: Math.round(h) }
  }

  /** Draws a card image into `slot`. `draw` paints a w × h image at the origin of a fresh canvas. */
  put(slot: number, aspect: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void) {
    const { w, h } = Atlas.fit(aspect)
    const img = document.createElement('canvas')
    img.width = w
    img.height = h
    const ic = img.getContext('2d', { willReadFrequently: true })!
    draw(ic, w, h)
    // cell with edge extrusion into the padding (limits mipmap bleeding)
    const c = this.cellCtx
    c.clearRect(0, 0, CELL_W, CELL_H)
    c.drawImage(img, 0, 0, w, 1, PAD, 0, w, PAD)
    c.drawImage(img, 0, h - 1, w, 1, PAD, PAD + h, w, PAD)
    c.drawImage(img, 0, 0, 1, h, 0, PAD, PAD, h)
    c.drawImage(img, w - 1, 0, 1, h, PAD + w, PAD, PAD, h)
    c.drawImage(img, PAD, PAD)
    const col = slot % COLS, row = Math.floor(slot / COLS)
    const x0 = col * CELL_W, y0 = row * CELL_H
    this.ctx.clearRect(x0, y0, CELL_W, CELL_H)
    this.ctx.drawImage(this.cell, x0, y0)
    this.slots[slot] = {
      rect: [(x0 + PAD + 0.5) / ATLAS_W, (y0 + PAD + 0.5) / ATLAS_H, (x0 + PAD + w - 0.5) / ATLAS_W, (y0 + PAD + h - 0.5) / ATLAS_H],
      aspect: w / h,
    }
    const snap = document.createElement('canvas')
    snap.width = CELL_W
    snap.height = CELL_H
    snap.getContext('2d')!.drawImage(this.cell, 0, 0)
    this.pending.set(slot, snap)
  }

  /** Forgets a slot (its pixels stay until overwritten). */
  free(slot: number) {
    this.slots[slot] = null
    this.pending.delete(slot)
  }

  flush(renderer: THREE.WebGLRenderer) {
    if (!this.pending.size) return
    if (!this.initialized || this.pending.size > 12) {
      this.tex.needsUpdate = true
      this.pending.clear()
      this.initialized = true
      return
    }
    for (const [slot, snap] of this.pending) {
      const t = new THREE.CanvasTexture(snap)
      t.flipY = false
      t.colorSpace = THREE.NoColorSpace
      try {
        renderer.copyTextureToTexture(t, this.tex, null, new THREE.Vector2((slot % COLS) * CELL_W, Math.floor(slot / COLS) * CELL_H))
      } catch (e) {
        console.warn('[gallery] partial atlas upload failed, re-uploading', e)
        this.tex.needsUpdate = true
      }
      t.dispose()
    }
    this.pending.clear()
  }

  dispose() { this.tex.dispose() }
}
