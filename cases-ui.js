// Галерея кейсов и страница кейса (единый шаблон из трёх колонок).
// Движки переиспользуются из сцен: SplitSim, AgentCompare, NodeGrid/Triple, Timeline, MemoryBar,
// RoutingView, Cloud. Числа справа считает функция caseResults(), а не захардкоженные строки.
import { MODES, MODE_KEYS } from "./data.js";
import {
  CASES, CASE_BY_ID, GROUP_LABELS, TOURS, caseResults, cardHeadline, fleetResult,
} from "./cases.js";
import { el, clamp } from "./lib/util.js";
import { fmtNum, fmtInt, fmtSec } from "./lib/format.js";
import { SplitSim } from "./engines/splitsim.js";
import { AgentCompare } from "./engines/agentterm.js";
import { NodeGrid, Triple } from "./engines/nodegrid.js";
import { Timeline } from "./engines/timeline.js";
import { MemoryBar } from "./engines/memorybar.js";
import { RoutingView } from "./engines/routingui.js";
import { POLICIES } from "./engines/routing.js";
import { Cloud } from "./engines/cloud.js";
import { PROFILE_KEYS, AXES } from "./engines/cloudmodel.js";

const NB = " ";

export function caseInfo(id) {
  const c = CASE_BY_ID[id] || CASES[0];
  return { code: c.code, title: c.title, groupLabel: GROUP_LABELS[c.group] };
}

// ---------------------------------------------------------------- навигация
function orderList(params) {
  const tour = params.tour && TOURS[params.tour];
  return tour ? tour : CASES.map((c) => c.id);
}
export function navigate(view, dir, nav) {
  const params = view.params;
  const list = orderList(params);
  if (view.kind === "gallery") {
    const id = dir > 0 ? list[0] : list[list.length - 1];
    nav.goCase(id);
    return;
  }
  const cur = CASE_BY_ID[view.key]?.id;
  const i = list.indexOf(cur);
  const j = i + dir;
  if (j < 0 || j >= list.length) nav.goGallery();
  else nav.goCase(list[j]);
}

// ---------------------------------------------------------------- галерея
const FILTERS = [
  { key: "all", label: "Все" },
  { key: "scenarios", label: GROUP_LABELS.scenarios },
  { key: "spend", label: GROUP_LABELS.spend },
  { key: "routing", label: GROUP_LABELS.routing },
];

export function createGallery(ctx) {
  const root = el("div", "gal");
  const tabs = el("div", "gal-tabs");
  const grid = el("div", "gal-grid");
  const btns = {};
  let filter = ctx.params.filter || "all";
  FILTERS.forEach((f, i) => {
    const b = el("button", "btn");
    b.innerHTML = `<span class="muted" style="font-weight:400">${i + 1}</span>&nbsp; ${f.label}`;
    b.onclick = () => set(f.key);
    btns[f.key] = b;
    tabs.append(b);
  });
  const tourNote = el("div", "gal-note");
  tourNote.textContent = "Режим ведущего: ?tour=short (2 мин) · full (6–8 мин) · qa (резерв под вопросы)";
  tabs.append(tourNote);

  function set(key) {
    filter = key;
    FILTERS.forEach((f) => btns[f.key].classList.toggle("on", f.key === key));
    grid.replaceChildren();
    for (const c of CASES) {
      if (key !== "all" && c.group !== key) continue;
      const h = cardHeadline(c);
      const card = el("button", "gcard");
      card.innerHTML = `
        <div class="over">${GROUP_LABELS[c.group]} · ${c.code}</div>
        <div class="t serif">${c.title}</div>
        <div class="f">${c.fleetLine}</div>
        <div class="r"><span class="v serif">${h.value}</span><span class="b">${h.source}</span></div>
        ${h.sub ? `<div class="r sub"><span class="v2">${h.sub}</span><span class="b">${h.subSource}</span></div>` : ""}
        <div class="pain"><b>Боль:</b> ${c.pain}</div>`;
      card.onclick = () => ctx.goCase(c.id);
      grid.append(card);
    }
  }
  set(filter);
  root.append(tabs, grid);
  ctx.host.append(root);
  return {
    step() {},
    render() {},
    key(e) {
      const i = ["1", "2", "3", "4"].indexOf(e.key);
      if (i >= 0) {
        set(FILTERS[i].key);
        return true;
      }
      return false;
    },
    destroy() {
      root.remove();
    },
  };
}

