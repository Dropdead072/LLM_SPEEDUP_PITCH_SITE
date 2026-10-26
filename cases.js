// Каталог бизнес-кейсов (demo_cases.md). Клиенты вымышленные и обезличенные.
// Рубли — только по ставке из презентации: 3 815 625 ₽/мес за ноду 4×H200 →
// 45 787 500 ₽ в год. Высвобождение считается ЦЕЛЫМИ нодами.
// Бейджи источника: «модель» (MODES), «презентация» (дека), «иллюстрация» (игрушечная
// симуляция / параметр демо). Бейдж «иллюстрация» никогда не стоит рядом с рублями.
import { MODES, MODE_KEYS, HEADLINE, NODE_RUB_YEAR } from "./data.js";

export const NODE_CARDS = HEADLINE.nodeCards;
export const FEE = HEADLINE.feeShare; // [0.10, 0.20]

// Пересчёт парка по режимам — тот же метод, что в финмодели:
// карты после = ceil(карты до / gain) по каждому режиму отдельно.
export function fleetResult(alloc /* {hint, chat, agent} в картах */) {
  const before = alloc.hint + alloc.chat + alloc.agent;
  const after = MODE_KEYS.map((m) => (alloc[m] ? Math.ceil(alloc[m] / MODES[m].gain - 1e-9) : 0)).reduce((a, b) => a + b, 0);
  const nodesBefore = before / NODE_CARDS;
  const nodesAfter = Math.ceil(after / NODE_CARDS);
  const freedNodes = nodesBefore - nodesAfter;
  return {
    before,
    after,
    nodesBefore,
    nodesAfter,
    spareCards: nodesAfter * NODE_CARDS - after, // «запас под рост», в рубли не переводится
    freedNodes,
    rubYear: freedNodes * NODE_RUB_YEAR,
    fee: FEE.map((s) => s * freedNodes * NODE_RUB_YEAR),
    sameFleetGrowth: before / after - 1, // «больше запросов на том же парке»
    perMode: Object.fromEntries(MODE_KEYS.map((m) => [m, { before: alloc[m], after: alloc[m] ? Math.ceil(alloc[m] / MODES[m].gain - 1e-9) : 0 }])),
  };
}

// ----- B1: отсрочка закупки ноды -----
// Месяцев до потолка = ln(C / D0) / ln(1 + r), D0 = 0,9·C₀ (парк загружен на 90 %).
export function deferNode(r /* рост нагрузки в месяц, доля */, gain = HEADLINE.throughputGain) {
  const D0 = 0.9;
  const t = (C) => Math.log(C / D0) / Math.log(1 + r);
  const tBase = t(1);
  const tTuned = t(gain);
  const months = tTuned - tBase;
  return { tBase, tTuned, months, rub: months * HEADLINE.nodeRentRubMonth };
}

// ----- B4: потеря эффекта при смене модели -----
export const WEEKLY_LOSS_RUB = NODE_RUB_YEAR / 52; // ≈ 0,88 млн ₽ в неделю простоя profile (1 нода)

// ----- A4: ночной пакет агентов -----
export function nightBatch() {
  const m = MODES.agent;
  const gpus = 16;
  const hours = 8;
  const tokens = m.base * gpus * hours * 3600; // ≈ 9,78 млн токенов
  const tunedHours = hours / m.gain; // ≈ 5,67 ч
  return { gpus, hours, tokens, tunedHours };
}

const G = {
  scenarios: "Сценарии нагрузки",
  spend: "Как потратить прирост",
  routing: "Роутинг",
};
export const GROUP_LABELS = G;

const fleet = (n, h, c, a) => ({ gpu: "H200", total: n, alloc: { hint: h, chat: c, agent: a } });

