// Arnative rounded-box TUI screens for /decision: Menu, Guard, Providers, Models, Usage (active-only).

import { CURSOR_MARKER, Input, Key, matchesKey } from "@earendil-works/pi-tui";
import {
  borderPainter,
  chosenRowPainter,
  framedRows,
  fuzzyMatch,
  packPairs,
  padColumn,
  truncateWidth,
  visibleWidth,
  wrapWords,
} from "./chrome.ts";
import {
  PROVIDERS,
  autoWireBackend,
  buildEndpointUrl,
  clefBudgetStatus,
  isCloudflareAccountId,
  isPlausibleKey,
  listCatalog,
  modelRef,
  modelsForProvider,
  probeBackend,
  providerShortName,
  resolveBackend,
  resolveBackendChain,
  resolveCloudflareAccounts,
  resolveProviderStatus,
} from "./providers.ts";
import type { CatalogItem, ProviderSpec } from "./providers.ts";
import { KEY_SETS, PRESETS, glyphs, keybind, keycap, nextPreset, session, syncStatus } from "./state.ts";
import {
  applyPreset,
  deleteCredential,
  folderAllows,
  nextFolderScope,
  readAuthStore,
  readConfig,
  readUsageWindow,
  restoreUsage,
  saveCredential,
  scopeLabel,
  trashUsage,
  writeConfig,
} from "./store.ts";
import type { EyeConfig, UsageBucket, UsageWindow, WireDialect } from "./store.ts";

export const BACK = Symbol("back");

const USAGE_WINDOWS: { id: UsageWindow; label: string }[] = [
  { id: "all", label: "All" },
  { id: "today", label: "Today" },
  { id: "7d", label: "7 day" },
  { id: "30d", label: "30 day" },
  { id: "3m", label: "3 month" },
];

const borderOf = (theme: any, ctx?: any) => borderPainter(theme, ctx?.thinkingLevel);

async function openCustom<T>(ctx: any, build: (theme: any, done: (value: T) => void) => any): Promise<T> {
  return await ctx.ui.custom((tui: any, theme: any, _kb: any, done: (value: T) => void) => {
    const comp = build(theme, done);
    return {
      get focused() {
        return Boolean(comp.focused);
      },
      set focused(val: boolean) {
        if ("focused" in comp) comp.focused = val;
      },
      render: (width: number) => comp.render(width),
      invalidate: () => comp.invalidate?.(),
      handleInput: (data: string) => {
        comp.handleInput(data);
        tui.requestRender();
      },
    };
  });
}

/** Single-line masked input preserving the IME caret marker. */
class SecretInput extends Input {
  constructor(theme: any, placeholder = "sk-...") {
    super({
      prompt: "> ",
      placeholder,
      placeholderStyle: (s: string) => theme.fg("dim", s),
    });
  }

  override render(width: number): string[] {
    const val = this.getValue();
    if (!val) return super.render(width);
    const len = [...val].length;
    const bullets = "•".repeat(Math.min(len, Math.max(0, width - 3)));
    const cursor = this.focused ? `${CURSOR_MARKER}\x1b[7m \x1b[27m` : "";
    return [truncateWidth(`> ${bullets}${cursor}`, width, "")];
  }
}

class TextPromptScreen {
  private readonly input: Input;
  private readonly theme: any;
  private readonly paint: (t: string) => string;
  private readonly title: string;
  private readonly hint: string;
  isFocused = false;

  constructor(
    theme: any,
    paint: (t: string) => string,
    title: string,
    hint: string,
    reveal: boolean,
    done: (value?: string) => void,
    initialValue = "",
    placeholder = reveal ? "" : "sk-...",
  ) {
    this.theme = theme;
    this.paint = paint;
    this.title = title;
    this.hint = hint;
    this.input = reveal
      ? new Input({
          prompt: "> ",
          placeholder,
          placeholderStyle: (s: string) => theme.fg("dim", s),
        })
      : new SecretInput(theme, placeholder);
    if (initialValue) this.input.setValue(initialValue);
    this.input.onSubmit = (val) => done(val);
    this.input.onEscape = () => done(undefined);
  }

  get focused(): boolean {
    return this.isFocused;
  }

  set focused(val: boolean) {
    this.isFocused = val;
    this.input.focused = val;
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape)) {
      this.input.onEscape?.();
      return;
    }
    this.input.handleInput(data);
  }

  render(width: number): string[] {
    const t = this.theme;
    const inner = Math.max(10, width - 4);
    this.input.focused = this.isFocused;
    const field = this.input.render(Math.max(1, inner))[0] ?? "";
    const lines = [
      t.fg("accent", t.bold(this.title)),
      ...wrapWords(this.hint, inner).map((l) => t.fg("muted", l)),
      "",
      field,
      "",
      ...packPairs(["[Enter] Confirm", "[Esc] Cancel"], inner).map((p) => t.fg("dim", p)),
    ];
    return framedRows(lines, width, this.paint);
  }
}

export async function promptText(
  ctx: any,
  title: string,
  hint: string,
  reveal = false,
  initialValue = "",
  placeholder = reveal ? "" : "sk-...",
): Promise<string | undefined> {
  if (ctx.mode !== "tui") return await ctx.ui.input(title, hint);
  return await openCustom<string | undefined>(ctx, (theme, done) =>
    new TextPromptScreen(theme, borderOf(theme, ctx), title, hint, reveal, done, initialValue, placeholder)
  );
}

/** Shared explicit `/` filter helper following arnative-pi's two-state filter rule. */
class FilterBar {
  readonly field: Input;
  private readonly theme: any;
  private readonly placeholder: string;
  typing = false;

  constructor(theme: any, placeholder: string) {
    this.theme = theme;
    this.placeholder = placeholder;
    this.field = new Input({
      prompt: theme.fg("accent", "> "),
      placeholder,
      placeholderStyle: (s: string) => theme.fg("muted", s),
    });
  }

  get query(): string {
    return this.field.getValue();
  }

  handleKey(data: string, onResetCursor: () => void): boolean {
    const setTyping = (on: boolean): true => {
      this.typing = on;
      this.field.focused = on;
      return true;
    };
    if (!this.typing) return data === KEY_SETS.filter && setTyping(true);
    if (data === KEY_SETS.filter || matchesKey(data, Key.enter)) return setTyping(false);
    if (matchesKey(data, Key.escape)) {
      if (!this.query) return false;
      this.field.setValue("");
      onResetCursor();
      return setTyping(false);
    }
    if (matchesKey(data, Key.up) || matchesKey(data, Key.down)) return false;
    const before = this.query;
    this.field.handleInput(data);
    if (this.query !== before) onResetCursor();
    return true;
  }

