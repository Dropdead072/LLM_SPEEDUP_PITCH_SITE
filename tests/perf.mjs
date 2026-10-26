// Грубая оценка производительности: сколько мс занимает шаг симуляции + отрисовка кадра.
//   node tests/perf.mjs [scene...]    (по умолчанию 1 и 7)
// Headless Chromium рисует программно (без GPU), поэтому цифры — верхняя оценка.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { chromium } = await import("playwright");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2" };
const srv = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const f = path.join(ROOT, p === "/" ? "index.html" : p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return res.writeHead(404).end();
  res.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${srv.address().port}`;
const scenes = process.argv.slice(2).length ? process.argv.slice(2) : ["1", "7"];

const browser = await chromium.launch();
for (const s of scenes) {
  const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  await page.goto(`${base}/?scene=${s}&record=1&seed=42`);
  await page.waitForFunction("window.__ready === true");
  const r = await page.evaluate(async () => {
    const ms = [];
    for (let i = 0; i < 300; i++) {
      const t0 = performance.now();
      window.__step(1); // один шаг симуляции + одна отрисовка
      ms.push(performance.now() - t0);
    }
    ms.sort((a, b) => a - b);
    return { median: ms[150], p95: ms[285], max: ms[299] };
  });
  console.log(`сцена ${s}: шаг+кадр медиана ${r.median.toFixed(2)} мс, p95 ${r.p95.toFixed(2)} мс, max ${r.max.toFixed(2)} мс (бюджет 16,7 мс)`);
}
await browser.close();
srv.close();
