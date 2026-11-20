# Changelog

## [Unreleased]

### Fixed
- Forwarded `focused` state to `TextPromptScreen` and `SecretInput` with `> ` prompt and `dim` placeholder so API key input renders its cursor cleanly.
- Aligned `[show]` / `[hide]` fold hints right-aligned on the `ReviewBoxComponent` title row and aligned `UsageScreen` table columns with the header.

## [0.1.0] - 2026-11-20

### Added
- Built-in registry for 14 decision model providers across 3 wire dialects (System One, Gemini Decisions, OpenAI Decisions), requiring only an API key for cloud login and auto-detecting Cloudflare account IDs.
- Revamped 3-stage Guard pipeline: cross-platform bash/PowerShell/git/SQL/entropy-filtered secret checks, stateful tool_result verification done-check, and diff-aware confidence-gated semantic evaluation with session circuit breaker.
- Guard presets (BALANCED, STRICT, LIGHT, OFF) with unified config.json and automatic primary/fallback backend wiring on login.
- Arnative rounded-box TUI menus (/decision and /eye) with dynamic active-only provider usage statistics, viewport pagination, and trash-backed reset/undo.
