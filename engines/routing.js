// RoutingSim — маршрутизация запросов между репликами (сцена 8, кейсы C1–C3).
// ИЛЛЮСТРАЦИЯ МЕХАНИЗМА: числа здесь — параметры демо, не результаты замеров;
// в финмодели и в презентации нет чисел про кэш и маршрутизацию, поэтому на
// экране нет ни одного множителя «×N» и ни одного рубля.
//
// Модель реплики:
//   префилл — один сервер на реплику со скоростью P ток/с; обрабатывает только
//             НЕкэшированную часть промпта: попадание префикса = префилл ≈ 0;
//   декод   — B слотов (память под KV длинных сессий ограничена), разделение
//             процессора как в sim.js: r = min(v_max, C_dec / n);
//   кэш     — LRU префиксов репозиториев ёмкостью cap штук на реплику.
// TTFT = ожидание префилла + префилл + ожидание слота декода + 1/r.
import { Rng, mixSeed } from "../lib/rng.js";
import { percentile } from "../lib/util.js";

export const DT = 1 / 60;

// [ДОПУЩЕНИЕ ДЕМО] общие параметры реплики
export const REPLICA = {
  prefillRate: 24000, // ток/с на одну реплику (2 GPU)
  decodeCap: 260, // ток/с суммарно на реплику
  vmax: 60, // ток/с на пользователя
  slots: 4, // одновременных декод-сессий (KV длинных контекстов)
  cacheRepos: 1, // сколько префиксов держит кэш реплики (префикс ~100k токенов занимает почти весь KV)
  chunk: 2000, // размер куска при chunked-префилле
  capLoad: 6, // потолок загрузки «своей» реплики, с ожидания: выше — перелив на свободные
};

export const POLICIES = {
  round_robin: { label: "Round-robin", blurb: "запросы по кругу — репозитории размазаны по всем репликам", sched: "fifo" },
  least_loaded: { label: "Наименее загруженная", blurb: "всегда на самую свободную реплику — кэш не учитывается", sched: "fifo" },
  prefix_affinity: { label: "Только сродство", blurb: "репозиторий всегда на «свою» реплику — кэш попадает, но одна реплика греется", sched: "fifo" },
  affinity_with_cap: { label: "Сродство + потолок загрузки", blurb: "«свой» репозиторий, пока реплика не перегрета, дальше перелив на свободные", sched: "fifo" },
  class_pools: { label: "Пулы по классам", blurb: "подсказкам — своя реплика, тяжёлым запросам — остальные", sched: "fifo" },
  priority_chunked: { label: "Приоритет + куски", blurb: "подсказки вперёд; префилл агента режется на куски по 2k токенов", sched: "priority" },
  fair_share: { label: "Fair share", blurb: "квоты по tenant: громкий сосед не вытесняет остальных", sched: "fair" },
  fair_pools: { label: "Fair share + пулы", blurb: "квоты и свой пул под каждый tenant", sched: "fair" },
};

