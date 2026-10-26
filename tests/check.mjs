// Проверки чисел из ТЗ (критерии приёмки) без браузера: node tests/check.mjs
import assert from "node:assert/strict";
import { MODES, HEADLINE, NODE_RUB_YEAR, SEARCH_SPACE } from "../data.js";
import { Pair } from "../sim.js";
import { fleetResult, deferNode, WEEKLY_LOSS_RUB, nightBatch, CASES, caseResults, violatesBadgeRule, cardHeadline } from "../cases.js";
import { fmtMln, fmtNum, fmtInt } from "../lib/format.js";
import { gainTotal } from "../scenes/scene4.js";
import { fleetMath } from "../scenes/scene5.js";
import { buildCloud, N, PROFILE_KEYS } from "../engines/cloudmodel.js";

const NB = " ";
let ok = 0;
const t = (name, fn) => {
  try {
    fn();
    ok++;
    console.log("  ✓", name);
  } catch (e) {
    console.error("  ✗", name, "\n    ", e.message);
    process.exitCode = 1;
  }
};

console.log("Данные (§3 брифа, критерий 1)");
t("режимы: 154→471, 46→76, 21→30 ток/с на GPU", () => {
  assert.equal(fmtInt(MODES.hint.base), "154");
  assert.equal(fmtInt(MODES.hint.base * MODES.hint.gain), "471");
  assert.equal(fmtInt(MODES.chat.base), "46");
  assert.equal(fmtInt(MODES.chat.base * MODES.chat.gain), "76");
  assert.equal(fmtInt(MODES.agent.base), "21");
  assert.equal(fmtInt(MODES.agent.base * MODES.agent.gain), "30");
});
t("HEADLINE: 20 → 16 H200, 45,8 млн ₽ в год, чек 4,6–9,2", () => {
  assert.equal(HEADLINE.fleet / HEADLINE.throughputGain, HEADLINE.after);
  assert.equal(fmtMln(NODE_RUB_YEAR), `45,8${NB}млн${NB}₽`);
  assert.equal(fmtMln(NODE_RUB_YEAR * 0.1), `4,6${NB}млн${NB}₽`);
  assert.equal(fmtMln(NODE_RUB_YEAR * 0.2), `9,2${NB}млн${NB}₽`);
});
t("пространство поиска = 27 648", () => {
  assert.equal(Object.values(SEARCH_SPACE).reduce((a, b) => a * b, 1), 27648);
  assert.equal(N, 27648);
});

console.log("Сцена 5 «Одна нода» (доп. критерий 7)");
t("+10 % → 0 ₽, +25 % → 45,8 млн ₽, +67 % → две ноды", () => {
  assert.equal(fleetMath(10).freed, 0);
  assert.equal(fleetMath(25).freed, 1);
  assert.equal(fleetMath(67).freed, 2);
  assert.equal(fleetMath(66).freed, 1);
  assert.equal(fleetMath(25).needed, 16);
  assert.equal(fmtMln(fleetMath(25).freed * NODE_RUB_YEAR), `45,8${NB}млн${NB}₽`);
});

