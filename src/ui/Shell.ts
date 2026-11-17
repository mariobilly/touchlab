import { h, seg, toast } from './dom'
import { Panel } from './Panel'
import { ASPECTS, type AspectId, type Engine } from '../core/Engine'
import { api, type Health } from '../core/Api'
import { ImageStore, isImage } from '../core/ImageStore'
import { HAND_EDGES } from '../input/hands/types'
import type { SceneDef } from '../scenes/types'

export class Shell {
  readonly root = h('div', { class: 'shell' })
  private panel: Panel
  private tiles = new Map<string, HTMLElement>()
  private stage = h('main', { class: 'stage' })
  private hud = h('canvas', { class: 'hud' })
  private hudCtx = this.hud.getContext('2d')!
  private trackerPill = h('span', { class: 'pill' })
  private fpsPill = h('span', { class: 'pill' })
  private recBtn = h('button', { class: 'recbtn', title: 'Record (R) · Shift+R = 3-2-1 countdown' }, h('span', { class: 'dot' }), h('span', {}, 'REC'))
  private timer = h('span', { class: 'timer' }, '00:00')
  private status = h('span', { class: 'status' }, '')
  private lastFile = ''
  private health: Health | null = null
  private notice: HTMLElement | null = null
  private sourceSeg!: ReturnType<typeof seg<'webcam' | 'file' | 'demo'>>
  private camSel = h('select', { class: 'sel', title: 'Camera' })
  private countdownEl: HTMLElement | null = null
  // two-panel stage: camera + hands monitor, and the clean output
  private panes = h('div', { class: 'panes' })
  private monCanvas = h('canvas', { class: 'monitor' })
  private monCtx = this.monCanvas.getContext('2d')!
  private monBody = h('div', { class: 'pane-body' }, this.monCanvas)
  private monInfo = h('span', { class: 'pane-info' })
  private outBody = h('div', { class: 'pane-body' })
  private outInfo = h('span', { class: 'pane-info' })
  private sourceGroup: HTMLElement | null = null
  private imagesGroup: HTMLElement | null = null
  private imagesCount = h('span', { class: 'pill' })

  constructor(private engine: Engine) {
    this.panel = new Panel(engine)
    engine.canvas.classList.add('out')
    this.outBody.append(engine.canvas, this.hud)
    this.panes.append(
      h('section', { class: 'pane mon' }, h('div', { class: 'pane-head' }, h('b', {}, 'HANDS'), this.monInfo), this.monBody),
      h('section', { class: 'pane out' }, h('div', { class: 'pane-head' }, h('b', {}, 'OUTPUT'), this.outInfo), this.outBody),
    )
    this.stage.append(this.panes)
    this.root.append(this.topBar(), this.sceneList(), this.stage, this.panel.el, this.recBar())
    engine.onScene = (def) => this.onScene(def)
    engine.onFrame = () => this.frame()
    this.keys()
    this.dragDrop()
    window.addEventListener('touchlab:images', () => this.refreshImageCount())
    this.refreshHealth()
  }

  private async refreshHealth() {
    this.health = await api.health()
    if (!this.health) this.setStatus('Local server not reachable: recordings will download as raw video instead of MP4.', 'err')
    else if (!this.health.ffmpeg) this.setStatus('ffmpeg not found: install it with “winget install Gyan.FFmpeg” to export MP4.', 'err')
    else this.setStatus(`Recordings save to ${this.health.outDir}`)
  }

