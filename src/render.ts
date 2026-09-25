import { hash3, Rng } from './rng';
import { CAR_W, LANES, LANE_W, ROAD_W, laneCenter, type CarStyle, type Npc, type World } from './world';

export const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", "Helvetica Neue", Arial, sans-serif';

const SIDEWALK = 1.8;
const SEG = 14;

const C = {
  ground: '#cdbf9f',
  asphalt: '#3d4148',
  asphaltDark: '#353940',
  line: 'rgba(255,255,255,0.85)',
  curb: '#e9e2d2',
  sidewalk: '#d8ccb0',
  sidewalkTile: 'rgba(120,100,70,0.12)',
  player: '#18cfc3',
  glass: '#26303a',
};

const BEIGES = ['#eadcbc', '#e3d1aa', '#efe4c9', '#e6d5b3', '#dccaa4'];
const SIGNS = [
  { text: 'Market', bg: '#1f6fb2', fg: '#ffffff' },
  { text: 'Çay evi', bg: '#8c2f2b', fg: '#fff3dc' },
  { text: 'Market', bg: '#2a8a4a', fg: '#ffffff' },
  { text: 'Çay evi', bg: '#6b3d1e', fg: '#ffe9b8' },
  { text: 'Aptek', bg: '#1f8f7a', fg: '#ffffff' },
  { text: 'Çörək', bg: '#b8742b', fg: '#fff7e6' },
];

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  const f = (c: number) => Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt);
  r = f(r);
  g = f(g);
  b = f(b);
  return `rgb(${r},${g},${b})`;
}

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rad = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

