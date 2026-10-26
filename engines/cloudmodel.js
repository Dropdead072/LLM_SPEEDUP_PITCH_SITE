// Синтетическое пространство поиска: 27 648 конфигураций (6·4·4·6·4·4·3).
// ЭТО ИЛЛЮСТРАЦИЯ, а не результаты замеров: положение точек сгенерировано
// детерминированно по сиду (см. доп. ТЗ, сцена 7). Единственная привязка к
// финмодели — калибровка: полезные ток/с звезды относятся к baseline ровно как
// MODES[mode].gain, а baseline стоит на MODES[mode].base ток/с на GPU.
// Названия runtime и моделей обезличены («Engine A–D», «Модель 1–6»).
import { MODES, SEARCH_SPACE } from "../data.js";
import { mulberry32, mixSeed } from "../lib/rng.js";

export const AXES = [
  { key: "model", label: "Модель", values: ["Модель 1 (клиента)", "Модель 2", "Модель 3", "Модель 4", "Модель 5", "Модель 6"] },
  { key: "runtime", label: "Runtime", values: ["Engine A", "Engine B", "Engine C", "Engine D"] },
  { key: "precision", label: "Precision", values: ["BF16", "FP8 W8A8", "INT4 W4A16", "FP8 + KV8"] },
  { key: "batch", label: "Batching", values: ["по умолчанию", "small", "medium", "large", "continuous A", "continuous B"] },
  { key: "cache", label: "Cache", values: ["по умолчанию", "prefix", "prefix + offload", "routing-aware"] },
  { key: "parallel", label: "Parallelism", values: ["TP1", "TP2", "TP4", "TP2×PP2"] },
  { key: "slo", label: "SLO", values: ["строгий", "обычный", "мягкий"] },
];
export const DIMS = AXES.map((a) => a.values.length);
export const N = DIMS.reduce((a, b) => a * b, 1);
export const PROFILE_KEYS = ["hint", "chat", "agent"];
// baseline клиента: модель 1, Engine A, BF16, batch/cache по умолчанию, TP1, обычный SLO
export const BASELINE = [0, 0, 0, 0, 0, 0, 1];

// допуск p95 относительно baseline (иллюстрация): у подсказок самый жёсткий
export const SLA_REL = { hint: 1.08, chat: 1.2, agent: 1.6 };
export const QUALITY_GATE_PP = 1.0;

// Эффекты осей в лог-пространстве: y — полезные ток/с на GPU, x — p95 latency.
// Порядок профилей: hint, chat, agent.
const E = {
  model: {
    y: [[0, 0.1, 0.18, 0.45, 0.7, 0.95], [0, 0.1, 0.18, 0.45, 0.7, 0.95], [0, 0.1, 0.18, 0.45, 0.7, 0.95]],
    x: [[0, -0.08, -0.15, -0.3, -0.45, -0.6], [0, -0.08, -0.15, -0.3, -0.45, -0.6], [0, -0.08, -0.15, -0.3, -0.45, -0.6]],
  },
  runtime: {
    y: [[0, 0.08, 0.1, 0.02], [0, 0.05, 0.09, 0.04], [0, 0.04, 0.07, 0.06]],
    x: [[0, -0.05, -0.09, 0.02], [0, -0.04, -0.07, 0.03], [0, -0.03, -0.05, 0.04]],
  },
  precision: {
    // INT4 сильно поднимает y в agent и бьёт по TTFT в hint; FP8 быстрее префилл; KV8 помогает chat/agent
    y: [[0, 0.62, 0.7, 0.6], [0, 0.3, 0.38, 0.55], [0, 0.22, 0.5, 0.26]],
    x: [[0, -0.18, 0.22, -0.17], [0, -0.12, 0.05, -0.15], [0, -0.05, -0.1, -0.06]],
  },
  batch: {
    y: [[0, -0.22, 0.0, 0.25, 0.28, 0.34], [0, -0.15, 0.05, 0.22, 0.3, 0.36], [0, -0.1, 0.08, 0.2, 0.28, 0.33]],
    x: [[0, -0.3, -0.1, 0.25, 0.15, 0.12], [0, -0.2, -0.05, 0.2, 0.14, 0.12], [0, -0.12, 0.0, 0.16, 0.12, 0.1]],
  },
  cache: {
    y: [[0, 0.02, -0.05, -0.02], [0, 0.1, 0.14, 0.18], [0, 0.12, 0.16, 0.22]],
    x: [[0, -0.01, 0.02, 0.01], [0, -0.08, -0.06, -0.1], [0, -0.05, -0.03, -0.06]],
  },
  parallel: {
    // TP4: ниже latency, но ниже y на карту (больше карт на тот же поток)
    y: [[0, -0.08, -0.22, -0.18], [0, -0.08, -0.22, -0.18], [0, -0.08, -0.22, -0.18]],
    x: [[0, -0.15, -0.28, -0.2], [0, -0.15, -0.28, -0.2], [0, -0.15, -0.28, -0.2]],
  },
  slo: {
    y: [[-0.12, 0, 0.1], [-0.12, 0, 0.1], [-0.12, 0, 0.1]],
    x: [[-0.18, 0, 0.3], [-0.18, 0, 0.2], [-0.18, 0, 0.1]],
  },
};

