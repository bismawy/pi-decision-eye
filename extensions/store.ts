// Unified persistence: auth.json (0600 secrets), config.json (presets + backends + scope), usage.json (UTC ledger + trash undo).

import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, sep } from "node:path";
import { PRESETS } from "./state.ts";
import type { GuardPreset } from "./state.ts";

export type WireDialect = "systemone" | "gemini-decisions" | "openai-decisions" | "cloudflare-clef";

export interface StoredCredential {
  apiKey?: string;
  accountId?: string;
  baseUrl?: string;
  dialect?: WireDialect;
  customModels?: string[];
}

export interface AuthStore {
  version: 1;
  providers: Record<string, StoredCredential>;
}

export type FolderScopeMode = "all" | "folder" | "disabled";

export interface FolderScope {
  mode: FolderScopeMode;
  folders: string[];
}

export interface EyeConfig {
  version: 1;
  preset: GuardPreset;
  reviewAlways: boolean;
  folderScope: FolderScope;
  primary: string; // "providerId:modelId" or "" for auto
  fallback: string;
  stages: {
    local: boolean;
    doneCheck: boolean;
    semantic: boolean;
  };
  maxGateCalls: number;
}

export interface UsageBucket {
  requests: number;
  ok: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  neurons: number;
}

export interface ProviderUsage extends UsageBucket {
  models: Record<string, UsageBucket>;
}

export interface DayUsage extends UsageBucket {
  providers: Record<string, ProviderUsage>;
}

export interface UsageLedger {
  version: 1;
  days: Record<string, DayUsage>;
}

export type UsageWindow = "all" | "today" | "7d" | "30d" | "3m";

export const EMPTY_BUCKET: UsageBucket = {
  requests: 0,
  ok: 0,
  failed: 0,
  inputTokens: 0,
  outputTokens: 0,
  cost: 0,
  neurons: 0,
};

/** Dynamic home resolution so tests can isolate state via HOME/USERPROFILE without reloading modules. */
export function eyeDir(): string {
  const home = process.env.PI_DECISION_EYE_HOME?.trim() || process.env.HOME?.trim() || process.env.USERPROFILE?.trim() || homedir();
  return join(home, ".pi", "agent", "pi-decision-eye");
}

export const authPath = (): string => join(eyeDir(), "auth.json");
export const configPath = (): string => join(eyeDir(), "config.json");
export const usagePath = (): string => join(eyeDir(), "usage.json");

function isPrivateFile(path: string): boolean {
  try {
    return process.platform === "win32" || (statSync(path).mode & 0o077) === 0;
  } catch {
    return false;
  }
}

function readJson(path: string, requirePrivate = false): any {
  try {
    if (requirePrivate && !isPrivateFile(path)) return undefined;
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

function writeJson(path: string, data: unknown, mode = 0o600): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, { mode });
}

// --- Auth Store ---

export function readAuthStore(): AuthStore {
  const raw = readJson(authPath(), true);
  if (!raw || typeof raw !== "object" || !raw.providers || typeof raw.providers !== "object") {
    return { version: 1, providers: {} };
  }
  const providers: Record<string, StoredCredential> = {};
  for (const [id, entry] of Object.entries(raw.providers)) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    providers[id] = {
      ...(typeof e.apiKey === "string" && e.apiKey.trim() ? { apiKey: e.apiKey.trim() } : {}),
      ...(typeof e.accountId === "string" && e.accountId.trim() ? { accountId: e.accountId.trim() } : {}),
      ...(typeof e.baseUrl === "string" && e.baseUrl.trim() ? { baseUrl: e.baseUrl.trim() } : {}),
      ...(typeof e.dialect === "string" ? { dialect: e.dialect as WireDialect } : {}),
      ...(Array.isArray(e.customModels) ? { customModels: e.customModels.filter((m): m is string => typeof m === "string" && !!m.trim()) } : {}),
    };
  }
  return { version: 1, providers };
}

export function saveCredential(providerId: string, credential: StoredCredential): AuthStore {
  const store = readAuthStore();
  const next: AuthStore = {
    version: 1,
    providers: { ...store.providers, [providerId]: credential },
  };
  writeJson(authPath(), next, 0o600);
  return next;
}

export function deleteCredential(providerId: string): AuthStore {
  const store = readAuthStore();
  const providers = { ...store.providers };
  delete providers[providerId];
  const next: AuthStore = { version: 1, providers };
  if (Object.keys(providers).length === 0) {
    try {
      unlinkSync(authPath());
    } catch {
      // already absent
    }
    return next;
  }
  writeJson(authPath(), next, 0o600);
  return next;
}

