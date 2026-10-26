// Данные демо. Источники: Модель_v2_эффективность_GPU.xlsx (режимы) и
// инвесторская презентация (деньги, парк, профили). См. demo_brief*.md.
//
// ВАЖНО: из грантовой версии (SEGMENTS, GPU_COST_RUB_PER_MONTH) на экран
// ничего не выводится — все рубли берутся только из HEADLINE.

export const MODES = {
  hint: {
    label: "Подсказки в редакторе",
    short: "Подсказки",
    tier: "S",
    base: 154.320987654321,
    gain: 3.05,
    recipe: ["FP8 W8A8", "MTP"],
    modelClass: "прокси 27B dense",
  },
  chat: {
    label: "Чат по кодовой базе",
    short: "Чат",
    tier: "M",
    base: 46.2962962962963,
    gain: 1.65,
    recipe: ["FP8 W8A8", "KV8", "MTP"],
    modelClass: "прокси 35B-A3B MoE",
  },
  agent: {
    label: "Агентные прогоны",
    short: "Агенты",
    tier: "L",
    base: 21.21913580246914,
    gain: 1.41,
    recipe: ["FP8 W8A8", "MTP"],
    modelClass: "прокси 35B-A3B MoE",
  },
};
// base — токенов/с на одну GPU без подбора; после = base * gain
// (≈ 470.7 / 76.4 / 29.9)

export const MODE_KEYS = ["hint", "chat", "agent"];

export const HEADLINE = {
  gpu: "H200",
  fleet: 20,
  after: 16,
  nodesBefore: 5,
  nodeCards: 4,
  throughputGain: 1.25, // 20 / 1,25 = 16 → одна нода 4×H200 свободна
  nodeRentRubMonth: 3_815_625, // публичная ставка аренды, «от», 4×H200
  savingRubYear: 45_787_500, // 3 815 625 × 12 ≈ 45,8 млн ₽
  feeShare: [0.1, 0.2], // наш чек: 4,58–9,16 млн ₽
  costBasis: "публичная цена аренды 4×H200 у облачного провайдера, от 3 815 625 ₽/мес",
  label: "Иллюстративный расчёт", // так подписано на слайде 7
};

export const ICP = {
  enterprise: {
    label: "Enterprise",
    fleet: "16–64+ GPU",
    buyer: "CTO / Head of ML Platform",
  },
  cloud: {
    label: "API / Cloud",
    fleet: "100+ GPU",
    buyer: "AI Infrastructure Lead / Cloud Director",
  },
};

export const PROFILES = {
  rag: {
    label: "Документы и RAG",
    prompt: "8–64k",
    prefixReuse: "высокий",
    concurrency: "стабильный",
    lever: "cache + batching",
  },
  code: {
    label: "Code assistant",
    prompt: "32–128k",
    prefixReuse: "средний / высокий",
    concurrency: "bursty",
    lever: "TTFT + cache + precision",
  },
  api: {
    label: "API-провайдер",
    prompt: "1–128k",
    prefixReuse: "непредсказуемый",
    concurrency: "сильно меняется",
    lever: "routing + набор profiles",
  },
};

export const SEARCH_SPACE = {
  model: 6,
  runtime: 4,
  precision: 4,
  batch: 6,
  cache: 4,
  parallel: 4,
  slo: 3,
}; // = 27 648

export const DISCLAIMER = "Расчёт по модели производительности, не замер на GPU";
export const DISCLAIMER_ILLUSTRATIVE = "Иллюстративный расчёт";
export const DISCLAIMER_MECHANISM = "Иллюстрация механизма. Величина эффекта зависит от trace клиента";

export const SECONDS_PER_YEAR = 31_536_000;
export const NODE_RUB_YEAR = HEADLINE.nodeRentRubMonth * 12; // 45 787 500