// ---------------------------------------------------------------- движки кейсов
function dev(ctx) {
  return { seed: ctx.seed, record: ctx.record };
}

function makeEngine(c, host, ctx) {
  const p = ctx.params;
  const eng = c.engine;
  const record = ctx.record;

  if (eng === "triple") {
    const res = caseResults(c);
    const t = new Triple(host, { parts: res.parts, autoPress: 1.8 });
    return { step: () => t.step(), render: () => t.render(), destroy: () => t.destroy(), obj: t };
  }
  if (eng === "split-hint" || eng === "premium") {
    const wrap = el("div", "eng-split");
    host.append(wrap);
    const sim = new SplitSim(wrap, {
      mode: "hint", load: p.load, seed: ctx.seed, tiles: 6, cols: 2, tileH: 96,
      compact: true, controls: "min", statement: false,
    });
    let fired = false;
    let prem = null;
    if (eng === "premium") prem = makePremium(wrap, sim);
    return {
      step() {
        sim.step();
        if (!fired && p.burstAt >= 0 && ctx.clock.t >= p.burstAt) {
          fired = true;
          sim.pair.forceBurst();
        }
      },
      render() {
        sim.render();
        prem?.render();
      },
      live: prem ? () => prem.live() : null,
      destroy() {
        sim.destroy();
        wrap.remove();
      },
      obj: sim,
    };
  }
  if (eng === "memory-chat") {
    const mb = new MemoryBar(host);
    const wrap = el("div", "eng-split");
    host.append(wrap);
    const sim = new SplitSim(wrap, {
      mode: "chat", load: 0.7, seed: ctx.seed, tiles: 4, cols: 2, tileH: 92,
      compact: true, controls: "min", statement: false,
    });
    return {
      step() {
        mb.step();
        sim.step();
      },
      render() {
        mb.render();
        sim.render();
      },
      destroy() {
        mb.destroy();
        sim.destroy();
        wrap.remove();
      },
    };
  }
  if (eng === "agent") {
    const a = new AgentCompare(host, { compact: true, playSeconds: 11 });
    return { step: () => a.step(), render: () => a.render(), destroy: () => a.destroy(), obj: a };
  }
  if (eng.startsWith("timeline-")) {
    const kind = eng.slice(9);
    const tl = new Timeline(host, { kind: kind === "day" ? "day" : kind === "months" ? "months" : "weeks", r: 0.05 });
    return {
      step: () => tl.step(),
      render: () => tl.render(),
      live: kind === "months" ? () => ({ r: tl.r }) : null,
      destroy: () => tl.destroy(),
      obj: tl,
    };
  }
  if (eng === "node-grid") {
    const ng = new NodeGrid(host, { alloc: c.fleet.alloc, cols: 8, seed: ctx.seed, autoPress: record ? 1.5 : null });
    return { step: () => ng.step(), render: () => ng.render(), destroy: () => ng.destroy(), obj: ng };
  }
  if (eng.startsWith("routing-")) {
    const scenario = eng.slice(8);
    const alias = { rr: "round_robin", ll: "least_loaded", aff: "prefix_affinity", cap: "affinity_with_cap", pools: "class_pools", prio: "priority_chunked", fair: "fair_share", fp: "fair_pools" };
    const start = alias[p.routing] || p.routing;
    const view = new RoutingView(host, { scenario, policy: start, seed: ctx.seed, compact: true, burstAt: scenario === "tenants" ? 6 : -1 });
    const list = view.policies;
    let idx = list.indexOf(view.policy);
    const seg = Math.max(3.5, ((p.duration || 15) - 0.5) / list.length);
    return {
      step() {
        view.step();
        if (record && !p.routing) {
          const want = Math.min(list.length - 1, Math.floor(ctx.clock.t / seg));
          if (want !== idx) {
            idx = want;
            view.setPolicy(list[want]);
          }
        }
      },
      render() {
        view.render();
      },
      live: () => routingLive(c, view),
      key(e) {
        const i = ["1", "2", "3"].indexOf(e.key);
        if (i >= 0 && list[i]) {
          view.setPolicy(list[i]);
          return true;
        }
        return false;
      },
      destroy() {
        view.destroy();
      },
      obj: view,
    };
  }
  if (eng === "cloud-two") return makeCloudTwo(host, ctx);
  throw new Error("unknown engine " + eng);
}

