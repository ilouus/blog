import { LANES, World } from './world';

/**
 * Sadə avtopilot: başlanğıc ekranındakı canlı fon üçün və
 * testlərdə oyunun həmişə qazanıla bilən olduğunu yoxlamaq üçün.
 */
export class Bot {
  targetLane: number;
  private cool = 0;
  private thankDelay = -1;
  private settleT = 0;
  private actT = 0;

  constructor(
    targetLane = LANES - 1,
    private readonly opts: { roam?: boolean; polite?: boolean; spam?: boolean; slow?: boolean } = {},
  ) {
    this.targetLane = targetLane;
  }

  step(w: World, dt: number): void {
    const p = w.player;
    this.cool -= dt;
    if (this.thankDelay >= 0) {
      this.thankDelay -= dt;
      if (this.thankDelay < 0 && p.thankWindow > 0) w.thank();
    }
    if (!w.canAct || p.changeT >= 0 || p.wobbleT > 0) return;
    // "Yavaş insan": saniyədə bir dəfə qərar verir və siqnaldan istifadə etmir.
    if (this.opts.slow) {
      this.actT -= dt;
      if (this.actT > 0) return;
      this.actT = 1;
    }

    if (this.opts.spam && this.cool <= 0) {
      w.honk();
      this.cool = 0.3;
    }

    if (p.lane === this.targetLane) {
      if (p.side !== 0) w.setSide(p.side);
      if (this.opts.roam) {
        this.settleT += dt;
        if (this.settleT > 7) {
          this.settleT = 0;
          const options = [0, 1, 2].filter((l) => l !== p.lane && Math.abs(l - p.lane) === 1);
          this.targetLane = options[Math.floor(w.rng.next() * options.length)];
        }
      }
      return;
    }
    const dir = this.targetLane > p.lane ? 1 : -1;
    if (p.side !== dir) {
      w.setSide(dir);
      return;
    }
    if (w.preview?.ok) {
      w.merge();
      if (this.opts.polite !== false) this.thankDelay = 0.6 + w.rng.next() * 0.6;
      return;
    }
    const nb = w.neighbor(dir);
    if (nb && this.cool <= 0) {
      if (nb.type === 'distracted' && nb.state === 'phone' && w.stress < 40 && !this.opts.slow) {
        w.honk();
        this.cool = 0.8;
      } else if (nb.state !== 'yield' && nb.pendingYield < 0) {
        w.wave();
        this.cool = 1.6;
      }
    }
  }
}
