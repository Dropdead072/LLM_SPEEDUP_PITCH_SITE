// Сцена 4 · «Микшер профиля: почему нельзя назвать число заранее».
// Выигрыш на весь парк при доле токенов w_i по режимам:
//   cards_before = Σ w_i / base_i,   cards_after = Σ w_i / (base_i · gain_i)
//   gain_total   = cards_before / cards_after
import { MODES, MODE_KEYS, PROFILES } from "../data.js";
import { el, clamp, lerp } from "../lib/util.js";
import { fmtNum, fmtInt, fmtMult } from "../lib/format.js";

export const meta = {
  no: 4,
  title: "Микшер профиля: почему нельзя назвать число заранее",
  disclaimer: "model",
  keys:
    "<b>←</b><b>→</b> сцены &nbsp; перетащите точку в треугольнике &nbsp; <b>1</b><b>2</b><b>3</b><b>4</b> пресеты &nbsp; <b>R</b> заново",
};

export function gainTotal(w) {
  let before = 0;
  let after = 0;
  for (const k of MODE_KEYS) {
    const m = MODES[k];
    before += w[k] / m.base;
    after += w[k] / (m.base * m.gain);
  }
  return before / after;
}

const PRESETS = [
  { key: "hint", label: "Только подсказки", w: { hint: 1, chat: 0, agent: 0 } },
  { key: "chat", label: "Только чат", w: { hint: 0, chat: 1, agent: 0 } },
  { key: "agent", label: "Только агенты", w: { hint: 0, chat: 0, agent: 1 } },
  { key: "even", label: "Поровну", w: { hint: 1 / 3, chat: 1 / 3, agent: 1 / 3 } },
];

// Треугольник: размеры внутреннего холста (×2 к CSS-размеру).
const TW = 640;
const TH = 560;
const PAD = 56;
const V = {
  hint: [TW / 2, PAD],
  chat: [PAD, TH - PAD],
  agent: [TW - PAD, TH - PAD],
};

function bary(px, py) {
  const [x1, y1] = V.hint;
  const [x2, y2] = V.chat;
  const [x3, y3] = V.agent;
  const d = (y2 - y3) * (x1 - x3) + (x3 - x2) * (y1 - y3);
  const a = ((y2 - y3) * (px - x3) + (x3 - x2) * (py - y3)) / d;
  const b = ((y3 - y1) * (px - x3) + (x1 - x3) * (py - y3)) / d;
  return { hint: a, chat: b, agent: 1 - a - b };
}

function clampBary(w) {
  let { hint, chat, agent } = w;
  hint = Math.max(0, hint);
  chat = Math.max(0, chat);
  agent = Math.max(0, agent);
  const s = hint + chat + agent || 1;
  return { hint: hint / s, chat: chat / s, agent: agent / s };
}