// ---------- сценарии нагрузки ----------
export const SCENARIOS = {
  // сцена 8 / C2: 12 разработчиков в 3 больших репозиториях (популярность неравная)
  repo: {
    replicas: 3,
    classes: {
      chat: { prefix: 96000, uniq: [1500, 3000], out: [380, 620], prio: 1, sla: 3.0, label: "чат по репо" },
    },
    sources: Array.from({ length: 12 }, (_, i) => ({
      id: i,
      repo: i < 6 ? 0 : i < 10 ? 1 : 2,
      tenant: 0,
      cls: "chat",
      rate: 0.09, // запросов/с на разработчика
    })),
    repos: 3,
  },
  // C1: на одном пуле подсказки и агенты
  classes: {
    replicas: 3,
    classes: {
      hint: { prefix: 0, uniq: [2000, 5000], out: [30, 60], prio: 0, sla: 0.6, label: "подсказки" },
      agent: { prefix: 96000, uniq: [1500, 3000], out: [380, 560], prio: 2, sla: 8, label: "агенты" },
    },
    sources: [
      ...Array.from({ length: 8 }, (_, i) => ({ id: i, repo: 0, tenant: 0, cls: "hint", rate: 0.45 })),
      ...Array.from({ length: 4 }, (_, i) => ({ id: 8 + i, repo: i % 2, tenant: 0, cls: "agent", rate: 0.06 })),
    ],
    repos: 2,
  },
  // C3: три tenant на пуле провайдера; у стартапа всплеск
  tenants: {
    replicas: 3,
    classes: {
      hint: { prefix: 0, uniq: [2000, 5000], out: [30, 60], prio: 0, sla: 0.8, label: "банк · подсказки" },
      chat: { prefix: 48000, uniq: [1500, 3000], out: [250, 420], prio: 1, sla: 4, label: "IT · чат" },
      agent: { prefix: 96000, uniq: [1500, 3000], out: [380, 560], prio: 2, sla: 12, label: "стартап · агенты" },
    },
    sources: [
      ...Array.from({ length: 6 }, (_, i) => ({ id: i, repo: 0, tenant: 0, cls: "hint", rate: 0.5 })),
      ...Array.from({ length: 4 }, (_, i) => ({ id: 6 + i, repo: 1, tenant: 1, cls: "chat", rate: 0.07 })),
      ...Array.from({ length: 2 }, (_, i) => ({ id: 10 + i, repo: 2, tenant: 2, cls: "agent", rate: 0.05, burst: true })),
    ],
    repos: 3,
    tenantNames: ["Банк", "IT-компания", "Стартап"],
  },
};

class Replica {
  constructor(i) {
    this.i = i;
    this.cache = []; // ключи репозиториев, последний — самый свежий
    this.pq = []; // задания префилла
    this.dq = []; // ждут слот декода
    this.active = [];
    this.pBusy = 0; // сглаженная занятость префилл-сервера
    this.vt = {}; // fair share: виртуальное время по tenant
    this.prefillTokensLeft = 0;
  }
  load() {
    // оценка «сколько секунд ждать до первого токена» — для least_loaded и потолка
    return this.prefillTokensLeft / REPLICA.prefillRate + this.dq.length * 2.0 + Math.max(0, this.active.length - 2) * 0.5;
  }
}

export class RoutingSim {
  constructor({ scenario = "repo", policy = "round_robin", seed = 42, burstAt = -1 } = {}) {
    this.sc = SCENARIOS[scenario];
    this.scenario = scenario;
    this.policy = policy;
    this.seed = seed;
    this.rngA = new Rng(mixSeed(seed, "route-arr", scenario));
    this.rngC = new Rng(mixSeed(seed, "route-cont", scenario));
    this.now = 0;
    this.nextId = 0;
    this.replicas = Array.from({ length: this.sc.replicas }, (_, i) => new Replica(i));
    this.rr = 0;
    this.burstAt = burstAt;
    this.burstUntil = -1;
    this.done = [];
    this.recent = []; // события для визуализации
    this.hits = 0;
    this.lookups = 0;
    this.winHits = [];
    this.series = []; // p95 TTFT по времени
    this.nextSample = 0;
    this.byClass = {};
    this.byTenant = {};
    for (const k of Object.keys(this.sc.classes)) this.byClass[k] = [];
    for (let t = 0; t < 3; t++) this.byTenant[t] = [];
    this.arrivals = 0;
    this.classScale = {}; // множители интенсивности по классам (ползунок «доля агентов»)
  }

  setPolicy(p) {
    this.policy = p;
  }

  forceBurst(seconds = 10) {
    this.burstUntil = this.now + seconds;
  }

  _rate(src) {
    let r = src.rate * (this.classScale[src.cls] ?? 1);
    if (src.burst && (this.now < this.burstUntil || (this.burstAt >= 0 && this.now >= this.burstAt && this.now < this.burstAt + 10)))
      r *= 7;
    return r;
  }