// --- Unified Config ---

export function defaultConfig(): EyeConfig {
  const spec = PRESETS.balanced;
  return {
    version: 1,
    preset: "balanced",
    reviewAlways: false,
    folderScope: { mode: "all", folders: [] },
    primary: "",
    fallback: "",
    stages: { local: spec.local, doneCheck: spec.doneCheck, semantic: spec.semantic },
    maxGateCalls: 25,
  };
}

export function applyPreset(config: EyeConfig, preset: GuardPreset): EyeConfig {
  const spec = PRESETS[preset];
  return {
    ...config,
    preset,
    stages: { local: spec.local, doneCheck: spec.doneCheck, semantic: spec.semantic },
  };
}

export function readConfig(): EyeConfig {
  const base = defaultConfig();
  const raw = readJson(configPath());
  if (!raw || typeof raw !== "object") return base;
  const preset: GuardPreset = raw.preset in PRESETS ? raw.preset : base.preset;
  const spec = PRESETS[preset];
  const rawScope = raw.folderScope ?? {};
  const mode: FolderScopeMode =
    rawScope.mode === "folder" || rawScope.mode === "disabled" || rawScope.mode === "all" ? rawScope.mode : "all";
  const folders = Array.isArray(rawScope.folders) ? rawScope.folders.filter((f: unknown): f is string => typeof f === "string" && !!f) : [];
  const effectiveMode: FolderScopeMode = mode === "folder" && folders.length === 0 ? "disabled" : mode;
  const maxGateCalls = Number.isInteger(raw.maxGateCalls) && raw.maxGateCalls > 0 ? raw.maxGateCalls : base.maxGateCalls;
  return {
    version: 1,
    preset,
    reviewAlways: raw.reviewAlways === true,
    folderScope: { mode: effectiveMode, folders },
    primary: typeof raw.primary === "string" ? raw.primary : "",
    fallback: typeof raw.fallback === "string" ? raw.fallback : "",
    stages: {
      local: typeof raw.stages?.local === "boolean" ? raw.stages.local : spec.local,
      doneCheck: typeof raw.stages?.doneCheck === "boolean" ? raw.stages.doneCheck : spec.doneCheck,
      semantic: typeof raw.stages?.semantic === "boolean" ? raw.stages.semantic : spec.semantic,
    },
    maxGateCalls,
  };
}

export function writeConfig(config: EyeConfig): void {
  writeJson(configPath(), { ...config, version: 1 }, 0o600);
}

export function folderAllows(cwd: string, scope: FolderScope): boolean {
  if (scope.mode === "all") return true;
  if (scope.mode === "disabled") return false;
  return scope.folders.some((folder) => cwd === folder || cwd.startsWith(folder.endsWith(sep) ? folder : folder + sep));
}

export function nextFolderScope(scope: FolderScope, cwd: string): FolderScope {
  if (scope.mode === "all") return { mode: "folder", folders: [...new Set([...scope.folders, cwd])] };
  if (scope.mode === "folder") return { mode: "disabled", folders: scope.folders };
  return { mode: "all", folders: scope.folders };
}

export function scopeLabel(scope: FolderScope, cwd: string): string {
  if (scope.mode === "all") return "ALL";
  if (scope.mode === "disabled") return "OFF";
  return folderAllows(cwd, scope) ? `FOLDER (${scope.folders.length})` : "FOLDER (outside)";
}

// --- Usage Ledger (UTC, active-only aggregation, trash-backed reset) ---

export const utcToday = (now = new Date()): string => now.toISOString().slice(0, 10);

function utcOffset(now: Date, days: number): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days)).toISOString().slice(0, 10);
}

function windowSince(window: UsageWindow, now: Date): string {
  if (window === "all") return "";
  if (window === "today") return utcToday(now);
  if (window === "7d") return utcOffset(now, -6);
  if (window === "30d") return utcOffset(now, -29);
  return utcOffset(now, -89);
}

function addBuckets(a: UsageBucket, b: Partial<UsageBucket>): UsageBucket {
  return {
    requests: a.requests + (Number(b.requests) || 0),
    ok: a.ok + (Number(b.ok) || 0),
    failed: a.failed + (Number(b.failed) || 0),
    inputTokens: a.inputTokens + (Number(b.inputTokens) || 0),
    outputTokens: a.outputTokens + (Number(b.outputTokens) || 0),
    cost: a.cost + (Number(b.cost) || 0),
    neurons: a.neurons + (Number(b.neurons) || 0),
  };
}

