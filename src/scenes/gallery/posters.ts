// Built-in procedural "photos" for the gallery: a curated mood board (foliage, flowers, flash
// photos, Y2K type and UI, film strips...) drawn with Canvas2D so the scene needs no assets.

type Ctx = CanvasRenderingContext2D
export type Poster = { aspect: number; draw: (c: Ctx, w: number, h: number, rnd: () => number) => void }

export function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const TAU = Math.PI * 2
const pick = <T,>(r: () => number, a: T[]) => a[Math.floor(r() * a.length)]

function lin(c: Ctx, x0: number, y0: number, x1: number, y1: number, stops: [number, string][]) {
  const g = c.createLinearGradient(x0, y0, x1, y1)
  for (const [o, s] of stops) g.addColorStop(o, s)
  return g
}
function rad(c: Ctx, x: number, y: number, r0: number, r1: number, stops: [number, string][]) {
  const g = c.createRadialGradient(x, y, r0, x, y, r1)
  for (const [o, s] of stops) g.addColorStop(o, s)
  return g
}
function blob(c: Ctx, x: number, y: number, r: number, color: string) {
  c.fillStyle = rad(c, x, y, 0, r, [[0, color], [1, 'rgba(0,0,0,0)']])
  c.fillRect(x - r, y - r, r * 2, r * 2)
}
function ellipse(c: Ctx, x: number, y: number, rx: number, ry: number, rot: number, fill: string) {
  c.fillStyle = fill
  c.beginPath()
  c.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot, 0, TAU)
  c.fill()
}
function figure(c: Ctx, x: number, y: number, s: number, fill: string) {
  c.fillStyle = fill
  c.beginPath(); c.arc(x, y, s * 0.22, 0, TAU); c.fill()
  c.beginPath()
  c.moveTo(x - s * 0.5, y + s * 1.4)
  c.quadraticCurveTo(x - s * 0.52, y + s * 0.32, x, y + s * 0.3)
  c.quadraticCurveTo(x + s * 0.52, y + s * 0.32, x + s * 0.5, y + s * 1.4)
  c.fill()
}

/** Film finish: grain, faded blacks, warm tint and a soft vignette. */
export function filmFinish(c: Ctx, w: number, h: number, rnd: () => number, amount = 1) {
  c.save()
  c.globalCompositeOperation = 'source-over'
  c.fillStyle = rad(c, w / 2, h / 2, Math.min(w, h) * 0.3, Math.max(w, h) * 0.75, [[0, 'rgba(0,0,0,0)'], [1, `rgba(0,0,0,${0.35 * amount})`]])
  c.fillRect(0, 0, w, h)
  c.globalCompositeOperation = 'lighten'
  c.fillStyle = `rgba(28,22,26,${0.9 * amount})`
  c.fillRect(0, 0, w, h)
  c.globalCompositeOperation = 'soft-light'
  c.fillStyle = `rgba(255,190,120,${0.25 * amount})`
  c.fillRect(0, 0, w, h)
  c.globalCompositeOperation = 'source-over'
  // grain works on real pixels (the context may be scaled for hi-res renders)
  const img = c.getImageData(0, 0, c.canvas.width, c.canvas.height)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * 26 * amount
    d[i] += n; d[i + 1] += n; d[i + 2] += n
  }
  c.putImageData(img, 0, 0)
  c.restore()
}

