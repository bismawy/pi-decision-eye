// 14 built-in decision model providers, 3 wire dialect adapters, live discovery, auto-wiring, probe, and failover circuit breaker.

import { session } from "./state.ts";
import { readAuthStore, readConfig, recordUsage, writeConfig } from "./store.ts";
import type { AuthStore, EyeConfig, StoredCredential, WireDialect } from "./store.ts";

export interface ProviderSpec {
  id: string;
  label: string;
  short: string;
  endpoint: string;
  endpointDisplay: string;
  dialect: WireDialect;
  keyEnv: string;
  keyHint: string;
  defaultModel: string;
  models: string[];
  /** Estimated USD per 1M input tokens (output tokens are free on decision APIs). */
  usdPerMTok: Record<string, number>;
  keyOptional?: boolean;
  customEndpoint?: boolean;
  accountEnv?: string;
}

export const PROVIDERS: ProviderSpec[] = [
  {
    id: "liquid",
    label: "Liquid AI",
    short: "Liquid AI",
    endpoint: "https://api.liquid.ai/decisions/v1/systemone",
    endpointDisplay: "api.liquid.ai/decisions",
    dialect: "systemone",
    keyEnv: "LIQUID_API_KEY",
    keyHint: "console.liquid.ai > API Keys",
    defaultModel: "d1.2",
    models: ["d1.2", "d1.2-ultra"],
    usdPerMTok: { "d1.2": 0.02, "d1.2-ultra": 0.042 },
  },
  {
    id: "perplexity",
    label: "Perplexity",
    short: "Perplexity",
    endpoint: "https://api.perplexity.ai/v1/decisions",
    endpointDisplay: "api.perplexity.ai/v1/decisions",
    dialect: "systemone",
    keyEnv: "PERPLEXITY_API_KEY",
    keyHint: "console.perplexity.ai > API Keys",
    defaultModel: "pplx-decider-latest",
    models: ["pplx-decider-latest", "pplx-decider-flash-latest", "pplx-decider-v1.3", "pplx-decider-flash-v1.3"],
    usdPerMTok: {
      "pplx-decider-latest": 0.02,
      "pplx-decider-v1.3": 0.02,
      "pplx-decider-flash-latest": 0.01,
      "pplx-decider-flash-v1.3": 0.01,
    },
  },
  {
    id: "inception",
    label: "Inception (Mercury)",
    short: "Inception",
    endpoint: "https://api.inceptionlabs.ai/v1/decisions",
    endpointDisplay: "api.inceptionlabs.ai/v1/decisions",
    dialect: "systemone",
    keyEnv: "INCEPTION_API_KEY",
    keyHint: "platform.inceptionlabs.ai/dashboard/api-keys",
    defaultModel: "mercury-decide",
    models: ["mercury-decide"],
    usdPerMTok: { "mercury-decide": 0.02 },
  },
  {
    id: "baseten",
    label: "Baseten",
    short: "Baseten",
    endpoint: "https://inference.baseten.co/v1/systemone",
    endpointDisplay: "inference.baseten.co/v1/systemone",
    dialect: "systemone",
    keyEnv: "BASETEN_API_KEY",
    keyHint: "app.baseten.co > Settings > API keys",
    defaultModel: "decision-models/baseten-mammoth-27b-latest",
    models: [
      "decision-models/baseten-mammoth-27b-latest",
      "decision-models/baseten-elephant-9b-latest",
      "decision-models/baseten-joey-2b-latest",
    ],
    usdPerMTok: {
      "decision-models/baseten-mammoth-27b-latest": 0.1,
      "decision-models/baseten-elephant-9b-latest": 0.04,
      "decision-models/baseten-joey-2b-latest": 0.01,
    },
  },
  {
    id: "nace",
    label: "Nace.AI (Drex)",
    short: "Nace.AI",
    endpoint: "https://console.nace.ai/v1/systemone",
    endpointDisplay: "console.nace.ai/v1/systemone",
    dialect: "systemone",
    keyEnv: "NACE_API_KEY",
    keyHint: "console.nace.ai > API Keys",
    defaultModel: "drex-latest",
    models: ["drex-latest", "drex-max", "drex-v2.0", "drex-v1.5"],
    usdPerMTok: { "drex-latest": 0.06, "drex-max": 0.06, "drex-v2.0": 0.06, "drex-v1.5": 0.04 },
  },
  {
    id: "typesafe",
    label: "TypeSafe (Jev)",
    short: "TypeSafe",
    endpoint: "https://api.typesafe.ai/v1/systemone",
    endpointDisplay: "api.typesafe.ai/v1/systemone",
    dialect: "systemone",
    keyEnv: "TYPESAFE_API_KEY",
    keyHint: "console.typesafe.ai > API Keys",
    defaultModel: "jev-latest",
    models: ["jev-latest"],
    usdPerMTok: { "jev-latest": 0.042 },
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    short: "OpenRouter",
    endpoint: "https://openrouter.ai/api/alpha/decisions",
    endpointDisplay: "openrouter.ai/api/alpha/decisions",
    dialect: "systemone",
    keyEnv: "OPENROUTER_API_KEY",
    keyHint: "openrouter.ai/settings/keys",
    defaultModel: "typesafe/jev-1.14",
    models: [
      "typesafe/jev-1.14",
      "liquid/d1.2",
      "inception/mercury-decide",
      "cloudflare/clef-flash",
      "openai/gpt-6-luna-decisions",
    ],
    usdPerMTok: {
      "typesafe/jev-1.14": 0.042,
      "liquid/d1.2": 0.02,
      "inception/mercury-decide": 0.02,
      "cloudflare/clef-flash": 0.038,
      "openai/gpt-6-luna-decisions": 0.1,
    },
  },
  {
    id: "opper",
    label: "Opper AI",
    short: "Opper AI",
    endpoint: "https://api.opper.ai/v3/compat/v1/systemone",
    endpointDisplay: "api.opper.ai/v3/compat/v1/systemone",
    dialect: "systemone",
    keyEnv: "OPPER_API_KEY",
    keyHint: "platform.opper.ai > API Keys",
    defaultModel: "typesafe/jev-1.14.0",
    models: [
      "typesafe/jev-1.14.0",
      "liquid/d1-ultra",
      "perplexity/pplx-decider-v1.2",
      "morph/reflex",
      "azure:global/microsoft-decision-1",
    ],
    usdPerMTok: {
      "typesafe/jev-1.14.0": 0.04,
      "liquid/d1-ultra": 0.04,
      "perplexity/pplx-decider-v1.2": 0.02,
      "morph/reflex": 0.04,
      "azure:global/microsoft-decision-1": 0.04,
    },
  },
  {
    id: "gemini",
    label: "Google Gemini",
    short: "Gemini",
    endpoint: "https://generativelanguage.googleapis.com/v1beta/decisions",
    endpointDisplay: "generativelanguage.googleapis.com",
    dialect: "gemini-decisions",
    keyEnv: "GEMINI_API_KEY",
    keyHint: "aistudio.google.com > API Keys",
    defaultModel: "gemini-decision-1",
    models: ["gemini-decision-1"],
    usdPerMTok: { "gemini-decision-1": 0.1 },
  },
  {
    id: "openai",
    label: "OpenAI",
    short: "OpenAI",
    endpoint: "https://api.openai.com/v1/decisions",
    endpointDisplay: "api.openai.com/v1/decisions",
    dialect: "openai-decisions",
    keyEnv: "OPENAI_API_KEY",
    keyHint: "platform.openai.com/api-keys",
    defaultModel: "gpt-6-luna",
    models: ["gpt-6-luna"],
    usdPerMTok: { "gpt-6-luna": 0.1 },
  },
  {
    id: "cloudflare",
    label: "Cloudflare AI (Clef)",
    short: "Cloudflare",
    endpoint: "https://api.cloudflare.com/client/v4/accounts/{accountId}/ai/run/@cf/cloudflare/{model}",
    endpointDisplay: "workers-ai (auto account id)",
    dialect: "cloudflare-clef",
    keyEnv: "CLOUDFLARE_API_TOKEN",
    accountEnv: "CLOUDFLARE_ACCOUNT_ID",
    keyHint: "dash.cloudflare.com > API Tokens (Workers AI: Read)",
    defaultModel: "clef-flash",
    models: ["clef-flash", "clef", "clef-omni"],
    usdPerMTok: { "clef-flash": 0.038, clef: 0.24, "clef-omni": 0.15 },
  },
  {
    id: "upstage",
    label: "Upstage (Solar)",
    short: "Upstage",
    endpoint: "https://api.upstage.ai/v1/systemone",
    endpointDisplay: "api.upstage.ai/v1/systemone",
    dialect: "systemone",
    keyEnv: "UPSTAGE_API_KEY",
    keyHint: "console.upstage.ai > API Keys",
    defaultModel: "solar-decide",
    models: ["solar-decide"],
    usdPerMTok: { "solar-decide": 0.1 },
  },
  {
    id: "ollama",
    label: "Ollama (Local)",
    short: "Ollama",
    endpoint: "http://127.0.0.1:11434/v1/systemone",
    endpointDisplay: "127.0.0.1:11434/v1/systemone",
    dialect: "systemone",
    keyEnv: "OLLAMA_API_KEY",
    keyHint: "Local Ollama v0.35+ (ollama pull clef-flash)",
    defaultModel: "clef-flash",
    models: ["clef-flash", "clef", "nimble", "pplx-decider", "tev1"],
    usdPerMTok: {},
    keyOptional: true,
  },
  {
    id: "custom",
    label: "Custom Endpoint",
    short: "Custom",
    endpoint: "http://127.0.0.1:8080/v1/decisions",
    endpointDisplay: "custom baseURL + dialect",
    dialect: "systemone",
    keyEnv: "DECISION_CUSTOM_API_KEY",
    keyHint: "LiteLLM, Bifrost, vLLM, Azure Foundry, or Decider for Mac",
    defaultModel: "default",
    models: [],
    usdPerMTok: {},
    keyOptional: true,
    customEndpoint: true,
  },
];