  // ---------- top bar ----------
  private topBar() {
    const e = this.engine
    const fileInput = h('input', { type: 'file', accept: 'video/*,image/*', style: 'display:none' })
    fileInput.onchange = async () => {
      const f = fileInput.files?.[0]
      if (f) await this.useFile(f)
      fileInput.value = ''
    }
    this.sourceSeg = seg<'webcam' | 'file' | 'demo'>([
      { value: 'webcam', label: 'Webcam', title: 'Use your camera as the source (C cycles sources)' },
      { value: 'file', label: 'Video / Image…', title: 'Open a video or photo (or drag one onto the stage)' },
      { value: 'demo', label: 'Demo', title: 'Built-in animated performer' },
    ], 'demo', async (v) => {
      if (v === 'webcam') await this.useWebcam()
      else if (v === 'file') fileInput.click()
      else e.sources.useDemo()
      this.syncSource()
    })
    this.camSel.onchange = async () => { await this.useWebcam(this.camSel.value) }
    const hands = seg<'camera' | 'clip' | 'mouse' | 'off'>([
      { value: 'camera', label: 'Camera', title: 'Track hands from the webcam (mouse works when no hand is visible)' },
      { value: 'clip', label: 'Clip', title: 'Track hands in the loaded video clip' },
      { value: 'mouse', label: 'Mouse', title: 'Mouse only: left = pinch, right/Shift = fist, Alt = point, wheel = rotate' },
      { value: 'off', label: 'Off' },
    ], e.view.handsFrom, async (v) => {
      e.setView('handsFrom', v)
      if (v === 'camera' && !e.sources.camVideo) await this.openCameraForHands()
    })
    const aspect = seg<AspectId>((Object.keys(ASPECTS) as AspectId[]).map(k => ({ value: k, label: k, title: ASPECTS[k].label })), e.view.aspect, v => e.setView('aspect', v))
    this.aspectSet = aspect.set
    const mirror = h('button', { class: 'toggle' + (e.view.mirror ? ' on' : ''), title: 'Mirror the webcam (M)', onclick: () => { e.setView('mirror', !e.view.mirror); mirror.classList.toggle('on', e.view.mirror) } })
    this.mirrorBtn = mirror
    return h('header', { class: 'top' },
      h('div', { class: 'brand' }, h('img', { src: './favicon.png', alt: '' }), h('span', {}, 'Touch', h('b', {}, 'Lab'))),
      (this.sourceGroup = h('div', { class: 'group' }, h('label', {}, 'Source'), this.sourceSeg.el, this.camSel, fileInput)),
      (this.imagesGroup = this.imagesBar()),
      h('div', { class: 'group' }, h('label', {}, 'Hands'), hands.el),
      h('div', { class: 'group' }, h('label', {}, 'Format'), aspect.el),
      h('div', { class: 'group' }, h('label', {}, 'Mirror'), mirror),
      h('div', { class: 'spacer' }),
      this.trackerPill, this.fpsPill,
    )
  }
  /** Top-bar picker that adds files to the active scene's own images (Cell Poster, Gallery, Summon). */
  private imagesBar() {
    const input = h('input', { type: 'file', accept: 'image/*,.png,.jpg,.jpeg,.webp,.gif,.bmp,.avif', multiple: true, style: 'display:none' })
    input.onchange = async () => {
      const files = [...(input.files ?? [])]
      input.value = ''
      if (files.length && this.panel.addImages) await this.panel.addImages(files)
      this.refreshImageCount()
    }
    const btn = h('button', { class: 'btn primary small', title: 'Add images to this scene (or drag them onto the stage)', onclick: () => input.click() }, 'Add images…')
    return h('div', { class: 'group' }, h('label', {}, 'Images'), btn, this.imagesCount, input)
  }

  private async refreshImageCount() {
    const def = this.engine.live?.def
    if (!def?.images) return
    const n = await ImageStore.count(def.id)
    this.imagesCount.textContent = `${n} / ${def.images.max}`
  }

  private aspectSet: (v: AspectId) => void = () => {}
  private shownAspect: AspectId | '' = ''
  private mirrorBtn: HTMLElement | null = null

  private syncSource() {
    const k = this.engine.sources.kind
    this.sourceSeg.set(k === 'webcam' ? 'webcam' : k === 'demo' ? 'demo' : 'file')
  }

  async refreshCameras() {
    const cams = await this.engine.sources.listCameras()
    this.camSel.replaceChildren(...cams.map((c, i) => h('option', { value: c.deviceId }, c.label || `Camera ${i + 1}`)))
    this.camSel.style.display = cams.length > 1 ? '' : 'none'
    if (this.engine.sources.camDeviceId) this.camSel.value = this.engine.sources.camDeviceId
  }