  _spawn(src) {
    const cl = this.sc.classes[src.cls];
    const uniq = Math.round(this.rngC.range(cl.uniq[0], cl.uniq[1]));
    const out = Math.round(this.rngC.range(cl.out[0], cl.out[1]));
    const req = {
      id: this.nextId++,
      src: src.id,
      cls: src.cls,
      repo: src.repo,
      tenant: src.tenant,
      prio: cl.prio,
      prefix: cl.prefix,
      uniq,
      out,
      arrival: this.now,
      replica: -1,
      hit: null,
      pTokens: 0,
      pLeft: 0,
      tFirst: null,
      tDone: null,
      produced: 0,
      stage: "route",
    };
    this.arrivals++;
    this._route(req);
  }

  _affinity(req) {
    // репозиторий → «своя» реплика (для классов без префикса — по источнику)
    return (req.cls === "hint" ? req.src : req.repo) % this.replicas.length;
  }

  _route(req) {
    const R = this.replicas;
    const n = R.length;
    const least = (list) => list.reduce((a, b) => (b.load() < a.load() ? b : a));
    let target;
    switch (this.policy) {
      case "round_robin":
        target = R[this.rr++ % n];
        break;
      case "least_loaded":
        target = least(R);
        break;
      case "prefix_affinity":
        target = R[this._affinity(req)];
        break;
      case "affinity_with_cap": {
        const home = R[this._affinity(req)];
        target = home.load() > REPLICA.capLoad ? least(R.filter((r) => r !== home)) : home;
        break;
      }
      case "class_pools":
      case "fair_pools": {
        // реплика 0 — «быстрый» пул (подсказки), остальные — тяжёлые запросы по сродству с потолком
        if (req.cls === "hint") target = R[0];
        else {
          const heavy = R.slice(1);
          const home = heavy[req.repo % heavy.length];
          target = home.load() > REPLICA.capLoad ? least(heavy) : home;
        }
        break;
      }
      case "priority_chunked":
      case "fair_share":
        target = least(R);
        break;
      default:
        target = R[0];
    }
    req.replica = target.i;
    // кэш префикса
    if (req.prefix > 0) {
      const idx = target.cache.indexOf(req.repo);
      this.lookups++;
      if (idx >= 0) {
        req.hit = true;
        this.hits++;
        target.cache.splice(idx, 1);
        target.cache.push(req.repo);
        req.pTokens = req.uniq;
      } else {
        req.hit = false;
        target.cache.push(req.repo);
        if (target.cache.length > REPLICA.cacheRepos) target.cache.shift();
        req.pTokens = req.prefix + req.uniq;
      }
    } else {
      req.pTokens = req.uniq;
    }
    req.pLeft = req.pTokens;
    target.prefillTokensLeft += req.pTokens;
    target.pq.push(req);
    req.stage = "prefill";
    this.recent.push({ t: this.now, req });
    if (this.recent.length > 200) this.recent.shift();
  }

  // порядок выбора задания префилла на реплике
  _pick(rep) {
    const sched = POLICIES[this.policy].sched;
    if (sched === "fifo") return rep.pq[0];
    let best = null;
    if (sched === "priority") {
      for (const j of rep.pq) if (!best || j.prio < best.prio) best = j;
      return best;
    }
    // fair: у кого меньше виртуальное время tenant — тому и префилл
    for (const j of rep.pq) {
      const vt = rep.vt[j.tenant] ?? 0;
      const bvt = best ? rep.vt[best.tenant] ?? 0 : Infinity;
      if (!best || vt < bvt - 1e-9) best = j;
    }
    return best;
  }