export const CLEF_FREE_NEURONS_PER_DAY = 10_000;
export const CLEF_USD_PER_KN = 0.011;
const CLEF_NEURONS_PER_MTOK: Record<string, number> = { clef: 21818, "clef-flash": 3455, "clef-omni": 13636 };
const DECISION_TIMEOUT_MS = 6000;
const RATE_COOLDOWN_MS = 60_000;

export const providerById = (id: string): ProviderSpec | undefined => PROVIDERS.find((p) => p.id === id);
export const providerShortName = (id: string): string => providerById(id)?.short ?? id;
export const isCloudflareAccountId = (value: string): boolean => /^[0-9a-f]{32}$/i.test(value);
export const isPlausibleKey = (key: string): boolean => key.length >= 8 && key.length <= 512 && !/\s/.test(key) && /^[\x21-\x7e]+$/.test(key);
export const modelRef = (providerId: string, model: string): string => `${providerId}:${model}`;

export function splitModelRef(ref: string): { providerId: string; model: string } {
  const idx = ref.indexOf(":");
  return idx < 0 ? { providerId: ref, model: "" } : { providerId: ref.slice(0, idx), model: ref.slice(idx + 1) };
}

export function clefNeurons(model: string, inputTokens: number): number {
  const rate = CLEF_NEURONS_PER_MTOK[model] ?? CLEF_NEURONS_PER_MTOK["clef-flash"];
  return ((Number(inputTokens) || 0) * rate) / 1e6;
}

