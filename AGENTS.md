# Agent Council — instructions for coding agents

This is the canonical project instruction file. `CLAUDE.md` and `GEMINI.md` point here; do not maintain competing copies of these rules.

## Start and finish every task

1. Read this file and [docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md). Consult the relevant source and documentation before editing; the status file is a handoff, not proof that code still behaves that way. [docs/CODE_REVIEW.md](docs/CODE_REVIEW.md) holds advisory review notes from Claude; consult them when touching an affected area, but they are not requirements and need not be resolved before other work. Verify an entry against current source before relying on it.
2. Check `git status` and preserve unrelated user changes. Continue work authorized by the current conversation without introducing repeated approval requests.
3. Implement the requested behavior, run checks appropriate to the change, and report actual results and material limitations.
4. Before the final response, update `docs/PROJECT_STATUS.md` for meaningful changes: behavior/decisions, affected areas, checks actually run, remaining issues, and a concrete next step when needed. Use a dated, concise entry and keep the latest five task entries. Record unsuccessful or skipped verification honestly.
5. Update this file only when durable requirements, architecture or workflow change. Update README/API/verification documentation when their claims change. Keep the two agent entry-point files thin.
6. Documentation-only work does not require an executable rebuild, app version bump or release. Never claim that written instructions automatically enforce another agent's behavior.

## Product requirements

- A local AI coding orchestrator with an optional lead agent and optional independent reviewers. Do not require two agents, a lead, or a reviewer. At least one participant is needed to run a request.
- The lead implements requested changes and checks. Reviewers inspect and give opinions without editing. For implemented work with confirmed in-scope mistakes, there is one bounded correction pass and read-only rechecks, then discussion and an attributed final report. Analysis requests must not silently turn into implementation.
- Preserve conversation context and drafts. Show the user's current request, each agent's progress, retained working notes and distinct final results. Progress must correspond to observed events, not invented activity.
- Publish parallel review/recheck/discussion results as each finishes, while preserving configured order for evidence and report selection. Keep the barrier before the next round, exclude failed participants from repeated downstream calls, and return a lead's explicit clarification to the user before starting review rounds.
- English is the default UI language; Korean is supported. Preserve IME composition, Enter-to-send, Shift+Enter, focus changes and draft persistence.
- Design and performance both matter: readable compact typography, coherent spacing, light/dark contrast, responsive layouts, in-window dialogs and stable scrolling over Markdown tables. Verify visual changes instead of relying only on compilation.
- Users select the project and optional read-only reference folders. File links must resolve safely and open at the correct line. Bound large-file rendering.
- Respect the selected execution permission policy. New-install full access and imported user settings are intentional. Review-only intent is not filesystem isolation when full access is enabled; do not claim otherwise.
- Keep six current CLI adapters reliable before adding many new agents. Never weaken validation or change the selected policy merely to make a test pass.

## Architecture and source map

- **Tauri 2 + React/TypeScript + Rust**. No Python/Electron runtime; Node.js is for development/builds.
- `src/App.tsx`, `src/style.css`: shell, composition, conversation, split panes, agent settings and notes.
- `src/usage-panel.tsx`, `src/quotas.ts`: quota UI and summaries; `src/file-preview.tsx`, `src/links.ts`: file navigation.
- `src/workflow.ts`, `workflow-view.tsx`, `workflow.css`: shared desktop/phone stage rail based on persisted workflow/phase events. Keep counts tied to actual participants and outcomes; preserve phase milestones when compacting noisy tool/note streams.
- `src/api.ts`, `src/types.ts`: frontend runtime interface and shared shapes.
- `src-tauri/src/main.rs`: thin Tauri desktop shell and native commands.
- `src-tauri/crates/council-core`: shared wire types/version; no GUI, database, subprocess or provider dependencies.
- `src-tauri/crates/council-client`: GUI-free HTTPS companion client; cookies remain native-only. `mobile/src-tauri` is a separate Tauri phone workspace, with no execution host/CLI/database. Read [native companion instructions](docs/NATIVE_COMPANION.md); iPhone is the first validation target. Keep mobile vault commands inaccessible to frontend plugins.
- Mobile has an independent version/lockfile. Do not bump the desktop version for phone-only work. Keep browser, mocked native IPC, simulator/Keychain and physical-device/signing evidence distinct; a simulator bundle is not an installable iPhone release.
- A native simulator/emulator process launch alone is not rendered-UI proof. Keep the iOS pairing-screen OCR gate and the Android pairing-screen UI hierarchy gate, and inspect their screenshots. Record Android instrumentation, packaged APK rendering and physical device pairing as separate evidence.
- `src-tauri/crates/council-host`: GUI-independent desktop execution library and `CouncilHost` executable. The module names below are relative to its `src/` directory. Keep the host free of Tauri/rfd/wry dependencies; `node scripts/check-host-boundary.mjs` enforces this boundary.
- `engine.rs`: lead/review/correction/discussion/report orchestration; `process.rs`: CLI resolution, arguments, streamed events, usage parsing, Windows jobs and Unix process groups. `platform.rs` owns native data/auth paths and CLI search locations.
- `quota.rs`: provider usage probes and normalization; `files.rs`: bounded, read-only project/reference previews.
- `server.rs`: authenticated loopback HTTP/SSE runtime; `store.rs`: SQLite persistence and migration; `updates.rs`: manual GitHub update checks and installation.
- `companion.rs`: separate, opt-in loopback browser gateway; host-only management is under `/v1/companion`, paired cookies under `/companion/v1` on a different listener. `src/companion.tsx`, `companion-settings.tsx`, `companion.css` and `companion/index.html` implement the mobile web client and host panel. `markdown.tsx` is shared rendering.
- `src/companion-draft.ts` owns revision/request-order guards and bounded, expiring, grant-scoped per-tab browser input recovery. Native mode does not use this browser backup; authentication material must never enter it. `public/companion` contains only fixed Home Screen metadata/icons, without invitations.
- `src/companion-viewport.ts` follows unzoomed visual-viewport bounds without per-event React renders. Keep pinch zoom, compact keyboard controls and listener/frame cleanup intact. Synthetic keyboard geometry is not physical iPhone keyboard evidence; use [the device checklist](docs/IPHONE_DEVICE_CHECK.md).
- `docs/runtime-api.md`, `docs/openapi.json`: runtime contract. `scripts/generate-contract.mjs` generates the spec; edit the generator and regenerate the JSON together.
- `vite.config.ts`: same-origin local browser bridge to the real engine. Source `index.html` opened with `file://` shows launch instructions, not the working app.

