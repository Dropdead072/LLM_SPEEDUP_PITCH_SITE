// SplitSim — две стороны («Стандартный деплой» и «Подобранная конфигурация»)
// на одном потоке запросов: сетка мини-IDE, значки карт, HUD. Используется
// в сцене 1 и в кейсах (компактный вариант).
import { MODES, MODE_KEYS } from "../data.js";
import { Pair, MODE_SIM } from "../sim.js";
import { HINTS, CHATS, AGENTS, agentStepText } from "../snippets.js";
import { highlightPython, esc } from "../lib/highlight.js";
import { el, clamp } from "../lib/util.js";
import { fmtNum, fmtInt, fmtSec, fmtPct, fmtMult } from "../lib/format.js";

const DEVS = [
  "Алина К.", "Игорь М.", "Мария Т.", "Олег С.", "Дарья В.", "Павел Н.",
  "Ксения Л.", "Артём Б.", "Елена Р.", "Роман Ж.", "Вера Д.", "Никита Ф.",
];
const FLASH = 0.7; // сколько секунд держим «готово/опоздала» после завершения

function setText(node, text) {
  if (node._t !== text) {
    node._t = text;
    node.textContent = text;
  }
}
function setHTML(node, html) {
  if (node._h !== html) {
    node._h = html;
    node.innerHTML = html;
  }
}

// ---- MTP-визуализация: токены появляются пачками по 1–3 (только отрисовка) ----
function mtpShown(req, produced, now) {
  let m = req._m;
  if (!m) {
    m = req._m = { b: 0, last: 0, t: -1, s: (req.id * 2654435761 + 12345) >>> 0, next: 0 };
    m.next = 1;
  }
  while (m.b + m.next <= produced) {
    m.last = m.b;
    m.b += m.next;
    m.t = now;
    m.s = (Math.imul(m.s, 1664525) + 1013904223) >>> 0;
    m.next = 1 + ((m.s >>> 16) % 3);
  }
  return m;
}

class TileView {
  constructor(idx, mode, ctx) {
    this.idx = idx;
    this.ctx = ctx;
    this.root = el("div", "tile idle");
    const head = el("div", "tile-head");
    this.dev = el("span", "dev");
    this.file = el("span", "file");
    this.dev.textContent = DEVS[idx % DEVS.length];
    head.append(this.dev, this.file);
    this.body = el("div", "tile-body bottom");
    this.pre = el("pre");
    this.q = el("div", "q");
    this.body.append(this.q, this.pre);
    this.foot = el("div", "tile-foot");
    this.footText = el("span");
    this.bar = el("i", "bar");
    this.foot.append(this.footText, this.bar);
    this.root.append(head, this.body, this.foot);
    this.sig = "";
    this.setMode(mode);
  }
  setMode(mode) {
    this.mode = mode;
    this.pre.className = mode === "hint" ? "" : "wrap";
    this.q.style.display = mode === "chat" ? "" : "none";
    this.sig = "";
  }

  snippet(req) {
    const d = req.desc;
    if (this.mode === "hint") return HINTS[d.snippet];
    if (this.mode === "chat") return CHATS[d.snippet];
    return { text: agentStepText(AGENTS[d.script], d.step), file: "agent · шаг " + (d.step + 1) };
  }

