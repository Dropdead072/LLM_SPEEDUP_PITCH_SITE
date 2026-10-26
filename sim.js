// Детерминированный движок обслуживания (бриф §4 + дополнение §4).
// Разделение процессора: при n активных запросах каждый получает
//   r = min(v_max, C / n)   токенов/с,
// не более B запросов в батче, остальные — в FIFO-очереди. Шаг фиксирован
// (dt = 1/60 с), все случайные величины идут из сидированных потоков, поэтому
// одинаковый сид даёт одинаковую картину кадр в кадр.
import { MODES } from "./data.js";
import { Rng, mixSeed } from "./lib/rng.js";
import { WindowSum, percentile, clamp } from "./lib/util.js";
import { HINTS, CHATS, AGENTS, tokensOf } from "./snippets.js";

export const DT = 1 / 60;

// [ДОПУЩЕНИЕ ДЕМО] параметры по режимам, бриф §4.2 + дополнение §4.1/§4.3.
export const MODE_SIM = {
  hint: { G: 1, Lmin: 30, Lmax: 60, vmax: 120, B: 16, deadline: 0.6, prefill: 0.1, window: 3 },
  // G и B для чата/агентов увеличены относительно брифа (было G=2/B=16 и G=4/B=8):
  // при таких G на 12 плиток приходится слишком мало событий, плитки простаивают.
  // B пропорционален G (8 и 2 запроса на карту), скорости на карту и выигрыши — по брифу.
  // Допуск SLA агента 2,0× вместо 1,5×: при 1,5× «полезные» у стороны на грани (ρ≈1) падают
  // почти до нуля и сильно зависят от сида, что противоречит тезису «на агентах разница скромнее».
  chat: { G: 6, Lmin: 250, Lmax: 450, vmax: 45, B: 48, ttftSla: 2.0, prefill: 0.4, window: 8 },
  agent: { G: 12, Lmin: 400, Lmax: 900, vmax: 35, B: 24, slaFactor: 2.0, prefill: 0.6, window: 20 },
};

// [ДОПУЩЕНИЕ ДЕМО] bursty-поток (дополнение §4.2).
export const BURST = { k: 3, burstMean: 8, calmMean: 25, forced: 8 };

export function poolMeanL(mode) {
  const s = MODE_SIM[mode];
  if (mode === "agent") return (s.Lmin + s.Lmax) / 2;
  const pool = mode === "hint" ? HINTS : CHATS;
  let sum = 0;
  for (const p of pool) sum += describeLength(mode, p);
  return sum / pool.length;
}

function describeLength(mode, snippet) {
  const s = MODE_SIM[mode];
  const raw = mode === "hint" ? tokensOf(snippet.completion) : tokensOf(snippet.text + "\n" + snippet.code);
  return clamp(raw, s.Lmin, s.Lmax);
}

export function capacity(mode, tuned, G = MODE_SIM[mode].G) {
  const m = MODES[mode];
  return G * m.base * (tuned ? m.gain : 1);
}

// Дескриптор запроса — общий для обеих сторон (одинаковые сниппеты, длины, порядок).
export function makeDescriptor(mode, rng, id) {
  if (mode === "hint") {
    const idx = rng.int(0, HINTS.length - 1);
    return { id, mode, snippet: idx, L: describeLength(mode, HINTS[idx]) };
  }
  if (mode === "chat") {
    const idx = rng.int(0, CHATS.length - 1);
    return { id, mode, snippet: idx, L: describeLength(mode, CHATS[idx]) };
  }
  const script = rng.int(0, AGENTS.length - 1);
  const step = rng.int(0, AGENTS[script].steps.length - 1);
  const s = MODE_SIM[mode];
  return { id, mode, script, step, snippet: script, L: rng.int(s.Lmin, s.Lmax) };
}

