#!/usr/bin/env node
// Запись роликов для слайдов (mp4, по флагу — gif). Покадровая и детерминированная:
//   страница открывается с ?record=1 (виртуальное время), скрипт сам двигает симуляцию
//   window.__step(n) и снимает скриншот после каждого кадра — ролик не зависит от
//   производительности машины, а один и тот же сид даёт визуально идентичные ролики.
//
//   npm i playwright            # один раз; затем: npx playwright install chromium
//   node record.mjs --list                          # список готовых роликов
//   node record.mjs clip_hint_split                 # один ролик из списка
//   node record.mjs --all                           # все ролики
//   node record.mjs --url "scene=1&mode=chat&load=0.7&seed=42&duration=12" --name my_clip
//   node record.mjs clip_mixer --gif                # дополнительно gif (палитра, 1280 px)
//   node record.mjs --check clip_ghost_late          # записать дважды и сравнить кадры побайтно
//
// Нужен ffmpeg в PATH (если его нет, PNG-кадры остаются в clips/<имя>/frames/).
// Разрешение 2560×1440 = логический холст 1920×1080 × deviceScaleFactor 4/3.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(ROOT, "clips");

// Все ролики пишутся в теме по умолчанию (investor). Названия — из брифов.
const COMMON = "seed=42&record=1";
export const CLIPS = {
  // исходный бриф §7
  clip_hint_split: { q: `scene=1&mode=hint&load=0.7&burstAt=5&${COMMON}&duration=12`, d: 12, note: "слайд «Токенов в секунду на одну GPU»" },
  clip_ghost_late: { q: `scene=2&load=0.7&${COMMON}&duration=12`, d: 12, note: "подсказка, которая опоздала" },
  clip_mixer: { q: `scene=4&${COMMON}&duration=13`, d: 13, note: "слайд «Универсального решения нет»" },
  clip_agent_split: { q: `scene=3&${COMMON}&duration=12`, d: 12, note: "резервный R1: почему на агентах 1,4×" },
  // доп. ТЗ §7 (clip_800_cards заменён сценой «Одна нода»)
  inv_goodput: { q: `scene=1&mode=hint&load=0.7&bursty=1&burstAt=4&${COMMON}&duration=14`, d: 14, note: "слайд 6: полезные токены vs сырые, всплеск" },
  inv_one_node: { q: `scene=5&${COMMON}&duration=13`, d: 13, note: "слайд 7: +25 % возвращает одну ноду" },
  inv_cache_routing: { q: `scene=8&${COMMON}&duration=16`, d: 16, note: "слайд 8: политика маршрутизации (кэш)" },
  inv_27648: { q: `scene=7&${COMMON}&duration=17`, d: 17, note: "слайды 9–10: 27 648 → одна, затем смена профиля" },
  inv_acceptance: { q: `scene=9&${COMMON}&duration=11`, d: 11, note: "слайд 11: отчёт приёмки" },
  inv_partner: { q: `scene=10&${COMMON}&duration=13`, d: 13, note: "слайд 17: один design partner" },
  // demo_cases.md §6
  case_same_fleet: { q: `case=a0&${COMMON}&duration=9`, d: 9, note: "слайд 8: один парк — три результата" },
  case_defer_node: { q: `case=b1&${COMMON}&duration=8`, d: 8, note: "слайд 7: отсрочка закупки ноды" },
  case_new_model: { q: `case=b4&${COMMON}&duration=9`, d: 9, note: "слайд 15: quarterly profile" },
  case_noisy_neighbor: { q: `case=c3&${COMMON}&duration=16`, d: 16, note: "слайд 14: шумный сосед" },
};

// ---------- аргументы ----------
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : d;
};
const FPS = Number(opt("--fps", 30));
const STEPS_PER_FRAME = 60 / FPS; // симуляция идёт строго 60 Гц
if (!Number.isInteger(STEPS_PER_FRAME)) throw new Error("--fps должен делить 60 нацело (30, 20, 15, 60)");

if (flag("--list")) {
  for (const [k, v] of Object.entries(CLIPS)) console.log(k.padEnd(22), `${v.d} с`.padEnd(6), v.note);
  process.exit(0);
}

// ---------- статический сервер (без python, без сети) ----------
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".woff2": "font/woff2", ".json": "application/json" };
function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
      const file = path.join(ROOT, p === "/" ? "index.html" : p);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404).end("not found");
        return;
      }
      res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(0, "127.0.0.1", () => resolve({ srv, base: `http://127.0.0.1:${srv.address().port}` }));
  });
}

const hasFfmpeg = () => spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
function ffmpeg(argv) {
  return new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", ["-y", "-loglevel", "error", ...argv], { stdio: "inherit" });
    p.on("exit", (c) => (c === 0 ? resolve() : reject(new Error("ffmpeg exit " + c))));
  });
}

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    console.error("Не найден пакет playwright. Установите: npm i playwright && npx playwright install chromium");
    process.exit(2);
  }
}