console.log("Симуляция (критерий 2 брифа, доп. критерий 2)");
t("hint, ρ=0,7: без подбора >50 % опоздавших, с подбором <5 %", () => {
  for (const seed of [42, 7, 100]) {
    const p = new Pair({ mode: "hint", load: 0.7, seed, tiles: 0 });
    p.advance(30);
    const b = p.base.cum;
    const u = p.tuned.cum;
    assert.ok(b.late / b.resolved > 0.5, `base late ${(b.late / b.resolved).toFixed(2)} seed ${seed}`);
    assert.ok(u.late / u.resolved < 0.05, `tuned late ${(u.late / u.resolved).toFixed(2)} seed ${seed}`);
  }
});
t("при ρ_base<0,8 полезные и сырые токены совпадают в пределах 3 %", () => {
  for (const mode of ["hint", "chat", "agent"]) {
    const p = new Pair({ mode, load: 0.2, seed: 42, tiles: 0 });
    p.advance(120);
    for (const side of [p.base, p.tuned]) {
      const ratio = side.cum.useful / side.cum.raw;
      assert.ok(ratio > 0.97, `${mode} ratio ${ratio.toFixed(3)}`);
    }
  }
});
t("agent: разница видна, но скромнее, чем у hint (накопленные полезные токены, 3 сида)", () => {
  // Накопленные значения, а не мгновенные окна: у агентов событий мало, окно шумит.
  const gap = (mode, secs, seed) => {
    const p = new Pair({ mode, load: 0.7, seed, tiles: 0 });
    p.advance(secs);
    return p.tuned.cum.useful / Math.max(1, p.base.cum.useful);
  };
  for (const seed of [42, 7, 100]) {
    const gapA = gap("agent", 240, seed);
    const gapH = gap("hint", 60, seed);
    assert.ok(gapA > 1.1, `agent gap ${gapA} seed ${seed}`);
    assert.ok(gapA < gapH, `agent ${gapA} < hint ${gapH} seed ${seed}`);
  }
});
t("одинаковый сид → одинаковый ход симуляции", () => {
  const run = () => {
    const p = new Pair({ mode: "hint", load: 0.7, seed: 5, tiles: 12, bursty: true });
    p.advance(20);
    return [p.base.total, p.tuned.total, p.arrivalsTotal];
  };
  assert.deepEqual(run(), run());
});

console.log("Облако (доп. критерий 3)");
t("Y звезды / Y baseline = gain режима (точность 1 %)", () => {
  const c = buildCloud("A", 42);
  for (const k of PROFILE_KEYS) {
    const p = c.profiles[k];
    const ratio = p.y[p.star] / p.y[c.baseline];
    assert.ok(Math.abs(ratio / MODES[k].gain - 1) < 0.01, `${k} ${ratio}`);
  }
});

console.log("Микшер (сцена 4)");
t("только подсказки 3,05×, только агенты 1,41×", () => {
  assert.ok(Math.abs(gainTotal({ hint: 1, chat: 0, agent: 0 }) - 3.05) < 1e-9);
  assert.ok(Math.abs(gainTotal({ hint: 0, chat: 0, agent: 1 }) - 1.41) < 1e-9);
});

