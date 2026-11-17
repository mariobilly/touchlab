import * as THREE from 'three'

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`

let tri: THREE.BufferGeometry | null = null
function fullscreenTriangle() {
  if (tri) return tri
  tri = new THREE.BufferGeometry()
  tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3))
  tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2))
  return tri
}

/**
 * One fullscreen fragment pass. three compiles every shader as GLSL ES 3.00 (WebGL2) with compatibility
 * defines: declare `varying vec2 vUv;` and your uniforms, sample with `texture(...)`, write
 * `gl_FragColor`. Helper libraries live in gfx/glsl.ts.
 */
export class FsPass {
  readonly material: THREE.ShaderMaterial
  readonly uniforms: Record<string, THREE.IUniform>
  private mesh: THREE.Mesh
  private scene = new THREE.Scene()
  private static camera = new THREE.Camera()

  constructor(fragment: string, uniforms: Record<string, THREE.IUniform> = {}, opts: Partial<THREE.ShaderMaterialParameters> = {}) {
    this.uniforms = uniforms
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: fragment,
      uniforms,
      depthTest: false,
      depthWrite: false,
      ...opts,
    })
    this.mesh = new THREE.Mesh(fullscreenTriangle(), this.material)
    this.mesh.frustumCulled = false
    this.scene.add(this.mesh)
  }

  /** Draws over whatever is in `target` (no clear). `layer` selects an array-target layer. */
  render(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget | null, layer?: number) {
    const prevAuto = renderer.autoClear
    renderer.autoClear = false
    renderer.setRenderTarget(target, layer)
    renderer.render(this.scene, FsPass.camera)
    renderer.autoClear = prevAuto
  }

  dispose() { this.material.dispose() }
}
