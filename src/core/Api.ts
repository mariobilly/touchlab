// Calls to the local TouchLab server. Every POST carries X-TouchLab so the server can refuse
// requests from other web pages.
const H = { 'X-TouchLab': '1' }

async function json<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error('server:' + ((data as { error?: string }).error || `HTTP ${res.status}`))
  return data as T
}

export interface Health { app: string; version: string; ffmpeg: boolean; encoder: string; outDir: string }

export const api = {
  async health(): Promise<Health | null> {
    try { return await json<Health>(await fetch('/api/health', { cache: 'no-store' })) } catch { return null }
  },
  async exportVideo(blob: Blob, o: { scene: string; fps: number; ext: string; audio: boolean }) {
    const q = new URLSearchParams({ scene: o.scene, fps: String(o.fps), ext: o.ext, audio: o.audio ? '1' : '0' })
    const res = await fetch(`/api/export?${q}`, { method: 'POST', headers: { ...H, 'Content-Type': blob.type || 'application/octet-stream' }, body: blob })
    return json<{ file: string; bytes: number; seconds: number; encoder: string }>(res)
  },
  async snapshot(blob: Blob, scene: string) {
    const res = await fetch(`/api/snapshot?scene=${encodeURIComponent(scene)}`, { method: 'POST', headers: { ...H, 'Content-Type': 'image/png' }, body: blob })
    return json<{ file: string }>(res)
  },
  async reveal(file?: string) {
    await fetch('/api/reveal', { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ file }) }).catch(() => {})
  },
  async setOutDir(outDir: string) {
    return json<{ outDir: string }>(await fetch('/api/config', { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ outDir }) }))
  },
  startHeartbeat() {
    const beat = () => fetch('/api/heartbeat', { method: 'POST', headers: H }).catch(() => {})
    beat()
    setInterval(beat, 30000)
    window.addEventListener('pagehide', () => {
      // sendBeacon cannot set headers, so use a keepalive fetch instead.
      fetch('/api/bye', { method: 'POST', headers: H, keepalive: true }).catch(() => {})
    })
  },
}