  async useWebcam(deviceId?: string) {
    const ok = await this.engine.sources.useWebcam(deviceId)
    if (!ok) {
      toast(this.engine.sources.error || 'Camera unavailable', { error: true, ms: 5000 })
      this.engine.sources.useDemo()
    } else {
      this.hideNotice()
      try { localStorage.setItem('touchlab.source', 'webcam') } catch {}
    }
    await this.refreshCameras()
    this.syncSource()
  }

  async openCameraForHands() {
    const ok = await this.engine.sources.openCamera()
    if (!ok) toast(`${this.engine.sources.error} Hands will follow the mouse instead.`, { error: true, ms: 5000 })
    else this.hideNotice()
    await this.refreshCameras()
  }

  async useFile(f: File) {
    const ok = await this.engine.sources.useFile(f)
    if (!ok) toast(this.engine.sources.error, { error: true })
    else toast(`Source: ${f.name}`, { ms: 1500 })
    this.syncSource()
  }

  showCameraNotice() {
    this.hideNotice()
    this.notice = h('div', { class: 'notice' },
      h('span', {}, 'Turn on your webcam to play with your hands. Until then the mouse acts as a hand.'),
      h('button', { class: 'btn primary small', onclick: () => this.useWebcam() }, 'Enable webcam'),
      h('button', { class: 'btn ghost small', onclick: () => this.hideNotice() }, 'Later'),
    )
    ;(this.engine.view.handsPanel ? this.monBody : this.stage).append(this.notice)
  }
  private hideNotice() { this.notice?.remove(); this.notice = null }

  // ---------- scenes ----------
  private sceneList() {
    const list = h('nav', { class: 'scenes' }, h('h3', {}, 'Scenes'))
    this.engine.scenes.forEach((s, i) => {
      const t = h('button', { class: 'tile', style: `--fam:${s.color}`, title: s.blurb, onclick: () => this.engine.setScene(s.id) },
        h('span', { class: 'key' }, String(i + 1)), h('span', { class: 'nm' }, s.name), h('span', { class: 'cr' }, s.tag))
      this.tiles.set(s.id, t)
      list.append(t)
    })
    list.append(h('div', { class: 'spacer' }))
    list.append(h('div', { class: 'keys', style: 'padding:8px 6px;line-height:1.7' },
      '1–6 scene · R rec · S snap', h('br'), 'D random · Space freeze', h('br'), 'P hands panel · H hide UI', h('br'), 'F fullscreen · A format', h('br'), 'Enter pulse · [ ] presets'))
    return list
  }

  private onScene(def: SceneDef) {
    for (const [id, t] of this.tiles) t.classList.toggle('on', id === def.id)
    this.panel.build(def)
    // scenes that only use their own images get an "Images" picker instead of the Source bar
    const own = def.needs.source === false && !!def.images
    if (this.sourceGroup) this.sourceGroup.style.display = own ? 'none' : ''
    if (this.imagesGroup) this.imagesGroup.style.display = def.images ? '' : 'none'
    this.refreshImageCount()
  }

