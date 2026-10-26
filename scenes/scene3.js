// Сцена 3 · «Агент: где тратится время».
import { AgentCompare } from "../engines/agentterm.js";

export const meta = {
  no: 3,
  title: "Агент: где тратится время",
  disclaimer: "model",
  keys: "<b>←</b><b>→</b> сцены &nbsp; <b>пробел</b> пауза &nbsp; <b>R</b> заново &nbsp; <b>G</b> кейсы",
};

export function create(ctx) {
  const cmp = new AgentCompare(ctx.host, {
    seed: ctx.seed,
    playSeconds: Math.max(6, Math.min(14, (ctx.params.duration || 12) - 1)),
  });
  return {
    step() {
      cmp.step();
    },
    render() {
      cmp.render();
    },
    destroy() {
      cmp.destroy();
    },
  };
}
