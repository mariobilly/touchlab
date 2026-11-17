import { h, seg, fmtNum, toast } from './dom'
import { Presets, type ParamStore } from '../core/Params'
import { ImageStore } from '../core/ImageStore'
import type { Engine } from '../core/Engine'
import type { ParamSpec, SceneDef, Values } from '../scenes/types'

/** Slider in TouchDesigner style: drag anywhere to set, wheel to nudge, double-click to reset, right-click to type. */
function slider(spec: ParamSpec, get: () => number, set: (v: number) => void, reset: () => void) {
  const min = spec.min ?? 0, max = spec.max ?? 1
  const step = spec.step ?? (spec.type === 'int' ? 1 : (max - min) / 200)
  const fill = h('div', { class: 'fill' })
  const val = h('div', { class: 'val' })
  const el = h('div', { class: 'slider', title: 'Drag to set · wheel to nudge · double-click to reset · right-click to type' }, fill, val)
  const render = () => {
    const v = get()
    fill.style.width = `${((v - min) / (max - min)) * 100}%`
    val.textContent = fmtNum(v, step)
  }
  const fromX = (e: PointerEvent) => {
    const r = el.getBoundingClientRect()
    const k = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
    let v = min + k * (max - min)
    v = Math.round(v / step) * step
    set(v)
    render()
  }
  let dragging = false
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0) return
    dragging = true
    el.setPointerCapture(e.pointerId)
    fromX(e)
  })
  el.addEventListener('pointermove', e => { if (dragging) fromX(e) })
  el.addEventListener('pointerup', () => { dragging = false })
  el.addEventListener('dblclick', () => { reset(); setTimeout(render, 300) })
  el.addEventListener('wheel', e => {
    e.preventDefault()
    const k = e.shiftKey ? 0.2 : 1
    set(Math.min(max, Math.max(min, get() + (e.deltaY < 0 ? step : -step) * k * (spec.type === 'int' ? 1 : 2))))
    render()
  }, { passive: false })
  el.addEventListener('contextmenu', e => {
    e.preventDefault()
    const input = h('input', { type: 'text', value: fmtNum(get(), step) })
    el.append(input)
    input.focus()
    input.select()
    const done = (apply: boolean) => {
      if (apply) { const n = Number(input.value); if (Number.isFinite(n)) set(n) }
      input.remove()
      render()
    }
    input.addEventListener('keydown', ev => { ev.stopPropagation(); if (ev.key === 'Enter') done(true); if (ev.key === 'Escape') done(false) })
    input.addEventListener('blur', () => done(true))
  })
  render()
  return { el, render }
}

export class Panel {
  readonly el = h('aside', { class: 'panel' })
  private renders = new Map<string, () => void>()
  private sliders = new Map<string, HTMLElement>()
  private params: ParamStore | null = null
  private activePreset = ''

  constructor(private engine: Engine) {
    // keep visible values in sync with tweens / hand-driven changes
    const sync = () => {
      requestAnimationFrame(sync)
      if (!this.params) return
      const now = performance.now()
      for (const [id, t] of this.params.touched) {
        const s = this.sliders.get(id)
        if (s) s.classList.toggle('live', now - t < 400)
      }
    }
    requestAnimationFrame(sync)
  }