export function clefBudgetStatus(usedToday: number): { used: number; free: number; overageUsd: number } {
  const used = Math.max(0, Number(usedToday) || 0);
  const over = Math.max(0, used - CLEF_FREE_NEURONS_PER_DAY);
  return { used, free: CLEF_FREE_NEURONS_PER_DAY, overageUsd: (over / 1000) * CLEF_USD_PER_KN };
}

export function estimateUsd(provider: ProviderSpec, model: string, inputTokens: number): number {
  if (provider.id === "ollama") return 0;
  const perM = provider.usdPerMTok[model] ?? Object.values(provider.usdPerMTok)[0] ?? 0.04;
  return ((Number(inputTokens) || 0) * perM) / 1e6;
}

export function formatPriceTag(provider: ProviderSpec, model: string): string {
  if (provider.id === "ollama") return "local $0";
  const perM = provider.usdPerMTok[model];
  if (perM === undefined) return "";
  return `$${perM < 0.01 ? perM.toFixed(3) : perM.toFixed(perM * 100 % 1 === 0 ? 2 : 3)}/M`;
}

// --- Live discovered models cache (per session) ---

const liveModels = new Map<string, string[]>();
let ollamaReachable = false;

export function setLiveModels(providerId: string, models: string[]): void {
  const clean = [...new Set(models.map((m) => m.trim()).filter(Boolean))];
  if (clean.length > 0) liveModels.set(providerId, clean);
}

