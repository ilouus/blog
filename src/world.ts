import { Rng } from './rng';

// ---------------------------------------------------------------------------
// Sabitlər (metr və saniyə ilə)
// ---------------------------------------------------------------------------
export const LANE_W = 3.4;
export const LANES = 3;
export const ROAD_W = LANE_W * LANES;
export const EXIT_S = 300;
export const TIME_LIMIT = 90;
export const CAR_W = 1.8;
export const CHANGE_DUR = 0.9;
export const THANK_WINDOW = 2;
const WOBBLE_DUR = 0.5;

/** Trafik ritmi: headless testlə tənzimlənib (bot ~60 s-də qazanır). */
export const TUNE = { a: 0.95, b: 0.5, lagMin: 0.8, lagMax: 1.4, vmul: 1.25, acc: 2.2 };
export const laneCenter = (l: number): number => (l + 0.5) * LANE_W;
const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
const ease = (k: number): number => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);

export const PHRASES = {
  ask: 'Qardaş, burax da!',
  turnHere: 'Dönəcəyim yer elə buradır.',
  oneCar: 'Bir maşın burax, nə olacaq?',
  thanks: 'Sağ ol, var ol!',
  where: 'Hara girirsən?',
  rush: 'Hamı tələsir də.',
  noFit: 'Sığmır, qardaş!',
  noThanks: 'Heç sağ ol da demə!',
  relent: 'Yaxşı, keç də...',
} as const;

export type DriverType = 'polite' | 'stubborn' | 'distracted';
export type NpcState = 'drive' | 'yield' | 'block' | 'phone' | 'alert';
export type CarStyle = 'sedan' | 'hatch' | 'boxy' | 'taxi' | 'van' | 'bus';
export type Outcome = 'won' | 'missed' | 'timeout';
export type Status = 'running' | 'turning' | Outcome;
export type WorldEvent =
  | 'side'
  | 'honk'
  | 'wave'
  | 'ignored'
  | 'yield'
  | 'merge-start'
  | 'merge'
  | 'fail'
  | 'thanks'
  | 'hazard'
  | 'noside'
  | 'turning'
  | Outcome;

export interface Body {
  s: number; // yol boyunca mərkəzin mövqeyi
  v: number;
  len: number;
}

export interface Npc extends Body {
  id: number;
  lane: number;
  style: CarStyle;
  color: string;
  type: DriverType;
  state: NpcState;
  timer: number;
  blockAge: number;
  vFactor: number;
  lagT: number;
  lagNeed: number;
  pendingYield: number; // < 0: yoxdur
  blockCooldown: number;
  wavedAt: number;
  braking: boolean;
  flashT: number;
  exitTurn: boolean;
  turnP: number; // < 0: dönmür
  turnS0: number;
  x: number;
  angle: number;
  dead: boolean;
}

export interface Player extends Body {
  lane: number;
  fromLane: number;
  toLane: number;
  x: number;
  angle: number;
  changeT: number; // < 0: zolaq dəyişmir
  shiftTotal: number;
  shiftDone: number;
  side: -1 | 0 | 1;
  wobbleT: number;
  wobbleDir: number;
  hazardT: number;
  honkT: number;
  waveT: number;
  thankWindow: number;
  lastYielder: Npc | null;
  turnP: number;
  turnS0: number;
  braking: boolean;
}

export interface Bubble {
  text: string;
  owner: Npc | null; // null = oyunçu
  age: number;
  dur: number;
}

export interface Tip {
  text: string;
  owner: Npc | null;
  age: number;
  dur: number;
}

export interface MergePreview {
  lane: number;
  s: number;
  ok: boolean;
  shift: number;
}

interface LaneWave {
  vmax: number;
  k: number;
  c: number;
  ph: number;
  ph2: number;
}

const COLORS = [
  '#f2f2ee',
  '#f2f2ee',
  '#e9eaea',
  '#1d2025',
  '#1d2025',
  '#b7bcc3',
  '#aeb4bb',
  '#2c3a52',
  '#474c55',
  '#2e493d',
  '#5a2631',
];
const TAXI_COLOR = '#4b2c6f';