  // ---------- record bar ----------
  private recBar() {
    const e = this.engine
    this.recBtn.onclick = () => this.toggleRecord(false)
    const fps = seg([{ value: '30', label: '30 fps' }, { value: '60', label: '60 fps' }], String(e.view.recFps), v => e.setView('recFps', Number(v)))
    const auto = h('select', { class: 'sel', title: 'Stop recording automatically', onchange: () => e.setView('autoStop', Number(auto.value)) },
      ...[0, 5, 10, 15, 30, 60, 90].map(s => h('option', { value: String(s) }, s ? `${s}s` : 'No limit')))
    auto.value = String(e.view.autoStop)
    const cd = h('button', { class: 'toggle' + (e.view.countdown ? ' on' : ''), title: '3-2-1 countdown before recording', onclick: () => { e.setView('countdown', !e.view.countdown); cd.classList.toggle('on', e.view.countdown) } })
    const snd = h('button', { class: 'toggle' + (e.view.silentAudio ? ' on' : ''), title: 'Add a silent audio track (some apps want one)', onclick: () => { e.setView('silentAudio', !e.view.silentAudio); snd.classList.toggle('on', e.view.silentAudio) } })
    return h('footer', { class: 'recbar' },
      this.recBtn, this.timer,
      h('div', { class: 'group' }, fps.el),
      h('div', { class: 'group' }, h('label', {}, 'Length'), auto),
      h('div', { class: 'group' }, h('label', {}, '3-2-1'), cd),
      h('div', { class: 'group' }, h('label', {}, 'Silent audio'), snd),
      h('button', { class: 'btn', title: 'Save a PNG of the current frame (S)', onclick: () => this.snapshot() }, 'Snapshot'),
      h('button', { class: 'btn', title: 'Open the output folder', onclick: () => api.reveal(this.lastFile || undefined) }, 'Show in folder'),
      this.status,
    )
  }

  private setStatus(msg: string, kind: '' | 'ok' | 'err' = '') {
    this.status.textContent = msg
    this.status.className = 'status' + (kind ? ' ' + kind : '')
  }

  async toggleRecord(countdown: boolean) {
    const e = this.engine
    const r = e.recorder
    if (r.state === 'exporting' || this.countdownEl) return
    if (r.state === 'recording') return this.stopRecord()
    if (countdown || e.view.countdown) {
      for (const n of [3, 2, 1]) {
        this.countdownEl?.remove()
        this.countdownEl = h('div', { class: 'countdown' }, String(n))
        this.stage.append(this.countdownEl)
        await new Promise(res => setTimeout(res, 800))
      }
      this.countdownEl?.remove()
      this.countdownEl = null
    }
    // record at full export resolution
    e.forcedScale = 1
    e.applySize()
    r.start(e.canvas, e.view.recFps)
    this.recBtn.classList.add('on')
    this.recBtn.lastElementChild!.textContent = 'STOP'
    this.setStatus(`Recording ${ASPECTS[e.view.aspect].w}×${ASPECTS[e.view.aspect].h} · ${r.mime || 'default codec'}`)
  }

  private async stopRecord() {
    const e = this.engine
    this.recBtn.disabled = true
    this.recBtn.classList.remove('on')
    this.recBtn.lastElementChild!.textContent = 'SAVING'
    this.setStatus('Converting to MP4…')
    try {
      const res = await e.recorder.stop(e.live?.def.name.replace(/\s+/g, '') ?? 'Scene', e.view.recFps, e.view.silentAudio)
      if ('file' in res) {
        this.lastFile = res.file
        this.setStatus(`Saved ${res.file.split(/[\\/]/).pop()} · ${(res.bytes / 1e6).toFixed(1)} MB · ${res.encoder}`, 'ok')
        toast('Saved MP4', { action: { label: 'Show in folder', run: () => api.reveal(res.file) } })
      } else {
        this.setStatus(`Downloaded ${res.downloaded} (server unavailable, not converted)`, 'err')
      }
    } catch (err) {
      this.setStatus(`Export failed: ${(err as Error).message}`, 'err')
      toast(`Export failed: ${(err as Error).message}`, { error: true, ms: 6000 })
    } finally {
      e.forcedScale = null
      e.applySize()
      this.recBtn.disabled = false
      this.recBtn.lastElementChild!.textContent = 'REC'
    }
  }

  async snapshot() {
    const e = this.engine
    const blob = await new Promise<Blob | null>(res => {
      // grab right after a frame renders (the drawing buffer is cleared after compositing)
      const prev = e.onFrame
      e.onFrame = () => { e.onFrame = prev; prev?.(); e.canvas.toBlob(b => res(b), 'image/png') }
    })
    if (!blob) return
    try {
      const r = await api.snapshot(blob, e.live?.def.name.replace(/\s+/g, '') ?? 'Scene')
      this.lastFile = r.file
      toast('Snapshot saved', { action: { label: 'Show', run: () => api.reveal(r.file) } })
    } catch {
      const a = h('a', { href: URL.createObjectURL(blob), download: `TouchLab_${Date.now()}.png` })
      a.click()
    }
  }

