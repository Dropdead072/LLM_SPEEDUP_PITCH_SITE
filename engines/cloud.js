// Cloud — «27 648 конфигураций → одна»: точечная диаграмма на Canvas.
// X — p95 latency (относительно baseline клиента), Y — полезные ток/с на GPU.
// Шаги (по 1,5 с): 0 облако · 1 quality gate · 2 SLA · 3 Парето-фронт · 4 выбор.
// Затем смена профиля: точки плавно переезжают, SLA-линия сдвигается, звезда прыгает.
import { MODES } from "../data.js";
import { AXES, DIMS, N, PROFILE_KEYS, SLA_REL, buildCloud, decode } from "./cloudmodel.js";
import { el, clamp, lerp, smooth, mixColor, rgb, themeColors } from "../lib/util.js";
import { fmtNum, fmtInt, fmtMult } from "../lib/format.js";
import { mulberry32, mixSeed } from "../lib/rng.js";

export const STEP_LEN = 1.5;
const STEP_CAPTIONS = [
  "кандидатов",
  "прошло quality gate (потеря качества ≤ 1 пп)",
  "укладывается в SLA по p95",
  "точек на Парето-фронте",
  "выбранная конфигурация",
];
const TRANSITION = 1.1;

export class Cloud {
  /**
   * @param {HTMLElement} host
   * @param {{profile?:string, seed?:number, variant?:string, w?:number, h?:number, gain?:boolean,
   *          numbers?:boolean, panel?:boolean, title?:string}} o
   */
  constructor(host, o = {}) {
    this.o = { profile: "hint", seed: 42, variant: "A", w: 1240, h: 740, gain: true, numbers: true, panel: true, ...o };
    this.model = buildCloud(this.o.variant, this.o.seed);
    this.profile = PROFILE_KEYS.indexOf(this.o.profile);
    if (this.profile < 0) this.profile = 0;
    this.t = 0;
    this.trans = null; // {from, to, t0}
    this.prevRecipe = null;

    // случайный порядок появления точек в шаге 0
    const r = mulberry32(mixSeed(this.o.seed, "appear"));
    this.rank = new Float32Array(N);
    for (let i = 0; i < N; i++) this.rank[i] = r();
    this.sx = new Float32Array(N);
    this.sy = new Float32Array(N);
    this.fx = new Float32Array(N); // позиции «из» при переходе
    this.fy = new Float32Array(N);
    this.tx = new Float32Array(N);
    this.ty = new Float32Array(N);

    this.root = el("div", "cloud" + (this.o.panel ? "" : " nopanel"));
    this.chart = el("div", "cloud-chart");
    this.cv = el("canvas");
    this.cv.width = this.o.w * 2;
    this.cv.height = this.o.h * 2;
    this.cv.style.width = this.o.w + "px";
    this.cv.style.height = this.o.h + "px";
    this.chart.append(this.cv);
    this.cap = el("div", "cloud-cap");
    this.chart.append(this.cap);
    this.root.append(this.chart);
    if (this.o.panel) {
      this.panel = el("div", "cloud-panel");
      this.root.append(this.panel);
    }
    host.append(this.root);
    this.C = themeColors(this.root);
    this.layout();
    this.loadProfile(this.profile, false);
  }

  get key() {
    return PROFILE_KEYS[this.profile];
  }
  get prof() {
    return this.model.profiles[this.key];
  }
  get stage() {
    return Math.min(4, Math.floor(this.t / STEP_LEN));
  }

  layout() {
    const W = this.o.w * 2;
    const H = this.o.h * 2;
    this.pl = { l: 150, r: 40, t: 40, b: 110 };
    this.plot = { x0: this.pl.l, x1: W - this.pl.r, y0: this.pl.t, y1: H - this.pl.b };
  }

  // экранные координаты точек профиля p
  project(p, out) {
    const prof = this.model.profiles[PROFILE_KEYS[p]];
    const { x0, x1, y0, y1 } = this.plot;
    // диапазоны — по 0,3–99,7-му процентилю, чтобы выбросы не сжимали картинку
    if (!prof.range) {
      const xs = Float32Array.from(prof.x).sort();
      const ys = Float32Array.from(prof.y).sort();
      const q = (a, f) => a[Math.floor(f * (a.length - 1))];
      prof.range = {
        xmin: Math.log(q(xs, 0.002) / 1.05),
        xmax: Math.log(q(xs, 0.998) * 1.05),
        ymin: Math.log(q(ys, 0.002) / 1.08),
        ymax: Math.log(q(ys, 0.998) * 1.08),
      };
    }
    const r = prof.range;
    const kx = (x1 - x0) / (r.xmax - r.xmin);
    const ky = (y1 - y0) / (r.ymax - r.ymin);
    for (let i = 0; i < N; i++) {
      out.x[i] = x0 + (Math.log(prof.x[i]) - r.xmin) * kx;
      out.y[i] = y1 - (Math.log(prof.y[i]) - r.ymin) * ky;
    }
    prof.kx = kx;
    prof.ky = ky;
  }

