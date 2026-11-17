// End-to-end acceptance run in headless Chrome (or Edge) with a fake camera.
//   node scripts/smoke.mjs [--url http://127.0.0.1:4747/] [--headed] [--no-record]
// Needs the server running (npm start). Writes screenshots + a report to artifacts/smoke/.
// Exit code 1 if any check fails. The fake camera plays samples/hands.mp4, converted once with
// ffmpeg into test-fixtures/hands.y4m; without ffmpeg the hand-tracking checks are skipped.
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { browserPath } from './browser.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const url = args.includes('--url') ? args[args.indexOf('--url') + 1] : 'http://127.0.0.1:4747/'
const headed = args.includes('--headed')
const doRecord = !args.includes('--no-record')
const out = join(root, 'artifacts', 'smoke')
mkdirSync(out, { recursive: true })
const fixture = join(root, 'test-fixtures', 'hands.y4m').replaceAll('\\', '/')
if (!existsSync(fixture)) {
  try {
    mkdirSync(join(root, 'test-fixtures'), { recursive: true })
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', join(root, 'samples', 'hands.mp4'), '-vf', 'fps=30,format=yuv420p', fixture], { stdio: 'inherit' })
  } catch (e) { console.log(`(could not make ${fixture}: ${e.message})`) }
}
const hasFixture = existsSync(fixture)

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  · ' + detail : ''}`) }

const browser = await chromium.launch({
  executablePath: browserPath(),
  headless: !headed,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required',
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
    ...(hasFixture ? [`--use-file-for-fake-video-capture=${fixture}`] : [])],
})
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, permissions: ['camera'] })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', e => errors.push(e.message))
page.on('console', m => { if (m.type() === 'error' && !/TensorFlow Lite|XNNPACK/.test(m.text())) errors.push(m.text().slice(0, 300)) })

// Grab a 24×24 fingerprint of the output right after a frame renders.
const fingerprint = () => page.evaluate(() => new Promise(res => {
  const e = window.__touchlab.engine
  const prev = e.onFrame
  e.onFrame = () => {
    e.onFrame = prev
    prev?.()
    const c = document.createElement('canvas')
    c.width = c.height = 24
    const g = c.getContext('2d')
    g.drawImage(e.canvas, 0, 0, 24, 24)
    res(Array.from(g.getImageData(0, 0, 24, 24).data).filter((_, i) => i % 4 !== 3))
  }
}))
const diff = (a, b) => a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0) / a.length
const variance = (a) => { const m = a.reduce((s, v) => s + v, 0) / a.length; return a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length }

await page.goto(url + '?scene=quadtree')
await page.waitForFunction(() => window.__touchlab?.state().scene, null, { timeout: 30000 })
const state = () => page.evaluate(() => window.__touchlab.state())
const scenes = await page.evaluate(() => window.__touchlab.engine.scenes.map(s => s.id))
check('all 6 scenes loaded', scenes.length === 6 && !scenes.includes('shadowplay'), scenes.join(', '))
check('recorder codecs', true, JSON.stringify(await page.evaluate(() => window.__touchlab.codecs())))
writeFileSync(join(out, 'codecs.json'), JSON.stringify(await page.evaluate(() => window.__touchlab.codecs()), null, 2))

// Hands from the fake camera
if (hasFixture) {
  await page.waitForTimeout(500)
  if ((await page.evaluate(() => window.__touchlab.engine.sources.kind)) !== 'webcam') await page.getByRole('button', { name: 'Webcam', exact: true }).click()
  let s, t0 = Date.now()
  while (Date.now() - t0 < 25000) { s = await state(); if (s.tracker === 'ready' && s.hands.count >= 1) break; await page.waitForTimeout(400) }
  check('hand tracker ready and sees a hand', s.tracker === 'ready' && s.hands.count >= 1, `tracker=${s.tracker} hands=${s.hands.count}`)
  await page.waitForTimeout(3000)
  const perf = await page.evaluate(() => ({ rate: window.__touchlab.engine.tracker.hands.rate, ms: window.__touchlab.engine.tracker.hands.ms }))
  check('tracker speed', perf.rate > 8, `${perf.rate.toFixed(1)} fps, ${perf.ms.toFixed(1)} ms/frame`)
  const mon = await page.evaluate(() => { const c = document.querySelector('canvas.monitor'); const r = c.getBoundingClientRect(); return { w: r.width, h: r.height, hands: window.__touchlab.engine.tracker.camHands.length } })
  check('hands panel shows the camera and tracked hands', mon.w > 200 && mon.h > 100 && mon.hands >= 1, `${Math.round(mon.w)}×${Math.round(mon.h)}, ${mon.hands} hands`)
  await page.screenshot({ path: join(out, 'two-panels.png') })
} else {
  check('hand tracker (skipped: ffmpeg is needed to make test-fixtures/hands.y4m)', true)
}

