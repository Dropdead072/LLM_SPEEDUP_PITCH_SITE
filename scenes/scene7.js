// Сцена 7 · «27 648 конфигураций → одна» — «компилятор» инференса.
// Иллюстрация пространства поиска: положение точек сгенерировано; выигрыш выбранной
// точки — расчёт по модели производительности (калибровка по MODES, см. cloudmodel.js).
import { Cloud, STEP_LEN } from "../engines/cloud.js";
import { MODES, MODE_KEYS } from "../data.js";
import { el } from "../lib/util.js";

export const meta = {
  no: 7,
  title: "27 648 конфигураций → одна",
  disclaimer:
    "Иллюстрация пространства поиска. Положение точек сгенерировано; выигрыш выбранной точки — расчёт по модели производительности",
  keys:
    "<b>←</b><b>→</b> сцены &nbsp; <b>1</b><b>2</b><b>3</b> профиль &nbsp; <b>Enter</b> заново по шагам &nbsp; <b>пробел</b> пауза",
};

export function create(ctx) {
  const p = ctx.params;
  const root = el("div", "s7");
  const controls = el("div", "controls");
  const seg = el("div", "seg");
  const btns = {};
  MODE_KEYS.forEach((k, i) => {
    const b = el("button", "btn");
    b.innerHTML = `<span class="muted" style="font-weight:400">${i + 1}</span>&nbsp; ${MODES[k].short}`;
    b.onclick = () => select(k);
    btns[k] = b;
    seg.append(b);
  });
  const replay = el("button", "btn");
  replay.textContent = "Заново по шагам";
  const note = el("div");
  note.style.cssText = "font:400 14px var(--sans);color:var(--ink-2);max-width:760px";
  note.textContent =
    "Каждая точка — одна конфигурация. При смене профиля те же точки переезжают, SLA сдвигается, звезда прыгает на другой рецепт.";
  controls.append(seg, replay, note);
  if (ctx.record) controls.classList.add("static");
  const body = el("div", "s7-body");
  root.append(controls, body);
  ctx.host.append(root);

  const initial = MODE_KEYS.includes(p.profile) ? p.profile : MODE_KEYS.includes(p.mode) && p.mode !== "hint" ? p.mode : "hint";
  const cloud = new Cloud(body, { profile: initial, seed: ctx.seed, w: 1240, h: 760 });
  if (p.step != null) cloud.jumpToStep(Math.max(0, Math.min(4, p.step)));

  function select(k) {
    cloud.setProfile(k);
    mark();
  }
  function mark() {
    for (const k of MODE_KEYS) btns[k].classList.toggle("on", k === cloud.key);
  }
  mark();
  replay.onclick = () => {
    cloud.t = 0;
  };

  // запись ролика: шаги 1–5, затем смена профиля
  const script = ctx.record
    ? [
        { t: STEP_LEN * 5 + 1.6, fn: () => select("chat") },
        { t: STEP_LEN * 5 + 4.4, fn: () => select("agent") },
      ]
    : [];
  let si = 0;

  return {
    step() {
      cloud.step();
      while (si < script.length && ctx.clock.t >= script[si].t) script[si++].fn();
    },
    render() {
      cloud.draw();
    },
    key(e) {
      const i = ["1", "2", "3"].indexOf(e.key);
      if (i >= 0) {
        select(MODE_KEYS[i]);
        return true;
      }
      if (e.key === "Enter") {
        cloud.t = 0;
        return true;
      }
      return false;
    },
    destroy() {
      root.remove();
    },
    cloud,
  };
}
