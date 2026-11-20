// Session state, guard presets, portable keybindings, and status-bar sync.

export type GuardPreset = "balanced" | "strict" | "light" | "off";

export interface PresetSpec {
  id: GuardPreset;
  label: string;
  summary: string;
  threshold: number;
  minConfidence: number;
  minDiffLines: number;
  local: boolean;
  doneCheck: boolean;
  semantic: boolean;
}

export const PRESETS: Record<GuardPreset, PresetSpec> = {
  balanced: {
    id: "balanced",
    label: "BALANCED",
    summary: "p≥0.85 · conf≥0.70 · diff≥15 · risk triggers ON",
    threshold: 0.85,
    minConfidence: 0.7,
    minDiffLines: 15,
    local: true,
    doneCheck: true,
    semantic: true,
  },
  strict: {
    id: "strict",
    label: "STRICT",
    summary: "p≥0.75 · conf≥0.65 · diff≥8 · all risks checked",
    threshold: 0.75,
    minConfidence: 0.65,
    minDiffLines: 8,
    local: true,
    doneCheck: true,
    semantic: true,
  },
  light: {
    id: "light",
    label: "LIGHT",
    summary: "local + done-check only · semantic on /eye",
    threshold: 0.85,
    minConfidence: 0.7,
    minDiffLines: 15,
    local: true,
    doneCheck: true,
    semantic: false,
  },
  off: {
    id: "off",
    label: "OFF",
    summary: "all guardrails paused for this session",
    threshold: 0.85,
    minConfidence: 0.7,
    minDiffLines: 15,
    local: false,
    doneCheck: false,
    semantic: false,
  },
};

export const PRESET_ORDER: GuardPreset[] = ["balanced", "strict", "light", "off"];

export const nextPreset = (current: GuardPreset): GuardPreset =>
  PRESET_ORDER[(PRESET_ORDER.indexOf(current) + 1) % PRESET_ORDER.length];

export const KEY_SETS = {
  preset: "ctrl+alt+e",
  scope: "ctrl+alt+u",
  filter: "/",
  primary: "space",
  fallback: "tab",
  toggleAll: "shift+a",
  test: "shift+t",
  remove: "shift+r",
  reset: "shift+r",
  undo: "shift+u",
} as const;

export const keycap = (key: string): string => {
  const parts = key.split("+");
  if (parts.length === 2 && parts[0] === "shift" && parts[1].length === 1) return parts[1].toUpperCase();
  return parts.map((p) => (p.length > 1 ? p[0].toUpperCase() + p.slice(1) : p)).join("+");
};

export const keybind = (key: string): string => `[${keycap(key)}]`;

export const DECISION_SUBCOMMANDS = [
  { value: "guard", label: "guard", description: "Guard preset, folder scope, stage toggles and live session state" },
  { value: "providers", label: "providers", description: "Connect decision model providers with API key only, test latency [T], or remove [R]" },
  { value: "models", label: "models", description: "Select primary [Space] and fallback [Tab] decision models" },
  { value: "usage", label: "usage", description: "Active-only request, token and spend stats with period tabs and reset/undo" },
];

export const decisionCompletions = (prefix: string) => {
  const q = prefix.toLowerCase();
  const hits = DECISION_SUBCOMMANDS.filter((item) => item.value.startsWith(q));
  return hits.length > 0 ? hits : null;
};

export interface CircuitEntry {
  kind: "auth" | "rate";
  until: number;
  detail: string;
}

export interface SessionState {
  dirtyFiles: Set<string>;
  verified: boolean;
  pendingReview?: string;
  pendingVerifyCommands: Map<string, string>;
  budgetNotified: boolean;
  circuit: Map<string, CircuitEntry>;
  latencyMs: Map<string, { ok: boolean; ms: number; detail: string }>;
  lastTrash?: { trashPath: string; days: number; bytes: number };
  stats: {
    gateCalls: number;
    failovers: number;
    blockedCmd: number;
    blockedSecret: number;
    blockedSemantic: number;
    doneReminders: number;
    reviewTurns: number;
  };
}

export function createSessionState(): SessionState {
  return {
    dirtyFiles: new Set<string>(),
    verified: false,
    pendingReview: undefined,
    pendingVerifyCommands: new Map<string, string>(),
    budgetNotified: false,
    circuit: new Map<string, CircuitEntry>(),
    latencyMs: new Map<string, { ok: boolean; ms: number; detail: string }>(),
    lastTrash: undefined,
    stats: {
      gateCalls: 0,
      failovers: 0,
      blockedCmd: 0,
      blockedSecret: 0,
      blockedSemantic: 0,
      doneReminders: 0,
      reviewTurns: 0,
    },
  };
}

export const session: SessionState = createSessionState();

// --- Glyph tiers -----------------------------------------------------------------------------------
// Nerd Font codepoints and emoji are not in every terminal font: a PUA glyph falls back to another
// family at a different advance width and breaks the column maths. So the icon is chosen per machine:
//   PI_DECISION_EYE_ICON=nerd   Nerd Font glyph (\ueb1b)
//   PI_DECISION_EYE_ICON=emoji  emoji (👀), two cells
//   PI_DECISION_EYE_ICON=none   no icon, plain text only
//   unset / auto               Nerd Font when NERD_FONT/PI_NERD_FONT is exported, else emoji
export type IconMode = "nerd" | "emoji" | "none";

export function iconMode(env: NodeJS.ProcessEnv = process.env): IconMode {
  const raw = String(env.PI_DECISION_EYE_ICON ?? "").trim().toLowerCase();
  if (raw === "nerd" || raw === "emoji" || raw === "none") return raw;
  const nerd = String(env.NERD_FONT ?? env.PI_NERD_FONT ?? "").trim().toLowerCase();
  return nerd && nerd !== "0" && nerd !== "false" ? "nerd" : "emoji";
}

export interface Glyphs {
  eye: string;
  ok: string;
  fail: string;
  open: string;
  closed: string;
  barFull: string;
  barEmpty: string;
  on: string;
  off: string;
}

/** Rich glyphs (current look) for fonts that carry them; plain ASCII when the terminal cannot. */
export function glyphs(mode: IconMode = iconMode()): Glyphs {
  const eye = mode === "nerd" ? "\ueb1b " : mode === "emoji" ? "\u{1F440} " : "";
  if (mode === "none") {
    return { eye, ok: "+", fail: "x", open: "v", closed: ">", barFull: "#", barEmpty: ".", on: "*", off: "-" };
  }
  return { eye, ok: "✓", fail: "✕", open: "▾", closed: "▸", barFull: "█", barEmpty: "░", on: "●", off: "○" };
}

export function syncStatus(ctx: any, preset: GuardPreset, activeBackendName?: string): void {
  try {
    const ui = ctx?.ui;
    if (typeof ui?.setStatus !== "function") return;
    const g = glyphs();
    const dot = preset === "off" ? g.off : g.on;
    const label = PRESETS[preset].label;
    const suffix = activeBackendName ? ` (${activeBackendName})` : "";
    ui.setStatus("pi-decision-eye", `${g.eye}Eye: ${dot} ${label}${suffix}`);
  } catch {
    // UI disposed at shutdown
  }
}
