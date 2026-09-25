import { Sfx, type Sound } from './audio';
import { Bot } from './bot';
import { Renderer } from './render';
import { TIME_LIMIT, World, type Outcome, type WorldEvent } from './world';

const STEP = 1 / 60;
const BEST_KEY = 'qbd_best';
const TUTORIAL_KEY = 'qbd_tutorial_done';

type Mode = 'menu' | 'playing' | 'paused' | 'result';
type Action = 'left' | 'right' | 'honk' | 'wave' | 'merge' | 'thank';

const TITLES: Record<Outcome, string> = {
  won: 'Axır ki, çıxdın!',
  missed: 'Dönüşü keçdin. Bir dövrə də vur.',
  timeout: 'Hələ də yoldayıq.',
};

const EVENT_SOUND: Partial<Record<WorldEvent, Sound>> = {
  side: 'click',
  honk: 'honk',
  wave: 'wave',
  yield: 'yield',
  'merge-start': 'whoosh',
  fail: 'fail',
  thanks: 'thanks',
  hazard: 'tick',
  noside: 'click',
  won: 'win',
  missed: 'lose',
  timeout: 'lose',
};

function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* gizli rejim və s. */
  }
}

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} tapılmadı`);
  return el;
}

/** "3-nə", "2-sinə" — Azərbaycan dilində rəqəmdən sonra yönlük hal şəkilçisi. */
function dative(n: number): string {
  const last = n % 10;
  const tens = Math.floor(n / 10) % 10;
  if (last === 0) {
    const t: Record<number, string> = { 1: 'na', 2: 'sinə', 3: 'na', 4: 'na', 5: 'sinə', 6: 'na', 7: 'nə', 8: 'nə', 9: 'na' };
    return t[tens] ?? 'na';
  }
  const m: Record<number, string> = { 1: 'nə', 2: 'sinə', 3: 'nə', 4: 'nə', 5: 'nə', 6: 'sına', 7: 'sinə', 8: 'nə', 9: 'na' };
  return m[last];
}

export class Game {
  private renderer: Renderer;
  private sfx = new Sfx();
  private world: World;
  private demoBot: Bot | null = null;
  private mode: Mode = 'menu';
  private last = 0;
  private acc = 0;
  private resultDelay = -1;
  private lastBlink = -1;
  private best = Number(storageGet(BEST_KEY) ?? 0) || 0;
  private tutorialStep = 0; // 0 = təlimat yoxdur
  private tutorialHideT = -1;
  private hud = {
    time: $('st-time'),
    dist: $('st-dist'),
    score: $('st-score'),
    stress: $('st-stress'),
  };
  private hudCache = { time: '', dist: '', score: '', stress: -1 };
  private buttons = new Map<Action, HTMLElement>();
  private lastResultText = '';

  constructor() {
    const canvas = $('cv') as HTMLCanvasElement;
    this.renderer = new Renderer(canvas);
    this.world = this.makeDemo();
    this.bindUi();
    this.onResize();
    this.showStart();
    requestAnimationFrame(this.frame);
  }

  // ---------------------------------------------------------------- qurulum
  private makeDemo(): World {
    const w = new World((Math.random() * 1e9) | 0, 'demo');
    this.demoBot = new Bot(1, { roam: true });
    return w;
  }

  private bindUi(): void {
    document.querySelectorAll<HTMLElement>('#controls .ctl').forEach((btn) => {
      const act = btn.dataset.act as Action;
      this.buttons.set(act, btn);
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        btn.classList.add('pressed');
        this.sfx.unlock();
        this.act(act);
      });
      const up = () => btn.classList.remove('pressed');
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
      btn.addEventListener('pointerleave', up);
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    });

    $('btn-play').addEventListener('click', () => this.startRound());
    $('btn-again').addEventListener('click', () => this.startRound());
    $('btn-resume').addEventListener('click', () => this.resume());
    $('btn-restart').addEventListener('click', () => this.startRound());
    $('btn-pause').addEventListener('click', () => (this.mode === 'playing' ? this.pause() : this.resume()));
    $('btn-share').addEventListener('click', () => void this.share());
    const soundBtn = $('btn-sound');
    const syncSound = () => {
      soundBtn.classList.toggle('muted', this.sfx.muted);
      soundBtn.setAttribute('aria-label', this.sfx.muted ? 'Səsi aç' : 'Səsi söndür');
    };
    syncSound();
    soundBtn.addEventListener('click', () => {
      this.sfx.unlock();
      this.sfx.setMuted(!this.sfx.muted);
      syncSound();
    });

    // Səs yalnız ilk toxunuşdan sonra
    const unlock = () => this.sfx.unlock();
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);

    window.addEventListener('keydown', (e) => this.onKey(e));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (this.mode === 'playing') this.pause();
        this.sfx.suspend();
      } else if (this.mode !== 'menu') {
        this.sfx.unlock();
      }
    });
    window.addEventListener('pagehide', () => {
      if (this.mode === 'playing') this.pause();
    });

    // Səhifənin sürüşməsinin və iki toxunuşla böyüdülməsinin qarşısını al
    document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
    document.addEventListener('dblclick', (e) => e.preventDefault());
    document.addEventListener('gesturestart', (e) => e.preventDefault());

    const stage = $('stage');
    if ('ResizeObserver' in window) new ResizeObserver(() => this.onResize()).observe(stage);
    window.addEventListener('resize', () => this.onResize());
  }

  private onResize(): void {
    const stage = $('stage');
    const r = stage.getBoundingClientRect();
    this.renderer.resize(r.width, r.height);
    this.world.viewAhead = this.renderer.viewAhead;
    this.world.viewBehind = this.renderer.viewBehind;
    this.renderer.render(this.world, 0);
  }

  private onKey(e: KeyboardEvent): void {
    const k = e.key;
    if (this.mode === 'playing') {
      const map: Record<string, Action> = {
        ArrowLeft: 'left',
        ArrowRight: 'right',
        h: 'honk',
        H: 'honk',
        e: 'wave',
        E: 'wave',
        ' ': 'merge',
        t: 'thank',
        T: 'thank',
      };
      // Azərbaycan klaviaturası: fiziki düymə kodları ilə də işləsin
      const byCode: Record<string, Action> = { KeyH: 'honk', KeyE: 'wave', KeyT: 'thank', Space: 'merge' };
      const act = map[k] ?? byCode[e.code];
      if (act) {
        e.preventDefault();
        if (e.repeat) return;
        const btn = this.buttons.get(act);
        if (btn) {
          btn.classList.add('pressed');
          window.setTimeout(() => btn.classList.remove('pressed'), 110);
        }
        this.act(act);
        return;
      }
      if (k === 'Escape' || k === 'p' || k === 'P') {
        e.preventDefault();
        this.pause();
      }
      return;
    }
    if (this.mode === 'paused' && (k === 'Escape' || k === 'p' || k === 'P' || k === 'Enter')) {
      e.preventDefault();
      this.resume();
    } else if ((this.mode === 'menu' || this.mode === 'result') && k === 'Enter') {
      e.preventDefault();
      this.startRound();
    } else if (k === ' ' || k.startsWith('Arrow')) {
      e.preventDefault();
    }
  }

  private act(a: Action): void {
    if (this.mode !== 'playing') return;
    const w = this.world;
    switch (a) {
      case 'left':
        w.setSide(-1);
        break;
      case 'right':
        w.setSide(1);
        break;
      case 'honk':
        w.honk();
        break;
      case 'wave':
        w.wave();
        break;
      case 'merge':
        w.merge();
        break;
      case 'thank':
        w.thank();
        break;
    }
  }

  // ---------------------------------------------------------------- ekranlar
  private show(id: string, on: boolean): void {
    $(id).classList.toggle('hidden', !on);
  }

  private showStart(): void {
    this.mode = 'menu';
    this.show('screen-start', true);
    this.show('screen-pause', false);
    this.show('screen-result', false);
    this.show('hud', false);
    this.show('controls', false);
    this.show('hint', false);
    $('start-best').textContent = this.best > 0 ? `Ən yaxşı xal: ${this.best}` : '';
  }

  private startRound(): void {
    this.sfx.unlock();
    this.sfx.play('click');
    this.world = new World((Math.random() * 1e9) | 0, 'play');
    this.demoBot = null;
    this.renderer.resetCamera();
    this.mode = 'playing';
    this.acc = 0;
    this.resultDelay = -1;
    this.hudCache = { time: '', dist: '', score: '', stress: -1 };
    this.show('screen-start', false);
    this.show('screen-pause', false);
    this.show('screen-result', false);
    this.show('hud', true);
    this.show('controls', true);
    this.tutorialStep = storageGet(TUTORIAL_KEY) === '1' ? 0 : 1;
    this.tutorialHideT = -1;
    this.renderHint();
    this.onResize();
  }

  private pause(): void {
    if (this.mode !== 'playing') return;
    this.mode = 'paused';
    this.show('screen-pause', true);
  }

  private resume(): void {
    if (this.mode !== 'paused') return;
    this.sfx.unlock();
    this.mode = 'playing';
    this.last = performance.now();
    this.acc = 0;
    this.show('screen-pause', false);
  }

  private showResult(o: Outcome): void {
    this.mode = 'result';
    const w = this.world;
    const secs = Math.round(o === 'timeout' ? TIME_LIMIT : w.elapsed);
    const meters = Math.max(0, Math.round(Math.min(w.player.s, w.exitS + 10)));
    const n = w.stats.merges;
    const k = w.stats.thanks;
    const lines: string[] = [`${secs} saniyəyə ${meters} metr getdim.`];
    if (n === 0) lines.push('Heç kim yol vermədi.');
    else if (k === 0) lines.push(`${n} maşın yol verdi. Heç birinə sağ ol demədim.`);
    else if (k >= n) lines.push(`${n} maşın yol verdi. Hamısına sağ ol dedim.`);
    else lines.push(`${n} maşın yol verdi. ${k}-${dative(k)} sağ ol dedim.`);
    if (w.stats.honks >= 6) lines.push(`Siqnalı ${w.stats.honks} dəfə basdım. Əsəblər tarıma çəkildi.`);
    else if (o === 'timeout') lines.push(`Dönüşə ${Math.round(w.distanceLeft)} metr qaldı.`);
    else if (o === 'won') lines.push('Naviqator hələ də «12 dəqiqə» deyir.');
    else lines.push('Növbəti dönüş... bir az irəlidə.');

    const score = w.score;
    const record = score > this.best;
    if (record) {
      this.best = score;
      storageSet(BEST_KEY, String(score));
    }
    $('res-title').textContent = TITLES[o];
    const ul = $('res-lines');
    ul.replaceChildren(
      ...lines.map((l) => {
        const li = document.createElement('li');
        li.textContent = `“${l}”`;
        return li;
      }),
    );
    $('res-score').textContent = String(score);
    $('res-best').textContent = String(this.best);
    this.show('res-record', record && score > 0);
    $('share-msg').textContent = '';
    this.lastResultText = `“Qardaş, burax da!” — ${TITLES[o]} ${lines.slice(0, 2).join(' ')} Xal: ${score}.`;
    this.show('hint', false);
    this.show('screen-result', true);
  }

  private async share(): Promise<void> {
    const url = location.href.split('#')[0];
    const text = `${this.lastResultText} Sən də yoxla:`;
    const msg = $('share-msg');
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: 'Qardaş, burax da!', text, url });
        msg.textContent = 'Göndərildi!';
        return;
      } catch (e) {
        if ((e as DOMException)?.name === 'AbortError') return;
      }
    }
    const full = `${text} ${url}`;
    const ok = await this.copy(full);
    msg.textContent = ok ? 'Nəticə və link kopyalandı!' : 'Kopyalamaq alınmadı.';
  }

  private async copy(text: string): Promise<boolean> {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      /* köhnə üsula keç */
    }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------- təlimat
  private renderHint(): void {
    const el = $('hint');
    const desktop = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    const texts: Record<number, string> = {
      1: `<span class="step">1/3</span>Sağdakı dönüşə çatmalısan. <b>${desktop ? '→' : '▶'}</b> bas — dönmə işığı yansın.`,
      2: `<span class="step">2/3</span>Qonşuya <b>Əl elə</b>. Telefona baxan sürücüyə əvvəl <b>Siqnal</b> ver.`,
      3: `<span class="step">3/3</span>Yaşıl kölgə görünəndə <b>Keç</b>, sonra <b>Sağ ol</b> de.`,
    };
    const t = texts[this.tutorialStep];
    if (!t || this.mode !== 'playing') {
      el.classList.add('hidden');
      return;
    }
    el.innerHTML = t;
    el.classList.remove('hidden');
  }

  private tutorialEvent(e: WorldEvent): void {
    if (this.tutorialStep === 0) return;
    const w = this.world;
    const before = this.tutorialStep;
    if (this.tutorialStep === 1 && e === 'side' && w.player.side === 1) this.tutorialStep = 2;
    else if (this.tutorialStep === 2 && (e === 'wave' || e === 'honk' || e === 'merge-start')) this.tutorialStep = 3;
    else if (this.tutorialStep === 3 && e === 'merge') this.tutorialHideT = 2.5;
    if (e === 'merge-start' && this.tutorialStep < 3) this.tutorialStep = 3;
    if (before !== this.tutorialStep) this.renderHint();
  }

  private tickTutorial(dt: number): void {
    if (this.tutorialHideT < 0) return;
    this.tutorialHideT -= dt;
    if (this.tutorialHideT < 0 || this.world.stats.thanks > 0) {
      this.tutorialHideT = -1;
      this.tutorialStep = 0;
      storageSet(TUTORIAL_KEY, '1');
      this.renderHint();
    }
  }

  // ---------------------------------------------------------------- dövr
  private frame = (now: number): void => {
    requestAnimationFrame(this.frame);
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0;
    this.last = now;

    if (this.mode === 'playing' || this.mode === 'menu' || this.mode === 'result') {
      this.acc += dt;
      let steps = 0;
      while (this.acc >= STEP && steps < 6) {
        this.acc -= STEP;
        steps++;
        this.demoBot?.step(this.world, STEP);
        this.world.update(STEP);
        this.drainEvents();
      }
      if (steps === 6) this.acc = 0;
    }

    if (this.mode === 'playing') {
      this.tickTutorial(dt);
      if (this.resultDelay >= 0) {
        this.resultDelay -= dt;
        if (this.resultDelay < 0) this.showResult(this.world.status as Outcome);
      }
      this.updateHud();
    }
    this.renderer.render(this.world, dt);
  };

  private drainEvents(): void {
    const w = this.world;
    if (w.mode === 'demo') {
      w.events.length = 0;
      return;
    }
    for (const e of w.events) {
      const s = EVENT_SOUND[e];
      if (s) this.sfx.play(s);
      if (e === 'fail' && navigator.vibrate) navigator.vibrate(30);
      this.tutorialEvent(e);
      if ((e === 'won' || e === 'missed' || e === 'timeout') && this.resultDelay < 0) {
        this.resultDelay = e === 'won' ? 0.4 : 1.1;
      }
    }
    w.events.length = 0;
    // dönmə işığının tıqqıltısı
    const p = w.player;
    const phase = Math.floor(w.t / 0.36);
    if ((p.side !== 0 || p.hazardT > 0) && phase !== this.lastBlink) this.sfx.play('tick');
    this.lastBlink = phase;
  }

  private updateHud(): void {
    const w = this.world;
    const p = w.player;
    const secs = Math.ceil(w.timeLeft);
    const time = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    if (time !== this.hudCache.time) {
      this.hudCache.time = time;
      this.hud.time.textContent = time;
      this.hud.time.classList.toggle('low', secs <= 15);
    }
    const dist = `${Math.round(w.distanceLeft)} m`;
    if (dist !== this.hudCache.dist) {
      this.hudCache.dist = dist;
      this.hud.dist.textContent = dist;
    }
    const score = String(w.score);
    if (score !== this.hudCache.score) {
      this.hudCache.score = score;
      this.hud.score.textContent = score;
    }
    const stress = Math.round(w.stress);
    if (stress !== this.hudCache.stress) {
      this.hudCache.stress = stress;
      this.hud.stress.style.width = `${Math.max(4, stress)}%`;
      this.hud.stress.style.backgroundColor = stress > 70 ? '#ff5a4c' : stress > 40 ? '#ffb020' : '#3ddc84';
    }
    const blinkOn = Math.floor(w.t / 0.36) % 2 === 0;
    const left = this.buttons.get('left')!;
    const right = this.buttons.get('right')!;
    left.classList.toggle('on', p.side < 0);
    right.classList.toggle('on', p.side > 0);
    left.classList.toggle('blink', p.side < 0 && blinkOn);
    right.classList.toggle('blink', p.side > 0 && blinkOn);
    this.buttons.get('merge')!.classList.toggle('ready', !!w.preview?.ok);
    this.buttons.get('thank')!.classList.toggle('ready', p.thankWindow > 0);
    this.buttons.get('wave')!.classList.toggle('dim', p.side === 0);
  }
}