  renderLine(innerWidth: number): string[] {
    if (this.typing) return this.field.render(Math.max(1, innerWidth));
    const t = this.theme;
    const prompt = t.fg("borderMuted", "> ");
    const body = this.query ? t.fg("text", this.query) : t.fg("dim", this.placeholder);
    return [truncateWidth(`${prompt}${body}`, innerWidth, "")];
  }
}

function viewportWindow(total: number, cursor: number, maxRows: number): { start: number; end: number } {
  if (total <= maxRows) return { start: 0, end: total };
  const start = Math.max(0, Math.min(cursor - Math.floor(maxRows / 2), total - maxRows));
  return { start, end: start + maxRows };
}

// ============================================================================
// 1. Root List Picker (Menu & Selection)
// ============================================================================

class ListMenu {
  private index: number;
  private readonly theme: any;
  private readonly paint: (t: string) => string;
  private readonly title: string;
  private readonly subtitle: string;
  private readonly rows: { label: string; note: string }[];
  private readonly footer: string[];
  private readonly done: (value: number | null) => void;
  private readonly soft: (t: string) => string;

  constructor(
    theme: any,
    paint: (t: string) => string,
    title: string,
    subtitle: string,
    rows: { label: string; note: string }[],
    footer: string[],
    done: (value: number | null) => void,
    initialIndex = 0,
  ) {
    this.theme = theme;
    this.paint = paint;
    this.title = title;
    this.subtitle = subtitle;
    this.rows = rows;
    this.footer = footer;
    this.done = done;
    this.soft = chosenRowPainter(theme);
    this.index = Math.min(Math.max(initialIndex, 0), Math.max(0, rows.length - 1));
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.up)) {
      this.index = (this.index - 1 + this.rows.length) % this.rows.length;
      return;
    }
    if (matchesKey(data, Key.down)) {
      this.index = (this.index + 1) % this.rows.length;
      return;
    }
    if (matchesKey(data, Key.home)) {
      this.index = 0;
      return;
    }
    if (matchesKey(data, Key.end)) {
      this.index = Math.max(0, this.rows.length - 1);
      return;
    }
    if (matchesKey(data, Key.enter)) {
      this.done(this.index);
      return;
    }
    if (matchesKey(data, Key.escape)) this.done(null);
  }

  render(width: number): string[] {
    const t = this.theme;
    const inner = Math.max(10, width - 4);
    const col = Math.max(0, ...this.rows.map((r) => visibleWidth(r.label)));
    const lines = [t.fg("accent", t.bold(this.title)), t.fg("muted", this.subtitle), ""];
    for (const [i, row] of this.rows.entries()) {
      const chosen = i === this.index;
      const prefix = chosen ? t.fg("accent", "❯ ") : "  ";
      const label = chosen ? this.soft(row.label) : t.fg("text", row.label);
      const pad = " ".repeat(Math.max(0, col - visibleWidth(row.label)));
      const note = row.note ? ` ${t.fg("dim", "·")} ${t.fg("dim", row.note)}` : "";
      lines.push(`${prefix}${label}${pad}${note}`);
    }
    lines.push("");
    for (const pair of packPairs(this.footer, inner)) lines.push(t.fg("dim", pair));
    return framedRows(lines, width, this.paint);
  }
}

// ============================================================================
// 2. Guard & Configuration Screen (/decision guard)
// ============================================================================

class GuardScreen {
  private config: EyeConfig;
  private index = 0;
  private readonly ctx: any;
  private readonly theme: any;
  private readonly paint: (t: string) => string;
  private readonly done: (value: EyeConfig | typeof BACK | null) => void;
  private readonly back: boolean;
  private readonly soft: (t: string) => string;

  constructor(
    ctx: any,
    theme: any,
    paint: (t: string) => string,
    done: (value: EyeConfig | typeof BACK | null) => void,
    back: boolean,
  ) {
    this.ctx = ctx;
    this.theme = theme;
    this.paint = paint;
    this.done = done;
    this.back = back;
    this.config = readConfig();
    this.soft = chosenRowPainter(theme);
  }

  private cycleCurrent(): void {
    if (this.index === 0) {
      this.config = applyPreset(this.config, nextPreset(this.config.preset));
    } else if (this.index === 1) {
      this.config = { ...this.config, folderScope: nextFolderScope(this.config.folderScope, this.ctx.cwd) };
    } else if (this.index === 2) {
      this.config = { ...this.config, stages: { ...this.config.stages, local: !this.config.stages.local } };
    } else if (this.index === 3) {
      this.config = { ...this.config, stages: { ...this.config.stages, doneCheck: !this.config.stages.doneCheck } };
    } else if (this.index === 4) {
      this.config = { ...this.config, stages: { ...this.config.stages, semantic: !this.config.stages.semantic } };
    } else if (this.index === 5) {
      this.config = { ...this.config, reviewAlways: !this.config.reviewAlways };
    }
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.up)) {
      this.index = (this.index - 1 + 6) % 6;
      return;
    }
    if (matchesKey(data, Key.down)) {
      this.index = (this.index + 1) % 6;
      return;
    }
    if (matchesKey(data, Key.space) || data === " ") {
      this.cycleCurrent();
      return;
    }
    if (matchesKey(data, Key.enter)) {
      this.done(this.config);
      return;
    }
    if (this.back && matchesKey(data, Key.left)) {
      this.done(BACK);
      return;
    }
    if (matchesKey(data, Key.escape)) this.done(null);
  }

  render(width: number): string[] {
    const t = this.theme;
    const inner = Math.max(10, width - 4);
    const chain = resolveBackendChain(this.config);
    const primary = chain[0];
    const fallback = chain[1];
    const backendText = primary
      ? `${t.fg("text", `${primary.model} (${primary.provider.short})`)}${fallback ? t.fg("muted", ` → ${fallback.model}`) : ""}`
      : t.fg("warning", "OFFLINE · connect a provider in /decision providers");

    const s = session.stats;
    const blocked = s.blockedCmd + s.blockedSecret + s.blockedSemantic;
    const sessionText =
      `${t.fg("text", `${s.gateCalls}/${this.config.maxGateCalls} gate`)} ${t.fg("dim", "·")} ` +
      `${t.fg(blocked > 0 ? "warning" : "muted", `${blocked} blocked`)} ${t.fg("dim", "·")} ` +
      `${t.fg("dim", `${s.reviewTurns} reviewed${s.failovers > 0 ? ` · ${s.failovers} failover` : ""}`)}`;

    const ovCol = Math.max("Backend".length, "Session".length);
    const overview = (label: string, val: string) => `${t.fg("dim", label.padEnd(ovCol))} ${t.fg("dim", "·")} ${val}`;

    const spec = PRESETS[this.config.preset];
    const inScope = folderAllows(this.ctx.cwd, this.config.folderScope);
    const onOff = (on: boolean) => (on ? t.fg("accent", "ON") : t.fg("muted", "OFF"));

    const controls: [string, string, string][] = [
      ["Preset", t.fg(this.config.preset === "off" ? "warning" : "success", spec.label), spec.summary],
      [
        "Folder scope",
        t.fg(this.config.folderScope.mode === "disabled" || !inScope ? "warning" : "success", scopeLabel(this.config.folderScope, this.ctx.cwd)),
        inScope ? `active in ${this.ctx.cwd}` : "current folder skipped",
      ],
      ["Stage 1", onOff(this.config.stages.local), "bash, powershell, git, sql & entropy secrets"],
      ["Stage 2", onOff(this.config.stages.doneCheck), "done-check verified via tool_result exit status"],
      ["Stage 3", onOff(this.config.stages.semantic), "diff-aware slop, unfinished & safety decision gate"],
      [
        "Review mode",
        this.config.reviewAlways ? t.fg("accent", "ALL TURNS") : t.fg("muted", "PROMPT"),
        this.config.reviewAlways ? "contract injected every turn" : "trigger via /eye or @eye",
      ],
    ];

    const ctrlCol = Math.max(...controls.map(([k]) => visibleWidth(k)));
    const lines = [
      t.fg("accent", t.bold("Decision Eye · Guard")),
      t.fg("muted", "Active protection profile and live session telemetry."),
      "",
      overview("Backend", backendText),
      overview("Session", sessionText),
      "",
    ];

    for (const [i, [label, status, detail]] of controls.entries()) {
      const chosen = i === this.index;
      const prefix = chosen ? t.fg("accent", "❯ ") : "  ";
      const styledLabel = chosen ? this.soft(label) : t.fg("text", label);
      const pad = " ".repeat(Math.max(0, ctrlCol - visibleWidth(label)));
      lines.push(`${prefix}${styledLabel}${pad} ${t.fg("dim", "·")} ${status} ${t.fg("dim", "|")} ${t.fg("muted", detail)}`);
    }

    lines.push("");
    const legend = ["[↑↓] Move", "[Space] Cycle", "[Enter] Save", ...(this.back ? ["[←] Back"] : []), "[Esc] Cancel"];
    for (const pair of packPairs(legend, inner)) lines.push(t.fg("dim", pair));
    return framedRows(lines, width, this.paint);
  }
}

