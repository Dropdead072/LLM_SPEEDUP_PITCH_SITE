// NodeGrid (кейс B2) и Triple (кейс A0): ноды по 4×H200, высвобождаются целыми нодами.
import { MODES, MODE_KEYS } from "../data.js";
import { fleetResult, NODE_CARDS } from "../cases.js";
import { el, clamp, smooth, themeColors, rgb } from "../lib/util.js";
import { Rng, mixSeed } from "../lib/rng.js";
import { fmtNum, fmtInt, fmtMln, fmtSigned } from "../lib/format.js";

const NB = " ";

function plural(n, one, few, many) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

function nodeEl() {
  const n = el("div", "ngn");
  n.innerHTML = `<div class="cells"><i></i><i></i><i></i><i></i></div><div class="fill"><b></b></div>`;
  return { n, fill: n.querySelector(".fill b"), cells: [...n.querySelectorAll(".cells i")] };
}

const MODE_COLORS = { hint: "--ours", chat: "--ink-2", agent: "--baseline" };

// ---------------------------------------------------------------- B2
export class NodeGrid {
  /** @param {{alloc:{hint:number,chat:number,agent:number}, cols?:number, seed?:number, autoPress?:number}} o */
  constructor(host, o) {
    this.o = { cols: 8, seed: 42, ...o };
    this.f = fleetResult(o.alloc);
    this.t = 0;
    this.tuned = false;
    this.mode = "fewer"; // "fewer" — меньше карт, "more" — больше запросов (одно из двух, не оба сразу)
    this.pressed = -1;
    this.rng = new Rng(mixSeed(this.o.seed, "nodegrid"));
    this.parts = [];
    this.root = el("div", "ng");
    const bar = el("div", "controls");
    this.press = el("button", "btn accent");
    this.press.textContent = "Подобрать";
    this.press.onclick = () => this.doPress();
    const seg = el("div", "seg");
    this.bFew = el("button", "btn on");
    this.bFew.textContent = "Меньше карт";
    this.bMore = el("button", "btn");
    this.bMore.textContent = "Больше запросов";
    this.bFew.onclick = () => this.setMode("fewer");
    this.bMore.onclick = () => this.setMode("more");
    seg.append(this.bFew, this.bMore);
    const reset = el("button", "btn");
    reset.textContent = "Вернуть";
    reset.onclick = () => (this.tuned = false);
    bar.append(this.press, seg, reset);
    this.bar = bar;
    this.flow = el("canvas", "ng-flow");
    this.flow.width = 2000;
    this.flow.height = 100;
    this.grid = el("div", "ng-grid");
    this.grid.style.gridTemplateColumns = `repeat(${this.o.cols}, 1fr)`;
    this.nodes = Array.from({ length: this.f.nodesBefore }, () => {
      const nd = nodeEl();
      nd.pos = 0;
      this.grid.append(nd.n);
      return nd;
    });
    this.msg = el("div", "ng-msg");
    this.root.append(bar, this.flow, this.grid, this.msg);
    host.append(this.root);
    this.C = themeColors(this.root);
  }

  doPress() {
    this.tuned = true;
    this.pressed = this.t;
  }
  setMode(m) {
    this.mode = m;
    this.bFew.classList.toggle("on", m === "fewer");
    this.bMore.classList.toggle("on", m === "more");
  }

  step(dt = 1 / 60) {
    this.t += dt;
    if (this.o.autoPress != null && this.pressed < 0 && this.t >= this.o.autoPress) this.doPress();
    const freedFrom = this.f.nodesBefore - this.f.freedNodes;
    this.nodes.forEach((nd, i) => {
      const target = this.tuned && this.mode === "fewer" && i >= freedFrom ? 1 : 0;
      // освобождаются по очереди, справа налево
      const delay = (this.f.nodesBefore - 1 - i) * 0.05;
      const go = this.tuned && this.t - this.pressed > delay ? target : 0;
      nd.pos += (go - nd.pos) * (1 - Math.exp(-dt * 6));
    });
    // частицы-запросы
    const rate = (this.tuned && this.mode === "more" ? 1 + this.f.sameFleetGrowth : 1) * 7;
    const n = this.rng.poisson(rate * dt);
    for (let i = 0; i < n; i++) {
      const r = this.rng.float();
      const k = r < 0.125 ? "hint" : r < 0.4 ? "chat" : "agent";
      this.parts.push({ x: -0.02, y: this.rng.range(0.15, 0.85), v: this.rng.range(0.25, 0.4), k });
    }
    for (const p of this.parts) p.x += p.v * dt;
    this.parts = this.parts.filter((p) => p.x < 1.02);
  }

  render() {
    const f = this.f;
    const more = this.tuned && this.mode === "more";
    this.nodes.forEach((nd, i) => {
      const p = smooth(nd.pos);
      nd.n.style.opacity = String(1 - p * 0.8);
      nd.n.classList.toggle("freed", nd.pos > 0.5);
      // загрузка: до подбора ≈ 65 %; «больше запросов» — те же ноды, нагрузка выше на sameFleetGrowth
      const base = 0.65;
      const load = more ? Math.min(1, base * (1 + f.sameFleetGrowth)) : this.tuned && this.mode === "fewer" ? Math.min(1, base * (f.nodesBefore / f.nodesAfter)) : base;
      const h = nd.pos > 0.5 ? 0 : Math.round(load * 100);
      if (nd.fill._h !== h) {
        nd.fill._h = h;
        nd.fill.style.height = h + "%";
      }
      // запас карт внутри последней оставшейся ноды (в рубли не переводится)
      const lastKept = f.nodesAfter - 1;
      nd.cells.forEach((c, k) => {
        const spare = this.tuned && this.mode === "fewer" && i === lastKept && k >= NODE_CARDS - f.spareCards;
        c.classList.toggle("spare", spare);
      });
    });
    let msg;
    if (!this.tuned) msg = `${f.before} карт · ${f.nodesBefore} нод по ${NODE_CARDS} · все нагружены`;
    else if (this.mode === "fewer")
      msg = `<b>${f.after} ${plural(f.after, "карта", "карты", "карт")} вместо ${f.before}</b> · −${f.freedNodes} ${plural(f.freedNodes, "нода", "ноды", "нод")} (${f.nodesAfter} вместо ${f.nodesBefore})`;
    else msg = `<b>${fmtSigned(f.sameFleetGrowth * 100, 0)} % запросов</b> на том же парке: те же ${f.before} карт, нагрузка на каждую выше`;
    if (this.msg._h !== msg) {
      this.msg._h = msg;
      this.msg.innerHTML = msg;
    }
    this.drawFlow();
  }

