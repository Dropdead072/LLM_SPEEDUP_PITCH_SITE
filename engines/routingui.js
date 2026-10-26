// RoutingView — визуализация RoutingSim: источники запросов слева, реплики со
// столбиком KV-кэша, очередью префилла и слотами декода, метрики справа.
// Только иллюстрация механизма — никаких множителей «×N» и рублей.
import { RoutingSim, POLICIES, SCENARIOS, REPLICA } from "./routing.js";
import { el, clamp, themeColors, rgb, mixColor } from "../lib/util.js";
import { fmtNum, fmtInt, fmtPct } from "../lib/format.js";

const DEVS = [
  "Алина К.", "Игорь М.", "Мария Т.", "Олег С.", "Дарья В.", "Павел Н.",
  "Ксения Л.", "Артём Б.", "Елена Р.", "Роман Ж.", "Вера Д.", "Никита Ф.",
];
const REPO_NAMES = ["репо A", "репо B", "репо C"];
const CLASS_NAMES = { hint: "подсказки", chat: "чат", agent: "агенты" };
const DOT_LIFE = 0.9; // секунд симуляции
const BLOCKS = 12;

const SCENARIO_POLICIES = {
  repo: ["round_robin", "prefix_affinity", "affinity_with_cap"],
  classes: ["round_robin", "class_pools", "priority_chunked"],
  tenants: ["least_loaded", "fair_share", "fair_pools"],
};

export class RoutingView {
  /**
   * @param {HTMLElement} host
   * @param {{scenario?:string, policy?:string, seed?:number, speed?:number, preroll?:number,
   *          compact?:boolean, controls?:boolean}} o
   */
  constructor(host, o = {}) {
    this.o = { scenario: "repo", seed: 42, speed: 3, preroll: 24, compact: false, controls: true, ...o };
    this.policies = SCENARIO_POLICIES[this.o.scenario];
    this.policy = this.policies.includes(this.o.policy) ? this.o.policy : this.policies[0];
    this.dots = [];
    this.seenId = -1;
    this.root = el("div", "rv" + (this.o.compact ? " compact" : ""));
    this.build();
    host.append(this.root);
    this.C = themeColors(this.root);
    this.restart();
  }

  build() {
    const sc = SCENARIOS[this.o.scenario];
    // панель политик
    this.bar = el("div", "rv-bar");
    this.pbtns = {};
    const seg = el("div", "seg");
    this.policies.forEach((p, i) => {
      const b = el("button", "btn");
      b.innerHTML = `<span class="muted" style="font-weight:400">${i + 1}</span>&nbsp; ${POLICIES[p].label}`;
      b.onclick = () => this.setPolicy(p);
      this.pbtns[p] = b;
      seg.append(b);
    });
    this.blurb = el("div", "rv-blurb");
    this.bar.append(seg, this.blurb);
    this.extras = el("div", "rv-extras");
    this.bar.append(this.extras);
    if (this.o.scenario === "classes") {
      const sl = el("label", "slider");
      sl.innerHTML = `<span class="lab">Доля агентного трафика</span>`;
      const inp = el("input");
      inp.type = "range";
      inp.min = "0.3";
      inp.max = "3";
      inp.step = "0.1";
      inp.value = "1";
      const out = el("output", "num");
      out.textContent = "×1,0";
      inp.oninput = () => {
        this.sim.classScale.agent = parseFloat(inp.value);
        out.textContent = "×" + fmtNum(parseFloat(inp.value), 1);
        this.o.agentScale = parseFloat(inp.value);
      };
      sl.append(inp, out);
      this.extras.append(sl);
    }
    if (this.o.scenario === "tenants") {
      const b = el("button", "btn warn");
      b.textContent = "Всплеск стартапа";
      b.onclick = () => this.sim.forceBurst(12);
      this.extras.append(b);
    }
    if (!this.o.controls) this.bar.classList.add("static");

    // сцена: источники + реплики + canvas поверх
    this.main = el("div", "rv-main");
    this.stage = el("div", "rv-stage");
    this.cv = el("canvas", "rv-cv");
    this.src = el("div", "rv-src");
    this.srcEls = sc.sources.map((s, i) => {
      const d = el("div", "rv-dev");
      const dot = el("i");
      d.append(dot);
      const label = el("span");
      label.textContent = this.sourceLabel(s, i);
      d.append(label);
      this.src.append(d);
      return { d, dot, s };
    });
    this.reps = el("div", "rv-reps");
    this.repEls = Array.from({ length: sc.replicas }, (_, i) => this.buildReplica(i));
    this.stage.append(this.src, this.reps, this.cv);
    this.metrics = el("div", "rv-metrics");
    this.metrics.innerHTML = `
      <div class="hit"><div class="over">попадания в кэш префикса</div><div class="big serif num hitv">—</div></div>
      <div class="ttft"><div><div class="over">TTFT p50</div><div class="v serif num p50"></div></div><div><div class="over">TTFT p95</div><div class="v serif num p95"></div></div></div>
      <div class="byk"></div>
      <div class="spark"><div class="over">p95 TTFT · последние 30 с</div><canvas width="760" height="220"></canvas></div>
      <div class="disc">Иллюстрация механизма. Величина эффекта зависит от trace клиента</div>`;
    this.main.append(this.stage, this.metrics);
    this.root.append(this.bar, this.main);
    const q = (s) => this.metrics.querySelector(s);
    this.mv = { hit: q(".hitv"), p50: q(".p50"), p95: q(".p95"), byk: q(".byk"), spark: q(".spark canvas") };
  }