export function setOllamaReachable(reachable: boolean): void {
  ollamaReachable = reachable;
}

export function modelsForProvider(provider: ProviderSpec, store: AuthStore = readAuthStore()): string[] {
  const stored = store.providers[provider.id];
  if (provider.customEndpoint) {
    return stored?.customModels?.length ? stored.customModels : [provider.defaultModel];
  }
  const discovered = liveModels.get(provider.id);
  if (discovered && discovered.length > 0) return discovered;
  return provider.models;
}

// --- Resolved runtime auth ---

export interface ResolvedBackend {
  provider: ProviderSpec;
  model: string;
  ref: string;
  url: string;
  dialect: WireDialect;
  apiKey: string;
  accountId?: string;
  source: "env" | "stored" | "local";
}

export function resolveProviderStatus(provider: ProviderSpec, store: AuthStore = readAuthStore()): {
  configured: boolean;
  source: "env" | "stored" | "local" | "unset";
  credential?: StoredCredential;
} {
  const envKey = process.env[provider.keyEnv]?.trim();
  const stored = store.providers[provider.id];

  if (provider.id === "ollama") {
    if (stored?.baseUrl || ollamaReachable) return { configured: true, source: stored?.baseUrl ? "stored" : "local", credential: stored };
    return { configured: false, source: "unset" };
  }

  if (provider.customEndpoint) {
    if (stored?.baseUrl) return { configured: true, source: "stored", credential: stored };
    return { configured: false, source: "unset" };
  }

  if (envKey) {
    if (provider.accountEnv) {
      const acc = process.env[provider.accountEnv]?.trim() || stored?.accountId;
      if (!acc) return { configured: false, source: "unset" };
      return { configured: true, source: "env", credential: { apiKey: envKey, accountId: acc } };
    }
    return { configured: true, source: "env", credential: { apiKey: envKey } };
  }

  if (stored?.apiKey) {
    if (provider.accountEnv && !stored.accountId) return { configured: false, source: "unset" };
    return { configured: true, source: "stored", credential: stored };
  }

  return { configured: false, source: "unset" };
}

export function buildEndpointUrl(provider: ProviderSpec, model: string, credential?: StoredCredential): string {
  if (provider.id === "cloudflare") {
    const accountId = credential?.accountId ?? "";
    return `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/cloudflare/${model}`;
  }
  if (credential?.baseUrl) return credential.baseUrl;
  return provider.endpoint;
}

export function resolveBackend(ref: string, store: AuthStore = readAuthStore()): ResolvedBackend | undefined {
  const { providerId, model } = splitModelRef(ref);
  const provider = providerById(providerId);
  if (!provider) return undefined;
  const status = resolveProviderStatus(provider, store);
  if (!status.configured || status.source === "unset") return undefined;
  const chosenModel = model || modelsForProvider(provider, store)[0] || provider.defaultModel;
  return {
    provider,
    model: chosenModel,
    ref: modelRef(provider.id, chosenModel),
    url: buildEndpointUrl(provider, chosenModel, status.credential),
    dialect: status.credential?.dialect ?? provider.dialect,
    apiKey: status.credential?.apiKey ?? "",
    accountId: status.credential?.accountId,
    source: status.source,
  };
}

export interface CatalogItem {
  ref: string;
  providerId: string;
  providerShort: string;
  model: string;
  priceTag: string;
  configured: boolean;
}