// живые строки результата для маршрутизации: только иллюстрация, без ₽ и ×N
function routingLive(c, view) {
  const st = view.sim.stats();
  const sc = view.sim.sc;
  const sec = (v) => fmtNum(v, 1) + NB + "с";
  const rows = [];
  if (c.engine === "routing-classes") {
    rows.push({ label: "p95 TTFT подсказок", value: sec(st.byClass.hint.p95), source: "иллюстрация", note: `порог ${fmtNum(sc.classes.hint.sla, 1)} с` });
    rows.push({ label: "p95 TTFT агентов", value: sec(st.byClass.agent.p95), source: "иллюстрация" });
  } else if (c.engine === "routing-tenants") {
    sc.tenantNames.forEach((n, t) => {
      const cls = ["hint", "chat", "agent"][t];
      rows.push({ label: `p95 TTFT · ${n}`, value: sec(st.byTenant[t].p95), source: "иллюстрация", note: `SLA ${fmtNum(sc.classes[cls].sla, 1)} с` });
    });
  } else {
    rows.push({ label: "попадания в кэш префикса", value: st.hitRate == null ? "—" : fmtInt(st.hitRate * 100) + NB + "%", source: "иллюстрация" });
    rows.push({ label: "p95 TTFT", value: sec(st.ttftP95), source: "иллюстрация" });
    rows.push({ label: "p50 TTFT", value: sec(st.ttftP50), source: "иллюстрация" });
  }
  return { rows, policy: POLICIES[view.policy].label };
}

// B3: p95 подсказок с порогом premium-тарифа
const PREMIUM_P95 = 0.4; // [ДОПУЩЕНИЕ ДЕМО] порог тарифа, с

function makePremium(host, sim) {
  const box = el("div", "premium");
  box.innerHTML = `<div class="over">p95 TTFT подсказок · порог premium-тарифа ${fmtNum(PREMIUM_P95, 2)} с (пунктир)</div><canvas width="1900" height="260"></canvas>`;
  host.append(box);
  const cv = box.querySelector("canvas");
  const cs = getComputedStyle(box);
  const col = (n) => cs.getPropertyValue(n).trim();
  return {
    render() {
      const g = cv.getContext("2d");
      const W = cv.width;
      const H = cv.height;
      g.clearRect(0, 0, W, H);
      const a = sim.pair.base.ttftSeries;
      const b = sim.pair.tuned.ttftSeries;
      const ymax = Math.max(PREMIUM_P95 * 2.2, ...a, ...b);
      const Y = (v) => H - 14 - (v / ymax) * (H - 40);
      g.strokeStyle = col("--ink-2");
      g.lineWidth = 3;
      g.setLineDash([14, 10]);
      g.beginPath();
      g.moveTo(0, Y(PREMIUM_P95));
      g.lineTo(W, Y(PREMIUM_P95));
      g.stroke();
      g.setLineDash([]);
      const draw = (data, color) => {
        if (data.length < 2) return;
        g.strokeStyle = color;
        g.lineWidth = 6;
        g.lineJoin = "round";
        g.beginPath();
        data.forEach((v, i) => {
          const x = W - (data.length - 1 - i) * (W / 119);
          if (i === 0) g.moveTo(x, Y(v));
          else g.lineTo(x, Y(v));
        });
        g.stroke();
      };
      draw(a, col("--baseline"));
      draw(b, col("--ours"));
      g.fillStyle = col("--ink-2");
      g.font = "26px Arimo, sans-serif";
      g.fillText(fmtNum(ymax, 1) + " с", 8, 28);
    },
    live() {
      const sb = sim.pair.base.stats(sim.pair.now);
      const st = sim.pair.tuned.stats(sim.pair.now);
      const p = (v) => fmtNum(v, v < 10 ? 2 : 1) + NB + "с";
      return {
        rows: [
          { label: "p95 TTFT подсказок · подобранная сторона", value: p(st.ttftP95), source: "иллюстрация", note: st.ttftP95 <= PREMIUM_P95 ? "под порогом тарифа" : "над порогом" },
          { label: "p95 TTFT подсказок · без подбора", value: p(sb.ttftP95), source: "иллюстрация", note: sb.ttftP95 <= PREMIUM_P95 ? "под порогом тарифа" : "над порогом тарифа" },
        ],
      };
    },
  };
}