  sourceLabel(s, i) {
    if (this.o.scenario === "repo") return `${DEVS[i % DEVS.length]} · ${REPO_NAMES[s.repo]}`;
    if (this.o.scenario === "classes") return s.cls === "hint" ? `${DEVS[i % DEVS.length]} · подсказки` : `агент ${i - 7}`;
    return s.cls === "hint" ? `банк · ${DEVS[i % DEVS.length]}` : s.cls === "chat" ? `IT · ${DEVS[i % DEVS.length]}` : `стартап · агент ${i - 9}`;
  }

  buildReplica(i) {
    const r = el("div", "rv-rep");
    r.innerHTML = `
      <div class="rh"><b>Реплика ${i + 1}</b><span class="muted">2 GPU</span><span class="hot">перегрета</span></div>
      <div class="rl">KV-кэш префикса</div>
      <div class="blocks">${"<i></i>".repeat(BLOCKS)}</div>
      <div class="rl">очередь префилла</div>
      <div class="pq"></div>
      <div class="rl">декод · слоты</div>
      <div class="slots">${"<i></i>".repeat(REPLICA.slots)}</div>
      <div class="rl load"></div>`;
    this.reps.append(r);
    return {
      r,
      hot: r.querySelector(".hot"),
      blocks: [...r.querySelectorAll(".blocks i")],
      pq: r.querySelector(".pq"),
      slots: [...r.querySelectorAll(".slots i")],
      load: r.querySelector(".load"),
    };
  }

  restart() {
    const { scenario, seed } = this.o;
    this.sim = new RoutingSim({ scenario, policy: this.policy, seed, burstAt: this.o.burstAt ?? -1 });
    this.sim.classScale = { agent: this.o.agentScale ?? 1 };
    for (let i = 0; i < Math.round(this.o.preroll * 60); i++) this.sim.step();
    this.sim.recent.length = 0;
    this.dots = [];
    this.seenId = this.sim.nextId - 1;
    for (const k of this.policies) this.pbtns[k].classList.toggle("on", k === this.policy);
    this.blurb.textContent = POLICIES[this.policy].blurb;
    this.sparkMax = 5;
  }

  setPolicy(p) {
    if (p === this.policy) return;
    this.policy = p;
    this.restart();
  }