  loadProfile(p, animate) {
    const prof = this.model.profiles[PROFILE_KEYS[p]];
    if (animate) {
      this.fx.set(this.sx);
      this.fy.set(this.sy);
      this.project(p, { x: this.tx, y: this.ty });
      this.trans = { t0: this.t };
    } else {
      this.project(p, { x: this.sx, y: this.sy });
      this.tx.set(this.sx);
      this.ty.set(this.sy);
      this.trans = null;
    }
    this.profile = p;
    // группы: живые / не прошли качество / прошли качество, но не SLA
    const A = [];
    const Q = [];
    const S = [];
    for (let i = 0; i < N; i++) {
      if (prof.pass[i]) A.push(i);
      else if (!prof.qok[i]) Q.push(i);
      else S.push(i);
    }
    this.gA = Int32Array.from(A);
    this.gQ = Int32Array.from(Q);
    this.gS = Int32Array.from(S);
    this.updatePanel();
  }

  setProfile(key) {
    const p = PROFILE_KEYS.indexOf(key);
    if (p < 0 || p === this.profile) return;
    if (this.t < STEP_LEN * 5) this.t = STEP_LEN * 5 - 0.001; // перескочить к итогу
    this.loadProfile(p, true);
  }

  jumpToStep(n) {
    this.t = n * STEP_LEN + STEP_LEN * 0.98;
  }

  step(dt = 1 / 60) {
    this.t += dt;
    if (this.trans) {
      const u = (this.t - this.trans.t0) / TRANSITION;
      if (u >= 1) {
        this.sx.set(this.tx);
        this.sy.set(this.ty);
        this.trans = null;
      } else {
        const k = smooth(u);
        for (let i = 0; i < N; i++) {
          this.sx[i] = this.fx[i] + (this.tx[i] - this.fx[i]) * k;
          this.sy[i] = this.fy[i] + (this.ty[i] - this.fy[i]) * k;
        }
      }
    }
  }

  recipeOf(idx) {
    const d = decode(idx);
    return AXES.map((a, i) => a.values[d[i]]);
  }

  updatePanel() {
    if (!this.panel) return;
    const prof = this.prof;
    const recipe = this.recipeOf(prof.star);
    const base = this.recipeOf(this.model.baseline);
    const prev = this.prevRecipe;
    const m = MODES[this.key];
    const rows = AXES.map((a, i) => {
      const changed = prev && prev[i] !== recipe[i];
      const diff = recipe[i] !== base[i];
      return `<div class="rr${changed ? " chg" : ""}"><span class="k">${a.label}</span><span class="v${diff ? " d" : ""}">${recipe[i]}</span><span class="b">${base[i]}</span></div>`;
    }).join("");
    const loss = prof.loss[prof.star];
    const px = prof.x[prof.star];
    this.panel.innerHTML = `
      <div class="over">рецепт выбранной точки · ${m.label}</div>
      <div class="rr head"><span class="k"></span><span class="v">выбрано</span><span class="b">baseline клиента</span></div>
      ${rows}
      <div class="gates">
        <div><span>потеря качества</span><b class="num">${fmtNum(loss, 1)} пп ≤ 1,0</b></div>
        <div><span>p95 latency</span><b class="num">×${fmtNum(px, 2)} ≤ ×${fmtNum(prof.sla, 2)}</b></div>
        ${
          this.o.numbers
            ? `<div><span>полезные ток/с на GPU</span><b class="num">${fmtInt(prof.baselineY)} → ${fmtInt(prof.starY)}</b></div>`
            : ""
        }
      </div>`;
    this.prevRecipe = recipe;
  }