// C4: та же модель и тот же trace на двух платформах — выигрывающий рецепт на каждой свой
function makeCloudTwo(host, ctx) {
  const wrap = el("div", "eng-cloud2");
  const bar = el("div", "controls");
  const seg = el("div", "seg");
  const btns = {};
  let current = "hint";
  MODE_KEYS.forEach((k, i) => {
    const b = el("button", "btn" + (k === current ? " on" : ""));
    b.innerHTML = `<span class="muted" style="font-weight:400">${i + 1}</span>&nbsp; ${MODES[k].short}`;
    b.onclick = () => select(k);
    btns[k] = b;
    seg.append(b);
  });
  bar.append(seg);
  const row = el("div", "cl2-row");
  const mk = (variant, name) => {
    const box = el("div", "cl2-box");
    const title = el("div", "cl2-title serif");
    title.textContent = name;
    const holder = el("div");
    const cloud = new Cloud(holder, { profile: current, seed: ctx.seed, variant, w: 490, h: 540, gain: false, numbers: false, panel: false });
    const rec = el("div", "cl2-rec");
    box.append(title, holder, rec);
    row.append(box);
    return { cloud, rec };
  };
  const A = mk("A", "Платформа A");
  const B = mk("B", "Платформа B");
  wrap.append(bar, row);
  host.append(wrap);
  function recipeLine(cl) {
    const r = cl.recipeOf(cl.prof.star);
    return AXES.map((a, i) => `<span><i>${a.label}</i> ${r[i]}</span>`).join("");
  }
  function select(k) {
    current = k;
    for (const m of MODE_KEYS) btns[m].classList.toggle("on", m === k);
    A.cloud.setProfile(k);
    B.cloud.setProfile(k);
  }
  const script = ctx.record ? [{ t: 9, k: "chat" }, { t: 12, k: "agent" }] : [];
  let si = 0;
  return {
    step() {
      A.cloud.step();
      B.cloud.step();
      while (si < script.length && ctx.clock.t >= script[si].t) select(script[si++].k);
    },
    render() {
      for (const x of [A, B]) {
        x.cloud.draw();
        const h = recipeLine(x.cloud);
        if (x.rec._h !== h) {
          x.rec._h = h;
          x.rec.innerHTML = h;
        }
      }
    },
    key(e) {
      const i = ["1", "2", "3"].indexOf(e.key);
      if (i >= 0) {
        select(MODE_KEYS[i]);
        return true;
      }
      return false;
    },
    destroy() {
      A.cloud.destroy();
      B.cloud.destroy();
      wrap.remove();
    },
  };
}

// ---------------------------------------------------------------- страница кейса
function badge(src) {
  const cls = src === "иллюстрация" ? "ill" : src.startsWith("презентация") ? "pres" : "mod";
  return `<span class="src ${cls}">${src}</span>`;
}

