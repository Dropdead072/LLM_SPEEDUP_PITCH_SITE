// Timeline — три варианта графика: «сутки» (A4), «месяцы» (B1), «недели» (B4).
// Всё рисуется на Canvas (внутреннее разрешение ×2), время — виртуальное (step()).
import { HEADLINE, MODES } from "../data.js";
import { deferNode, nightBatch, WEEKLY_LOSS_RUB, clockHM } from "../cases.js";
import { el, clamp, lerp, smooth, themeColors, rgb } from "../lib/util.js";
import { fmtNum, fmtMln } from "../lib/format.js";

const W = 2000;
const H = 1040;

function hatch(g, x, y, w, h, color, gap = 16) {
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.strokeStyle = color;
  g.lineWidth = 3;
  for (let d = -h; d < w + h; d += gap) {
    g.beginPath();
    g.moveTo(x + d, y + h);
    g.lineTo(x + d + h, y);
    g.stroke();
  }
  g.restore();
}

export class Timeline {
  /** @param {{kind:'day'|'months'|'weeks', r?:number}} o */
  constructor(host, o) {
    this.o = { r: 0.05, ...o };
    this.kind = o.kind;
    this.t = 0;
    this.r = this.o.r;
    this.root = el("div", "tl");
    if (this.kind === "months") {
      const c = el("div", "controls");
      const sl = el("label", "slider");
      sl.innerHTML = `<span class="lab">Рост нагрузки в месяц</span>`;
      const inp = el("input");
      inp.type = "range";
      inp.min = "2";
      inp.max = "10";
      inp.step = "0.5";
      inp.value = String(this.r * 100);
      const out = el("output", "num");
      out.textContent = fmtNum(this.r * 100, 1) + " %";
      inp.oninput = () => {
        this.r = parseFloat(inp.value) / 100;
        out.textContent = fmtNum(this.r * 100, 1) + " %";
        this.t = Math.min(this.t, 0.5);
      };
      sl.append(inp, out);
      c.append(sl);
      this.root.append(c);
    }
    this.cv = el("canvas", "tl-cv");
    this.cv.width = W;
    this.cv.height = H;
    this.root.append(this.cv);
    this.note = el("div", "tl-note");
    this.root.append(this.note);
    host.append(this.root);
    this.C = themeColors(this.root);
  }

  step(dt = 1 / 60) {
    this.t += dt;
  }

  render() {
    const g = this.cv.getContext("2d");
    g.clearRect(0, 0, W, H);
    g.textBaseline = "alphabetic";
    if (this.kind === "day") this.drawDay(g);
    else if (this.kind === "months") this.drawMonths(g);
    else this.drawWeeks(g);
  }

