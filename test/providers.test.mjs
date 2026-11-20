import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  PROVIDERS,
  autoWireBackend,
  buildWireHeaders,
  buildWirePayload,
  decideWithFailover,
  parseWireResponse,
  providerById,
  resolveCloudflareAccounts,
} from "../extensions/providers.ts";
import { session } from "../extensions/state.ts";
import { readConfig, readUsageWindow } from "../extensions/store.ts";

describe("Built-in 14 providers & 3 wire dialect adapters", () => {
  it("ships all 14 verified decision providers including ClaimBench entries", () => {
    assert.equal(PROVIDERS.length, 14);
    for (const id of [
      "liquid", "perplexity", "inception", "baseten", "nace", "typesafe",
      "openrouter", "opper", "gemini", "openai", "cloudflare", "upstage", "ollama", "custom",
    ]) {
      assert.ok(providerById(id), `missing provider ${id}`);
    }
  });

  it("translates System One, Gemini Decisions, OpenAI Decisions, and Cloudflare envelopes cleanly", () => {
    const q = [{ name: "has_slop", type: "yesno", instructions: "Is it a stub?" }];

    // Gemini Decisions uses x-goog-api-key + `input` + `total_input_tokens`
    assert.equal(buildWireHeaders("gemini-decisions", "gk_123")["x-goog-api-key"], "gk_123");
    const gemPayload = buildWirePayload("gemini-decisions", "gemini-decision-1", { diff: "x" }, q);
    assert.equal(typeof gemPayload.input, "string");
    const gemParsed = parseWireResponse(
      "gemini-decisions",
      { answers: { has_slop: { type: "noul", noul: 0.88, confidence: 0.88 } }, usage: { total_input_tokens: 210, total_output_tokens: 0 } },
      "gemini-decision-1",
    );
    assert.equal(gemParsed?.answers.has_slop?.type, "yesno");
    assert.equal(gemParsed?.usage.inputTokens, 210);

    // OpenAI Decisions uses `predicate` array & `answers[]` array
    const oaiPayload = buildWirePayload("openai-decisions", "gpt-6-luna", "code", q);
    assert.equal(Array.isArray(oaiPayload.questions), true);
    assert.equal(oaiPayload.questions[0].type, "predicate");
    const oaiParsed = parseWireResponse(
      "openai-decisions",
      {
        model: "gpt-6-luna",
        answers: [{ name: "has_slop", type: "predicate", probability: 0.92, confidence: 0.92 }],
        usage: { input_tokens: 300, output_tokens: 0 },
      },
      "gpt-6-luna",
    );
    assert.equal(oaiParsed?.answers.has_slop?.p, 0.92);

    // Cloudflare envelope unwrap
    const cfParsed = parseWireResponse(
      "cloudflare-clef",
      { success: true, result: { answers: { has_slop: { type: "noul", noul: 0.12 } }, usage: { input_tokens: 90 } } },
      "clef-flash",
    );
    assert.equal(cfParsed?.answers.has_slop?.p, 0.12);
    assert.equal(parseWireResponse("cloudflare-clef", { success: false, errors: [{ message: "bad" }] }, "clef-flash"), null);
  });

  it("auto-discovers Cloudflare account IDs from API token", async () => {
    const fakeFetch = async () =>
      new Response(
        JSON.stringify({
          success: true,
          result: [{ id: "0123456789abcdef0123456789abcdef", name: "Primary Account" }],
        }),
        { status: 200 },
      );
    const accounts = await resolveCloudflareAccounts("cf_token_test", fakeFetch);
    assert.equal(accounts.length, 1);
    assert.equal(accounts[0].id, "0123456789abcdef0123456789abcdef");
  });

  it("auto-wires first login as primary and second as fallback", () => {
    process.env.PI_DECISION_EYE_HOME = mkdtempSync(join(tmpdir(), "dec-eye-wire-"));
    const first = autoWireBackend("liquid", "d1.2");
    assert.equal(first.assigned, "primary");
    assert.equal(readConfig().primary, "liquid:d1.2");

    const second = autoWireBackend("inception", "mercury-decide");
    assert.equal(second.assigned, "fallback");
    assert.equal(readConfig().fallback, "inception:mercury-decide");

    const third = autoWireBackend("perplexity", "pplx-decider-latest");
    assert.equal(third.assigned, null);
  });

  it("trips session circuit breaker on 401/429 and fails over cleanly to fallback", async () => {
    process.env.PI_DECISION_EYE_HOME = mkdtempSync(join(tmpdir(), "dec-eye-cb-"));
    session.circuit.clear();
    session.stats.failovers = 0;

    const primary = {
      provider: providerById("liquid"),
      model: "d1.2",
      ref: "liquid:d1.2",
      url: "https://api.liquid.ai/decisions/v1/systemone",
      dialect: "systemone",
      apiKey: "bad-key",
      source: "stored",
    };
    const fallback = {
      provider: providerById("inception"),
      model: "mercury-decide",
      ref: "inception:mercury-decide",
      url: "https://api.inceptionlabs.ai/v1/decisions",
      dialect: "systemone",
      apiKey: "good-key-12345678",
      source: "stored",
    };

    const calledUrls = [];
    const fakeFetch = async (url) => {
      calledUrls.push(String(url));
      if (String(url).includes("liquid")) return new Response("unauthorized", { status: 401 });
      return new Response(
        JSON.stringify({
          model: "mercury-decide",
          answers: { ok: { type: "noul", noul: 0.2 } },
          usage: { input_tokens: 150, output_tokens: 0 },
        }),
        { status: 200 },
      );
    };

    const q = [{ name: "ok", type: "yesno", instructions: "check" }];
    const r1 = await decideWithFailover([primary, fallback], "x", q, fakeFetch, 1000);
    assert.equal(r1?.backend.ref, "inception:mercury-decide");
    assert.equal(session.stats.failovers, 1);
    assert.equal(session.circuit.get("liquid:d1.2")?.kind, "auth");

    // Second call skips tripped primary immediately without hitting liquid URL again
    calledUrls.length = 0;
    const r2 = await decideWithFailover([primary, fallback], "y", q, fakeFetch, 2000);
    assert.equal(r2?.backend.ref, "inception:mercury-decide");
    assert.deepEqual(calledUrls, ["https://api.inceptionlabs.ai/v1/decisions"]);

    // Active-only usage records only providers that actually executed requests
    const usage = readUsageWindow("all");
    const ids = usage.providers.map((p) => p.providerId).sort();
    assert.deepEqual(ids, ["inception", "liquid"]);
  });
});
