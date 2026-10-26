// MemoryBar (кейс A2) — память одной H200 (141 ГБ): веса | служебное | KV-кэш, внутри KV —
// «слоты» длинных сессий. Две полосы: «BF16 веса + BF16 кэш» и «FP8 веса + KV8 кэш».
// ИЛЛЮСТРАЦИЯ: параметры ниже — допущения демо и подписаны на экране; множителя «×N» нет, только слоты.
import { el, clamp, smooth, themeColors, rgb } from "../lib/util.js";
import { fmtNum, fmtInt } from "../lib/format.js";

const GPU_GB = 141;
const OVERHEAD_GB = 12;
const SESSION_TOKENS = 64000;
const KV_MB_PER_TOKEN_BF16 = 0.12; // [ДОПУЩЕНИЕ ДЕМО] для модели класса 35B
const MODEL_BF16_GB = 70;

const VARIANTS = [
  { label: "BF16 веса, BF16 кэш", weights: MODEL_BF16_GB, kvScale: 1 },
  { label: "FP8 веса, KV8 кэш", weights: MODEL_BF16_GB / 2, kvScale: 0.5 },
];

export function memoryLayout(v) {
  const slotGb = (SESSION_TOKENS * KV_MB_PER_TOKEN_BF16 * v.kvScale) / 1000;
  const kvGb = GPU_GB - v.weights - OVERHEAD_GB;
  return { slotGb, kvGb, slots: Math.floor(kvGb / slotGb) };
}

export class MemoryBar {
  constructor(host) {
    this.t = 0;
    this.root = el("div", "mb");
    this.cv = el("canvas", "mb-cv");
    this.cv.width = 2000;
    this.cv.height = 520;
    this.note = el("div", "mb-note");
    this.note.innerHTML = `Параметры условны и подписаны: H200 ${GPU_GB} ГБ · модель класса 35B (веса BF16 ${MODEL_BF16_GB} ГБ) · сессия ${fmtInt(SESSION_TOKENS / 1000)}k токенов · KV на токен в BF16 ≈ ${fmtNum(KV_MB_PER_TOKEN_BF16, 2)} МБ. Слоты — не пропускная способность: дальше всё упирается в вычисления.`;
    this.root.append(this.cv, this.note);
    host.append(this.root);
    this.C = themeColors(this.root);
  }

  step(dt = 1 / 60) {
    this.t += dt;
  }

  render() {
    const g = this.cv.getContext("2d");
    const W = this.cv.width;
    const C = this.C;
    g.clearRect(0, 0, W, this.cv.height);
    const x0 = 40;
    const x1 = W - 40;
    const X = (gb) => x0 + (gb / GPU_GB) * (x1 - x0);
    VARIANTS.forEach((v, i) => {
      const L = memoryLayout(v);
      const y = 70 + i * 230;
      const appear = smooth((this.t - 0.3 - i * 1.4) / 0.8);
      if (appear <= 0) return;
      g.globalAlpha = appear;
      g.fillStyle = rgb(C.ink);
      g.font = "bold 32px Arimo, sans-serif";
      g.textAlign = "left";
      g.fillText(v.label, x0, y - 22);
      const h = 96;
      // веса (во второй полосе «сжимаются» до половины)
      const wNow = i === 1 ? v.weights + (MODEL_BF16_GB - v.weights) * (1 - smooth((this.t - 1.9) / 1.0)) : v.weights;
      g.fillStyle = rgb(C.ink2);
      g.fillRect(X(0), y, X(wNow) - X(0), h);
      g.fillStyle = rgb(C.surface);
      g.font = "bold 26px Arimo, sans-serif";
      g.fillText(`веса ${fmtInt(wNow)} ГБ`, x0 + 14, y + 58);
      // служебное
      g.fillStyle = rgb(C.muted);
      g.fillRect(X(wNow), y, X(wNow + OVERHEAD_GB) - X(wNow), h);
      // KV-область со слотами
      const kvStart = wNow + OVERHEAD_GB;
      g.fillStyle = rgb(C.line);
      g.fillRect(X(kvStart), y, X(GPU_GB) - X(kvStart), h);
      const slotsNow = Math.floor((GPU_GB - kvStart) / L.slotGb + 1e-9);
      const grow = i === 1 ? smooth((this.t - 2.4) / 1.4) : 1;
      const shown = Math.floor(slotsNow * grow);
      for (let s = 0; s < shown; s++) {
        const sx = X(kvStart + s * L.slotGb);
        const sw = X(kvStart + (s + 1) * L.slotGb) - sx;
        g.fillStyle = rgb(C.ours, 0.85);
        g.fillRect(sx + 3, y + 8, sw - 6, h - 16);
      }
      g.fillStyle = rgb(C.ink);
      g.font = "bold 34px Arimo, sans-serif";
      g.textAlign = "left";
      g.fillText(
        `${shown} ${shown % 10 === 1 && shown % 100 !== 11 ? "сессия" : shown % 10 > 1 && shown % 10 < 5 && (shown % 100 < 10 || shown % 100 > 20) ? "сессии" : "сессий"} по ${fmtInt(SESSION_TOKENS / 1000)}k токенов`,
        X(kvStart),
        y + h + 48
      );
      g.fillStyle = rgb(C.ink2);
      g.font = "24px Arimo, sans-serif";
      g.fillText(`сессия ≈ ${fmtNum(L.slotGb, 1)} ГБ KV`, X(kvStart), y + h + 82);
      g.globalAlpha = 1;
    });
  }

  destroy() {
    this.root.remove();
  }
}