export const CASES = [
  // ---------------- A · Сценарии нагрузки ----------------
  {
    id: "a0",
    slug: "same-fleet",
    code: "A0",
    group: "scenarios",
    title: "Один парк — три результата",
    client: "Три клиента с одинаковым парком",
    fleetLine: "24 × H200 у каждого · разный профиль",
    fleet: fleet(24, 0, 0, 0),
    pain: "Парк одинаковый, методы одни и те же — а результат отличается втрое, потому что отличается профиль нагрузки.",
    recipe: ["Рецепт подбирается под профиль", "FP8 W8A8 · MTP · KV8 — там, где они нужны"],
    engine: "triple",
    pilot: "Реальный профиль нагрузки каждого клиента (доли подсказок, чата, агентов).",
    headline: "−3, −2, −1 нода",
  },
  {
    id: "a1",
    slug: "bank-hints",
    code: "A1",
    group: "scenarios",
    title: "Банк: автодополнение в закрытом контуре",
    client: "Банк, внутренний код-ассистент, код не покидает периметр",
    fleetLine: "24 × H200 · подсказки 67 %",
    fleet: fleet(24, 16, 6, 2),
    pain: "После утреннего стендапа 1 500 разработчиков одновременно открывают IDE; подсказки опаздывают, люди их выключают.",
    recipe: ["FP8 W8A8 + MTP — пул подсказок", "FP8 + KV8 + MTP — чат"],
    engine: "split-hint",
    pilot: "Реальную долю подсказок в трафике и p95 в пике.",
  },
  {
    id: "a2",
    slug: "monorepo-chat",
    code: "A2",
    group: "scenarios",
    title: "Продуктовая IT-компания: чат по монорепе",
    client: "Продуктовая IT-компания, чат по монорепозиторию",
    fleetLine: "24 × H200 · чат 67 %",
    fleet: fleet(24, 4, 16, 4),
    pain: "Вопросы по монорепе на 32–128k токенов контекста: длинные сессии не помещаются в память, и одновременных сессий мало.",
    recipe: ["FP8 веса (освобождают память)", "KV8 (вдвое меньше на токен кэша)", "MTP"],
    engine: "memory-chat",
    pilot: "Распределение длины контекста и долю переиспользуемого префикса.",
  },
  {
    id: "a3",
    slug: "legacy-agents",
    code: "A3",
    group: "scenarios",
    title: "Миграция legacy агентами (честный кейс)",
    client: "Команда миграции legacy-кода, агентные прогоны",
    fleetLine: "24 × H200 · агенты 83 %",
    fleet: fleet(24, 0, 4, 20),
    pain: "Агенты часами переписывают старый код; парк загружен почти круглосуточно.",
    recipe: ["FP8 W8A8", "MTP"],
    engine: "agent",
    pilot: "Долю префилла в агентных шагах и переиспользование контекста — это резерв, которого нет в расчёте.",
    plate:
      "Здесь выигрыш по точности и MTP скромный: почти половина времени агента — чтение контекста. Основной резерв — кэш и маршрутизация (кейс C2), его меряем на trace.",
  },
  {
    id: "a4",
    slug: "day-night",
    code: "A4",
    group: "scenarios",
    title: "Днём подсказки, ночью агенты",
    client: "Внутренний ассистент, один парк на день и на ночь",
    fleetLine: "16 × H200 · день — подсказки, ночь — агенты",
    fleet: fleet(16, 0, 0, 16),
    pain: "Ночью тот же парк гоняет пакет агентных задач (разбор упавших тестов, обновление зависимостей). Пакет не успевает закончиться до утра и наезжает на утренний пик подсказок.",
    recipe: ["Два профиля на одном парке по расписанию", "дневной — под подсказки и чат, ночной — под агентов"],
    engine: "timeline-day",
    pilot: "Объём ночного пакета и форму дневного пика.",
  },
  // ---------------- B · Как потратить прирост ----------------
  {
    id: "b1",
    slug: "defer-node",
    code: "B1",
    group: "spend",
    title: "Отложить закупку ноды",
    client: "Enterprise",
    fleetLine: "20 × H200 · загрузка 90 %",
    fleet: fleet(20, 0, 0, 0),
    pain: "Нагрузка растёт, парк загружен на 90 %, следующую ноду в текущих условиях ждать долго и дорого.",
    recipe: ["Прирост +25 % полезного throughput"],
    engine: "timeline-months",
    pilot: "Реальный темп роста нагрузки (в расчёте — ползунок, 5 % в месяц).",
  },
  {
    id: "b2",
    slug: "provider-growth",
    code: "B2",
    group: "spend",
    title: "Провайдер: больше клиентов на том же железе",
    client: "Российский API-провайдер, ICP «API / Cloud, 100+ GPU»",
    fleetLine: "128 × H200 (32 ноды)",
    fleet: fleet(128, 16, 40, 72),
    pain: "GPU — это себестоимость каждого токена; новых карт быстро не достать, а клиенты прибывают.",
    recipe: ["Режимы подбираются отдельно для подсказок, чата и агентов"],
    engine: "node-grid",
    pilot: "Реальный микс трафика по режимам и пиковую нагрузку.",
    plate: "Для провайдера это не экономия, а выручка: одно из двух, не оба сразу.",
  },
  {
    id: "b3",
    slug: "premium-sla",
    code: "B3",
    group: "spend",
    title: "Премиальный SLA вместо экономии",
    client: "Тот же провайдер, но решает не высвобождать карты",
    fleetLine: "парк не сокращается",
    fleet: fleet(0, 0, 0, 0),
    pain: "Запас ёмкости тратится на отклик: при той же нагрузке p95 TTFT заметно ниже, и это продаётся как отдельный тариф с гарантией p95.",
    recipe: ["Запас ёмкости → отклик, а не экономия на картах"],
    engine: "premium",
    pilot: "Реальное распределение p95 в пике и порог тарифа.",
    noRub: true,
    plate: "Цена тарифа — решение провайдера: рублей здесь нет.",
  },
  {
    id: "b4",
    slug: "new-model",
    code: "B4",
    group: "spend",
    title: "Новая модель: зачем квартальный переподбор",
    client: "Любой клиент; пример на 20 × H200",
    fleetLine: "20 × H200",
    fleet: fleet(20, 0, 0, 0),
    pain: "Часть рецепта привязана к весам конкретной модели: калибровка FP8, головы MTP / черновая модель для спекулятивного декодирования. Клиент обновил модель — старый profile к ней не применяется, парк откатывается на baseline.",
    recipe: ["Прирост +25 % полезного throughput", "Квартальный переподбор profile"],
    engine: "timeline-weeks",
    pilot: "Как часто клиент меняет модель и сколько недель занимает пересборка.",
    plate: "Квартальный profile — не абонентская плата, а работа: модель сменилась — конфигурацию надо собрать заново.",
  },
  // ---------------- C · Роутинг ----------------
  {
    id: "c1",
    slug: "short-wait-long",
    code: "C1",
    group: "routing",
    title: "Короткие не должны ждать длинных",
    client: "IT-компания, на одном пуле и подсказки, и агенты",
    fleetLine: "3 реплики · подсказки + агенты",
    fleet: fleet(0, 0, 0, 0),
    pain: "Агент отправляет 100k токенов контекста, реплика занята его префиллом, и подсказки, пришедшие следом, ждут секунды.",
    recipe: ["Round-robin → пул под подсказки → приоритет и куски по 2k"],
    engine: "routing-classes",
    pilot: "Реальную долю агентного трафика и размеры контекста.",
    noRub: true,
  },
  {
    id: "c2",
    slug: "one-repo-one-replica",
    code: "C2",
    group: "routing",
    title: "Один репозиторий — одна реплика",
    client: "Enterprise, 12 команд в 3 больших репозиториях",
    fleetLine: "3 реплики · 3 репозитория",
    fleet: fleet(0, 0, 0, 0),
    pain: "Запросы одного репозитория разлетаются по всем репликам, кэш каждой забит чужим, префилл повторяется.",
    recipe: ["Round-robin → сродство по префиксу → сродство с потолком загрузки"],
    engine: "routing-repo",
    pilot: "Реальное распределение запросов по репозиториям и размер общего префикса.",
    noRub: true,
  },
  {
    id: "c3",
    slug: "noisy-neighbor",
    code: "C3",
    group: "routing",
    title: "Провайдер: шумный сосед",
    client: "API-провайдер, три tenant: банк (подсказки), IT-компания (чат), стартап с агентами",
    fleetLine: "3 реплики · 3 tenant",
    fleet: fleet(0, 0, 0, 0),
    pain: "Стартап запускает массовый прогон агентов (×7 трафика), и у банка, который платит за SLA, разваливается p95.",
    recipe: ["Least-loaded → fair share → fair share + пулы по tenant"],
    engine: "routing-tenants",
    pilot: "Реальные квоты tenant и профиль всплесков.",
    noRub: true,
  },
  {
    id: "c4",
    slug: "vendor-tco",
    code: "C4",
    group: "routing",
    title: "Вендор ускорителя: доказать TCO",
    client: "Производитель альтернативного ускорителя (EXPANSION ICP)",
    fleetLine: "одна модель, один trace, две платформы",
    fleet: fleet(0, 0, 0, 0),
    pain: "Нужно показать TCO на сопоставимой нагрузке: выигрывающий рецепт на каждой платформе свой.",
    recipe: ["Та же модель и тот же trace на двух платформах"],
    engine: "cloud-two",
    pilot: "Всё — числа появятся только после замеров на реальных платформах.",
    noRub: true,
    afterMeasure: true,
  },
];

