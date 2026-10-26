// Сцена 2 · «Подсказка, которая опоздала».
// Крупный план: один и тот же скриптованный набор (~6 символов/с, пробелы —
// автоотступ) на двух сторонах. Запросы автодополнения идут в тот же симулятор,
// что и в сцене 1, поэтому TTFT — настоящий выход очереди при текущей нагрузке.
import { Pair, MODE_SIM } from "../sim.js";
import { highlightPython, esc } from "../lib/highlight.js";
import { el, clamp } from "../lib/util.js";
import { fmtNum, fmtInt, fmtSec } from "../lib/format.js";
import { tokensOf } from "../snippets.js";

export const meta = {
  no: 2,
  title: "Подсказка, которая опоздала",
  disclaimer: "model",
  keys:
    "<b>←</b><b>→</b> сцены &nbsp; <b>пробел</b> пауза &nbsp; <b>R</b> заново &nbsp; <b>G</b> кейсы",
};

const TYPE_CPS = 6; // видимых символов в секунду
const REREQUEST_EVERY = 2.5; // как часто «нетерпеливый» редактор шлёт запрос повторно
const READ_TIME = 0.35; // сколько разработчик читает подсказку перед Tab
const START_DELAY = 2.0; // сначала разработчик читает код; за это время у стороны без подбора растёт очередь

const CTX = `from typing import Iterable


def merge_intervals(intervals: Iterable[tuple[int, int]]) -> list[tuple[int, int]]:
    """Склеивает пересекающиеся отрезки."""
    items = sorted(intervals)
    if not items:
        return []
    merged = [items[0]]
`;

// Каждый раунд: разработчик набирает typed, делает паузу — уходит запрос, ждём completion.
const ROUNDS = [
  {
    typed: "    for start, ",
    completion: `end in items[1:]:
        last_start, last_end = merged[-1]
        if start <= last_end:
            merged[-1] = (last_start, max(last_end, end))`,
  },
  {
    typed: "\n        else:",
    completion: `
            merged.append((start, end))
    return merged`,
  },
  {
    typed: `

def total_length(`,
    completion: `intervals: Iterable[tuple[int, int]]) -> int:
    return sum(end - start for start, end in merge_intervals(intervals))`,
  },
];
const FULL_LEN = CTX.length + ROUNDS.reduce((a, r) => a + r.typed.length + r.completion.length, 0);

const roundL = (r) => clamp(tokensOf(r.completion), 30, 60);

class Dev {
  constructor(kind, pair) {
    this.kind = kind;
    this.pair = pair;
    this.text = CTX;
    this.round = 0;
    this.phase = "typing";
    this.typedIdx = 0;
    this.selfIdx = 0;
    this.acc = 0;
    this.probes = [];
    this.cur = null;
    this.lastReq = -1;
    this.readUntil = 0;
    this.accepted = 0;
    this.late = 0;
    this.wasted = 0;
    this.toast = null;
    this.done = false;
    this.lastTtft = null;
  }

  send(now) {
    const r = ROUNDS[this.round];
    const req = this.pair.injectProbe(roundL(r), {}, this.kind)[this.kind];
    const p = { req, round: this.round, sentAt: now, state: "live", flashed: false, started: false };
    this.probes.push(p);
    this.lastReq = now;
    return p;
  }

  // свободные пробелы (автоотступ) + видимые символы по TYPE_CPS
  typeInto(str, idxKey, now, dt) {
    this.acc += TYPE_CPS * dt;
    let i = this[idxKey];
    while (i < str.length) {
      const ch = str[i];
      if (/\s/.test(ch)) {
        this.text += ch;
        i++;
        continue;
      }
      if (this.acc >= 1) {
        this.text += ch;
        this.acc -= 1;
        i++;
      } else break;
    }
    this[idxKey] = i;
    return i >= str.length;
  }

  step(now, dt) {
    const hintDeadline = MODE_SIM.hint.deadline;
    // опоздавшие подсказки приходят, когда разработчик уже ушёл вперёд
    for (const p of this.probes) {
      if (p.state === "stale") {
        const r = p.req;
        if (!p.started && r.tFirst !== null) {
          p.started = true;
          this.toast = { text: ROUNDS[p.round].completion.split("\n")[0].slice(0, 56), t0: now, round: p.round };
        }
        if (!p.flashed && r.tDone !== null) {
          p.flashed = true;
          this.late++;
          this.wasted += r.L;
          if (!this.toast || now - this.toast.t0 > 0.5)
            this.toast = { text: ROUNDS[p.round].completion.split("\n")[0].slice(0, 56), t0: now, round: p.round };
        }
      }
    }
    if (this.toast && now - this.toast.t0 > 1.1) this.toast = null;
    if (this.done) return;

    const r = ROUNDS[this.round];
    if (this.phase === "typing" && now < START_DELAY) return;
    if (this.phase === "typing") {
      if (this.typeInto(r.typed, "typedIdx", now, dt)) {
        this.cur = this.send(now);
        this.phase = "waiting";
      }
    } else if (this.phase === "waiting") {
      const q = this.cur.req;
      if (q.tFirst !== null && q.tFirst - q.arrival <= hintDeadline) this.phase = "ghost";
      else if (now - this.cur.sentAt > hintDeadline) {
        this.cur.state = "stale";
        this.phase = "selftype";
        this.selfIdx = 0;
        this.acc = 0;
      }
    } else if (this.phase === "ghost") {
      const q = this.cur.req;
      if (q.tDone !== null) {
        this.lastTtft = q.tFirst - q.arrival;
        this.phase = "reading";
        this.readUntil = now + READ_TIME;
      }
    } else if (this.phase === "reading") {
      if (now >= this.readUntil) {
        this.text += r.completion;
        this.accepted++;
        this.cur.state = "accepted";
        this.advance();
      }
    } else if (this.phase === "selftype") {
      // «нетерпеливый» редактор шлёт запрос заново каждые REREQUEST_EVERY с
      if (now - this.lastReq >= REREQUEST_EVERY) {
        const p = this.send(now);
        p.state = "stale";
      }
      if (this.typeInto(r.completion, "selfIdx", now, dt)) this.advance();
    }
  }