  step() {
    for (let k = 0; k < this.o.speed; k++) {
      this.sim.step();
      for (const ev of this.sim.recent) {
        if (ev.req.id > this.seenId) {
          this.seenId = ev.req.id;
          this.dots.push({ t0: ev.t, src: ev.req.src, rep: ev.req.replica, hit: ev.req.hit, cls: ev.req.cls });
        }
      }
      this.sim.recent.length = 0;
    }
    const now = this.sim.now;
    this.dots = this.dots.filter((d) => now - d.t0 < DOT_LIFE);
  }

  repoColor(repo) {
    const C = this.C;
    return [C.ours, C.baseline, mixColor(C.ink2, C.surface, 0.1)][repo % 3];
  }
  clsColor(job) {
    const C = this.C;
    if (this.o.scenario === "repo") return this.repoColor(job.repo);
    return job.cls === "hint" ? C.ours : job.cls === "chat" ? mixColor(C.ink2, C.surface, 0.1) : C.baseline;
  }
  cssColor(c, a = 1) {
    return rgb(c, a);
  }

  render() {
    const sim = this.sim;
    const sc = SCENARIOS[this.o.scenario];
    const st = sim.stats();
    // реплики
    sim.replicas.forEach((rep, i) => {
      const v = this.repEls[i];
      const hot = rep.load() > REPLICA.capLoad + 2;
      v.r.classList.toggle("overheat", hot);
      v.hot.style.visibility = hot ? "visible" : "hidden";
      const cached = rep.cache[0];
      v.blocks.forEach((b) => {
        const c = cached == null ? null : this.repoColor(cached);
        const col = c ? this.cssColor(c) : "transparent";
        if (b._c !== col) {
          b._c = col;
          b.style.background = col;
        }
      });
      // очередь префилла
      const jobs = rep.pq.slice(0, 6);
      const html = jobs
        .map((j) => {
          const w = clamp(j.pLeft / 100000, 0.05, 1) * 100;
          const col = this.cssColor(this.clsColor(j));
          return `<span class="chip ${j.hit === false ? "miss" : ""}" style="width:${w.toFixed(0)}%;background:${col}"></span>`;
        })
        .join("");
      const extra = rep.pq.length > 6 ? `<span class="more">+${rep.pq.length - 6}</span>` : "";
      const h = html + extra;
      if (v.pq._h !== h) {
        v.pq._h = h;
        v.pq.innerHTML = h;
      }
      v.slots.forEach((s, k) => {
        const job = rep.active[k];
        const col = job ? this.cssColor(this.clsColor(job)) : "transparent";
        if (s._c !== col) {
          s._c = col;
          s.style.background = col;
        }
      });
      const wait = rep.dq.length ? ` · ждут слот: ${rep.dq.length}` : "";
      const t = `ожидание до 1-го токена ≈ ${fmtNum(rep.load(), 1)} с${wait}`;
      if (v.load._t !== t) {
        v.load._t = t;
        v.load.textContent = t;
      }
    });
    // метрики
    const set = (n, t) => {
      if (n._t !== t) {
        n._t = t;
        n.textContent = t;
      }
    };
    set(this.mv.hit, st.hitRate == null ? "—" : fmtPct(st.hitRate));
    set(this.mv.p50, fmtNum(st.ttftP50, 1) + " с");
    set(this.mv.p95, fmtNum(st.ttftP95, 1) + " с");
    let rows = "";
    if (this.o.scenario === "classes") {
      for (const k of ["hint", "agent"]) {
        const m = st.byClass[k];
        const sla = sc.classes[k].sla;
        rows += `<div class="row"><span>${CLASS_NAMES[k]}</span><b class="num ${m.p95 > sla ? "bad" : ""}">p95 ${fmtNum(m.p95, 1)} с</b><span class="sla">SLA ${fmtNum(sla, 1)} с</span></div>`;
      }
    } else if (this.o.scenario === "tenants") {
      sc.tenantNames.forEach((name, t) => {
        const cls = ["hint", "chat", "agent"][t];
        const m = st.byTenant[t];
        const sla = sc.classes[cls].sla;
        rows += `<div class="row"><span>${name}</span><b class="num ${m.p95 > sla ? "bad" : ""}">p95 ${fmtNum(m.p95, 1)} с</b><span class="sla">SLA ${fmtNum(sla, 1)} с</span></div>`;
      });
    } else {
      rows = `<div class="row"><span>загрузка реплик</span><b class="num">${st.replicas.map((r) => fmtInt(clamp(r.load / 8, 0, 1) * 100) + "%").join(" · ")}</b><span class="sla"></span></div>`;
    }
    if (this.mv.byk._h !== rows) {
      this.mv.byk._h = rows;
      this.mv.byk.innerHTML = rows;
    }
    this.drawDots();
    if (Math.floor(sim.now * 4) !== this._sparkTick) {
      this._sparkTick = Math.floor(sim.now * 4);
      this.drawSpark();
    }
  }

