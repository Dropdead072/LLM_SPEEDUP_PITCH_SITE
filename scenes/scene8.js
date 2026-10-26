// Сцена 8 · «Один репозиторий — один кэш».
// Сравнивается не «кэш выключен / включён» (префиксный кэш в современных engine
// включён по умолчанию), а ПОЛИТИКА МАРШРУТИЗАЦИИ между репликами:
// round-robin → только сродство → сродство с потолком загрузки.
import { RoutingView } from "../engines/routingui.js";
import { el } from "../lib/util.js";

export const meta = {
  no: 8,
  title: "Один репозиторий — один кэш",
  disclaimer: "mechanism",
  keys: "<b>←</b><b>→</b> сцены &nbsp; <b>1</b><b>2</b><b>3</b> политика &nbsp; <b>пробел</b> пауза &nbsp; <b>R</b> заново",
};

const ORDER = ["round_robin", "prefix_affinity", "affinity_with_cap"];

export function create(ctx) {
  const p = ctx.params;
  const alias = { rr: "round_robin", aff: "prefix_affinity", cap: "affinity_with_cap" };
  const start = alias[p.routing] || p.routing || "round_robin";
  const view = new RoutingView(ctx.host, { scenario: "repo", policy: start, seed: ctx.seed, controls: true });
  // запись: по очереди три политики (по ~5 с показа каждая)
  const seg = ctx.record ? Math.max(3.5, ((p.duration || 15) - 0.5) / 3) : 0;
  let idx = ORDER.indexOf(view.policy);
  return {
    step() {
      view.step();
      if (ctx.record && p.routing == null) {
        const want = Math.min(2, Math.floor(ctx.clock.t / seg));
        if (want !== idx) {
          idx = want;
          view.setPolicy(ORDER[want]);
        }
      }
    },
    render() {
      view.render();
    },
    key(e) {
      const i = ["1", "2", "3"].indexOf(e.key);
      if (i >= 0) {
        view.setPolicy(ORDER[i]);
        return true;
      }
      return false;
    },
    destroy() {
      view.destroy();
    },
    view,
  };
}
