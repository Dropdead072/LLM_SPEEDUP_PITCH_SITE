export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
};
export const easeOut = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);

export function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}

export function percentile(sortedOrRaw, p) {
  if (!sortedOrRaw.length) return 0;
  const a = [...sortedOrRaw].sort((x, y) => x - y);
  const idx = (a.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return a[lo] + (a[hi] - a[lo]) * (idx - lo);
}

// Круговой буфер скользящей суммы по фиксированному числу шагов.
export class WindowSum {
  constructor(n) {
    this.buf = new Float64Array(n);
    this.i = 0;
    this.sum = 0;
    this.n = n;
    this.filled = 0;
  }
  push(v) {
    this.sum += v - this.buf[this.i];
    this.buf[this.i] = v;
    this.i = (this.i + 1) % this.n;
    if (this.filled < this.n) this.filled++;
  }
}

// ---- цвета: разбор #rrggbb / rgb() и смешивание (для Canvas, где нет var()) ----
export function parseColor(c) {
  c = String(c).trim();
  let m = /^#([0-9a-f]{6})$/i.exec(c);
  if (m) return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)];
  m = /^#([0-9a-f]{3})$/i.exec(c);
  if (m) return [...m[1]].map((h) => parseInt(h + h, 16));
  m = /rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/.exec(c);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  return [0, 0, 0];
}
export const mixColor = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const rgb = (c, a = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;
export function themeColors(node) {
  const cs = getComputedStyle(node);
  const g = (n) => parseColor(cs.getPropertyValue(n));
  return {
    bg: g("--bg"), surface: g("--surface"), ink: g("--ink"), ink2: g("--ink-2"),
    line: g("--line"), line2: g("--line-2"), muted: g("--muted"), ours: g("--ours"), baseline: g("--baseline"),
  };
}