const STYLE_LEN: Record<CarStyle, number> = {
  sedan: 4.5,
  hatch: 4.0,
  boxy: 4.1,
  taxi: 4.6,
  van: 5.3,
  bus: 11,
};

export interface Stats {
  merges: number;
  thanks: number;
  honks: number;
  waves: number;
  failed: number;
}

export class World {
  readonly rng: Rng;
  readonly mode: 'play' | 'demo';
  readonly exitS: number;
  readonly seed: number;
  t = 0;
  timeLeft = TIME_LIMIT;
  status: Status = 'running';
  stress = 0;
  score = 0;
  stats: Stats = { merges: 0, thanks: 0, honks: 0, waves: 0, failed: 0 };
  npcs: Npc[] = [];
  player: Player;
  bubbles: Bubble[] = [];
  tips: Tip[] = [];
  events: WorldEvent[] = [];
  preview: MergePreview | null = null;
  viewAhead = 30;
  viewBehind = 14;

  private lastHonkT = -99;
  private waves: LaneWave[];
  private mix: { polite: number; stubborn: number };
  private laneBodies: Body[][] = [[], [], []];
  private phraseT = new Map<string, number>();
  private nextId = 1;
  private chatT: number;
  private stoppedT = 0;

  constructor(seed: number, mode: 'play' | 'demo') {
    this.seed = seed;
    this.rng = new Rng(seed);
    this.mode = mode;
    this.exitS = mode === 'play' ? EXIT_S : Number.POSITIVE_INFINITY;
    const r = this.rng;

    // Hər raundda yolun "ritmi" və sürücü qarışığı fərqlidir.
    const baseV = [8.2, 7.2, 6.3];
    this.waves = baseV.map((v) => ({
      vmax: (v + r.range(-0.6, 0.6)) * TUNE.vmul,
      k: (Math.PI * 2) / r.range(85, 135),
      c: r.range(2.6, 4.2),
      ph: r.range(0, Math.PI * 2),
      ph2: r.range(0, Math.PI * 2),
    }));
    const polite = r.range(0.36, 0.52);
    this.mix = { polite, stubborn: r.range(0.22, 0.32) };
    this.chatT = r.range(8, 12);

    this.player = {
      s: 0,
      v: 0,
      len: 4.3,
      lane: 0,
      fromLane: 0,
      toLane: 0,
      x: laneCenter(0),
      angle: 0,
      changeT: -1,
      shiftTotal: 0,
      shiftDone: 0,
      side: 0,
      wobbleT: 0,
      wobbleDir: 0,
      hazardT: 0,
      honkT: 0,
      waveT: 0,
      thankWindow: 0,
      lastYielder: null,
      turnP: -1,
      turnS0: 0,
      braking: true,
    };
    this.maintainTraffic(true);
  }

  // -------------------------------------------------------------------------
  // İctimai əməliyyatlar (düymələr)
  // -------------------------------------------------------------------------
  get canAct(): boolean {
    return this.status === 'running';
  }

  setSide(dir: -1 | 1): void {
    if (!this.canAct) return;
    const p = this.player;
    if (p.side === dir) {
      p.side = 0;
      this.events.push('side');
      return;
    }
    const lane = p.lane + dir;
    if (lane < 0 || lane >= LANES) {
      this.tip(null, dir < 0 ? 'Solda səki var!' : 'Sağda səki var!');
      this.events.push('noside');
      return;
    }
    p.side = dir;
    this.events.push('side');
  }

