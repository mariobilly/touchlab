/// <reference lib="webworker" />
// MediaPipe runs here so inference never blocks rendering. One worker instance per task.
// GPU delegate by default (about 15 ms per frame in Edge/Chrome here); it falls back to CPU if it
// cannot start. CPU stays selectable in the panel.
import { FilesetResolver, HandLandmarker, ImageSegmenter } from '@mediapipe/tasks-vision'

declare const self: DedicatedWorkerGlobalScope

let hands: HandLandmarker | null = null
let seg: ImageSegmenter | null = null
let lastTs = 0
let delegate: 'GPU' | 'CPU' = 'CPU'

async function init(task: 'hands' | 'segment', base: string, preferred: 'GPU' | 'CPU') {
  const fileset = await FilesetResolver.forVisionTasks(`${base}mediapipe/wasm`, true)
  const make = async (d: 'GPU' | 'CPU') => {
    if (task === 'hands') {
      hands = await HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: `${base}models/hand_landmarker.task`, delegate: d },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      })
    } else {
      seg = await ImageSegmenter.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: `${base}models/selfie_segmenter.tflite`, delegate: d },
        runningMode: 'VIDEO',
        outputConfidenceMasks: true,
        outputCategoryMask: false,
      })
    }
    delegate = d
  }
  if (preferred === 'CPU') return make('CPU')
  try { await make('GPU') } catch (e) {
    console.warn('[vision] GPU delegate unavailable, using CPU', e)
    await make('CPU')
  }
}

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data
  if (msg.type === 'init') {
    try {
      await init(msg.task, msg.base, msg.delegate === 'GPU' ? 'GPU' : 'CPU')
      self.postMessage({ type: 'ready', delegate })
    } catch (err) {
      self.postMessage({ type: 'error', message: (err as Error).message })
    }
    return
  }
  if (msg.type === 'frame') {
    const bmp: ImageBitmap = msg.bitmap
    const ts = Math.max(lastTs + 1, Math.round(msg.ts))
    lastTs = ts
    const t0 = performance.now()
    try {
      if (hands) {
        const res = hands.detectForVideo(bmp, ts)
        const out: { lm: Float32Array; score: number; label: string }[] = []
        res.landmarks.forEach((pts, i) => {
          const lm = new Float32Array(63)
          pts.forEach((p, j) => { lm[j * 3] = p.x; lm[j * 3 + 1] = p.y; lm[j * 3 + 2] = p.z })
          const h = res.handedness?.[i]?.[0]
          out.push({ lm, score: h?.score ?? 1, label: h?.categoryName ?? '' })
        })
        self.postMessage({ type: 'hands', id: msg.id, hands: out, ms: performance.now() - t0, w: bmp.width, h: bmp.height }, out.map(o => o.lm.buffer))
      } else if (seg) {
        let payload: { mask: Float32Array; w: number; h: number } | null = null
        seg.segmentForVideo(bmp, ts, (r) => {
          const m = r.confidenceMasks?.[0]
          if (m) payload = { mask: new Float32Array(m.getAsFloat32Array()), w: m.width, h: m.height }
          r.close()
        })
        const p = payload as { mask: Float32Array; w: number; h: number } | null
        if (p) self.postMessage({ type: 'mask', id: msg.id, ...p, ms: performance.now() - t0 }, [p.mask.buffer])
        else self.postMessage({ type: 'mask', id: msg.id, mask: null, ms: performance.now() - t0 })
      } else {
        self.postMessage({ type: 'skip', id: msg.id })
      }
    } catch (err) {
      self.postMessage({ type: 'skip', id: msg.id, error: (err as Error).message })
    } finally {
      bmp.close()
    }
    return
  }
  if (msg.type === 'reset') { lastTs = 0 }
}