export function create(ctx) {
  const host = ctx.host;
  const root = el("div", "s4");
  const left = el("div", "s4-left");
  const right = el("div", "s4-right");
  root.append(left, right);

  // --- левая колонка: треугольник ---
  const triWrap = el("div", "tri-wrap");
  const cv = el("canvas");
  cv.width = TW;
  cv.height = TH;
  triWrap.append(cv);
  const labels = {};
  for (const k of MODE_KEYS) {
    const lab = el("div", "tri-lab " + k);
    lab.innerHTML = `<b>${MODES[k].short}</b><span>${fmtMult(MODES[k].gain)}</span>`;
    triWrap.append(lab);
    labels[k] = lab;
  }
  const presets = el("div", "s4-presets");
  const pbtns = [];
  PRESETS.forEach((p, i) => {
    const b = el("button", "btn");
    b.innerHTML = `<span class="muted" style="font-weight:400">${i + 1}</span>&nbsp; ${p.label}`;
    b.onclick = () => {
      auto = false;
      setPreset(i);
    };
    presets.append(b);
    pbtns.push(b);
  });
  const bars = el("div", "s4-bars");
  const barEls = {};
  for (const k of MODE_KEYS) {
    const row = el("div", "s4-bar");
    row.innerHTML = `<span class="n">${MODES[k].label}</span><span class="tr"><i></i></span><b class="num"></b>`;
    bars.append(row);
    barEls[k] = { fill: row.querySelector("i"), val: row.querySelector("b") };
  }
  left.append(presets, triWrap, bars);

  // --- правая колонка: число и горизонт карт ---
  const big = el("div", "s4-big");
  big.innerHTML = `<div class="over">итоговый выигрыш на весь парк</div><div class="serif num s4-num">×1,00</div>`;
  const cardsCap = el("div", "s4-cardscap");
  const grid = el("div", "s4-cards");
  const cells = [];
  for (let i = 0; i < 100; i++) {
    const c = el("i");
    grid.append(c);
    cells.push(c);
  }
  const msg = el("div", "s4-msg");
  msg.innerHTML = `Один и тот же набор методов. Выигрыш — от ${fmtMult(MODES.agent.gain)} до ${fmtMult(
    MODES.hint.gain
  )}. <b>Пока не замерили профиль, число назвать нельзя.</b>`;
  const prof = el("div", "s4-prof");
  prof.innerHTML =
    `<div class="over">профили нагрузки у клиентов</div>` +
    Object.values(PROFILES)
      .map(
        (p) =>
          `<div class="pr"><b>${p.label}</b><span>prompt ${p.prompt} · префикс: ${p.prefixReuse} · поток: ${p.concurrency}</span><span class="lv">рычаг: ${p.lever}</span></div>`
      )
      .join("");
  right.append(big, cardsCap, grid, msg, prof);
  host.append(root);

  // --- состояние ---
  let w = { ...PRESETS[3].w };
  let target = { ...w };
  let disp = gainTotal(w);
  let auto = ctx.record || ctx.params.auto;
  let autoT = 0;
  const numEl = big.querySelector(".s4-num");

  function setPreset(i) {
    target = { ...PRESETS[i].w };
    pbtns.forEach((b, j) => b.classList.toggle("on", j === i));
  }
  setPreset(3);

  // тепловая карта выигрыша по треугольнику (рисуется один раз)
  const heat = document.createElement("canvas");
  heat.width = TW;
  heat.height = TH;
  (() => {
    const g = heat.getContext("2d");
    const img = g.createImageData(TW, TH);
    const cs = getComputedStyle(root);
    const parse = (c) => {
      const t = document.createElement("canvas").getContext("2d");
      t.fillStyle = c;
      t.fillRect(0, 0, 1, 1);
      const d = t.getImageData(0, 0, 1, 1).data;
      return [d[0], d[1], d[2]];
    };
    const lo = parse(cs.getPropertyValue("--base-soft").trim() || "#eee");
    const hi = parse(`color-mix(in srgb, ${cs.getPropertyValue("--ours").trim()} 62%, #ffffff)`);
    const gmin = MODES.agent.gain;
    const gmax = MODES.hint.gain;
    for (let y = 0; y < TH; y++) {
      for (let x = 0; x < TW; x++) {
        const b = bary(x, y);
        if (b.hint < -0.002 || b.chat < -0.002 || b.agent < -0.002) continue;
        const gt = gainTotal(clampBary(b));
        const t = clamp((gt - gmin) / (gmax - gmin), 0, 1);
        const i = (y * TW + x) * 4;
        img.data[i] = lerp(lo[0], hi[0], t);
        img.data[i + 1] = lerp(lo[1], hi[1], t);
        img.data[i + 2] = lerp(lo[2], hi[2], t);
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
  })();

  // позиции подписей вершин
  const place = (k, dx, dy) => {
    const [x, y] = V[k];
    labels[k].style.left = `${(x / TW) * 100}%`;
    labels[k].style.top = `${(y / TH) * 100}%`;
    labels[k].style.transform = `translate(${dx}, ${dy})`;
  };
  place("hint", "-50%", "-130%");
  place("chat", "-50%", "20%");
  place("agent", "-50%", "20%");

  // перетаскивание
  let dragging = false;
  const fromEvent = (e) => {
    const r = cv.getBoundingClientRect();
    const sx = TW / r.width;
    const sy = TH / r.height;
    const b = bary((e.clientX - r.left) * sx, (e.clientY - r.top) * sy);
    w = clampBary(b);
    target = { ...w };
    pbtns.forEach((bt) => bt.classList.remove("on"));
  };
  cv.addEventListener("pointerdown", (e) => {
    dragging = true;
    auto = false;
    cv.setPointerCapture(e.pointerId);
    fromEvent(e);
  });
  cv.addEventListener("pointermove", (e) => dragging && fromEvent(e));
  cv.addEventListener("pointerup", () => (dragging = false));

  function drawTri() {
    const g = cv.getContext("2d");
    const cs = getComputedStyle(root);
    const line = cs.getPropertyValue("--line-2").trim();
    const ink = cs.getPropertyValue("--ink").trim();
    const ours = cs.getPropertyValue("--ours").trim();
    g.clearRect(0, 0, TW, TH);
    g.save();
    g.beginPath();
    g.moveTo(...V.hint);
    g.lineTo(...V.chat);
    g.lineTo(...V.agent);
    g.closePath();
    g.clip();
    g.drawImage(heat, 0, 0);
    // сетка через 10 %
    g.strokeStyle = "rgba(255,255,255,.7)";
    g.lineWidth = 1.5;
    for (let i = 1; i < 10; i++) {
      const t = i / 10;
      for (const [a, b] of [
        ["hint", "chat"],
        ["chat", "agent"],
        ["agent", "hint"],
      ]) {
        void a;
        void b;
      }
      const lerpPt = (p, q, u) => [lerp(p[0], q[0], u), lerp(p[1], q[1], u)];
      // линии постоянной доли для каждой вершины
      const l1a = lerpPt(V.hint, V.chat, t);
      const l1b = lerpPt(V.hint, V.agent, t);
      const l2a = lerpPt(V.chat, V.hint, t);
      const l2b = lerpPt(V.chat, V.agent, t);
      const l3a = lerpPt(V.agent, V.hint, t);
      const l3b = lerpPt(V.agent, V.chat, t);
      for (const [p, q] of [
        [l1a, l1b],
        [l2a, l2b],
        [l3a, l3b],
      ]) {
        g.beginPath();
        g.moveTo(...p);
        g.lineTo(...q);
        g.stroke();
      }
    }
    g.restore();
    g.strokeStyle = line;
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(...V.hint);
    g.lineTo(...V.chat);
    g.lineTo(...V.agent);
    g.closePath();
    g.stroke();
    // точка
    const px = w.hint * V.hint[0] + w.chat * V.chat[0] + w.agent * V.agent[0];
    const py = w.hint * V.hint[1] + w.chat * V.chat[1] + w.agent * V.agent[1];
    g.fillStyle = ink;
    g.beginPath();
    g.arc(px, py, 15, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = ours;
    g.beginPath();
    g.arc(px, py, 9, 0, Math.PI * 2);
    g.fill();
  }

  const AUTO_SEQ = [0, 3, 1, 2, 3];
  const AUTO_EACH = 2.6;

  return {
    step() {
      const dt = 1 / 60;
      if (auto) {
        autoT += dt;
        const idx = Math.floor(autoT / AUTO_EACH);
        const i = AUTO_SEQ[idx % AUTO_SEQ.length];
        if (target !== PRESETS[i].w && (!target._i || target._i !== idx)) {
          target = { ...PRESETS[i].w, _i: idx };
          pbtns.forEach((b, j) => b.classList.toggle("on", j === i));
        }
      }
      // плавное движение точки и числа
      const k = 1 - Math.exp(-dt * 6);
      for (const m of MODE_KEYS) w[m] = lerp(w[m], target[m], dragging ? 1 : k);
      const g = gainTotal(w);
      disp = lerp(disp, g, 1 - Math.exp(-dt * 10));
    },
    render() {
      drawTri();
      numEl.textContent = "×" + fmtNum(disp, 2);
      for (const k of MODE_KEYS) {
        const pct = w[k] * 100;
        barEls[k].fill.style.width = pct + "%";
        const t = fmtInt(pct) + " %";
        if (barEls[k].val._t !== t) {
          barEls[k].val._t = t;
          barEls[k].val.textContent = t;
        }
      }
      // горизонт из 100 карт: «нужно карт после» = 100 / gain
      const need = 100 / disp;
      for (let i = 0; i < 100; i++) {
        const lit = clamp(need - i, 0, 1);
        const c = cells[i];
        const key = lit.toFixed(2);
        if (c._k !== key) {
          c._k = key;
          c.style.opacity = lit > 0 ? 0.25 + 0.75 * lit : 1;
          c.className = lit > 0 ? "lit" : "off";
        }
      }
      const t = `${fmtInt(Math.ceil(need))} из 100 карт нужно после подбора`;
      if (cardsCap._t !== t) {
        cardsCap._t = t;
        cardsCap.innerHTML = `<span class="over">на ту же нагрузку, что раньше обслуживали 100 картами</span><b>${t}</b>`;
      }
    },
    key(e) {
      const i = ["1", "2", "3", "4"].indexOf(e.key);
      if (i >= 0) {
        auto = false;
        setPreset(i);
        return true;
      }
      return false;
    },
    destroy() {
      root.remove();
    },
  };
}
