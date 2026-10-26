// AgentCompare — два терминала агента (без подбора / с подбором), один и тот же
// скрипт шагов. Под ними накопительная полоса времени: «чтение контекста»
// (префилл) и «генерация» (декод).
//
// Модель времени шага [ДОПУЩЕНИЕ ДЕМО]: на стороне без подбора доля префилла —
// 45 % времени шага («почти половина», доп. ТЗ). Префилл на обеих сторонах
// одинаков (подбор его почти не ускоряет), поэтому всё ускорение шага 1,41×
// приходится на декод: декод ускоряется в s раз, где s находится из
//   T_base/gain = P + D/s   →   s = D / (T_base/gain − P).
// Отсюда вывод сцены: после подбора префилл — уже около двух третей шага.
import { MODES } from "../data.js";
import { AGENTS } from "../snippets.js";
import { highlightPython, esc } from "../lib/highlight.js";
import { el, clamp } from "../lib/util.js";
import { fmtNum, fmtInt, fmtMult } from "../lib/format.js";
import { MODE_SIM } from "../sim.js";

export const PREFILL_SHARE = 0.45;
const T_BASE_REAL = 360; // [ДОПУЩЕНИЕ ДЕМО] задача без подбора занимает ≈ 6 мин
const WEIGHTS = [0.8, 1.0, 0.9, 1.4, 1.7, 1.4, 1.0, 1.2, 1.3, 1.9, 1.1, 1.0];

