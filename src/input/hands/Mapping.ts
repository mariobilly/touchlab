/**
 * Maps a point from camera-image space (MediaPipe: x 0..1 left→right of the UNMIRRORED frame,
 * y 0..1 top→bottom) into output space (x 0..1 left→right, y 0..1 top→bottom).
 *
 * 'video' uses the same cover transform as the renderer, so a fingertip sits exactly on the
 * displayed hand. 'frame' stretches the whole camera frame over the output, so gestures reach
 * every corner even when a 16:9 camera is cropped into a 9:16 output.
 */
export interface UvXform { sx: number; sy: number; ox: number; oy: number }

export function mapPoint(x: number, y: number, mode: 'video' | 'frame', mirror: boolean, xf: UvXform): [number, number] {
  if (mode === 'frame') return [mirror ? 1 - x : x, y]
  // GL uv of the source texel (y up)
  const u = x
  const v = 1 - y
  const ou = (u - xf.ox) / xf.sx
  const ov = (v - xf.oy) / xf.sy
  return [ou, 1 - ov]
}

/** Cover transform for a source of aspect `sa` shown in an output of aspect `oa`, with zoom ≥ 1 and pan −1..1. */
export function coverXform(sa: number, oa: number, mirror: boolean, zoom = 1, panX = 0, panY = 0): UvXform {
  let w = 1, h = 1
  if (sa > oa) w = oa / sa
  else h = sa / oa
  w /= Math.max(1, zoom)
  h /= Math.max(1, zoom)
  const cx = 0.5 + panX * (1 - w) / 2
  const cy = 0.5 - panY * (1 - h) / 2
  const ox = cx - w / 2
  const oy = cy - h / 2
  return mirror ? { sx: -w, sy: h, ox: ox + w, oy } : { sx: w, sy: h, ox, oy }
}
