// Dev helper: screenshot scenes in headless Chrome.
//   node scripts/shot.mjs [--url http://127.0.0.1:4748/] [--out artifacts/shots] [--wait 2500] [--full] [--mouse x,y] [--press key] sceneId...
// Prints console errors so scene authors can iterate quickly.
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { browserPath } from './browser.mjs'

const args = process.argv.slice(2)
const opt = (k, d) => { const i = args.indexOf(k); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v }
const flag = (k) => { const i = args.indexOf(k); if (i < 0) return false; args.splice(i, 1); return true }
const url = opt('--url', 'http://127.0.0.1:4748/')
const out = opt('--out', 'artifacts/shots')
const wait = Number(opt('--wait', '2500'))
const mouse = opt('--mouse', '')
const press = opt('--press', '')
const preset = opt('--preset', '')
const full = flag('--full')
const scenes = args.length ? args : ['quadtree']
mkdirSync(out, { recursive: true })

const browser = await chromium.launch({
  executablePath: browserPath(),
  headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
})
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}]`, m.text().slice(0, 400)) })
page.on('pageerror', e => console.log('[pageerror]', e.message))
for (const id of scenes) {
  await page.goto(`${url}?scene=${id}&cam=0`)
  await page.waitForFunction(() => window.__touchlab && window.__touchlab.state().scene, null, { timeout: 20000 })
  if (preset) {
    await page.locator('.presets .chip', { hasText: preset }).first().click()
  }
  if (mouse) {
    const box = await page.locator('canvas.out').boundingBox()
    const [mx, my] = mouse.split(',').map(Number)
    await page.mouse.move(box.x + box.width * mx, box.y + box.height * my)
    await page.mouse.move(box.x + box.width * mx + 5, box.y + box.height * my + 5, { steps: 5 })
  }
  if (press) await page.keyboard.press(press)
  await page.waitForTimeout(wait)
  const st = await page.evaluate(() => window.__touchlab.state())
  const file = join(out, `${id}${preset ? '-' + preset.replace(/\W+/g, '') : ''}.png`)
  if (full) await page.screenshot({ path: file })
  else await page.locator('canvas.out').screenshot({ path: file })
  console.log(id, JSON.stringify(st), '->', file)
}
await browser.close()