export function listCatalog(store: AuthStore = readAuthStore()): CatalogItem[] {
  const items: CatalogItem[] = [];
  for (const provider of PROVIDERS) {
    const { configured } = resolveProviderStatus(provider, store);
    for (const model of modelsForProvider(provider, store)) {
      items.push({
        ref: modelRef(provider.id, model),
        providerId: provider.id,
        providerShort: provider.short,
        model,
        priceTag: formatPriceTag(provider, model),
        configured,
      });
    }
  }
  return items;
}

export function resolveBackendChain(config: EyeConfig = readConfig(), store: AuthStore = readAuthStore()): ResolvedBackend[] {
  const chain: ResolvedBackend[] = [];
  const pushUnique = (backend: ResolvedBackend | undefined) => {
    if (!backend) return;
    if (!chain.some((item) => item.ref === backend.ref)) chain.push(backend);
  };

  if (config.primary) pushUnique(resolveBackend(config.primary, store));
  if (config.fallback) pushUnique(resolveBackend(config.fallback, store));

  if (chain.length === 0) {
    for (const provider of PROVIDERS) {
      const status = resolveProviderStatus(provider, store);
      if (status.configured) {
        const defaultM = modelsForProvider(provider, store)[0] || provider.defaultModel;
        pushUnique(resolveBackend(modelRef(provider.id, defaultM), store));
        break;
      }
    }
  }
  return chain;
}

/** Auto-wires primary on first login and fallback on second login so new users need zero extra setup. */
export function autoWireBackend(providerId: string, model: string): { assigned: "primary" | "fallback" | null; config: EyeConfig } {
  const cfg = readConfig();
  const ref = modelRef(providerId, model);
  if (!cfg.primary) {
    const next = { ...cfg, primary: ref };
    writeConfig(next);
    return { assigned: "primary", config: next };
  }
  if (!cfg.fallback && cfg.primary !== ref) {
    const next = { ...cfg, fallback: ref };
    writeConfig(next);
    return { assigned: "fallback", config: next };
  }
  return { assigned: null, config: cfg };
}

// --- Normalized Decision Request / Response across 3 wire dialects ---

export type DecisionQuestion =
  | { name: string; type: "yesno"; instructions: string }
  | { name: string; type: "choice"; instructions: string; criteria: Record<string, string> }
  | { name: string; type: "score"; instructions: string; levels: string[] };

export type NormalizedAnswer =
  | { type: "yesno"; p: number; confidence: number }
  | { type: "choice"; choice: string; probabilities: Record<string, number>; confidence: number }
  | { type: "score"; score: number; confidence: number };

export interface DecisionResult {
  model: string;
  answers: Record<string, NormalizedAnswer>;
  usage: { inputTokens: number; outputTokens: number; cost?: number };
}

export function buildWirePayload(
  dialect: WireDialect,
  model: string,
  state: unknown,
  questions: DecisionQuestion[],
): Record<string, unknown> {
  if (dialect === "openai-decisions") {
    const input = typeof state === "string" ? state : JSON.stringify(state);
    return {
      model,
      input,
      questions: questions.map((q) => {
        if (q.type === "yesno") return { name: q.name, type: "predicate", instructions: q.instructions };
        if (q.type === "choice") {
          return {
            name: q.name,
            type: "choice",
            instructions: q.instructions,
            choices: Object.entries(q.criteria).map(([value, description]) => ({ value, description })),
          };
        }
        return {
          name: q.name,
          type: "score",
          instructions: q.instructions,
          levels: q.levels.map((label, idx) => ({ label: `L${idx}`, description: label })),
        };
      }),
    };
  }

  const questionMap: Record<string, unknown> = {};
  for (const q of questions) {
    if (q.type === "yesno") questionMap[q.name] = { type: "noul", instructions: q.instructions };
    else if (q.type === "choice") questionMap[q.name] = { type: "choice", instructions: q.instructions, criteria: q.criteria };
    else questionMap[q.name] = { type: "score", instructions: q.instructions, criteria: q.levels };
  }

  if (dialect === "gemini-decisions") {
    const input = typeof state === "string" ? state : JSON.stringify(state);
    return { model, input, questions: questionMap };
  }

  // systemone & cloudflare-clef
  return { model, state, questions: questionMap };
}