// Every scene renders, differs, and animates
const prints = {}
for (let i = 0; i < scenes.length; i++) {
  await page.keyboard.press(String(i + 1))
  await page.waitForTimeout(1800)
  const s = await state()
  const a = await fingerprint()
  await page.waitForTimeout(600)
  const b = await fingerprint()
  prints[s.scene] = a
  await page.locator('canvas.out').screenshot({ path: join(out, `scene-${i + 1}-${s.scene}.png`) })
  check(`scene ${i + 1} ${s.scene}: renders`, variance(a) > 20 && !s.error, `var=${variance(a).toFixed(0)} fps=${s.fps.toFixed(0)}${s.error ? ' err=' + s.error : ''}`)
  check(`scene ${i + 1} ${s.scene}: animates`, diff(a, b) > 0.3, `Δ=${diff(a, b).toFixed(2)}`)
}
const ids = Object.keys(prints)
let minPair = Infinity, pair = ''
for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) { const d = diff(prints[ids[i]], prints[ids[j]]); if (d < minPair) { minPair = d; pair = `${ids[i]}/${ids[j]}` } }
check('scenes look different from each other', minPair > 3, `closest ${pair} Δ=${minPair.toFixed(1)}`)

// Slider changes output; values persist across reload
await page.evaluate(() => window.__touchlab.scene('quadtree'))
await page.waitForTimeout(800)
await page.keyboard.press('Space') // freeze for a stable comparison
await page.waitForTimeout(300)
const before = await fingerprint()
const sl = page.locator('.slider').first()
const box = await sl.boundingBox()
await page.mouse.click(box.x + box.width * 0.15, box.y + box.height / 2)
await page.waitForTimeout(500)
const after = await fingerprint()
check('moving a slider changes the picture', diff(before, after) > 0.5, `Δ=${diff(before, after).toFixed(2)}`)
await page.keyboard.press('Space')
const v1 = await page.evaluate(() => window.__touchlab.engine.live.params.raw[window.__touchlab.engine.live.def.params[0].id])
await page.waitForTimeout(600)
await page.reload()
await page.waitForFunction(() => window.__touchlab?.state().scene, null, { timeout: 30000 })
await page.waitForTimeout(500)
const v2 = await page.evaluate(() => window.__touchlab.engine.live.params.raw[window.__touchlab.engine.live.def.params[0].id])
check('slider value survives a reload', v1 === v2, `${v1} → ${v2}`)
await page.evaluate(() => window.__touchlab.engine.live.params.resetAll())

// Formats
for (const [key, w, h] of [['4:5', 1080, 1350], ['1:1', 1080, 1080], ['16:9', 1920, 1080], ['9:16', 1080, 1920]]) {
  await page.evaluate((k) => window.__touchlab.engine.setView('aspect', k), key)
  await page.evaluate(() => window.__touchlab.engine.setView('renderScale', 1))
  await page.waitForTimeout(200)
  const s = await state()
  check(`format ${key}`, s.size[0] === w && s.size[1] === h, s.size.join('×'))
}
await page.evaluate(() => window.__touchlab.engine.setView('renderScale', 0.75))

// Scene image uploads (Cell Poster holds max 4; Gallery shows the user's images and opens one on click)
const imgs = readdirSync(join(root, 'samples')).filter(f => f.endsWith('.jpg')).sort().slice(0, 5).map(f => join(root, 'samples', f))
const thumbCount = () => page.locator('.thumbs .thumb:not(.add)').count()
if (imgs.length >= 5) {
  await page.evaluate(() => window.__touchlab.scene('uva'))
  await page.waitForTimeout(800)
  const f0 = await fingerprint()
  await page.setInputFiles('.panel input[type=file][multiple]', imgs.slice(0, 5))
  await page.waitForFunction(() => document.querySelectorAll('.thumbs .thumb:not(.add)').length >= 4, null, { timeout: 15000 })
  await page.waitForTimeout(1500)
  const n = await thumbCount()
  const f1 = await fingerprint()
  check('Cell Poster takes up to 4 images', n === 4, `${n} kept of 5`)
  check('Cell Poster shows the uploaded images', diff(f0, f1) > 3, `Δ=${diff(f0, f1).toFixed(1)}`)
  await page.locator('canvas.out').screenshot({ path: join(out, 'uva-images.png') })

  await page.evaluate(() => window.__touchlab.scene('gallery'))
  await page.waitForTimeout(800)
  await page.setInputFiles('.panel input[type=file][multiple]', imgs.slice(0, 3))
  await page.waitForFunction(() => document.querySelectorAll('.thumbs .thumb:not(.add)').length >= 3, null, { timeout: 15000 })
  await page.waitForTimeout(2000)
  check('Gallery accepts uploads', (await thumbCount()) === 3)
  await page.locator('canvas.out').screenshot({ path: join(out, 'gallery-images.png') })
  // click the card nearest the middle → it opens full-frame
  await page.mouse.move(0, 0)
  await page.waitForTimeout(400)
  const g0 = await fingerprint()
  const box = await page.locator('canvas.out').boundingBox()
  const st0 = (await state()).status
  // click along the ribbon until we hit a card (clicks on empty space do nothing)
  let g1 = g0
  for (const [cx, cy] of [[0.5, 0.5], [0.45, 0.55], [0.55, 0.45], [0.4, 0.6], [0.6, 0.4], [0.35, 0.65], [0.65, 0.35]]) {
    await page.mouse.click(box.x + box.width * cx, box.y + box.height * cy)
    await page.waitForTimeout(1500)
    g1 = await fingerprint()
    if (diff(g0, g1) > 6) break
    await page.mouse.move(0, 0)
  }
  const st1 = (await state()).status
  await page.locator('canvas.out').screenshot({ path: join(out, 'gallery-open.png') })
  check('Gallery: click opens an image full-frame', diff(g0, g1) > 6 || st0 !== st1, `status "${st0}" → "${st1}", Δ=${diff(g0, g1).toFixed(1)}`)
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5)
  await page.waitForTimeout(800)
} else {
  check('image upload tests (skipped: samples/ needs 5 JPGs)', true)
}