  drawFlow() {
    const g = this.flow.getContext("2d");
    const W = this.flow.width;
    const H = this.flow.height;
    g.clearRect(0, 0, W, H);
    for (const p of this.parts) {
      g.fillStyle = rgb(this.C[p.k === "hint" ? "ours" : p.k === "chat" ? "ink2" : "baseline"], 0.9);
      g.beginPath();
      g.arc(p.x * W, p.y * H, 7, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = rgb(this.C.ink2);
    g.font = "22px sans-serif";
    g.fillText("поток запросов →", 8, 26);
  }

  destroy() {
    this.root.remove();
  }
}

// ---------------------------------------------------------------- A0
export class Triple {
  /** @param {{parts:{name:string, alloc:object, r:object}[], autoPress?:number}} o */
  constructor(host, o) {
    this.o = o;
    this.t = 0;
    this.tuned = false;
    this.pressed = -1;
    this.root = el("div", "triple");
    const bar = el("div", "controls");
    this.press = el("button", "btn accent");
    this.press.textContent = "Подобрать";
    this.press.onclick = () => this.doPress();
    const reset = el("button", "btn");
    reset.textContent = "Вернуть";
    reset.onclick = () => (this.tuned = false);
    const note = el("div");
    note.style.cssText = "font:400 14px var(--sans);color:var(--ink-2)";
    note.textContent = "Три одинаковых парка: 24 × H200 = 6 нод. Одни и те же методы.";
    bar.append(this.press, reset, note);
    this.root.append(bar);
    this.rows = o.parts.map((p) => {
      const row = el("div", "tr-row");
      const total = p.r.before;
      const share = (k) => ((p.alloc[k] || 0) / total) * 100;
      const strip = MODE_KEYS.map(
        (k) => `<i style="width:${share(k)}%;background:var(${MODE_COLORS[k]})" title="${MODES[k].short}"></i>`
      ).join("");
      row.innerHTML = `
        <div class="tr-name serif">${p.name}</div>
        <div class="tr-nodes"></div>
        <div class="tr-res"><b class="serif num"></b><span></span></div>
        <div class="tr-prof"><div class="strip">${strip}</div><div class="leg">${MODE_KEYS.map((k) => `<span><i style="background:var(${MODE_COLORS[k]})"></i>${MODES[k].short} ${fmtInt(share(k))} %</span>`).join("")}</div></div>`;
      const holder = row.querySelector(".tr-nodes");
      const nodes = Array.from({ length: p.r.nodesBefore }, () => {
        const nd = nodeEl();
        nd.pos = 0;
        holder.append(nd.n);
        return nd;
      });
      this.root.append(row);
      return { row, nodes, p, big: row.querySelector(".tr-res b"), sub: row.querySelector(".tr-res span") };
    });
    this.cap = el("div", "tr-cap");
    this.cap.innerHTML = `Один парк. Одни методы. Результат отличается втрое — <b>потому что отличается профиль</b>.`;
    this.root.append(this.cap);
    host.append(this.root);
  }

  doPress() {
    this.tuned = true;
    this.pressed = this.t;
  }

  step(dt = 1 / 60) {
    this.t += dt;
    if (this.o.autoPress != null && this.pressed < 0 && this.t >= this.o.autoPress) this.doPress();
    this.rows.forEach((row, ri) => {
      const from = row.p.r.nodesBefore - row.p.r.freedNodes;
      row.nodes.forEach((nd, i) => {
        const delay = ri * 0.35 + (row.p.r.nodesBefore - 1 - i) * 0.12;
        const go = this.tuned && i >= from && this.t - this.pressed > delay ? 1 : 0;
        nd.pos += (go - nd.pos) * (1 - Math.exp(-dt * 6));
      });
    });
  }

  render() {
    for (const row of this.rows) {
      const r = row.p.r;
      row.nodes.forEach((nd) => {
        const p = smooth(nd.pos);
        nd.n.style.opacity = String(1 - p * 0.85);
        nd.n.classList.toggle("freed", nd.pos > 0.5);
        const h = nd.pos > 0.5 ? 0 : 65;
        if (nd.fill._h !== h) {
          nd.fill._h = h;
          nd.fill.style.height = h + "%";
        }
      });
      const gone = row.nodes.filter((nd) => nd.pos > 0.5).length;
      const big = gone ? `−${gone} ${plural(gone, "нода", "ноды", "нод")}` : "";
      const sub = gone ? `${fmtMln(gone * (r.rubYear / Math.max(1, r.freedNodes)))} в год` : "";
      if (row.big._t !== big) {
        row.big._t = big;
        row.big.textContent = big;
      }
      if (row.sub._t !== sub) {
        row.sub._t = sub;
        row.sub.textContent = sub;
      }
    }
  }

  destroy() {
    this.root.remove();
  }
}