export async function showGuardScreen(ctx: any, back = false): Promise<void | typeof BACK> {
  if (ctx.mode !== "tui") {
    const cfg = readConfig();
    const chain = resolveBackendChain(cfg);
    ctx.ui.notify(
      `Decision Eye · Guard\nPreset: ${PRESETS[cfg.preset].label} · Scope: ${scopeLabel(cfg.folderScope, ctx.cwd)} · Backend: ${chain[0]?.ref ?? "OFFLINE"}`,
      "info",
    );
    return;
  }
  const result = await openCustom<EyeConfig | typeof BACK | null>(ctx, (theme, done) =>
    new GuardScreen(ctx, theme, borderOf(theme, ctx), done, back)
  );
  if (result === BACK) return BACK;
  if (!result) return;
  writeConfig(result);
  const active = resolveBackendChain(result)[0];
  syncStatus(ctx, result.preset, active?.model);
  ctx.ui.notify(
    `[pi-decision-eye] Guard saved · ${PRESETS[result.preset].label} · scope ${scopeLabel(result.folderScope, ctx.cwd)}.`,
    "info",
  );
}

// ============================================================================
// 3. Providers Screen (/decision providers) — Built-in BaseURL, API Key Login
// ============================================================================

type ProviderAction =
  | { type: "login"; provider: ProviderSpec }
  | { type: "test-all" }
  | { type: "back" }
  | { type: "cancel" };

class ProvidersScreen {
  private readonly filter: FilterBar;
  private readonly soft: (t: string) => string;
  private readonly theme: any;
  private readonly paint: (t: string) => string;
  private readonly done: (action: ProviderAction) => void;
  private readonly onRemove: (provider: ProviderSpec) => void;
  private readonly back: boolean;
  private index = 0;
  private pendingRemove: string | null = null;
  private busy = false;
  private static readonly VIEWPORT = 8;

  constructor(
    theme: any,
    paint: (t: string) => string,
    done: (action: ProviderAction) => void,
    onRemove: (provider: ProviderSpec) => void,
    back: boolean,
  ) {
    this.theme = theme;
    this.paint = paint;
    this.done = done;
    this.onRemove = onRemove;
    this.back = back;
    this.filter = new FilterBar(theme, "Type to filter providers...");
    this.soft = chosenRowPainter(theme);
  }

  private filtered(): ProviderSpec[] {
    return PROVIDERS.filter((p) => fuzzyMatch(this.filter.query, `${p.label} ${p.id} ${p.endpointDisplay} ${p.models.join(" ")}`));
  }

  private move(delta: number): void {
    const rows = this.filtered();
    if (rows.length === 0) return;
    this.index = (this.index + delta + rows.length) % rows.length;
    this.pendingRemove = null;
  }

  handleInput(data: string): void {
    if (this.filter.handleKey(data, () => { this.index = 0; this.pendingRemove = null; })) return;
    if (matchesKey(data, Key.up)) return this.move(-1);
    if (matchesKey(data, Key.down)) return this.move(1);

    const rows = this.filtered();
    const current = rows[this.index];

    if (matchesKey(data, KEY_SETS.test)) {
      this.done({ type: "test-all" });
      return;
    }
    if (matchesKey(data, KEY_SETS.remove) && current && !this.busy) {
      const store = readAuthStore();
      if (!store.providers[current.id]) return;
      if (this.pendingRemove !== current.id) {
        this.pendingRemove = current.id;
        return;
      }
      this.busy = true;
      try {
        this.onRemove(current);
        this.pendingRemove = null;
      } finally {
        this.busy = false;
      }
      return;
    }
    if (matchesKey(data, Key.enter) && current) {
      this.done({ type: "login", provider: current });
      return;
    }
    if (this.back && matchesKey(data, Key.left)) {
      this.done({ type: "back" });
      return;
    }
    if (matchesKey(data, Key.escape)) {
      this.done({ type: "cancel" });
    }
  }

