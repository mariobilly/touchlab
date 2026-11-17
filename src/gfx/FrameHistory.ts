import * as THREE from 'three'
import { FsPass } from './FsPass'
import { GLSL } from './glsl'

/**
 * Ring buffer of past source frames in a 2D array texture (for slit-scan / time-displacement).
 * Frames are stored already cover-transformed into output uv space, so sample with plain uv.
 * In a shader: `uniform sampler2DArray tHistory; uniform float uHead, uDepth;`
 * k frames ago → layer `mod(uHead - k + uDepth, uDepth)`.
 */
export class FrameHistory {
  readonly target: THREE.WebGLArrayRenderTarget
  head = -1
  filled = 0
  private pass: FsPass
  readonly uniforms: { tHistory: THREE.IUniform; uHead: THREE.IUniform; uDepth: THREE.IUniform }

  constructor(w: number, h: number, readonly depth = 48) {
    this.target = new THREE.WebGLArrayRenderTarget(Math.round(w), Math.round(h), depth, { depthBuffer: false })
    this.target.texture.minFilter = THREE.LinearFilter
    this.target.texture.magFilter = THREE.LinearFilter
    this.target.texture.generateMipmaps = false
    this.target.texture.colorSpace = THREE.NoColorSpace
    this.pass = new FsPass(/* glsl */ `
      precision highp float;
      varying vec2 vUv;
      uniform sampler2D tSrc;
      uniform vec4 uXf;
      ${GLSL.common}
      void main() { gl_FragColor = vec4(texture(tSrc, coverUV(vUv, uXf)).rgb, 1.0); }
    `, { tSrc: { value: null }, uXf: { value: new THREE.Vector4(1, 1, 0, 0) } })
    this.uniforms = { tHistory: { value: this.target.texture }, uHead: { value: 0 }, uDepth: { value: depth } }
  }

  push(renderer: THREE.WebGLRenderer, src: THREE.Texture, uvXform: THREE.Vector4) {
    this.head = (this.head + 1) % this.depth
    this.filled = Math.min(this.depth, this.filled + 1)
    this.pass.uniforms.tSrc.value = src
    this.pass.uniforms.uXf.value.copy(uvXform)
    this.pass.render(renderer, this.target as unknown as THREE.WebGLRenderTarget, this.head)
    // Until the buffer fills, copy the first frame everywhere so old layers are not black.
    if (this.filled === 1) for (let i = 0; i < this.depth; i++) if (i !== this.head) this.pass.render(renderer, this.target as unknown as THREE.WebGLRenderTarget, i)
    this.uniforms.uHead.value = this.head
  }

  dispose() { this.target.dispose(); this.pass.dispose() }
}