  render() {
    const g = this.cv.getContext("2d");
    const W = this.cv.width;
    const H = this.cv.height;
    const C = this.C;
    const prof = this.prof;
    const stage = this.stage;
    const u = (this.t - stage * STEP_LEN) / STEP_LEN;
    const full = this.t >= STEP_LEN * 5;
    const { x0, x1, y0, y1 } = this.plot;
    g.clearRect(0, 0, W, H);

    // --- оси и сетка ---
    const r = prof.range;
    const X = (v) => x0 + (Math.log(v) - r.xmin) * prof.kx;
    const Y = (v) => y1 - (Math.log(v) - r.ymin) * prof.ky;
    g.lineWidth = 2;
    g.strokeStyle = rgb(C.line2);
    g.fillStyle = rgb(C.ink2);
    g.font = "26px Arimo, sans-serif";
    g.textAlign = "center";
    const xt = [0.5, 0.7, 1, 1.4, 2, 3].filter((v) => Math.log(v) > r.xmin && Math.log(v) < r.xmax);
    for (const v of xt) {
      g.beginPath();
      g.moveTo(X(v), y0);
      g.lineTo(X(v), y1);
      g.strokeStyle = rgb(C.line);
      g.stroke();
      g.fillText("×" + fmtNum(v, v < 1 ? 1 : v % 1 ? 1 : 0), X(v), y1 + 36);
    }
    g.textAlign = "right";
    if (this.o.numbers) {
      const lo = Math.exp(r.ymin);
      const hi = Math.exp(r.ymax);
      const mag = Math.pow(10, Math.floor(Math.log10(hi)));
      const ticks = [];
      for (const k of [1, 2, 5, 10, 20, 50]) for (const m of [mag / 100, mag / 10, mag]) if (k * m > lo && k * m < hi) ticks.push(k * m);
      for (const v of ticks) {
        g.beginPath();
        g.moveTo(x0, Y(v));
        g.lineTo(x1, Y(v));
        g.strokeStyle = rgb(C.line);
        g.stroke();
        g.fillText(fmtInt(v), x0 - 14, Y(v) + 9);
      }
    }
    g.strokeStyle = rgb(C.line2);
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x0, y1);
    g.lineTo(x1, y1);
    g.stroke();
    g.fillStyle = rgb(C.ink2);
    g.font = "bold 26px Arimo, sans-serif";
    g.textAlign = "center";
    g.fillText("p95 latency (× от baseline клиента)  →  хуже", (x0 + x1) / 2, y1 + 82);
    g.save();
    g.translate(48, (y0 + y1) / 2);
    g.rotate(-Math.PI / 2);
    g.fillText(this.o.numbers ? "полезные ток/с на GPU  →  лучше" : "полезная пропускная способность  →  лучше", 0, 0);
    g.restore();

    // --- точки ---
    const appear = stage === 0 && !full ? smooth(u) : 1;
    const dimQ = stage > 1 || full ? 1 : stage === 1 ? smooth(u) : 0;
    const dimS = stage > 2 || full ? 1 : stage === 2 ? smooth(u) : 0;
    const alive = mixColor(C.ours, C.ink, 0.15);
    const dim = mixColor(C.muted, C.bg, 0.45);
    const size = 5;
    const drawGroup = (idx, color, alpha, lim) => {
      g.fillStyle = rgb(color, alpha);
      const sx = this.sx;
      const sy = this.sy;
      const rank = this.rank;
      for (let k = 0; k < idx.length; k++) {
        const i = idx[k];
        if (rank[i] > lim) continue;
        g.fillRect(sx[i] - size / 2, sy[i] - size / 2, size, size);
      }
    };
    drawGroup(this.gQ, mixColor(alive, dim, dimQ), lerp(0.5, 0.32, dimQ), appear);
    drawGroup(this.gS, mixColor(alive, dim, dimS), lerp(0.5, 0.32, dimS), appear);
    drawGroup(this.gA, alive, 0.55, appear);

    // --- SLA-линия ---
    const slaX = X(prof.sla);
    if (stage >= 2 || full) {
      const p2 = stage === 2 && !full ? smooth(u) : 1;
      const xx = lerp(x1, slaX, p2);
      g.setLineDash([14, 10]);
      g.strokeStyle = rgb(C.baseline);
      g.lineWidth = 3.5;
      g.beginPath();
      g.moveTo(xx, y0);
      g.lineTo(xx, y1);
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = rgb(C.baseline);
      g.font = "bold 26px Arimo, sans-serif";
      g.textAlign = xx > x1 - 330 ? "right" : "left";
      g.fillText(`SLA p95 ×${fmtNum(prof.sla, 2)}`, xx + (g.textAlign === "left" ? 12 : -12), y0 + 30);
    }