  step() {
    this.now += DT;
    // приходы
    for (const src of this.sc.sources) {
      const n = this.rngA.poisson(this._rate(src) * DT);
      for (let i = 0; i < n; i++) this._spawn(src);
    }
    const sched = POLICIES[this.policy].sched;
    for (const rep of this.replicas) {
      // --- префилл ---
      let budget = REPLICA.prefillRate * DT;
      let busy = false;
      while (budget > 0 && rep.pq.length) {
        const job = this._pick(rep);
        const take = Math.min(budget, job.pLeft, sched === "fifo" ? Infinity : REPLICA.chunk);
        job.pLeft -= take;
        budget -= take;
        rep.prefillTokensLeft -= take;
        busy = true;
        if (sched === "fair") rep.vt[job.tenant] = (rep.vt[job.tenant] ?? 0) + take;
        if (job.pLeft <= 1e-6) {
          rep.pq.splice(rep.pq.indexOf(job), 1);
          job.stage = "wait";
          job.pDone = this.now;
          rep.dq.push(job);
        }
      }
      rep.pBusy += ((busy ? 1 : 0) - rep.pBusy) * 0.03;
      // --- слоты декода ---
      while (rep.active.length < REPLICA.slots && rep.dq.length) {
        let k = 0;
        if (sched === "priority") {
          for (let i = 1; i < rep.dq.length; i++) if (rep.dq[i].prio < rep.dq[k].prio) k = i;
        } else if (sched === "fair") {
          for (let i = 1; i < rep.dq.length; i++) if ((rep.vt[rep.dq[i].tenant] ?? 0) < (rep.vt[rep.dq[k].tenant] ?? 0)) k = i;
        }
        const j = rep.dq.splice(k, 1)[0];
        j.stage = "decode";
        j.tStart = this.now;
        rep.active.push(j);
      }
      const n = rep.active.length;
      if (n) {
        const r = Math.min(REPLICA.vmax, REPLICA.decodeCap / n);
        let fin = null;
        for (const j of rep.active) {
          const before = j.produced;
          j.produced += r * DT;
          if (j.tFirst === null && j.produced >= 1) {
            j.tFirst = this.now + DT * Math.min(1, (1 - before) / (r * DT));
            this._record(j);
          }
          if (j.produced >= j.out) {
            j.tDone = this.now;
            j.stage = "done";
            (fin ||= []).push(j);
          }
        }
        if (fin) rep.active = rep.active.filter((j) => j.stage !== "done");
      }
    }
    if (this.now >= this.nextSample) {
      this.nextSample = this.now + 0.25;
      const all = this.all(50);
      this.series.push(all.length ? percentile(all, 0.95) : 0);
      if (this.series.length > 120) this.series.shift();
    }
  }

  _record(j) {
    const ttft = j.tFirst - j.arrival;
    const push = (arr, v, n = 60) => {
      arr.push(v);
      if (arr.length > n) arr.shift();
    };
    push(this.byClass[j.cls], ttft);
    push(this.byTenant[j.tenant], ttft);
    this.winHits.push(j.prefix > 0 ? (j.hit ? 1 : 0) : null);
    if (this.winHits.length > 80) this.winHits.shift();
    this.done.push(j);
    if (this.done.length > 400) this.done.shift();
  }

  all(n = 60) {
    const out = [];
    for (let i = this.done.length - 1; i >= 0 && out.length < n; i--) out.push(this.done[i].tFirst - this.done[i].arrival);
    return out;
  }

  stats() {
    const hitsWin = this.winHits.filter((v) => v !== null);
    const all = this.all(60);
    const agg = (v) => ({ p50: v.length ? percentile(v, 0.5) : 0, p95: v.length ? percentile(v, 0.95) : 0, n: v.length });
    return {
      hitRate: hitsWin.length ? hitsWin.reduce((a, b) => a + b, 0) / hitsWin.length : null,
      hitCum: this.lookups ? this.hits / this.lookups : null,
      ttftP50: all.length ? percentile(all, 0.5) : 0,
      ttftP95: all.length ? percentile(all, 0.95) : 0,
      byClass: Object.fromEntries(Object.entries(this.byClass).map(([k, v]) => [k, agg(v)])),
      byTenant: Object.fromEntries(Object.entries(this.byTenant).map(([k, v]) => [k, agg(v)])),
      replicas: this.replicas.map((r) => ({
        prefill: r.pBusy,
        queue: r.pq.length + r.dq.length,
        active: r.active.length,
        load: r.load(),
      })),
    };
  }
}