export const CASE_BY_ID = Object.fromEntries(CASES.flatMap((c) => [[c.id, c], [c.slug, c], [c.code.toLowerCase(), c]]));

export const TOURS = {
  short: ["a0", "b2", "c1"],
  full: ["a0", "a1", "a2", "a3", "b1", "b2", "b4", "c1", "c3"],
  qa: ["a3", "b4", "c2", "c4"],
};

// ----- итоговые числа кейса (то, что показывается справа) -----
// Возвращает [{label, value, source, note?}] + fee. Сайт считает их функцией, а не хранит строками.
import { fmtMln, fmtNum, fmtInt, fmtPct, fmtSigned } from "./lib/format.js";

const RUB = "презентация (ставка)";

function fleetResults(c) {
  const f = fleetResult(c.fleet.alloc);
  const out = [
    { label: "нод высвобождается", value: `−${fmtInt(f.freedNodes)} ${plural(f.freedNodes, "нода", "ноды", "нод")}`, source: "модель" },
    { label: "аренда ноды в год", value: `${fmtMln(f.rubYear)} в год`, source: RUB },
    { label: "либо больше запросов на том же парке", value: `${fmtSigned(f.sameFleetGrowth * 100, 0)} % запросов`, source: "модель", alt: true },
  ];
  const fee = { value: `${fmtMln(f.fee[0]).replace(/\s*млн\s*₽/, "")}–${fmtMln(f.fee[1])}`, source: "презентация", note: "10–20 % подтверждённого эффекта" };
  return { rows: out, fee, f };
}