    // --- Парето-фронт ---
    if (stage >= 3 || full) {
      const p3 = stage === 3 && !full ? smooth(u) : 1;
      const f = prof.front;
      const n = Math.max(2, Math.ceil(f.length * p3));
      g.strokeStyle = rgb(C.ink);
      g.lineWidth = 4;
      g.lineJoin = "round";
      g.beginPath();
      for (let k = 0; k < n; k++) {
        const i = f[k];
        if (k === 0) g.moveTo(this.sx[i], this.sy[i]);
        else {
          // «лесенка» фронта: сначала по X, потом по Y
          g.lineTo(this.sx[i], this.sy[f[k - 1]]);
          g.lineTo(this.sx[i], this.sy[i]);
        }
      }
      g.stroke();
      g.fillStyle = rgb(C.ink);
      for (let k = 0; k < n; k++) {
        const i = f[k];
        g.beginPath();
        g.arc(this.sx[i], this.sy[i], 6.5, 0, Math.PI * 2);
        g.fill();
      }
    }

    // --- baseline и звезда ---
    if (stage >= 4 || full) {
      const p4 = stage === 4 && !full ? smooth(u) : 1;
      const b = this.model.baseline;
      const s = prof.star;
      const bx = this.sx[b];
      const by = this.sy[b];
      const sx = this.sx[s];
      const sy = this.sy[s];
      // стрелка baseline → звезда
      const ex = lerp(bx, sx, p4);
      const ey = lerp(by, sy, p4);
      g.strokeStyle = rgb(C.ours);
      g.lineWidth = 5;
      g.beginPath();
      g.moveTo(bx, by);
      g.lineTo(ex, ey);
      g.stroke();
      if (p4 > 0.95) {
        const ang = Math.atan2(sy - by, sx - bx);
        g.fillStyle = rgb(C.ours);
        g.beginPath();
        g.moveTo(sx, sy);
        g.lineTo(sx - 26 * Math.cos(ang - 0.4), sy - 26 * Math.sin(ang - 0.4));
        g.lineTo(sx - 26 * Math.cos(ang + 0.4), sy - 26 * Math.sin(ang + 0.4));
        g.closePath();
        g.fill();
      }
      // полая точка baseline
      g.lineWidth = 6;
      g.strokeStyle = rgb(C.baseline);
      g.fillStyle = rgb(C.surface);
      g.beginPath();
      g.arc(bx, by, 15, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.fillStyle = rgb(C.baseline);
      g.font = "bold 26px Arimo, sans-serif";
      g.textAlign = "left";
      g.fillText("baseline клиента", bx + 26, by + 34);
      // звезда
      if (p4 > 0.5) {
        const k = smooth((p4 - 0.5) * 2);
        this.star(g, sx, sy, 30 * k, C);
        if (this.o.gain) {
          const m = MODES[this.key];
          g.font = "bold 62px Tinos, serif";
          g.fillStyle = rgb(C.ours, k);
          g.textAlign = "left";
          const label = "×" + fmtNum(m.gain, 2);
          const mx = (bx + sx) / 2;
          const my = (by + sy) / 2;
          g.fillText(label, mx + 22, my - 18);
        }
      }
    }
  }

  star(g, cx, cy, R, C) {
    g.save();
    g.translate(cx, cy);
    g.fillStyle = rgb(C.ours);
    g.strokeStyle = rgb(C.surface);
    g.lineWidth = 5;
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const rr = i % 2 === 0 ? R : R * 0.45;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      g.lineTo(rr * Math.cos(a), rr * Math.sin(a));
    }
    g.closePath();
    g.stroke();
    g.fill();
    g.restore();
  }

  // подпись шага над диаграммой
  updateCaption() {
    const prof = this.prof;
    const stage = this.t >= STEP_LEN * 5 ? 4 : this.stage;
    const u = clamp((this.t - stage * STEP_LEN) / STEP_LEN, 0, 1);
    let n;
    if (stage === 0) n = Math.round(N * smooth(clamp(u * 1.15, 0, 1)));
    else if (stage === 1) n = prof.qok.reduce((a, b) => a + b, 0);
    else if (stage === 2) n = prof.pass.reduce((a, b) => a + b, 0);
    else if (stage === 3) n = prof.front.length;
    else n = null;
    let html;
    if (stage === 4) {
      const m = MODES[this.key];
      html = this.o.gain
        ? `<span class="n serif">×${fmtNum(m.gain, 2)}</span><span class="c">${STEP_CAPTIONS[4]} · ${m.label}</span>`
        : `<span class="c">${STEP_CAPTIONS[4]}</span>`;
    } else html = `<span class="n serif num">${fmtInt(n)}</span><span class="c">${STEP_CAPTIONS[stage]}</span>`;
    const stepNo = `<span class="sn">шаг ${stage + 1} из 5</span>`;
    const out = stepNo + html;
    if (this.cap._h !== out) {
      this.cap._h = out;
      this.cap.innerHTML = out;
    }
  }

  draw() {
    this.updateCaption();
    this.render();
  }

  destroy() {
    this.root.remove();
  }
}