  render(width: number): string[] {
    const t = this.theme;
    const inner = Math.max(10, width - 4);
    const store = readAuthStore();
    const rows = this.filtered();
    if (this.index >= rows.length) this.index = Math.max(0, rows.length - 1);

    const hasStored = Object.keys(store.providers).length > 0;
    const hasConfigured = PROVIDERS.some((p) => resolveProviderStatus(p, store).configured);
    const col = Math.max(...PROVIDERS.map((p) => visibleWidth(p.label)));
    const g = glyphs();

    const lines: string[] = [
      t.fg("accent", t.bold("Decision Eye · Providers")),
      t.fg("muted", "Built-in endpoints. Pick a provider and paste its API key only."),
      "",
      ...this.filter.renderLine(inner),
      "",
    ];

    const { start, end } = viewportWindow(rows.length, this.index, ProvidersScreen.VIEWPORT);
    if (start > 0) lines.push(t.fg("dim", `↑ ${start} more`));
    if (rows.length === 0) lines.push(t.fg("warning", "No provider matches this filter."));

    for (let i = start; i < end; i++) {
      const p = rows[i];
      const chosen = i === this.index;
      const status = resolveProviderStatus(p, store);
      const lat = session.latencyMs.get(p.id);
      const confirming = chosen && this.pendingRemove === p.id;

      let note: string;
      if (confirming) {
        note = t.fg("warning", `press [${keycap(KEY_SETS.remove)}] again to remove`);
      } else if (status.source === "stored") {
        const latText = lat ? (lat.ok ? ` (${lat.ms}ms)` : " (err)") : "";
        note = `${t.fg("success", `${g.ok} stored${latText}`)} ${t.fg("dim", `· ${p.endpointDisplay}`)}`;
      } else if (status.source === "env") {
        const latText = lat ? (lat.ok ? ` (${lat.ms}ms)` : " (err)") : "";
        note = `${t.fg("success", `${g.ok} env${latText}`)} ${t.fg("dim", `· ${p.endpointDisplay}`)}`;
      } else if (status.source === "local") {
        note = `${t.fg("success", `${g.off} ready (0 key)`)} ${t.fg("dim", `· ${p.endpointDisplay}`)}`;
      } else {
        note = t.fg("dim", `not set · ${p.endpointDisplay}`);
      }

      const prefix = chosen ? t.fg("accent", "❯ ") : "  ";
      const label = chosen ? this.soft(p.label) : status.configured ? t.fg("accent", p.label) : t.fg("muted", p.label);
      const pad = " ".repeat(Math.max(0, col - visibleWidth(p.label)));
      lines.push(truncateWidth(`${prefix}${label}${pad} ${t.fg("dim", "·")} ${note}`, inner));
    }

    const below = rows.length - end;
    if (below > 0) lines.push(t.fg("dim", `↓ ${below} more`));

    const current = rows[this.index];
    lines.push("");
    if (current) {
      lines.push(t.fg("dim", `Tip: ${current.keyHint} (or export $${current.keyEnv})`));
    }
    lines.push("");

    const legend = [
      "[↑↓] Move",
      "[/] Filter",
      "[Enter] Login",
      ...(hasConfigured ? [`${keybind(KEY_SETS.test)} Test`] : []),
      ...(hasStored ? [`${keybind(KEY_SETS.remove)} Remove`] : []),
      ...(this.back ? ["[←] Back"] : []),
      "[Esc] Cancel",
    ];
    for (const pair of packPairs(legend, inner)) lines.push(t.fg("dim", pair));
    return framedRows(lines, width, this.paint);
  }
}

async function runProviderLogin(ctx: any, provider: ProviderSpec): Promise<void> {
  if (provider.customEndpoint) {
    const baseUrl = await promptText(
      ctx,
      "Custom Decision Endpoint · Base URL",
      "Full POST URL (e.g. http://127.0.0.1:8080/v1/decisions or LiteLLM /v1/systemone).",
      true,
      readAuthStore().providers.custom?.baseUrl ?? provider.endpoint,
    );
    if (!baseUrl?.trim()) return;
    const model = await promptText(
      ctx,
      "Custom Endpoint · Model ID",
      "Model identifier sent in the request body.",
      true,
      readAuthStore().providers.custom?.customModels?.[0] ?? "default",
    );
    if (!model?.trim()) return;
    const dialectRaw = await promptText(
      ctx,
      "Custom Endpoint · Dialect",
      "Enter `systemone` (default) or `openai-decisions`.",
      true,
      "systemone",
    );
    const dialect: WireDialect = dialectRaw?.trim() === "openai-decisions" ? "openai-decisions" : "systemone";
    const apiKey = (await promptText(ctx, "Custom Endpoint · API Key (optional)", "Leave empty for local endpoints without auth.", false))?.trim() ?? "";

    const probe = await probeBackend({
      provider,
      model: model.trim(),
      ref: modelRef(provider.id, model.trim()),
      url: baseUrl.trim(),
      dialect,
      apiKey,
      source: "stored",
    });
    if (!probe.ok) {
      ctx.ui.notify(`[pi-decision-eye] Probe failed (${probe.detail}). Nothing was saved.`, "error");
      return;
    }
    saveCredential(provider.id, { baseUrl: baseUrl.trim(), dialect, customModels: [model.trim()], ...(apiKey ? { apiKey } : {}) });
    session.latencyMs.set(provider.id, probe);
    const wired = autoWireBackend(provider.id, model.trim());
    syncStatus(ctx, wired.config.preset, resolveBackendChain(wired.config)[0]?.model);
    ctx.ui.notify(`[pi-decision-eye] Connected Custom (${model.trim()}, ${probe.ms}ms)${wired.assigned ? ` · auto-set as ${wired.assigned}` : ""}.`, "info");
    return;
  }

  if (provider.id === "ollama") {
    const baseUrl = await promptText(
      ctx,
      "Ollama (Local) · Endpoint",
      "Press Enter for default local Ollama System One endpoint.",
      true,
      readAuthStore().providers.ollama?.baseUrl ?? provider.endpoint,
    );
    if (!baseUrl?.trim()) return;
    const model = modelsForProvider(provider)[0] ?? provider.defaultModel;
    const probe = await probeBackend({
      provider,
      model,
      ref: modelRef(provider.id, model),
      url: baseUrl.trim(),
      dialect: provider.dialect,
      apiKey: "",
      source: "local",
    });
    if (!probe.ok) {
      ctx.ui.notify(`[pi-decision-eye] Ollama probe failed (${probe.detail}). Ensure Ollama v0.35+ is running with a decision model pulled.`, "error");
      return;
    }
    saveCredential(provider.id, { baseUrl: baseUrl.trim() });
    session.latencyMs.set(provider.id, probe);
    const wired = autoWireBackend(provider.id, model);
    syncStatus(ctx, wired.config.preset, resolveBackendChain(wired.config)[0]?.model);
    ctx.ui.notify(`[pi-decision-eye] Connected Ollama (${model}, ${probe.ms}ms)${wired.assigned ? ` · auto-set as ${wired.assigned}` : ""}.`, "info");
    return;
  }

  // Standard 1-step API Key login for all cloud providers (including Cloudflare with auto account discovery!)
  const entered = await promptText(
    ctx,
    `${provider.label} · API Key`,
    `Endpoint: ${provider.endpoint}\nPaste key from ${provider.keyHint}. Verified live before saving.`,
    false,
  );
  if (entered === undefined) return;
  const apiKey = entered.trim();
  if (!isPlausibleKey(apiKey)) {
    ctx.ui.notify("[pi-decision-eye] Invalid API key format (8–512 printable chars, no spaces). Nothing was saved.", "error");
    return;
  }

  let accountId: string | undefined;
  if (provider.id === "cloudflare") {
    accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
    if (!accountId) {
      ctx.ui.notify("[pi-decision-eye] Detecting Cloudflare account ID from API token...", "info");
      const accounts = await resolveCloudflareAccounts(apiKey);
      if (accounts.length === 1) {
        accountId = accounts[0].id;
      } else if (accounts.length > 1) {
        const picked = await openCustom<number | null>(ctx, (theme, done) =>
          new ListMenu(
            theme,
            borderOf(theme, ctx),
            "Cloudflare · Select Account",
            "Multiple accounts found for this token.",
            accounts.map((a) => ({ label: a.name, note: a.id })),
            ["[↑↓] Move", "[Enter] Choose", "[Esc] Cancel"],
            done,
          )
        );
        if (picked === null) return;
        accountId = accounts[picked]?.id;
      } else {
        const manual = await promptText(
          ctx,
          "Cloudflare · Account ID",
          "Token lacks Account:Read permission. Paste the 32-char hex Account ID from Cloudflare Dashboard.",
          true,
        );
        if (!manual?.trim() || !isCloudflareAccountId(manual.trim())) {
          ctx.ui.notify("[pi-decision-eye] Invalid 32-char Cloudflare Account ID. Nothing was saved.", "error");
          return;
        }
        accountId = manual.trim();
      }
    }
  }

  const model = provider.defaultModel;
  const url = buildEndpointUrl(provider, model, { apiKey, accountId });
  ctx.ui.notify(`[pi-decision-eye] Verifying ${provider.label} (${model})...`, "info");
  const probe = await probeBackend({
    provider,
    model,
    ref: modelRef(provider.id, model),
    url,
    dialect: provider.dialect,
    apiKey,
    accountId,
    source: "stored",
  });
  if (!probe.ok) {
    ctx.ui.notify(`[pi-decision-eye] Login failed for ${provider.label}: ${probe.detail}. Nothing was saved.`, "error");
    return;
  }

  saveCredential(provider.id, { apiKey, ...(accountId ? { accountId } : {}) });
  session.latencyMs.set(provider.id, probe);
  const wired = autoWireBackend(provider.id, model);
  syncStatus(ctx, wired.config.preset, resolveBackendChain(wired.config)[0]?.model);
  ctx.ui.notify(
    `[pi-decision-eye] Connected ${provider.label} (${probe.detail})${wired.assigned ? ` · auto-set as ${wired.assigned}` : ""}.`,
    "info",
  );
}