export const POSTERS: Poster[] = [
  { // foliage
    aspect: 2 / 3, draw: (c, w, h, r) => {
      c.fillStyle = '#123a1c'; c.fillRect(0, 0, w, h)
      for (let i = 0; i < 160; i++) {
        const x = r() * w, y = r() * h, s = 6 + r() * 22
        const g = 70 + r() * 110
        ellipse(c, x, y, s, s * 0.45, r() * TAU, `rgb(${30 + r() * 40},${g},${30 + r() * 40})`)
        ellipse(c, x - s * 0.2, y - s * 0.1, s * 0.5, s * 0.12, r() * TAU, `rgba(210,255,190,${0.15 + r() * 0.2})`)
      }
      for (let i = 0; i < 9; i++) ellipse(c, r() * w, r() * h, 4 + r() * 4, 4 + r() * 4, 0, '#8f5bd6')
    },
  },
  { // red flower
    aspect: 1, draw: (c, w, h, r) => {
      c.fillStyle = lin(c, 0, 0, w, h, [[0, '#1d4a22'], [1, '#0b2410']]); c.fillRect(0, 0, w, h)
      const cx = w * (0.4 + r() * 0.2), cy = h * (0.45 + r() * 0.1)
      for (let k = 0; k < 2; k++) for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU + k * 0.5
        ellipse(c, cx + Math.cos(a) * w * 0.17, cy + Math.sin(a) * h * 0.17, w * (0.2 - k * 0.05), w * (0.12 - k * 0.03), a, k ? '#ff2b3a' : '#c4101f')
      }
      ellipse(c, cx, cy, w * 0.05, w * 0.05, 0, '#ffd23f')
      for (let i = 0; i < 5; i++) ellipse(c, cx + Math.cos(i) * 12, cy + Math.sin(i * 2) * 12, 2, w * 0.09, i, '#ffe08a')
    },
  },
  { // night bokeh party
    aspect: 3 / 2, draw: (c, w, h, r) => {
      c.fillStyle = '#0d0710'; c.fillRect(0, 0, w, h)
      c.globalCompositeOperation = 'lighter'
      for (let i = 0; i < 40; i++) blob(c, r() * w, r() * h * 0.8, 8 + r() * 30, pick(r, ['rgba(255,120,40,0.5)', 'rgba(255,40,90,0.45)', 'rgba(60,200,255,0.4)', 'rgba(255,220,120,0.5)']))
      c.globalCompositeOperation = 'source-over'
      for (let i = 0; i < 4; i++) figure(c, w * (0.15 + i * 0.23 + r() * 0.05), h * 0.55, h * 0.32, '#050306')
    },
  },
  { // sunset sea
    aspect: 3 / 4, draw: (c, w, h, r) => {
      c.fillStyle = lin(c, 0, 0, 0, h * 0.62, [[0, '#3a2c6e'], [0.5, '#e8687a'], [1, '#ffb26b']]); c.fillRect(0, 0, w, h * 0.62)
      ellipse(c, w * (0.3 + r() * 0.4), h * 0.55, w * 0.13, w * 0.13, 0, '#fff0b0')
      c.fillStyle = lin(c, 0, h * 0.62, 0, h, [[0, '#45386e'], [1, '#12102a']]); c.fillRect(0, h * 0.62, w, h)
      c.strokeStyle = 'rgba(255,200,150,0.5)'
      for (let i = 0; i < 18; i++) { const y = h * 0.64 + i * (h * 0.02); c.beginPath(); c.moveTo(w * 0.35 + r() * 20, y); c.lineTo(w * 0.65 - r() * 20, y); c.stroke() }
    },
  },
  { // portrait silhouette
    aspect: 2 / 3, draw: (c, w, h, r) => {
      c.fillStyle = lin(c, 0, 0, w, h, [[0, pick(r, ['#2fb7a6', '#e45b8f', '#4f6bff'])], [1, '#141821']]); c.fillRect(0, 0, w, h)
      figure(c, w * 0.5, h * 0.36, h * 0.55, '#0c0c0f')
      c.strokeStyle = 'rgba(255,240,220,0.6)'; c.lineWidth = 3
      c.beginPath(); c.arc(w * 0.5, h * 0.36, h * 0.121, -1.2, 0.6); c.stroke()
    },
  },
  { // purple glitch
    aspect: 1, draw: (c, w, h, r) => {
      c.fillStyle = '#2a0b4a'; c.fillRect(0, 0, w, h)
      for (let i = 0; i < 26; i++) {
        c.fillStyle = pick(r, ['#8a2be2', '#ff2fd0', '#3a1cff', '#5d0aa8', '#ff6af0'])
        c.fillRect(r() * w - 20, r() * h, 30 + r() * w * 0.6, 4 + r() * 26)
      }
      c.fillStyle = 'rgba(0,0,0,0.25)'
      for (let y = 0; y < h; y += 4) c.fillRect(0, y, w, 1)
    },
  },
  { // big chrome numeral
    aspect: 2 / 3, draw: (c, w, h, r) => {
      c.fillStyle = '#efe9dc'; c.fillRect(0, 0, w, h)
      const n = String(Math.floor(r() * 99)).padStart(2, '0')
      c.font = `900 ${h * 0.5}px Inter, Arial Black, sans-serif`
      c.textAlign = 'center'; c.textBaseline = 'middle'
      c.fillStyle = 'rgba(0,0,0,0.18)'; c.fillText(n, w / 2 + 6, h * 0.46 + 8)
      c.fillStyle = lin(c, 0, h * 0.25, 0, h * 0.7, [[0, '#ffffff'], [0.45, '#9aa3b5'], [0.5, '#3b4152'], [0.75, '#d6dbe6'], [1, '#6c7385']])
      c.fillText(n, w / 2, h * 0.46)
      c.fillStyle = '#e8358a'; c.font = `700 ${h * 0.045}px Inter, sans-serif`
      c.fillText('VOL. ' + n + ' — ARCHIVE', w / 2, h * 0.86)
      c.fillStyle = '#222'
      for (let i = 0; i < 4; i++) c.fillRect(w * 0.2, h * (0.9 + i * 0.018), w * (0.6 - r() * 0.3), 2)
    },
  },
  { // bauhaus geometry
    aspect: 1, draw: (c, w, h, r) => {
      c.fillStyle = '#f2e8d5'; c.fillRect(0, 0, w, h)
      ellipse(c, w * 0.35, h * 0.4, w * 0.28, w * 0.28, 0, '#e2412b')
      c.fillStyle = '#1f4fbf'; c.beginPath(); c.arc(w * 0.68, h * 0.68, w * 0.26, Math.PI, TAU); c.fill()
      c.fillStyle = '#f2b400'; c.fillRect(w * 0.1, h * 0.78, w * 0.5, h * 0.06)
      c.fillStyle = '#111'
      for (let i = 0; i < 6; i++) c.fillRect(w * (0.62 + i * 0.05), h * 0.1, w * 0.02, h * 0.35)
    },
  },
  { // retro window UI
    aspect: 4 / 3, draw: (c, w, h, r) => {
      c.fillStyle = '#c9c6bd'; c.fillRect(0, 0, w, h)
      c.fillStyle = lin(c, 0, 0, w, 0, [[0, '#0a3fd1'], [1, '#4a8cf2']]); c.fillRect(3, 3, w - 6, h * 0.11)
      c.fillStyle = '#fff'; c.font = `600 ${h * 0.065}px Inter, sans-serif`; c.textBaseline = 'middle'
      c.fillText(pick(r, ['untitled.jpg', 'memories.bmp', 'IMG_0420.jpg', 'summer.png']), 10, 3 + h * 0.055)
      c.fillStyle = '#e8473a'; c.fillRect(w - h * 0.1 - 6, 6, h * 0.085, h * 0.085)
      const y0 = h * 0.15
      c.fillStyle = lin(c, 0, y0, 0, h, [[0, '#7fc7ff'], [0.6, '#d9f1ff'], [0.61, '#4fa83d'], [1, '#2f7a25']]); c.fillRect(6, y0, w - 12, h - y0 - 6)
      ellipse(c, w * 0.3, h * 0.92, w * 0.5, h * 0.25, 0, '#58b947')
    },
  },
  { // iridescent CD
    aspect: 1, draw: (c, w, h, r) => {
      c.fillStyle = '#16161c'; c.fillRect(0, 0, w, h)
      const g = c.createConicGradient(r() * TAU, w / 2, h / 2)
      ;['#ff7ae0', '#7af0ff', '#c6ff7a', '#ffe27a', '#b07aff', '#ff7ae0'].forEach((s, i, a) => g.addColorStop(i / (a.length - 1), s))
      c.fillStyle = g; c.beginPath(); c.arc(w / 2, h / 2, w * 0.42, 0, TAU); c.fill()
      c.fillStyle = 'rgba(255,255,255,0.35)'; c.beginPath(); c.arc(w / 2, h / 2, w * 0.15, 0, TAU); c.fill()
      c.fillStyle = '#16161c'; c.beginPath(); c.arc(w / 2, h / 2, w * 0.06, 0, TAU); c.fill()
    },
  },
  { // film strip
    aspect: 3 / 2, draw: (c, w, h, r) => {
      c.fillStyle = '#0b0b0b'; c.fillRect(0, 0, w, h)
      c.fillStyle = '#e9e2d0'
      for (let x = 6; x < w; x += 16) { c.fillRect(x, 6, 8, 10); c.fillRect(x, h - 16, 8, 10) }
      for (let i = 0; i < 3; i++) {
        const x = 8 + i * (w - 16) / 3
        c.fillStyle = lin(c, x, 24, x, h - 24, [[0, pick(r, ['#f5a35a', '#5ad1f5', '#f55a8f'])], [1, '#3a2a20']])
        c.fillRect(x + 3, 24, (w - 16) / 3 - 6, h - 48)
        figure(c, x + (w - 16) / 6, h * 0.42, h * 0.3, 'rgba(10,8,8,0.8)')
      }
    },
  },
  { // beach snapshot
    aspect: 3 / 4, draw: (c, w, h, r) => {
      c.fillStyle = lin(c, 0, 0, 0, h, [[0, '#8fd3ff'], [0.45, '#d8f3ff'], [0.46, '#1d8fd1'], [0.62, '#6cc8e8'], [0.63, '#f3dfb0'], [1, '#e2c48a']]); c.fillRect(0, 0, w, h)
      figure(c, w * 0.62, h * 0.55, h * 0.3, '#5a3624')
      ellipse(c, w * 0.25, h * 0.84, w * 0.18, h * 0.05, 0, '#ff5b6e')
    },
  },
  { // city night
    aspect: 2 / 3, draw: (c, w, h, r) => {
      c.fillStyle = lin(c, 0, 0, 0, h, [[0, '#060a24'], [1, '#2a1640']]); c.fillRect(0, 0, w, h)
      let x = 0
      while (x < w) {
        const bw = 20 + r() * 40, bh = h * (0.3 + r() * 0.55)
        c.fillStyle = '#0b0d16'; c.fillRect(x, h - bh, bw, bh)
        for (let yy = h - bh + 6; yy < h - 6; yy += 9) for (let xx = x + 4; xx < x + bw - 4; xx += 7) if (r() > 0.55) { c.fillStyle = pick(r, ['#ffd27a', '#ffeebc', '#7ad6ff']); c.fillRect(xx, yy, 3, 4) }
        x += bw + 2
      }
    },
  },
  { // food table
    aspect: 4 / 3, draw: (c, w, h, r) => {
      c.fillStyle = lin(c, 0, 0, w, h, [[0, '#6b3e22'], [1, '#3a1f10']]); c.fillRect(0, 0, w, h)
      for (let i = 0; i < 5; i++) {
        const x = w * (0.15 + r() * 0.7), y = h * (0.2 + r() * 0.6), s = w * (0.1 + r() * 0.08)
        ellipse(c, x, y, s, s * 0.8, 0, '#f4efe6')
        for (let k = 0; k < 6; k++) ellipse(c, x + (r() - 0.5) * s, y + (r() - 0.5) * s * 0.6, s * 0.25, s * 0.18, r(), pick(r, ['#e2502a', '#7fbf3a', '#f2c230', '#9a2b2b', '#f08a4b']))
      }
      ellipse(c, w * 0.85, h * 0.2, w * 0.06, w * 0.06, 0, 'rgba(255,200,90,0.8)')
    },
  },
  { // friends flash photo
    aspect: 3 / 2, draw: (c, w, h, r) => {
      c.fillStyle = '#3b2a2a'; c.fillRect(0, 0, w, h)
      blob(c, w / 2, h * 0.45, w * 0.6, 'rgba(255,230,200,0.55)')
      for (let i = 0; i < 4; i++) figure(c, w * (0.2 + i * 0.2), h * (0.38 + r() * 0.08), h * 0.4, pick(r, ['#1d1a24', '#2b1f1a', '#3a2d4f', '#5a2a2a']))
      for (let i = 0; i < 4; i++) ellipse(c, w * (0.2 + i * 0.2), h * (0.38 + 0.0), h * 0.07, h * 0.08, 0, pick(r, ['#c98d6f', '#8a5a40', '#e2b08f']))
    },
  },
  { // y2k checker
    aspect: 1, draw: (c, w, h, r) => {
      const n = 8, s = w / n
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { c.fillStyle = (x + y) % 2 ? '#ff7ad9' : '#c6ff4a'; c.fillRect(x * s, y * s, s, s) }
      c.fillStyle = '#fff'
      for (let i = 0; i < 6; i++) {
        const x = r() * w, y = r() * h, s2 = 6 + r() * 14
        c.beginPath(); c.moveTo(x, y - s2); c.lineTo(x + s2 * 0.25, y); c.lineTo(x, y + s2); c.lineTo(x - s2 * 0.25, y); c.fill()
        c.beginPath(); c.moveTo(x - s2, y); c.lineTo(x, y + s2 * 0.25); c.lineTo(x + s2, y); c.lineTo(x, y - s2 * 0.25); c.fill()
      }
    },
  },
  { // magazine type
    aspect: 2 / 3, draw: (c, w, h, r) => {
      c.fillStyle = '#f7f3ea'; c.fillRect(0, 0, w, h)
      c.fillStyle = '#e3195a'; c.font = `900 ${h * 0.2}px Inter, sans-serif`; c.textBaseline = 'top'
      c.fillText(pick(r, ['MOOD', 'LOVE', 'SOFT', 'GLOW']), 10, 14)
      c.fillStyle = lin(c, 0, h * 0.3, 0, h * 0.75, [[0, '#2c7a3f'], [1, '#0f2e19']]); c.fillRect(10, h * 0.32, w - 20, h * 0.42)
      figure(c, w / 2, h * 0.43, h * 0.28, '#0b0b0b')
      c.fillStyle = '#222'
      for (let i = 0; i < 8; i++) c.fillRect(10, h * (0.78 + i * 0.025), (w - 20) * (0.5 + r() * 0.5), 2)
    },
  },
  { // flower field
    aspect: 3 / 2, draw: (c, w, h, r) => {
      c.fillStyle = lin(c, 0, 0, 0, h, [[0, '#9fd6ff'], [0.45, '#e6f6ff'], [0.46, '#4f9a37'], [1, '#2d6b1f']]); c.fillRect(0, 0, w, h)
      for (let i = 0; i < 140; i++) { const y = h * 0.47 + r() * h * 0.53; ellipse(c, r() * w, y, 1.5 + (y / h) * 4, 1.5 + (y / h) * 4, 0, pick(r, ['#ffe14a', '#ffffff', '#ff4d6a', '#c38bff'])) }
    },
  },
  { // neon sign
    aspect: 1, draw: (c, w, h, r) => {
      c.fillStyle = '#2a1414'; c.fillRect(0, 0, w, h)
      c.fillStyle = 'rgba(0,0,0,0.25)'
      for (let y = 0; y < h; y += 14) for (let x = (y / 14) % 2 ? 0 : 14; x < w; x += 28) c.fillRect(x, y, 26, 12)
      c.shadowColor = '#ff3df2'; c.shadowBlur = 18; c.strokeStyle = '#ffc6f7'; c.lineWidth = 5
      c.beginPath()
      const cx = w / 2, cy = h / 2, s = w * 0.28
      c.moveTo(cx, cy + s * 0.9)
      c.bezierCurveTo(cx - s * 1.6, cy - s * 0.2, cx - s * 0.6, cy - s * 1.3, cx, cy - s * 0.4)
      c.bezierCurveTo(cx + s * 0.6, cy - s * 1.3, cx + s * 1.6, cy - s * 0.2, cx, cy + s * 0.9)
      c.stroke(); c.stroke()
      c.shadowBlur = 0
    },
  },
  { // ocean waves
    aspect: 3 / 2, draw: (c, w, h, r) => {
      c.fillStyle = lin(c, 0, 0, 0, h, [[0, '#0d4f8b'], [1, '#062844']]); c.fillRect(0, 0, w, h)
      c.strokeStyle = 'rgba(230,248,255,0.7)'; c.lineWidth = 2
      for (let i = 0; i < 14; i++) {
        const y = (i / 14) * h + 6, a = 4 + r() * 6, f = 0.03 + r() * 0.03
        c.beginPath(); for (let x = 0; x <= w; x += 4) c.lineTo(x, y + Math.sin(x * f + i) * a); c.stroke()
      }
    },
  },
  { // sticker collage
    aspect: 2 / 3, draw: (c, w, h, r) => {
      c.fillStyle = '#ffd6e8'; c.fillRect(0, 0, w, h)
      for (let i = 0; i < 12; i++) {
        const x = r() * w, y = r() * h, s = 14 + r() * 24
        c.fillStyle = pick(r, ['#ff4fa3', '#4fd1ff', '#ffe14a', '#8a5bff', '#59e08a'])
        if (r() > 0.5) { c.beginPath(); for (let k = 0; k < 10; k++) { const a = k * Math.PI / 5, rr = k % 2 ? s * 0.45 : s; c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr) } c.fill() }
        else { ellipse(c, x, y, s, s, 0, c.fillStyle as string); c.fillStyle = '#222'; ellipse(c, x - s * 0.3, y - s * 0.2, 2.5, 3.5, 0, '#222'); ellipse(c, x + s * 0.3, y - s * 0.2, 2.5, 3.5, 0, '#222'); c.strokeStyle = '#222'; c.lineWidth = 2; c.beginPath(); c.arc(x, y + s * 0.05, s * 0.45, 0.3, Math.PI - 0.3); c.stroke() }
      }
    },
  },
  { // halftone portrait
    aspect: 2 / 3, draw: (c, w, h, r) => {
      c.fillStyle = '#fff4f0'; c.fillRect(0, 0, w, h)
      c.fillStyle = '#e0178b'
      const st = 7
      for (let y = 0; y < h; y += st) for (let x = 0; x < w; x += st) {
        const dx = (x - w / 2) / (w * 0.32), dy = (y - h * 0.38) / (h * 0.24)
        const head = Math.max(0, 1 - Math.hypot(dx, dy))
        const body = y > h * 0.62 ? Math.max(0, 1 - Math.abs(x - w / 2) / (w * 0.45 + (y - h * 0.62) * 0.6)) * 0.8 : 0
        const v = Math.max(head * 0.8, body)
        if (v > 0.02) { c.beginPath(); c.arc(x, y, st * 0.5 * Math.sqrt(v), 0, TAU); c.fill() }
      }
    },
  },
  { // red room
    aspect: 2 / 3, draw: (c, w, h, r) => {
      c.fillStyle = '#3d0207'; c.fillRect(0, 0, w, h)
      c.globalCompositeOperation = 'lighter'
      blob(c, w * 0.55, h * 0.3, w * 0.7, 'rgba(255,30,40,0.6)')
      ellipse(c, w * 0.55, h * 0.3, 5, 5, 0, '#ffd0d0')
      c.globalCompositeOperation = 'source-over'
      for (let i = 0; i < 6; i++) figure(c, w * (0.08 + i * 0.18), h * 0.72, h * 0.22, 'rgba(20,0,2,0.9)')
    },
  },
  { // mirror selfie
    aspect: 3 / 4, draw: (c, w, h, r) => {
      c.fillStyle = lin(c, 0, 0, w, 0, [[0, '#2b2622'], [1, '#4d443b']]); c.fillRect(0, 0, w, h)
      c.strokeStyle = '#8c7a62'; c.lineWidth = 6; c.strokeRect(w * 0.12, h * 0.06, w * 0.76, h * 0.9)
      figure(c, w * 0.5, h * 0.3, h * 0.6, '#151215')
      blob(c, w * 0.6, h * 0.42, w * 0.25, 'rgba(255,255,240,0.9)')
      c.fillStyle = '#0c0c0c'; c.fillRect(w * 0.53, h * 0.36, w * 0.12, h * 0.13)
    },
  },
]

export const POSTER_NAMES = [
  'Foliage', 'Red flower', 'Night bokeh', 'Sunset sea', 'Portrait', 'Purple glitch', 'Chrome numeral', 'Bauhaus',
  'Retro window', 'Iridescent CD', 'Film strip', 'Beach snapshot', 'City night', 'Food table', 'Flash photo', 'Y2K checker',
  'Magazine', 'Flower field', 'Neon sign', 'Ocean waves', 'Sticker collage', 'Halftone portrait', 'Red room', 'Mirror selfie',
]

/** Draws poster `index` into a w × h user-space area (the context may carry a scale for hi-res). */
export function drawPoster(index: number, c: Ctx, w: number, h: number) {
  const p = POSTERS[index % POSTERS.length]
  const rnd = mulberry32(1000 + index * 7919)
  c.save()
  p.draw(c, w, h, rnd)
  c.restore()
  filmFinish(c, w, h, rnd, 0.9)
}