  update(side, now, tuned, seed) {
    const mode = this.mode;
    const t = side.tiles[this.idx];
    const head = t.pending[0] || null;
    let state = "idle";
    let req = null;
    let wait = 0;
    if (head) {
      req = head;
      if (head.tFirst === null) {
        wait = now - head.arrival;
        state = wait > 0.3 ? "queued" : "reading";
      } else state = "streaming";
    } else if (t.lastDone && now - t.lastDone.tDone < FLASH) {
      req = t.lastDone;
      state = mode === "hint" && req.late ? "dropped" : "done";
    } else {
      req = t.lastDone;
    }

    // какой сниппет показываем
    let snip = null;
    if (req) snip = this.snippet(req);
    else if (mode === "hint") snip = HINTS[(this.idx * 5 + seed) % HINTS.length];
    else if (mode === "chat") snip = CHATS[(this.idx * 3 + seed) % CHATS.length];
    else snip = { text: "$ ожидание задачи…", file: "agent" };

    // сколько символов «напечатано»
    let frac = 1;
    let fresh = 0;
    if (state === "streaming") {
      let produced = req.produced;
      if (tuned) {
        const m = mtpShown(req, produced, now);
        produced = m.b;
        fresh = now - m.t < 0.22 ? m.b - m.last : 0;
      }
      frac = clamp(produced / req.L, 0, 1);
    } else if (state === "queued" || state === "reading") frac = 0;

    const blink = Math.floor(now * 2) % 2 === 0;
    const full = mode === "hint" ? snip.completion : mode === "chat" ? snip.text + "\n" + snip.code : snip.text;
    const chars = Math.round(frac * full.length);
    const freshChars = fresh ? Math.max(0, Math.round((fresh / req.L) * full.length)) : 0;
    const waitKey = state === "queued" ? Math.floor(wait * 10) : 0;
    const sig = `${state}|${chars}|${freshChars}|${waitKey}|${blink ? 1 : 0}|${req ? req.id : -1}`;
    if (sig === this.sig) return;
    this.sig = sig;

    this.root.className = "tile " + state;
    setText(this.file, mode === "agent" ? snip.file || "agent" : snip.file || "chat.md");

    const cur = `<span class="cursor${blink ? "" : " off"}"></span>`;
    let html = "";
    if (mode === "hint") {
      const done = state === "done" || (state === "idle" && req && !req.late);
      const typed = full.slice(0, chars);
      if (state === "streaming" || state === "dropped") {
        const late = req.late || state === "dropped";
        const shown = state === "dropped" ? full : typed;
        html = highlightPython(snip.prefix) + cur + ghostHTML(shown, late, freshChars);
      } else if (done) {
        html = highlightPython(snip.prefix + snip.completion) + (state === "idle" ? cur : "");
      } else {
        html = highlightPython(snip.prefix) + cur;
      }
    } else if (mode === "chat") {
      setText(this.q, "Q: " + (snip.question || ""));
      const textPart = snip.text;
      const n = chars;
      const tShown = textPart.slice(0, Math.min(n, textPart.length));
      let rest = n > textPart.length + 1 ? snip.code.slice(0, n - textPart.length - 1) : "";
      html = esc(tShown) + (rest ? "\n" + highlightPython(rest) : "");
      if (state === "streaming" || state === "queued" || state === "reading" || state === "idle")
        html += cur;
      if (state === "queued" || state === "reading") html = cur;
      if (state === "idle" && !req) html = esc(textPart.slice(0, 80)) + "…";
    } else {
      const typed = full.slice(0, chars);
      html = agentHTML(typed) + (state === "streaming" || state === "idle" ? cur : "");
      if (state === "queued" || state === "reading") html = cur;
    }
    setHTML(this.pre, html);

    // подвал плитки
    let ft = "";
    let fc = "tile-foot";
    let barW = 0;
    const s = MODE_SIM[mode];
    if (state === "queued") {
      ft = `ждёт GPU · ${fmtNum(wait, 1)} с`;
      fc += " queued";
      const lim = mode === "hint" ? s.deadline : mode === "chat" ? s.ttftSla : 6;
      barW = clamp(wait / (lim * 2), 0, 1) * 100;
    } else if (state === "reading") {
      ft = "читает контекст…";
      fc += " stream";
    } else if (state === "streaming") {
      ft = mode === "hint" && req.late ? "генерируется · уже поздно" : tuned ? "генерация · MTP" : "генерация";
      fc += req.late ? " dropped" : " stream";
    } else if (state === "dropped") {
      ft = "опоздала";
      fc += " dropped";
    } else if (state === "done") {
      ft = mode === "hint" ? "принята · Tab" : "готово";
      fc += " done";
    }
    this.foot.className = fc;
    setText(this.footText, ft);
    this.bar.style.width = barW + "%";
    this.bar.style.display = barW > 0 ? "" : "none";
  }
}

function ghostHTML(text, late, freshChars) {
  if (!text) return "";
  const cls = "ghost" + (late ? " struck" : "");
  // Перечёркиваем только текст, а не пробелы отступа (иначе по плитке тянутся длинные линии).
  const wrapLine = (line, c) => {
    const m = /^(\s*)(.*)$/.exec(line);
    return esc(m[1]) + (m[2] ? `<span class="${c}">${esc(m[2])}</span>` : "");
  };
  const render = (chunk, c) =>
    chunk
      .split("\n")
      .map((l) => wrapLine(l, c))
      .join("\n");
  if (freshChars > 0 && freshChars < text.length) {
    const a = text.slice(0, text.length - freshChars);
    const b = text.slice(text.length - freshChars);
    return render(a, cls) + render(b, cls + " fresh");
  }
  return render(text, cls);
}