  build(def: SceneDef) {
    const params = this.engine.live!.params
    this.params = params
    this.renders.clear()
    this.sliders.clear()
    this.el.replaceChildren()
    this.el.style.setProperty('--fam', def.color)
    this.addImages = null
    params.onChange = (id) => this.renders.get(id)?.()

    this.el.append(h('div', { class: 'head' },
      h('h2', {}, h('span', { class: 'fam' }), def.name),
      h('div', { class: 'credit' }, def.tag),
      h('p', {}, def.blurb),
    ))

    // presets
    const pre = h('div', { class: 'presets' })
    const drawPresets = () => {
      pre.replaceChildren()
      for (const p of Presets.names(def)) {
        const chip = h('button', {
          class: 'chip' + (p.builtIn ? '' : ' user') + (p.name === this.activePreset ? ' on' : ''),
          title: p.builtIn ? 'Built-in preset' : 'Your preset (right-click to delete)',
          onclick: () => { this.loadPreset(def, p.name); drawPresets() },
          oncontextmenu: (e: Event) => {
            e.preventDefault()
            if (p.builtIn) return
            Presets.deleteUser(def.id, p.name)
            toast(`Deleted preset “${p.name}”`)
            drawPresets()
          },
        }, p.name)
        pre.append(chip)
      }
      pre.append(h('button', { class: 'chip dice', title: 'Random look (D)', onclick: () => { this.randomize(def); drawPresets() } }, '🎲 Random'))
      pre.append(h('button', { class: 'chip', title: 'Save the current values as a preset (Ctrl+S)', onclick: () => { this.savePreset(def); drawPresets() } }, '+ Save'))
      pre.append(h('button', { class: 'chip', title: 'Reset every value to default', onclick: () => { params.resetAll(); this.activePreset = ''; drawPresets() } }, 'Reset'))
    }
    drawPresets()
    this.el.append(pre)
    if (def.images) this.el.append(this.imageStrip(def))

    // params by group
    const groups = new Map<string, ParamSpec[]>()
    for (const p of def.params) {
      const g = p.group ?? 'Parameters'
      if (!groups.has(g)) groups.set(g, [])
      groups.get(g)!.push(p)
    }
    let first = true
    for (const [g, specs] of groups) {
      const rows = h('div', { class: 'rows' })
      const sec = h('details', { class: 'sec', open: first || groups.size <= 3 }, h('summary', {}, g), rows)
      first = false
      for (const spec of specs) rows.append(this.row(spec, params))
      this.el.append(sec)
    }

    // gestures help
    if (def.gestures.length) {
      const gs = h('div', { class: 'gestures' })
      for (const line of def.gestures) {
        const [a, b] = line.split('→').map(s => s.trim())
        gs.append(h('div', {}, h('b', {}, a), b ? ` → ${b}` : ''))
      }
      this.el.append(h('details', { class: 'sec', open: true }, h('summary', {}, 'Hands & mouse'), gs))
    }

    this.el.append(this.viewSection())
    this.el.append(h('div', { class: 'foot' },
      h('button', { class: 'btn small', onclick: () => this.exportPresets() }, 'Export presets'),
      h('button', { class: 'btn small', onclick: () => this.importPresets() }, 'Import presets'),
    ))
  }

  private row(spec: ParamSpec, params: ParamStore): HTMLElement {
    const lb = h('div', { class: 'lb', title: spec.label }, spec.label)
    let ctl: HTMLElement
    switch (spec.type) {
      case 'float':
      case 'int': {
        const s = slider(spec, () => params.n(spec.id), v => params.set(spec.id, v), () => params.reset(spec.id))
        this.renders.set(spec.id, s.render)
        this.sliders.set(spec.id, s.el)
        ctl = s.el
        break
      }
      case 'bool': {
        const b = h('button', { class: 'toggle', title: spec.label, onclick: () => params.set(spec.id, !params.b(spec.id)) })
        const r = () => b.classList.toggle('on', params.b(spec.id))
        r()
        this.renders.set(spec.id, r)
        ctl = h('div', {}, b)
        break
      }
      case 'enum': {
        const opts = spec.options ?? []
        if (opts.length <= 4 && opts.join('').length <= 26) {
          const sg = seg(opts.map(o => ({ value: o, label: o })), params.s(spec.id), v => params.set(spec.id, v))
          this.renders.set(spec.id, () => sg.set(params.s(spec.id)))
          ctl = sg.el
        } else {
          const sel = h('select', { class: 'sel', style: 'width:100%;max-width:none', onchange: () => params.set(spec.id, sel.value) })
          for (const o of opts) sel.append(h('option', { value: o }, o))
          sel.value = params.s(spec.id)
          this.renders.set(spec.id, () => { sel.value = params.s(spec.id) })
          ctl = sel
        }
        break
      }
      case 'color': {
        const inp = h('input', { type: 'color', value: params.s(spec.id), oninput: () => params.set(spec.id, inp.value) })
        this.renders.set(spec.id, () => { inp.value = params.s(spec.id) })
        ctl = inp
        break
      }
      case 'text': {
        const inp = h('input', { type: 'text', value: params.s(spec.id), oninput: () => params.set(spec.id, inp.value) })
        inp.addEventListener('keydown', e => e.stopPropagation())
        this.renders.set(spec.id, () => { if (document.activeElement !== inp) inp.value = params.s(spec.id) })
        ctl = inp
        break
      }
      case 'pulse':
        ctl = h('button', { class: 'btn small', style: 'justify-self:start', onclick: () => this.engine.pulse(spec.id) }, spec.label)
        return h('div', { class: 'row' }, h('div', { class: 'lb' }, ''), ctl)
    }
    return h('div', { class: 'row' }, lb, ctl)
  }

