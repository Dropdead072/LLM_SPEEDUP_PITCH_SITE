// Сцена 10 · «Полгода партнёрства» (необязательная): шкала M0–M6 из слайда 17.
// Что каждый этап превращает из расчёта в замер — это закрывает главный риск обеих
// версий питча: всё, что вы видели, — расчёт; вот план, как каждая картинка станет замером.
import { el, clamp } from "../lib/util.js";

export const meta = {
  no: 10,
  title: "Полгода партнёрства: из расчёта в замер",
  disclaimer: "model",
  keys: "<b>←</b><b>→</b> сцены &nbsp; <b>пробел</b> пауза &nbsp; <b>R</b> заново &nbsp; <b>G</b> кейсы",
};

const PHASES = [
  { m: "M0–1", t: "Baseline + trace", d: "снимаем baseline на реальном trace клиента", turns: "Сцена 1 перестаёт быть симуляцией", scene: "сцена 1", from: 0, to: 1 },
  { m: "M1–3", t: "Большие модели + поиск", d: "поиск конфигураций на больших моделях", turns: "Сцена 7 — на реальных точках, а не сгенерированных", scene: "сцена 7", from: 1, to: 3 },
  { m: "M3–4", t: "Production-like replay", d: "реплей нагрузки в условиях, близких к боевым", turns: "Сцены 2 и 8: TTFT, очереди и кэш — с настоящего trace", scene: "сцены 2, 8", from: 3, to: 4 },
  { m: "M4–5", t: "Quality + SLA acceptance", d: "проверка качества и p95 по порогам клиента", turns: "Сцена 9 — отчёт приёмки на реальном trace", scene: "сцена 9", from: 4, to: 5 },
  { m: "M5–6", t: "Profile + contract", d: "итоговый profile и договорённости", turns: "Сцена 5 — деньги считаются по подтверждённому эффекту", scene: "сцена 5", from: 5, to: 6 },
];
const PHASE_LEN = 2.3;

export function create(ctx) {
  const root = el("div", "s10");
  const lead = el("div", "s10-lead serif");
  lead.innerHTML = `Всё, что вы видели, — <b>расчёт по модели</b>. Вот как каждая картинка превращается в замер.`;
  const axis = el("div", "s10-axis");
  const ticks = el("div", "s10-ticks");
  for (let m = 0; m <= 6; m++) {
    const tk = el("div", "tk");
    tk.style.left = (m / 6) * 100 + "%";
    tk.innerHTML = `<i></i><span>M${m}</span>`;
    ticks.append(tk);
  }
  const fill = el("div", "s10-fill");
  axis.append(fill, ticks);
  const cards = el("div", "s10-cards");
  const cardEls = PHASES.map((p, i) => {
    const c = el("div", "s10-card");
    c.style.left = (p.from / 6) * 100 + "%";
    c.style.width = ((p.to - p.from) / 6) * 100 + "%";
    c.innerHTML = `<div class="m over">${p.m}</div><div class="t serif">${p.t}</div><div class="d">${p.d}</div>
      <div class="turn"><span class="sc">${p.scene}</span>${p.turns}</div>`;
    cards.append(c);
    return c;
  });
  root.append(lead, axis, cards);
  ctx.host.append(root);

  return {
    step() {},
    render() {
      const t = ctx.clock.t;
      const idx = ctx.record || ctx.params.auto ? Math.min(PHASES.length - 1, Math.floor(t / PHASE_LEN)) : null;
      const prog = idx == null ? 1 : clamp((t - 0.3) / (PHASE_LEN * PHASES.length), 0, 1);
      fill.style.width = prog * 100 + "%";
      cardEls.forEach((c, i) => {
        const appeared = idx == null ? true : t >= i * PHASE_LEN + 0.3;
        c.style.opacity = appeared ? "1" : "0.18";
        c.classList.toggle("now", idx != null && i === idx);
      });
    },
    destroy() {
      root.remove();
    },
  };
}