async function testConfiguredProviders(ctx: any): Promise<void> {
  const store = readAuthStore();
  const configured = PROVIDERS.filter((p) => resolveProviderStatus(p, store).configured);
  if (configured.length === 0) {
    ctx.ui.notify("[pi-decision-eye] No configured providers to test.", "warning");
    return;
  }
  ctx.ui.notify(`[pi-decision-eye] Testing ${configured.length} configured provider(s)...`, "info");
  const results = await Promise.all(
    configured.map(async (provider) => {
      const m = modelsForProvider(provider, store)[0] ?? provider.defaultModel;
      const backend = resolveBackend(modelRef(provider.id, m), store);
      if (!backend) return { provider, probe: { ok: false, ms: 0, detail: "unusable" } };
      const probe = await probeBackend(backend);
      session.latencyMs.set(provider.id, probe);
      return { provider, probe };
    }),
  );
  const summary = results
    .map(({ provider, probe }) => `${provider.short}: ${probe.ok ? `${glyphs().ok} ${probe.ms}ms` : `${glyphs().fail} ${probe.detail}`}`)
    .join(" · ");
  ctx.ui.notify(`[pi-decision-eye] Probe results — ${summary}`, results.every((r) => r.probe.ok) ? "info" : "warning");
}

export async function showProvidersScreen(ctx: any, back = false): Promise<void | typeof BACK> {
  if (ctx.mode !== "tui") {
    const store = readAuthStore();
    const lines = PROVIDERS.map((p) => {
      const st = resolveProviderStatus(p, store);
      return `${p.label}: ${st.configured ? st.source : "not set"} (${p.endpointDisplay})`;
    });
    ctx.ui.notify(`Decision Eye · Providers\n${lines.join("\n")}`, "info");
    return;
  }

  while (true) {
    const action = await openCustom<ProviderAction>(ctx, (theme, done) =>
      new ProvidersScreen(
        theme,
        borderOf(theme, ctx),
        done,
        (provider) => {
          deleteCredential(provider.id);
          session.latencyMs.delete(provider.id);
          const cfg = readConfig();
          syncStatus(ctx, cfg.preset, resolveBackendChain(cfg)[0]?.model);
          ctx.ui.notify(`[pi-decision-eye] Removed stored key for ${provider.label}.`, "info");
        },
        back,
      )
    );
    if (action.type === "back") return BACK;
    if (action.type === "cancel") return;
    if (action.type === "test-all") {
      await testConfiguredProviders(ctx);
      continue;
    }
    await runProviderLogin(ctx, action.provider);
  }
}

// ============================================================================
// 4. Models Screen (/decision models) — Connected-first, [A] All, Primary/Fallback
// ============================================================================

class ModelsScreen {
  private readonly filter: FilterBar;
  private readonly soft: (t: string) => string;
  private readonly theme: any;
  private readonly paint: (t: string) => string;
  private readonly catalog: CatalogItem[];
  private readonly done: (value: { primary: string; fallback: string } | typeof BACK | null) => void;
  private readonly back: boolean;
  private primary: string;
  private fallback: string;
  private showAll: boolean;
  private index = 0;
  private static readonly VIEWPORT = 8;

  constructor(
    theme: any,
    paint: (t: string) => string,
    catalog: CatalogItem[],
    config: EyeConfig,
    done: (value: { primary: string; fallback: string } | typeof BACK | null) => void,
    back: boolean,
  ) {
    this.theme = theme;
    this.paint = paint;
    this.catalog = catalog;
    this.done = done;
    this.back = back;
    this.filter = new FilterBar(theme, "Type to filter models...");
    this.soft = chosenRowPainter(theme);
    this.primary = config.primary;
    this.fallback = config.fallback;
    // Default to connected providers only so the screen stays focused; fall back to all if none connected yet.
    this.showAll = !catalog.some((c) => c.configured);
  }

  private visibleRows(): CatalogItem[] {
    const base = this.showAll ? this.catalog : this.catalog.filter((c) => c.configured);
    return base.filter((item) => fuzzyMatch(this.filter.query, `${item.model} ${item.providerShort} ${item.ref}`));
  }

  private move(delta: number): void {
    const rows = this.visibleRows();
    if (rows.length === 0) return;
    this.index = (this.index + delta + rows.length) % rows.length;
  }

