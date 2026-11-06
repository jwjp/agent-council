# v3 migration verification

## Portable host source milestone — 2026-11-06

The source workspace now has shared wire types, a GUI-independent `CouncilHost` and the existing desktop launcher. This is not a new published executable release. Local Windows checks passed: 20 Rust tests, 6 frontend tests, frontend build, dependency-boundary checks, runtime integration against each debug launcher and 18 browser UI checks. Runtime fixtures additionally verify host-stop descendant cleanup. No live model/provider sweep was rerun. macOS compilation/runtime CI has been added; its actual result is tracked in [PROJECT_STATUS.md](PROJECT_STATUS.md). Native Mac GUI/provider verification and mobile/remote support remain open.

## Published v3.1.0 evidence

Updated for v3.1.0 locally on Windows, 2026-11-06.

- Frontend: TypeScript build and 6 Vitest assertions covering event frame retention, labeled quota summaries, fractional percentages and safe file/web link classification.
- Rust: 16 unit tests covering provider output parsing, complete bounded notes, quota normalization, Codex duration drift/order, partial Claude limit merging, stale refreshes, disabled Antigravity quotas, safe file resolution, large file line windows, binary rejection, permission arguments, concurrent usage aggregation, interrupted work, durable event IDs and legacy import.
- Live HTTP integration with deterministic native Rust CLI fixtures: authentication, validation, idempotent job submission, all six adapters, coder/review/conference/report flow, token totals, unavailable usage, replay, conflicting jobs, update admission gate, descendant cancellation, restart persistence.
- An installed, signed-in **Codex** CLI completed a minimal no-tools request through the Rust runtime in the v3 migration and returned `ENGINE_OK`. In this revision **Antigravity** completed a minimal no-tools print request returning `AGY_FORMAT_OK`, confirming its current streamed event shape. Other provider coding flows use deterministic fixtures; these small probes do not establish full live multi-agent review behavior.
- Read-only account usage probes returned real provider data for **Codex, Claude Code, Antigravity, Grok and Cursor** using existing local sign-ins. Gemini has no local OAuth sign-in on this PC and reports that state explicitly. Provider usage checks do not establish live coding behavior for all agents.
- 18 headless Microsoft Edge checks use the actual Rust runtime and isolated CLI fixtures. They cover source HTML launch guidance, browser bootstrap, distinct lead/permissions/team/settings/project actions, delayed settings responses, IME Enter, Shift+Enter, draft persistence, correction/recheck workflow, split controls, full Markdown notes, actual file previews and line highlighting, Escape closing only the file preview, labeled account periods, Markdown table scrolling, compact settings and browser exceptions.
- Native Tauri/WebView2 UI: custom title bar, main chat, split results, settings, Korean language, dark appearance and Korean text entry inspected. These checks do not establish all possible IME/monitor configurations.

The installed Postman CLI did not support the skill's `status` command. API checks ran locally through the versioned HTTP contract using Node's built-in HTTP client; no Postman workspace was created or published.

Mobile packaging, Tailscale exposure, device pairing and mobile push delivery are outside this desktop migration.