  private viewSection() {
    const e = this.engine
    const rows = h('div', { class: 'rows' })
    const num = (label: string, k: 'zoom' | 'panX' | 'panY' | 'smoothing' | 'renderScale', min: number, max: number, step: number, title = '') => {
      const s = slider({ id: k, label, type: 'float', min, max, step, default: 0 }, () => e.view[k], v => e.setView(k, v), () => e.setView(k, ({ zoom: 1, panX: 0, panY: 0, smoothing: 0.6, renderScale: 0.75 } as const)[k]))
      rows.append(h('div', { class: 'row', title }, h('div', { class: 'lb' }, label), s.el))
    }
    num('Zoom', 'zoom', 1, 3, 0.01, 'Zoom into the source')
    num('Pan X', 'panX', -1, 1, 0.01)
    num('Pan Y', 'panY', -1, 1, 0.01)
    num('Hand smoothing', 'smoothing', 0, 1, 0.01, 'Higher = steadier hands, a little more lag')
    const scale = seg([{ value: '0.5', label: '50%' }, { value: '0.75', label: '75%' }, { value: '1', label: '100%' }], String(e.view.renderScale), v => e.setView('renderScale', Number(v)))
    rows.append(h('div', { class: 'row', title: 'Preview resolution. Recording always renders at 100%.' }, h('div', { class: 'lb' }, 'Preview res'), scale.el))
    const cap = seg([{ value: '30', label: '30' }, { value: '60', label: '60' }, { value: '0', label: 'Max' }], String(e.view.fpsCap), v => e.setView('fpsCap', Number(v)))
    rows.append(h('div', { class: 'row' }, h('div', { class: 'lb' }, 'Frame cap'), cap.el))
    const tog = (label: string, k: 'crossfade' | 'overlay' | 'safeArea' | 'handsPanel' | 'panelSkeleton', title = '') => {
      const b = h('button', { class: 'toggle' + (e.view[k] ? ' on' : ''), onclick: () => { e.setView(k, !e.view[k]); b.classList.toggle('on', e.view[k]) } })
      rows.append(h('div', { class: 'row', title }, h('div', { class: 'lb' }, label), h('div', {}, b)))
    }
    tog('Crossfade', 'crossfade', 'Fade between scenes (T)')
    tog('Hands panel', 'handsPanel', 'Show the camera + tracked hands in their own panel next to the output (P)')
    tog('Tracking lines', 'panelSkeleton', 'Draw the tracked hand skeleton over your camera in the hands panel')
    tog('Hands on output', 'overlay', 'Also draw the tracked hands over the output preview (G). Never recorded.')
    tog('Safe area', 'safeArea', 'Show safe-area guides: where social apps put their buttons and captions. Never recorded.')
    const del = seg([{ value: 'CPU', label: 'CPU' }, { value: 'GPU', label: 'GPU' }], e.view.delegate, v => e.setView('delegate', v))
    rows.append(h('div', { class: 'row', title: 'Where hand tracking runs. GPU is about twice as fast; switch to CPU if hands are never detected.' }, h('div', { class: 'lb' }, 'Tracker'), del.el))
    return h('details', { class: 'sec' }, h('summary', {}, 'View & input'), rows)
  }

  /** Random look: the scene's own randomize(), or a generic pick within each param's range. */
  randomize(def: SceneDef) {
    if (!this.params) return
    const cur = this.params.snapshot()
    const rnd = Math.random
    const next: Partial<Values> = def.randomize ? def.randomize(rnd, cur) : {}
    if (!def.randomize) {
      for (const p of def.params) {
        if (p.random === false || p.type === 'pulse' || p.type === 'text' || p.type === 'color') continue
        if (p.type === 'float' || p.type === 'int') {
          const min = p.min ?? 0, max = p.max ?? 1
          const [lo, hi] = Array.isArray(p.random) ? p.random : [min + (max - min) * 0.1, min + (max - min) * 0.9]
          const v = lo + (hi - lo) * rnd()
          next[p.id] = p.type === 'int' ? Math.round(v) : v
        } else if (p.type === 'enum' && p.options?.length) {
          next[p.id] = p.options[Math.floor(rnd() * p.options.length)]
        } else if (p.type === 'bool' && Array.isArray(p.random)) {
          next[p.id] = rnd() < 0.5
        }
      }
    }
    this.params.apply({ ...cur, ...next }, 0.6)
    this.activePreset = ''
  }

