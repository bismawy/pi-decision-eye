// Pure Arnative rounded-box chrome and ANSI column maths (zero pi-tui imports so node --test runs offline).

export interface BoxTheme {
  fg(color: string, text: string): string;
  style?(text: string, options: { fg: unknown }): string;
  bold?(text: string): string;
  colors?: Record<string, { kind?: string; c?: number; h?: number }>;
}

const SOFT_L = 0.9;
const SOFT_CHROMA_SCALE = 0.35;
const ANSI_ESCAPE = /\x1b(?:\[[0-9;:?]*[A-Za-z]|\][^\x07\x1b]*(?:\x07|\x1b\\)|_pi:c\x07|[@-Z\\-_])/g;

export function thinkingColorSlot(level: string | undefined): string {
  switch ((level ?? "off").toLowerCase()) {
    case "minimal":
      return "thinkingMinimal";
    case "low":
      return "thinkingLow";
    case "medium":
      return "thinkingMedium";
    case "high":
      return "thinkingHigh";
    case "xhigh":
      return "thinkingXhigh";
    case "max":
      return "thinkingMax";
    default:
      return "thinkingOff";
  }
}

function probeToken(fg: (color: string, text: string) => string, tokens: string[]): string | undefined {
  return tokens.find((token) => {
    try {
      fg(token, "");
      return true;
    } catch {
      return false;
    }
  });
}

function derivedSoftPainter(theme: BoxTheme | null | undefined, baseToken: string): ((text: string) => string) | undefined {
  const base = theme?.colors?.[baseToken];
  const style = theme?.style?.bind(theme);
  if (base?.kind !== "oklch" || !style) return undefined;
  const fg = { kind: "oklch", l: SOFT_L, c: (base.c ?? 0) * SOFT_CHROMA_SCALE, h: base.h ?? 0 };
  return (text: string) => style(text, { fg });
}

export function borderPainter(theme: BoxTheme | null | undefined, thinkingLevel?: string): (text: string) => string {
  const fg = theme?.fg?.bind(theme);
  if (!fg) return (t) => t;
  const slot = thinkingColorSlot(thinkingLevel);
  try {
    fg(slot, "");
    return (t) => fg(slot, t);
  } catch {
    return (t) => fg("dim", t);
  }
}

export function chosenRowPainter(theme: BoxTheme | null | undefined): (text: string) => string {
  const fg = theme?.fg?.bind(theme);
  const bold = theme?.bold?.bind(theme) ?? ((t: string) => t);
  if (!fg) return bold;
  const direct = probeToken(fg, ["accentSoft"]);
  const paint = direct
    ? (t: string) => fg(direct, t)
    : derivedSoftPainter(theme, "accent") ??
      (() => {
        const fallback = probeToken(fg, ["thinkingText", "accent"]);
        return fallback ? (t: string) => fg(fallback, t) : (t: string) => t;
      })();
  return (text: string) => paint(bold(text));
}

function charWidth(ch: string): number {
  const code = ch.codePointAt(0) ?? 0;
  if (
    code >= 0x1100 &&
    (code <= 0x115f ||
      code === 0x2329 ||
      code === 0x232a ||
      (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x1f300 && code <= 0x1f64f) ||
      (code >= 0x20000 && code <= 0x3fffd))
  ) {
    return 2;
  }
  return 1;
}

export function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE, "");
}

export function visibleWidth(text: string): number {
  let width = 0;
  for (const ch of stripAnsi(text)) width += charWidth(ch);
  return width;
}

/** ANSI-safe truncation to terminal columns; preserves escape codes and appends reset when clipped. */
export function truncateWidth(text: string, maxWidth: number, ellipsis = "…"): string {
  if (maxWidth <= 0) return "";
  if (visibleWidth(text) <= maxWidth) return text;
  const eWidth = visibleWidth(ellipsis);
  const budget = Math.max(0, maxWidth - eWidth);
  const re = new RegExp(ANSI_ESCAPE.source, "g");
  let out = "";
  let cols = 0;
  let lastIndex = 0;
  let hasAnsi = false;

  const pushPlain = (segment: string): boolean => {
    for (const ch of segment) {
      const w = charWidth(ch);
      if (cols + w > budget) return false;
      out += ch;
      cols += w;
    }
    return true;
  };

  for (const match of text.matchAll(re)) {
    const idx = match.index ?? 0;
    if (!pushPlain(text.slice(lastIndex, idx))) {
      return `${out}${hasAnsi ? "\x1b[0m" : ""}${maxWidth >= eWidth ? ellipsis : ""}`;
    }
    out += match[0];
    hasAnsi = true;
    lastIndex = idx + match[0].length;
  }
  pushPlain(text.slice(lastIndex));
  return `${out}${hasAnsi ? "\x1b[0m" : ""}${maxWidth >= eWidth ? ellipsis : ""}`;
}

export function boxEdge(left: string, right: string, width: number, paint: (t: string) => string = (t) => t): string {
  return paint(`${left}${"─".repeat(Math.max(0, width - 2))}${right}`);
}

export function boxRow(content: string, width: number, paint: (t: string) => string = (t) => t): string {
  if (width < 4) return "";
  const pad = Math.max(0, width - visibleWidth(content) - 3);
  return `${paint("│")} ${content}${" ".repeat(pad)}${paint("│")}`;
}

export function framedRows(rows: string[], width: number, paint: (t: string) => string = (t) => t): string[] {
  const inner = Math.max(0, width - 4);
  const flat = rows.flatMap((line) => String(line).split("\n")).map((line) => truncateWidth(line, inner));
  return [boxEdge("╭", "╮", width, paint), ...flat.map((row) => boxRow(row, width, paint)), boxEdge("╰", "╯", width, paint)];
}

export function wrapWords(text: string, width: number): string[] {
  const limit = Math.max(1, width);
  const rows: string[] = [];
  for (const paragraph of String(text).split("\n")) {
    let row = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = row ? `${row} ${word}` : word;
      if (row && visibleWidth(next) > limit) {
        rows.push(row);
        row = word;
      } else {
        row = next;
      }
    }
    rows.push(row);
  }
  return rows;
}

export function packPairs(pairs: string[], width: number): string[] {
  const limit = Math.max(1, width);
  const rows: string[] = [];
  let row = "";
  for (const pair of pairs) {
    const next = row ? `${row}  ${pair}` : pair;
    if (row && visibleWidth(next) > limit) {
      rows.push(row);
      row = pair;
    } else {
      row = next;
    }
  }
  if (row) rows.push(row);
  return rows;
}

export function padColumn(text: string, width: number, align: "left" | "right" = "left"): string {
  const clipped = visibleWidth(text) > width ? truncateWidth(text, width) : text;
  const pad = " ".repeat(Math.max(0, width - visibleWidth(clipped)));
  return align === "right" ? `${pad}${clipped}` : `${clipped}${pad}`;
}

/** Fuzzy subsequence match ignoring whitespace (arnative-pi filter rule). */
export function fuzzyMatch(query: string, haystack: string): boolean {
  const q = query.toLowerCase().replace(/\s+/g, "");
  if (!q) return true;
  const h = haystack.toLowerCase();
  let at = 0;
  for (const ch of h) {
    if (ch === q[at]) at++;
    if (at === q.length) return true;
  }
  return false;
}