export function createCase(ctx, id) {
  const c = CASE_BY_ID[id] || CASES[0];
  const root = el("div", "cp");
  const left = el("div", "cp-left");
  const mid = el("div", "cp-mid");
  const right = el("div", "cp-right");
  const alloc = c.fleet.alloc;
  const chips = ["hint", "chat", "agent"]
    .filter((k) => alloc[k])
    .map((k) => `<span class="chip">${MODES[k].short} · ${alloc[k]} ${alloc[k] % 10 === 1 && alloc[k] !== 11 ? "карта" : alloc[k] % 10 > 1 && alloc[k] % 10 < 5 && (alloc[k] < 10 || alloc[k] > 20) ? "карты" : "карт"}</span>`)
    .join("");
  left.innerHTML = `
    <div class="cp-title"><div class="over">кейс ${c.code} · ${GROUP_LABELS[c.group]}</div><div class="serif">${c.title}</div></div>
    <div class="blk"><div class="over">клиент</div><div class="txt">${c.client}</div></div>
    <div class="blk"><div class="over">парк и нагрузка</div><div class="txt">${c.fleetLine}</div>${chips ? `<div class="chips">${chips}</div>` : ""}</div>
    <div class="blk"><div class="over">боль</div><div class="txt">${c.pain}</div></div>
    <div class="blk"><div class="over">что подобрали</div><ul>${c.recipe.map((r) => `<li>${r}</li>`).join("")}</ul></div>`;
  right.innerHTML = `<div class="blk"><div class="over">результат</div><div class="res"></div></div>
    <div class="blk fee hidden"><div class="over">наш чек</div><div class="feev"></div></div>
    <div class="blk"><div class="over">что меряем на пилоте</div><div class="txt pilot">${c.pilot}</div></div>
    ${c.plate ? `<div class="plate">${c.plate}</div>` : ""}`;
  root.append(left, mid, right);

  const nav = el("div", "cp-nav");
  const prev = el("button", "btn");
  prev.textContent = "← предыдущий кейс";
  const gal = el("button", "btn");
  gal.textContent = "к галерее";
  const next = el("button", "btn");
  next.textContent = "следующий кейс →";
  nav.append(prev, gal, next);
  ctx.host.append(root, nav);

  const view = { kind: "case", key: id, params: ctx.params };
  const go = (d) => navigate(view, d, { goCase: ctx.goCase, goGallery: ctx.goGallery });
  prev.onclick = () => go(-1);
  next.onclick = () => go(1);
  gal.onclick = () => ctx.goGallery();

  const engine = makeEngine(c, mid, ctx);
  const resEl = right.querySelector(".res");
  const feeBlk = right.querySelector(".fee");
  const feeEl = right.querySelector(".feev");
  let tick = 0;

  function renderResults() {
    const live = engine.live ? engine.live() : {};
    const r = caseResults(c, live || {});
    const rows = r.rows;
    // единица измерения не должна отрываться от числа при переносе («млн ₽», «3 ч»)
    const glue = (s) => String(s).replace(/ (?=(?:млн|тыс|₽|с|ч|%)(?:\s|$))/g, " ");
    let html = rows
      .map(
        (x) =>
          `<div class="rrow${x.alt ? " alt" : ""}"><div class="rv serif">${glue(x.value)}</div><div class="rl2">${x.label}${x.note ? ` · <span>${x.note}</span>` : ""}</div>${badge(x.source)}</div>`
      )
      .join("");
    if (c.afterMeasure) html += `<div class="after">карточка помечена «после замеров»: точки синтетические, как в сцене 7</div>`;
    if (resEl._h !== html) {
      resEl._h = html;
      resEl.innerHTML = html;
    }
    if (r.fee) {
      feeBlk.classList.remove("hidden");
      const fh = `<div class="rv serif">${r.fee.value}</div><div class="rl2">${r.fee.note}</div>${badge(r.fee.source)}`;
      if (feeEl._h !== fh) {
        feeEl._h = fh;
        feeEl.innerHTML = fh;
      }
    } else feeBlk.classList.add("hidden");
  }
  renderResults();

  // режим ведущего: пробел или клик — следующий кейс
  const inTour = !!(ctx.params.tour && TOURS[ctx.params.tour]);
  const onClick = (e) => {
    if (!inTour || e.target.closest("button,input,label,canvas")) return;
    go(1);
  };
  root.addEventListener("click", onClick);

  return {
    step() {
      engine.step();
    },
    render() {
      engine.render();
      if (ctx.record || ++tick % 6 === 0) renderResults(); // в записи кадр = один render, правая колонка не должна отставать
    },
    key(e) {
      if (engine.key?.(e)) return true;
      if (inTour && e.key === " ") {
        go(1);
        return true;
      }
      return false;
    },
    destroy() {
      engine.destroy();
      root.remove();
      nav.remove();
    },
  };
}
