// TouchLab: local server. No dependencies: Node 18+ and ffmpeg.
// Serves the built app from dist/ on 127.0.0.1:4747, and turns browser recordings into
// MP4s that phones and social apps play everywhere (H.264 High, yuv420p, constant 30/60 fps, bt709, faststart).
import http from 'node:http'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { spawn, execFileSync } from 'node:child_process'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const DEV = process.argv.includes('--dev')
const HOST = '127.0.0.1'
const PORT = Number(process.env.TOUCHLAB_PORT) || 4747
const APP_URL = `http://${HOST}:${PORT}/`
const DIST = path.join(ROOT, 'dist')
const WORK = path.join(ROOT, 'work')
const LOG_DIR = path.join(ROOT, 'logs')
const LOG_FILE = path.join(LOG_DIR, 'server.log')
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version
const MAX_UPLOAD = 4 * 1024 ** 3

fs.mkdirSync(WORK, { recursive: true })
fs.mkdirSync(LOG_DIR, { recursive: true })
try { if (fs.statSync(LOG_FILE).size > 2 * 1024 ** 2) fs.renameSync(LOG_FILE, LOG_FILE + '.old') } catch {}

function log(...a) {
  const line = `[${new Date().toISOString()}] ${a.join(' ')}\n`
  if (DEV) process.stdout.write(line)
  try { fs.appendFileSync(LOG_FILE, line) } catch {}
}

// ---------- config ----------
const CONFIG_FILE = path.join(ROOT, 'config.json')
function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) } catch { return {} }
}
function outDir() {
  const cfg = readConfig()
  return cfg.outDir || path.join(os.homedir(), 'Videos', 'TouchLab')
}

// ---------- ffmpeg ----------
function resolveBin(name) {
  const cfg = readConfig()
  if (cfg[name] && fs.existsSync(cfg[name])) return cfg[name]
  try {
    const out = execFileSync('where.exe', [name], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
    const hit = out.split(/\r?\n/).map(s => s.trim()).find(s => s.toLowerCase().endsWith('.exe'))
    if (hit) return hit
  } catch {}
  const pkgs = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages')
  try {
    for (const d of fs.readdirSync(pkgs)) {
      if (!/ffmpeg/i.test(d)) continue
      for (const sub of fs.readdirSync(path.join(pkgs, d))) {
        const exe = path.join(pkgs, d, sub, 'bin', `${name}.exe`)
        if (fs.existsSync(exe)) return exe
      }
    }
  } catch {}
  return null
}
const FFMPEG = resolveBin('ffmpeg')

function run(bin, args, { timeout = 30 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { windowsHide: true })
    const err = []
    p.stderr.on('data', d => { err.push(d); if (err.length > 200) err.shift() })
    p.stdout.resume()
    const timer = setTimeout(() => p.kill(), timeout)
    p.on('error', e => { clearTimeout(timer); reject(e) })
    p.on('close', code => {
      clearTimeout(timer)
      if (code === 0) return resolve()
      const msg = Buffer.concat(err).toString('utf8').trim().split(/\r?\n/).slice(-3).join(' ')
      reject(new Error(msg || `ffmpeg exited with ${code}`))
    })
  })
}

let ENCODER = 'libx264'
async function detectEncoder() {
  if (!FFMPEG) return
  try {
    await run(FFMPEG, ['-hide_banner', '-v', 'error', '-f', 'lavfi', '-i', 'color=s=256x256:d=0.1', '-c:v', 'h264_nvenc', '-f', 'null', '-'], { timeout: 20000 })
    ENCODER = 'h264_nvenc'
  } catch { ENCODER = 'libx264' }
  log('encoder:', ENCODER, 'ffmpeg:', FFMPEG)
}

function encodeArgs(enc) {
  return enc === 'h264_nvenc'
    ? ['-c:v', 'h264_nvenc', '-preset', 'p5', '-tune', 'hq', '-rc', 'vbr', '-cq', '18', '-b:v', '0', '-maxrate', '35M', '-bufsize', '70M', '-profile:v', 'high', '-bf', '2']
    : ['-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-profile:v', 'high', '-level', '4.2']
}