  /** Upload strip for scenes that own their images (thumbnails, add, remove, clear). */
  private imageStrip(def: SceneDef) {
    const cfg = def.images!
    const grid = h('div', { class: 'thumbs' })
    const count = h('span', { class: 'count' })
    const input = h('input', { type: 'file', accept: 'image/*,.png,.jpg,.jpeg,.webp,.gif,.bmp,.avif', multiple: true, style: 'display:none' })
    const refresh = async () => {
      const list = await ImageStore.list(def.id)
      grid.replaceChildren(...list.map(it => {
        const img = h('img', { src: it.url, alt: it.name, title: it.name })
        img.onload = () => URL.revokeObjectURL(it.url)
        return h('div', { class: 'thumb' }, img,
          h('button', { class: 'x', title: 'Remove', onclick: async () => { await ImageStore.remove(it.id); await this.engine.reloadImages(); refresh() } }, '×'))
      }))
      if (list.length < cfg.max) grid.append(h('button', { class: 'thumb add', title: 'Add images', onclick: () => input.click() }, '+'))
      count.textContent = `${list.length} / ${cfg.max}`
    }
    this.addImages = async (files: File[]) => {
      const r = await ImageStore.add(def.id, files, cfg.max, cfg.maxSize)
      if (r.failed.length) toast(`Couldn't read ${r.failed.join(', ')}. Use JPG, PNG or WebP (iPhone HEIC photos need converting first).`, { error: true, ms: 6000 })
      else if (r.skipped) toast(r.added ? `Added ${r.added}; ${cfg.label} holds up to ${cfg.max}` : `${cfg.label} is full (${cfg.max} max). Remove one first.`, { error: !r.added })
      else if (r.added) toast(`Added ${r.added} image${r.added === 1 ? '' : 's'}`, { ms: 1400 })
      else toast('No images found in what you dropped. Use JPG, PNG or WebP files.', { error: true })
      await this.engine.reloadImages()
      refresh()
    }
    input.onchange = async () => { await this.addImages?.([...(input.files ?? [])]); input.value = '' }
    refresh()
    return h('details', { class: 'sec', open: true },
      h('summary', {}, cfg.label, count),
      h('div', { class: 'rows' },
        cfg.hint ? h('div', { class: 'hint' }, cfg.hint) : null,
        grid,
        h('div', { style: 'display:flex;gap:6px' },
          h('button', { class: 'btn small', onclick: () => input.click() }, 'Add images…'),
          h('button', { class: 'btn small ghost', onclick: async () => { await ImageStore.clear(def.id); await this.engine.reloadImages(); refresh() } }, 'Clear all')),
        input))
  }

  /** Set while the active scene has an image strip: adds files to it (used by drag & drop). */
  addImages: ((files: File[]) => Promise<void>) | null = null

  loadPreset(def: SceneDef, name: string) {
    const v = Presets.get(def, name)
    if (!v || !this.params) return
    this.params.apply(v)
    this.activePreset = name
    toast(`Preset: ${name}`, { ms: 1200 })
  }

  cyclePreset(def: SceneDef, dir: number) {
    const names = Presets.names(def).map(p => p.name)
    if (!names.length) return
    const i = names.indexOf(this.activePreset)
    const next = names[(i + dir + names.length) % names.length]
    this.loadPreset(def, next)
    this.build(def)
  }

  savePreset(def: SceneDef) {
    if (!this.params) return
    const n = Presets.names(def).filter(p => !p.builtIn).length + 1
    const name = `My look ${n}`
    Presets.saveUser(def.id, name, this.params.snapshot())
    this.activePreset = name
    toast(`Saved preset “${name}” (right-click a preset to delete it)`)
  }

  private exportPresets() {
    const blob = new Blob([Presets.exportAll()], { type: 'application/json' })
    const a = h('a', { href: URL.createObjectURL(blob), download: 'touchlab-presets.json' })
    a.click()
  }

  private importPresets() {
    const inp = h('input', { type: 'file', accept: '.json,application/json' })
    inp.onchange = async () => {
      const f = inp.files?.[0]
      if (!f) return
      try {
        Presets.importAll(await f.text())
        toast('Presets imported')
        if (this.engine.live) this.build(this.engine.live.def)
      } catch (e) { toast((e as Error).message, { error: true }) }
    }
    inp.click()
  }
}
