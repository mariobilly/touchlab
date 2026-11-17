import { api } from './Api'

const TYPES = [
  'video/mp4;codecs=avc1.640028',
  'video/mp4;codecs=avc1.4d002a',
  'video/mp4;codecs=avc1',
  'video/x-matroska;codecs=avc1',
  'video/webm;codecs=h264',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
]

export function supportedTypes() {
  return Object.fromEntries(TYPES.map(t => [t, typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)]))
}

function pickType() {
  return TYPES.find(t => MediaRecorder.isTypeSupported(t)) ?? ''
}

export interface ExportResult { file: string; bytes: number; seconds: number; encoder: string }

/** Records the output canvas with MediaRecorder; the local server turns it into an H.264 MP4. */
export class Recorder {
  state: 'idle' | 'recording' | 'exporting' = 'idle'
  startedAt = 0
  mime = ''
  private rec: MediaRecorder | null = null
  private chunks: Blob[] = []
  private stream: MediaStream | null = null
  private done: Promise<Blob> | null = null

  get elapsed() { return this.state === 'recording' ? (performance.now() - this.startedAt) / 1000 : 0 }

  start(canvas: HTMLCanvasElement, fps: number) {
    if (this.state !== 'idle') return
    this.mime = pickType()
    this.stream = canvas.captureStream(fps)
    const px = canvas.width * canvas.height
    const bps = Math.round(Math.min(40e6, Math.max(8e6, px * fps * 0.4)))
    this.rec = new MediaRecorder(this.stream, { mimeType: this.mime || undefined, videoBitsPerSecond: bps })
    this.chunks = []
    this.done = new Promise<Blob>(resolve => {
      this.rec!.ondataavailable = e => { if (e.data.size) this.chunks.push(e.data) }
      this.rec!.onstop = () => resolve(new Blob(this.chunks, { type: this.rec?.mimeType || this.mime || 'video/webm' }))
    })
    this.rec.start(1000)
    this.startedAt = performance.now()
    this.state = 'recording'
  }

  /** Stops and exports. Returns the saved MP4, or a local download when the server is unavailable. */
  async stop(scene: string, fps: number, audio = false): Promise<ExportResult | { downloaded: string }> {
    if (this.state !== 'recording' || !this.rec || !this.done) throw new Error('Not recording')
    this.rec.stop()
    this.stream?.getTracks().forEach(t => t.stop())
    this.state = 'exporting'
    try {
      const blob = await this.done
      const type = blob.type || this.mime
      const ext = type.includes('mp4') ? 'mp4' : type.includes('matroska') ? 'mkv' : 'webm'
      try {
        return await api.exportVideo(blob, { scene, fps, ext, audio })
      } catch (e) {
        if ((e as Error).message.startsWith('server:')) throw new Error((e as Error).message.slice(7))
        const name = `TouchLab_${scene}_${Date.now()}.${ext}`
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = name
        a.click()
        setTimeout(() => URL.revokeObjectURL(a.href), 10000)
        return { downloaded: name }
      }
    } finally {
      this.state = 'idle'
      this.rec = null
      this.stream = null
      this.chunks = []
    }
  }
}