function plural(n, one, few, many) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

export function caseResults(c, live = {}) {
  switch (c.id) {
    case "a0": {
      const parts = [
        { name: "Банк", alloc: { hint: 16, chat: 6, agent: 2 } },
        { name: "IT-компания", alloc: { hint: 4, chat: 16, agent: 4 } },
        { name: "Миграция legacy", alloc: { hint: 0, chat: 4, agent: 20 } },
      ].map((p) => ({ ...p, r: fleetResult(p.alloc) }));
      return {
        rows: parts.map((p) => ({
          label: p.name,
          value: `−${p.r.freedNodes} ${plural(p.r.freedNodes, "нода", "ноды", "нод")} · ${fmtMln(p.r.rubYear)}/год`,
          source: RUB,
        })),
        fee: null,
        parts,
      };
    }
    case "a1":
    case "a2":
    case "a3":
    case "b2":
      return fleetResults(c);
    case "a4": {
      const n = nightBatch();
      const startH = 1;
      return {
        rows: [
          { label: "ночной пакет агентов", value: `${fmtNum(n.hours, 0)} ч → ${fmtNum(n.tunedHours, 1)} ч`, source: "модель" },
          {
            label: "конец пакета",
            value: `${clockHM(startH + n.tunedHours)} вместо ${clockHM(startH + n.hours)}`,
            source: "модель",
            note: "старт в 01:00",
          },
          { label: "объём пакета", value: `≈ ${fmtNum(n.tokens / 1e6, 1)} млн токенов`, source: "модель" },
        ],
        fee: null,
      };
    }
    case "b1": {
      const r = live.r ?? 0.05;
      const d = deferNode(r);
      return {
        rows: [
          { label: "прирост полезного throughput", value: "+25 %", source: "презентация" },
          { label: "потолок без подбора / с подбором", value: `через ${fmtNum(d.tBase, 1)} / ${fmtNum(d.tTuned, 1)} мес`, source: "модель" },
          { label: "покупка ноды откладывается", value: `на ≈ ${fmtNum(d.months, 1)} мес`, source: "модель" },
          { label: "аренда ноды за этот срок", value: `≈ ${fmtMln(d.rub)}`, source: RUB },
        ],
        fee: { value: `${fmtMln(HEADLINE.savingRubYear * FEE[0]).replace(/\s*млн\s*₽/, "")}–${fmtMln(HEADLINE.savingRubYear * FEE[1])}`, source: "презентация", note: "считается от подтверждённого годового эффекта (слайд 7)" },
      };
    }
    case "b3":
      return {
        rows: live.rows || [
          { label: "p95 TTFT подсказок · подобранная сторона", value: "…", source: "иллюстрация" },
          { label: "p95 TTFT подсказок · без подбора", value: "…", source: "иллюстрация" },
        ],
        fee: null,
      };
    case "b4":
      return {
        rows: [
          { label: "прирост до смены модели", value: "+25 %", source: "презентация" },
          { label: "простой profile — потеря в неделю", value: `≈ ${fmtNum(WEEKLY_LOSS_RUB / 1e6, 2)} млн ₽`, source: RUB, note: "1 нода, публичная ставка аренды" },
        ],
        fee: null,
      };
    case "c4":
      return { rows: [{ label: "числа", value: "после замеров", source: "иллюстрация", noNumbers: true }], fee: null };
    default:
      return { rows: live.rows || [], fee: null };
  }
}