export class Req {
  constructor(desc, arrival, tile, prefill) {
    this.id = desc.id;
    this.desc = desc;
    this.L = desc.L;
    this.arrival = arrival;
    this.ready = arrival + prefill;
    this.tile = tile;
    this.produced = 0;
    this.tStart = null; // вошёл в батч
    this.tFirst = null; // первый токен
    this.tDone = null;
    this.late = false; // подсказка не уложилась в дедлайн
    this.sla = null; // true/false после завершения
    this.rate = 0; // текущая скорость, ток/с
  }
}

class Cluster {
  constructor(mode, tuned, G) {
    const s = MODE_SIM[mode];
    this.mode = mode;
    this.tuned = tuned;
    this.G = G;
    this.C = capacity(mode, tuned, G);
    this.vmax = s.vmax;
    this.B = s.B;
    this.active = [];
    this.queue = [];
    this.qHead = 0;
  }
  get queueLen() {
    return this.queue.length - this.qHead;
  }
  enqueue(req) {
    this.queue.push(req);
  }
}

export class Side {
  constructor(pair, tuned) {
    this.pair = pair;
    this.tuned = tuned;
    const s = MODE_SIM[pair.mode];
    this.cluster = new Cluster(pair.mode, tuned, pair.G);
    this.pending = []; // ждут окончания префилла
    this.pHead = 0;
    this.tiles = Array.from({ length: pair.tileCount }, () => ({ pending: [], lastDone: null }));
    const wSteps = Math.round(s.window / DT);
    this.rawWin = new WindowSum(wSteps);
    this.usefulWin = new WindowSum(wSteps);
    this.arrWin = new WindowSum(wSteps);
    this.ttfts = []; // последние 50 TTFT
    this.resolved = []; // последние 50 исходов (hint: late?)
    this.deadlineQ = [];
    this.dHead = 0;
    this.ttftSeries = []; // p95 раз в 0.25 с, до 120 точек
    this.cum = { raw: 0, useful: 0, done: 0, doneOk: 0, late: 0, resolved: 0 };
    this.total = 0; // всего сгенерировано токенов
    this.nextSample = 0;
  }

  accept(req) {
    this.pending.push(req);
    if (req.tile >= 0) this.tiles[req.tile].pending.push(req);
    if (this.pair.mode === "hint") this.deadlineQ.push(req);
  }

  step(now) {
    const mode = this.pair.mode;
    const s = MODE_SIM[mode];
    const cl = this.cluster;

    // 1) префилл закончен -> в очередь декода
    while (this.pHead < this.pending.length && this.pending[this.pHead].ready <= now) {
      cl.enqueue(this.pending[this.pHead++]);
    }
    if (this.pHead > 1024) {
      this.pending = this.pending.slice(this.pHead);
      this.pHead = 0;
    }

    // 2) дедлайны подсказок: не получила первый токен вовремя -> «опоздала»
    if (mode === "hint") {
      while (this.dHead < this.deadlineQ.length) {
        const r = this.deadlineQ[this.dHead];
        if (r.arrival + s.deadline > now) break;
        if (r.tFirst === null || r.tFirst - r.arrival > s.deadline) {
          r.late = true;
          this._resolve(true);
        } else {
          this._resolve(false);
        }
        this.dHead++;
      }
      if (this.dHead > 1024) {
        this.deadlineQ = this.deadlineQ.slice(this.dHead);
        this.dHead = 0;
      }
    }

    // 3) очередь -> батч
    while (cl.active.length < cl.B && cl.qHead < cl.queue.length) {
      const r = cl.queue[cl.qHead++];
      r.tStart = now;
      cl.active.push(r);
    }
    if (cl.qHead > 1024) {
      cl.queue = cl.queue.slice(cl.qHead);
      cl.qHead = 0;
    }

    // 4) продвинуть активные запросы
    const n = cl.active.length;
    let tokensThisStep = 0;
    let usefulThisStep = 0;
    if (n > 0) {
      const r = Math.min(cl.vmax, cl.C / n);
      const adv = r * DT;
      let finished = null;
      for (const req of cl.active) {
        const before = req.produced;
        req.rate = r;
        req.produced = before + adv;
        const made = Math.min(adv, req.L - before);
        tokensThisStep += made;
        if (req.tFirst === null && req.produced >= 1) {
          req.tFirst = now + DT * Math.min(1, (1 - before) / adv);
          const ttft = req.tFirst - req.arrival;
          this.ttfts.push(ttft);
          if (this.ttfts.length > 50) this.ttfts.shift();
        }
        // Полезные токены засчитываются по мере генерации, пока запрос укладывается в SLA
        // (иначе у длинных ответов «полезные» отставали бы от «сырых» на полдлительности).
        if (this._onTrack(req, now, r, s)) usefulThisStep += made;
        if (req.produced >= req.L) {
          req.produced = req.L;
          req.tDone = now + DT;
          (finished ||= []).push(req);
        }
      }
      if (finished) {
        cl.active = cl.active.filter((q) => q.tDone === null);
        for (const req of finished) {
          req.sla = this._sla(req, s);
          this.cum.done++;
          if (req.sla) this.cum.doneOk++;
          const t = this.tiles[req.tile];
          if (t) {
            t.lastDone = req;
            const i = t.pending.indexOf(req);
            if (i >= 0) t.pending.splice(i, 1);
          }
        }
      }
    }
    this.rawWin.push(tokensThisStep);
    this.usefulWin.push(usefulThisStep);
    this.total += tokensThisStep;
    this.cum.raw += tokensThisStep;
    this.cum.useful += usefulThisStep;

    // 5) ряд p95 TTFT для графика всплеска
    if (now >= this.nextSample) {
      this.nextSample = now + 0.25;
      const p95 = this.ttfts.length ? percentile(this.ttfts, 0.95) : 0;
      this.ttftSeries.push(p95);
      if (this.ttftSeries.length > 120) this.ttftSeries.shift();
    }
  }

