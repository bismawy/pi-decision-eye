import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  borderPainter,
  chosenRowPainter,
  framedRows,
  fuzzyMatch,
  packPairs,
  stripAnsi,
  visibleWidth,
} from "../extensions/chrome.ts";
import { REVIEW_TRIGGER } from "../extensions/review.ts";
import { readUsageWindow, recordUsage, restoreUsage, trashUsage } from "../extensions/store.ts";

describe("Active-only usage ledger & trash-backed reset/undo", () => {
  it("shows ONLY providers and models that were actually used in the selected window", () => {
    process.env.PI_DECISION_EYE_HOME = mkdtempSync(join(tmpdir(), "dec-eye-usage-"));
    const now = new Date("2026-11-20T12:00:00Z");
    const tenDaysAgo = new Date("2026-11-10T12:00:00Z");

    // Initially empty
    const empty = readUsageWindow("all", now);
    assert.equal(empty.providers.length, 0);
    assert.equal(empty.todayNeurons, 0);

    // Record usage only for liquid today and perplexity 10 days ago
    recordUsage("liquid", "d1.2", { requests: 3, ok: 3, inputTokens: 1500, cost: 0.00003 }, now);
    recordUsage("perplexity", "pplx-decider-latest", { requests: 2, ok: 2, inputTokens: 1000, cost: 0.00002 }, tenDaysAgo);

    // Today window: ONLY liquid appears (perplexity, cloudflare, openai, etc. are completely hidden!)
    const todaySummary = readUsageWindow("today", now);
    assert.deepEqual(todaySummary.providers.map((p) => p.providerId), ["liquid"]);
    assert.deepEqual(todaySummary.providers[0].models.map((m) => m.modelId), ["d1.2"]);
    assert.equal(todaySummary.todayNeurons, 0);

    // 30d window: liquid + perplexity only
    const monthSummary = readUsageWindow("30d", now);
    assert.deepEqual(monthSummary.providers.map((p) => p.providerId), ["liquid", "perplexity"]);

    // Trash reset moves file aside cleanly and Undo restores it intact
    const trashed = trashUsage(now);
    assert.ok(trashed);
    assert.equal(readUsageWindow("all", now).providers.length, 0);
    assert.equal(restoreUsage(trashed.trashPath), true);
    assert.equal(readUsageWindow("all", now).providers.length, 2);
  });
});

describe("Arnative chrome maths & /eye trigger", () => {
  it("frames lines to exact terminal width, derives soft OKLCH tier, and paints thinking border", () => {
    let styleInput = null;
    const theme = {
      colors: { accent: { kind: "oklch", l: 0.72, c: 0.14, h: 155 } },
      fg: (token, text) => {
        if (token === "accentSoft") throw new Error("Unknown theme color: accentSoft");
        return `\x1b[36m${text}\x1b[39m`;
      },
      bold: (t) => `\x1b[1m${t}\x1b[22m`,
      style: (t, opts) => {
        styleInput = opts.fg;
        return `\x1b[38;5;120m${t}\x1b[39m`;
      },
    };

    const chosen = chosenRowPainter(theme)("Liquid AI");
    assert.ok(chosen.includes("\x1b[1mLiquid AI\x1b[22m"));
    assert.equal(styleInput.l, 0.9);
    assert.equal(styleInput.h, 155);

    const frame = framedRows(["Header", "Line 1\nLine 2", "Very long line that will be truncated cleanly"], 32, borderPainter(theme, "high"));
    assert.equal(stripAnsi(frame[0]).startsWith("╭"), true);
    assert.equal(stripAnsi(frame.at(-1)).startsWith("╰"), true);
    for (const row of frame) assert.equal(visibleWidth(row), 32);

    assert.equal(fuzzyMatch("liq d1", "Liquid AI d1.2"), true);
    assert.equal(fuzzyMatch("xyz", "Liquid AI d1.2"), false);
    assert.equal(packPairs(["[↑↓] Move", "[Enter] Save", "[Esc] Back"], 24).length, 2);
  });

  it("matches /eye and @eye triggers without false positives on paths or words", () => {
    assert.equal(REVIEW_TRIGGER.test("/eye check this diff"), true);
    assert.equal(REVIEW_TRIGGER.test("Tolong review /eye."), true);
    assert.equal(REVIEW_TRIGGER.test("Cek pakai @eye"), true);
    assert.equal(REVIEW_TRIGGER.test("open docs/eye/spec.md"), false);
    assert.equal(REVIEW_TRIGGER.test("edit /eye.md"), false);
    assert.equal(REVIEW_TRIGGER.test("eyeliner"), false);
  });
});