// Random button changes the look
for (const id of ['quadtree', 'signal']) {
  await page.evaluate((s) => window.__touchlab.scene(s), id)
  await page.waitForTimeout(800)
  const before = await page.evaluate(() => JSON.stringify(window.__touchlab.engine.live.params.snapshot()))
  await page.locator('.presets .chip.dice').click()
  await page.waitForTimeout(900)
  const after = await page.evaluate(() => JSON.stringify(window.__touchlab.engine.live.params.snapshot()))
  const st = await state()
  check(`Random button in ${id}`, before !== after && !st.error, st.error || 'values changed')
  await page.locator('canvas.out').screenshot({ path: join(out, `random-${id}.png`) })
}

// Injected gestures change scene state
const mkHand = (x, y, pinch) => {
  const lm = []
  const pose = [[0, 0], [-0.3, -0.2], [-0.55, -0.45], [-0.75, -0.65], [-0.92, -0.82], [-0.32, -0.95], [-0.38, -1.35], [-0.41, -1.6], [-0.43, -1.82], [0, -1], [0, -1.45], [0, -1.72], [0, -1.95], [0.28, -0.93], [0.32, -1.33], [0.34, -1.57], [0.36, -1.77], [0.52, -0.82], [0.6, -1.1], [0.64, -1.3], [0.67, -1.47]]
  for (const [px, py] of pose) lm.push(x + px * 0.06, y + 0.11 + py * 0.06, 0)
  return { id: 0, presence: 1, lm, palm: { x, y: y + 0.06 }, index: { x: x - 0.026, y: y }, thumb: { x: x - 0.03, y: y + 0.01 }, pinch: pinch ? 1 : 0, pinching: pinch, openness: pinch ? 0.5 : 1, open: !pinch, fist: false, point: false, roll: 0, size: 0.12, vel: { x: 0, y: 0 } }
}
for (const id of ['summon', 'uva', 'gallery']) {
  if (!scenes.includes(id)) continue
  await page.evaluate((s) => window.__touchlab.scene(s), id)
  await page.waitForTimeout(1200)
  const s0 = (await state()).status
  const f0 = await fingerprint()
  await page.evaluate((h) => window.__touchlab.setHands({ hands: [h], events: [{ hand: 0, type: 'pinchStart', x: h.index.x, y: h.index.y }] }), mkHand(0.5, 0.45, true))
  await page.waitForTimeout(1500)
  const s1 = (await state()).status
  const f1 = await fingerprint()
  await page.screenshot({ path: join(out, `gesture-${id}.png`) })
  await page.evaluate(() => window.__touchlab.setHands(null))
  check(`pinch reacts in ${id}`, s0 !== s1 || diff(f0, f1) > 2, `status "${s0}" → "${s1}", Δ=${diff(f0, f1).toFixed(1)}`)
}

// Recording → MP4
if (doRecord) {
  for (const id of ['quadtree', 'signal'].filter(s => scenes.includes(s))) {
    await page.evaluate((s) => window.__touchlab.scene(s), id)
    await page.waitForTimeout(800)
    await page.keyboard.press('r')
    await page.waitForTimeout(4000)
    await page.keyboard.press('r')
    await page.waitForFunction(() => window.__touchlab.state().recorder === 'idle', null, { timeout: 120000 })
    const status = await page.locator('.recbar .status').textContent()
    const m = /Saved (\S+\.mp4)/.exec(status || '')
    let probe = ''
    if (m) {
      const outDir = await page.evaluate(() => fetch('/api/health').then(r => r.json()).then(j => j.outDir))
      const file = join(outDir, m[1])
      probe = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,profile,pix_fmt,width,height,r_frame_rate,color_primaries:format=duration', '-of', 'compact=p=0', file], { encoding: 'utf8' }).trim()
    }
    const ok = !!m && /h264/.test(probe) && /High/.test(probe) && /yuv420p/.test(probe) && /1080/.test(probe) && /1920/.test(probe)
    check(`record ${id} → MP4`, ok, probe || status)
  }
}

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
writeFileSync(join(out, 'report.json'), JSON.stringify(results, null, 2))
await browser.close()
const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