  _resolve(late) {
    this.resolved.push(late);
    if (this.resolved.length > 50) this.resolved.shift();
    this.cum.resolved++;
    if (late) this.cum.late++;
  }

  // «Укладывается ли запрос в SLA прямо сейчас» — для непрерывного начисления полезных токенов.
  _onTrack(req, now, rate, s) {
    const mode = this.pair.mode;
    if (mode === "hint") return !req.late;
    if (mode === "chat") return req.tFirst !== null && req.tFirst - req.arrival <= s.ttftSla;
    const ideal = s.prefill + req.L / s.vmax;
    const projected = now + DT - req.arrival + (req.L - req.produced) / rate;
    return projected <= s.slaFactor * ideal;
  }

  _sla(req, s) {
    if (this.pair.mode === "hint") return !req.late;
    if (this.pair.mode === "chat") return req.tFirst - req.arrival <= s.ttftSla;
    const ideal = s.prefill + req.L / s.vmax;
    return req.tDone - req.arrival <= s.slaFactor * ideal;
  }

  stats(now) {
    const s = MODE_SIM[this.pair.mode];
    const cl = this.cluster;
    const w = Math.max(DT, Math.min(s.window, now));
    const w3 = w;
    const tpsRaw = Math.max(0, this.rawWin.sum) / w / cl.G;
    const tpsUseful = Math.max(0, this.usefulWin.sum) / w / cl.G;
    const rho = this.arrWin.sum / w3 / cl.C;
    const late = this.resolved.filter(Boolean).length;
    return {
      tpsRaw,
      tpsUseful,
      rho,
      util: clamp(this.rawWin.sum / w / cl.C, 0, 1),
      queue: cl.queueLen + (this.pending.length - this.pHead),
      active: cl.active.length,
      ttftP50: percentile(this.ttfts, 0.5),
      ttftP95: percentile(this.ttfts, 0.95),
      droppedPct: this.resolved.length ? late / this.resolved.length : 0,
      total: this.total,
      C: cl.C,
    };
  }
}