  // ---------- per-frame HUD (never recorded) ----------
  private frame() {
    const e = this.engine
    const r = e.recorder
    if (r.state === 'recording') {
      const s = r.elapsed
      this.timer.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`
      if (e.view.autoStop && s >= e.view.autoStop) this.stopRecord()
    } else if (r.state === 'idle') this.timer.textContent = '00:00'

    const tr = e.tracker.hands
    const dot = tr.status === 'ready' ? 'ok' : tr.status === 'loading' ? 'load' : tr.status === 'error' ? 'err' : ''
    const ht = e.hands.mode === 'mouse' ? 'mouse hand' : tr.status === 'ready' ? `${tr.delegate} · ${tr.rate.toFixed(0)} fps · ${tr.ms.toFixed(0)} ms · ${e.hands.hands.length} hand${e.hands.hands.length === 1 ? '' : 's'}` : tr.status === 'loading' ? 'loading tracker…' : tr.status === 'error' ? 'tracker error' : 'hands off'
    this.trackerPill.innerHTML = `<span class="dot ${dot}"></span>${ht}`
    this.trackerPill.title = tr.message
    const st = e.live?.inst.status?.() ?? ''
    this.fpsPill.textContent = `${e.fps.toFixed(0)} fps · ${e.width}×${e.height}${st ? ' · ' + st : ''}`

    if (this.shownAspect !== e.view.aspect) { this.shownAspect = e.view.aspect; this.aspectSet(e.view.aspect) }
    this.layout()
    this.drawMonitor()
    this.outInfo.innerHTML = `${ASPECTS[e.view.aspect].w}×${ASPECTS[e.view.aspect].h}` + (r.state === 'recording' ? ' <i class="live">● REC</i>' : '')

    // HUD overlay aligned with the displayed output canvas (never recorded)
    const cr = e.canvas.getBoundingClientRect()
    const sr = this.outBody.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const W = Math.round(cr.width * dpr), H = Math.round(cr.height * dpr)
    if (this.hud.width !== W || this.hud.height !== H) { this.hud.width = W; this.hud.height = H }
    this.hud.style.left = `${cr.left - sr.left}px`
    this.hud.style.top = `${cr.top - sr.top}px`
    this.hud.style.width = `${cr.width}px`
    this.hud.style.height = `${cr.height}px`
    const c = this.hudCtx
    c.clearRect(0, 0, W, H)
    if (e.view.safeArea) {
      c.strokeStyle = 'rgba(41,230,255,0.6)'
      c.setLineDash([6 * dpr, 6 * dpr])
      c.lineWidth = dpr
      const a = e.view.aspect
      const top = a === '9:16' ? 0.14 : 0.05, bottom = a === '9:16' ? 0.2 : 0.05, side = 0.06
      c.strokeRect(W * side, H * top, W * (1 - 2 * side), H * (1 - top - bottom))
      c.setLineDash([])
    }
    if (e.view.overlay && r.state !== 'recording') {
      for (const hand of e.hands.hands) {
        c.globalAlpha = 0.85 * hand.presence
        c.strokeStyle = hand.pinching ? '#ff3df2' : '#29e6ff'
        c.lineWidth = 2 * dpr
        c.beginPath()
        for (const [a, b] of HAND_EDGES) {
          c.moveTo(hand.lm[a * 3] * W, hand.lm[a * 3 + 1] * H)
          c.lineTo(hand.lm[b * 3] * W, hand.lm[b * 3 + 1] * H)
        }
        c.stroke()
        c.fillStyle = '#ffffff'
        for (let i = 0; i < 21; i++) { c.beginPath(); c.arc(hand.lm[i * 3] * W, hand.lm[i * 3 + 1] * H, 2.4 * dpr, 0, Math.PI * 2); c.fill() }
        const g = hand.pinching ? 'PINCH' : hand.fist ? 'FIST' : hand.point ? 'POINT' : hand.open ? 'OPEN' : ''
        if (g) {
          c.font = `600 ${11 * dpr}px JetBrains Mono, monospace`
          c.fillStyle = '#29e6ff'
          c.fillText(g, hand.palm.x * W + 14 * dpr, hand.palm.y * H)
        }
        c.globalAlpha = 1
      }
    }
    if (e.frozen) {
      c.font = `700 ${12 * dpr}px JetBrains Mono, monospace`
      c.fillStyle = '#ffb547'
      c.fillText('❚❚ FROZEN', 12 * dpr, 22 * dpr)
    }
    if (e.sceneError) {
      c.font = `${12 * dpr}px JetBrains Mono, monospace`
      c.fillStyle = '#ff3b4a'
      c.fillText(`Scene error: ${e.sceneError}`.slice(0, 90), 12 * dpr, H - 16 * dpr)
    }
  }

  /** Sizes the hands panel and the output so both fit the stage (side by side, or stacked for wide formats). */
  private layout() {
    const e = this.engine
    if (document.fullscreenElement === this.outBody) {
      // F: the output alone fills the screen
      const oa = e.outSize.w / e.outSize.h
      const fw = Math.min(window.innerWidth, window.innerHeight * oa)
      e.canvas.style.width = `${Math.floor(fw)}px`
      e.canvas.style.height = `${Math.floor(fw / oa)}px`
      return
    }
    const split = e.view.handsPanel
    const pad = this.root.classList.contains('hide-ui') ? 0 : 18
    const gap = 14, head = split ? 26 : 0
    const W = Math.max(100, this.stage.clientWidth - pad * 2)
    const H = Math.max(100, this.stage.clientHeight - pad * 2)
    const oa = e.outSize.w / e.outSize.h
    const v = this.monitorVideo()
    const ca = v && v.videoWidth ? v.videoWidth / v.videoHeight : 16 / 9
    let ow: number, oh: number, mw = 0, mh = 0, stacked = false
    if (!split) {
      ow = Math.min(W, H * oa); oh = ow / oa
    } else if (oa <= 1.25) {
      const avH = H - head
      oh = avH; ow = oh * oa
      const minM = Math.min(W * 0.45, Math.max(280, W * 0.32))
      let room = W - ow - gap
      if (room < minM) { ow = W - minM - gap; oh = ow / oa; room = minM }
      mw = Math.min(room, avH * ca); mh = mw / ca
    } else {
      stacked = true
      const avH = H - head * 2 - gap
      mh = avH * 0.34; mw = mh * ca
      if (mw > W) { mw = W; mh = mw / ca }
      ow = Math.min(W, (avH - mh) * oa); oh = ow / oa
    }
    this.panes.classList.toggle('split', split)
    this.panes.classList.toggle('stacked', stacked)
    const px = (n: number) => `${Math.max(1, Math.floor(n))}px`
    e.canvas.style.width = px(ow); e.canvas.style.height = px(oh)
    this.monCanvas.style.width = px(mw); this.monCanvas.style.height = px(mh)
    const dpr = window.devicePixelRatio || 1
    const bw = Math.max(1, Math.round(mw * dpr)), bh = Math.max(1, Math.round(mh * dpr))
    if (split && (this.monCanvas.width !== bw || this.monCanvas.height !== bh)) { this.monCanvas.width = bw; this.monCanvas.height = bh }
  }

  private monitorVideo(): HTMLVideoElement | null {
    const s = this.engine.sources
    return this.engine.view.handsFrom === 'clip' ? s.visualVideo() : s.camVideo
  }

  /** Hands panel: the control camera (mirrored like a selfie), tracked hands, and the area that maps to the output. */
  private drawMonitor() {
    const e = this.engine
    if (!e.view.handsPanel) return
    const c = this.monCtx, W = this.monCanvas.width, H = this.monCanvas.height
    const dpr = window.devicePixelRatio || 1
    c.fillStyle = '#0b0c0f'
    c.fillRect(0, 0, W, H)
    const v = this.monitorVideo()
    const mirror = e.view.handsFrom === 'camera' && e.view.mirror
    const live = !!v && v.readyState >= 2
    if (live) {
      c.save()
      if (mirror) { c.translate(W, 0); c.scale(-1, 1) }
      c.drawImage(v!, 0, 0, W, H)
      c.restore()
      c.fillStyle = 'rgba(8,10,14,0.28)'
      c.fillRect(0, 0, W, H)
    }
    const font = (px: number, w = 600) => `${w} ${px * dpr}px JetBrains Mono, monospace`
    // where the output sits inside the camera frame (only meaningful for 'video' mapping)
    if (live && e.handMapping === 'video') {
      const xf = e.ctrlXf
      let x0 = Math.min(xf.ox, xf.ox + xf.sx), x1 = Math.max(xf.ox, xf.ox + xf.sx)
      const y0 = 1 - (xf.oy + xf.sy), y1 = 1 - xf.oy
      if (mirror) [x0, x1] = [1 - x1, 1 - x0]
      c.setLineDash([6 * dpr, 5 * dpr])
      c.strokeStyle = 'rgba(255,255,255,0.55)'
      c.lineWidth = 1.2 * dpr
      c.strokeRect(x0 * W, y0 * H, (x1 - x0) * W, (y1 - y0) * H)
      c.setLineDash([])
      c.font = font(10)
      c.fillStyle = 'rgba(255,255,255,0.7)'
      c.fillText('OUTPUT AREA', x0 * W + 6 * dpr, y0 * H + 14 * dpr)
    }
    // tracked hands in camera space
    const colors = ['#29e6ff', '#ff3df2']
    for (const hnd of e.view.panelSkeleton ? e.tracker.camHands : []) {
      const col = colors[hnd.id % 2]
      const X = (i: number) => (mirror ? 1 - hnd.lm[i * 3] : hnd.lm[i * 3]) * W
      const Y = (i: number) => hnd.lm[i * 3 + 1] * H
      c.globalAlpha = Math.max(0.2, hnd.presence)
      c.strokeStyle = col
      c.lineWidth = 2.2 * dpr
      c.lineCap = 'round'
      c.beginPath()
      for (const [a, b] of HAND_EDGES) { c.moveTo(X(a), Y(a)); c.lineTo(X(b), Y(b)) }
      c.stroke()
      c.fillStyle = '#ffffff'
      for (let i = 0; i < 21; i++) { c.beginPath(); c.arc(X(i), Y(i), (i % 4 === 0 && i ? 3.6 : 2.4) * dpr, 0, Math.PI * 2); c.fill() }
      if (hnd.gesture) {
        c.font = font(12, 700)
        const tx = X(0) + 12 * dpr, ty = Y(0) + 4 * dpr
        const tw = c.measureText(hnd.gesture).width
        c.fillStyle = 'rgba(0,0,0,0.6)'
        c.fillRect(tx - 4 * dpr, ty - 13 * dpr, tw + 8 * dpr, 18 * dpr)
        c.fillStyle = col
        c.fillText(hnd.gesture, tx, ty)
      }
      c.globalAlpha = 1
    }
    c.font = font(11, 600)
    c.fillStyle = 'rgba(255,255,255,0.75)'
    if (!live) {
      c.textAlign = 'center'
      c.fillText(e.view.handsFrom === 'clip' ? 'Load a video clip to track hands in it' : e.view.handsFrom === 'camera' ? 'Camera off' : `Hands: ${e.view.handsFrom}`, W / 2, H / 2)
      c.textAlign = 'left'
    }
    if (e.hands.mode === 'mouse') {
      c.fillStyle = '#ffb547'
      c.fillText('MOUSE IS ACTING AS YOUR HAND', 10 * dpr, H - 12 * dpr)
    }
    const tr = e.tracker.hands
    const gestures = e.tracker.camHands.map(h => h.gesture).filter(Boolean).join(' + ')
    this.monInfo.textContent = e.hands.mode === 'mouse' ? 'mouse' : tr.status === 'ready'
      ? `${e.tracker.camHands.length} hand${e.tracker.camHands.length === 1 ? '' : 's'}${gestures ? ' · ' + gestures : ''} · ${tr.rate.toFixed(0)} fps`
      : tr.status === 'loading' ? 'loading tracker…' : tr.status === 'error' ? 'tracker error' : ''
  }

  // ---------- keyboard ----------
  private keys() {
    const e = this.engine
    window.addEventListener('keydown', ev => {
      const t = ev.target as HTMLElement
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return
      const k = ev.key
      if (/^[1-9]$/.test(k) && !ev.ctrlKey) { const s = e.scenes[Number(k) - 1]; if (s) e.setScene(s.id); return }
      if (ev.ctrlKey && k.toLowerCase() === 's') { ev.preventDefault(); if (e.live) { this.panel.savePreset(e.live.def); this.panel.build(e.live.def) } return }
      if (ev.ctrlKey || ev.metaKey) return
      switch (k.toLowerCase()) {
        case 'r': this.toggleRecord(ev.shiftKey); break
        case 's': this.snapshot(); break
        case ' ': ev.preventDefault(); e.frozen = !e.frozen; break
        case 'h': this.root.classList.toggle('hide-ui'); break
        case 'f': if (document.fullscreenElement) document.exitFullscreen(); else this.outBody.requestFullscreen().catch(() => {}); break
        case 'm': e.setView('mirror', !e.view.mirror); this.mirrorBtn?.classList.toggle('on', e.view.mirror); break
        case 'a': { const ids = Object.keys(ASPECTS) as AspectId[]; const n = ids[(ids.indexOf(e.view.aspect) + 1) % ids.length]; e.setView('aspect', n); this.aspectSet(n); break }
        case 'c': { const k2 = e.sources.kind; if (k2 === 'demo') this.useWebcam(); else e.sources.useDemo(); this.syncSource(); break }
        case 'g': e.setView('overlay', !e.view.overlay); break
        case 'p': e.setView('handsPanel', !e.view.handsPanel); if (e.live) this.panel.build(e.live.def); break
        case 'd': if (e.live) { this.panel.randomize(e.live.def); this.panel.build(e.live.def) } break
        case 't': e.setView('crossfade', !e.view.crossfade); toast(`Crossfade ${e.view.crossfade ? 'on' : 'off'}`, { ms: 1000 }); break
        case 'enter': ev.preventDefault(); e.pulse('pulse'); break
        case '[': if (e.live) this.panel.cyclePreset(e.live.def, -1); break
        case ']': if (e.live) this.panel.cyclePreset(e.live.def, 1); break
        case 'tab': ev.preventDefault(); { const v = e.view.handsFrom === 'mouse' ? 'camera' : 'mouse'; e.setView('handsFrom', v); toast(`Hands: ${v}`, { ms: 1000 }) } break
        case 'escape': if (e.recorder.state === 'recording') this.stopRecord(); else this.root.classList.remove('hide-ui'); break
      }
    })
  }

  // ---------- drag & drop ----------
  private dragDrop() {
    const st = this.stage
    st.addEventListener('dragover', ev => { ev.preventDefault(); st.classList.add('drag') })
    st.addEventListener('dragleave', () => st.classList.remove('drag'))
    st.addEventListener('drop', async ev => {
      ev.preventDefault()
      st.classList.remove('drag')
      const files = [...(ev.dataTransfer?.files ?? [])]
      if (!files.length) return
      const imgs = files.filter(isImage)
      if (this.panel.addImages && imgs.length) { await this.panel.addImages(imgs); return }
      const inst = this.engine.live?.inst
      if (inst?.drop && inst.drop(files)) return
      const f = files.find(f => f.type.startsWith('video/') || f.type.startsWith('image/'))
      if (f) await this.useFile(f)
    })
  }
}
