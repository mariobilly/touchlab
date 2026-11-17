import * as THREE from 'three'

export function makeTarget(w: number, h: number, opts: { float?: boolean; depth?: boolean; nearest?: boolean } = {}) {
  const rt = new THREE.WebGLRenderTarget(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)), {
    type: opts.float ? THREE.HalfFloatType : THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    minFilter: opts.nearest ? THREE.NearestFilter : THREE.LinearFilter,
    magFilter: opts.nearest ? THREE.NearestFilter : THREE.LinearFilter,
    depthBuffer: !!opts.depth,
    stencilBuffer: false,
    generateMipmaps: false,
  })
  rt.texture.colorSpace = THREE.NoColorSpace
  return rt
}

export function clearTarget(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget | null, color: THREE.ColorRepresentation = 0x000000, alpha = 1) {
  const c = renderer.getClearColor(new THREE.Color())
  const a = renderer.getClearAlpha()
  renderer.setClearColor(color, alpha)
  renderer.setRenderTarget(target)
  renderer.clear(true, true, false)
  renderer.setClearColor(c, a)
}

/** Two render targets for feedback effects: read `.read`, write `.write`, then `swap()`. */
export class PingPong {
  a: THREE.WebGLRenderTarget
  b: THREE.WebGLRenderTarget
  constructor(w: number, h: number, float = true) {
    this.a = makeTarget(w, h, { float })
    this.b = makeTarget(w, h, { float })
  }
  get read() { return this.a }
  get write() { return this.b }
  swap() { const t = this.a; this.a = this.b; this.b = t }
  setSize(w: number, h: number) { this.a.setSize(Math.round(w), Math.round(h)); this.b.setSize(Math.round(w), Math.round(h)) }
  clear(renderer: THREE.WebGLRenderer, color: THREE.ColorRepresentation = 0x000000, alpha = 1) {
    clearTarget(renderer, this.a, color, alpha)
    clearTarget(renderer, this.b, color, alpha)
  }
  dispose() { this.a.dispose(); this.b.dispose() }
}
