import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Lightweight peer-dep shim so render-check runs from any clean checkout without local node_modules
const PI_TUI_MOCK_URL = "pi-tui-mock://shim";
const PI_TUI_MOCK_SOURCE = `
export const CURSOR_MARKER = "";
export const Key = {
  up: "up",
  down: "down",
  left: "left",
  right: "right",
  enter: "enter",
  escape: "escape",
  tab: "tab",
  backspace: "backspace",
  home: "home",
  end: "end",
  space: "space",
  ctrl: (k) => "ctrl+" + k,
};
export function matchesKey(data, key) {
  const map = {
    up: "\\x1b[A",
    down: "\\x1b[B",
    right: "\\x1b[C",
    left: "\\x1b[D",
    enter: "\\r",
    escape: "\\x1b",
    tab: "\\t",
    backspace: "\\x7f",
    home: "\\x1b[H",
    end: "\\x1b[F",
    space: " ",
  };
  return data === map[key] || data === key;
}
export class Input {
  constructor(opts = {}) {
    this.opts = opts;
    this.value = "";
    this.focused = false;
  }
  getValue() { return this.value; }
  setValue(v) { this.value = String(v ?? ""); }
  handleInput(data) {
    if (data === "\\r") this.onSubmit?.(this.value);
    else if (data === "\\x1b") this.onEscape?.();
    else if (data === "\\x7f") this.value = this.value.slice(0, -1);
    else if (data && data.length === 1 && data >= " ") this.value += data;
  }
  render(width) {
    const prompt = this.opts.prompt ?? "";
    const text = this.value || (this.opts.placeholderStyle ? this.opts.placeholderStyle(this.opts.placeholder ?? "") : (this.opts.placeholder ?? ""));
    return [(prompt + text).slice(0, Math.max(1, width))];
  }
}
`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@earendil-works/pi-tui") {
      try {
        return nextResolve(specifier, context);
      } catch {
        return { url: PI_TUI_MOCK_URL, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === PI_TUI_MOCK_URL) {
      return { format: "module", source: PI_TUI_MOCK_SOURCE, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

const { visibleWidth, stripAnsi } = await import("../extensions/chrome.ts");
const {
  ReviewBoxComponent,
  promptText,
  showGuardScreen,
  showModelsScreen,
  showProvidersScreen,
  showRootMenu,
  showUsageScreen,
} = await import("../extensions/screens.ts");
const { recordUsage } = await import("../extensions/store.ts");

// Strict Pi theme mock: throws on unknown color tokens such as `accentSoft`
const ALLOWED_TOKENS = new Set([
  "accent",
  "border",
  "borderAccent",
  "borderMuted",
  "customMessageLabel",
  "customMessageText",
  "dim",
  "error",
  "muted",
  "success",
  "text",
  "warning",
  "thinkingMinimal",
  "thinkingLow",
  "thinkingMedium",
  "thinkingHigh",
  "thinkingXhigh",
]);

const mockTheme = {
  colors: {
    accent: { kind: "oklch", l: 0.72, c: 0.14, h: 155 },
  },
  fg(token, text) {
    if (!ALLOWED_TOKENS.has(token)) {
      throw new Error(`Unknown theme color: ${token}`);
    }
    return `\x1b[36m${text}\x1b[39m`;
  },
  bold(text) {
    return `\x1b[1m${text}\x1b[22m`;
  },
  style(text) {
    return `\x1b[38;5;120m${text}\x1b[39m`;
  },
};

const WIDTHS = [60, 80, 120];
const screensChecked = [];

function makeMockCtx(screenName, onInput) {
  return {
    cwd: process.cwd(),
    hasUI: true,
    mode: "tui",
    ui: {
      notify() {},
      setStatus() {},
      async custom(factory) {
        let resolved = false;
        let result;
        const done = (val) => {
          resolved = true;
          result = val;
        };
        const tui = { requestRender() {} };
        const kb = {};
        const comp = await factory(tui, mockTheme, kb, done);
        for (const w of WIDTHS) {
          const lines = comp.render(w);
          assert.ok(Array.isArray(lines) && lines.length >= 3, `${screenName}@${w}: expected framed lines`);
          assert.equal(stripAnsi(lines[0]).startsWith("╭"), true, `${screenName}@${w}: top border missing`);
          assert.equal(stripAnsi(lines.at(-1)).startsWith("╰"), true, `${screenName}@${w}: bottom border missing`);
          for (const line of lines) {
            const vw = visibleWidth(line);
            assert.equal(vw, w, `${screenName}@${w}: expected exact width ${w}, got ${vw} on "${stripAnsi(line)}"`);
          }
        }
        if (onInput) onInput(comp);
        if (!resolved) comp.handleInput?.("\x1b");
        screensChecked.push(screenName);
        return result;
      },
    },
  };
}

process.env.PI_DECISION_EYE_HOME = mkdtempSync(join(tmpdir(), "dec-eye-render-"));

// 1. Root menu
await showRootMenu(makeMockCtx("root-menu", (c) => c.handleInput?.("\x1b[B")));

// 2. Guard screen
await showGuardScreen(makeMockCtx("guard", (c) => c.handleInput?.("\x1b[B")), true);

// 3. Providers screen
await showProvidersScreen(makeMockCtx("providers", (c) => {
  c.handleInput?.("l");
  c.handleInput?.("\x7f");
}), true);

// 4. Models screen
await showModelsScreen(makeMockCtx("models", (c) => c.handleInput?.("\t")), true);

// 5. Usage screen (empty state)
await showUsageScreen(makeMockCtx("usage-empty"), true);

// 6. Usage screen (populated active-only state)
recordUsage("liquid", "d1.2", { requests: 4, ok: 4, inputTokens: 2100, cost: 0.000042 });
recordUsage("cloudflare", "clef-flash", { requests: 2, ok: 2, inputTokens: 800, cost: 0.00001 });
await showUsageScreen(makeMockCtx("usage-active", (c) => c.handleInput?.("\t")), true);

// 7. Text prompt screen (secret input focus & cursor forwarding)
await promptText(
  makeMockCtx("text-prompt", (c) => {
    c.focused = true;
    assert.equal(c.focused, true, "text-prompt: focused getter/setter must forward state");
    c.handleInput?.("k");
  }),
  "Provider API Key",
  "Paste your API key.",
  false,
);

// 8. ReviewBoxComponent (collapsed/expanded widths + single-click vs double-click guard)
const reviewBox = new ReviewBoxComponent("[pi-decision-eye] Reviewed turn contract.\n- Line 1\n- Line 2", false, mockTheme);
for (const expanded of [false, true]) {
  reviewBox.isExpanded = expanded;
  for (const w of WIDTHS) {
    const lines = reviewBox.render(w);
    assert.equal(stripAnsi(lines[0]).startsWith("╭"), true, `review-box@${w}: top border missing`);
    assert.equal(stripAnsi(lines.at(-1)).startsWith("╰"), true, `review-box@${w}: bottom border missing`);
    for (const line of lines) {
      assert.equal(visibleWidth(line), w, `review-box@${w}: expected width ${w}`);
    }
  }
}
reviewBox.isExpanded = false;
assert.equal(reviewBox.handleMouse({ type: "click", button: "left", clickCount: 2 }), undefined);
assert.equal(reviewBox.isExpanded, false, "review-box: double-click must not toggle");
assert.deepEqual(reviewBox.handleMouse({ type: "click", button: "left", clickCount: 1 }), { handled: true });
assert.equal(reviewBox.isExpanded, true, "review-box: single-click must toggle");
screensChecked.push("review-box");

console.log(`render-check passed (${screensChecked.length} screens x ${WIDTHS.length} widths: ${screensChecked.join(", ")})`);