function agentHTML(text) {
  return text
    .split("\n")
    .map((l) => {
      if (l.startsWith("$ ")) return `<span class="hl-k">${esc(l)}</span>`;
      if (/^[+-]/.test(l)) return `<span class="${l[0] === "+" ? "hl-b" : "hl-s"}">${esc(l)}</span>`;
      return esc(l);
    })
    .join("\n");
}

export class SplitSim {
  /**
   * @param {HTMLElement} host
   * @param {object} o  mode, load, seed, bursty, tiles, cols, compact, controls, tileH, statement
   */
  constructor(host, o = {}) {
    this.host = host;
    this.o = {
      mode: "hint",
      load: 0.7,
      seed: 42,
      bursty: false,
      tiles: 12,
      cols: 3,
      compact: false,
      controls: true,
      tileH: 130,
      statement: true,
      ...o,
    };
    this.build();
    this.restart();
  }

  build() {
    const o = this.o;
    this.root = el("div", "splitsim");
    if (o.controls) this.buildControls();
    this.split = el("div", "split" + (o.compact ? " compact" : ""));
    this.sideEls = {};
    for (const kind of ["base", "tuned"]) this.sideEls[kind] = this.buildSide(kind);
    this.split.append(this.sideEls.base.root, this.sideEls.tuned.root);
    this.root.append(this.split);
    if (o.statement) {
      this.statement = el("div", "statement");
      this.root.append(this.statement);
    }
    this.host.append(this.root);
  }

  buildControls() {
    const c = el("div", "controls");
    this.modeBtns = {};
    const minimal = this.o.controls === "min"; // для кейсов: только нагрузка и «Стендап закончился»
    const seg = el("div", "seg");
    MODE_KEYS.forEach((k, i) => {
      const b = el("button", "btn");
      b.innerHTML = `<span class="muted" style="font-weight:400">${i + 1}</span>&nbsp; ${MODES[k].short}`;
      b.onclick = () => this.setMode(k);
      this.modeBtns[k] = b;
      seg.append(b);
    });
    const sl = el("label", "slider");
    sl.innerHTML = `<span class="lab">Нагрузка ρ подобранной стороны</span>`;
    this.loadInput = el("input");
    this.loadInput.type = "range";
    this.loadInput.min = "0.1";
    this.loadInput.max = "1.1";
    this.loadInput.step = "0.01";
    this.loadOut = el("output", "num");
    this.loadInput.oninput = () => {
      this.setLoad(parseFloat(this.loadInput.value));
      this.loadOut.textContent = fmtNum(parseFloat(this.loadInput.value), 2);
    };
    sl.append(this.loadInput, this.loadOut);
    const tg = el("label", "toggle");
    this.burstyInput = el("input");
    this.burstyInput.type = "checkbox";
    this.burstyInput.onchange = () => {
      this.pair.bursty = this.burstyInput.checked;
      this.pair.state = "calm";
      this.pair.stateUntil = this.pair.now + 5;
    };
    tg.append(this.burstyInput, document.createTextNode("Bursty-поток"));
    const burst = el("button", "btn warn");
    burst.textContent = "Стендап закончился";
    burst.onclick = () => this.pair.forceBurst();
    if (minimal) c.append(sl, burst);
    else c.append(seg, sl, tg, burst);
    this.root.append(c);
  }

