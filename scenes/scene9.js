// Сцена 9 · «Отчёт приёмки» — визуализация четвёртого deliverable (слайд 11).
// Терминал, в котором прогоняются acceptance tests. Формат отчёта важнее чисел:
// значения quality и p95 — допущение демо. Две последние строки берутся из HEADLINE;
// множители режимов здесь не показываются (правило: +25 % и множители не на одном экране).
import { HEADLINE } from "../data.js";
import { esc } from "../lib/highlight.js";
import { el, clamp } from "../lib/util.js";
import { fmtNum, fmtInt } from "../lib/format.js";

export const meta = {
  no: 9,
  title: "Отчёт приёмки",
  disclaimer:
    "Демонстрация формата отчёта. Технические числа — расчёт по модели, не замер",
  keys: "<b>←</b><b>→</b> сцены &nbsp; <b>пробел</b> пауза &nbsp; <b>R</b> заново &nbsp; <b>G</b> кейсы",
};

const gain = Math.round((HEADLINE.throughputGain - 1) * 100);

// {at} — момент печати строки (с), {spin} — длительность «спиннера» перед галочкой
const LINES = [
  { at: 0.4, type: "cmd", text: "$ perf-profile accept --baseline baseline.yaml --profile code-assist-v3.yaml --trace trace_2026q4.jsonl" },
  { at: 1.6, type: "info", text: "replay trace ........................ 41 286 запросов", spin: 1.0 },
  { at: 3.2, type: "check", label: "quality  (Δ к baseline)", value: "−0,4 пп", limit: "≤ 1,0 пп", spin: 0.7 },
  { at: 4.4, type: "check", label: "p95 TTFT  hint", value: "0,31 с", limit: "≤ 0,60 с", spin: 0.7 },
  { at: 5.6, type: "check", label: "p95 TTFT  chat", value: "1,12 с", limit: "≤ 2,00 с", spin: 0.7 },
  { at: 6.8, type: "check", label: "полезные ток/с на GPU", value: `+${gain} % к baseline`, limit: "", spin: 0.7 },
  {
    at: 8.0,
    type: "check",
    label: "GPU для той же нагрузки",
    value: `${HEADLINE.fleet} → ${HEADLINE.after} ${HEADLINE.gpu}`,
    limit: "",
    spin: 0.7,
  },
  { at: 9.3, type: "pass", text: "PASSED  5/5   profile code-assist-v3 принят" },
];

const CARDS = [
  { t: "Baseline", s: "tokens/s/GPU, p95, качество, стоимость на реальном trace", scene: 1 },
  { t: "Pareto", s: "кривая по качеству, latency и capacity", scene: 7 },
  { t: "Deployment", s: "оптимизированный container / config", scene: 8 },
  { t: "Acceptance", s: "acceptance tests с delta к исходной системе", scene: 9 },
];

const CHECK = `<svg class="ck" viewBox="0 0 20 20" width="20" height="20"><path d="M3 10.5l4.5 4.5L17 5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function create(ctx) {
  const root = el("div", "s9");
  const term = el("div", "s9-term");
  const bar = el("div", "term-bar");
  bar.innerHTML = `<span class="dot"></span><span class="dot"></span><span class="dot"></span><span class="fn">acceptance · code-assist-v3</span>`;
  const pre = el("div", "s9-pre");
  term.append(bar, pre);
  const cards = el("div", "s9-cards");
  const cardEls = CARDS.map((c, i) => {
    const d = el("div", "s9-card");
    d.innerHTML = `<div class="n over">${i + 1}</div><div class="t serif">${c.t}</div><div class="s">${c.s}</div><div class="st"></div>`;
    cards.append(d);
    return d;
  });
  root.append(term, cards);
  ctx.host.append(root);

  const TAIL = LINES[LINES.length - 1].at + 0.6;

  function renderTerm(t) {
    let html = "";
    for (const L of LINES) {
      if (t < L.at) break;
      const age = t - L.at;
      if (L.type === "cmd") {
        const n = Math.min(L.text.length, Math.floor(age * 120));
        html += `<div class="l cmd">${esc(L.text.slice(0, n))}</div>`;
      } else if (L.type === "info") {
        const done = age >= L.spin;
        const sp = SPIN[Math.floor(t * 12) % SPIN.length];
        html += `<div class="l">${esc(L.text)} <span class="${done ? "ok" : "spin"}">${done ? CHECK : sp}</span></div>`;
      } else if (L.type === "check") {
        const done = age >= L.spin;
        const sp = SPIN[Math.floor(t * 12) % SPIN.length];
        html += `<div class="l check"><span class="lb">${esc(L.label)}</span><span class="val ${done ? "" : "dim"}">${done ? esc(L.value) : "…"}</span><span class="lim">${done ? esc(L.limit) : ""}</span><span class="${done ? "ok" : "spin"}">${done ? CHECK : sp}</span></div>`;
      } else {
        const u = clamp(age / 0.5, 0, 1);
        html += `<div class="l pass" style="opacity:${u.toFixed(2)}">${esc(L.text)}</div>`;
      }
    }
    const blink = Math.floor(t * 2) % 2 === 0;
    html += `<div class="l"><span class="cursor${blink ? "" : " off"}"></span></div>`;
    if (pre._h !== html) {
      pre._h = html;
      pre.innerHTML = html;
    }
  }

  function renderCards(t) {
    cardEls.forEach((c, i) => {
      const passed = i < 3;
      const last = i === 3;
      const active = last && t >= TAIL;
      c.classList.toggle("done", passed && t >= 0.3 + i * 0.2);
      c.classList.toggle("lit", active);
      const st = c.querySelector(".st");
      const txt = last ? (active ? "принято" : "идёт проверка…") : "пройдено · сцена " + CARDS[i].scene;
      if (st._t !== txt) {
        st._t = txt;
        st.textContent = txt;
      }
    });
  }

  return {
    step() {},
    render() {
      const t = ctx.clock.t;
      renderTerm(t);
      renderCards(t);
    },
    destroy() {
      root.remove();
    },
  };
}
