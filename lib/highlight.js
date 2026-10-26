// Простая подсветка Python: ключевые слова, строки, комментарии, числа.
// Без библиотек; вывод — HTML со span-классами (цвета в style.css).
const KEYWORDS = new Set(
  (
    "and as assert async await break class continue def del elif else except finally for from " +
    "global if import in is lambda nonlocal not or pass raise return try while with yield"
  ).split(" ")
);
const CONSTS = new Set(["True", "False", "None", "self", "cls"]);
const BUILTINS = new Set(
  "print len range dict list set tuple str int float bool isinstance enumerate zip sorted sum min max open any all map filter".split(
    " "
  )
);

const TOKEN =
  /(#[^\n]*)|("""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)|[rbfRBF]{0,2}"(?:[^"\\\n]|\\.)*(?:"|$)|[rbfRBF]{0,2}'(?:[^'\\\n]|\\.)*(?:'|$))|(\b\d[\d_]*(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_]*)|(@[A-Za-z_][\w.]*)/g;

export function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function highlightPython(code) {
  let out = "";
  let last = 0;
  let prevWord = "";
  TOKEN.lastIndex = 0;
  let m;
  while ((m = TOKEN.exec(code))) {
    if (m.index > last) out += esc(code.slice(last, m.index));
    const [full, comment, str, num, word, deco] = m;
    if (comment) out += `<span class="hl-c">${esc(full)}</span>`;
    else if (str) out += `<span class="hl-s">${esc(full)}</span>`;
    else if (num) out += `<span class="hl-n">${esc(full)}</span>`;
    else if (deco) out += `<span class="hl-d">${esc(full)}</span>`;
    else if (word) {
      if (KEYWORDS.has(word)) out += `<span class="hl-k">${word}</span>`;
      else if (CONSTS.has(word)) out += `<span class="hl-b">${word}</span>`;
      else if (prevWord === "def" || prevWord === "class") out += `<span class="hl-f">${word}</span>`;
      else if (BUILTINS.has(word)) out += `<span class="hl-b">${word}</span>`;
      else out += word;
      prevWord = word;
    }
    last = m.index + full.length;
    if (!word) prevWord = "";
  }
  if (last < code.length) out += esc(code.slice(last));
  return out;
}