// ---------- запись одного ролика ----------
async function record(browser, base, name, query, duration, { keepFrames = false, hashOnly = false } = {}) {
  const dir = path.join(OUT, name);
  const frames = path.join(dir, "frames");
  fs.rmSync(frames, { recursive: true, force: true });
  fs.mkdirSync(frames, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 4 / 3 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.error("  [page error]", e.message));
  await page.goto(`${base}/?${query.includes("record=1") ? query : query + "&record=1"}`);
  await page.waitForFunction("window.__ready === true", null, { timeout: 30000 });
  const total = Math.round(duration * FPS);
  const hashes = [];
  for (let i = 0; i < total; i++) {
    // кадр 0 — состояние на t=0 (только отрисовка), дальше — по STEPS_PER_FRAME шагов симуляции
    await page.evaluate((n) => window.__step(n), i === 0 ? 0 : STEPS_PER_FRAME);
    const buf = await page.screenshot({ type: "png" });
    hashes.push(createHash("sha256").update(buf).digest("hex"));
    if (!hashOnly) fs.writeFileSync(path.join(frames, `${String(i).padStart(5, "0")}.png`), buf);
    if (i % FPS === 0) process.stdout.write(`\r  ${name}: ${i}/${total} кадров`);
  }
  process.stdout.write(`\r  ${name}: ${total}/${total} кадров\n`);
  await ctx.close();
  if (hashOnly) return hashes;
  if (hasFfmpeg()) {
    const mp4 = path.join(dir, `${name}.mp4`);
    await ffmpeg(["-framerate", String(FPS), "-i", path.join(frames, "%05d.png"), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "16", "-movflags", "+faststart", mp4]);
    console.log("  →", path.relative(ROOT, mp4));
    if (flag("--gif")) {
      const pal = path.join(dir, "pal.png");
      const vf = `fps=${FPS},scale=1280:-1:flags=lanczos`;
      await ffmpeg(["-i", mp4, "-vf", `${vf},palettegen`, pal]);
      const gif = path.join(dir, `${name}.gif`);
      await ffmpeg(["-i", mp4, "-i", pal, "-lavfi", `${vf}[x];[x][1:v]paletteuse`, gif]);
      fs.rmSync(pal, { force: true });
      console.log("  →", path.relative(ROOT, gif));
    }
    if (!keepFrames && !flag("--keep-frames")) fs.rmSync(frames, { recursive: true, force: true });
  } else {
    // запасной путь без ffmpeg: PyAV + Pillow (pip install av pillow)
    const py = spawnSync("python", [path.join(ROOT, "encode.py"), frames, path.join(dir, name), "--fps", String(FPS), ...(flag("--gif") ? ["--gif"] : [])], { stdio: "inherit" });
    if (py.status === 0) {
      if (!keepFrames && !flag("--keep-frames")) fs.rmSync(frames, { recursive: true, force: true });
    } else console.warn("  ни ffmpeg, ни python-кодировщик не сработали — PNG-кадры оставлены в", path.relative(ROOT, frames));
  }
  return hashes;
}

// ---------- main ----------
const { chromium } = await loadPlaywright();
const { srv, base } = await serve();
const browser = await chromium.launch();
try {
  fs.mkdirSync(OUT, { recursive: true });
  const names = flag("--all") ? Object.keys(CLIPS) : args.filter((a) => CLIPS[a]);
  if (flag("--url")) {
    const q = opt("--url");
    const m = /duration=(\d+(?:\.\d+)?)/.exec(q);
    await record(browser, base, opt("--name", "custom"), q, m ? Number(m[1]) : 12);
  } else if (flag("--check")) {
    const name = names[0] || "clip_ghost_late";
    const c = CLIPS[name];
    const secs = Math.min(c.d, 4); // для проверки достаточно нескольких секунд
    const a = await record(browser, base, name + "_a", c.q, secs, { hashOnly: true });
    const b = await record(browser, base, name + "_b", c.q, secs, { hashOnly: true });
    const diff = a.findIndex((h, i) => h !== b[i]);
    if (diff < 0) console.log(`✓ детерминизм: ${a.length} кадров идентичны побайтно (${name}, ${secs} с)`);
    else {
      console.error(`✗ кадр ${diff} различается между двумя записями`);
      process.exitCode = 1;
    }
  } else {
    if (!names.length) {
      console.error("Укажите ролик (node record.mjs --list), --all или --url");
      process.exitCode = 2;
    }
    for (const n of names) await record(browser, base, n, CLIPS[n].q, CLIPS[n].d);
  }
} finally {
  await browser.close();
  srv.close();
}
