import * as THREE from 'three'
import { FsPass } from './FsPass'
import { makeTarget } from './targets'

/** Cheap glow: bright-pass + downsample, two separable blurs, then add over the input. */
export class Bloom {
  private a: THREE.WebGLRenderTarget
  private b: THREE.WebGLRenderTarget
  private bright: FsPass
  private blur: FsPass
  private combine: FsPass

  constructor(w: number, h: number) {
    this.a = makeTarget(w / 4, h / 4, { float: true })
    this.b = makeTarget(w / 4, h / 4, { float: true })
    this.bright = new FsPass(/* glsl */ `
      precision highp float;
      varying vec2 vUv;
      uniform sampler2D tSrc; uniform float uThreshold; uniform vec2 uTexel;
      void main() {
        vec3 c = vec3(0.0);
        for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) c += texture(tSrc, vUv + vec2(x, y) * uTexel).rgb;
        c /= 9.0;
        float l = max(c.r, max(c.g, c.b));
        gl_FragColor = vec4(c * smoothstep(uThreshold, uThreshold + 0.25, l), 1.0);
      }`, { tSrc: { value: null }, uThreshold: { value: 0.6 }, uTexel: { value: new THREE.Vector2() } })
    this.blur = new FsPass(/* glsl */ `
      precision highp float;
      varying vec2 vUv;
      uniform sampler2D tSrc; uniform vec2 uDir;
      void main() {
        vec3 c = texture(tSrc, vUv).rgb * 0.227027;
        c += texture(tSrc, vUv + uDir * 1.3846).rgb * 0.316216;
        c += texture(tSrc, vUv - uDir * 1.3846).rgb * 0.316216;
        c += texture(tSrc, vUv + uDir * 3.2307).rgb * 0.070270;
        c += texture(tSrc, vUv - uDir * 3.2307).rgb * 0.070270;
        gl_FragColor = vec4(c, 1.0);
      }`, { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } })
    this.combine = new FsPass(/* glsl */ `
      precision highp float;
      varying vec2 vUv;
      uniform sampler2D tSrc; uniform sampler2D tBloom; uniform float uStrength; uniform vec3 uTint;
      void main() {
        vec4 s = texture(tSrc, vUv);
        gl_FragColor = vec4(s.rgb + texture(tBloom, vUv).rgb * uStrength * uTint, 1.0);
      }`, { tSrc: { value: null }, tBloom: { value: null }, uStrength: { value: 0.8 }, uTint: { value: new THREE.Color(1, 1, 1) } })
  }

  setSize(w: number, h: number) {
    this.a.setSize(Math.max(1, Math.round(w / 4)), Math.max(1, Math.round(h / 4)))
    this.b.setSize(Math.max(1, Math.round(w / 4)), Math.max(1, Math.round(h / 4)))
  }

  /** Reads `input`, writes input + glow into `output` (must differ from input). */
  render(renderer: THREE.WebGLRenderer, input: THREE.Texture, output: THREE.WebGLRenderTarget | null, opts: { threshold?: number; strength?: number; radius?: number; tint?: THREE.Color } = {}) {
    const w = this.a.width, h = this.a.height
    this.bright.uniforms.tSrc.value = input
    this.bright.uniforms.uThreshold.value = opts.threshold ?? 0.6
    this.bright.uniforms.uTexel.value.set(1 / (w * 4), 1 / (h * 4))
    this.bright.render(renderer, this.a)
    const r = opts.radius ?? 1.5
    for (let i = 0; i < 2; i++) {
      this.blur.uniforms.tSrc.value = this.a.texture
      this.blur.uniforms.uDir.value.set(r * (i + 1) / w, 0)
      this.blur.render(renderer, this.b)
      this.blur.uniforms.tSrc.value = this.b.texture
      this.blur.uniforms.uDir.value.set(0, r * (i + 1) / h)
      this.blur.render(renderer, this.a)
    }
    this.combine.uniforms.tSrc.value = input
    this.combine.uniforms.tBloom.value = this.a.texture
    this.combine.uniforms.uStrength.value = opts.strength ?? 0.8
    if (opts.tint) this.combine.uniforms.uTint.value.copy(opts.tint)
    this.combine.render(renderer, output)
  }

  dispose() {
    this.a.dispose(); this.b.dispose()
    this.bright.dispose(); this.blur.dispose(); this.combine.dispose()
  }
}
