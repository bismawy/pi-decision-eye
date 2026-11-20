// @bismawy/pi-decision-eye entry point: Pi hooks, /decision & /eye commands, and portable shortcuts.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  buildCompactDiff,
  checkDestructiveCommand,
  detectSecret,
  evaluateSemanticGate,
  extractAddedText,
  formatSemanticBlockReason,
  isUnverifiedDoneClaim,
  noteToolCallForVerification,
  noteToolResultForVerification,
  readExistingFile,
  resetTurnTracking,
  shouldRunSemanticGate,
} from "./guard.ts";
import { refreshLiveModels, resolveBackendChain } from "./providers.ts";
import { EYE_MARKER, EYE_TRIGGER, REVIEW_CONTRACT, REVIEW_TRIGGER } from "./review.ts";
import {
  ReviewBoxComponent,
  showGuardScreen,
  showModelsScreen,
  showProvidersScreen,
  showRootMenu,
  showUsageScreen,
} from "./screens.ts";
import { KEY_SETS, PRESETS, decisionCompletions, nextPreset, session, syncStatus } from "./state.ts";
import { applyPreset, folderAllows, nextFolderScope, readConfig, scopeLabel, writeConfig } from "./store.ts";

function publishStatus(ctx: any): void {
  const cfg = readConfig();
  const active = resolveBackendChain(cfg)[0];
  syncStatus(ctx, cfg.preset, active?.model);
}

