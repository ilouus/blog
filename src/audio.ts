/** Sadə, sintez olunmuş səslər (Web Audio). Heç bir fayl lazım deyil. */
export type Sound =
  | 'honk'
  | 'tick'
  | 'whoosh'
  | 'fail'
  | 'thanks'
  | 'wave'
  | 'yield'
  | 'click'
  | 'win'
  | 'lose';

const MUTE_KEY = 'qbd_muted';

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  muted: boolean;

  constructor() {
    let m = false;
    try {
      m = localStorage.getItem(MUTE_KEY) === '1';
    } catch {
      /* localStorage əlçatan deyil */
    }
    this.muted = m;
  }

  /** İlk istifadəçi toxunuşunda çağırılır. */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.55;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  suspend(): void {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    try {
      localStorage.setItem(MUTE_KEY, m ? '1' : '0');
    } catch {
      /* boş */
    }
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.55, this.ctx.currentTime, 0.02);
  }

  private tone(
    freq: number,
    dur: number,
    opts: { type?: OscillatorType; vol?: number; delay?: number; slide?: number; attack?: number } = {},
  ): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.muted) return;
    const t0 = ctx.currentTime + (opts.delay ?? 0);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = opts.type ?? 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (opts.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq * opts.slide), t0 + dur);
    const vol = opts.vol ?? 0.2;
    const att = opts.attack ?? 0.01;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + att);
    g.gain.setValueAtTime(vol, t0 + Math.max(att, dur - 0.05));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  private noise(dur: number, vol: number, freq: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.muted) return;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(freq, ctx.currentTime);
    f.frequency.exponentialRampToValueAtTime(freq * 2.5, ctx.currentTime + dur);
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start();
  }

  play(s: Sound): void {
    if (!this.ctx || this.muted) return;
    switch (s) {
      case 'honk':
        this.tone(392, 0.32, { type: 'square', vol: 0.09 });
        this.tone(494, 0.32, { type: 'square', vol: 0.07 });
        break;
      case 'tick':
        this.tone(1800, 0.025, { type: 'square', vol: 0.03, attack: 0.002 });
        break;
      case 'whoosh':
        this.noise(0.45, 0.35, 500);
        break;
      case 'fail':
        this.tone(180, 0.18, { type: 'sawtooth', vol: 0.08 });
        this.tone(140, 0.22, { type: 'sawtooth', vol: 0.08, delay: 0.14 });
        break;
      case 'thanks':
        for (let i = 0; i < 3; i++) this.tone(880, 0.07, { type: 'triangle', vol: 0.12, delay: i * 0.2 });
        break;
      case 'wave':
        this.tone(660, 0.12, { type: 'triangle', vol: 0.1, slide: 1.3 });
        break;
      case 'yield':
        this.tone(740, 0.1, { type: 'sine', vol: 0.12 });
        this.tone(988, 0.14, { type: 'sine', vol: 0.12, delay: 0.1 });
        break;
      case 'click':
        this.tone(520, 0.05, { type: 'triangle', vol: 0.08 });
        break;
      case 'win':
        [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.22, { type: 'triangle', vol: 0.14, delay: i * 0.12 }));
        break;
      case 'lose':
        [392, 370, 349, 294].forEach((f, i) =>
          this.tone(f, i === 3 ? 0.6 : 0.25, { type: 'sawtooth', vol: 0.06, delay: i * 0.26, slide: i === 3 ? 0.9 : 1 }),
        );
        break;
    }
  }
}
