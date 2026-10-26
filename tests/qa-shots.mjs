// Скриншоты всех сцен и кейсов для визуальной проверки + сбор ошибок консоли и внешних запросов.
//   node tests/qa-shots.mjs <outDir> [theme]
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = process.argv[2];
const theme = process.argv[3] || "investor";
fs.mkdirSync(out, { recursive: true });
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

const targets = [
  ...[1, 2, 3, 4, 5, 7, 8, 9, 10].map((n) => ({ name: `s${n}`, q: `scene=${n}`, secs: [6] })),
  { name: "gallery", q: "case=gallery", secs: [1] },
  ...["a0", "a1", "a2", "a3", "a4", "b1", "b2", "b3", "b4", "c1", "c2", "c3", "c4"].map((c) => ({ name: c, q: `case=${c}`, secs: [8] })),
];
const only = process.argv[4] ? process.argv[4].split(",") : null;

const browser = await chromium.launch();
const problems = [];
for (const t of targets) {
  if (only && !only.includes(t.name)) continue;
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => problems.push(`${t.name}: pageerror ${e.message}`));
  page.on("console", (m) => m.type() === "error" && problems.push(`${t.name}: console ${m.text()}`));
  page.on("request", (r) => !r.url().startsWith(base) && !r.url().startsWith("data:") && problems.push(`${t.name}: EXTERNAL ${r.url()}`));
  await page.goto(`${base}/?${t.q}&record=1&theme=${theme}&seed=42`);
  await page.waitForFunction("window.__ready === true");
  for (const s of t.secs) {
    await page.evaluate((n) => window.__step(n), s * 60);
    await page.screenshot({ path: path.join(out, `${t.name}.png`) });
  }
  await ctx.close();
}
await browser.close();
srv.close();
console.log(problems.length ? problems.join("\n") : "нет ошибок консоли и внешних запросов");
