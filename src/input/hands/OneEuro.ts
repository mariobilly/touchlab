// One Euro filter (Casiez et al. 2012): smooths jitter at rest while staying responsive when moving.
export class OneEuro {
  private x = 0
  private dx = 0
  private init = false
  constructor(public minCutoff = 1.0, public beta = 0.02, public dCutoff = 1.0) {}
  private static alpha(cutoff: number, dt: number) {
    const tau = 1 / (2 * Math.PI * cutoff)
    return 1 / (1 + tau / dt)
  }
  reset() { this.init = false }
  filter(v: number, dt: number): number {
    if (!this.init || dt <= 0) {
      this.x = v
      this.dx = 0
      this.init = true
      return v
    }
    const d = (v - this.x) / dt
    this.dx += OneEuro.alpha(this.dCutoff, dt) * (d - this.dx)
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx)
    this.x += OneEuro.alpha(cutoff, dt) * (v - this.x)
    return this.x
  }
}
