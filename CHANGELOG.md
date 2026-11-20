# Changelog

## [Unreleased]

### Added
- Icon tiers via `PI_DECISION_EYE_ICON=nerd|emoji|none` (default `nerd` with `\uf21b`; falls back to `emoji` when `NERD_FONT=0` or `PI_NERD_FONT=0`, and plain ASCII with `none`).
- Theme-aware status dot colors (`BALANCED` `accent`, `STRICT` `mdHeading`, `LIGHT` `borderAccent`, `OFF` `dim`) and `dim` active backend suffix.

### Changed
- Kept `/eye` and `@eye` as inline prompt triggers only, removing the `/eye` slash command registration.
- Split `[←] Back` and `[Esc] Cancel`/`Close` exits across Guard, Providers, Models, and Usage sub-screens.

### Fixed
- Forwarded `focused` state to `TextPromptScreen` and `SecretInput` with `> ` prompt and `dim` placeholder so API key input renders its cursor cleanly.
- Kept setting-cycle and save notifications on `ctx.ui.notify(..., "info")` (including `OFF`/`disabled`) so Pi replaces consecutive status lines in-place instead of stacking them.
- Restored label padding before `·` in `ProvidersScreen`, right-aligned `[show]`/`[hide]` on `ReviewBoxComponent` with a single-click guard (`clickCount === 1`), and aligned `UsageScreen` table columns with the header.

## [0.1.0] - 2026-11-20

### Added
- Built-in registry for 14 decision model providers across 3 wire dialects (System One, Gemini Decisions, OpenAI Decisions), requiring only an API key for cloud login and auto-detecting Cloudflare account IDs.
- Revamped 3-stage Guard pipeline: cross-platform bash/PowerShell/git/SQL/entropy-filtered secret checks, stateful tool_result verification done-check, and diff-aware confidence-gated semantic evaluation with session circuit breaker.
- Guard presets (BALANCED, STRICT, LIGHT, OFF) with unified config.json and automatic primary/fallback backend wiring on login.
- Arnative rounded-box TUI menus (`/decision`) and inline reviewed-turn triggers (`/eye`, `@eye`) with dynamic active-only provider usage statistics, viewport pagination, and trash-backed reset/undo.
