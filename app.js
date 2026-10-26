// Оболочка демо: холст 1920×1080 с масштабом под окно, фиксированные часы
// симуляции (60 Гц), навигация, режим записи с виртуальным временем.
import { DISCLAIMER, DISCLAIMER_ILLUSTRATIVE, DISCLAIMER_MECHANISM } from "./data.js";
import { DT } from "./sim.js";

// Порядок сцен. Сцена 6 (необязательная, «лучший по отклику — худший по памяти»)
// не делается: в ТЗ она требует scenarios.json, которого нет, — числа не выдумываем.
export const SCENE_ORDER = [1, 2, 3, 4, 5, 7, 8, 9, 10];

const qs = new URLSearchParams(location.search);
const num = (k, d) => (qs.has(k) && qs.get(k) !== "" && !Number.isNaN(Number(qs.get(k))) ? Number(qs.get(k)) : d);

export const params = {
  scene: num("scene", 1),
  mode: qs.get("mode") || "hint",
  load: num("load", 0.7),
  seed: num("seed", 42),
  record: qs.get("record") === "1",
  duration: num("duration", 12),
  theme: qs.get("theme") === "grant" ? "grant" : "investor",
  case: qs.get("case"),
  tour: qs.get("tour"),
  bursty: qs.get("bursty") === "1",
  auto: qs.get("auto") === "1",
  burstAt: qs.has("burstAt") ? num("burstAt", -1) : -1,
  profile: qs.get("profile"),
  step: qs.has("step") ? num("step", 0) : null,
  routing: qs.get("routing"),
  growth: qs.has("growth") ? num("growth", 25) : null,
};

document.documentElement.dataset.theme = params.theme;
if (params.record) document.body.classList.add("record");

const stage = document.getElementById("stage");
const sceneHost = document.getElementById("scene");
const elNo = document.getElementById("sceneNo");
const elTitle = document.getElementById("sceneTitle");
const elKeys = document.getElementById("keys");
const elDisc = document.getElementById("disclaimer");

// ---------- масштаб холста ----------
function fit() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const s = Math.min(w / 1920, h / 1080);
  stage.style.transform = `translate(${(w - 1920 * s) / 2}px, ${(h - 1080 * s) / 2}px) scale(${s})`;
}
window.addEventListener("resize", fit);
fit();

// ---------- состояние ----------
export const clock = { t: 0, frame: 0 };
let view = null; // { kind, key, inst, meta }
let paused = false;
let elapsed = 0;

const DISCLAIMERS = {
  model: DISCLAIMER,
  illustrative: DISCLAIMER_ILLUSTRATIVE,
  mechanism: DISCLAIMER_MECHANISM,
};

function ctxFor() {
  return {
    host: sceneHost,
    params,
    seed: params.seed,
    record: params.record,
    clock,
    setDisclaimer(kindOrText) {
      elDisc.textContent = DISCLAIMERS[kindOrText] || kindOrText;
    },
    goScene,
    goCase,
    goGallery,
  };
}

function setKeys(text) {
  elKeys.innerHTML = text;
}
const KEYS_SCENE =
  "<b>←</b><b>→</b> сцены &nbsp; <b>1</b><b>2</b><b>3</b> режим &nbsp; <b>пробел</b> пауза &nbsp; <b>R</b> заново &nbsp; <b>G</b> кейсы";
const KEYS_CASE =
  "<b>←</b><b>→</b> кейсы &nbsp; <b>пробел</b> пауза &nbsp; <b>R</b> заново &nbsp; <b>G</b> галерея &nbsp; <b>S</b> сцены";