  private assign(slot: "primary" | "fallback"): void {
    const row = this.visibleRows()[this.index];
    if (!row) return;
    if (slot === "primary") {
      this.primary = this.primary === row.ref ? "" : row.ref;
      if (this.primary && this.fallback === this.primary) this.fallback = "";
    } else {
      this.fallback = this.fallback === row.ref ? "" : row.ref;
      if (this.fallback && this.primary === this.fallback) this.primary = "";
    }
  }

  handleInput(data: string): void {
    if (this.filter.handleKey(data, () => { this.index = 0; })) return;
    if (matchesKey(data, Key.up)) return this.move(-1);
    if (matchesKey(data, Key.down)) return this.move(1);
    if (matchesKey(data, Key.space) || data === " ") return this.assign("primary");
    if (matchesKey(data, Key.tab)) return this.assign("fallback");
    if (matchesKey(data, KEY_SETS.toggleAll)) {
      this.showAll = !this.showAll;
      this.index = 0;
      return;
    }
    if (matchesKey(data, Key.enter)) {
      this.done({ primary: this.primary, fallback: this.fallback });
      return;
    }
    if (this.back && matchesKey(data, Key.left)) {
      this.done(BACK);
      return;
    }
    if (matchesKey(data, Key.escape)) this.done(null);
  }

  render(width: number): string[] {
    const t = this.theme;
    const inner = Math.max(10, width - 4);
    const rows = this.visibleRows();
    const g = glyphs();
    if (this.index >= rows.length) this.index = Math.max(0, rows.length - 1);

    const slotLabel = (ref: string, token: string) => {
      const found = this.catalog.find((c) => c.ref === ref);
      return found ? t.fg(token, `${found.model} (${found.providerShort})`) : t.fg("muted", "(auto)");
    };

    const lines: string[] = [
      t.fg("accent", t.bold("Decision Eye · Models")),
      t.fg("muted", "Primary answers first; fallback runs on timeout, 429, or error."),
      "",
      `${t.fg("dim", "Primary ")} ${t.fg("dim", "·")} ${slotLabel(this.primary, "accent")}`,
      `${t.fg("dim", "Fallback")} ${t.fg("dim", "·")} ${slotLabel(this.fallback, "warning")}`,
      "",
      ...this.filter.renderLine(inner),
      "",
    ];

    const col = Math.min(34, Math.max(12, ...rows.map((r) => visibleWidth(r.model))));
    const { start, end } = viewportWindow(rows.length, this.index, ModelsScreen.VIEWPORT);
    if (start > 0) lines.push(t.fg("dim", `↑ ${start} more`));
    if (rows.length === 0) lines.push(t.fg("warning", "No model matches this filter."));

    for (let i = start; i < end; i++) {
      const item = rows[i];
      const chosen = i === this.index;
      const prefix = chosen ? t.fg("accent", "❯ ") : "  ";
      const label = chosen
        ? this.soft(padColumn(item.model, col))
        : t.fg(item.configured ? "text" : "muted", padColumn(item.model, col));

      const role =
        this.primary === item.ref
          ? t.fg("accent", `${g.ok} primary `)
          : this.fallback === item.ref
            ? t.fg("warning", `${g.ok} fallback`)
            : t.fg("dim", "—         ");
      const keyBadge = item.configured ? "" : ` ${t.fg("warning", "no key")}`;
      const price = item.priceTag ? ` ${t.fg("dim", item.priceTag)}` : "";
      lines.push(`${prefix}${label} ${t.fg("dim", "·")} ${role} ${t.fg("muted", `[${item.providerShort}]`)}${price}${keyBadge}`);
    }

    const below = rows.length - end;
    if (below > 0) lines.push(t.fg("dim", `↓ ${below} more`));
    lines.push("");

    const legend = [
      "[↑↓] Move",
      "[/] Filter",
      "[Space] Primary",
      "[Tab] Fallback",
      `${keybind(KEY_SETS.toggleAll)} ${this.showAll ? "Connected" : "All"}`,
      "[Enter] Save",
      ...(this.back ? ["[←] Back"] : []),
      "[Esc] Cancel",
    ];
    for (const pair of packPairs(legend, inner)) lines.push(t.fg("dim", pair));
    return framedRows(lines, width, this.paint);
  }
}

export async function showModelsScreen(ctx: any, back = false): Promise<void | typeof BACK> {
  const catalog = listCatalog();
  const cfg = readConfig();
  if (ctx.mode !== "tui") {
    ctx.ui.notify(
      `Decision Eye · Models\nPrimary: ${cfg.primary || "(auto)"} · Fallback: ${cfg.fallback || "(auto)"}`,
      "info",
    );
    return;
  }
  const result = await openCustom<{ primary: string; fallback: string } | typeof BACK | null>(ctx, (theme, done) =>
    new ModelsScreen(theme, borderOf(theme, ctx), catalog, cfg, done, back)
  );
  if (result === BACK) return BACK;
  if (!result) return;
  const next: EyeConfig = { ...cfg, primary: result.primary, fallback: result.fallback };
  writeConfig(next);
  syncStatus(ctx, next.preset, resolveBackendChain(next)[0]?.model);
  ctx.ui.notify(
    `[pi-decision-eye] Models saved · primary ${next.primary || "(auto)"} · fallback ${next.fallback || "(auto)"}.`,
    "info",
  );
}

// ============================================================================
// 5. Usage Screen (/decision usage) — Active-Only Providers, Viewport 5, Reset/Undo
// ============================================================================

function formatUsd(value: number): string {
  if (value <= 0) return "-";
  if (value < 0.0001) return "<$0.0001";
  return `$${value.toFixed(4)}`;
}

class UsageScreen {
  private windowIndex = 0;
  private cursor = 0;
  private readonly expanded = new Set<string>();
  private confirmingReset = false;
  private notice = "";
  private readonly theme: any;
  private readonly paint: (t: string) => string;
  private readonly done: (value?: typeof BACK) => void;
  private readonly back: boolean;
  private readonly soft: (t: string) => string;
  private static readonly VIEWPORT = 5;

  constructor(
    theme: any,
    paint: (t: string) => string,
    done: (value?: typeof BACK) => void,
    back: boolean,
  ) {
    this.theme = theme;
    this.paint = paint;
    this.done = done;
    this.back = back;
    this.soft = chosenRowPainter(theme);
  }

  private currentWindow(): UsageWindow {
    return USAGE_WINDOWS[this.windowIndex]?.id ?? "all";
  }