let exporting = 0
let queue = Promise.resolve()
async function transcode(input, output, fps, audio) {
  const vf = `fps=${fps},scale=trunc(iw/2)*2:trunc(ih/2)*2:out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv`
  const args = (enc) => [
    '-y', '-hide_banner', '-v', 'error', '-fflags', '+genpts', '-i', input,
    ...(audio ? ['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo'] : []),
    '-map', '0:v:0', ...(audio ? ['-map', '1:a:0', '-c:a', 'aac', '-b:a', '128k', '-shortest'] : ['-an']),
    '-vf', vf, ...encodeArgs(enc), '-g', String(fps * 2),
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
    '-movflags', '+faststart', output,
  ]
  try {
    await run(FFMPEG, args(ENCODER))
    return ENCODER
  } catch (e) {
    if (ENCODER !== 'h264_nvenc') throw e
    log('nvenc failed, retrying with libx264:', e.message)
    await run(FFMPEG, args('libx264'))
    return 'libx264'
  }
}

// ---------- helpers ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.wasm': 'application/wasm',
  '.task': 'application/octet-stream', '.tflite': 'application/octet-stream', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8',
}
function send(res, code, body) {
  const data = JSON.stringify(body)
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data), 'Cache-Control': 'no-store' })
  res.end(data)
}
async function readJson(req) {
  const chunks = []
  let n = 0
  for await (const c of req) { n += c.length; if (n > 1e6) throw new Error('Body too large'); chunks.push(c) }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') } catch { return {} }
}
function stamp() {
  const d = new Date(), z = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}_${z(d.getHours())}-${z(d.getMinutes())}-${z(d.getSeconds())}`
}
const safeName = s => String(s || 'Scene').replace(/[^A-Za-z0-9_-]+/g, '').slice(0, 40) || 'Scene'
function uniquePath(dir, base, ext) {
  let p = path.join(dir, base + ext), i = 2
  while (fs.existsSync(p)) p = path.join(dir, `${base}_${i++}${ext}`)
  return p
}
function insideOut(f) {
  const rel = path.relative(path.resolve(outDir()), path.resolve(f))
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel)
}

// Only this app's own pages may call the API: the Host must be ours, POSTs must carry a
// custom header (cross-site pages cannot add one without a preflight we never answer),
// and any Origin header must be ours.
function allowed(req) {
  const host = (req.headers.host || '').toLowerCase()
  const okHosts = [`127.0.0.1:${PORT}`, `localhost:${PORT}`, '127.0.0.1:4748', 'localhost:4748']
  if (!okHosts.includes(host)) return false
  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE') {
    if (req.headers['x-touchlab'] !== '1') return false
    const origin = req.headers.origin
    if (origin && !okHosts.some(h => origin === `http://${h}`)) return false
  }
  return true
}

// ---------- lifecycle: quit once every window has been closed for a while ----------
let lastBeat = Date.now(), byeAt = 0
setInterval(() => {
  if (DEV || exporting) return
  const now = Date.now()
  if (byeAt && lastBeat < byeAt && now - byeAt > 20000) shutdown('window closed')
  else if (now - lastBeat > 10 * 60 * 1000) shutdown('idle')
}, 5000).unref()
function shutdown(why) {
  log('shutting down:', why)
  process.exit(0)
}