export function buildWireHeaders(dialect: WireDialect, apiKey: string): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (!apiKey) return headers;
  if (dialect === "gemini-decisions") headers["x-goog-api-key"] = apiKey;
  else headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

function clamp01(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback;
}

/** Derives confidence for yes/no answers when a provider omits an explicit confidence field. */
function yesnoConfidence(p: number, explicit: unknown): number {
  const n = Number(explicit);
  if (Number.isFinite(n) && n >= 0 && n <= 1) return n;
  return Math.max(p, 1 - p);
}

export function parseWireResponse(dialect: WireDialect, rawJson: any, fallbackModel: string): DecisionResult | null {
  if (!rawJson || typeof rawJson !== "object") return null;

  if (dialect === "cloudflare-clef") {
    if (rawJson.success === false) return null;
    const inner = "result" in rawJson ? rawJson.result : rawJson;
    return parseWireResponse("systemone", inner, fallbackModel);
  }

  if (dialect === "openai-decisions") {
    if (!Array.isArray(rawJson.answers)) return null;
    const answers: Record<string, NormalizedAnswer> = {};
    for (const item of rawJson.answers) {
      if (!item || typeof item.name !== "string") continue;
      if (item.type === "predicate" && typeof item.probability === "number") {
        const p = clamp01(item.probability);
        answers[item.name] = { type: "yesno", p, confidence: yesnoConfidence(p, item.confidence) };
      } else if (item.type === "choice" && typeof item.choice === "string") {
        const probs: Record<string, number> = {};
        if (Array.isArray(item.probabilities)) {
          for (const entry of item.probabilities) {
            if (entry?.value) probs[String(entry.value)] = clamp01(entry.probability);
          }
        }
        answers[item.name] = { type: "choice", choice: item.choice, probabilities: probs, confidence: clamp01(item.confidence, probs[item.choice] ?? 1) };
      } else if (item.type === "score" && typeof item.score === "number") {
        answers[item.name] = { type: "score", score: item.score, confidence: clamp01(item.confidence, 1) };
      }
    }
    if (Object.keys(answers).length === 0) return null;
    return {
      model: String(rawJson.model ?? fallbackModel),
      answers,
      usage: {
        inputTokens: Number(rawJson.usage?.input_tokens) || 0,
        outputTokens: Number(rawJson.usage?.output_tokens) || 0,
        ...(Number.isFinite(Number(rawJson.usage?.cost)) ? { cost: Number(rawJson.usage.cost) } : {}),
      },
    };
  }

  // systemone & gemini-decisions both return `answers` as a keyed object
  const rawAnswers = rawJson.answers;
  if (!rawAnswers || typeof rawAnswers !== "object" || Array.isArray(rawAnswers)) return null;
  const answers: Record<string, NormalizedAnswer> = {};
  for (const [name, item] of Object.entries<any>(rawAnswers)) {
    if (!item || typeof item !== "object") continue;
    if (typeof item.noul === "number") {
      const p = clamp01(item.noul);
      answers[name] = { type: "yesno", p, confidence: yesnoConfidence(p, item.confidence) };
    } else if (typeof item.choice === "string") {
      const probs: Record<string, number> = {};
      if (item.probabilities && typeof item.probabilities === "object") {
        for (const [k, v] of Object.entries(item.probabilities)) probs[k] = clamp01(v);
      }
      answers[name] = { type: "choice", choice: item.choice, probabilities: probs, confidence: clamp01(item.confidence, probs[item.choice] ?? 1) };
    } else if (typeof item.score === "number") {
      answers[name] = { type: "score", score: item.score, confidence: clamp01(item.confidence, 1) };
    }
  }
  if (Object.keys(answers).length === 0) return null;

  const usageObj = rawJson.usage ?? {};
  const inputTokens = Number(usageObj.input_tokens ?? usageObj.total_input_tokens) || 0;
  const outputTokens = Number(usageObj.output_tokens ?? usageObj.total_output_tokens) || 0;
  const cost = Number.isFinite(Number(usageObj.cost)) ? Number(usageObj.cost) : undefined;

  return {
    model: String(rawJson.model ?? fallbackModel),
    answers,
    usage: { inputTokens, outputTokens, cost },
  };
}

