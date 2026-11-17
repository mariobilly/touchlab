import type { ParamSpec, ParamValue, Params, SceneDef, Values } from '../scenes/types'

const STATE_KEY = 'touchlab.state.v1'
const PRESET_KEY = 'touchlab.presets.v1'

function load<T>(key: string, fallback: T): T {
  try { const s = localStorage.getItem(key); return s ? (JSON.parse(s) as T) : fallback } catch { return fallback }
}
function save(key: string, v: unknown) {
  try { localStorage.setItem(key, JSON.stringify(v)) } catch {}
}

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return [1, 1, 1]
  const n = parseInt(m[1], 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

export function clampParam(spec: ParamSpec, v: ParamValue): ParamValue {
  switch (spec.type) {
    case 'float': {
      const n = Number(v)
      if (!Number.isFinite(n)) return spec.default
      return Math.min(spec.max ?? Infinity, Math.max(spec.min ?? -Infinity, n))
    }
    case 'int': {
      const n = Math.round(Number(v))
      if (!Number.isFinite(n)) return spec.default
      return Math.min(spec.max ?? Infinity, Math.max(spec.min ?? -Infinity, n))
    }
    case 'bool': return typeof v === 'boolean' ? v : v === 'true' || v === 1
    case 'enum': return spec.options?.includes(String(v)) ? String(v) : spec.default
    case 'color': return /^#[0-9a-f]{6}$/i.test(String(v)) ? String(v) : spec.default
    default: return String(v)
  }
}

/** Per-scene parameter values with tweened preset loads and local persistence. */
export class ParamStore implements Params {
  readonly raw: Values = {}
  private tweens = new Map<string, { from: number; to: number; t: number; dur: number }>()
  private specs = new Map<string, ParamSpec>()
  private saveTimer = 0
  /** Last time each param was moved by a hand / LFO, for the panel's live indicator. */
  readonly touched = new Map<string, number>()
  onChange: ((id: string) => void) | null = null

  constructor(readonly def: SceneDef) {
    for (const p of def.params) { this.specs.set(p.id, p); this.raw[p.id] = p.default }
    const state = load<Record<string, Values>>(STATE_KEY, {})[def.id]
    if (state) for (const [k, v] of Object.entries(state)) { const s = this.specs.get(k); if (s && s.type !== 'pulse') this.raw[k] = clampParam(s, v) }
  }

  spec(id: string) { return this.specs.get(id) }

  n(id: string) { return Number(this.raw[id] ?? 0) }
  b(id: string) { return this.raw[id] === true }
  s(id: string) { return String(this.raw[id] ?? '') }
  c(id: string) { return hexToRgb(this.s(id)) }

  set(id: string, v: ParamValue, opts: { tween?: number; silent?: boolean } = {}) {
    const spec = this.specs.get(id)
    if (!spec) return
    const val = clampParam(spec, v)
    if (opts.tween && (spec.type === 'float') && typeof this.raw[id] === 'number') {
      this.tweens.set(id, { from: this.raw[id] as number, to: val as number, t: 0, dur: opts.tween })
    } else {
      this.tweens.delete(id)
      this.raw[id] = val
    }
    if (!opts.silent) this.onChange?.(id)
    this.persistSoon()
  }

  reset(id: string) { const s = this.specs.get(id); if (s) this.set(id, s.default, { tween: 0.25 }) }

  resetAll() { for (const s of this.def.params) if (s.type !== 'pulse') this.set(s.id, s.default, { tween: 0.4 }) }

  apply(values: Partial<Values>, tween = 0.5) {
    for (const s of this.def.params) {
      if (s.type === 'pulse') continue
      const v = values[s.id] ?? s.default
      this.set(s.id, v, { tween })
    }
  }

  step(dt: number) {
    for (const [id, tw] of this.tweens) {
      tw.t += dt
      const k = Math.min(1, tw.t / tw.dur)
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2
      this.raw[id] = tw.from + (tw.to - tw.from) * e
      if (k >= 1) { this.raw[id] = tw.to; this.tweens.delete(id) }
      this.onChange?.(id)
    }
  }

  private persistSoon() {
    clearTimeout(this.saveTimer)
    this.saveTimer = window.setTimeout(() => {
      const all = load<Record<string, Values>>(STATE_KEY, {})
      const out: Values = {}
      for (const s of this.def.params) if (s.type !== 'pulse') out[s.id] = this.tweens.get(s.id)?.to ?? this.raw[s.id]
      all[this.def.id] = out
      save(STATE_KEY, all)
    }, 300)
  }

  snapshot(): Values {
    const out: Values = {}
    for (const s of this.def.params) if (s.type !== 'pulse') out[s.id] = this.tweens.get(s.id)?.to ?? this.raw[s.id]
    return out
  }
}

/** Built-in presets (from the scene) plus user presets in localStorage. */
export const Presets = {
  user(sceneId: string): Record<string, Values> {
    return load<{ v: number; scenes: Record<string, Record<string, Values>> }>(PRESET_KEY, { v: 1, scenes: {} }).scenes[sceneId] ?? {}
  },
  names(def: SceneDef): { name: string; builtIn: boolean }[] {
    return [
      ...Object.keys(def.presets).map(name => ({ name, builtIn: true })),
      ...Object.keys(Presets.user(def.id)).map(name => ({ name, builtIn: false })),
    ]
  },
  get(def: SceneDef, name: string): Partial<Values> | null {
    return def.presets[name] ?? Presets.user(def.id)[name] ?? null
  },
  saveUser(sceneId: string, name: string, values: Values) {
    const all = load<{ v: number; scenes: Record<string, Record<string, Values>> }>(PRESET_KEY, { v: 1, scenes: {} })
    all.scenes[sceneId] = { ...(all.scenes[sceneId] ?? {}), [name]: values }
    save(PRESET_KEY, all)
  },
  deleteUser(sceneId: string, name: string) {
    const all = load<{ v: number; scenes: Record<string, Record<string, Values>> }>(PRESET_KEY, { v: 1, scenes: {} })
    if (all.scenes[sceneId]) delete all.scenes[sceneId][name]
    save(PRESET_KEY, all)
  },
  exportAll(): string {
    return JSON.stringify(load(PRESET_KEY, { v: 1, scenes: {} }), null, 2)
  },
  importAll(json: string) {
    const data = JSON.parse(json) as { v: number; scenes: Record<string, Record<string, Values>> }
    if (!data || typeof data !== 'object' || !data.scenes) throw new Error('Not a TouchLab preset file')
    const all = load<{ v: number; scenes: Record<string, Record<string, Values>> }>(PRESET_KEY, { v: 1, scenes: {} })
    for (const [id, p] of Object.entries(data.scenes)) all.scenes[id] = { ...(all.scenes[id] ?? {}), ...p }
    save(PRESET_KEY, all)
  },
}