// Платформа B (кейс C4): те же оси, другие слабые/сильные стороны — «на другом железе
// выигрывает другой рецепт». Только форма, без чисел.
const VARIANT_B = {
  runtime: { y: -1, x: -1, reverse: true },
  cache: { y: 1.8, x: 1.4 },
  parallel: { y: 0.4, x: 0.7 },
  precision: { y: 1, x: 1, perm: [0, 2, 1, 3] }, // на этой платформе «роли» FP8 и INT4 меняются местами
  batch: { y: 0.5, x: 1.5 },
  model: { y: 0.6, x: 1.0 },
};

function effect(variant, axis, kind, profile, v) {
  let e = E[axis][kind][profile][v];
  if (variant === "B") {
    const t = VARIANT_B[axis];
    if (t) {
      if (t.reverse) e = E[axis][kind][profile][E[axis][kind][profile].length - 1 - v];
      else if (t.perm) e = E[axis][kind][profile][t.perm[v]];
      else e *= t[kind];
    }
  }
  return e;
}

export function decode(i) {
  const d = new Array(DIMS.length);
  for (let a = DIMS.length - 1; a >= 0; a--) {
    d[a] = i % DIMS[a];
    i = Math.floor(i / DIMS[a]);
  }
  return d;
}
export function encode(d) {
  let i = 0;
  for (let a = 0; a < DIMS.length; a++) i = i * DIMS[a] + d[a];
  return i;
}

function qualityLoss(profile, d) {
  // слабая модель теряет качество; на агентах (длинные цепочки) ошибки копятся сильнее, на подсказках — слабее
  const model = [0, 0.25, 0.6, 1.5, 2.5, 4.0][d[0]] * [0.7, 1.0, 2.2][profile];
  const prec = [0, 0.05, profile === 2 ? 1.3 : 0.3, 0.1][d[2]];
  return model + prec;
}

export function buildCloud(variant = "A", seed = 42) {
  const out = { N, variant, profiles: {}, baseline: encode(BASELINE) };
  const digits = new Uint8Array(N * DIMS.length);
  for (let i = 0; i < N; i++) {
    const d = decode(i);
    for (let a = 0; a < d.length; a++) digits[i * DIMS.length + a] = d[a];
  }
  out.digits = digits;
  for (let p = 0; p < 3; p++) {
    const key = PROFILE_KEYS[p];
    const rng = mulberry32(mixSeed(seed, "cloud", variant, p));
    const gauss = () => {
      const u = 1 - rng();
      const v = rng();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    };
    const lx = new Float32Array(N);
    const ly = new Float32Array(N);
    const loss = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      let y = 0;
      let x = 0;
      for (let a = 0; a < DIMS.length; a++) {
        const v = digits[i * DIMS.length + a];
        y += effect(variant, AXES[a].key, "y", p, v);
        x += effect(variant, AXES[a].key, "x", p, v);
      }
      // взаимодействия: INT4 на малых моделях — ещё быстрее; KV8 + routing-aware cache — синергия
      const prec = digits[i * DIMS.length + 2];
      const model = digits[i * DIMS.length + 0];
      const cache = digits[i * DIMS.length + 4];
      if (prec === 2 && model >= 3) y += 0.08;
      if (prec === 3 && cache === 3 && p > 0) y += 0.06;
      ly[i] = y + 0.06 * gauss();
      lx[i] = x + 0.06 * gauss();
      loss[i] = qualityLoss(p, Array.from(digits.subarray(i * DIMS.length, (i + 1) * DIMS.length)));
    }
    // baseline без шума — точка отсчёта
    const b = out.baseline;
    const bx = lx[b];
    const by = ly[b];
    const slaLog = Math.log(SLA_REL[key]);
    const pass = new Uint8Array(N); // 1 — проходит и качество, и SLA
    const qok = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      qok[i] = loss[i] <= QUALITY_GATE_PP ? 1 : 0;
      pass[i] = qok[i] && lx[i] - bx <= slaLog ? 1 : 0;
    }
    // звезда: максимум y среди прошедших; фронт Парето: min x — max y
    let star = -1;
    for (let i = 0; i < N; i++) if (pass[i] && (star < 0 || ly[i] > ly[star])) star = i;
    const ids = [];
    for (let i = 0; i < N; i++) if (pass[i]) ids.push(i);
    ids.sort((a, c) => lx[a] - lx[c]);
    const front = [];
    let best = -Infinity;
    for (const i of ids) {
      if (ly[i] > best) {
        best = ly[i];
        front.push(i);
      }
    }
    // калибровка: степень α так, что (y_star/y_base)^α = gain; baseline стоит на MODES.base
    const m = MODES[key];
    const alpha = Math.log(m.gain) / (ly[star] - by);
    const Y = new Float32Array(N); // полезные ток/с на GPU
    const X = new Float32Array(N); // p95 относительно baseline
    for (let i = 0; i < N; i++) {
      Y[i] = m.base * Math.exp(alpha * (ly[i] - by));
      X[i] = Math.exp(lx[i] - bx);
    }
    out.profiles[key] = {
      x: X, y: Y, pass, qok, loss, star, front: Int32Array.from(front),
      alpha, sla: SLA_REL[key], baselineY: m.base, starY: m.base * m.gain,
    };
  }
  return out;
}

export const SEARCH_TOTAL = Object.values(SEARCH_SPACE).reduce((a, b) => a * b, 1);
