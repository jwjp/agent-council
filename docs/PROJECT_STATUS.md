# Shared project status and handoff

Last updated: 2026-11-06. Read with [AGENTS.md](../AGENTS.md); verify time-sensitive claims against source and live services. Replace stale current-state information instead of accumulating a second conversation transcript.

## Current product

- Latest published application: [v3.1.0](https://github.com/jwjp/agent-council/releases/tag/v3.1.0), Windows x64 portable EXE/ZIP, **unsigned**. The portable-host source milestone below does not publish a new app version or replace those release assets.
- Stack: Tauri 2, React/TypeScript, Rust engine; no shipped Python or Node.js runtime. Current CLI adapters: Codex, Claude Code, Antigravity, Grok, Cursor Agent, Gemini CLI.
- Optional lead and optional reviewers; bounded correction/recheck workflow, attributed discussion/report, durable chat/drafts/jobs, cancel, Markdown, split view, complete bounded working notes and read-only file previews.
- Account usage is separate from project tokens. Quota periods/model groups, resets, sources and explicitly stale readings are retained. Cursor IDE quota and Agent CLI authentication are independent.
- Engine runs separately as `AgentCouncil.exe --serve`; closing the window does not stop work. Check version/revision and isolate test data when testing backend rebuilds.
- Source workspace now separates `council-core` wire types, GUI-independent `council-host` library/`CouncilHost` executable, and the Tauri desktop shell. Both executables now use runtime revision 4 (portable-host foundation: revision 3); paths, commands and remaining platform limits are in [PORTABLE_HOST.md](PORTABLE_HOST.md). Published v3.1.0 binaries predate this refactor.
- Source preview **3.2.0-beta.1** adds a separate opt-in companion browser gateway, QR challenge/host approval, scoped revocable cookies, private device drafts, project-bound work/results/usage/files and reconnectable progress. Administrator HTTP/SSE remains loopback-only; runtime revision is **4**. Native mobile builds and remote push are not implemented. See [MOBILE_COMPANION.md](MOBILE_COMPANION.md).

## Verification evidence

- Last application-code verification for v3.1.0: 6 frontend tests, 16 Rust tests, 18 browser UI checks, release-executable API integration and native Korean UI / working-note / file-link checks. Details and limitations: [verification.md](verification.md).
- GitHub Windows checks passed for application commit `d9ccd2f5753b2d3bd6bbb766236e8d1dce0e8053`: [run](https://github.com/jwjp/agent-council/actions/runs/42138950917).
- Read-only live usage probes on 2026-11-06 returned data for Codex, Claude Code, Antigravity, Grok and Cursor. Gemini had no local OAuth sign-in. These observations do not prove future login availability or full live coding/review for every provider.
- Model probes were deliberately small: an earlier Codex no-tools response and an Antigravity no-tools streamed response. Full workflows use isolated native fixtures; the Antigravity fixture also exercises streamed text with an empty final response body.
- Portable-host source verification: 20 Rust tests, 6 frontend tests/build, both debug launchers' real loopback integration using deterministic six-agent fixtures, 18 Windows browser UI checks and core/host dependency-boundary checks passed locally. Final Windows/macOS CI passed for source commit `dd5510a9c676238f789fce5a1743a45a5f0830b8`: [run](https://github.com/jwjp/agent-council/actions/runs/42149482970). Both OS jobs build/test the workspace and both runtime launchers; browser UI checks run on Windows. This is separate from native Mac GUI/live-account evidence.

## Decisions and pending work

- **Development:** unsigned debug builds and frontend hot reload. Do not run optimized builds/signing/release publication for each edit. Existing push/PR workflow already uses `Swatinem/rust-cache`.
- **Signing:** recommended for public releases, not a prerequisite for local development. See [BUILD_AND_SIGNING.md](BUILD_AND_SIGNING.md). SignPath requires manual release signing approvals; tagging cannot guarantee unattended completion.
- **Eligibility:** no project-level license has been chosen; the Orca MIT notice is not this project's license. No signing application/approval is recorded. OSSign was not accepting new applications at the last check and has a six-month activity requirement. Recheck external conditions before acting.
- **Release automation:** tag/manual signed release workflow is a proposed next implementation, not an existing feature. Current workflow verifies code; previous release artifacts were built/published separately. Do not claim source-to-signed-binary provenance yet.
- **Microsoft Store:** owner reports Partner Center registration complete. Store-hosted MSIX is a recommended candidate, not a finalized/implemented channel. Current NSIS configuration and GitHub EXE replacement updater are not MSIX-ready. See [STORE_DISTRIBUTION.md](STORE_DISTRIBUTION.md) for source-backed costs, packaging and isolated compatibility trials. Product identity/reservation, packaged CLI/auth/persistence/lifecycle tests and certification remain pending.
- **Mobile preview:** the browser companion is implemented in source. Sharing requires Tailscale Serve HTTPS account activation/configuration by the owner; the app never exposes the local runtime/Vite or changes tailnet settings automatically. On this PC Tailscale was running, but Serve activation was required; the attempted isolated Serve command was stopped and configuration remains empty. Actual tailnet HTTPS/phone reachability is unverified.
- **Cross-platform direction:** owner authorized implementation. Shared wire types/portable host boundary, native paths, Unix CLI process groups and macOS CI are implemented in source. Next are actual Mac native/provider validation and the paired remote web trial, then Tauri mobile. The current published Windows app has no remote/mobile support.
- **Hardware constraint (2026-11-06):** owner has no MacBook. Continue hosted macOS build/fixture checks; do not block Windows-host/mobile-web pairing on purchasing hardware. Native Mac UI/IME, real provider sign-ins/Keychain and distribution tests need an appropriate remote Mac environment or a Mac beta tester later. No rental, account sign-in or paid service is authorized by this clarification.

## Recent tasks — keep the latest five

### 2026-11-06 — Mobile web companion implementation (preview candidate)

- Added an opt-in separate loopback gateway with single-use five-minute QR challenges, named host approval, 30-day hashed device credentials, HttpOnly/SameSite cookies, Origin checks and live revocation. Project/file/event routing is scoped; full-access agent tools retain the host's real permissions and are not claimed to be sandboxed.
- Added a shared Markdown renderer, host connection/device controls and an English/Korean phone layout with agent tabs, streamed retained notes, private drafts, account quota windows, line-aware file previews, own-job cancellation and foreground reconnect. Snapshot queries keep only latest complete notes and bounded activity; note/phase/tool streaming avoids full-state retransmission.
- Added local/admin and companion OpenAPI contracts, a credential-free Postman v3 boundary collection, native fixture/API tests and phone-sized Edge UI checks. The initial Windows checks passed: 24 Rust tests, 8 frontend tests/build, existing runtime tests for both launchers, 18 desktop UI checks, 10 companion UI checks, and 5 local Postman assertions (no cloud run reporting). Note-compaction regressions passed locally; final UI and CI checks are pending.
- Prepared source version 3.2.0-beta.1 and SemVer-aware preview-to-stable updates. No preview release is published yet. Source is on `feat/mobile-companion`, based on the portable-host branch; stable v3.1.0 is unchanged.
- Tailnet is connected but Serve needs account-owner web activation. No live phone/Tailscale route, real Mac GUI/provider check, native mobile binary, signing approval or push delivery is claimed. Next: finish final checks, publish a Windows preview, then have the owner enable Serve and test the private HTTPS path from a phone.

### 2026-11-06 — Portable execution host implementation

- Added a Cargo workspace with serde-only `council-core`, GUI-independent `council-host`/`CouncilHost`, and a thin Tauri shell. Preserved `/v1` payloads, SQLite import and the portable desktop `--serve` entry point. Runtime revision 3 prevents reusing the older idle engine silently.
- Added native data/Cursor profile paths, Finder-compatible CLI search fallbacks, Unix case-preserving project keys, absolute file-URI handling, private Unix runtime credentials, process-group cancellation and SIGTERM shutdown. Non-Windows update installation rejects before downloading a Windows EXE.
- Made runtime fixtures platform-aware and added host-stop descendant checks, architectural dependency checks and Windows/macOS CI. Updated agent instructions, roadmap and operational documentation; included the preceding uncommitted Store assessment documents.
- Passed locally on Windows: 20 Rust tests, 6 frontend tests/build, runtime integration for both launchers (including matching-host reuse and refusing incompatible busy-host replacement), 18 browser checks, dependency boundaries, document links and whitespace validation. Final Windows/macOS CI passed at `dd5510a`; work is on `feat/portable-host-foundation`, not merged/released. No native Mac GUI/provider, mobile, signing or release evidence is claimed.
- Next: verify Mac native/provider behavior and implement an isolated paired remote vertical slice. No local provider credentials or Tailscale settings were changed. The final follow-up is documentation-only, so the tested source commit remains the CI reference.

### 2026-11-06 — Desktop and mobile platform roadmap

- Assessed Tauri desktop/mobile support, iOS tooling/lifecycle constraints, Tailscale Serve and macOS distribution requirements against official documentation and current source.
- Proposed Windows/macOS execution hosts with shared React clients and Tauri mobile companions; retain HTTP/SSE replay, add explicit pairing/revocation and device-specific state when remote access is implemented. Recommend a responsive web trial before native mobile, and signed/notarized Mac direct distribution before Mac App Store evaluation.
- Recorded current gaps: mobile Tauri would invoke desktop bootstrap, Windows-specific paths/auth/update handling, no remote gateway/pairing, and no verified macOS process/CLI lifecycle.
- Verification: documentation links, unchanged application version and `git diff --check` passed. No implementation, platform build, API execution, remote configuration, signing or store publication performed.
- Next: portable host/module boundary and macOS audit; then an end-to-end paired phone-to-host trial. Preserve the uncommitted Store assessment documentation from the preceding task.

### 2026-11-06 — Microsoft Store / MSIX feasibility assessment

- Checked Microsoft's current registration, signing, SmartScreen, packaged-desktop and Store-policy documentation, plus Tauri's installer guide and Microsoft's Tauri MSIX sample.
- Recommended an isolated Store MSIX compatibility trial while retaining portable development builds. Corrected the claim that unsigned files cannot build reputation; distinguished Store MSIX signing from publisher-signed MSI/EXE listings and GitHub artifacts.
- Audited current configuration, updater and data-path sources; documented external CLI/auth access, package updates, detached engine lifecycle and migration as unverified compatibility work. Added `STORE_DISTRIBUTION.md` and linked the assessment from build guidance and README.
- Verification: local Markdown links, agent entry points, unchanged app version and `git diff --check` passed. No app build, MSIX installation, certificate change, account action or Store submission was performed.
- Next: obtain Partner Center product identity, then implement/test an isolated packaging trial if requested; do not present the assessment as Store certification.

### 2026-11-06 — Shared agent instructions and build/signing guidance

- Request: assess Gemini's development/release advice and make future agents maintain shared context.
- Added canonical `AGENTS.md`, Claude/Gemini entry points, this status file and `BUILD_AND_SIGNING.md`; linked them from README.
- Recorded the distinction between optional local signing, recommended public-release signing, initial provider approval and per-release human approval. Kept app version and runtime behavior unchanged.
- Verification: local Markdown link/entry-point consistency and `git diff --check` passed. No application rebuild or model/API execution was needed for these documentation changes.
- Next step if signing implementation is requested: resolve the project license with the owner, prepare accurate signing/privacy policies and a provenance-preserving release workflow, then apply/configure provider access. Do not claim approval or add signing secrets speculatively.