  advance() {
    this.round++;
    this.typedIdx = 0;
    this.acc = 0;
    if (this.round >= ROUNDS.length) {
      this.done = true;
      this.phase = "done";
    } else this.phase = "typing";
  }

  ghost() {
    if (this.phase !== "ghost" && this.phase !== "reading") return "";
    const r = ROUNDS[this.round];
    const q = this.cur.req;
    const frac = this.phase === "reading" ? 1 : clamp(q.produced / q.L, 0, 1);
    return r.completion.slice(0, Math.round(frac * r.completion.length));
  }

  progress() {
    return clamp(this.text.length / FULL_LEN, 0, 1);
  }
}

export function create(ctx) {
  const p = ctx.params;
  const host = ctx.host;
  const pair = new Pair({ mode: "hint", load: p.load, seed: ctx.seed, tiles: 0 });
  const devs = { base: new Dev("base", pair), tuned: new Dev("tuned", pair) };
  const T = Math.max(8, p.duration || 12);

  const root = el("div", "s2");
  const controls = el("div", "controls");
  const sl = el("label", "slider");
  sl.innerHTML = `<span class="lab">Нагрузка ρ подобранной стороны</span>`;
  const inp = el("input");
  inp.type = "range";
  inp.min = "0.1";
  inp.max = "1.1";
  inp.step = "0.01";
  inp.value = String(p.load);
  const out = el("output", "num");
  out.textContent = fmtNum(p.load, 2);
  inp.oninput = () => {
    pair.load = parseFloat(inp.value);
    out.textContent = fmtNum(pair.load, 2);
  };
  sl.append(inp, out);
  const note = el("div");
  note.style.cssText = "font:400 14px var(--sans);color:var(--ink-2)";
  note.textContent =
    "Один и тот же набор текста на обеих сторонах. Опоздавшая подсказка равна нулю — а GPU-время на неё уже потрачено.";
  controls.append(sl, note);
  if (ctx.record) controls.classList.add("static");

  const split = el("div", "split");
  const views = {};
  for (const kind of ["base", "tuned"]) {
    const side = el("div", "side " + kind);
    const head = el("div", "side-head");
    const hd = el("div");
    hd.innerHTML = `<div class="t">${kind === "base" ? "Стандартный деплой · без подбора" : "Подобранная конфигурация"}</div><div class="s">${
      kind === "base" ? "BF16, без MTP, настройки по умолчанию" : "FP8 W8A8 + MTP — режим «подсказки в редакторе»"
    }</div>`;
    head.append(hd);
    const editor = el("div", "editor");
    const bar = el("div", "editor-bar");
    bar.innerHTML = `<span class="dot"></span><span class="dot"></span><span class="dot"></span><span class="fn">intervals.py</span><span class="hintkey"></span>`;
    const body = el("div", "editor-body");
    const pre = el("pre");
    body.append(pre);
    const toast = el("div", "editor-toast");
    editor.append(bar, body, toast);
    const lane = el("div", "lane");
    const laneCap = el("div", "lane-cap");
    laneCap.innerHTML = `<span class="over">запрос подсказки</span><span class="legend"><i class="lg pre"></i>префилл <i class="lg queue"></i>очередь <i class="lg gen"></i>генерация <i class="lg dl"></i>дедлайн 0,6 с</span>`;
    const cv = el("canvas");
    cv.width = 1744;
    cv.height = 224;
    lane.append(laneCap, cv);
    const stats = el("div", "s2-stats");
    stats.innerHTML = `
      <div class="m"><div class="k">принято подсказок</div><div class="v num acc"></div></div>
      <div class="m"><div class="k">опоздало</div><div class="v num late"></div></div>
      <div class="m"><div class="k">впустую сгенерировано токенов</div><div class="v num waste"></div></div>
      <div class="m"><div class="k">TTFT последней</div><div class="v num ttft"></div></div>
      <div class="m wide"><div class="k">функция написана</div><div class="prog"><i></i><b class="num pv"></b></div></div>`;
    side.append(head, editor, lane, stats);
    split.append(side);
    const q = (s) => side.querySelector(s);
    views[kind] = {
      side, pre, toast, cv, hintkey: q(".hintkey"),
      acc: q(".acc"), late: q(".late"), waste: q(".waste"), ttft: q(".ttft"),
      prog: q(".prog i"), pv: q(".pv"),
    };
  }
  root.append(controls, split);
  host.append(root);

  const css = getComputedStyle(root);
  const col = (n) => css.getPropertyValue(n).trim();

  function drawLane(kind) {
    const v = views[kind];
    const cv = v.cv;
    const g = cv.getContext("2d");
    const W = cv.width;
    const H = cv.height;
    g.clearRect(0, 0, W, H);
    const now = pair.now;
    const t1 = Math.max(T, now);
    const t0 = t1 - T;
    const X = (t) => ((t - t0) / T) * W;
    const colors = {
      pre: col("--base-mid"),
      queue: col("--baseline"),
      gen: col("--ours"),
      line: col("--line-2"),
      ink: col("--ink-2"),
    };
    g.strokeStyle = colors.line;
    g.fillStyle = colors.ink;
    g.font = "22px sans-serif";
    g.lineWidth = 2;
    for (let s = Math.ceil(t0 / 2) * 2; s <= t1; s += 2) {
      const x = X(s);
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, H - 26);
      g.stroke();
      g.fillText(`${s} с`, x + 6, H - 6);
    }
    const dev = devs[kind];
    const rows = 5;
    const rh = (H - 34) / rows;
    dev.probes.forEach((pr, i) => {
      const q = pr.req;
      const y = 6 + (i % rows) * rh;
      const hh = rh - 8;
      const end = (t) => Math.min(t ?? now, now);
      // префилл
      g.fillStyle = colors.pre;
      g.fillRect(X(q.arrival), y, Math.max(2, X(end(q.ready)) - X(q.arrival)), hh);
      // очередь (после префилла до входа в батч)
      const qEnd = q.tStart ?? now;
      if (qEnd > q.ready) {
        g.fillStyle = colors.queue;
        g.fillRect(X(q.ready), y, X(Math.min(qEnd, now)) - X(q.ready), hh);
      }
      // генерация
      if (q.tStart !== null) {
        g.fillStyle = colors.gen;
        g.fillRect(X(q.tStart), y, Math.max(2, X(end(q.tDone)) - X(q.tStart)), hh);
      }
      // дедлайн
      const dl = X(q.arrival + MODE_SIM.hint.deadline);
      g.strokeStyle = colors.ink;
      g.setLineDash([6, 5]);
      g.lineWidth = 2.5;
      g.beginPath();
      g.moveTo(dl, y - 3);
      g.lineTo(dl, y + hh + 3);
      g.stroke();
      g.setLineDash([]);
    });
    // «сейчас»
    g.strokeStyle = col("--ink");
    g.lineWidth = 3;
    const nx = X(now);
    g.beginPath();
    g.moveTo(nx, 0);
    g.lineTo(nx, H - 26);
    g.stroke();
  }

  function renderDev(kind) {
    const v = views[kind];
    const dev = devs[kind];
    const blink = Math.floor(pair.now * 2) % 2 === 0;
    const cur = `<span class="cursor${blink ? "" : " off"}"></span>`;
    const ghost = dev.ghost();
    const ghostHtml = ghost ? `<span class="ghost">${esc(ghost)}</span>` : "";
    const html = highlightPython(dev.text) + cur + ghostHtml;
    if (v.pre._h !== html) {
      v.pre._h = html;
      v.pre.innerHTML = html;
    }
    // всплывающая «опоздавшая» подсказка
    const t = dev.toast;
    if (t) {
      const age = pair.now - t.t0;
      v.toast.style.opacity = String(clamp(1 - Math.max(0, age - 0.5) / 0.6, 0, 1) * (age < 0.1 ? age / 0.1 : 1));
      v.toast.innerHTML = `<span class="ghost struck">${esc(t.text)}</span><b>опоздала</b>`;
      v.toast.style.display = "flex";
    } else v.toast.style.display = "none";
    v.hintkey.textContent =
      dev.phase === "ghost" || dev.phase === "reading" ? "Tab — принять" : dev.phase === "waiting" ? "ждём подсказку…" : "";
    set(v.acc, fmtInt(dev.accepted));
    set(v.late, fmtInt(dev.late));
    set(v.waste, fmtInt(dev.wasted));
    set(v.ttft, dev.lastTtft === null ? "—" : fmtSec(dev.lastTtft, 2));
    const pr = dev.progress();
    v.prog.style.width = pr * 100 + "%";
    set(v.pv, fmtInt(pr * 100) + " %");
  }
  const set = (n, t) => {
    if (n._t !== t) {
      n._t = t;
      n.textContent = t;
    }
  };

  return {
    step() {
      pair.step();
      for (const k of ["base", "tuned"]) devs[k].step(pair.now, 1 / 60);
    },
    render() {
      for (const k of ["base", "tuned"]) {
        renderDev(k);
        drawLane(k);
      }
    },
    destroy() {
      root.remove();
    },
    pair,
    devs,
  };
}