async function mount(kind, key) {
  if (view) {
    view.inst.destroy?.();
    sceneHost.replaceChildren();
    view = null;
  }
  clock.t = 0;
  clock.frame = 0;
  elapsed = 0;
  paused = false;
  elDisc.textContent = DISCLAIMER;
  let mod;
  let inst;
  const ctx = ctxFor();
  try {
    if (kind === "scene") {
      mod = await import(`./scenes/scene${key}.js`);
      elNo.textContent = `Сцена ${mod.meta.no}`;
      elTitle.textContent = mod.meta.title;
      setKeys(mod.meta.keys || KEYS_SCENE);
      ctx.setDisclaimer(mod.meta.disclaimer || "model");
      inst = await mod.create(ctx);
    } else if (kind === "gallery") {
      mod = await import("./cases-ui.js");
      elNo.textContent = "Кейсы";
      elTitle.textContent = "Один продукт — разный результат у разных клиентов";
      setKeys(KEYS_CASE);
      ctx.setDisclaimer("model");
      inst = await mod.createGallery(ctx);
    } else {
      mod = await import("./cases-ui.js");
      const info = mod.caseInfo(key);
      elNo.textContent = `Кейс ${info.code} · ${info.groupLabel}`;
      elTitle.textContent = info.title;
      setKeys(KEYS_CASE);
      ctx.setDisclaimer("model");
      inst = await mod.createCase(ctx, key);
    }
  } catch (err) {
    console.error(err);
    sceneHost.innerHTML = `<pre style="padding:40px;font:14px monospace;color:#8c6b55">${String(err.stack || err)}</pre>`;
    inst = { step() {}, render() {}, destroy() {} };
  }
  view = { kind, key, inst, mod };
  inst.render?.();
  syncUrl();
}

function syncUrl() {
  if (params.record) return;
  const u = new URL(location.href);
  u.searchParams.delete("scene");
  u.searchParams.delete("case");
  u.searchParams.delete("gallery");
  if (view.kind === "scene") u.searchParams.set("scene", view.key);
  else if (view.kind === "case") u.searchParams.set("case", view.key);
  else u.searchParams.set("case", "gallery");
  history.replaceState(null, "", u);
}

export function goScene(no) {
  return mount("scene", no);
}
export function goCase(id) {
  return mount("case", id);
}
export function goGallery() {
  return mount("gallery", "gallery");
}

function navigate(dir) {
  if (view.kind === "scene") {
    const i = SCENE_ORDER.indexOf(Number(view.key));
    const j = (i + dir + SCENE_ORDER.length) % SCENE_ORDER.length;
    goScene(SCENE_ORDER[j]);
  } else if (view.mod.navigate) {
    view.mod.navigate({ kind: view.kind, key: view.key, params }, dir, { goCase, goGallery });
  }
}

// ---------- шаг и отрисовка ----------
function stepOnce() {
  clock.t += DT;
  clock.frame++;
  view.inst.step?.();
}
function stepMany(n) {
  for (let i = 0; i < n; i++) stepOnce();
  view.inst.render?.();
  elapsed += n * DT;
}
window.__step = (n = 1) => stepMany(n);
window.__time = () => clock.t;
window.__go = { goScene, goCase, goGallery }; // для отладки и тестов

let last = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const real = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!view || paused) return;
  elapsed += real;
  let steps = 0;
  while (elapsed >= DT && steps < 8) {
    elapsed -= DT;
    stepOnce();
    steps++;
  }
  view.inst.render?.();
}

// ---------- клавиатура ----------
window.addEventListener("keydown", (e) => {
  if (params.record || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName) && e.key !== "Escape") {
    if (e.key === " ") e.target.blur();
    else return;
  }
  const k = e.key;
  if (view.inst.key?.(e) === true) {
    e.preventDefault();
    return;
  }
  if (k === "ArrowRight") navigate(1);
  else if (k === "ArrowLeft") navigate(-1);
  else if (k === " ") {
    paused = !paused;
    e.preventDefault();
  } else if (k === "r" || k === "R" || k === "к" || k === "К") {
    mount(view.kind, view.key);
  } else if (k === "g" || k === "G" || k === "п" || k === "П") goGallery();
  else if (k === "s" || k === "S" || k === "ы" || k === "Ы") goScene(SCENE_ORDER[0]);
});

// ---------- запуск ----------
async function boot() {
  const fams = ["Arimo", "Tinos", "Inter", "JetBrains Mono"];
  try {
    await Promise.all(
      fams.flatMap((f) => ["400", "700"].map((w) => document.fonts.load(`${w} 16px "${f}"`, "Абвгд abc 123 ₽ →")))
    );
    await document.fonts.ready;
  } catch (_) {
    /* шрифты не критичны */
  }
  if (params.case === "gallery") await goGallery();
  else if (params.case) await goCase(params.case);
  else if (params.tour && !qs.has("scene")) {
    const { TOURS } = await import("./cases.js");
    await goCase((TOURS[params.tour] || TOURS.short)[0]);
  }
  else await goScene(SCENE_ORDER.includes(params.scene) ? params.scene : 1);

  if (params.record) {
    window.__duration = params.duration;
    window.__ready = true;
    return; // кадры двигает record.mjs через __step(n)
  }
  window.__ready = true;
  requestAnimationFrame(loop);
}
boot();