  buildSide(kind) {
    const o = this.o;
    const root = el("div", "side " + kind);
    const head = el("div", "side-head");
    const title = el("div");
    const t = el("div", "t");
    const s = el("div", "s");
    if (kind === "base") {
      t.textContent = "Стандартный деплой · без подбора";
      s.textContent = "BF16, без MTP, настройки по умолчанию";
    } else {
      t.textContent = "Подобранная конфигурация";
      s.textContent = "режим подобран под нагрузку";
    }
    title.append(t, s);
    const badges = el("div", "badges");
    head.append(title, badges);
    const gpus = el("div", "gpus");
    const tiles = el("div", "tiles");
    tiles.style.gridTemplateColumns = `repeat(${o.cols}, 1fr)`;
    const hud = el("div", "hud");
    hud.innerHTML = `
      <div class="lhs">
        <div class="big num"></div>
        <div class="bigcap">полезные ток/с на GPU</div>
        <div class="raw">сырые <b class="num rawv"></b> ток/с на GPU</div>
      </div>
      <div class="grid">
        <div class="m"><div class="k">загрузка ρ</div><div class="v num rho"></div></div>
        <div class="m"><div class="k">очередь</div><div class="v num queue"></div></div>
        <div class="m"><div class="k">TTFT p50</div><div class="v num p50"></div></div>
        <div class="m"><div class="k">TTFT p95</div><div class="v num p95"></div></div>
        <div class="m"><div class="k dropk">выброшено</div><div class="v num drop"></div></div>
        <div class="m"><div class="k">токенов всего</div><div class="v num total"></div></div>
      </div>
      <div class="spark"><div class="cap">p95 TTFT · 30 с</div><canvas width="500" height="236"></canvas></div>`;
    root.append(head, gpus, tiles, hud);
    const q = (sel) => hud.querySelector(sel);
    return {
      root, badges, gpus, tiles, hud,
      big: q(".big"), rawv: q(".rawv"), rho: q(".rho"), queue: q(".queue"),
      p50: q(".p50"), p95: q(".p95"), drop: q(".drop"), dropk: q(".dropk"), total: q(".total"),
      spark: q("canvas"), sparkCap: q(".spark .cap"),
      tileViews: [], gpuEls: [],
    };
  }

  restart() {
    const o = this.o;
    this.pair = new Pair({ mode: o.mode, load: o.load, seed: o.seed, tiles: o.tiles, bursty: o.bursty });
    this.pair.advance(0.001);
    this.configureMode();
    if (this.loadInput) {
      this.loadInput.value = String(o.load);
      this.loadOut.textContent = fmtNum(o.load, 2);
      this.burstyInput.checked = o.bursty;
    }
    this.frame = 0;
  }

  configureMode() {
    const o = this.o;
    const mode = o.mode;
    const sim = MODE_SIM[mode];
    for (const kind of ["base", "tuned"]) {
      const se = this.sideEls[kind];
      se.tiles.style.gridAutoRows = o.tileH + "px";
      se.tiles.replaceChildren();
      se.tileViews = [];
      for (let i = 0; i < o.tiles; i++) {
        const tv = new TileView(i, mode, this);
        se.tileViews.push(tv);
        se.tiles.append(tv.root);
      }
      se.gpus.replaceChildren();
      const lab = el("span", "lab");
      lab.textContent = `${this.pair.G} ${plural(this.pair.G, "карта", "карты", "карт")}`;
      se.gpus.append(lab);
      se.gpuEls = [];
      for (let i = 0; i < this.pair.G; i++) {
        const g = el("div", "gpu");
        const f = el("i");
        g.append(f);
        se.gpus.append(g);
        se.gpuEls.push({ g, f });
      }
      se.dropk.parentElement.style.visibility = mode === "hint" ? "visible" : "hidden";
      se.sparkCap.textContent = `p95 TTFT · 30 с${mode === "hint" ? " · дедлайн 0,6 с" : mode === "chat" ? " · SLA 2 с" : ""}`;
    }
    // бейджи рецепта — это выбор под режим, у разных режимов они разные
    this.sideEls.tuned.badges.replaceChildren(
      ...MODES[mode].recipe.map((r) => {
        const b = el("span", "badge");
        b.textContent = r;
        return b;
      })
    );
    this.sideEls.base.badges.replaceChildren(
      ...["BF16", "без MTP"].map((r) => {
        const b = el("span", "badge muted");
        b.textContent = r;
        return b;
      })
    );
    if (this.modeBtns) for (const k of MODE_KEYS) this.modeBtns[k].classList.toggle("on", k === mode);
    void sim;
  }

  setMode(mode) {
    if (mode === this.o.mode) return;
    this.o.mode = mode;
    this.restart();
  }

  setLoad(x) {
    this.o.load = x;
    this.pair.load = x;
  }

  step() {
    this.pair.step();
  }

