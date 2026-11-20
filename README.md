# Decision Eye

Multi-provider decision guard. Three-stage protection. Built for Pi.

[![Custom badge](https://shieldcn.dev/badge/pi-%20Packages.svg?variant=outline&size=xs&logo=ri%3APiPiBold)](https://pi.dev/packages/@bismawy/pi-decision-eye)
[![badge](https://shieldcn.dev/npm/@bismawy/pi-decision-eye.svg?variant=outline&size=xs)](https://www.npmjs.com/package/@bismawy/pi-decision-eye)
[![license](https://shieldcn.dev/github/bismawy/pi-decision-eye/license.svg?variant=outline&size=xs)](https://github.com/bismawy/pi-decision-eye)

`pi-decision-eye` runs three stages of checks on coding-agent turns. Stage 1 blocks destructive shell commands and leaked secrets offline. Stage 2 checks `tool_result` outcomes before letting the agent claim a fix is done. Stage 3 evaluates risky code diffs through a fast decision model API and tracks spend only for providers you actually use.

## Install

```bash
pi install npm:@bismawy/pi-decision-eye
```

For local development:

```bash
pi -e ./extensions/index.ts
```

## Quick start

1. Run `/decision` in Pi and open **Providers**.
2. Pick any provider from the list and paste its API key.
   - Cloud providers need only an API key.
   - Cloudflare Workers AI discovers your Account ID from the API token automatically.
   - The first connected provider becomes your primary model. The second becomes your fallback.
3. Optional: switch Guard presets in `/decision guard` (`BALANCED`, `STRICT`, `LIGHT`, or `OFF`).

## Three-stage guard

Stage 1 runs locally in under 1 ms with zero token cost. It inspects both `bash` and `powershell` tool calls:
- Unwraps nested shells (`bash -c`, `sh -c`, `pwsh -Command`, `eval`) and prefixes (`sudo`, `env`).
- Blocks root or home directory wipes (`rm -rf /`, `xargs rm -rf`, `find / -delete`, `Remove-Item -Recurse C:\`), disk formatters (`mkfs`, `dd`, `Format-Volume`, `Clear-Disk`), and remote pipe execution (`curl | bash`, `irm | iex`).
- Blocks force-pushes to `main` or `master` (including implicit pushes when `.git/HEAD` points to `main`, while allowing `--force-with-lease`), `git reset --hard`, and `git clean -fd`.
- Blocks `DROP DATABASE/SCHEMA/TABLE`, `TRUNCATE TABLE`, and `DELETE FROM` without a `WHERE` clause.
- Scans newly added lines in `write` and `edit` calls for API keys, private keys, and database URIs with passwords. Placeholder strings and low-entropy tokens pass through without false positives.

Stage 2 tracks edited code files and `tool_result` exits during a turn:
- Marks the turn verified only when a test, typecheck, lint, or build command exits without error.
- Invalidates verification if another code file is edited afterward.
- Ignores prose-only edits such as Markdown files.
- Nudges the agent if its final message claims completion while unverified code edits remain, while ignoring negated statements ("not done yet", "belum selesai").

Stage 3 calls a decision model on `write` and `edit` diffs when the change meets risk triggers:
- Triggers on large diffs, risky patterns (empty `catch`, `eval`, `child_process`, SQL interpolation, `dangerouslySetInnerHTML`, `TODO`/`FIXME`), or security/infra files (`Dockerfile`, `.github/workflows`, `auth`, `security`).
- Asks three yes/no questions in one API call: `has_slop`, `has_unfinished_work`, and `has_safety_defect`.
- Blocks only when both probability and confidence exceed the active preset threshold, returning the exact failing dimension.
- Trips a session circuit breaker on 401/403 (auth) or 429 (cooldown) and fails over to your fallback provider.

## Supported providers

All 14 built-in providers map onto three wire dialects (`systemone`, `gemini-decisions`, and `openai-decisions`).

| Provider | Dialect | Default model | Auth |
| --- | --- | --- | --- |
| Liquid AI | `systemone` | `d1.2` | `LIQUID_API_KEY` or `/decision providers` |
| Perplexity | `systemone` | `pplx-decider-latest` | `PERPLEXITY_API_KEY` |
| Inception Labs | `systemone` | `mercury-decide` | `INCEPTION_API_KEY` |
| Baseten | `systemone` | `baseten-decision-1` | `BASETEN_API_KEY` |
| Nace AI | `systemone` | `nace-decision-1` | `NACE_API_KEY` |
| TypeSafe (Jev) | `systemone` | `jev-1` | `JEV_API_KEY` or `TYPESAFE_API_KEY` |
| OpenRouter | `systemone` | `liquid/d1.2` | `OPENROUTER_API_KEY` |
| Opper AI | `systemone` | `opper-decision-1` | `OPPER_API_KEY` |
| Google Gemini | `gemini-decisions` | `gemini-decision-1` | `GEMINI_API_KEY` |
| OpenAI | `openai-decisions` | `gpt-6-luna` | `OPENAI_API_KEY` |
| Cloudflare Workers AI | `cloudflare-clef` | `clef-flash` | `CLOUDFLARE_API_TOKEN` |
| Upstage | `systemone` | `solar-decision-1` | `UPSTAGE_API_KEY` |
| Ollama (Local) | `systemone` | `decision-local` | Local endpoint, no key required |
| Custom Endpoint | `systemone` | `custom-decision` | Base URL + optional API key |

## Commands

| Command | Action |
| --- | --- |
| `/decision` | Open the main menu (Guard, Providers, Models, Usage) |
| `/decision guard` | Choose preset (`BALANCED`, `STRICT`, `LIGHT`, `OFF`) and toggle stages |
| `/decision providers` | Connect, test, or disconnect any of the 14 providers |
| `/decision models` | Set primary and fallback provider/model pairs |
| `/decision usage` | View requests, tokens, and estimated cost for active providers (`Today`, `7d`, `30d`, `All`), with trash-backed reset and undo |
| `/eye [focus]` | Trigger an on-demand review of the current diff or prompt |

You can also mention `/eye` or `@eye` inside a normal message to attach a review instruction without invoking a slash command.

## Configuration and storage

All state lives under `~/.pi/agent/decision-eye/` (override with `PI_DECISION_EYE_HOME`):
- `config.json`: preset, stage toggles, primary/fallback references, and custom base URLs.
- `auth.json`: provider API keys and auto-discovered Cloudflare account IDs (mode `0600`).
- `usage.json`: per-day, per-provider, per-model request and token counters. Reset moves the file into `trash/` so you can undo it immediately.

## Development

```bash
npm test
npm run render-check
npm run typecheck
```

## License

MIT
