import type * as THREE from 'three'
import type { HandsState } from '../input/hands/types'
import type { FsPass } from '../gfx/FsPass'

export type ParamValue = number | boolean | string
export type Values = Record<string, ParamValue>

export interface ParamSpec {
  id: string
  label: string
  group?: string
  type: 'float' | 'int' | 'bool' | 'enum' | 'color' | 'text' | 'pulse'
  min?: number
  max?: number
  step?: number
  options?: string[]
  default: ParamValue
  /**
   * Random button behaviour for this param: false = never touch it; [lo, hi] = custom range for
   * numbers (for a bool, any array opts it in). Defaults: floats/ints pick from the middle 80% of
   * min..max, enums pick any option, bools/colors/text are left alone unless the scene's own
   * randomize() sets them.
   */
  random?: false | [number, number]
}

/** An image the user uploaded to a scene (persisted per scene, decoded for you). */
export interface SceneImage {
  id: string
  name: string
  bitmap: ImageBitmap
  width: number
  height: number
}

/** Typed read access to the current parameter values. */
export interface Params {
  n(id: string): number
  b(id: string): boolean
  s(id: string): string
  /** Color param as [r,g,b] in 0..1. */
  c(id: string): [number, number, number]
  raw: Values
}

export interface SourceFrame {
  /** Current visual source (webcam / video / image / demo). Always valid. */
  tex: THREE.Texture
  width: number
  height: number
  aspect: number
  /**
   * Cover transform in GL uv space (y up): srcUV = uvXform.zw + outUV * uvXform.xy.
   * Mirroring is a negative x scale. Use it so every scene frames the source the same way.
   */
  uvXform: THREE.Vector4
  /** Person mask (R channel, 1 = person) in the same uv space as `tex`, when the scene asked for segmentation. */
  mask: THREE.Texture | null
  /** Increments each time a new source frame arrives. */
  frameId: number
  /** True when the source is a live camera or a playing video (false for a still image). */
  moving: boolean
  /** Draw the current source frame into a 2D canvas (for CPU sampling, e.g. gallery cards). */
  element: CanvasImageSource | null
  kind: 'webcam' | 'video' | 'image' | 'demo'
}

export interface Shared {
  /** Fullscreen-pass helper factory (opts e.g. { transparent: true, blending: THREE.NormalBlending }). */
  pass(fragment: string, uniforms?: Record<string, THREE.IUniform>, opts?: Partial<THREE.ShaderMaterialParameters>): FsPass
  /** Blit a texture into a target (null = screen). */
  copy(tex: THREE.Texture, target: THREE.WebGLRenderTarget | null): void
  /** 256x256 RGBA random texture, repeat-wrapped. */
  noiseTex: THREE.Texture
}

export interface FrameCtx {
  renderer: THREE.WebGLRenderer
  /** Render-target size in pixels (output size × render scale). */
  width: number
  height: number
  /** Output aspect, width / height. */
  aspect: number
  /** Pixel ratio between this target and the full export size (1 when recording). */
  scale: number
  time: { t: number; dt: number; frame: number }
  source: SourceFrame
  hands: HandsState
  p: Params
  /** Pulses triggered this frame (Enter key, pulse buttons). */
  pulses: string[]
  shared: Shared
  /** True while frozen (Space): scenes should hold their animation clocks. */
  frozen: boolean
  recording: boolean
}

export interface SceneInstance {
  resize(width: number, height: number): void
  update(f: FrameCtx): void
  /** Draw the full frame into `target` (it is cleared beforehand). */
  render(f: FrameCtx, target: THREE.WebGLRenderTarget): void
  /** Short live readout shown in the HUD, e.g. "142 cells". */
  status?(): string
  /** Files dropped on the stage while this scene is active (images go to `setImages` instead when the scene declares `images`). */
  drop?(files: File[]): boolean
  /** The scene's uploaded images, in order. Called right after create and whenever the user adds/removes images. */
  setImages?(images: SceneImage[]): void
  /** Mouse click (no drag) on the output, in output coords (x 0..1, y 0..1 down). Return true if handled. */
  click?(x: number, y: number): boolean
  dispose(): void
}

export interface SceneCreateCtx {
  renderer: THREE.WebGLRenderer
  width: number
  height: number
  shared: Shared
}

export interface SceneDef {
  id: string
  name: string
  /** Short tagline shown under the scene name. */
  tag: string
  blurb: string
  /** Accent color for the scene tile (TouchDesigner operator-family style). */
  color: string
  needs: {
    hands: boolean
    /**
     * 'video': hands line up with the camera image as the output would crop it.
     * 'frame': the whole camera frame maps to the whole output.
     * A function can pick per current params (e.g. 'video' only while the camera is the background).
     */
    handMapping: 'video' | 'frame' | ((p: Params) => 'video' | 'frame')
    segmentation?: boolean
    /** false = this scene ignores the global Source (e.g. it uses its own images); the Source bar dims. Default true. */
    source?: boolean
  }
  /** Scene-owned image slots, shown as an upload strip in the panel and persisted per scene. */
  images?: { max: number; label: string; hint?: string; /** longest side stored, px (default 2048) */ maxSize?: number }
  /** Random button: return new values (merged over the current ones). Without it, params are randomized generically. */
  randomize?(rnd: () => number, current: Values): Partial<Values>
  params: ParamSpec[]
  presets: Record<string, Partial<Values>>
  /** One line per gesture, shown in the help strip. */
  gestures: string[]
  create(ctx: SceneCreateCtx): SceneInstance
}