  honk(): void {
    if (!this.canAct) return;
    const p = this.player;
    p.honkT = 0.35;
    this.stats.honks++;
    const quick = this.t - this.lastHonkT < 1.5;
    this.stress = Math.min(100, this.stress + (quick ? 24 : 12));
    this.lastHonkT = this.t;
    this.events.push('honk');

    let annoyedPolite: Npc | null = null;
    for (const c of this.npcs) {
      if (c.turnP >= 0) continue;
      const ds = c.s - p.s;
      const dl = c.lane - p.lane;
      let hit = false;
      if (dl === 0 && ds > 0 && ds < 13) hit = true;
      else if (p.side !== 0 && dl === p.side && Math.abs(ds) < 10) hit = true;
      else if (p.side === 0 && Math.abs(dl) === 1 && Math.abs(ds) < 6) hit = true;
      if (!hit) continue;
      if (c.type === 'distracted' && c.state === 'phone') {
        c.state = 'alert';
        c.timer = 6;
        c.lagT = 99;
        this.tip(c, '!');
        if (this.t - c.wavedAt < 5) c.pendingYield = 0.5;
      } else if (c.type === 'stubborn' && c.state === 'block') {
        c.timer += 0.4;
      } else if (c.type === 'polite' && c.state !== 'yield') {
        annoyedPolite = c;
      }
    }
    if (this.stress > 55 && quick && annoyedPolite) this.say(annoyedPolite, PHRASES.rush);
  }

  wave(): void {
    if (!this.canAct) return;
    const p = this.player;
    p.waveT = 0.9;
    this.stats.waves++;
    if (p.side === 0) {
      this.tip(null, 'Əvvəl istiqamət seç');
      this.events.push('noside');
      return;
    }
    this.events.push('wave');
    const nearExit = this.exitS - p.s < 90 && p.lane !== LANES - 1;
    const order = nearExit
      ? [PHRASES.turnHere, PHRASES.ask, PHRASES.oneCar]
      : this.rng.chance(0.6)
        ? [PHRASES.ask, PHRASES.oneCar]
        : [PHRASES.oneCar, PHRASES.ask];
    for (const text of order) if (this.say(null, text)) break;

    const c = this.neighbor(p.side);
    if (!c) return;
    c.wavedAt = this.t;
    if (c.state === 'yield' || c.pendingYield >= 0) return;
    switch (c.type) {
      case 'polite': {
        let delay = 0.35;
        if (this.stress > 50) {
          delay += 1.2;
          this.say(c, PHRASES.rush);
        }
        if (this.stress > 75) delay += 1.5;
        c.pendingYield = delay;
        break;
      }
      case 'stubborn':
        if (c.state === 'block') {
          c.timer -= 1.1;
          this.tip(c, 'Hmm...');
        } else if (c.blockCooldown > 0) {
          c.pendingYield = 0.5;
        } else {
          this.startBlock(c);
        }
        break;
      case 'distracted':
        if (c.state === 'phone') {
          this.tip(c, 'Telefondadır...');
          this.events.push('ignored');
        } else {
          c.pendingYield = 0.3;
        }
        break;
    }
  }

  merge(): void {
    if (!this.canAct) return;
    const p = this.player;
    if (p.changeT >= 0 || p.wobbleT > 0) return;
    if (p.side === 0) {
      this.tip(null, 'Əvvəl istiqamət seç');
      this.events.push('noside');
      return;
    }
    const lane = p.lane + p.side;
    if (lane < 0 || lane >= LANES) return;
    const pv = this.checkMerge(lane);
    if (pv.ok) {
      p.fromLane = p.lane;
      p.toLane = lane;
      p.changeT = 0;
      p.shiftTotal = pv.shift;
      p.shiftDone = 0;
      this.events.push('merge-start');
      return;
    }
    p.wobbleT = WOBBLE_DUR;
    p.wobbleDir = p.side;
    this.stats.failed++;
    this.stress = Math.min(100, this.stress + 5);
    this.say(null, PHRASES.noFit, true);
    this.events.push('fail');
    const nb = this.neighbor(p.side);
    if (nb && this.rng.chance(0.5)) this.say(nb, PHRASES.where);
  }

  thank(): void {
    if (!this.canAct && this.status !== 'turning') return;
    const p = this.player;
    if (p.thankWindow > 0) {
      p.thankWindow = 0;
      p.hazardT = 1.6;
      this.stats.thanks++;
      this.score += 50;
      this.say(null, PHRASES.thanks, true);
      if (p.lastYielder && !p.lastYielder.dead) this.tip(p.lastYielder, 'Dəyməz!');
      this.events.push('thanks');
    } else {
      p.hazardT = 1.2;
      this.events.push('hazard');
    }
  }