  render() {
    const p = this.pair;
    const now = p.now;
    const mode = this.o.mode;
    this.frame++;
    for (const kind of ["base", "tuned"]) {
      const se = this.sideEls[kind];
      const side = p.sides[kind];
      const tuned = kind === "tuned";
      for (const tv of se.tileViews) tv.update(side, now, tuned, this.o.seed);
      const st = side.stats(now);
      setText(se.big, fmtInt(st.tpsUseful));
      setText(se.rawv, fmtInt(st.tpsRaw));
      setText(se.rho, fmtNum(st.rho, 2));
      se.rho.classList.toggle("hot", st.rho >= 1);
      setText(se.queue, fmtInt(st.queue));
      setText(se.p50, fmtSec(st.ttftP50, st.ttftP50 < 10 ? 2 : 1));
      setText(se.p95, fmtSec(st.ttftP95, st.ttftP95 < 10 ? 2 : 1));
      setText(se.drop, mode === "hint" ? fmtPct(st.droppedPct) : "—");
      se.drop.classList.toggle("hot", mode === "hint" && st.droppedPct > 0.2);
      setText(se.total, fmtInt(st.total));
      for (let i = 0; i < se.gpuEls.length; i++) {
        const { g, f } = se.gpuEls[i];
        const fill = Math.round(st.util * 100);
        if (f._fill !== fill) {
          f._fill = fill;
          f.style.height = fill + "%";
        }
        const sat = st.util > 0.97 && st.rho >= 1;
        if (g._sat !== sat) {
          g._sat = sat;
          g.classList.toggle("sat", sat);
        }
      }
    }
    if (this.frame % 3 === 0) this.drawSparks();
    if (this.statement && this.frame % 10 === 1) this.renderStatement();
  }

  drawSparks() {
    const mode = this.o.mode;
    const ref = mode === "hint" ? MODE_SIM.hint.deadline : mode === "chat" ? MODE_SIM.chat.ttftSla : 0;
    const sb = this.pair.base.ttftSeries;
    const st = this.pair.tuned.ttftSeries;
    const ymax = Math.max(ref * 1.8, 0.5, ...sb, ...st);
    for (const kind of ["base", "tuned"]) {
      const se = this.sideEls[kind];
      const cv = se.spark;
      const ctx = cv.getContext("2d");
      const W = cv.width;
      const H = cv.height;
      ctx.clearRect(0, 0, W, H);
      const cs = getComputedStyle(se.root);
      const accent = cs.getPropertyValue("--accent").trim() || "#4d5f55";
      const line = cs.getPropertyValue("--line-2").trim() || "#ddd";
      const ink2 = cs.getPropertyValue("--ink-2").trim() || "#666";
      ctx.strokeStyle = line;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, H - 1);
      ctx.lineTo(W, H - 1);
      ctx.stroke();
      if (ref) {
        const y = H - (ref / ymax) * (H - 10) - 1;
        ctx.setLineDash([8, 6]);
        ctx.strokeStyle = ink2;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      const data = kind === "base" ? sb : st;
      if (data.length > 1) {
        ctx.beginPath();
        const stepX = W / 119;
        data.forEach((v, i) => {
          const x = W - (data.length - 1 - i) * stepX;
          const y = H - (v / ymax) * (H - 10) - 1;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = accent;
        ctx.lineWidth = 3;
        ctx.lineJoin = "round";
        ctx.stroke();
      }
      ctx.fillStyle = ink2;
      ctx.font = "24px sans-serif";
      ctx.fillText(fmtNum(ymax, ymax < 10 ? 1 : 0) + " с", 4, 24);
    }
  }

  renderStatement() {
    const mode = this.o.mode;
    const m = MODES[mode];
    const b = fmtInt(m.base);
    const t = fmtInt(m.base * m.gain);
    const g = fmtMult(m.gain);
    const recipe = m.recipe.join(" + ");
    let html;
    if (mode === "hint")
      html = `<span class="b"><b>Без подбора:</b> ${b} ток/с на GPU, очередь растёт.</span> <span class="o"><b>С подбором:</b> ${t} ток/с, ${recipe}.</span> Выигрыш <b>${g}</b>.`;
    else if (mode === "chat")
      html = `<span class="b"><b>Без подбора:</b> ${b} ток/с на GPU, заметная деградация.</span> <span class="o"><b>С подбором:</b> ${t} ток/с, ${recipe}.</span> Выигрыш <b>${g}</b>.`;
    else
      html = `<span class="b"><b>Без подбора:</b> ${b} ток/с на GPU, на грани.</span> <span class="o"><b>С подбором:</b> ${t} ток/с, ${recipe}.</span> Выигрыш <b>${g}</b> — на агентах скромнее: универсального решения нет.`;
    setHTML(this.statement, html);
  }

  destroy() {
    this.root.remove();
  }
}

export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}
