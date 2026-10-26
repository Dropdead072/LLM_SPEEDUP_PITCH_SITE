// Сцена 5 · «Одна нода» (заменяет сцену 5 исходного брифа, дополнение §5).
// Высвобождается только ЦЕЛАЯ нода:
//   gpus_needed = ceil(20 / g);  nodes_freed = floor((20 − gpus_needed) / 4);
//   saving = nodes_freed × 3 815 625 × 12.
// Все рубли — только из HEADLINE (публичная аренда 4×H200), под ними — costBasis.
import { HEADLINE, NODE_RUB_YEAR, SECONDS_PER_YEAR } from "../data.js";
import { el, clamp, lerp, smooth } from "../lib/util.js";
import { fmtNum, fmtInt, fmtMln, fmtRub } from "../lib/format.js";

export const meta = {
  no: 5,
  title: "Одна нода",
  disclaimer: "illustrative",
  keys:
    "<b>←</b><b>→</b> сцены &nbsp; <b>пробел</b> пауза &nbsp; <b>Enter</b> подобрать &nbsp; <b>R</b> заново &nbsp; <b>G</b> кейсы",
};

export function fleetMath(growthPct, fleet = HEADLINE.fleet, nodeCards = HEADLINE.nodeCards) {
  const g = 1 + growthPct / 100;
  const needed = Math.ceil(fleet / g - 1e-9);
  const freed = Math.max(0, Math.floor((fleet - needed) / nodeCards));
  return { g, needed, freed, spare: fleet - freed * nodeCards - needed };
}