  handleInput(data: string): void {
    // Pending inline reset confirmation owns every key (arnative-pi Reset rule).
    if (this.confirmingReset) {
      this.confirmingReset = false;
      if (data === "y" || data === "Y") {
        const trashed = trashUsage();
        if (trashed) {
          session.lastTrash = trashed;
          this.notice = `Moved ${trashed.days} day(s) (${trashed.bytes} B) to ${trashed.trashPath}`;
          this.cursor = 0;
          this.expanded.clear();
        }
      }
      return;
    }

    if (matchesKey(data, "ctrl+c") || matchesKey(data, Key.enter)) {
      this.done();
      return;
    }
    if (matchesKey(data, Key.escape)) {
      this.done(undefined);
      return;
    }
    if (this.back && matchesKey(data, Key.left)) {
      this.done(BACK);
      return;
    }
    if (matchesKey(data, Key.tab)) {
      this.windowIndex = (this.windowIndex + 1) % USAGE_WINDOWS.length;
      this.cursor = 0;
      this.expanded.clear();
      return;
    }
    if (matchesKey(data, "shift+tab")) {
      this.windowIndex = (this.windowIndex - 1 + USAGE_WINDOWS.length) % USAGE_WINDOWS.length;
      this.cursor = 0;
      this.expanded.clear();
      return;
    }

    const summary = readUsageWindow(this.currentWindow());
    const count = summary.providers.length;

    if (matchesKey(data, Key.up) && count > 0) {
      this.cursor = (this.cursor - 1 + count) % count;
      return;
    }
    if (matchesKey(data, Key.down) && count > 0) {
      this.cursor = (this.cursor + 1) % count;
      return;
    }
    if ((matchesKey(data, Key.space) || data === " ") && count > 0) {
      const id = summary.providers[this.cursor]?.providerId;
      if (!id) return;
      if (this.expanded.has(id)) this.expanded.delete(id);
      else this.expanded.add(id);
      return;
    }
    if (matchesKey(data, KEY_SETS.reset) && summary.total.requests > 0) {
      this.confirmingReset = true;
      return;
    }
    if (matchesKey(data, KEY_SETS.undo) && session.lastTrash) {
      if (restoreUsage(session.lastTrash.trashPath)) {
        this.notice = `Restored usage ledger (${session.lastTrash.days} day(s)).`;
        session.lastTrash = undefined;
      }
    }
  }

  render(width: number): string[] {
    const t = this.theme;
    const inner = Math.max(20, width - 4);
    const summary = readUsageWindow(this.currentWindow());
    const g = glyphs();
    const providers = summary.providers;
    if (this.cursor >= providers.length) this.cursor = Math.max(0, providers.length - 1);

    const num = (v: number) => v.toLocaleString("en-US");
    const { start, end } = viewportWindow(providers.length, this.cursor, UsageScreen.VIEWPORT);
    const shownCount = end - start;

    // Window bar (arnative-pi standard: active window accented + bold, viewport counter on right)
    const tabs = USAGE_WINDOWS.map((w, idx) =>
      idx === this.windowIndex ? t.fg("accent", t.bold(w.label)) : t.fg("muted", w.label)
    ).join(t.fg("dim", " · "));
    const counter = providers.length > 0 ? t.fg("dim", `${shownCount}/${providers.length}`) : "";
    const gap = Math.max(2, inner - visibleWidth(tabs) - visibleWidth(counter));
    const windowBar = counter && visibleWidth(tabs) + visibleWidth(counter) + 2 <= inner ? `${tabs}${" ".repeat(gap)}${counter}` : tabs;

    const W = inner >= 68 ? { label: 24, req: 8, tok: 11, cost: 10, fail: 6 } : { label: 18, req: 6, tok: 9, cost: 9, fail: 5 };
    const formatRow = (label: string, b: UsageBucket, style: "soft" | "text" | "muted" | "dim") => {
      const labelCell = padColumn(label, W.label, "left");
      const styledLabel = style === "soft" ? this.soft(labelCell) : t.fg(style, labelCell);
      const nums =
        padColumn(num(b.requests), W.req, "right") +
        padColumn(num(b.inputTokens), W.tok, "right") +
        padColumn(formatUsd(b.cost), W.cost, "right") +
        padColumn(num(b.failed), W.fail, "right");
      return `${styledLabel}${t.fg(b.requests > 0 ? "text" : "dim", nums)}`;
    };

    const lines: string[] = [
      t.fg("accent", t.bold("Decision Eye · Usage")),
      t.fg("muted", "Request counts, input tokens and spend for providers you actually used."),
      "",
      windowBar,
      "",
    ];

    if (providers.length === 0) {
      lines.push(t.fg("muted", "No usage recorded in this window."));
    } else {
      lines.push(
        t.fg(
          "dim",
          padColumn("Provider / Model", W.label) +
            padColumn("Req", W.req, "right") +
            padColumn("In-tok", W.tok, "right") +
            padColumn("Cost", W.cost, "right") +
            padColumn("Fail", W.fail, "right"),
        ),
      );
      if (start > 0) lines.push(t.fg("dim", `↑ ${start} more`));

      for (let i = start; i < end; i++) {
        const row = providers[i];
        const chosen = i === this.cursor;
        const isOpen = this.expanded.has(row.providerId);
        const marker = isOpen ? g.open : g.closed;
        const name = `${marker} ${providerShortName(row.providerId)}`;
        lines.push(formatRow(name, row.totals, chosen ? "soft" : "text"));

        if (isOpen) {
          // Active-only models: strictly models with requests > 0
          for (const m of row.models) {
            lines.push(formatRow(`   ${m.modelId}`, m.totals, "muted"));
          }
        }
      }

      const below = providers.length - end;
      if (below > 0) lines.push(t.fg("dim", `↓ ${below} more`));

      lines.push("");
      lines.push(formatRow("Total", summary.total, "text"));
    }

    // Session stats line
    const s = session.stats;
    const cfg = readConfig();
    const blocked = s.blockedCmd + s.blockedSecret + s.blockedSemantic;
    lines.push("");
    lines.push(
      `${t.fg("dim", "Session")} ${t.fg("dim", "·")} ` +
        `${t.fg("text", `${s.gateCalls}/${cfg.maxGateCalls} gate`)} ${t.fg("dim", "·")} ` +
        `${t.fg(blocked > 0 ? "warning" : "muted", `${blocked} blocked (${s.blockedCmd} cmd · ${s.blockedSecret} sec · ${s.blockedSemantic} sem)`)}`,
    );

    // Cloudflare neuron bar appears ONLY when Cloudflare has actual usage today!
    if (summary.todayNeurons > 0) {
      const budget = clefBudgetStatus(summary.todayNeurons);
      const barW = inner < 64 ? 10 : 14;
      const filled = Math.min(barW, Math.round((budget.used / budget.free) * barW));
      const over = budget.overageUsd > 0 ? t.fg("warning", `over ${formatUsd(budget.overageUsd)}`) : t.fg("success", "free-tier");
      lines.push(
        `${t.fg("dim", "Clef   ")} ${t.fg("dim", "·")} ` +
          `${t.fg(budget.overageUsd > 0 ? "warning" : "success", g.barFull.repeat(filled))}${t.fg("dim", g.barEmpty.repeat(barW - filled))} ` +
          `${t.fg("text", `${num(Math.round(budget.used))}/${num(budget.free)}`)} ${t.fg("dim", "·")} ${over} ${t.fg("dim", "· 00:00 UTC")}`,
      );
    }

    if (this.notice) {
      lines.push(t.fg("muted", this.notice));
    }

    lines.push("");
    if (this.confirmingReset) {
      lines.push(t.fg("warning", "Move usage ledger to trash?  [y] Yes  [Esc] Cancel"));
    } else {
      const legend = [
        ...(providers.length > 0 ? ["[↑↓] Move", "[Space] Expand"] : []),
        "[Tab] Range",
        ...(summary.total.requests > 0 ? [`${keybind(KEY_SETS.reset)} Reset`] : []),
        ...(session.lastTrash ? [`${keybind(KEY_SETS.undo)} Undo`] : []),
        "[Enter] Done",
        ...(this.back ? ["[←] Back"] : []),
        "[Esc] Close",
      ];
      for (const pair of packPairs(legend, inner)) lines.push(t.fg("dim", pair));
    }

    return framedRows(lines, width, this.paint);
  }
}

