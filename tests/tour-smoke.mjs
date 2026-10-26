// Дымовая проверка маршрутов ?tour=short|full|qa: проходим клавишей → до конца, ошибок быть не должно.
//   node tests/tour-smoke.mjs
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

const browser = await chromium.launch();
const errors = [];
for (const tour of ["short", "full", "qa"]) {
  const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  page.on("pageerror", (e) => errors.push(`${tour}: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`${tour}: ${m.text()}`));
  await page.goto(`${base}/?tour=${tour}`);
  await page.waitForFunction("window.__ready === true");
  const seen = [];
  for (let i = 0; i < 20; i++) {
    seen.push((await page.textContent("#sceneNo")) + " · " + (await page.textContent("#sceneTitle")));
    await page.waitForTimeout(150);
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(250);
  }
  const uniq = [...new Set(seen)];
  console.log(`tour=${tour}: уникальных экранов за 20 переходов — ${uniq.length}`);
  console.log("  " + uniq.join("\n  "));
  await page.close();
}
await browser.close();
srv.close();
console.log(errors.length ? "ОШИБКИ:\n" + errors.join("\n") : "ошибок нет");