export function readUsageLedger(): UsageLedger {
  const raw = readJson(usagePath());
  if (!raw || typeof raw !== "object" || !raw.days || typeof raw.days !== "object") {
    return { version: 1, days: {} };
  }
  return { version: 1, days: raw.days as Record<string, DayUsage> };
}

export function recordUsage(providerId: string, modelId: string, patch: Partial<UsageBucket>, now = new Date()): void {
  try {
    const ledger = readUsageLedger();
    const dayKey = utcToday(now);
    const existing: DayUsage = ledger.days[dayKey] ?? { ...EMPTY_BUCKET, providers: {} };
    const nextDay = addBuckets(existing, patch);

    const providers = { ...(existing.providers ?? {}) };
    const prevProv: ProviderUsage = providers[providerId] ?? { ...EMPTY_BUCKET, models: {} };
    const nextProv = addBuckets(prevProv, patch);
    const models = { ...(prevProv.models ?? {}) };
    models[modelId] = addBuckets(models[modelId] ?? EMPTY_BUCKET, patch);
    providers[providerId] = { ...nextProv, models };

    ledger.days[dayKey] = { ...nextDay, providers };
    for (const stale of Object.keys(ledger.days).sort().slice(0, -92)) delete ledger.days[stale];
    writeJson(usagePath(), ledger, 0o600);
  } catch {
    // Ledger persistence must never fail a decision call
  }
}

export interface ActiveProviderRow {
  providerId: string;
  totals: UsageBucket;
  models: { modelId: string; totals: UsageBucket }[];
}

export interface UsageSummary {
  total: UsageBucket;
  providers: ActiveProviderRow[];
  todayNeurons: number;
}

/** Aggregates usage strictly for providers and models that have requests > 0 in the selected window. */
export function readUsageWindow(window: UsageWindow, now = new Date()): UsageSummary {
  const ledger = readUsageLedger();
  const since = windowSince(window, now);
  let total: UsageBucket = { ...EMPTY_BUCKET };
  const provMap = new Map<string, { totals: UsageBucket; models: Map<string, UsageBucket> }>();

  for (const [day, entry] of Object.entries(ledger.days)) {
    if (since && day < since) continue;
    total = addBuckets(total, entry);
    for (const [provId, pEntry] of Object.entries(entry.providers ?? {})) {
      if ((pEntry?.requests ?? 0) <= 0) continue;
      let acc = provMap.get(provId);
      if (!acc) {
        acc = { totals: { ...EMPTY_BUCKET }, models: new Map() };
        provMap.set(provId, acc);
      }
      acc.totals = addBuckets(acc.totals, pEntry);
      for (const [modelId, mEntry] of Object.entries(pEntry.models ?? {})) {
        if ((mEntry?.requests ?? 0) <= 0) continue;
        acc.models.set(modelId, addBuckets(acc.models.get(modelId) ?? EMPTY_BUCKET, mEntry));
      }
    }
  }

  const providers: ActiveProviderRow[] = [...provMap.entries()]
    .filter(([, acc]) => acc.totals.requests > 0)
    .map(([providerId, acc]) => ({
      providerId,
      totals: acc.totals,
      models: [...acc.models.entries()]
        .filter(([, m]) => m.requests > 0)
        .map(([modelId, totals]) => ({ modelId, totals }))
        .sort((a, b) => b.totals.requests - a.totals.requests),
    }))
    .sort((a, b) => b.totals.requests - a.totals.requests);

  const todayEntry = ledger.days[utcToday(now)];
  const todayNeurons = Number(todayEntry?.providers?.cloudflare?.neurons ?? 0);

  return { total, providers, todayNeurons };
}

/** Moves usage.json into usage-trash/<timestamp>/usage.json so Reset can be undone safely. */
export function trashUsage(now = new Date()): { trashPath: string; days: number; bytes: number } | null {
  const src = usagePath();
  if (!existsSync(src)) return null;
  const ledger = readUsageLedger();
  const days = Object.keys(ledger.days).length;
  const bytes = statSync(src).size;
  const stamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dstDir = join(eyeDir(), "usage-trash", stamp);
  mkdirSync(dstDir, { recursive: true });
  const trashPath = join(dstDir, "usage.json");
  renameSync(src, trashPath);
  return { trashPath, days, bytes };
}

export function restoreUsage(trashPath: string): boolean {
  if (!existsSync(trashPath)) return false;
  mkdirSync(eyeDir(), { recursive: true });
  renameSync(trashPath, usagePath());
  return true;
}
