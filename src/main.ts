import '@fontsource/inter/400.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/600.css'
import '@fontsource/playfair-display/400.css'
import '@fontsource/playfair-display/700.css'
import '@fontsource/ibm-plex-mono/400.css'
import './ui/styles.css'
import { Engine } from './core/Engine'
import { Shell } from './ui/Shell'
import { loadScenes } from './scenes/registry'
import { api } from './core/Api'
import { supportedTypes } from './core/Recorder'
import type { Hand, HandsState } from './input/hands/types'

async function boot() {
  // Canvas-drawn text needs the webfonts loaded first.
  await Promise.all([
    document.fonts.load('400 40px "Playfair Display"'),
    document.fonts.load('700 40px "Playfair Display"'),
    document.fonts.load('400 12px "IBM Plex Mono"'),
    document.fonts.load('600 12px "JetBrains Mono"'),
  ]).catch(() => {})

  const SCENES = await loadScenes()
  if (!SCENES.length) throw new Error('No scenes could be loaded.')
  const canvas = document.createElement('canvas')
  const engine = new Engine(canvas, SCENES)
  const shell = new Shell(engine)
  document.getElementById('app')!.append(shell.root)

  const params = new URLSearchParams(location.search)
  let first = params.get('scene') || ''
  try { first = first || localStorage.getItem('touchlab.scene') || '' } catch {}
  engine.setScene(SCENES.some(s => s.id === first) ? first : SCENES[0].id)
  engine.start()
  api.startHeartbeat()

  // Camera: reuse a previous grant silently; otherwise offer it without blocking the demo.
  let granted = false
  try { granted = (await navigator.permissions.query({ name: 'camera' as PermissionName })).state === 'granted' } catch {}
  const wantCam = params.get('cam') !== '0'
  if (wantCam && granted) {
    let lastSource = 'webcam'
    try { lastSource = localStorage.getItem('touchlab.source') || 'webcam' } catch {}
    if (lastSource === 'webcam') await shell.useWebcam()
    else await shell.openCameraForHands()
  } else if (wantCam) {
    shell.showCameraNotice()
  }
  await shell.refreshCameras()

  // Test / automation hook.
  ;(window as unknown as Record<string, unknown>).__touchlab = {
    engine,
    state: () => ({
      scene: engine.live?.def.id,
      fps: engine.fps,
      hands: { count: engine.hands.hands.length, mode: engine.hands.mode },
      tracker: engine.tracker.hands.status,
      size: [engine.canvas.width, engine.canvas.height],
      status: engine.live?.inst.status?.() ?? '',
      error: engine.sceneError,
      recorder: engine.recorder.state,
    }),
    scene: (id: string) => engine.setScene(id),
    codecs: supportedTypes,
    /** Override hand input for tests: pass a HandsState-like object, or null to restore. */
    setHands: (s: Partial<HandsState> & { hands: Partial<Hand>[] } | null) => {
      const tracker = engine.tracker as unknown as { sample: (...a: unknown[]) => HandsState; __orig?: (...a: unknown[]) => HandsState }
      if (!tracker.__orig) tracker.__orig = tracker.sample.bind(engine.tracker)
      if (!s) { tracker.sample = tracker.__orig; return }
      let sentEvents = false
      tracker.sample = () => {
        const ev = sentEvents ? [] : (s.events ?? [])
        sentEvents = true
        return { hands: s.hands as Hand[], events: ev, mode: 'camera', twoDist: s.twoDist ?? 0 }
      }
    },
  }
}

boot().catch(e => {
  console.error(e)
  document.body.innerHTML = `<pre style="color:#ff6b6b;padding:24px;font:14px monospace;white-space:pre-wrap">TouchLab failed to start:\n${(e as Error).stack || e}</pre>`
})