  // координаты: stage 1370×640 логических px, canvas ×2
  drawDots() {
    // размеры берём из вёрстки, поэтому одна и та же отрисовка работает и в сцене, и в компактных кейсах
    const sw = this.stage.clientWidth;
    const sh = this.stage.clientHeight;
    if (this.cv.width !== sw * 2 || this.cv.height !== sh * 2) {
      this.cv.width = sw * 2;
      this.cv.height = sh * 2;
      this.cv.style.width = sw + "px";
      this.cv.style.height = sh + "px";
    }
    const g = this.cv.getContext("2d");
    const W = this.cv.width;
    g.clearRect(0, 0, W, this.cv.height);
    const sim = this.sim;
    const n = SCENARIOS[this.o.scenario].sources.length;
    const rowH = (this.srcEls[0].d.offsetHeight || 50) * 2;
    const sx = (this.src.offsetWidth - 14) * 2;
    const repX = (i) => this.repEls[i].r.offsetLeft * 2 + 8;
    for (const d of this.dots) {
      const u = clamp((sim.now - d.t0) / DOT_LIFE, 0, 1);
      const e = u * u * (3 - 2 * u);
      const y0 = (d.src + 0.5) * rowH + 4;
      const x1 = repX(d.rep);
      const y1 = 90;
      const x = sx + (x1 - sx) * e;
      const y = y0 + (y1 - y0) * e;
      const col = d.hit === false ? this.C.baseline : d.hit ? this.C.ours : this.C.ink2;
      g.strokeStyle = rgb(col, 0.28 * (1 - u));
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(sx, y0);
      g.lineTo(x, y);
      g.stroke();
      g.fillStyle = rgb(col, 1 - u * 0.4);
      g.beginPath();
      g.arc(x, y, 9, 0, Math.PI * 2);
      g.fill();
    }
    void n;
  }

  drawSpark() {
    const cv = this.mv.spark;
    const g = cv.getContext("2d");
    const W = cv.width;
    const H = cv.height;
    g.clearRect(0, 0, W, H);
    const data = this.sim.series;
    const ymax = Math.max(5, ...data);
    this.sparkMax += (ymax - this.sparkMax) * 0.2;
    const C = this.C;
    g.strokeStyle = rgb(C.line2);
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, H - 2);
    g.lineTo(W, H - 2);
    g.stroke();
    if (data.length > 1) {
      g.beginPath();
      const stepX = W / 119;
      data.forEach((v, i) => {
        const x = W - (data.length - 1 - i) * stepX;
        const y = H - (v / this.sparkMax) * (H - 24) - 2;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      });
      g.strokeStyle = rgb(C.ours);
      g.lineWidth = 4;
      g.lineJoin = "round";
      g.stroke();
    }
    g.fillStyle = rgb(C.ink2);
    g.font = "24px sans-serif";
    g.fillText(fmtNum(this.sparkMax, 0) + " с", 4, 24);
  }

  destroy() {
    this.root.remove();
  }
}