export function create(ctx) {
  const host = ctx.host;
  const root = el("div", "s5");
  const controls = el("div", "controls");
  const sl = el("label", "slider");
  sl.innerHTML = `<span class="lab">Рост полезного throughput</span>`;
  const inp = el("input");
  inp.type = "range";
  inp.min = "0";
  inp.max = "100";
  inp.step = "1";
  const startGrowth = ctx.params.growth ?? Math.round((HEADLINE.throughputGain - 1) * 100);
  inp.value = String(startGrowth);
  const out = el("output", "num");
  out.style.minWidth = "58px";
  sl.append(inp, out);
  const btn = el("button", "btn accent");
  btn.textContent = "Подобрать";
  const reset = el("button", "btn");
  reset.textContent = "Вернуть";
  const hint = el("div");
  hint.style.cssText = "font:400 14px var(--sans);color:var(--ink-2)";
  hint.textContent = `Парк: ${HEADLINE.fleet} × ${HEADLINE.gpu}, ${HEADLINE.nodesBefore} ноды по ${HEADLINE.nodeCards} карты.`;
  controls.append(sl, btn, reset, hint);
  if (ctx.record) controls.classList.add("static");

  const nodesRow = el("div", "s5-nodes");
  const nodes = [];
  for (let j = 0; j < HEADLINE.nodesBefore; j++) {
    const n = el("div", "s5-node");
    n.innerHTML = `<div class="nh"><span>Нода ${j + 1}</span><span class="muted">${HEADLINE.nodeCards}×${HEADLINE.gpu}</span></div><div class="ng"></div><div class="nt"></div>`;
    const gp = n.querySelector(".ng");
    const cells = [];
    for (let k = 0; k < HEADLINE.nodeCards; k++) {
      const c = el("i");
      gp.append(c);
      cells.push(c);
    }
    nodesRow.append(n);
    nodes.push({ n, cells, nt: n.querySelector(".nt"), pos: 0 });
  }

  const res = el("div", "s5-res");
  res.innerHTML = `
    <div class="col f">
      <div class="over">расчёт</div>
      <div class="formula serif num"></div>
      <div class="sub num"></div>
    </div>
    <div class="col m">
      <div class="over">экономия на аренде</div>
      <div class="money serif num"></div>
      <div class="basis"></div>
    </div>
    <div class="col r">
      <div class="over">наша доля 10–20 % подтверждённого эффекта</div>
      <div class="fee serif num"></div>
      <div class="basis">Разовый подбор + quarterly profile — из презентации</div>
    </div>`;
  const note = el("div", "s5-note");
  const counter = el("div", "s5-counter");
  root.append(controls, nodesRow, res, note);
  host.append(root);
  host.append(counter);

  const q = (s) => res.querySelector(s);
  const formula = q(".formula");
  const sub = q(".sub");
  const money = q(".money");
  const fee = q(".fee");
  const basis = q(".m .basis");

  let tuned = false;
  let pressedAt = -1;
  let overpay = 0;
  let sweep = null;

  const growth = () => parseFloat(inp.value);
  const press = () => {
    tuned = true;
    pressedAt = ctx.clock.t;
  };
  btn.onclick = press;
  reset.onclick = () => {
    tuned = false;
  };
  inp.oninput = () => {};

  // сценарий записи: нажать «Подобрать», затем показать порог целой ноды (+10 % → +67 % → +25 %)
  const script = ctx.record
    ? [
        { t: 1.0, fn: press },
        { t: 5.0, fn: () => (sweep = { from: growth(), to: 10, t0: ctx.clock.t, d: 1.2 }) },
        { t: 7.2, fn: () => (sweep = { from: 10, to: 67, t0: ctx.clock.t, d: 1.6 }) },
        { t: 10.0, fn: () => (sweep = { from: 67, to: 25, t0: ctx.clock.t, d: 1.4 }) },
      ]
    : [];
  let sIdx = 0;

  function render() {
    const gPct = growth();
    const m = fleetMath(gPct);
    out.textContent = "+" + fmtInt(gPct) + " %";
    const eff = tuned ? m : { g: m.g, needed: HEADLINE.fleet, freed: 0, spare: 0 };
    // узлы и карты
    const t = ctx.clock.t;
    for (let j = 0; j < nodes.length; j++) {
      const nd = nodes[j];
      const isFreed = tuned && j >= HEADLINE.nodesBefore - m.freed;
      const p = smooth(nd.pos);
      nd.n.style.transform = `translateX(${p * 380}px)`;
      nd.n.style.opacity = String(1 - p * 0.95);
      nd.n.classList.toggle("gone", isFreed);
      // карты внутри ноды: активные / запас
      const first = j * HEADLINE.nodeCards;
      for (let k = 0; k < HEADLINE.nodeCards; k++) {
        const idx = first + k;
        const active = !tuned || idx < m.needed || isFreed;
        const spare = tuned && !isFreed && idx >= m.needed;
        const cls = spare ? "spare" : "on";
        if (nd.cells[k]._c !== cls) {
          nd.cells[k]._c = cls;
          nd.cells[k].className = cls;
        }
        void active;
      }
      const tx = isFreed ? "освобождена" : tuned && m.spare > 0 && j === HEADLINE.nodesBefore - m.freed - 1 ? `запас: ${m.spare} карт` : "";
      if (nd.nt._t !== tx) {
        nd.nt._t = tx;
        nd.nt.textContent = tx;
      }
    }
    // расчёт
    const f = `${HEADLINE.fleet} / ${fmtNum(m.g, 2)} = ${m.needed}`;
    if (formula._t !== f) {
      formula._t = f;
      formula.textContent = f;
    }
    const s2 = `свободно нод: ⌊(${HEADLINE.fleet} − ${m.needed}) / ${HEADLINE.nodeCards}⌋ = ${m.freed}`;
    if (sub._t !== s2) {
      sub._t = s2;
      sub.textContent = s2;
    }
    const saving = m.freed * NODE_RUB_YEAR;
    const moneyText = m.freed ? `${fmtMln(saving)} в год` : "0 ₽";
    if (money._t !== moneyText) {
      money._t = moneyText;
      money.textContent = moneyText;
      money.classList.toggle("zero", !m.freed);
    }
    const feeText = m.freed
      ? `${fmtNum((saving * HEADLINE.feeShare[0]) / 1e6, 1)}–${fmtNum((saving * HEADLINE.feeShare[1]) / 1e6, 1)} млн ₽`
      : "—";
    if (fee._t !== feeText) {
      fee._t = feeText;
      fee.textContent = feeText;
    }
    const bt = `Стоимость — ${HEADLINE.costBasis}`;
    if (basis._t !== bt) {
      basis._t = bt;
      basis.textContent = bt;
    }
    const nt = m.freed
      ? `Освобождается только целая нода: ${m.freed} × ${fmtRub(NODE_RUB_YEAR)} в год.`
      : m.needed < HEADLINE.fleet
        ? `Часть карт уже лишняя (запас под рост: ${m.spare}), но целая нода ещё не освободилась — денег нет. Порог: +25 % — одна нода, +67 % — две.`
        : "Прирост пока нулевой.";
    if (note._t !== nt) {
      note._t = nt;
      note.textContent = nt;
    }
    // счётчик переплаты
    const rate = (m.freed * NODE_RUB_YEAR) / SECONDS_PER_YEAR;
    const ct = `Пока идёт демо, этот парк без подбора переплатил: <b class="num">${fmtRub(overpay)}</b> <span>(${fmtNum(rate, 2)} ₽/с)</span>`;
    if (counter._h !== ct) {
      counter._h = ct;
      counter.innerHTML = ct;
    }
    void t;
    void lerp;
    void clamp;
  }

  return {
    step() {
      const t = ctx.clock.t;
      while (sIdx < script.length && t >= script[sIdx].t) script[sIdx++].fn();
      if (sweep) {
        const u = clamp((t - sweep.t0) / sweep.d, 0, 1);
        inp.value = String(Math.round(lerp(sweep.from, sweep.to, smooth(u))));
        if (u >= 1) sweep = null;
      }
      const m = fleetMath(growth());
      for (let j = 0; j < nodes.length; j++) {
        const target = tuned && j >= HEADLINE.nodesBefore - m.freed ? 1 : 0;
        nodes[j].pos += (target - nodes[j].pos) * (1 - Math.exp(-(1 / 60) * 5));
      }
      overpay += ((m.freed * NODE_RUB_YEAR) / SECONDS_PER_YEAR) * (1 / 60);
    },
    render,
    key(e) {
      if (e.key === "Enter") {
        press();
        return true;
      }
      return false;
    },
    destroy() {
      root.remove();
      counter.remove();
    },
  };
}
