type Attrs = Record<string, unknown> & { class?: string; style?: string }
type Child = Node | string | null | undefined | false

/** Tiny DOM builder: h('div', { class: 'x', onclick: fn }, child, ...) */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener)
    else if (k === 'class') el.className = String(v)
    else if (k === 'style') el.setAttribute('style', String(v))
    else if (k in el && typeof v !== 'string') (el as unknown as Record<string, unknown>)[k] = v
    else el.setAttribute(k, v === true ? '' : String(v))
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c)
  return el
}

export function toast(msg: string, opts: { error?: boolean; ms?: number; action?: { label: string; run: () => void } } = {}) {
  const el = h('div', { class: 'toast' + (opts.error ? ' err' : '') }, msg)
  if (opts.action) {
    const b = h('button', { class: 'btn small', style: 'margin-left:10px', onclick: () => { opts.action!.run(); el.remove() } }, opts.action.label)
    el.append(b)
  }
  document.querySelectorAll('.toast').forEach(t => t.remove())
  document.body.append(el)
  setTimeout(() => el.remove(), opts.ms ?? 3200)
}

export function seg<T extends string>(options: { value: T; label: string; title?: string }[], current: T, onPick: (v: T) => void, accent = false) {
  const wrap = h('div', { class: 'seg' })
  const btns = options.map(o => {
    const b = h('button', { title: o.title ?? '', onclick: () => { onPick(o.value); set(o.value) } }, o.label)
    wrap.append(b)
    return b
  })
  const set = (v: T) => btns.forEach((b, i) => b.className = options[i].value === v ? (accent ? 'on accent' : 'on') : '')
  set(current)
  return { el: wrap, set }
}

export function fmtNum(v: number, step = 0.01) {
  if (step >= 1) return String(Math.round(v))
  const dec = Math.min(4, Math.max(1, Math.ceil(-Math.log10(step))))
  return v.toFixed(dec)
}
