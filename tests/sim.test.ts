/**
 * Başsız (headless) simulyasiya testi: bir çox təsadüfi raundu avtopilotla oynayır
 * və əsas invariantları yoxlayır — maşınlar üst-üstə düşmür, teleport olmur,
 * oyun həmişə qazanıla bilir, heç nə etməyən oyunçu isə dönüşü keçir.
 */
import { Bot } from '../src/bot';
import { LANES, LANE_W, CAR_W, World, type Body } from '../src/world';

const DT = 1 / 60;
let failures = 0;

function check(cond: boolean, msg: string): void {
  if (!cond) {
    failures++;
    if (failures < 15) console.error('XƏTA:', msg);
  }
}

function lanesOf(w: World, b: Body): number[] {
  if (b === w.player) {
    const p = w.player;
    if (p.turnP >= 0.3) return [];
    const res: number[] = [];
    // Fiziki kəsişmə: iki maşının yarım enlərinin cəmi
    for (let l = 0; l < LANES; l++) {
      if (Math.abs(p.x - (l + 0.5) * LANE_W) < CAR_W) res.push(l);
    }
    return res;
  }
  const c = b as World['npcs'][number];
  return c.turnP >= 0.3 ? [] : [c.lane];
}

function checkInvariants(w: World, prev: Map<Body, number>, seed: number): void {
  const bodies: Body[] = [w.player, ...w.npcs];
  for (let l = 0; l < LANES; l++) {
    const inLane = bodies.filter((b) => lanesOf(w, b).includes(l)).sort((a, b) => b.s - a.s);
    for (let i = 1; i < inLane.length; i++) {
      const a = inLane[i - 1];
      const b = inLane[i];
      const gap = a.s - a.len / 2 - (b.s + b.len / 2);
      check(gap > 0.05, `seed ${seed} t=${w.t.toFixed(2)} zolaq ${l}: üst-üstə düşmə (gap ${gap.toFixed(2)})`);
    }
  }
  for (const b of bodies) {
    const before = prev.get(b);
    if (before !== undefined) {
      const ds = b.s - before;
      check(ds > -0.3 && ds < 0.5, `seed ${seed} t=${w.t.toFixed(2)}: teleport ${ds.toFixed(2)} m`);
    }
    prev.set(b, b.s);
  }
}

type Result = { outcome: string; time: number; merges: number; stress: number; maxStress: number };

function play(seed: number, makeBot: (() => Bot) | null, checks = true): Result {
  const w = new World(seed, 'play');
  const bot = makeBot ? makeBot() : null;
  const prev = new Map<Body, number>();
  let maxStress = 0;
  for (let i = 0; i < 60 * 200 && (w.status === 'running' || w.status === 'turning'); i++) {
    bot?.step(w, DT);
    w.update(DT);
    maxStress = Math.max(maxStress, w.stress);
    if (checks) checkInvariants(w, prev, seed);
  }
  return { outcome: w.status, time: w.elapsed, merges: w.stats.merges, stress: w.stress, maxStress };
}

function summary(name: string, results: Result[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of results) counts[r.outcome] = (counts[r.outcome] ?? 0) + 1;
  const won = results.filter((r) => r.outcome === 'won');
  const avg = won.reduce((a, r) => a + r.time, 0) / Math.max(1, won.length);
  const maxT = Math.max(0, ...won.map((r) => r.time));
  console.log(
    `${name.padEnd(16)} ${JSON.stringify(counts)}  qalib orta vaxt: ${avg.toFixed(1)}s  max: ${maxT.toFixed(1)}s`,
  );
  return counts;
}

const N = Number((globalThis as { process?: { env: Record<string, string> } }).process?.env.N ?? 120);
const seeds = Array.from({ length: N }, (_, i) => 1000 + i * 7919);

const smart = summary('ağıllı bot', seeds.map((s) => play(s, () => new Bot(2))));
const spam = summary('siqnal spam', seeds.map((s) => play(s, () => new Bot(2, { spam: true }))));
const slow = summary('yavaş insan', seeds.map((s) => play(s, () => new Bot(2, { slow: true }))));
const idle = summary('heç nə etmir', seeds.slice(0, 40).map((s) => play(s, null)));

check((smart.won ?? 0) >= N * 0.97, `ağıllı bot çox az qazanır: ${smart.won}/${N}`);
check((slow.won ?? 0) >= N * 0.85, `yavaş oyunçu üçün çox çətindir: ${slow.won}/${N}`);
// Daim siqnal basan oyunçu cəzalanır (sürücülər az yol verir), amma tam kilidlənmir.
check((spam.won ?? 0) >= N * 0.5, `siqnal spam oyunçunu çıxılmaz vəziyyətə salır: ${spam.won}/${N}`);
check((idle.won ?? 0) === 0, 'heç nə etməyən oyunçu qazanmamalıdır');

// Ekranda NPC-lər də üst-üstə düşməsin: demo rejimi 60 saniyə
{
  const w = new World(42, 'demo');
  const bot = new Bot(1, { roam: true });
  const prev = new Map<Body, number>();
  for (let i = 0; i < 60 * 60; i++) {
    bot.step(w, DT);
    w.update(DT);
    checkInvariants(w, prev, 42);
  }
  console.log(`demo: ${w.stats.merges} zolaq dəyişmə, ${w.npcs.length} maşın`);
  check(w.stats.merges >= 3, 'demo avtopilot zolaq dəyişmir');
}

if (failures) {
  console.error(`\n${failures} xəta tapıldı`);
  (globalThis as { process?: { exitCode?: number } }).process!.exitCode = 1;
} else {
  console.log('\nBütün yoxlamalar keçdi.');
}