  /** Seçilmiş tərəfdə "yol verəcək" qonşu sürücü. */
  neighbor(dir: number): Npc | null {
    const p = this.player;
    const lane = p.lane + dir;
    if (dir === 0 || lane < 0 || lane >= LANES) return null;
    let best: Npc | null = null;
    let bestD = Infinity;
    for (const c of this.npcs) {
      if (c.lane !== lane || c.turnP >= 0) continue;
      if (c.s < p.s - 8 || c.s > p.s + 3) continue;
      const d = Math.abs(c.s - (p.s - 2.2));
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  /** Hədəf zolaqda təhlükəsiz boşluq varmı? */
  checkMerge(lane: number): MergePreview {
    const p = this.player;
    let maxFwd = 3;
    const ownLead = this.leaderIn(p, p.lane);
    if (ownLead) maxFwd = Math.min(maxFwd, ownLead.s - ownLead.len / 2 - (p.s + p.len / 2) - 0.7);
    const cars = this.npcs.filter((c) => c.lane === lane && c.turnP < 0.3);
    for (let d = 0; d <= maxFwd + 1e-6; d += 0.25) {
      const ps = p.s + d;
      const front = ps + p.len / 2;
      const rear = ps - p.len / 2;
      let ok = true;
      for (const c of cars) {
        if (c.s >= ps) {
          const gap = c.s - c.len / 2 - front;
          if (gap < 0.8 + Math.max(0, p.v - c.v) * 0.6) {
            ok = false;
            break;
          }
        } else {
          const gap = rear - (c.s + c.len / 2);
          if (gap < 0.9 + c.v * 0.45 + (c.v * c.v) / 10) {
            ok = false;
            break;
          }
        }
      }
      if (ok) return { lane, s: ps, ok: true, shift: d };
    }
    return { lane, s: p.s, ok: false, shift: 0 };
  }

  laneSpeed(l: number, s: number): number {
    const w = this.waves[l];
    const ph = w.k * (s + w.c * this.t) + w.ph;
    const f = TUNE.a + TUNE.b * Math.sin(ph) + 0.12 * Math.sin(2.7 * ph + w.ph2);
    return w.vmax * clamp(f, 0, 1);
  }

  get distanceLeft(): number {
    return Math.max(0, this.exitS - this.player.s);
  }

  get elapsed(): number {
    return TIME_LIMIT - this.timeLeft;
  }

  // -------------------------------------------------------------------------
  // Simulyasiya addımı
  // -------------------------------------------------------------------------
  update(dt: number): void {
    this.t += dt;
    const p = this.player;
    if (this.status === 'running' && this.mode === 'play') {
      this.timeLeft = Math.max(0, this.timeLeft - dt);
    }
    if (this.t - this.lastHonkT > 1.2) this.stress = Math.max(0, this.stress - 8 * dt);
    p.honkT -= dt;
    p.waveT -= dt;
    p.hazardT -= dt;

    this.rebuildLanes();
    this.updateNpcStates(dt);
    this.updateDynamics(dt);
    this.rebuildLanes();
    this.resolveOverlaps();
    this.updatePlayerLateral(dt);
    this.updateThankWindow(dt);
    this.checkOutcome();
    this.maintainTraffic(false);
    this.updateTexts(dt);
    this.ambient(dt);

    const target = p.lane + p.side;
    this.preview =
      p.side !== 0 && p.changeT < 0 && this.status === 'running' && target >= 0 && target < LANES
        ? this.checkMerge(target)
        : null;
  }

  private occupies(l: number): boolean {
    const p = this.player;
    if (p.turnP >= 0.3) return false;
    // Fiziki kəsişmə (kiçik ehtiyatla): maşın yan zolağa nə qədər girib?
    return Math.abs(p.x - laneCenter(l)) < CAR_W + 0.15;
  }

  private rebuildLanes(): void {
    for (let l = 0; l < LANES; l++) {
      const list: Body[] = [];
      for (const c of this.npcs) if (c.lane === l && c.turnP < 0.3) list.push(c);
      if (this.occupies(l)) list.push(this.player);
      list.sort((a, b) => b.s - a.s);
      this.laneBodies[l] = list;
    }
  }

  private leaderIn(b: Body, lane: number): Body | null {
    const list = this.laneBodies[lane];
    let lead: Body | null = null;
    for (const o of list) {
      if (o === b) continue;
      if (o.s > b.s && (!lead || o.s < lead.s)) lead = o;
    }
    return lead;
  }

  private isSignalTarget(c: Npc): boolean {
    const p = this.player;
    return (
      p.side !== 0 &&
      p.changeT < 0 &&
      this.status === 'running' &&
      c.lane === p.lane + p.side &&
      c.s > p.s - 8 &&
      c.s < p.s + 3
    );
  }

  private startBlock(c: Npc): void {
    c.state = 'block';
    c.blockAge = 0;
    c.timer = 3 + this.stress / 35 + this.rng.range(0, 1);
    this.say(c, PHRASES.where);
  }

  private startYield(c: Npc): void {
    c.state = 'yield';
    c.timer = clamp(5.5 - this.stress / 30, 2.5, 5.5);
    c.flashT = 0.9;
    this.tip(c, 'Buyur');
    this.events.push('yield');
  }

  private updateNpcStates(dt: number): void {
    const p = this.player;
    for (const c of this.npcs) {
      c.timer -= dt;
      c.blockCooldown -= dt;
      c.flashT -= dt;
      if (c.turnP >= 0) continue;
      const near = Math.abs(c.s - p.s) < 11 && Math.abs(c.lane - p.lane) === 1;
      if (c.pendingYield >= 0) {
        c.pendingYield -= dt;
        if (c.pendingYield < 0) {
          c.pendingYield = -1;
          if (near && this.status === 'running') this.startYield(c);
        }
      }
      switch (c.state) {
        case 'yield':
          if (c.timer <= 0 || !near || this.status !== 'running') {
            c.state = c.type === 'distracted' ? 'phone' : 'drive';
          }
          break;
        case 'block':
          if (!this.isSignalTarget(c)) {
            c.state = 'drive';
            c.blockCooldown = 2;
          } else if (c.timer <= 0 || (c.blockAge += dt) > 8) {
            // İnadkar da sonda yola gəlir — oyunçu çıxılmaz vəziyyətdə qalmır.
            this.startYield(c);
            c.blockCooldown = 18;
            this.say(c, PHRASES.relent, true);
          }
          break;
        case 'alert':
          if (c.timer <= 0) c.state = 'phone';
          break;
        case 'drive':
          if (c.type === 'stubborn' && c.blockCooldown <= 0 && this.isSignalTarget(c)) {
            this.startBlock(c);
          }
          break;
        case 'phone':
          break;
      }
    }
  }

  private updateDynamics(dt: number): void {
    const p = this.player;

    for (const c of this.npcs) {
      const v = c.v;
      // Çıxışa dönən maşınlar
      if (c.exitTurn && c.turnP < 0 && c.lane === LANES - 1 && c.s >= this.exitS - 2) {
        c.turnP = 0;
        c.turnS0 = c.s;
      }
      let desire = this.laneSpeed(c.lane, c.s) * c.vFactor;
      let s0 = 1.6;
      let T = 0.9;
      if (c.state === 'block') {
        desire = Math.max(desire, 3);
        s0 = 0.6;
        T = 0.35;
      }
      if (c.turnP >= 0.3) desire = 4.5;
      let nv: number;
      if (c.state === 'yield') nv = Math.max(0, v - 3 * dt);
      else nv = desire > v ? Math.min(desire, v + TUNE.acc * dt) : Math.max(desire, v - 3.5 * dt);

      if (c.turnP < 0.3) {
        const lead = this.leaderIn(c, c.lane);
        if (lead) {
          const gap = lead.s - lead.len / 2 - (c.s + c.len / 2);
          const vf = Math.max(0, (gap - s0) / T);
          if (vf < nv) nv = Math.max(vf, v - 9 * dt, 0);
        }
      }
      // Fikri yayınmış sürücü: tıxac açılanda gec tərpənir
      if (c.state === 'phone' && nv > v + 1e-4) {
        c.lagT += dt;
        if (c.lagT < c.lagNeed) nv = v;
      } else if (nv <= v) {
        c.lagT = 0;
      }
      c.braking = nv < v - 0.6 * dt || nv < 0.25;
      c.v = nv;
      if (c.turnP >= 0) {
        c.turnP = Math.min(1, c.turnP + (Math.max(nv, 0.4) * dt) / 9);
        const q = ease(c.turnP) * (Math.PI / 2);
        c.s = c.turnS0 + 5.5 * Math.sin(q);
        c.x = laneCenter(c.lane) + 9 * (1 - Math.cos(q));
        c.angle = q;
        if (c.turnP >= 1) c.dead = true;
      } else {
        c.s += ((v + nv) / 2) * dt;
      }
    }

    // Oyunçu
    const v = p.v;
    if (p.turnP >= 0) {
      p.v = Math.min(5, v + 2 * dt);
      const lead = p.turnP < 0.3 ? this.leaderIn(p, LANES - 1) : null;
      if (lead) {
        const gap = lead.s - lead.len / 2 - (p.s + p.len / 2);
        p.v = Math.min(p.v, Math.max(0, (gap - 1) / 0.8));
      }
      p.turnP = Math.min(1, p.turnP + (p.v * dt) / 9);
      const q = ease(p.turnP) * (Math.PI / 2);
      p.s = p.turnS0 + 5.5 * Math.sin(q);
      p.x = laneCenter(LANES - 1) + 9 * (1 - Math.cos(q));
      p.angle = q;
      p.braking = false;
      return;
    }
    const laneForSpeed = p.changeT >= 0.5 ? p.toLane : p.lane;
    let desire = this.waves[laneForSpeed].vmax * 0.95;
    if (p.changeT >= 0) desire = Math.min(desire, 3.2);
    // Dönüşə yaxın, amma sağda deyilsə: sürücü tərəddüd edir
    if (this.mode === 'play' && p.lane !== LANES - 1 && p.s > this.exitS - 60) desire = Math.min(desire, 2.2);
    let nv = desire > v ? Math.min(desire, v + TUNE.acc * 1.05 * dt) : Math.max(desire, v - 3.5 * dt);
    for (let l = 0; l < LANES; l++) {
      // Keçid başlayan kimi hədəf zolaqdakı qabaq maşını da nəzərə al.
      if (!this.occupies(l) && !(p.changeT >= 0 && l === p.toLane)) continue;
      const lead = this.leaderIn(p, l);
      if (!lead) continue;
      const gap = lead.s - lead.len / 2 - (p.s + p.len / 2);
      const vf = Math.max(0, (gap - 1.5) / 0.8);
      if (vf < nv) nv = Math.max(vf, v - 9 * dt, 0);
    }
    p.braking = nv < v - 0.6 * dt || nv < 0.25;
    p.v = nv;
    p.s += ((v + nv) / 2) * dt;
    if (p.changeT >= 0 && p.shiftDone < p.shiftTotal) {
      // İrəli sürüşmə keçidin ilk 40%-ində bitir — yan zolağa girməzdən əvvəl.
      const step = Math.min(p.shiftTotal - p.shiftDone, (p.shiftTotal * dt) / (CHANGE_DUR * 0.4));
      p.shiftDone += step;
      p.s += step;
    }
  }

  /** Heç bir maşın üst-üstə düşməsin (təhlükəsizlik toru). */
  private resolveOverlaps(): void {
    for (let pass = 0; pass < 2; pass++) {
      for (let l = 0; l < LANES; l++) {
        const list = this.laneBodies[l];
        list.sort((a, b) => b.s - a.s);
        for (let i = 1; i < list.length; i++) {
          const lead = list[i - 1];
          const b = list[i];
          const maxS = lead.s - lead.len / 2 - 0.25 - b.len / 2;
          if (b.s > maxS) {
            b.s = maxS;
            b.v = Math.min(b.v, lead.v);
          }
        }
      }
    }
  }

  private updatePlayerLateral(dt: number): void {
    const p = this.player;
    if (p.turnP >= 0) return;
    if (p.changeT >= 0) {
      p.changeT = Math.min(1, p.changeT + dt / CHANGE_DUR);
      const e = ease(p.changeT);
      p.x = laneCenter(p.fromLane) + (laneCenter(p.toLane) - laneCenter(p.fromLane)) * e;
      p.angle = Math.sin(p.changeT * Math.PI) * 0.2 * Math.sign(p.toLane - p.fromLane);
      if (p.changeT >= 1) this.completeMerge();
      return;
    }
    if (p.wobbleT > 0) {
      p.wobbleT = Math.max(0, p.wobbleT - dt);
      const k = 1 - p.wobbleT / WOBBLE_DUR;
      const off = Math.sin(k * Math.PI) * 0.5 * p.wobbleDir;
      p.x = laneCenter(p.lane) + off;
      p.angle = Math.sin(k * Math.PI * 2) * 0.09 * p.wobbleDir;
      return;
    }
    p.x = laneCenter(p.lane);
    p.angle = 0;
  }

  private completeMerge(): void {
    const p = this.player;
    p.lane = p.toLane;
    p.changeT = -1;
    p.x = laneCenter(p.lane);
    p.angle = 0;
    p.side = 0;
    this.stats.merges++;
    this.score += 100;
    // Arxada qalan maşın — bizə yol verən
    let follower: Npc | null = null;
    for (const c of this.npcs) {
      if (c.lane !== p.lane || c.turnP >= 0 || c.s >= p.s) continue;
      if (!follower || c.s > follower.s) follower = c;
    }
    if (follower && p.s - follower.s > 12) follower = null;
    if (follower && follower.state === 'yield') follower.state = follower.type === 'distracted' ? 'phone' : 'drive';
    p.lastYielder = follower;
    p.thankWindow = THANK_WINDOW;
    this.events.push('merge');
  }

  private updateThankWindow(dt: number): void {
    const p = this.player;
    if (p.thankWindow <= 0) return;
    p.thankWindow -= dt;
    if (p.thankWindow <= 0) {
      p.thankWindow = 0;
      const y = p.lastYielder;
      if (y && !y.dead && this.rng.chance(0.6)) this.say(y, PHRASES.noThanks, true);
    }
  }

  private checkOutcome(): void {
    if (this.mode !== 'play') return;
    const p = this.player;
    if (this.status === 'running') {
      if (p.lane === LANES - 1 && p.changeT < 0 && p.s >= this.exitS - 4) {
        this.status = 'turning';
        p.turnP = 0;
        p.turnS0 = p.s;
        p.side = 1;
        this.events.push('turning');
      } else if (p.s > this.exitS + 7 && !(p.changeT >= 0 && p.toLane === LANES - 1)) {
        this.finish('missed');
      } else if (this.timeLeft <= 0) {
        this.finish('timeout');
      }
    } else if (this.status === 'turning' && p.turnP >= 1) {
      this.finish('won');
    }
  }

  private finish(o: Outcome): void {
    this.status = o;
    this.player.side = 0;
    this.preview = null;
    if (o === 'won') this.score += 300 + Math.round(this.timeLeft) * 10;
    this.events.push(o);
  }

  // -------------------------------------------------------------------------
  // Trafik yaratmaq / silmək
  // -------------------------------------------------------------------------
  private makeNpc(lane: number): Npc {
    const r = this.rng;
    const x = r.next();
    let style: CarStyle;
    if (x < 0.035 && lane > 0) style = 'bus';
    else if (x < 0.1) style = 'van';
    else if (x < 0.18) style = 'taxi';
    else if (x < 0.36) style = 'boxy';
    else if (x < 0.6) style = 'hatch';
    else style = 'sedan';
    const tr = r.next();
    const type: DriverType =
      tr < this.mix.polite ? 'polite' : tr < this.mix.polite + this.mix.stubborn ? 'stubborn' : 'distracted';
    return {
      id: this.nextId++,
      lane,
      s: 0,
      v: 0,
      len: STYLE_LEN[style] + r.range(-0.15, 0.15),
      style,
      color: style === 'taxi' ? TAXI_COLOR : style === 'bus' ? '#eceeee' : r.pick(COLORS),
      type,
      state: type === 'distracted' ? 'phone' : 'drive',
      timer: 0,
      blockAge: 0,
      vFactor: r.range(0.9, 1.08),
      lagT: 0,
      lagNeed: r.range(TUNE.lagMin, TUNE.lagMax),
      pendingYield: -1,
      blockCooldown: 0,
      wavedAt: -99,
      braking: true,
      flashT: 0,
      exitTurn: lane === LANES - 1 && r.chance(0.6),
      turnP: -1,
      turnS0: 0,
      x: laneCenter(lane),
      angle: 0,
      dead: false,
    };
  }

  private spawnGap(): number {
    const r = this.rng;
    return 1.8 + r.next() * 2.2 + (r.chance(0.1) ? r.range(2, 5) : 0);
  }

  private maintainTraffic(initial: boolean): void {
    const p = this.player;
    const ahead = Math.max(55, this.viewAhead + 22);
    const behind = Math.max(32, this.viewBehind + 18);
    for (const c of this.npcs) {
      if (c.turnP >= 1 || c.s > p.s + ahead + 25 || c.s < p.s - behind - 25) c.dead = true;
    }
    this.npcs = this.npcs.filter((c) => !c.dead);

    for (let l = 0; l < LANES; l++) {
      const list: Body[] = this.npcs.filter((c) => c.lane === l && c.turnP < 0.3);
      if (this.occupies(l)) list.push(p);
      list.sort((a, b) => b.s - a.s);
      if (list.length === 0) {
        const c = this.makeNpc(l);
        c.s = p.s + this.rng.range(-4, 4);
        list.push(c);
        this.npcs.push(c);
      }
      let front = list[0];
      while (front.s < p.s + ahead) {
        const c = this.makeNpc(l);
        c.s = front.s + front.len / 2 + this.spawnGap() + c.len / 2;
        c.v = initial ? 0 : front.v;
        if (c.s > this.exitS - 2) c.exitTurn = false;
        this.npcs.push(c);
        front = c;
      }
      let rear = list[list.length - 1];
      while (rear.s > p.s - behind) {
        const c = this.makeNpc(l);
        c.s = rear.s - rear.len / 2 - this.spawnGap() - c.len / 2;
        c.v = initial ? 0 : rear.v;
        this.npcs.push(c);
        rear = c;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Replikalar
  // -------------------------------------------------------------------------
  say(owner: Npc | null, text: string, force = false): boolean {
    const last = this.phraseT.get(text) ?? -99;
    if (!force && this.t - last < 9) return false;
    this.bubbles = this.bubbles.filter((b) => b.owner !== owner);
    if (this.bubbles.length >= 2) {
      if (!force) return false;
      this.bubbles.shift();
    }
    this.bubbles.push({ text, owner, age: 0, dur: 2.3 });
    this.phraseT.set(text, this.t);
    return true;
  }

  tip(owner: Npc | null, text: string): void {
    this.tips = this.tips.filter((t) => t.owner !== owner);
    if (this.tips.length >= 3) this.tips.shift();
    this.tips.push({ text, owner, age: 0, dur: 1.3 });
  }

  private updateTexts(dt: number): void {
    for (const b of this.bubbles) b.age += dt;
    for (const t of this.tips) t.age += dt;
    this.bubbles = this.bubbles.filter((b) => b.age < b.dur && !(b.owner && b.owner.dead));
    this.tips = this.tips.filter((t) => t.age < t.dur && !(t.owner && t.owner.dead));
  }

  private ambient(dt: number): void {
    const p = this.player;
    this.stoppedT = p.v < 0.2 && this.status === 'running' ? this.stoppedT + dt : 0;
    if (
      this.mode === 'play' &&
      this.stoppedT > 5 &&
      p.lane !== LANES - 1 &&
      this.exitS - p.s < 80 &&
      this.say(null, PHRASES.turnHere)
    ) {
      this.stoppedT = 0;
    }
    this.chatT -= dt;
    if (this.chatT > 0) return;
    this.chatT = this.rng.range(11, 17);
    const near = this.npcs.filter(
      (c) => c.turnP < 0 && c.s < p.s + this.viewAhead * 0.8 && c.s > p.s - this.viewBehind * 0.6 && c.state !== 'yield',
    );
    if (near.length) this.say(this.rng.pick(near), PHRASES.rush);
  }
}