export interface CarDraw {
  x: number;
  y: number;
  angle: number;
  len: number; // px
  wid: number; // px
  color: string;
  style: CarStyle | 'player';
  brake: boolean;
  blinkL: boolean;
  blinkR: boolean;
  flash: boolean;
}

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  ppm = 20;
  private roadX = 0;
  private originY = 0;
  private camS = 0;
  private camInit = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D dəstəklənmir');
    this.ctx = ctx;
  }

  resize(cssW: number, cssH: number): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.w = Math.max(1, Math.floor(cssW));
    this.h = Math.max(1, Math.floor(cssH));
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    // Yol eni ekranın ~64%-i, amma şaquli olaraq ən azı ~24 m görünsün.
    this.ppm = Math.max(10, Math.min((this.w * 0.64) / ROAD_W, this.h / 24, 34));
    this.roadX = Math.round((this.w - ROAD_W * this.ppm) / 2);
    this.originY = this.h * 0.7;
  }

  /** Görünən məsafə (metr) — trafikin ekrandan kənarda yaranması üçün. */
  get viewAhead(): number {
    return this.originY / this.ppm;
  }

  get viewBehind(): number {
    return (this.h - this.originY) / this.ppm;
  }

  resetCamera(): void {
    this.camInit = false;
  }

  private sx(x: number): number {
    return this.roadX + x * this.ppm;
  }

  private sy(s: number): number {
    return this.originY - (s - this.camS) * this.ppm;
  }

  render(world: World, dt: number): void {
    const ctx = this.ctx;
    const p = world.player;
    const target = p.s;
    if (!this.camInit) {
      this.camS = target;
      this.camInit = true;
    } else {
      this.camS += (target - this.camS) * Math.min(1, dt * 6);
    }
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = C.ground;
    ctx.fillRect(0, 0, this.w, this.h);

    const sMin = this.camS - (this.h - this.originY) / this.ppm - 4;
    const sMax = this.camS + this.originY / this.ppm + 4;

    this.drawRoad(world, sMin, sMax);
    this.drawSides(world, sMin, sMax);
    this.drawExit(world, sMin, sMax);

    const blinkOn = Math.floor(world.t / 0.36) % 2 === 0;
    // Maşınlar (arxadakılar əvvəl — çıxışa dönənlər üstdə qalmasın)
    const npcs = world.npcs.filter((c) => c.s > sMin - 12 && c.s < sMax + 12).sort((a, b) => a.s - b.s);
    for (const c of npcs) this.drawNpc(world, c, blinkOn);
    // keçid kölgəsi maşınların üstündə: mane olan maşın aydın görünsün
    this.drawPreview(world);
    this.drawPlayer(world, blinkOn);
    for (const c of npcs) this.drawNpcOverlay(world, c);
    this.drawTexts(world);
  }

  // ------------------------------------------------------------------ yol
  private drawRoad(world: World, sMin: number, sMax: number): void {
    const ctx = this.ctx;
    const ppm = this.ppm;
    const x0 = this.sx(0);
    const x1 = this.sx(ROAD_W);
    ctx.fillStyle = C.asphalt;
    ctx.fillRect(x0, 0, x1 - x0, this.h);
    // asfalt yamaqları
    for (let seg = Math.floor(sMin / 23); seg <= Math.ceil(sMax / 23); seg++) {
      const r = new Rng(hash3(seg, 7, world.seed));
      if (!r.chance(0.5)) continue;
      const s = seg * 23 + r.range(0, 18);
      const x = r.range(0.4, ROAD_W - 3);
      ctx.fillStyle = C.asphaltDark;
      rr(ctx, this.sx(x), this.sy(s), r.range(1, 2.6) * ppm, r.range(1.2, 3.5) * ppm, 6);
      ctx.fill();
    }
    // kənar xətləri
    ctx.fillStyle = C.line;
    const edgeW = Math.max(2, ppm * 0.12);
    ctx.fillRect(x0 + ppm * 0.15, 0, edgeW, this.h);
    // sağ kənar xətti (dönüş ətrafında qırıq)
    const exitS = world.exitS;
    const openA = exitS - 45;
    const openB = exitS + 12;
    const rx = x1 - ppm * 0.15 - edgeW;
    if (sMax < openA || sMin > openB) {
      ctx.fillRect(rx, 0, edgeW, this.h);
    } else {
      const yA = this.sy(openA);
      const yB = this.sy(openB);
      if (yA < this.h) ctx.fillRect(rx, yA, edgeW, this.h - yA);
      if (yB > 0) ctx.fillRect(rx, 0, edgeW, yB);
      for (let s = Math.max(openA, Math.floor(sMin / 4) * 4); s < Math.min(exitS - 4, sMax); s += 4) {
        ctx.fillRect(rx, this.sy(s + 2), edgeW, 2 * ppm);
      }
    }
    // zolaq xətləri (qırıq)
    const dash = 3;
    const period = 9;
    const lw = Math.max(2, ppm * 0.11);
    for (let l = 1; l < LANES; l++) {
      const x = this.sx(l * LANE_W) - lw / 2;
      for (let s = Math.floor(sMin / period) * period; s < sMax; s += period) {
        ctx.fillRect(x, this.sy(s + dash), lw, dash * ppm);
      }
    }
    // sağ zolaqda dönüş oxları
    for (const d of [48, 26]) {
      const s = exitS - d;
      if (s > sMin - 5 && s < sMax + 5) this.drawTurnArrow(this.sx(laneCenter(LANES - 1)), this.sy(s));
    }
  }

  private drawTurnArrow(x: number, y: number): void {
    const ctx = this.ctx;
    const u = this.ppm;
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = u * 0.28;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-u * 0.3, u * 1.6);
    ctx.lineTo(-u * 0.3, 0);
    ctx.quadraticCurveTo(-u * 0.3, -u * 0.8, u * 0.4, -u * 0.8);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(u * 0.9, -u * 0.8);
    ctx.lineTo(u * 0.25, -u * 1.3);
    ctx.lineTo(u * 0.25, -u * 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // ------------------------------------------------------------------ kənarlar
  private drawSides(world: World, sMin: number, sMax: number): void {
    const ctx = this.ctx;
    const ppm = this.ppm;
    const leftCurb = this.sx(0);
    const rightCurb = this.sx(ROAD_W);
    const swPx = SIDEWALK * ppm;
    // səkilər
    ctx.fillStyle = C.sidewalk;
    ctx.fillRect(leftCurb - swPx, 0, swPx, this.h);
    ctx.fillRect(rightCurb, 0, swPx, this.h);
    ctx.fillStyle = C.sidewalkTile;
    for (let s = Math.floor(sMin); s < sMax; s += 1) {
      const y = this.sy(s);
      ctx.fillRect(leftCurb - swPx, y, swPx, 1);
      ctx.fillRect(rightCurb, y, swPx, 1);
    }
    ctx.fillStyle = C.curb;
    ctx.fillRect(leftCurb - ppm * 0.25, 0, ppm * 0.25, this.h);
    ctx.fillRect(rightCurb, 0, ppm * 0.25, this.h);

    const first = Math.floor(sMin / SEG) - 1;
    const last = Math.ceil(sMax / SEG) + 1;
    for (const side of [-1, 1] as const) {
      for (let i = first; i <= last; i++) this.drawBuilding(world, i, side);
    }
    // ağaclar və lövhələr binaların üstündə
    for (const side of [-1, 1] as const) {
      for (let i = first; i <= last; i++) this.drawStreetStuff(world, i, side);
    }
  }

  private inExit(world: World, s0: number, s1: number): boolean {
    return s1 > world.exitS - 6 && s0 < world.exitS + 14;
  }

  private drawBuilding(world: World, i: number, side: -1 | 1): void {
    const ctx = this.ctx;
    const ppm = this.ppm;
    const r = new Rng(hash3(i, side + 5, world.seed));
    let s0 = i * SEG;
    let s1 = s0 + SEG;
    if (r.chance(0.3)) s0 += 1.2; // ara keçid
    if (side === 1 && this.inExit(world, s0, s1)) {
      // dönüş yolu binaları kəsir
      if (s0 < world.exitS - 6) s1 = world.exitS - 6;
      else if (s1 > world.exitS + 14) s0 = world.exitS + 14;
      else return;
    }
    const front = side < 0 ? this.sx(-SIDEWALK) : this.sx(ROAD_W + SIDEWALK);
    const yTop = this.sy(s1);
    const yBot = this.sy(s0);
    if (yBot < -10 || yTop > this.h + 10) return;
    const col = r.pick(BEIGES);
    // bina kölgəsi səkiyə
    ctx.fillStyle = 'rgba(60,40,20,0.12)';
    ctx.fillRect(side < 0 ? front : front - ppm * 0.5, yTop, ppm * 0.5, yBot - yTop);
    // Bloklar sırası: bina → həyət → bina ... ekranın kənarına qədər
    const edge = (side < 0 ? front : this.w - front) / ppm;
    let u = 0;
    for (let row = 0; u < edge + 1 && row < 12; row++) {
      const depth = row === 0 ? r.range(8, 12) : r.range(9, 14);
      const pa = front + side * u * ppm;
      const pb = front + side * (u + depth) * ppm;
      const xa = Math.min(pa, pb);
      const xb = Math.max(pa, pb);
      const bc = row === 0 ? col : r.pick(BEIGES);
      const bTop = row === 0 ? yTop : this.sy(s1 - r.range(0, 1.5));
      const bBot = row === 0 ? yBot : this.sy(s0 + r.range(0, 1.5));
      ctx.fillStyle = bc;
      ctx.fillRect(xa, bTop, xb - xa, bBot - bTop);
      // dam kənarı (daş karniz)
      const inset = ppm * 0.35;
      ctx.strokeStyle = shade(bc, -0.18);
      ctx.lineWidth = Math.max(1.5, ppm * 0.12);
      ctx.strokeRect(xa + inset, bTop + inset, xb - xa - inset * 2, bBot - bTop - inset * 2);
      // dam üstü: su çənləri, kondisionerlər, antenalar
      const count = r.int(1, 3) + (row > 0 ? 1 : 0);
      for (let k = 0; k < count; k++) {
        const yy = bTop + (bBot - bTop) * r.range(0.2, 0.8);
        const xx = xa + (xb - xa) * r.range(0.2, 0.8);
        const kind = r.next();
        if (kind < 0.45) {
          ctx.fillStyle = '#9aa3aa';
          ctx.beginPath();
          ctx.arc(xx, yy, ppm * 0.55, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#c3cad0';
          ctx.beginPath();
          ctx.arc(xx - ppm * 0.1, yy - ppm * 0.1, ppm * 0.38, 0, Math.PI * 2);
          ctx.fill();
        } else if (kind < 0.8) {
          ctx.fillStyle = '#d9dcdc';
          ctx.fillRect(xx - ppm * 0.4, yy - ppm * 0.3, ppm * 0.8, ppm * 0.6);
          ctx.strokeStyle = '#a8adb0';
          ctx.lineWidth = 1;
          ctx.strokeRect(xx - ppm * 0.4, yy - ppm * 0.3, ppm * 0.8, ppm * 0.6);
        } else {
          ctx.fillStyle = '#eef0f1';
          ctx.beginPath();
          ctx.ellipse(xx, yy, ppm * 0.45, ppm * 0.3, 0.6, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#9aa0a6';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
      u += depth;
      // həyət
      const yard = r.range(3, 6);
      const ya = front + side * u * ppm;
      const yb = front + side * (u + yard) * ppm;
      ctx.fillStyle = '#bfb893';
      ctx.fillRect(Math.min(ya, yb), yTop, Math.abs(yb - ya), yBot - yTop);
      if (r.chance(0.7)) {
        const tx = (ya + yb) / 2;
        const ty = (yTop + yBot) / 2 + r.range(-0.3, 0.3) * (yBot - yTop);
        ctx.fillStyle = 'rgba(30,50,20,0.2)';
        ctx.beginPath();
        ctx.arc(tx + ppm * 0.3, ty + ppm * 0.3, ppm * 1.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#5f9a48';
        ctx.beginPath();
        ctx.arc(tx, ty, ppm * 1.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#7db463';
        ctx.beginPath();
        ctx.arc(tx - ppm * 0.3, ty - ppm * 0.3, ppm * 0.7, 0, Math.PI * 2);
        ctx.fill();
      }
      u += yard;
    }
    // balkonlar (səkiyə tərəf çıxır)
    const nb = r.int(1, 3);
    for (let k = 0; k < nb; k++) {
      const bs = s0 + ((k + 0.5) / nb) * (s1 - s0);
      const bl = r.range(1.8, 2.8);
      const y = this.sy(bs + bl / 2);
      const depth = ppm * 0.6;
      const bx = side < 0 ? front : front - depth;
      ctx.fillStyle = shade(col, 0.25);
      ctx.fillRect(bx, y, depth, bl * ppm);
      ctx.strokeStyle = shade(col, -0.35);
      ctx.lineWidth = 1.5;
      const rxl = side < 0 ? bx + depth : bx;
      ctx.beginPath();
      ctx.moveTo(rxl, y);
      ctx.lineTo(rxl, y + bl * ppm);
      ctx.stroke();
      ctx.lineWidth = 1;
      for (let t = y + 3; t < y + bl * ppm - 1; t += 4) {
        ctx.beginPath();
        ctx.moveTo(rxl, t);
        ctx.lineTo(rxl + (side < 0 ? -3 : 3), t);
        ctx.stroke();
      }
    }
  }

  private drawStreetStuff(world: World, i: number, side: -1 | 1): void {
    const ctx = this.ctx;
    const ppm = this.ppm;
    const r = new Rng(hash3(i, side + 11, world.seed));
    const s0 = i * SEG;
    const exitBlock = side === 1 && this.inExit(world, s0, s0 + SEG);
    const swCenter = side < 0 ? this.sx(-SIDEWALK / 2) : this.sx(ROAD_W + SIDEWALK / 2);
    // ağaclar
    const trees = r.int(0, 2);
    for (let k = 0; k < trees; k++) {
      const s = s0 + r.range(1, SEG - 1);
      if (side === 1 && s > world.exitS - 8 && s < world.exitS + 16) continue;
      const y = this.sy(s);
      if (y < -40 || y > this.h + 40) continue;
      const rad = ppm * r.range(1.0, 1.4);
      const x = swCenter + side * ppm * 0.2;
      ctx.fillStyle = 'rgba(30,50,20,0.22)';
      ctx.beginPath();
      ctx.arc(x + ppm * 0.35, y + ppm * 0.35, rad, 0, Math.PI * 2);
      ctx.fill();
      const g = r.chance(0.5) ? ['#4f8a3a', '#6aa84f', '#86c06a'] : ['#3f7a45', '#58995a', '#7cb877'];
      ctx.fillStyle = g[0];
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = g[1];
      ctx.beginPath();
      ctx.arc(x - rad * 0.2, y - rad * 0.15, rad * 0.72, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = g[2];
      ctx.beginPath();
      ctx.arc(x - rad * 0.35, y - rad * 0.35, rad * 0.35, 0, Math.PI * 2);
      ctx.fill();
    }
    // mağaza lövhələri
    if (!exitBlock && r.chance(0.42)) {
      const sign = r.pick(SIGNS);
      const s = s0 + r.range(3, SEG - 3);
      const y = this.sy(s);
      if (y > -30 && y < this.h + 30) {
        const fs = Math.max(9, Math.min(12, ppm * 0.55));
        ctx.font = `700 ${fs}px ${FONT}`;
        const tw = ctx.measureText(sign.text).width;
        const bw = tw + fs;
        const bh = fs * 1.7;
        const front = side < 0 ? this.sx(-SIDEWALK) : this.sx(ROAD_W + SIDEWALK);
        const bx = side < 0 ? front - bw * 0.35 : front - bw * 0.65;
        const x = Math.max(2, Math.min(this.w - bw - 2, bx));
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        rr(ctx, x + 2, y - bh / 2 + 2, bw, bh, 4);
        ctx.fill();
        ctx.fillStyle = sign.bg;
        rr(ctx, x, y - bh / 2, bw, bh, 4);
        ctx.fill();
        ctx.fillStyle = sign.fg;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(sign.text, x + bw / 2, y + 1);
      }
    }
  }

  // ------------------------------------------------------------------ dönüş
  private drawExit(world: World, sMin: number, sMax: number): void {
    const exitS = world.exitS;
    if (!Number.isFinite(exitS)) return;
    const ctx = this.ctx;
    const ppm = this.ppm;
    const a = exitS - 6;
    const b = exitS + 14;
    if (b > sMin && a < sMax) {
      const x0 = this.sx(ROAD_W) - 1;
      const yA = this.sy(a);
      const yB = this.sy(b);
      ctx.fillStyle = C.asphalt;
      ctx.fillRect(x0, yB + ppm * 2.5, this.w - x0, yA - yB - ppm * 5);
      // yumru künclər
      ctx.fillStyle = C.asphalt;
      ctx.beginPath();
      ctx.moveTo(x0, yA);
      ctx.quadraticCurveTo(x0 + ppm * 2.5, yA - ppm * 0.2, x0 + ppm * 2.6, yA - ppm * 2.5);
      ctx.lineTo(x0, yA - ppm * 2.5);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x0, yB);
      ctx.quadraticCurveTo(x0 + ppm * 2.5, yB + ppm * 0.2, x0 + ppm * 2.6, yB + ppm * 2.5);
      ctx.lineTo(x0, yB + ppm * 2.5);
      ctx.closePath();
      ctx.fill();
      // mərkəz xətti
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      const yc = this.sy(exitS + 4);
      for (let x = x0 + ppm * 3; x < this.w; x += ppm * 3) ctx.fillRect(x, yc - 1, ppm * 1.5, 2);
      // "piyada keçidi"
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      for (let s = a + 3; s < b - 2.5; s += 1.2) {
        ctx.fillRect(this.sx(ROAD_W + 0.9), this.sy(s + 0.6), ppm * 1.3, ppm * 0.6);
      }
    }
    // Böyük yaşıl lövhə
    const signS = exitS - 34;
    if (signS > sMin - 10 && signS < sMax + 10) {
      const y = this.sy(signS);
      const fs = Math.max(11, Math.min(15, ppm * 0.7));
      ctx.font = `800 ${fs}px ${FONT}`;
      const text = 'Dönüş';
      const tw = ctx.measureText(text).width;
      const bw = tw + fs * 2.6;
      const bh = fs * 2.2;
      const x = Math.min(this.w - bw - 4, this.sx(ROAD_W + 0.3));
      ctx.fillStyle = '#6b6f73';
      ctx.fillRect(x + bw / 2 - 2, y, 4, bh * 0.9);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      rr(ctx, x + 3, y - bh / 2 + 3, bw, bh, 5);
      ctx.fill();
      ctx.fillStyle = '#157a45';
      rr(ctx, x, y - bh / 2, bw, bh, 5);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      rr(ctx, x + 2.5, y - bh / 2 + 2.5, bw - 5, bh - 5, 3);
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, x + fs * 0.6, y + 1);
      // ox
      const ax = x + bw - fs * 1.3;
      ctx.beginPath();
      ctx.moveTo(ax, y - fs * 0.35);
      ctx.lineTo(ax + fs * 0.5, y - fs * 0.35);
      ctx.lineTo(ax + fs * 0.5, y - fs * 0.6);
      ctx.lineTo(ax + fs * 0.95, y - fs * 0.15);
      ctx.lineTo(ax + fs * 0.5, y + fs * 0.3);
      ctx.lineTo(ax + fs * 0.5, y + fs * 0.05);
      ctx.lineTo(ax + fs * 0.2, y + fs * 0.05);
      ctx.lineTo(ax + fs * 0.2, y + fs * 0.5);
      ctx.lineTo(ax - fs * 0.1, y + fs * 0.5);
      ctx.closePath();
      ctx.fill();
    }
    // Məsafə lövhələri
    for (const d of [200, 100]) {
      const s = exitS - d;
      if (s < sMin - 5 || s > sMax + 5) continue;
      const y = this.sy(s);
      const fs = Math.max(9, Math.min(12, ppm * 0.55));
      ctx.font = `700 ${fs}px ${FONT}`;
      const text = `${d} m`;
      const bw = ctx.measureText(text).width + fs;
      const x = Math.min(this.w - bw - 3, this.sx(ROAD_W + 0.35));
      ctx.fillStyle = '#1d4f91';
      rr(ctx, x, y - fs * 0.8, bw, fs * 1.6, 3);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, x + bw / 2, y + 1);
    }
  }

  // ------------------------------------------------------------------ keçid kölgəsi
  private drawPreview(world: World): void {
    const pv = world.preview;
    if (!pv) return;
    const ctx = this.ctx;
    const ppm = this.ppm;
    const p = world.player;
    const l = p.len * ppm;
    const w = CAR_W * ppm;
    const x = this.sx(laneCenter(pv.lane));
    const y = this.sy(pv.s);
    const pulse = 0.5 + 0.5 * Math.sin(world.t * 8);
    ctx.save();
    ctx.setLineDash([6, 5]);
    ctx.lineWidth = 2.5;
    if (pv.ok) {
      ctx.fillStyle = `rgba(80,230,140,${0.22 + pulse * 0.18})`;
      ctx.strokeStyle = '#6dff9e';
    } else {
      ctx.fillStyle = 'rgba(255,90,80,0.12)';
      ctx.strokeStyle = 'rgba(255,120,110,0.8)';
    }
    rr(ctx, x - w / 2, y - l / 2, w, l, w * 0.3);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
    // ox
    ctx.fillStyle = pv.ok ? '#6dff9e' : 'rgba(255,120,110,0.9)';
    const dir = Math.sign(pv.lane - p.lane);
    const ax = this.sx((laneCenter(p.lane) + laneCenter(pv.lane)) / 2);
    ctx.beginPath();
    ctx.moveTo(ax + dir * ppm * 0.6, y);
    ctx.lineTo(ax - dir * ppm * 0.2, y - ppm * 0.55);
    ctx.lineTo(ax - dir * ppm * 0.2, y + ppm * 0.55);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // ------------------------------------------------------------------ maşınlar
  private drawNpc(world: World, c: Npc, blinkOn: boolean): void {
    const ppm = this.ppm;
    const width = (c.style === 'bus' ? 2.5 : c.style === 'van' ? 2.0 : CAR_W) * ppm;
    const x = this.sx(c.x);
    const y = this.sy(c.s);
    if (y < -c.len * ppm || y > this.h + c.len * ppm) return;
    const turning = c.turnP >= 0 || (c.exitTurn && world.exitS - c.s < 30 && c.lane === LANES - 1);
    this.drawCar({
      x,
      y,
      angle: c.angle,
      len: c.len * ppm,
      wid: width,
      color: c.color,
      style: c.style,
      brake: c.braking,
      blinkL: false,
      blinkR: turning && blinkOn,
      flash: c.flashT > 0 && Math.floor(c.flashT * 8) % 2 === 0,
    });
  }

  private drawPlayer(world: World, blinkOn: boolean): void {
    const p = world.player;
    const ppm = this.ppm;
    const hazard = p.hazardT > 0 && Math.floor(p.hazardT / 0.2) % 2 === 0;
    const car: CarDraw = {
      x: this.sx(p.x),
      y: this.sy(p.s),
      angle: p.angle,
      len: p.len * ppm,
      wid: CAR_W * ppm,
      color: C.player,
      style: 'player',
      brake: p.braking,
      blinkL: hazard || (p.side < 0 && blinkOn),
      blinkR: hazard || (p.side > 0 && blinkOn),
      flash: false,
    };
    // oyunçunu ayırd etmək üçün yumşaq halo
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.rotate(car.angle);
    const g = ctx.createRadialGradient(0, 0, car.wid * 0.3, 0, 0, car.len * 0.75);
    g.addColorStop(0, 'rgba(24,207,195,0.28)');
    g.addColorStop(1, 'rgba(24,207,195,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-car.len, -car.len, car.len * 2, car.len * 2);
    ctx.restore();
    this.drawCar(car);
    // əl (pəncərədən)
    if (p.waveT > 0 && p.side !== 0) {
      const k = p.waveT;
      ctx.save();
      ctx.translate(car.x, car.y);
      ctx.rotate(car.angle);
      const hx = p.side * (car.wid / 2 + ppm * 0.45);
      const hy = -car.len * 0.02;
      ctx.rotate(Math.sin(k * 18) * 0.25);
      this.drawHand(hx, hy, ppm * 0.42, p.side);
      ctx.restore();
    }
    // siqnal dalğaları
    if (p.honkT > 0) {
      const k = 1 - p.honkT / 0.35;
      ctx.save();
      ctx.strokeStyle = `rgba(255,220,90,${1 - k})`;
      ctx.lineWidth = 3;
      for (let i = 0; i < 2; i++) {
        ctx.beginPath();
        ctx.arc(car.x, car.y - car.len / 2, ppm * (0.8 + k * 1.6 + i * 0.7), -Math.PI * 0.85, -Math.PI * 0.15);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  private drawHand(x: number, y: number, s: number, dir: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(dir, 1);
    ctx.fillStyle = '#f2c6a0';
    ctx.strokeStyle = '#7a4b2a';
    ctx.lineWidth = 1.2;
    rr(ctx, -s * 0.55, -s * 0.2, s * 1.1, s * 0.95, s * 0.35);
    ctx.fill();
    ctx.stroke();
    for (let i = 0; i < 4; i++) {
      const fx = -s * 0.5 + i * s * 0.3;
      rr(ctx, fx, -s * 0.85, s * 0.24, s * 0.75, s * 0.12);
      ctx.fill();
      ctx.stroke();
    }
    rr(ctx, s * 0.45, -s * 0.05, s * 0.45, s * 0.24, s * 0.12);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  drawCar(o: CarDraw): void {
    const ctx = this.ctx;
    const { len: l, wid: w } = o;
    const hl = l / 2;
    const hw = w / 2;
    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.rotate(o.angle);

    // fənər işığı
    if (o.flash) {
      const g = ctx.createRadialGradient(0, -hl - w * 0.4, 1, 0, -hl - w * 0.4, w * 1.6);
      g.addColorStop(0, 'rgba(255,248,200,0.85)');
      g.addColorStop(1, 'rgba(255,248,200,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-hw, -hl);
      ctx.lineTo(-hw * 2.2, -hl - w * 1.8);
      ctx.lineTo(hw * 2.2, -hl - w * 1.8);
      ctx.lineTo(hw, -hl);
      ctx.closePath();
      ctx.fill();
    }
    // kölgə
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    rr(ctx, -hw + 2, -hl + 4, w, l, w * 0.3);
    ctx.fill();
    // təkərlər
    ctx.fillStyle = '#121417';
    const tw = w * 0.16;
    const tl = Math.min(l * 0.18, w * 0.42);
    for (const ty of o.style === 'bus' ? [-hl * 0.7, hl * 0.55] : [-hl * 0.62, hl * 0.6]) {
      ctx.fillRect(-hw - tw * 0.35, ty - tl / 2, tw, tl);
      ctx.fillRect(hw - tw * 0.65, ty - tl / 2, tw, tl);
    }
    // gövdə
    const base = o.color;
    const grad = ctx.createLinearGradient(-hw, 0, hw, 0);
    grad.addColorStop(0, shade(base, -0.22));
    grad.addColorStop(0.3, base);
    grad.addColorStop(0.55, shade(base, 0.18));
    grad.addColorStop(0.8, base);
    grad.addColorStop(1, shade(base, -0.22));
    ctx.fillStyle = grad;
    const radius = o.style === 'boxy' ? w * 0.16 : o.style === 'bus' ? w * 0.12 : w * 0.32;
    rr(ctx, -hw, -hl, w, l, radius);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();

    if (o.style === 'bus') {
      this.drawBusTop(hl, hw);
    } else {
      this.drawCabin(o, hl, hw);
    }

    // fənərlər
    ctx.fillStyle = o.flash ? '#fffbe0' : '#f4efd2';
    const lw = w * 0.22;
    const lh = Math.max(2, l * 0.04);
    rr(ctx, -hw + w * 0.08, -hl + 1, lw, lh, lh / 2);
    ctx.fill();
    rr(ctx, hw - w * 0.08 - lw, -hl + 1, lw, lh, lh / 2);
    ctx.fill();
    // stop işıqları
    if (o.brake) {
      ctx.fillStyle = 'rgba(255,40,40,0.35)';
      ctx.beginPath();
      ctx.ellipse(-hw * 0.6, hl + 2, w * 0.28, w * 0.16, 0, 0, Math.PI * 2);
      ctx.ellipse(hw * 0.6, hl + 2, w * 0.28, w * 0.16, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = o.brake ? '#ff3131' : '#9e1f25';
    rr(ctx, -hw + w * 0.07, hl - lh - 1, lw, lh, lh / 2);
    ctx.fill();
    rr(ctx, hw - w * 0.07 - lw, hl - lh - 1, lw, lh, lh / 2);
    ctx.fill();
    // dönmə işıqları
    const blink = (sx: number) => {
      ctx.fillStyle = 'rgba(255,170,30,0.45)';
      for (const sy of [-hl, hl]) {
        ctx.beginPath();
        ctx.arc(sx * hw, sy, w * 0.26, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#ffb020';
      for (const sy of [-hl + 2, hl - 2]) {
        ctx.beginPath();
        ctx.arc(sx * (hw - 2), sy, Math.max(2, w * 0.08), 0, Math.PI * 2);
        ctx.fill();
      }
    };
    if (o.blinkL) blink(-1);
    if (o.blinkR) blink(1);
    ctx.restore();
  }

  private drawCabin(o: CarDraw, hl: number, hw: number): void {
    const ctx = this.ctx;
    const l = hl * 2;
    const w = hw * 2;
    let wsTop: number;
    let wsBot: number;
    let rwTop: number;
    let rwBot: number;
    switch (o.style) {
      case 'hatch':
        wsTop = -hl + l * 0.26;
        wsBot = -hl + l * 0.42;
        rwTop = hl - l * 0.17;
        rwBot = hl - l * 0.07;
        break;
      case 'van':
        wsTop = -hl + l * 0.12;
        wsBot = -hl + l * 0.26;
        rwTop = hl - l * 0.1;
        rwBot = hl - l * 0.04;
        break;
      case 'boxy':
        wsTop = -hl + l * 0.27;
        wsBot = -hl + l * 0.4;
        rwTop = hl - l * 0.3;
        rwBot = hl - l * 0.2;
        break;
      default:
        wsTop = -hl + l * 0.28;
        wsBot = -hl + l * 0.43;
        rwTop = hl - l * 0.3;
        rwBot = hl - l * 0.19;
    }
    // güzgülər
    ctx.fillStyle = shade(o.color, -0.25);
    ctx.beginPath();
    ctx.ellipse(-hw - w * 0.06, wsTop + 2, w * 0.1, w * 0.06, 0, 0, Math.PI * 2);
    ctx.ellipse(hw + w * 0.06, wsTop + 2, w * 0.1, w * 0.06, 0, 0, Math.PI * 2);
    ctx.fill();
    // ön şüşə
    const gl = ctx.createLinearGradient(0, wsTop, 0, wsBot);
    gl.addColorStop(0, '#3b4957');
    gl.addColorStop(1, C.glass);
    ctx.fillStyle = gl;
    ctx.beginPath();
    ctx.moveTo(-hw + w * 0.12, wsTop);
    ctx.lineTo(hw - w * 0.12, wsTop);
    ctx.lineTo(hw - w * 0.16, wsBot);
    ctx.lineTo(-hw + w * 0.16, wsBot);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath();
    ctx.moveTo(-hw + w * 0.2, wsTop + 1);
    ctx.lineTo(-hw + w * 0.38, wsTop + 1);
    ctx.lineTo(-hw + w * 0.28, wsBot - 1);
    ctx.lineTo(-hw + w * 0.2, wsBot - 1);
    ctx.closePath();
    ctx.fill();
    // arxa şüşə
    ctx.fillStyle = C.glass;
    ctx.beginPath();
    ctx.moveTo(-hw + w * 0.16, rwTop);
    ctx.lineTo(hw - w * 0.16, rwTop);
    ctx.lineTo(hw - w * 0.13, rwBot);
    ctx.lineTo(-hw + w * 0.13, rwBot);
    ctx.closePath();
    ctx.fill();
    // yan şüşələr
    ctx.fillStyle = 'rgba(38,48,58,0.85)';
    ctx.fillRect(-hw + w * 0.06, wsBot, w * 0.08, rwTop - wsBot);
    ctx.fillRect(hw - w * 0.14, wsBot, w * 0.08, rwTop - wsBot);
    // dam
    ctx.fillStyle = shade(o.color, o.color === '#1d2025' ? 0.08 : -0.06);
    rr(ctx, -hw + w * 0.16, wsBot, w * 0.68, rwTop - wsBot, w * 0.1);
    ctx.fill();
    if (o.style === 'player') {
      // ağ zolaqlar
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.fillRect(-w * 0.11, -hl + 2, w * 0.07, wsTop - (-hl + 2));
      ctx.fillRect(w * 0.04, -hl + 2, w * 0.07, wsTop - (-hl + 2));
      ctx.fillRect(-w * 0.11, wsBot, w * 0.07, rwTop - wsBot);
      ctx.fillRect(w * 0.04, wsBot, w * 0.07, rwTop - wsBot);
      ctx.fillRect(-w * 0.11, rwBot, w * 0.07, hl - 2 - rwBot);
      ctx.fillRect(w * 0.04, rwBot, w * 0.07, hl - 2 - rwBot);
    }
    if (o.style === 'taxi') {
      ctx.fillStyle = '#f7d046';
      const sw = w * 0.42;
      const sh = Math.max(4, l * 0.07);
      const sy = (wsBot + rwTop) / 2 - sh / 2;
      rr(ctx, -sw / 2, sy, sw, sh, 2);
      ctx.fill();
      ctx.fillStyle = '#2a1a3a';
      ctx.font = `800 ${Math.max(5, sh * 0.72)}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('TAXI', 0, sy + sh / 2 + 0.5);
    }
    if (o.style === 'van') {
      ctx.strokeStyle = 'rgba(0,0,0,0.12)';
      ctx.lineWidth = 1;
      for (let t = wsBot + l * 0.12; t < rwTop; t += l * 0.12) {
        ctx.beginPath();
        ctx.moveTo(-hw + w * 0.18, t);
        ctx.lineTo(hw - w * 0.18, t);
        ctx.stroke();
      }
    }
  }

  private drawBusTop(hl: number, hw: number): void {
    const ctx = this.ctx;
    const w = hw * 2;
    ctx.fillStyle = C.glass;
    ctx.fillRect(-hw + w * 0.1, -hl + 3, w * 0.8, w * 0.28);
    ctx.fillStyle = 'rgba(38,48,58,0.85)';
    ctx.fillRect(-hw + 1, -hl + w * 0.45, w * 0.07, hl * 2 - w * 0.7);
    ctx.fillRect(hw - 1 - w * 0.07, -hl + w * 0.45, w * 0.07, hl * 2 - w * 0.7);
    ctx.fillStyle = '#2b6cb0';
    ctx.fillRect(-hw + w * 0.1, -hl + w * 0.45, w * 0.06, hl * 2 - w * 0.7);
    ctx.fillStyle = '#cfd4d6';
    for (const t of [-0.35, 0.05, 0.45]) {
      rr(ctx, -w * 0.25, t * hl, w * 0.5, w * 0.45, 3);
      ctx.fill();
    }
  }

  /** Sürücünün "üzü": tipi və əhval-ruhiyyəsi aydın görünsün. */
  private drawNpcOverlay(world: World, c: Npc): void {
    if (c.turnP >= 0) return;
    const p = world.player;
    const ds = c.s - p.s;
    if (Math.abs(c.lane - p.lane) > 1 || ds < -11 || ds > 16) return;
    const ctx = this.ctx;
    const ppm = this.ppm;
    const x = this.sx(c.x);
    const y = this.sy(c.s);
    const r = Math.max(6, Math.min(12, ppm * 0.42));
    const isNeighbor = p.side !== 0 && world.neighbor(p.side) === c;
    const scale = isNeighbor ? 1.25 : 1;
    ctx.save();
    ctx.translate(x, y + (c.style === 'bus' ? -c.len * ppm * 0.3 : 0));
    ctx.scale(scale, scale);
    if (isNeighbor) {
      ctx.strokeStyle = '#ffd24a';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, r + 3, 0, Math.PI * 2);
      ctx.stroke();
    }
    const angry = c.state === 'block';
    const skin = angry ? '#f08a73' : '#f3cfa8';
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.arc(1, 1.5, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#5a3a22';
    ctx.lineWidth = 1.3;
    ctx.stroke();
    // saç
    ctx.fillStyle = '#3a2a1e';
    ctx.beginPath();
    ctx.arc(0, 0, r, Math.PI * 1.1, Math.PI * 1.9);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = '#2b1d12';
    ctx.fillStyle = '#2b1d12';
    ctx.lineWidth = Math.max(1.2, r * 0.14);
    ctx.lineCap = 'round';
    const e = r * 0.36;
    if (c.type === 'distracted' && c.state === 'phone') {
      // aşağı baxır + telefon
      ctx.beginPath();
      ctx.moveTo(-e - r * 0.15, r * 0.1);
      ctx.lineTo(-e + r * 0.15, r * 0.1);
      ctx.moveTo(e - r * 0.15, r * 0.1);
      ctx.lineTo(e + r * 0.15, r * 0.1);
      ctx.stroke();
      const pulse = 0.6 + 0.4 * Math.sin(world.t * 5 + c.id);
      ctx.fillStyle = `rgba(90,180,255,${0.35 * pulse})`;
      ctx.beginPath();
      ctx.arc(r * 0.2, r * 0.95, r * 0.75, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1b1f27';
      rr(ctx, -r * 0.15, r * 0.55, r * 0.7, r * 0.95, 2);
      ctx.fill();
      ctx.fillStyle = '#7fd0ff';
      rr(ctx, -r * 0.08, r * 0.62, r * 0.56, r * 0.72, 1.5);
      ctx.fill();
    } else if (angry || c.type === 'stubborn') {
      // qaşlar çatılıb
      ctx.beginPath();
      ctx.moveTo(-e - r * 0.22, -r * 0.2);
      ctx.lineTo(-e + r * 0.22, -r * 0.02);
      ctx.moveTo(e + r * 0.22, -r * 0.2);
      ctx.lineTo(e - r * 0.22, -r * 0.02);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(-e, r * 0.12, r * 0.09, 0, Math.PI * 2);
      ctx.arc(e, r * 0.12, r * 0.09, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      if (angry) ctx.arc(0, r * 0.7, r * 0.3, Math.PI * 1.15, Math.PI * 1.85);
      else {
        ctx.moveTo(-r * 0.25, r * 0.5);
        ctx.lineTo(r * 0.25, r * 0.5);
      }
      ctx.stroke();
      if (angry) {
        // buxar
        const k = (world.t * 1.5) % 1;
        ctx.fillStyle = `rgba(255,255,255,${0.8 * (1 - k)})`;
        ctx.beginPath();
        ctx.arc(-r * 1.1, -r * (0.6 + k), r * 0.25, 0, Math.PI * 2);
        ctx.arc(r * 1.1, -r * (0.6 + k), r * 0.25, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      // nəzakətli və ya diqqətli: təbəssüm
      const alert = c.state === 'alert';
      ctx.beginPath();
      ctx.arc(-e, 0, r * (alert ? 0.14 : 0.09), 0, Math.PI * 2);
      ctx.arc(e, 0, r * (alert ? 0.14 : 0.09), 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      if (alert) ctx.arc(0, r * 0.45, r * 0.16, 0, Math.PI * 2);
      else ctx.arc(0, r * 0.15, r * 0.42, Math.PI * 0.2, Math.PI * 0.8);
      ctx.stroke();
      if (!alert) {
        ctx.fillStyle = 'rgba(240,120,110,0.45)';
        ctx.beginPath();
        ctx.arc(-r * 0.6, r * 0.35, r * 0.16, 0, Math.PI * 2);
        ctx.arc(r * 0.6, r * 0.35, r * 0.16, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();

    // Yol verəndə: pəncərədən əl
    if (c.state === 'yield') {
      const dir = Math.sign(p.lane - c.lane) || 1;
      const hx = x + dir * (CAR_W / 2 + 0.5) * ppm;
      ctx.save();
      ctx.translate(hx, y - ppm * 0.3);
      ctx.rotate(Math.sin(world.t * 7) * 0.3 * dir);
      this.drawHand(0, 0, ppm * 0.4, dir);
      ctx.restore();
    }
  }

  // ------------------------------------------------------------------ yazılar
  private anchor(world: World, owner: Npc | null): { x: number; y: number; top: number } {
    if (owner) {
      const y = this.sy(owner.s);
      return { x: this.sx(owner.x), y, top: y - (owner.len * this.ppm) / 2 };
    }
    const p = world.player;
    const y = this.sy(p.s);
    return { x: this.sx(p.x), y, top: y - (p.len * this.ppm) / 2 };
  }

  private drawTexts(world: World): void {
    const ctx = this.ctx;
    // kiçik ipucları
    for (const t of world.tips) {
      const a = this.anchor(world, t.owner);
      const k = t.age / t.dur;
      const alpha = k < 0.8 ? 1 : (1 - k) / 0.2;
      const fs = 12;
      ctx.font = `800 ${fs}px ${FONT}`;
      const tw = ctx.measureText(t.text).width;
      const bw = tw + 12;
      const bh = fs + 8;
      const x = Math.max(4, Math.min(this.w - bw - 4, a.x - bw / 2));
      const y = Math.max(4, a.top - bh - 2 - k * 12);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = t.text === '!' ? '#ff5a3c' : '#ffd24a';
      rr(ctx, x, y, bw, bh, bh / 2);
      ctx.fill();
      ctx.fillStyle = t.text === '!' ? '#fff' : '#2a2008';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(t.text, x + bw / 2, y + bh / 2 + 0.5);
      ctx.globalAlpha = 1;
    }
    // danışıq buludları
    for (const b of world.bubbles) {
      const a = this.anchor(world, b.owner);
      const pop = Math.min(1, b.age / 0.15);
      const fade = b.age > b.dur - 0.3 ? (b.dur - b.age) / 0.3 : 1;
      const fs = this.w < 400 ? 13 : 14;
      ctx.font = `700 ${fs}px ${FONT}`;
      const lines = this.wrap(b.text, Math.min(190, this.w * 0.55));
      const tw = Math.max(...lines.map((l) => ctx.measureText(l).width));
      const bw = tw + 18;
      const lh = fs * 1.25;
      const bh = lines.length * lh + 12;
      const cx = a.x;
      const x = Math.max(6, Math.min(this.w - bw - 6, cx - bw / 2));
      const lift = world.tips.some((t) => t.owner === b.owner) ? 24 : 0;
      const y = Math.max(6, a.top - bh - 12 - lift);
      ctx.save();
      ctx.globalAlpha = Math.max(0, fade);
      ctx.translate(cx, y + bh);
      ctx.scale(0.7 + 0.3 * pop, 0.7 + 0.3 * pop);
      ctx.translate(-cx, -(y + bh));
      const own = b.owner === null;
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      rr(ctx, x + 2, y + 3, bw, bh, 12);
      ctx.fill();
      ctx.fillStyle = own ? '#e6fffb' : '#ffffff';
      rr(ctx, x, y, bw, bh, 12);
      ctx.fill();
      ctx.strokeStyle = own ? '#18cfc3' : '#2c2f36';
      ctx.lineWidth = 2;
      ctx.stroke();
      // quyruq
      const tx = Math.max(x + 12, Math.min(x + bw - 12, cx));
      ctx.beginPath();
      ctx.moveTo(tx - 7, y + bh - 1);
      ctx.lineTo(tx, y + bh + 9);
      ctx.lineTo(tx + 7, y + bh - 1);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(tx - 7, y + bh);
      ctx.lineTo(tx, y + bh + 9);
      ctx.lineTo(tx + 7, y + bh);
      ctx.stroke();
      ctx.fillStyle = '#1d2026';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      lines.forEach((l, i) => ctx.fillText(l, x + bw / 2, y + 6 + lh * (i + 0.5) + 0.5));
      ctx.restore();
    }
  }

  private wrap(text: string, max: number): string[] {
    const words = text.split(' ');
    const lines: string[] = [];
    let cur = '';
    for (const w of words) {
      const t = cur ? `${cur} ${w}` : w;
      if (this.ctx.measureText(t).width > max && cur) {
        lines.push(cur);
        cur = w;
      } else cur = t;
    }
    if (cur) lines.push(cur);
    return lines;
  }
}