// --- Cloudflare Auto Account ID Discovery ---

export async function resolveCloudflareAccounts(token: string, fetchImpl: typeof fetch = fetch): Promise<{ id: string; name: string }[]> {
  try {
    const res = await fetchImpl("https://api.cloudflare.com/client/v4/accounts?per_page=10", {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const json: any = await res.json();
    if (!Array.isArray(json?.result)) return [];
    return json.result
      .filter((a: any) => typeof a?.id === "string" && isCloudflareAccountId(a.id))
      .map((a: any) => ({ id: a.id, name: String(a?.name ?? a.id) }));
  } catch {
    return [];
  }
}

// --- Live Model Discovery (session start, non-blocking, fail-safe) ---

export async function refreshLiveModels(store: AuthStore = readAuthStore(), fetchImpl: typeof fetch = fetch): Promise<void> {
  const tasks: Promise<void>[] = [];

  // OpenRouter public decision model catalog
  if (resolveProviderStatus(providerById("openrouter")!, store).configured) {
    tasks.push(
      fetchImpl("https://openrouter.ai/api/v1/models?output_modalities=decisions", { signal: AbortSignal.timeout(3500) })
        .then((r) => (r.ok ? r.json() : null))
        .then((json: any) => {
          const ids = (json?.data ?? []).map((m: any) => String(m?.id ?? "")).filter(Boolean);
          if (ids.length > 0) setLiveModels("openrouter", ids);
        })
        .catch(() => {})
    );
  }

  // Cloudflare Clef models
  const cfStatus = resolveProviderStatus(providerById("cloudflare")!, store);
  if (cfStatus.configured && cfStatus.credential?.accountId && cfStatus.credential?.apiKey) {
    const { accountId, apiKey } = cfStatus.credential;
    tasks.push(
      fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/models/search?search=clef`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(3500),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((json: any) => {
          const ids = (json?.result ?? [])
            .map((e: any) => String(e?.name ?? ""))
            .filter((name: string) => name.startsWith("@cf/cloudflare/clef"))
            .map((name: string) => name.slice(name.lastIndexOf("/") + 1));
          if (ids.length > 0) setLiveModels("cloudflare", ids);
        })
        .catch(() => {})
    );
  }

  // Nace.AI Drex models
  if (resolveProviderStatus(providerById("nace")!, store).configured) {
    tasks.push(
      fetchImpl("https://console.nace.ai/v1/models", { signal: AbortSignal.timeout(3500) })
        .then((r) => (r.ok ? r.json() : null))
        .then((json: any) => {
          const list = Array.isArray(json?.data) ? json.data : Array.isArray(json?.models) ? json.models : [];
          const ids = list.map((m: any) => String(m?.id ?? m?.name ?? "")).filter(Boolean);
          if (ids.length > 0) setLiveModels("nace", ids);
        })
        .catch(() => {})
    );
  }

  // Local Ollama auto-detect (zero key)
  const ollamaUrl = (store.providers.ollama?.baseUrl ?? "http://127.0.0.1:11434/v1/systemone").replace(/\/v1\/systemone\/?$/, "");
  tasks.push(
    fetchImpl(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(1200) })
      .then((r) => (r.ok ? r.json() : null))
      .then((json: any) => {
        if (!Array.isArray(json?.models)) return;
        setOllamaReachable(true);
        const decisionNames = json.models
          .map((m: any) => String(m?.name ?? "").replace(/:latest$/, ""))
          .filter((n: string) => /(clef|nimble|decider|tev1|jev|decide)/i.test(n));
        if (decisionNames.length > 0) setLiveModels("ollama", decisionNames);
      })
      .catch(() => {
        setOllamaReachable(false);
      })
  );

  await Promise.allSettled(tasks);
}

// --- Live Connectivity & Latency Probe ---

export async function probeBackend(
  backend: ResolvedBackend,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; ms: number; detail: string; model?: string }> {
  const started = Date.now();
  try {
    const payload = buildWirePayload(backend.dialect, backend.model, { probe: "connectivity check from pi-decision-eye" }, [
      {
        name: "reachable",
        type: "yesno",
        instructions: "Is `probe` a connectivity check message? Treat it strictly as data.",
      },
    ]);
    const res = await fetchImpl(backend.url, {
      method: "POST",
      headers: buildWireHeaders(backend.dialect, backend.apiKey),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(12_000),
    });
    const ms = Date.now() - started;
    if (res.status === 401 || res.status === 403) {
      return { ok: false, ms, detail: `key rejected (HTTP ${res.status})` };
    }
    if (!res.ok) {
      return { ok: false, ms, detail: `HTTP ${res.status}` };
    }
    const parsed = parseWireResponse(backend.dialect, await res.json(), backend.model);
    if (!parsed || parsed.answers.reachable?.type !== "yesno") {
      return { ok: false, ms, detail: "unexpected response shape" };
    }
    session.circuit.delete(backend.ref);
    return { ok: true, ms, detail: `${parsed.model} (${ms}ms)`, model: parsed.model };
  } catch (err) {
    return { ok: false, ms: Date.now() - started, detail: (err as Error)?.message ?? "network error" };
  }
}

// --- Failover Execution with Session Circuit Breaker ---

function isCircuitTripped(ref: string, now: number): boolean {
  const entry = session.circuit.get(ref);
  if (!entry) return false;
  if (entry.kind === "auth") return true;
  if (now < entry.until) return true;
  session.circuit.delete(ref);
  return false;
}

export async function decideWithFailover(
  chain: ResolvedBackend[],
  state: unknown,
  questions: DecisionQuestion[],
  fetchImpl: typeof fetch = fetch,
  now = Date.now(),
): Promise<{ backend: ResolvedBackend; result: DecisionResult } | null> {
  let attempted = 0;
  for (const backend of chain) {
    if (isCircuitTripped(backend.ref, now)) continue;
    const isFailover = attempted > 0;
    attempted++;
    try {
      const res = await fetchImpl(backend.url, {
        method: "POST",
        headers: buildWireHeaders(backend.dialect, backend.apiKey),
        body: JSON.stringify(buildWirePayload(backend.dialect, backend.model, state, questions)),
        signal: AbortSignal.timeout(DECISION_TIMEOUT_MS),
      });

      if (res.status === 401 || res.status === 403) {
        session.circuit.set(backend.ref, { kind: "auth", until: Number.POSITIVE_INFINITY, detail: `HTTP ${res.status}` });
        recordUsage(backend.provider.id, backend.model, { requests: 1, failed: 1 });
        continue;
      }
      if (res.status === 429) {
        session.circuit.set(backend.ref, { kind: "rate", until: now + RATE_COOLDOWN_MS, detail: "HTTP 429" });
        recordUsage(backend.provider.id, backend.model, { requests: 1, failed: 1 });
        continue;
      }
      if (!res.ok) {
        recordUsage(backend.provider.id, backend.model, { requests: 1, failed: 1 });
        continue;
      }

      const parsed = parseWireResponse(backend.dialect, await res.json(), backend.model);
      if (!parsed) {
        recordUsage(backend.provider.id, backend.model, { requests: 1, failed: 1 });
        continue;
      }

      const cost = parsed.usage.cost ?? estimateUsd(backend.provider, backend.model, parsed.usage.inputTokens);
      const neurons = backend.provider.id === "cloudflare" ? clefNeurons(backend.model, parsed.usage.inputTokens) : 0;
      recordUsage(backend.provider.id, backend.model, {
        requests: 1,
        ok: 1,
        inputTokens: parsed.usage.inputTokens,
        outputTokens: parsed.usage.outputTokens,
        cost,
        neurons,
      });
      if (isFailover) session.stats.failovers++;
      return { backend, result: parsed };
    } catch {
      recordUsage(backend.provider.id, backend.model, { requests: 1, failed: 1 });
    }
  }
  return null;
}