console.log("Кейсы: таблица §5 demo_cases.md (расчёт функцией fleetResult)");
const row = (id) => fleetResult(CASES.find((x) => x.id === id).fleet.alloc);
t("A1 Банк: 24 → 12, −3 ноды, +100 %, 137,4 млн, чек 13,7–27,5", () => {
  const r = row("a1");
  assert.equal(r.after, 12);
  assert.equal(r.freedNodes, 3);
  assert.equal(Math.round(r.sameFleetGrowth * 100), 100);
  assert.equal(fmtMln(r.rubYear), `137,4${NB}млн${NB}₽`);
  assert.equal(fmtMln(r.fee[0]), `13,7${NB}млн${NB}₽`);
  assert.equal(fmtMln(r.fee[1]), `27,5${NB}млн${NB}₽`);
});
t("A2 IT, монорепа: 24 → 15, −2 ноды, запас 1, +60 %, 91,6 млн, чек 9,2–18,3", () => {
  const r = row("a2");
  assert.equal(r.after, 15);
  assert.equal(r.freedNodes, 2);
  assert.equal(r.spareCards, 1);
  assert.equal(Math.round(r.sameFleetGrowth * 100), 60);
  assert.equal(fmtMln(r.rubYear), `91,6${NB}млн${NB}₽`);
  assert.equal(fmtMln(r.fee[0]), `9,2${NB}млн${NB}₽`);
  assert.equal(fmtMln(r.fee[1]), `18,3${NB}млн${NB}₽`);
});
t("A3 Legacy: 24 → 18, −1 нода, запас 2, +33 %, 45,8 млн, чек 4,6–9,2", () => {
  const r = row("a3");
  assert.equal(r.after, 18);
  assert.equal(r.freedNodes, 1);
  assert.equal(r.spareCards, 2);
  assert.equal(Math.round(r.sameFleetGrowth * 100), 33);
  assert.equal(fmtMln(r.rubYear), `45,8${NB}млн${NB}₽`);
});
t("B2 Провайдер: 128 → 83, −11 нод, +54 %, 503,7 млн, чек 50,4–100,7", () => {
  const r = row("b2");
  assert.equal(r.after, 83);
  assert.equal(r.freedNodes, 11);
  assert.equal(Math.round(r.sameFleetGrowth * 100), 54);
  assert.equal(fmtMln(r.rubYear), `503,7${NB}млн${NB}₽`);
  assert.equal(fmtMln(r.fee[0]), `50,4${NB}млн${NB}₽`);
  assert.equal(fmtMln(r.fee[1]), `100,7${NB}млн${NB}₽`);
});
t("A0: три ряда гасят 3, 2 и 1 ноду", () => {
  const parts = caseResults(CASES.find((c) => c.id === "a0")).parts.map((p) => p.r.freedNodes);
  assert.deepEqual(parts, [3, 2, 1]);
});
t("A4: 8 ч → 5,7 ч, конец 06:40 вместо 09:00, ≈ 9,8 млн токенов", () => {
  const n = nightBatch();
  assert.equal(fmtNum(n.tunedHours, 1), "5,7");
  assert.equal(fmtNum(n.tokens / 1e6, 1), "9,8");
  const r = caseResults(CASES.find((c) => c.id === "a4"));
  assert.ok(r.rows[1].value.includes("06:40") && r.rows[1].value.includes("09:00"));
});
t("B1: при 5 % в месяц потолок 2,2 → 6,7 мес, отсрочка ≈ 4,6 мес, ≈ 17,5 млн ₽", () => {
  const d = deferNode(0.05);
  assert.equal(fmtNum(d.tBase, 1), "2,2");
  assert.equal(fmtNum(d.tTuned, 1), "6,7");
  assert.equal(fmtNum(d.months, 1), "4,6");
  assert.equal(fmtMln(d.rub), `17,5${NB}млн${NB}₽`);
  assert.ok(deferNode(0.1).months < d.months, "ползунок r меняет отсрочку");
});
t("B4: ≈ 0,88 млн ₽ в неделю простоя", () => {
  assert.equal(fmtNum(WEEKLY_LOSS_RUB / 1e6, 2), "0,88");
});

console.log("Правила честности");
t("бейдж «иллюстрация» не стоит рядом с рублями; в группе C нет рублей и ×N", () => {
  for (const c of CASES) {
    const r = caseResults(c);
    assert.ok(!violatesBadgeRule(r.rows), `${c.id}: иллюстрация рядом с ₽`);
    if (c.group === "routing") {
      const text = JSON.stringify(r.rows) + JSON.stringify(cardHeadline(c));
      assert.ok(!/₽/.test(text), `${c.id}: рубли в группе C`);
      assert.ok(!/×\s?\d/.test(text), `${c.id}: множитель в группе C`);
    }
  }
});
t("+25 % и множители режимов не на одном экране", () => {
  const mult = /\d,\d{2}×/;
  for (const id of ["b1", "b4"]) {
    const c = CASES.find((x) => x.id === id);
    const txt = JSON.stringify(caseResults(c)) + c.pain + c.recipe.join(" ");
    assert.ok(!mult.test(txt), `${id} содержит множитель режима`);
  }
  for (const id of ["a1", "a2", "a3", "b2"]) {
    const c = CASES.find((x) => x.id === id);
    const txt = JSON.stringify(caseResults(c)) + c.pain + c.recipe.join(" ");
    assert.ok(!/\+\s?25\s?%/.test(txt), `${id} содержит +25 %`);
  }
});
t("в данных кейсов нет названий реальных компаний-конкурентов", () => {
  const bad = /vllm|sglang|tensorrt|nvidia|cloud\.ru|openai|anthropic|yandex|сбер/i;
  for (const c of CASES) assert.ok(!bad.test(JSON.stringify(c)), c.id);
});

console.log(`\n${ok} проверок пройдено${process.exitCode ? ", ЕСТЬ ПРОВАЛЫ" : ""}`);