function mmss(sec) {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)} мин ${String(s % 60).padStart(2, "0")} с`;
}

export function buildTimeline(script, gain) {
  const n = script.steps.length;
  const w = Array.from({ length: n }, (_, i) => WEIGHTS[i % WEIGHTS.length]);
  const sw = w.reduce((a, b) => a + b, 0);
  const d = w.map((x) => (T_BASE_REAL * x) / sw); // длительность шага без подбора
  const P = d.map((x) => x * PREFILL_SHARE);
  const D = d.map((x) => x * (1 - PREFILL_SHARE));
  const Ptot = P.reduce((a, b) => a + b, 0);
  const Dtot = D.reduce((a, b) => a + b, 0);
  const s = Dtot / (T_BASE_REAL / gain - Ptot);
  const build = (decodeSpeedup) => {
    let t = 0;
    return P.map((p, i) => {
      const dec = D[i] / decodeSpeedup;
      const row = { start: t, pEnd: t + p, end: t + p + dec, p, dec };
      t = row.end;
      return row;
    });
  };
  return { base: build(1), tuned: build(s), decodeSpeedup: s, n };
}

class Term {
  constructor(kind, script, rows, compact) {
    this.kind = kind;
    this.script = script;
    this.rows = rows;
    this.compact = compact;
    this.root = el("div", "side " + kind);
    const head = el("div", "side-head");
    head.innerHTML = `<div><div class="t">${kind === "base" ? "Стандартный деплой · без подбора" : "Подобранная конфигурация"}</div><div class="s">${
      kind === "base" ? "BF16, без MTP" : MODES.agent.recipe.join(" + ")
    }</div></div><div class="clk"><span class="over">время задачи</span><div class="num clkv serif">0 мин 00 с</div></div>`;
    this.term = el("div", "term");
    this.termBody = el("div", "term-body");
    const bar = el("div", "term-bar");
    bar.innerHTML = `<span class="dot"></span><span class="dot"></span><span class="dot"></span><span class="fn">agent · ${esc(script.task)}</span>`;
    this.pre = el("pre");
    this.termBody.append(this.pre);
    this.term.append(bar, this.termBody);
    this.bar = el("div", "tbar");
    this.bar.innerHTML = `<div class="tbar-cap"><span class="over">где тратится время</span><span class="legend"><i class="lg pre"></i>чтение контекста (префилл) <i class="lg gen"></i>генерация (декод)</span></div><canvas></canvas><div class="tbar-sum"></div>`;
    this.cv = this.bar.querySelector("canvas");
    this.cv.width = 1744;
    this.cv.height = 120;
    this.sum = this.bar.querySelector(".tbar-sum");
    this.clk = head.querySelector(".clkv");
    this.root.append(head, this.term, this.bar);
    this.total = rows[rows.length - 1].end;
    this.preTotal = rows.reduce((a, r) => a + r.p, 0);
    this.sig = "";
  }

  update(tau, axisMax, css) {
    const rows = this.rows;
    const script = this.script;
    const finished = tau >= this.total;
    const shownT = Math.min(tau, this.total);
    if (this.clk._t !== mmss(shownT)) {
      this.clk._t = mmss(shownT);
      this.clk.textContent = mmss(shownT);
    }
    // терминал
    let html = "";
    let activeStep = -1;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (tau < r.start) break;
      const st = script.steps[i];
      html += `<span class="tl-step">шаг ${i + 1}/${rows.length}</span>\n`;
      if (tau < r.pEnd) {
        const frac = (tau - r.start) / (r.pEnd - r.start);
        const ctxK = 18 + i * 4 + Math.round(frac * 4);
        const dots = ".".repeat(1 + (Math.floor(tau * 3) % 3));
        html += `<span class="tl-pre">читает контекст${dots}  ${ctxK}k токенов</span>`;
        activeStep = i;
        break;
      }
      const decFrac = clamp((tau - r.pEnd) / (r.end - r.pEnd), 0, 1);
      const say = st.say;
      const call = "$ " + st.call;
      const full = say + "\n" + call;
      const shown = full.slice(0, Math.round(decFrac * full.length));
      const parts = shown.split("\n");
      html += `<span class="tl-say">${esc(parts[0])}</span>\n`;
      if (parts.length > 1) html += `<span class="tl-call">${esc(parts[1])}</span>\n`;
      if (decFrac < 1) {
        activeStep = i;
        break;
      }
      html += outHTML(st.out, st.green) + "\n";
    }
    if (finished) html += `\n<span class="tl-done">✓ задача выполнена · ${mmss(this.total)}</span>`;
    const blink = Math.floor(tau / 4) % 2 === 0;
    html += finished ? "" : `<span class="cursor${blink ? "" : " off"}"></span>`;
    if (this.pre._h !== html) {
      this.pre._h = html;
      this.pre.innerHTML = html;
    }
    // полоса времени
    const g = this.cv.getContext("2d");
    const W = this.cv.width;
    const H = this.cv.height;
    g.clearRect(0, 0, W, H);
    const X = (t) => (t / axisMax) * W;
    const y = 18;
    const h = 58;
    g.fillStyle = css.line;
    g.fillRect(0, y, W, h);
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const a = Math.min(tau, r.pEnd);
      if (a > r.start) {
        g.fillStyle = css.pre;
        g.fillRect(X(r.start), y, X(a) - X(r.start), h);
      }
      const b = Math.min(tau, r.end);
      if (b > r.pEnd) {
        g.fillStyle = css.gen;
        g.fillRect(X(r.pEnd), y, X(b) - X(r.pEnd), h);
      }
      g.fillStyle = css.bg;
      g.fillRect(X(r.end) - 1.5, y - 4, 3, h + 8);
    }
    g.fillStyle = css.ink;
    g.font = "26px sans-serif";
    const doneNow = Math.min(tau, this.total);
    if (finished) {
      g.fillText(`${mmss(this.total)}`, X(this.total) + 14, y + 40);
    }
    void doneNow;
    // итоговая строка
    const preShare = this.preTotal / this.total;
    const sum = `префилл ${fmtInt(preShare * 100)} % времени задачи`;
    if (this.sum._t !== sum) {
      this.sum._t = sum;
      this.sum.textContent = sum;
    }
  }
}

function outHTML(out, green) {
  return out
    .split("\n")
    .map((l) => {
      if (/^FAILED|Error|failed/.test(l)) return `<span class="tl-bad">${esc(l)}</span>`;
      if (/passed/.test(l) && !/failed/.test(l)) return `<span class="${green ? "tl-ok big" : "tl-ok"}">${esc(l)}</span>`;
      if (l.startsWith("+")) return `<span class="hl-b">${esc(l)}</span>`;
      if (l.startsWith("-")) return `<span class="hl-s">${esc(l)}</span>`;
      return `<span class="tl-out">${esc(l)}</span>`;
    })
    .join("\n");
}

export class AgentCompare {
  /**
   * @param {HTMLElement} host
   * @param {{seed?:number, scriptIndex?:number, playSeconds?:number, compact?:boolean, loop?:boolean}} o
   * playSeconds — за сколько секунд показа проходит задача без подбора.
   */
  constructor(host, o = {}) {
    this.o = { scriptIndex: 0, playSeconds: 11, compact: false, ...o };
    const gain = MODES.agent.gain;
    this.script = AGENTS[this.o.scriptIndex];
    this.tl = buildTimeline(this.script, gain);
    this.speed = T_BASE_REAL / this.o.playSeconds; // «секунд задачи» за секунду показа
    this.t = 0;
    this.root = el("div", "agentcmp");
    const split = el("div", "split" + (this.o.compact ? " compact" : ""));
    this.base = new Term("base", this.script, this.tl.base, this.o.compact);
    this.tuned = new Term("tuned", this.script, this.tl.tuned, this.o.compact);
    split.append(this.base.root, this.tuned.root);
    this.summary = el("div", "agent-summary");
    this.root.append(split, this.summary);
    host.append(this.root);
    const cs = getComputedStyle(this.root);
    const g = (n) => cs.getPropertyValue(n).trim();
    this.css = {
      line: g("--line"),
      pre: g("--base-mid"),
      gen: g("--ours"),
      ink: g("--ink"),
      bg: g("--bg"),
    };
    this.axisMax = this.tl.base[this.tl.base.length - 1].end * 1.04;
  }

  get tau() {
    return this.t * this.speed;
  }

  step(dt = 1 / 60) {
    this.t += dt;
  }

  render() {
    const tau = this.tau;
    this.base.update(tau, this.axisMax, this.css);
    this.tuned.update(tau, this.axisMax, this.css);
    const slots = MODE_SIM.agent.B; // параллельных агентов на кластере
    const perHBase = (slots * 3600) / this.base.total;
    const perHTuned = (slots * 3600) / this.tuned.total;
    const bothDone = tau >= this.base.total;
    const tunedDone = tau >= this.tuned.total;
    const prShareTuned = this.tuned.preTotal / this.tuned.total;
    let html = "";
    if (tunedDone) {
      html = `<div class="as-row"><div class="as-k">Задач в час на кластере</div>
        <div class="as-v b">${fmtInt(perHBase)}</div><div class="as-arrow">→</div><div class="as-v o">${fmtInt(perHTuned)}</div>
        <div class="as-note">${slots} агентов параллельно, задача ≈ ${fmtInt(T_BASE_REAL / 60)} мин без подбора — иллюстрация к расчёту. Выигрыш ${fmtMult(MODES.agent.gain)}.</div></div>
        <div class="as-why"><b>Почему не больше?</b> После подбора генерация стала быстрее в ${fmtNum(this.tl.decodeSpeedup, 1)}×, а чтение контекста — нет: теперь на него уходит ${fmtInt(prShareTuned * 100)} % времени шага. Его ускоряют другие методы (кэш префикса, маршрутизация).</div>`;
    } else {
      html = `<div class="as-row"><div class="as-k">Задач в час на кластере</div><div class="as-v b">…</div><div class="as-arrow">→</div><div class="as-v o">…</div></div>`;
    }
    void bothDone;
    if (this.summary._h !== html) {
      this.summary._h = html;
      this.summary.innerHTML = html;
    }
  }

  destroy() {
    this.root.remove();
  }
}