  axes(g, area, xt, xLabel) {
    const { x0, x1, y0, y1 } = area;
    g.strokeStyle = rgb(this.C.line2);
    g.lineWidth = 2;
    g.fillStyle = rgb(this.C.ink2);
    g.font = "26px Arimo, sans-serif";
    g.textAlign = "center";
    for (const [x, label] of xt) {
      g.beginPath();
      g.strokeStyle = rgb(this.C.line);
      g.moveTo(x, y0);
      g.lineTo(x, y1);
      g.stroke();
      g.fillText(label, x, y1 + 36);
    }
    g.strokeStyle = rgb(this.C.line2);
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x0, y1);
    g.lineTo(x1, y1);
    g.stroke();
    if (xLabel) {
      g.font = "bold 24px Arimo, sans-serif";
      g.fillText(xLabel, (x0 + x1) / 2, y1 + 78);
    }
  }

  // ---------------- A4: сутки ----------------
  drawDay(g) {
    const C = this.C;
    const n = nightBatch();
    const area = { x0: 120, x1: W - 40, y0: 90, y1: 470 };
    const X = (h) => area.x0 + (h / 24) * (area.x1 - area.x0);
    this.axes(
      g,
      area,
      Array.from({ length: 13 }, (_, i) => [X(i * 2), String(i * 2).padStart(2, "0") + ":00"]),
      null
    );
    // дневная нагрузка подсказок: пики около 10:00 и 15:00
    const load = (h) => 0.08 + 0.3 * smooth((h - 7) / 2.5) * smooth((20 - h) / 2.5) + 0.62 * Math.exp(-((h - 10) ** 2) / 3.2) + 0.5 * Math.exp(-((h - 15) ** 2) / 4.5);
    g.beginPath();
    g.moveTo(X(0), area.y1);
    for (let h = 0; h <= 24; h += 0.1) g.lineTo(X(h), area.y1 - load(h) * (area.y1 - area.y0 - 20));
    g.lineTo(X(24), area.y1);
    g.closePath();
    g.fillStyle = rgb(C.line2, 0.8);
    g.fill();
    g.fillStyle = rgb(C.ink2);
    g.font = "bold 24px Arimo, sans-serif";
    g.textAlign = "left";
    g.fillText("дневная нагрузка подсказок", X(0.4), area.y0 + 8);
    // утренний пик
    g.fillStyle = rgb(C.baseline, 0.1);
    g.fillRect(X(8.5), area.y0, X(11.5) - X(8.5), area.y1 - area.y0);
    g.fillStyle = rgb(C.baseline);
    g.fillText("утренний пик", X(8.6), area.y0 + 8);

    // часы
    const clock = Math.min(24, this.t * 1.5);
    const lanes = [
      { name: "без подбора", hours: n.hours, color: C.baseline, y: 600 },
      { name: "с подбором", hours: n.tunedHours, color: C.ours, y: 760 },
    ];
    const start = 1;
    g.font = "bold 26px Arimo, sans-serif";
    for (const L of lanes) {
      g.fillStyle = rgb(C.ink);
      g.textAlign = "left";
      g.fillText(`ночной пакет агентов · ${L.name}`, area.x0, L.y - 22);
      g.fillStyle = rgb(C.line);
      g.fillRect(X(0), L.y, X(24) - X(0), 70);
      const end = start + L.hours;
      const upto = clamp(clock, start, end);
      if (upto > start) {
        g.fillStyle = rgb(L.color);
        g.fillRect(X(start), L.y, X(upto) - X(start), 70);
        // заехал на утренний пик — подсветка пересечения
        const ovS = 8.5;
        if (upto > ovS && L.hours > 7) {
          hatch(g, X(ovS), L.y, X(upto) - X(ovS), 70, rgb(C.surface, 0.9), 14);
        }
      }
      if (clock >= end) {
        g.fillStyle = rgb(L.color);
        g.textAlign = "left";
        g.fillText(`готов в ${clockHM(end)}`, X(end) + 14, L.y + 46);
      }
    }
    if (clock > 8.5 && clock < 9.4) {
      g.fillStyle = rgb(C.baseline);
      g.font = "bold 28px Arimo, sans-serif";
      g.textAlign = "left";
      g.fillText("← утренние подсказки ждут: пакет ещё занимает GPU", X(9.5), lanes[0].y + 110);
    }
    // «сейчас»
    g.strokeStyle = rgb(C.ink);
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(X(clock), area.y0 - 14);
    g.lineTo(X(clock), 860);
    g.stroke();
    g.fillStyle = rgb(C.ink);
    g.font = "bold 28px Arimo, sans-serif";
    g.textAlign = "center";
    g.fillText(clockHM(clock), X(clock), area.y0 - 24);
    this.setNote(`Объём ночного пакета ≈ ${fmtNum(n.tokens / 1e6, 1)} млн токенов (${n.gpus} GPU × ${MODES.agent.base.toFixed(1).replace(".", ",")} ток/с × ${n.hours} ч). Выигрыш агентов — по модели производительности; форма дневного пика — иллюстрация.`);
  }

  // ---------------- B1: месяцы ----------------
  drawMonths(g) {
    const C = this.C;
    const d = deferNode(this.r);
    const area = { x0: 150, x1: W - 50, y0: 70, y1: 780 };
    const MAXM = 18;
    const X = (m) => area.x0 + (m / MAXM) * (area.x1 - area.x0);
    const ymin = 0.6;
    const ymax = 1.7;
    const Y = (v) => area.y1 - ((v - ymin) / (ymax - ymin)) * (area.y1 - area.y0);
    this.axes(g, area, Array.from({ length: 7 }, (_, i) => [X(i * 3), `${i * 3} мес`]), "месяцы");
    g.textAlign = "right";
    g.font = "26px Arimo, sans-serif";
    g.fillStyle = rgb(C.ink2);
    for (const v of [0.8, 1.0, 1.25, 1.5]) {
      g.fillText(fmtNum(v, 2), area.x0 - 14, Y(v) + 9);
      g.strokeStyle = rgb(C.line);
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(area.x0, Y(v));
      g.lineTo(area.x1, Y(v));
      g.stroke();
    }
    const prog = clamp(this.t / 3, 0, 1) * MAXM;
    // отсрочка: полоса между пересечениями
    const inRange = (m) => m <= MAXM;
    if (prog >= d.tBase) {
      const a = X(d.tBase);
      const b = X(Math.min(d.tTuned, Math.min(prog, MAXM)));
      g.fillStyle = rgb(C.ours, 0.15);
      g.fillRect(a, Y(1.25), b - a, Y(1.0) - Y(1.25));
      hatch(g, a, Y(1.25), b - a, Y(1.0) - Y(1.25), rgb(C.ours, 0.55), 14);
    }
    // линии ёмкости
    g.lineWidth = 5;
    g.strokeStyle = rgb(C.baseline);
    g.beginPath();
    g.moveTo(X(0), Y(1.0));
    g.lineTo(X(MAXM), Y(1.0));
    g.stroke();
    g.strokeStyle = rgb(C.ours);
    g.beginPath();
    g.moveTo(X(0), Y(1.25));
    g.lineTo(X(MAXM), Y(1.25));
    g.stroke();
    g.font = "bold 26px Arimo, sans-serif";
    g.textAlign = "right";
    g.fillStyle = rgb(C.baseline);
    g.fillText("ёмкость без подбора (1,00)", X(MAXM) - 12, Y(1.0) + 40);
    g.fillStyle = rgb(C.ours);
    g.fillText("ёмкость с подбором (+25 % → 1,25)", X(MAXM) - 12, Y(1.25) - 18);
    // кривая спроса
    g.strokeStyle = rgb(C.ink);
    g.lineWidth = 6;
    g.beginPath();
    for (let m = 0; m <= prog + 1e-6; m += 0.05) {
      const v = 0.9 * Math.pow(1 + this.r, m);
      const y = Y(Math.min(v, ymax));
      if (m === 0) g.moveTo(X(m), y);
      else g.lineTo(X(m), y);
      if (v > ymax) break;
    }
    g.stroke();
    g.fillStyle = rgb(C.ink);
    g.textAlign = "left";
    g.fillText("нагрузка (сейчас 90 % ёмкости)", X(0.2), Y(0.9) + 62);
    // отметки «нужна новая нода»
    const mark = (m, color, label, dx, dy) => {
      if (!inRange(m) || prog < m) return;
      const yy = Y(color === C.baseline ? 1.0 : 1.25);
      g.fillStyle = rgb(color);
      g.beginPath();
      g.arc(X(m), yy, 13, 0, Math.PI * 2);
      g.fill();
      g.font = "bold 25px Arimo, sans-serif";
      g.textAlign = "left";
      g.fillText(label, X(m) + dx, yy + dy);
    };
    // подписи — со смещением от точек, чтобы не лечь на линии ёмкости и друг на друга
    mark(d.tBase, C.baseline, `${fmtNum(d.tBase, 1)} мес · нужна новая нода`, 18, 84);
    mark(d.tTuned, C.ours, `${fmtNum(d.tTuned, 1)} мес · нужна новая нода`, 18, -60);
    if (prog >= Math.min(d.tTuned, MAXM) && inRange(d.tTuned)) {
      g.fillStyle = rgb(C.ink);
      g.font = "bold 40px Tinos, serif";
      g.textAlign = "center";
      g.fillText(`отсрочка ≈ ${fmtNum(d.months, 1)} мес`, (X(d.tBase) + X(d.tTuned)) / 2, Y(1.25) - 120);
    }
    this.setNote(
      `Покупка (или аренда) ноды откладывается на ≈ ${fmtNum(d.months, 1)} мес — это ≈ ${fmtMln(d.rub)} аренды ноды по публичной ставке (${HEADLINE.costBasis}). Рост нагрузки — параметр демо (ползунок).`
    );
  }

  // ---------------- B4: недели ----------------
  drawWeeks(g) {
    const C = this.C;
    const area = { x0: 150, x1: W - 50, y0: 90, y1: 760 };
    const WEEKS = 26;
    const X = (w) => area.x0 + (w / WEEKS) * (area.x1 - area.x0);
    const ymin = 0.85;
    const ymax = 1.4;
    const Y = (v) => area.y1 - ((v - ymin) / (ymax - ymin)) * (area.y1 - area.y0);
    this.axes(g, area, Array.from({ length: 6 }, (_, i) => [X(i * 5), `нед. ${i * 5}`]), "недели");
    g.textAlign = "right";
    g.font = "26px Arimo, sans-serif";
    g.fillStyle = rgb(C.ink2);
    for (const v of [1.0, 1.25]) g.fillText(fmtNum(v, 2), area.x0 - 14, Y(v) + 9);
    const W1 = 9;
    const W2 = 12;
    const prog = clamp(this.t / 6, 0, 1) * WEEKS;
    // потерянный эффект
    if (prog > W1) {
      const b = X(Math.min(prog, W2));
      hatch(g, X(W1), Y(1.25), b - X(W1), Y(1.0) - Y(1.25), rgb(C.baseline, 0.75), 14);
    }
    // серая линия «без квартального цикла»
    if (prog > W1) {
      g.setLineDash([16, 12]);
      g.strokeStyle = rgb(C.muted);
      g.lineWidth = 5;
      g.beginPath();
      g.moveTo(X(W1), Y(1.0));
      g.lineTo(X(Math.min(prog, WEEKS)), Y(1.0));
      g.stroke();
      g.setLineDash([]);
      if (prog >= WEEKS - 0.01) {
        g.fillStyle = rgb(C.ink2);
        g.font = "bold 24px Arimo, sans-serif";
        g.textAlign = "right";
        g.fillText("без квартального цикла: остаётся на 1,00", X(WEEKS), Y(1.0) + 40);
      }
    }
    // основная линия ёмкости: ломаная 1,25 → (нед. 9) 1,00 → (нед. 12) 1,25, обрезанная по прогрессу
    const poly = [[0, 1.25], [W1, 1.25], [W1, 1.0], [W2, 1.0], [W2, 1.25], [WEEKS, 1.25]];
    g.strokeStyle = rgb(C.ours);
    g.lineWidth = 7;
    g.lineJoin = "round";
    g.beginPath();
    g.moveTo(X(poly[0][0]), Y(poly[0][1]));
    for (let i = 1; i < poly.length; i++) {
      const [w0, v0] = poly[i - 1];
      const [w1, v1] = poly[i];
      if (prog >= w1) g.lineTo(X(w1), Y(v1));
      else {
        if (prog > w0) g.lineTo(X(prog), Y(lerp(v0, v1, (prog - w0) / (w1 - w0 || 1))));
        break;
      }
    }
    g.stroke();
    // события
    const ev = (w, label, color, dy = 0) => {
      if (prog < w) return;
      g.strokeStyle = rgb(color);
      g.lineWidth = 3;
      g.setLineDash([8, 8]);
      g.beginPath();
      g.moveTo(X(w), area.y0);
      g.lineTo(X(w), area.y1);
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = rgb(color);
      g.font = "bold 26px Arimo, sans-serif";
      g.textAlign = "left";
      g.fillText(label, X(w) + 12, area.y0 + 28 + dy);
    };
    ev(W1, "неделя 9 · вышла новая модель", C.baseline);
    ev(W2, "неделя 12 · новый profile", C.ours, 36); // вторая строка: подписи не должны налезать друг на друга
    g.font = "bold 24px Arimo, sans-serif";
    g.textAlign = "left";
    g.fillStyle = rgb(C.ours);
    g.fillText("+25 % · профиль применён", X(0.4), Y(1.25) - 18);
    if (prog > W2) {
      g.fillStyle = rgb(C.baseline);
      g.font = "bold 30px Arimo, sans-serif";
      g.textAlign = "center";
      g.fillText(`≈ ${fmtNum(WEEKLY_LOSS_RUB / 1e6, 2)} млн ₽ в неделю простоя`, (X(W1) + X(W2)) / 2, Y(1.0) + 74);
    }
    this.setNote(
      `Потерянный эффект — штриховка между 1,00 и 1,25: ≈ ${fmtNum(WEEKLY_LOSS_RUB / 1e6, 2)} млн ₽ за каждую неделю простоя profile (одна нода, ${HEADLINE.costBasis}).`
    );
  }

  setNote(text) {
    if (this.note._t !== text) {
      this.note._t = text;
      this.note.textContent = text;
    }
  }

  destroy() {
    this.root.remove();
  }
}
