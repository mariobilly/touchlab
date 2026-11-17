// Copies the MediaPipe wasm runtime into public/ and downloads the hand and selfie models once
// from Google's model storage (Apache-2.0), so the app then runs fully offline. Runs after
// `npm install`; run it again with `npm run setup-assets`. Each model is checked against its
// SHA-256, and models already in place are skipped.
import { mkdirSync, existsSync, copyFileSync, readdirSync, writeFileSync, statSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pub = join(root, 'public')
const wasmSrc = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm')
const wasmDst = join(pub, 'mediapipe', 'wasm')
mkdirSync(wasmDst, { recursive: true })
for (const f of readdirSync(wasmSrc)) copyFileSync(join(wasmSrc, f), join(wasmDst, f))
console.log('[setup-assets] copied MediaPipe wasm runtime')

const modelDir = join(pub, 'models')
mkdirSync(modelDir, { recursive: true })
const mp = (path) => `https://storage.googleapis.com/mediapipe-models/${path}`
const models = [
  { name: 'hand_landmarker.task', url: mp('hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'),
    size: 7819105, sha256: 'fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1' },
  { name: 'selfie_segmenter.tflite', url: mp('image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite'),
    size: 249537, sha256: '191ac9529ae506ee0beefa6b2c945a172dab9d07d1e802a290a4e4038226658b' },
]
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')
try {
  for (const m of models) {
    const dst = join(modelDir, m.name)
    if (existsSync(dst) && statSync(dst).size === m.size && sha256(readFileSync(dst)) === m.sha256) {
      console.log(`[setup-assets] ${m.name} present`)
      continue
    }
    console.log(`[setup-assets] downloading ${m.name} (${(m.size / 1e6).toFixed(1)} MB)`)
    const res = await fetch(m.url)
    if (!res.ok) throw new Error(`${m.name}: HTTP ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    if (sha256(buf) !== m.sha256) throw new Error(`${m.name}: checksum mismatch (got ${buf.length} bytes)`)
    writeFileSync(dst, buf)
    console.log(`[setup-assets] downloaded ${m.name}`)
  }
} catch (e) {
  console.error(`\n[setup-assets] Couldn't fetch the hand-tracking models: ${e.message}\nCheck your connection and run: npm run setup-assets`)
  process.exit(1)
}
