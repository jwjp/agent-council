# v3 migration verification

Verified locally on Windows, 2026-11-05.

- Frontend: TypeScript build and 4 Vitest assertions covering event frame retention and quota interpretation.
- Rust: 10 unit tests covering provider output parsing, quota normalization, permission arguments, concurrent usage aggregation, interrupted work, durable event IDs, legacy settings/chat/draft import and import idempotency.
- Live HTTP integration with deterministic native Rust CLI fixtures: authentication, validation, idempotent job submission, all six adapters, coder/review/conference/report flow, token totals, unavailable usage, replay, conflicting jobs, update admission gate, descendant cancellation, restart persistence.
- An installed, signed-in **Codex** CLI completed a minimal no-tools request through the Rust runtime and returned `ENGINE_OK`; reported usage was saved. Other providers were covered by fixtures, not live model requests.
- Read-only account usage probes returned real provider data for **Codex, Claude Code, Antigravity, Grok and Cursor** using existing local sign-ins. Gemini has no local OAuth sign-in on this PC and reports that state explicitly. Provider usage checks do not establish live coding behavior for all agents.
- 17 headless Microsoft Edge checks use the actual Rust runtime and isolated CLI fixtures. They cover source HTML launch guidance, browser bootstrap, distinct lead/permissions/team/settings/project actions, delayed settings responses, IME Enter, Shift+Enter, draft persistence, the correction/recheck workflow, split controls, account quota details, Markdown table scrolling, small viewport settings and browser exceptions.
- Native Tauri/WebView2 UI: custom title bar, main chat, split results, settings, Korean language, dark appearance and Korean text entry inspected. These checks do not establish all possible IME/monitor configurations.

The installed Postman CLI did not support the skill's `status` command. API checks ran locally through the versioned HTTP contract using Node's built-in HTTP client; no Postman workspace was created or published.

Mobile packaging, Tailscale exposure, device pairing and mobile push delivery are outside this desktop migration.
