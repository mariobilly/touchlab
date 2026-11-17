import type { SceneDef } from './types'

/** Scene order = number keys 1–6. Each scene lives in ./<id>/index.ts and default-exports its SceneDef. */
export const SCENE_ORDER = ['uva', 'ghost', 'gallery', 'signal', 'quadtree', 'summon']

// Loaded one by one so a broken scene only removes itself instead of taking the app down.
const modules = import.meta.glob<{ default: SceneDef }>('./*/index.ts')

export async function loadScenes(): Promise<SceneDef[]> {
  const out: SceneDef[] = []
  const results = await Promise.allSettled(SCENE_ORDER.map(id => modules[`./${id}/index.ts`]?.()))
  results.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value?.default) out.push(r.value.default)
    else if (r.status === 'rejected') console.error(`Scene "${SCENE_ORDER[i]}" failed to load:`, r.reason)
  })
  return out
}
