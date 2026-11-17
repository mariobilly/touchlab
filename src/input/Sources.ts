import * as THREE from 'three'
import { DemoSource } from './DemoSource'

export type SourceKind = 'webcam' | 'video' | 'image' | 'demo'

function videoEl() {
  const v = document.createElement('video')
  v.muted = true
  v.playsInline = true
  v.loop = true
  v.autoplay = true
  v.crossOrigin = 'anonymous'
  return v
}

/**
 * Visual source (what scenes process) and the camera stream (where hands come from).
 * The webcam stream is opened once and shared when it is both the visual and control input.
 */
export class Sources {
  kind: SourceKind = 'demo'
  name = 'Demo performer'
  tex: THREE.Texture
  width = 720
  height = 1280
  frameId = 0
  error = ''

  readonly demo = new DemoSource()
  private demoTex: THREE.CanvasTexture
  private fileVideo: HTMLVideoElement | null = null
  private fileUrl = ''
  private imageTex: THREE.Texture | null = null
  private imageEl: HTMLImageElement | null = null
  private videoTex: THREE.VideoTexture | null = null

  camStream: MediaStream | null = null
  camVideo: HTMLVideoElement | null = null
  private camTex: THREE.VideoTexture | null = null
  camDeviceId = ''
  camFrame = 0
  private onChange: () => void

  constructor(onChange: () => void) {
    this.onChange = onChange
    this.demoTex = new THREE.CanvasTexture(this.demo.canvas)
    this.demoTex.colorSpace = THREE.NoColorSpace
    this.demoTex.minFilter = THREE.LinearFilter
    this.demoTex.generateMipmaps = false
    this.tex = this.demoTex
  }

  get element(): CanvasImageSource | null {
    if (this.kind === 'demo') return this.demo.canvas
    if (this.kind === 'webcam') return this.camVideo
    if (this.kind === 'video') return this.fileVideo
    return this.imageEl
  }

  get moving() { return this.kind !== 'image' }

  /** The video element hands should be tracked on (null when there is no camera). */
  controlVideo(): HTMLVideoElement | null {
    return this.camVideo && this.camVideo.readyState >= 2 ? this.camVideo : null
  }

  /** Video element of the visual source, when it is a video (for tracking hands in a clip). */
  visualVideo(): HTMLVideoElement | null {
    if (this.kind === 'webcam') return this.controlVideo()
    if (this.kind === 'video' && this.fileVideo && this.fileVideo.readyState >= 2) return this.fileVideo
    return null
  }