## Fast development and scoped verification

Run commands from the repository root. Install dependencies with `npm ci` when needed.

| Change / purpose | Commands and evidence |
| --- | --- |
| Native development | `npm run tauri dev` — use the debug profile, not a release build for every edit |
| Browser UI iteration | Build the headless engine with `cargo build --locked --manifest-path src-tauri/Cargo.toml -p council-host`, then `npm run dev`; open `http://127.0.0.1:1420` |
| Frontend behavior/types | `npm test`, `npm run build` as appropriate |
| Rust behavior | `cargo test --workspace --locked --manifest-path src-tauri/Cargo.toml` (the root GUI executable has no unit tests) |
| Runtime / adapter / persistence changes | Rebuild the debug executable, then `node tests/runtime.mjs` |
| Cross-version upgrade compatibility | `node tests/upgrade.mjs OLD_EXE NEW_EXE` — explicit existing binaries, separate temporary data/auth and fixture CLIs; no production profile or Tailscale changes |
| UI interactions / input / scrolling / file navigation | `node tests/ui.mjs` — isolated real runtime + native fixtures, installed Edge and a free port 1420 required |
| Rust formatting | `cargo fmt --all --manifest-path src-tauri/Cargo.toml -- --check` |
| Shipping artifact | `npm run tauri build -- --no-bundle`, then `node tests/runtime.mjs src-tauri/target/release/AgentCouncil.exe` and relevant native UI checks |
| MSIX compatibility trial | Package a current embedded debug EXE with `scripts/build-msix-trial.ps1`, then run `tests/msix-trial.ps1` on a disposable elevated Windows runner. See [Store trial](docs/STORE_DISTRIBUTION.md#compatibility-trial-results). |
| Documentation-only | Review links, source accuracy and `git diff --check`; do not rebuild the app just to edit instructions |

Select checks based on the behavior at risk. After they pass, repeat/broaden only for new changes, failures or unresolved concerns. Fixtures prove orchestration/adapter handling, not that every provider's real coding or review succeeds. Label fixture, live-account and native visual evidence separately. Live model calls can consume the user's quota; do not run broad provider sweeps unnecessarily.

## Runtime lifecycle and test isolation

- The same executable starts a separate `--serve` process. Closing a window leaves accepted work running. A new GUI can reconnect to an older process with the same app version/compatibility revision.
- The optional `CouncilHost` executable runs the same host without GUI dependencies. Both launchers now use runtime revision 4 (portable-host foundation was revision 3). See [portable host instructions](docs/PORTABLE_HOST.md) for paths, build/test commands and platform limitations. Do not mistake macOS fixture CI for native GUI or real-account verification.
- Recompiling the GUI does **not** prove the running background engine was replaced. For backend verification use a fresh isolated data directory or restart only your own idle test runtime. Check descriptor version/revision, PID and executable path. Never kill a user's active job or broadly terminate all agent processes.
- `AGENT_COUNCIL_DATA` selects isolated runtime data. Portable Windows data defaults to `%LOCALAPPDATA%\AgentCouncil`; packaged Windows data and WebView2 use their package family's `LocalState`. Preserve both. `runtime.json` contains a bearer token and must not be printed or committed.
- macOS data is under `~/Library/Application Support/AgentCouncil`; Linux uses `$XDG_DATA_HOME/AgentCouncil` or `~/.local/share/AgentCouncil`. Preserve Unix path case and keep the runtime credential private. Keep provider-specific Keychain support explicit rather than silently treating unsupported protected storage as zero usage.
- Existing integration tests isolate auth with `AGENT_COUNCIL_AUTH_HOME`, `CLAUDE_CONFIG_DIR` and `GROK_HOME`, and use fixture CLIs on a private PATH. Reuse those harnesses. Do not mistake fixtures for a real sign-in or quota.
- `.runtime-test/`, `node_modules/`, `web-dist/`, `src-tauri/target/` and `dist/` are generated/private artifacts. Verify resolved ownership/path boundaries before recursive cleanup.
- The administrator runtime stays authenticated and loopback-only. Only the companion listener may be reverse-proxied through private Tailscale Serve HTTPS after explicit opt-in. Never publish the runtime, Vite or bearer descriptor. The app does not configure the user's tailnet automatically. Read [mobile companion instructions](docs/MOBILE_COMPANION.md).
- Companion pairing requires an expiring single-use challenge plus host approval. Preserve hashed device credentials, HttpOnly/SameSite cookies, exact Origin checks for mutations, independent drafts, project/event/file scopes and revocation during SSE. A work grant does not sandbox full-access agent tools; retain the selected execution policy and the explicit host UI explanation.
- For side-by-side test/production gateways on one DNS name, different ports do not isolate cookies. Use separate browser/private sessions and preserve existing Serve routes. Separate runtime data directories alone do not prove the phone's original login cookie stayed intact. See [local test handoff](docs/LOCAL_TEST_BUILD.md).
- Companion frontend assets are embedded during the host build: run `npm run build` first for a browser-shipping artifact. Verify `node tests/companion.mjs` for backend changes and `node tests/companion-ui.mjs` for companion UI changes. Those tests use isolated fixtures; physical mobile/Tailscale routing remains separate evidence.

## Quota and credential correctness

- Account quota percentages and project token totals are different measurements. Never substitute tokens for a percentage or represent missing data as zero.
- Preserve each period/model bucket, units, reset time, source and freshness. The footer summarizes the highest reported percentage with its period; the panel shows all windows.
- Classify Codex periods by duration, including older one-minute drift. Merge partial Claude events without erasing other windows; reject stale lower same-period snapshots. Skip disabled/unmetered Antigravity buckets. Preserve last-known data as explicitly stale on refresh failure.
- Cursor IDE quota access is separate from Cursor Agent CLI authentication. Other provider endpoints/auth formats can change: verify against current primary sources and sanitized responses.
- Cursor and Grok can both install `agent`. Resolve Cursor's `cursor-agent` alias first; verify a generic native `agent` with bounded/cached no-model help before sending project context. Keep fixtures' Cursor alias isolated from real installations. On Windows, login instructions/copy actions use `cursor-agent.cmd` so Bash does not select Grok's `agent.exe`. See [CLI troubleshooting](docs/CLI_TROUBLESHOOTING.md).
- Reuse existing sign-ins only for their matching provider. Never print, commit, return to the UI, or send to unrelated services any credential, cookie, refresh token, provider auth database or runtime bearer token. Do not automate sign-in or change Windows trust/security settings as a shortcut.
- Preserve [third-party acknowledgments](docs/THIRD_PARTY_NOTICES.md) and Orca's MIT notice when using its implementation as a reference. Do not infer that this grants a license to Agent Council's own code.

## Build, signing and publishing

- Read [docs/BUILD_AND_SIGNING.md](docs/BUILD_AND_SIGNING.md). Development and ordinary CI are unsigned; trusted code signing belongs to an explicitly requested/authorized release.
- iOS simulator tests may use a local ad-hoc identity and isolated Keychain entitlements without developer-account credentials. This is not trusted distribution signing or an installable iPhone release.
- Existing `.github/workflows/check.yml` runs checks on pushes/PRs and already uses `Swatinem/rust-cache`. It is **not** a signed release workflow.
- Do not bump versions, run repeated optimized/LTO builds, package ZIPs or publish a release for routine edits. Use frontend hot reload and incremental debug builds during iteration.
- A future release workflow should be triggered by release tags or explicit dispatch, build from the exact source revision, verify/sign the executable, package the signed bytes, then publish. Signing-provider approval can require a person; do not promise unattended completion.
- A shipping version must agree in `package.json`, `package-lock.json`, `src-tauri/Cargo.toml` (both the app and `[workspace.package]`), `src-tauri/Cargo.lock` (app/core/host packages) and `src-tauri/tauri.conf.json`. Do not ship a stale executable left in `dist/`.
- Verify the actual uploaded assets/digests and release status before reporting publication. Keep a failed or pending signing/release step visible; never call an unsigned artifact signed.

## Communication

Respond in the user's language. Explain what changed, why, how it was checked and what remains uncertain. Do not claim perfect provider support, fully eliminated Windows warnings, completed mobile pairing or signing approval without evidence. If interrupted, leave a compact, truthful continuation point in `docs/PROJECT_STATUS.md`.
