import type { SceneImage } from '../scenes/types'

// Per-scene uploaded images, kept in IndexedDB so they survive restarts. Images are downscaled
// to the scene's maxSize and re-encoded once on upload, so the store stays small.
const DB = 'touchlab'
const STORE = 'images'

interface Rec { id: string; scene: string; name: string; blob: Blob; added: number }

let dbp: Promise<IDBDatabase> | null = null
function db(): Promise<IDBDatabase> {
  if (dbp) return dbp
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => {
      const s = req.result.createObjectStore(STORE, { keyPath: 'id' })
      s.createIndex('scene', 'scene')
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbp
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return db().then(d => new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode)
    const r = fn(t.objectStore(STORE))
    t.oncomplete = () => resolve(r ? (r as IDBRequest<T>).result : undefined)
    t.onerror = () => reject(t.error)
  }))
}

async function records(scene: string): Promise<Rec[]> {
  const all = await tx<Rec[]>('readonly', s => s.index('scene').getAll(scene))
  return (all ?? []).sort((a, b) => a.added - b.added)
}

async function shrink(file: Blob, maxSize: number): Promise<Blob> {
  const bmp = await createImageBitmap(file)
  const k = Math.min(1, maxSize / Math.max(bmp.width, bmp.height))
  if (k >= 1 && file.size < 6e6) { bmp.close(); return file }
  const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k))
  const c = new OffscreenCanvas(w, h)
  c.getContext('2d')!.drawImage(bmp, 0, 0, w, h)
  bmp.close()
  const png = /png|webp|gif/i.test(file.type) // keep transparency when the source may have it
  return c.convertToBlob(png ? { type: 'image/png' } : { type: 'image/jpeg', quality: 0.92 })
}

const IMG_EXT = /\.(png|jpe?g|webp|gif|bmp|avif|heic|heif|tiff?)$/i
export const isImage = (f: File) => f.type.startsWith('image/') || (!f.type && IMG_EXT.test(f.name))

export const ImageStore = {
  async count(scene: string) { return (await records(scene)).length },

  /** Adds up to the scene's remaining capacity; returns how many were added, skipped (no room) and unreadable. */
  async add(scene: string, files: File[], max: number, maxSize = 2048): Promise<{ added: number; skipped: number; failed: string[] }> {
    const imgs = files.filter(isImage)
    const room = Math.max(0, max - (await records(scene)).length)
    const take = imgs.slice(0, room)
    let n = 0
    const failed: string[] = []
    for (const f of take) {
      try {
        const blob = await shrink(f, maxSize)
        const rec: Rec = { id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, scene, name: f.name, blob, added: Date.now() + n }
        await tx('readwrite', s => { s.put(rec) })
        n++
      } catch (e) { console.warn('[images] could not read', f.name, e); failed.push(f.name) }
    }
    return { added: n, skipped: Math.max(0, imgs.length - take.length), failed }
  },

  async remove(id: string) { await tx('readwrite', s => { s.delete(id) }) },

  async clear(scene: string) {
    for (const r of await records(scene)) await ImageStore.remove(r.id)
  },

  /** Thumbnails for the panel. */
  async list(scene: string): Promise<{ id: string; name: string; url: string }[]> {
    return (await records(scene)).map(r => ({ id: r.id, name: r.name, url: URL.createObjectURL(r.blob) }))
  },

  /** Decoded images for the scene. */
  async load(scene: string): Promise<SceneImage[]> {
    const out: SceneImage[] = []
    for (const r of await records(scene)) {
      try {
        const bitmap = await createImageBitmap(r.blob)
        out.push({ id: r.id, name: r.name, bitmap, width: bitmap.width, height: bitmap.height })
      } catch (e) { console.warn('[images] could not decode', r.name, e) }
    }
    return out
  },
}