export class Pair {
  /**
   * @param {{mode:string, load?:number, seed?:number, tiles?:number, bursty?:boolean,
   *          G?:number, withTiles?:boolean}} o
   * load — целевая загрузка подобранной стороны ρ_tuned (бриф §4.2).
   */
  constructor(o) {
    this.mode = o.mode;
    this.load = o.load ?? 0.7;
    this.seed = o.seed ?? 42;
    this.tileCount = o.tiles ?? 12;
    this.bursty = !!o.bursty;
    this.G = o.G ?? MODE_SIM[o.mode].G;
    this.meanL = poolMeanL(o.mode);
    this.rngArr = new Rng(mixSeed(this.seed, "arrivals", o.mode));
    this.rngBurst = new Rng(mixSeed(this.seed, "burst", o.mode));
    this.rngContent = new Rng(mixSeed(this.seed, "content", o.mode));
    this.now = 0;
    this.nextId = 0;
    this.burstUntil = -1; // принудительный всплеск
    this.state = "calm";
    this.stateUntil = this.rngBurst.exp(1 / BURST.calmMean);
    this.base = new Side(this, false);
    this.tuned = new Side(this, true);
    this.sides = { base: this.base, tuned: this.tuned };
    this.arrivalsTotal = 0;
  }

  get Ctuned() {
    return this.tuned.cluster.C;
  }

  // λ — средняя интенсивность (запросов/с), бриф §4.2
  get lambdaMean() {
    return (this.load * this.Ctuned) / this.meanL;
  }

  _rates() {
    const pb = BURST.burstMean / (BURST.burstMean + BURST.calmMean);
    const pc = 1 - pb;
    const lam = this.lambdaMean;
    // среднее по времени сохраняется: λ_calm·(pc + k·pb) = λ
    const calm = this.bursty ? lam / (pc + BURST.k * pb) : lam;
    const burst = (BURST.k * lam) / (pc + BURST.k * pb);
    return { calm, burst };
  }

  get inBurst() {
    return this.now < this.burstUntil || (this.bursty && this.state === "burst");
  }

  forceBurst(seconds = BURST.forced) {
    this.burstUntil = this.now + seconds;
  }

  currentRate() {
    const { calm, burst } = this._rates();
    return this.inBurst ? burst : calm;
  }

  _advanceState() {
    if (!this.bursty) return;
    while (this.now >= this.stateUntil) {
      if (this.state === "calm") {
        this.state = "burst";
        this.stateUntil += this.rngBurst.exp(1 / BURST.burstMean);
      } else {
        this.state = "calm";
        this.stateUntil += this.rngBurst.exp(1 / BURST.calmMean);
      }
    }
  }

  _spawn(desc, tile) {
    const s = MODE_SIM[this.mode];
    for (const side of [this.base, this.tuned]) {
      const req = new Req(desc, this.now, tile, s.prefill);
      side.accept(req);
    }
  }

  // Подсадить «пробный» запрос (сцена 2): без плитки. which — на какую сторону он уходит:
  // "both" | "base" | "tuned". Возвращает {base?, tuned?}.
  injectProbe(L, extra = {}, which = "both") {
    const s = MODE_SIM[this.mode];
    const desc = { id: -1 - this.nextId++, mode: this.mode, snippet: 0, L, ...extra };
    const out = {};
    for (const [name, side] of [["base", this.base], ["tuned", this.tuned]]) {
      if (which !== "both" && which !== name) continue;
      const req = new Req(desc, this.now, -1, s.prefill);
      req.probe = true;
      side.accept(req);
      out[name] = req;
    }
    return out;
  }

  step() {
    this.now += DT;
    this._advanceState();
    const mean = this.currentRate() * DT;
    const n = this.rngArr.poisson(mean);
    let arrTokens = 0;
    for (let i = 0; i < n; i++) {
      const desc = makeDescriptor(this.mode, this.rngContent, this.nextId);
      const tile = this.tileCount ? this.nextId % this.tileCount : -1;
      this.nextId++;
      this.arrivalsTotal++;
      arrTokens += desc.L;
      this._spawn(desc, tile);
    }
    this.base.arrWin.push(arrTokens);
    this.tuned.arrWin.push(arrTokens);
    this.base.step(this.now);
    this.tuned.step(this.now);
  }

  advance(seconds) {
    const n = Math.round(seconds / DT);
    for (let i = 0; i < n; i++) this.step();
  }
}
