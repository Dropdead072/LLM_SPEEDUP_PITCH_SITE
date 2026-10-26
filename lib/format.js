// Русское форматирование чисел: пробел между разрядами (неразрывный),
// запятая в дробях, «млн ₽». Собственная реализация — не зависит от ICU.
const NBSP = " ";

function group(intStr) {
  return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}

export function fmtNum(n, digits = 0) {
  if (!Number.isFinite(n)) return "—";
  const neg = n < 0;
  const fixed = Math.abs(n).toFixed(digits);
  const [i, f] = fixed.split(".");
  const out = group(i) + (f ? "," + f : "");
  return (neg && Number(fixed) !== 0 ? "−" : "") + out;
}

export const fmtInt = (n) => fmtNum(Math.round(n), 0);

export function fmtPct(fraction, digits = 0) {
  return fmtNum(fraction * 100, digits) + NBSP + "%";
}

export function fmtSigned(n, digits = 0, suffix = "") {
  const s = fmtNum(Math.abs(n), digits);
  return (n >= 0 ? "+" : "−") + s + suffix;
}

export function fmtMult(g, digits = 2) {
  return fmtNum(g, digits) + "×";
}

// Рубли -> «45,8 млн ₽»; округление «половина вверх» без плавающих сюрпризов.
export function fmtMln(rub, digits = 1) {
  const m = Math.round((rub / 1e6 + 1e-9) * 10 ** digits) / 10 ** digits;
  return fmtNum(m, digits) + NBSP + "млн" + NBSP + "₽";
}

export function fmtRub(rub) {
  return fmtInt(rub) + NBSP + "₽";
}

export function fmtSec(s, digits = 1) {
  return fmtNum(s, digits) + NBSP + "с";
}

export function fmtMs(s) {
  return fmtInt(s * 1000) + NBSP + "мс";
}

export function clock(sec) {
  const h = Math.floor(sec / 3600) % 24;
  const m = Math.floor((sec % 3600) / 60);
  return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
}