// ---------- routes ----------
async function handle(req, res) {
  if (!allowed(req)) return send(res, 403, { error: 'Forbidden' })
  const url = new URL(req.url, APP_URL)
  const p = url.pathname
  const q = k => url.searchParams.get(k)

  if (p === '/api/health') return send(res, 200, { app: 'touchlab', version: VERSION, ffmpeg: !!FFMPEG, encoder: ENCODER, outDir: outDir() })
  if (p === '/api/heartbeat') { lastBeat = Date.now(); return send(res, 200, { ok: true }) }
  if (p === '/api/bye') { byeAt = Date.now(); return send(res, 200, { ok: true }) }

  if (p === '/api/config') {
    if (req.method === 'POST') {
      const b = await readJson(req)
      const cfg = readConfig()
      if (typeof b.outDir === 'string' && b.outDir.trim()) {
        const dir = path.resolve(b.outDir.trim())
        await fsp.mkdir(dir, { recursive: true })
        cfg.outDir = dir
      }
      await fsp.writeFile(CONFIG_FILE, JSON.stringify(cfg, null, 2))
    }
    return send(res, 200, { outDir: outDir() })
  }

  if (p === '/api/export' && req.method === 'POST') {
    if (!FFMPEG) return send(res, 500, { error: 'ffmpeg was not found. Install it with: winget install Gyan.FFmpeg' })
    const len = Number(req.headers['content-length'] || 0)
    if (len > MAX_UPLOAD) return send(res, 413, { error: 'Recording too large' })
    const ext = ['mp4', 'webm', 'mkv'].includes(q('ext')) ? q('ext') : 'webm'
    const fps = [24, 25, 30, 50, 60].includes(Number(q('fps'))) ? Number(q('fps')) : 30
    const audio = q('audio') === '1'
    const tmp = path.join(WORK, `rec-${Date.now().toString(36)}.${ext}`)
    exporting++
    try {
      await pipeline(req, fs.createWriteStream(tmp))
      const dir = outDir()
      await fsp.mkdir(dir, { recursive: true })
      const out = uniquePath(dir, `TouchLab_${safeName(q('scene'))}_${stamp()}`, '.mp4')
      const t0 = Date.now()
      const job = queue.then(() => transcode(tmp, out, fps, audio))
      queue = job.catch(() => {})
      const encoder = await job
      const st = await fsp.stat(out)
      log('exported', out, `${st.size}B`, encoder, `${Date.now() - t0}ms`)
      return send(res, 200, { file: out, bytes: st.size, seconds: (Date.now() - t0) / 1000, encoder })
    } catch (e) {
      log('export failed', e.message)
      return send(res, 500, { error: e.message })
    } finally {
      exporting--
      if (q('keep') !== '1') fsp.rm(tmp, { force: true }).catch(() => {})
    }
  }

  if (p === '/api/snapshot' && req.method === 'POST') {
    const dir = outDir()
    await fsp.mkdir(dir, { recursive: true })
    const out = uniquePath(dir, `TouchLab_${safeName(q('scene'))}_${stamp()}`, '.png')
    await pipeline(req, fs.createWriteStream(out))
    return send(res, 200, { file: out })
  }

  if (p === '/api/reveal' && req.method === 'POST') {
    const b = await readJson(req)
    const f = b.file
    if (f && insideOut(f) && fs.existsSync(f)) {
      spawn('explorer.exe', [`/select,"${f}"`], { windowsVerbatimArguments: true, detached: true, stdio: 'ignore' }).unref()
    } else {
      const dir = outDir()
      await fsp.mkdir(dir, { recursive: true })
      spawn('explorer.exe', [dir], { detached: true, stdio: 'ignore' }).unref()
    }
    return send(res, 200, { ok: true })
  }

  if (p.startsWith('/api/')) return send(res, 404, { error: 'Not found' })
  if (DEV) return send(res, 404, { error: 'Dev mode: open http://127.0.0.1:4748/' })

  // static app
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed' })
  let rel
  try { rel = decodeURIComponent(p === '/' ? '/index.html' : p) } catch { return send(res, 400, { error: 'Bad path' }) }
  const file = path.normalize(path.join(DIST, rel))
  if (file !== DIST && !file.startsWith(DIST + path.sep)) return send(res, 403, { error: 'Forbidden' })
  let st
  try { st = await fsp.stat(file) } catch {}
  if (!st || !st.isFile()) {
    if (path.extname(rel)) return send(res, 404, { error: 'Not found' })
    return serveFile(req, res, path.join(DIST, 'index.html'))
  }
  return serveFile(req, res, file, st)
}

async function serveFile(req, res, file, st) {
  st = st || await fsp.stat(file)
  const ext = path.extname(file).toLowerCase()
  const type = MIME[ext] || 'application/octet-stream'
  const cache = ext === '.html' ? 'no-store' : 'max-age=3600'
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': cache })
  if (req.method === 'HEAD') return res.end()
  fs.createReadStream(file).pipe(res)
}

const server = http.createServer((req, res) => {
  handle(req, res).catch(e => {
    log('error', req.url, e.stack || e.message)
    if (!res.headersSent) send(res, 500, { error: e.message })
    else res.end()
  })
})
server.requestTimeout = 0
server.on('error', e => {
  if (e.code === 'EADDRINUSE') { log(`port ${PORT} already in use; exiting`); process.exit(3) }
  log('server error', e.message)
  process.exit(1)
})
server.listen(PORT, HOST, async () => {
  log(`TouchLab ${VERSION} running at ${APP_URL}${DEV ? ' (dev API only)' : ''}`)
  await detectEncoder()
})
process.on('SIGINT', () => shutdown('SIGINT'))