export function clockHM(h) {
  const total = Math.round(h * 60); // округляем до минут целиком, чтобы не получить «11:60»
  const hh = Math.floor(total / 60) % 24;
  const mm = total % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

// главный результат для карточки галереи
export function cardHeadline(c) {
  if (c.id === "a0") return { value: "−3 · −2 · −1 нода", source: "модель" };
  if (["a1", "a2", "a3", "b2"].includes(c.id)) {
    const r = fleetResults(c);
    if (c.id === "b2") return { value: `${fmtSigned(r.f.sameFleetGrowth * 100, 0)} % запросов`, source: "модель" };
    return { value: `${r.rows[0].value}`, source: "модель", sub: `${r.rows[1].value}`, subSource: RUB };
  }
  if (c.id === "a4") return { value: `пакет 8 ч → ${fmtNum(nightBatch().tunedHours, 1)} ч`, source: "модель" };
  if (c.id === "b1") return { value: `отсрочка ≈ ${fmtNum(deferNode(0.05).months, 1)} мес`, source: "модель" };
  if (c.id === "b3") return { value: "p95 ниже порога тарифа", source: "иллюстрация" };
  if (c.id === "b4") return { value: "≈ 0,88 млн ₽ в неделю простоя", source: RUB };
  if (c.id === "c4") return { value: "числа — после замеров", source: "иллюстрация" };
  return { value: "p95 TTFT: по политикам", source: "иллюстрация" };
}

// бейдж «иллюстрация» не должен стоять рядом с рублями — проверка для тестов
export function violatesBadgeRule(rows) {
  const rub = /₽/;
  return rows.some((r) => r.source === "иллюстрация" && rub.test(r.value + (r.note || "")));
}
