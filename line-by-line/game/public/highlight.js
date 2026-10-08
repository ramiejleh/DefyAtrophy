/* Syntax highlighting through CodeMirror's runMode, so read/type views and the learn editor share one theme. */

const MODES = {
  typescript: { name: "javascript", typescript: true },
  javascript: "javascript",
  json: { name: "javascript", json: true },
  python: "python",
  go: "go",
  rust: "rust",
  c: "text/x-csrc",
  cpp: "text/x-c++src",
  java: "text/x-java",
  csharp: "text/x-csharp",
  kotlin: "text/x-kotlin",
  scala: "text/x-scala",
  swift: "text/x-csrc",
  css: "css",
  scss: "text/x-scss",
  less: "text/x-less",
  html: "htmlmixed",
  xml: "xml",
  yaml: "yaml",
  markdown: "markdown",
  shell: "shell",
  makefile: "shell",
  sql: "text/x-sql",
  ruby: "ruby",
};

export const modeFor = (language) => MODES[language] ?? "text/plain";

/**
 * Highlights consecutive lines as one document, so multi-line strings and comments come out right.
 * Returns, for each line, an array with one CSS class string per character.
 * @param {string[]} lines
 */
export function highlightLines(lines, language) {
  const out = lines.map((l) => new Array(l.length).fill(""));
  const mode = MODES[language];
  if (!mode || !window.CodeMirror?.runMode) return out;
  let line = 0;
  let col = 0;
  try {
    window.CodeMirror.runMode(lines.join("\n"), mode, (text, style) => {
      if (text === "\n") {
        line++;
        col = 0;
        return;
      }
      const cls = style ? style.split(" ").map((s) => `cm-${s}`).join(" ") : "";
      for (let i = 0; i < text.length; i++) if (out[line]) out[line][col + i] = cls;
      col += text.length;
    });
  } catch {}
  return out;
}

const escHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Renders `text` (a slice of a line starting at `from`) as spans grouped by class. */
export function spans(text, classes, from = 0) {
  let html = "";
  let i = 0;
  while (i < text.length) {
    let j = i + 1;
    while (j < text.length && classes[from + j] === classes[from + i]) j++;
    const cls = classes[from + i];
    const chunk = escHtml(text.slice(i, j));
    html += cls ? `<span class="${cls}">${chunk}</span>` : chunk;
    i = j;
  }
  return html;
}