  async listCameras(): Promise<MediaDeviceInfo[]> {
    try {
      return (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput')
    } catch { return [] }
  }

  async openCamera(deviceId = this.camDeviceId, hd = false): Promise<boolean> {
    this.closeCamera()
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          width: { ideal: hd ? 1920 : 1280 },
          height: { ideal: hd ? 1080 : 720 },
          frameRate: { ideal: 60 },
        },
        audio: false,
      })
      const v = videoEl()
      v.srcObject = stream
      await v.play().catch(() => {})
      await new Promise<void>(res => { if (v.readyState >= 2) res(); else v.onloadeddata = () => res() })
      this.camStream = stream
      this.camVideo = v
      this.camDeviceId = stream.getVideoTracks()[0]?.getSettings().deviceId || deviceId || ''
      const tick = () => {
        if (this.camVideo !== v) return
        this.camFrame++
        if (this.kind === 'webcam') this.frameId++
        v.requestVideoFrameCallback(tick)
      }
      v.requestVideoFrameCallback(tick)
      this.camTex = new THREE.VideoTexture(v)
      this.camTex.colorSpace = THREE.NoColorSpace
      this.camTex.generateMipmaps = false
      this.error = ''
      return true
    } catch (e) {
      this.error = (e as Error).name === 'NotAllowedError' ? 'Camera permission was denied.' : `Camera unavailable: ${(e as Error).message}`
      return false
    }
  }

  closeCamera() {
    this.camStream?.getTracks().forEach(t => t.stop())
    this.camStream = null
    if (this.camVideo) this.camVideo.srcObject = null
    this.camVideo = null
    this.camTex?.dispose()
    this.camTex = null
    if (this.kind === 'webcam') this.useDemo()
  }

  async useWebcam(deviceId?: string): Promise<boolean> {
    if (!this.camVideo || (deviceId && deviceId !== this.camDeviceId)) {
      if (!(await this.openCamera(deviceId))) return false
    }
    this.releaseFile()
    this.kind = 'webcam'
    this.name = 'Webcam'
    this.tex = this.camTex!
    this.width = this.camVideo!.videoWidth
    this.height = this.camVideo!.videoHeight
    this.frameId++
    this.onChange()
    return true
  }

  useDemo() {
    this.releaseFile()
    this.kind = 'demo'
    this.name = 'Demo performer'
    this.tex = this.demoTex
    this.width = this.demo.width
    this.height = this.demo.height
    this.onChange()
  }

  async useFile(file: File): Promise<boolean> {
    const url = URL.createObjectURL(file)
    if (file.type.startsWith('image/')) {
      const img = new Image()
      img.src = url
      try { await img.decode() } catch { URL.revokeObjectURL(url); this.error = 'Could not read that image.'; return false }
      this.releaseFile()
      const t = new THREE.Texture(img)
      t.colorSpace = THREE.NoColorSpace
      t.minFilter = THREE.LinearFilter
      t.generateMipmaps = false
      t.needsUpdate = true
      this.imageTex = t
      this.imageEl = img
      this.fileUrl = url
      this.kind = 'image'
      this.tex = t
      this.width = img.naturalWidth
      this.height = img.naturalHeight
    } else {
      const v = videoEl()
      v.src = url
      try {
        await new Promise<void>((res, rej) => { v.onloadeddata = () => res(); v.onerror = () => rej(new Error('decode')) })
        await v.play()
      } catch { URL.revokeObjectURL(url); this.error = 'Could not play that video (try MP4 / WebM / MOV with H.264).'; return false }
      this.releaseFile()
      this.fileVideo = v
      this.fileUrl = url
      const tick = () => {
        if (this.fileVideo !== v) return
        this.frameId++
        v.requestVideoFrameCallback(tick)
      }
      v.requestVideoFrameCallback(tick)
      this.videoTex = new THREE.VideoTexture(v)
      this.videoTex.colorSpace = THREE.NoColorSpace
      this.videoTex.generateMipmaps = false
      this.kind = 'video'
      this.tex = this.videoTex
      this.width = v.videoWidth
      this.height = v.videoHeight
    }
    this.name = file.name
    this.error = ''
    this.frameId++
    this.onChange()
    return true
  }

  get fileVideoEl() { return this.fileVideo }

  private releaseFile() {
    if (this.fileVideo) { this.fileVideo.pause(); this.fileVideo.removeAttribute('src'); this.fileVideo.load() }
    this.fileVideo = null
    this.videoTex?.dispose(); this.videoTex = null
    this.imageTex?.dispose(); this.imageTex = null
    this.imageEl = null
    if (this.fileUrl) URL.revokeObjectURL(this.fileUrl)
    this.fileUrl = ''
  }

  update(t: number, frozen: boolean) {
    if (this.kind === 'demo' && !frozen) {
      this.demo.draw(t)
      this.demoTex.needsUpdate = true
      this.frameId++
    }
    if (this.kind === 'webcam' && this.camVideo) { this.width = this.camVideo.videoWidth || this.width; this.height = this.camVideo.videoHeight || this.height }
    if (this.fileVideo) {
      if (frozen && !this.fileVideo.paused) this.fileVideo.pause()
      else if (!frozen && this.fileVideo.paused) this.fileVideo.play().catch(() => {})
    }
  }
}
