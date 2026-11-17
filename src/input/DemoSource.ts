/**
 * Built-in moving source so every scene works without a camera: a stylised performer
 * (head-and-shoulders bust with dancing arms) under moving stage light, drawn with Canvas2D.
 */
export class DemoSource {
  readonly canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private grain: HTMLCanvasElement
  readonly width = 720
  readonly height = 1280

  constructor() {
    this.canvas = document.createElement('canvas')
    this.canvas.width = this.width
    this.canvas.height = this.height
    this.ctx = this.canvas.getContext('2d')!
    this.grain = document.createElement('canvas')
    this.grain.width = this.grain.height = 256
    const g = this.grain.getContext('2d')!
    const img = g.createImageData(256, 256)
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 255
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v
      img.data[i + 3] = 22
    }
    g.putImageData(img, 0, 0)
  }

  draw(t: number) {
    const c = this.ctx, W = this.width, H = this.height
    // backdrop: teal-grey studio sweep with moving light bars
    const bg = c.createLinearGradient(0, 0, 0, H)
    bg.addColorStop(0, '#5f7d7b')
    bg.addColorStop(0.55, '#a9bcb6')
    bg.addColorStop(1, '#43524f')
    c.fillStyle = bg
    c.fillRect(0, 0, W, H)
    c.save()
    c.globalCompositeOperation = 'screen'
    for (let i = 0; i < 3; i++) {
      const x = W * (0.5 + 0.45 * Math.sin(t * (0.23 + i * 0.11) + i * 2.1))
      const lg = c.createLinearGradient(x - 120, 0, x + 120, 0)
      lg.addColorStop(0, 'rgba(255,240,220,0)')
      lg.addColorStop(0.5, `rgba(255,${200 + i * 20},${180 + i * 25},0.22)`)
      lg.addColorStop(1, 'rgba(255,240,220,0)')
      c.fillStyle = lg
      c.fillRect(x - 120, 0, 240, H)
    }
    c.restore()

    const sway = Math.sin(t * 0.9) * 22
    const bob = Math.sin(t * 1.8) * 8
    const cx = W / 2 + sway
    const headY = H * 0.36 + bob
    const tilt = Math.sin(t * 0.7) * 0.12 + Math.sin(t * 1.9) * 0.04
    const shoulderY = H * 0.56 + bob * 0.6

    // arms behind torso edges
    const arm = (side: number, phase: number) => {
      const sx = cx + side * 150
      const sy = shoulderY + 30
      const a1 = -Math.PI / 2 + side * (0.9 + 0.75 * Math.sin(t * 1.6 + phase))
      const elbow = { x: sx + Math.cos(a1) * 210, y: sy + Math.sin(a1) * 210 }
      const a2 = a1 - side * (0.6 + 0.9 * (0.5 + 0.5 * Math.sin(t * 2.3 + phase + 1)))
      const hand = { x: elbow.x + Math.cos(a2) * 180, y: elbow.y + Math.sin(a2) * 180 }
      c.lineCap = 'round'
      c.strokeStyle = '#2b3335'
      c.lineWidth = 74
      c.beginPath(); c.moveTo(sx, sy); c.lineTo(elbow.x, elbow.y); c.stroke()
      const skin = c.createLinearGradient(elbow.x, elbow.y, hand.x, hand.y)
      skin.addColorStop(0, '#c98d6f'); skin.addColorStop(1, '#e8b69a')
      c.strokeStyle = skin
      c.lineWidth = 52
      c.beginPath(); c.moveTo(elbow.x, elbow.y); c.lineTo(hand.x, hand.y); c.stroke()
      c.fillStyle = '#efc2a6'
      c.beginPath(); c.ellipse(hand.x, hand.y, 36, 44, a2 + Math.PI / 2, 0, Math.PI * 2); c.fill()
    }
    arm(-1, 0)
    arm(1, 2.4)

    // torso with patterned top
    c.save()
    c.translate(cx, shoulderY)
    const torso = new Path2D()
    torso.moveTo(-175, 20)
    torso.quadraticCurveTo(-190, -30, -90, -48)
    torso.lineTo(90, -48)
    torso.quadraticCurveTo(190, -30, 175, 20)
    torso.lineTo(215, H)
    torso.lineTo(-215, H)
    torso.closePath()
    const tg = c.createLinearGradient(-200, 0, 200, 0)
    tg.addColorStop(0, '#1f2a2c'); tg.addColorStop(0.5, '#38514f'); tg.addColorStop(1, '#1a2224')
    c.fillStyle = tg
    c.fill(torso)
    c.clip(torso)
    c.globalAlpha = 0.35
    c.strokeStyle = '#c9603f'
    c.lineWidth = 6
    for (let i = -8; i < 14; i++) {
      c.beginPath()
      for (let x = -220; x <= 220; x += 20) {
        const y = i * 48 + Math.sin(x * 0.03 + i + t) * 14
        if (x === -220) c.moveTo(x, y); else c.lineTo(x, y)
      }
      c.stroke()
    }
    c.restore()

    // neck
    const ng = c.createLinearGradient(cx - 50, 0, cx + 50, 0)
    ng.addColorStop(0, '#a8705a'); ng.addColorStop(0.5, '#d9a083'); ng.addColorStop(1, '#9a654f')
    c.fillStyle = ng
    c.beginPath()
    c.moveTo(cx - 52, headY + 120); c.lineTo(cx + 52, headY + 120); c.lineTo(cx + 62, shoulderY - 40); c.lineTo(cx - 62, shoulderY - 40)
    c.fill()

    // head
    c.save()
    c.translate(cx, headY)
    c.rotate(tilt)
    const hg = c.createRadialGradient(-40, -40, 20, 0, 0, 190)
    hg.addColorStop(0, '#f3c9ad'); hg.addColorStop(0.6, '#d69a7c'); hg.addColorStop(1, '#8e5a45')
    c.fillStyle = hg
    c.beginPath(); c.ellipse(0, 0, 118, 158, 0, 0, Math.PI * 2); c.fill()
    // ears
    c.fillStyle = '#c4876a'
    c.beginPath(); c.ellipse(-118, 10, 20, 34, 0, 0, Math.PI * 2); c.fill()
    c.beginPath(); c.ellipse(118, 10, 20, 34, 0, 0, Math.PI * 2); c.fill()
    // short hair cap
    c.fillStyle = '#3a2b26'
    c.beginPath(); c.ellipse(0, -70, 122, 98, 0, Math.PI, Math.PI * 2); c.fill()
    c.beginPath(); c.ellipse(0, -72, 122, 40, 0, 0, Math.PI); c.fill()
    // cheeks
    c.fillStyle = 'rgba(214,90,90,0.28)'
    c.beginPath(); c.ellipse(-62, 48, 30, 20, 0, 0, Math.PI * 2); c.fill()
    c.beginPath(); c.ellipse(62, 48, 30, 20, 0, 0, Math.PI * 2); c.fill()
    // eyes (blink)
    const blink = (Math.sin(t * 0.8) > 0.985) ? 0.15 : 1
    for (const s of [-1, 1]) {
      c.fillStyle = '#f6efe9'
      c.beginPath(); c.ellipse(s * 46, 4, 26, 13 * blink, 0, 0, Math.PI * 2); c.fill()
      c.fillStyle = '#2d1f1a'
      c.beginPath(); c.ellipse(s * 46 + Math.sin(t * 0.5) * 6, 4, 11, 11 * blink, 0, 0, Math.PI * 2); c.fill()
      c.strokeStyle = '#3a2b26'; c.lineWidth = 6; c.lineCap = 'round'
      c.beginPath(); c.moveTo(s * 22, -26); c.quadraticCurveTo(s * 48, -38 - Math.sin(t) * 3, s * 74, -26); c.stroke()
    }
    // nose
    c.strokeStyle = 'rgba(120,70,55,0.7)'; c.lineWidth = 5
    c.beginPath(); c.moveTo(4, 12); c.quadraticCurveTo(14, 56, -6, 64); c.stroke()
    // lips (talk / sing)
    const open = 4 + 10 * Math.max(0, Math.sin(t * 3.1) * Math.sin(t * 1.3))
    c.fillStyle = '#b8484c'
    c.beginPath(); c.ellipse(0, 98, 34, 9 + open * 0.4, 0, 0, Math.PI * 2); c.fill()
    c.fillStyle = '#4a1e22'
    c.beginPath(); c.ellipse(0, 98, 24, open * 0.45, 0, 0, Math.PI * 2); c.fill()
    // freckles / tattoo-like marks for texture
    c.fillStyle = 'rgba(120,60,40,0.35)'
    for (let i = 0; i < 26; i++) {
      const a = i * 2.39996, r = 30 + (i % 7) * 9
      c.beginPath(); c.arc(Math.cos(a) * r * 1.2, 30 + Math.sin(a) * r * 0.5, 2.2, 0, Math.PI * 2); c.fill()
    }
    c.restore()

    // rim light + vignette
    const rim = c.createRadialGradient(W * 0.8, H * 0.2, 50, W * 0.8, H * 0.2, H * 0.8)
    rim.addColorStop(0, 'rgba(255,230,200,0.18)'); rim.addColorStop(1, 'rgba(0,0,0,0)')
    c.fillStyle = rim
    c.fillRect(0, 0, W, H)
    const vig = c.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.75)
    vig.addColorStop(0, 'rgba(0,0,0,0)'); vig.addColorStop(1, 'rgba(0,0,0,0.45)')
    c.fillStyle = vig
    c.fillRect(0, 0, W, H)
    c.drawImage(this.grain, (t * 997) % 256 - 256, (t * 613) % 256 - 256, W + 512, H + 512)
  }
}
