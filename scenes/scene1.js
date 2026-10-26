// Сцена 1 · «Тот же GPU — вдвое-втрое больше разработчиков» (главная).
import { SplitSim } from "../engines/splitsim.js";
import { MODE_KEYS } from "../data.js";

export const meta = {
  no: 1,
  title: "Тот же GPU — вдвое-втрое больше разработчиков",
  disclaimer: "model",
};

export function create(ctx) {
  const p = ctx.params;
  const sim = new SplitSim(ctx.host, {
    mode: MODE_KEYS.includes(p.mode) ? p.mode : "hint",
    load: p.load,
    seed: ctx.seed,
    bursty: p.bursty,
    controls: true,
    tileH: 124,
  });
  if (ctx.record) sim.root.querySelector(".controls")?.classList.add("static");
  let fired = false;
  return {
    step() {
      sim.step();
      // ?burstAt=N — запуск «Стендап закончился» на N-й секунде (для записи роликов)
      if (!fired && p.burstAt >= 0 && ctx.clock.t >= p.burstAt) {
        fired = true;
        sim.pair.forceBurst();
      }
    },
    render() {
      sim.render();
    },
    key(e) {
      const i = ["1", "2", "3"].indexOf(e.key);
      if (i >= 0) {
        sim.setMode(MODE_KEYS[i]);
        return true;
      }
      if (e.key === "b" || e.key === "B") {
        sim.pair.forceBurst();
        return true;
      }
      return false;
    },
    destroy() {
      sim.destroy();
    },
    sim,
  };
}