export default function (pi: ExtensionAPI) {
  // 1. Session start: discover live decision models (OpenRouter, Cloudflare, Nace.AI, local Ollama) and sync footer.
  pi.on("session_start", async (_event: any, ctx: any) => {
    await refreshLiveModels();
    publishStatus(ctx);
  });

  pi.registerMessageRenderer("pi-decision-eye-review", (message: any, { expanded }: any, theme: any) => {
    const content = message?.content;
    const text = typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content.filter((c: any) => c?.type === "text").map((c: any) => String(c?.text ?? "")).join("\n")
        : "";
    return new ReviewBoxComponent(text, Boolean(expanded), theme);
  });

  // 2. Prompt start: reset Stage 2 turn tracking and detect /eye or @eye reviewed turn.
  pi.on("before_agent_start", async (event: any, ctx: any) => {
    resetTurnTracking();
    const cfg = readConfig();
    if (cfg.preset === "off") return;

    const prompt = String(event?.prompt ?? "");
    const reviewed = cfg.reviewAlways || REVIEW_TRIGGER.test(prompt);
    session.pendingReview = reviewed ? prompt.slice(0, 600) : undefined;
    if (!reviewed) return;

    session.stats.reviewTurns++;
    ctx.ui.notify("[pi-decision-eye] Reviewed turn active: report contract injected and write gate aligned to request.", "info");
    return {
      message: {
        customType: "pi-decision-eye-review",
        content: REVIEW_CONTRACT,
        display: true,
      },
    };
  });

  // 3. Stage 1 (Local Guard) + Stage 2 (track edits/verifications) + Stage 3 (Semantic Gate).
  pi.on("tool_call", async (event: any, ctx: any) => {
    const cfg = readConfig();
    if (cfg.preset === "off") return;

    const toolName = String(event?.toolName ?? "");
    const toolCallId = typeof event?.toolCallId === "string" ? event.toolCallId : undefined;
    const input = event?.input ?? {};

    // Stage 2: record code edits (invalidating prior verification) and pending verification commands.
    if (cfg.stages.doneCheck) {
      noteToolCallForVerification(toolCallId, toolName, input);
    }

    // Stage 1: bash & powershell destructive command + secret checks.
    if ((toolName === "bash" || toolName === "powershell") && cfg.stages.local) {
      const cmd = typeof input.command === "string" ? input.command : "";
      const blocked = checkDestructiveCommand(cmd, toolName, ctx?.cwd);
      if (blocked) {
        session.stats.blockedCmd++;
        ctx.ui.notify(`[pi-decision-eye] BLOCKED (${blocked.rule}): ${blocked.detail}`, "error");
        return {
          block: true,
          reason: `[pi-decision-eye] Command blocked (${blocked.rule}: ${blocked.detail}). Explicit user confirmation is required for destructive actions.`,
        };
      }
      const secret = detectSecret(cmd);
      if (secret) {
        session.stats.blockedSecret++;
        ctx.ui.notify(`[pi-decision-eye] BLOCKED secret in ${toolName} command (${secret.name}).`, "error");
        return {
          block: true,
          reason: `[pi-decision-eye] Command blocked: credential (${secret.name}) detected on command line. Pass secrets via environment variables instead.`,
        };
      }
    }

    // Stage 1 (secrets) & Stage 3 (semantic gate) on write & edit.
    if (toolName === "write" || toolName === "edit") {
      const filePath = typeof input.path === "string" ? input.path : "";
      const edits = Array.isArray(input.edits) ? input.edits : [];
      const addedText = toolName === "write" ? String(input.content ?? "") : extractAddedText(edits);

      if (cfg.stages.local) {
        const secret = detectSecret(addedText);
        if (secret) {
          session.stats.blockedSecret++;
          ctx.ui.notify(`[pi-decision-eye] BLOCKED hardcoded secret (${secret.name}) in ${filePath || "file"}.`, "error");
          return {
            block: true,
            reason: `[pi-decision-eye] Write blocked: hardcoded credential (${secret.name}) detected in added content. Store secrets in environment variables.`,
          };
        }
      }

      // Stage 3: Semantic gate runs when stage enabled OR when LIGHT preset is on a reviewed /eye turn.
      const isReviewed = Boolean(session.pendingReview);
      const semanticActive = cfg.stages.semantic || (cfg.preset === "light" && isReviewed);
      if (!semanticActive || !folderAllows(ctx.cwd, cfg.folderScope)) return;

      const spec = PRESETS[cfg.preset];
      const trigger = shouldRunSemanticGate(filePath, addedText, spec, isReviewed);
      if (!trigger.run) return;

      const chain = resolveBackendChain(cfg);
      if (chain.length === 0) return;

      if (session.stats.gateCalls >= cfg.maxGateCalls) {
        if (!session.budgetNotified) {
          session.budgetNotified = true;
          ctx.ui.notify(
            `[pi-decision-eye] Session gate budget reached (${cfg.maxGateCalls}); semantic gate now fails open.`,
            "warning",
          );
        }
        return;
      }
      session.stats.gateCalls++;

      const diffSnippet =
        toolName === "edit"
          ? buildCompactDiff(readExistingFile(ctx.cwd, filePath), edits)
          : addedText;

      const verdict = await evaluateSemanticGate(filePath, diffSnippet, chain, spec, session.pendingReview);
      if (verdict?.blocked) {
        session.stats.blockedSemantic++;
        const dims = verdict.hits.map((h) => `${h.dimension}=${h.p.toFixed(2)}`).join(", ");
        ctx.ui.notify(`[pi-decision-eye] BLOCKED (${dims})`, "warning");
        return {
          block: true,
          reason: formatSemanticBlockReason(verdict, spec),
        };
      }
    }
  });

  // 4. Stage 2: mark verification complete ONLY when tool_result finishes cleanly without error.
  pi.on("tool_result", async (event: any) => {
    const cfg = readConfig();
    if (cfg.preset === "off" || !cfg.stages.doneCheck) return;
    const toolCallId = typeof event?.toolCallId === "string" ? event.toolCallId : undefined;
    const toolName = String(event?.toolName ?? "");
    const isError = event?.isError === true;
    const content = Array.isArray(event?.content)
      ? event.content.map((c: any) => String(c?.text ?? "")).join("\n")
      : String(event?.content ?? "");
    noteToolResultForVerification(toolCallId, toolName, isError, content);
  });

  // 5. Stage 2: warn on final assistant completion claims over unverified code edits.
  pi.on("message_end", async (event: any, ctx: any) => {
    const cfg = readConfig();
    if (cfg.preset === "off" || !cfg.stages.doneCheck) return;
    if (isUnverifiedDoneClaim(event?.message)) {
      const files = [...session.dirtyFiles].slice(0, 3).join(", ");
      ctx.ui.notify(
        `[pi-decision-eye] Unverified completion claim: modified ${files}${session.dirtyFiles.size > 3 ? ", …" : ""} without a passing verification check.`,
        "warning",
      );
    }
  });

  // 6. Portable shortcuts: Ctrl+Alt+E cycles preset, Ctrl+Alt+U cycles folder scope.
  pi.registerShortcut(KEY_SETS.preset, {
    description: "Cycle Decision Eye preset: BALANCED -> STRICT -> LIGHT -> OFF",
    handler: async (ctx: any) => {
      const cfg = readConfig();
      const next = applyPreset(cfg, nextPreset(cfg.preset));
      writeConfig(next);
      publishStatus(ctx);
      ctx.ui.notify(
        `[pi-decision-eye] Preset: ${PRESETS[next.preset].label} (${PRESETS[next.preset].summary}).`,
        next.preset === "off" ? "warning" : "info",
      );
    },
  });

  pi.registerShortcut(KEY_SETS.scope, {
    description: "Cycle Decision Eye folder gate scope: ALL -> THIS FOLDER -> OFF",
    handler: async (ctx: any) => {
      const cfg = readConfig();
      const next = { ...cfg, folderScope: nextFolderScope(cfg.folderScope, ctx.cwd) };
      writeConfig(next);
      ctx.ui.notify(
        `[pi-decision-eye] Folder scope: ${scopeLabel(next.folderScope, ctx.cwd)}.`,
        next.folderScope.mode === "disabled" ? "warning" : "info",
      );
    },
  });

  // 7. Slash commands: /decision (menu & subcommands) and /eye (reviewed turn trigger).
  pi.registerCommand("decision", {
    description: "Decision Eye menu: guard, providers, models, usage",
    getArgumentCompletions: (prefix: string) => decisionCompletions(prefix),
    handler: async (args: string, ctx: any) => {
      const sub = args.trim().toLowerCase();
      if (!sub) return await showRootMenu(ctx);
      if (sub === "guard" || sub === "status") return void (await showGuardScreen(ctx, false));
      if (sub === "providers" || sub === "accounts" || sub === "login") return void (await showProvidersScreen(ctx, false));
      if (sub === "models") return void (await showModelsScreen(ctx, false));
      if (sub === "usage") return void (await showUsageScreen(ctx, false));
      ctx.ui.notify(`[pi-decision-eye] Unknown subcommand "${sub}". Use: guard | providers | models | usage`, "warning");
    },
  });
}