export async function showUsageScreen(ctx: any, back = false): Promise<void | typeof BACK> {
  if (ctx.mode !== "tui") {
    const summary = readUsageWindow("all");
    const body =
      summary.providers.length === 0
        ? "No usage recorded."
        : summary.providers.map((p) => `${providerShortName(p.providerId)}: ${p.totals.requests} req · ${p.totals.inputTokens} in-tok · ${formatUsd(p.totals.cost)}`).join("\n");
    ctx.ui.notify(`Decision Eye · Usage\n${body}`, "info");
    return;
  }
  return await openCustom<void | typeof BACK>(ctx, (theme, done) =>
    new UsageScreen(theme, borderOf(theme, ctx), done, back)
  );
}

// ============================================================================
// 6. Root Menu Loop (/decision)
// ============================================================================

export async function showRootMenu(ctx: any): Promise<void> {
  let cursor = 0;
  while (true) {
    const cfg = readConfig();
    const store = readAuthStore();
    const connected = PROVIDERS.filter((p) => resolveProviderStatus(p, store).configured);
    const chain = resolveBackendChain(cfg, store);
    const todayUsage = readUsageWindow("today");
    const blocked = session.stats.blockedCmd + session.stats.blockedSecret + session.stats.blockedSemantic;

    const rows = [
      {
        label: "Guard",
        note: `${PRESETS[cfg.preset].label} · ${scopeLabel(cfg.folderScope, ctx.cwd)} · ${blocked} blocked this session`,
      },
      {
        label: "Providers",
        note: connected.length > 0
          ? `${connected.length} connected (${connected.slice(0, 3).map((p) => p.short).join(", ")}${connected.length > 3 ? ", …" : ""})`
          : "connect decision providers with API key only",
      },
      {
        label: "Models",
        note: chain[0]
          ? `primary: ${chain[0].model}${chain[1] ? ` · fallback: ${chain[1].model}` : ""}`
          : "select primary and fallback decision models",
      },
      {
        label: "Usage",
        note: todayUsage.total.requests > 0
          ? `${todayUsage.total.requests} req today · ${formatUsd(todayUsage.total.cost)} · ${todayUsage.providers.length} active`
          : "active-only request, token and spend stats",
      },
    ];

    if (ctx.mode !== "tui") {
      const labels = rows.map((r) => `${r.label} · ${r.note}`);
      const pick = await ctx.ui.select("Decision Eye · Menu", labels);
      if (!pick) return;
      cursor = labels.indexOf(pick);
    } else {
      const picked = await openCustom<number | null>(ctx, (theme, done) =>
        new ListMenu(
          theme,
          borderOf(theme, ctx),
          "Decision Eye · Menu",
          "Guardrails, decision providers and active-only usage for Pi.",
          rows,
          ["[↑↓] Move", "[Enter] Open", `${keybind(KEY_SETS.preset)} Preset`, "[Esc] Close"],
          done,
          cursor,
        )
      );
      if (picked === null) return;
      cursor = picked;
    }

    let outcome: void | typeof BACK;
    if (cursor === 0) outcome = await showGuardScreen(ctx, true);
    else if (cursor === 1) outcome = await showProvidersScreen(ctx, true);
    else if (cursor === 2) outcome = await showModelsScreen(ctx, true);
    else outcome = await showUsageScreen(ctx, true);

    if (outcome !== BACK) return;
  }
}

export class ReviewBoxComponent {
  private readonly text: string;
  private readonly theme: any;
  public isExpanded: boolean;

  constructor(text: string, isExpanded: boolean, theme: any) {
    this.text = text;
    this.isExpanded = isExpanded;
    this.theme = theme;
  }

  render(width: number): string[] {
    const t = this.theme;
    const fg = (color: string, s: string) => (t?.fg ? t.fg(color, s) : s);
    const paint = (s: string) => fg("borderMuted", s);
    const inner = Math.max(10, width - 4);
    const tag = fg("customMessageLabel", "\x1b[1m[pi-decision-eye]\x1b[22m");
    const rightAlignHint = (left: string, hintText: string): string => {
      const hint = fg("dim", hintText);
      const hintWidth = visibleWidth(hint);
      if (inner <= hintWidth + 2) return truncateWidth(`${left} ${hint}`, inner, "");
      const leftTrunc = truncateWidth(left, inner - hintWidth - 1);
      const gap = Math.max(1, inner - visibleWidth(leftTrunc) - hintWidth);
      return `${leftTrunc}${" ".repeat(gap)}${hint}`;
    };

    if (!this.isExpanded) {
      const title = `${tag} ${fg("customMessageText", "Reviewed turn contract.")}`;
      return framedRows([rightAlignHint(title, "[show]")], width, paint);
    }

    const rows: string[] = [];
    for (const rawLine of this.text.split("\n")) {
      if (rows.length === 0 && rawLine.startsWith("[pi-decision-eye]")) {
        const rest = rawLine.slice("[pi-decision-eye]".length).trim();
        const title = `${tag} ${fg("customMessageText", rest)}`;
        rows.push(rightAlignHint(title, "[hide]"));
        continue;
      }
      if (!rawLine) {
        rows.push("");
        continue;
      }
      for (const wrapped of wrapWords(rawLine, inner)) {
        rows.push(fg("customMessageText", wrapped));
      }
    }
    return framedRows(rows, width, paint);
  }

  handleMouse(event: { type?: string; button?: string; clickCount?: number }): { handled: boolean } | undefined {
    if (event?.type === "click" && event?.button === "left" && (event.clickCount ?? 1) === 1) {
      this.isExpanded = !this.isExpanded;
      return { handled: true };
    }
    return undefined;
  }

  invalidate(): void {
    return;
  }
}
