# Shared project status and handoff

Last updated: 2026-11-06. Read with [AGENTS.md](../AGENTS.md); verify time-sensitive claims against source and live services. Replace stale current-state information instead of accumulating a second conversation transcript.

## Current product

- Latest published application: [v3.1.0](https://github.com/jwjp/agent-council/releases/tag/v3.1.0), Windows x64 portable EXE/ZIP, **unsigned**. The portable-host source milestone below does not publish a new app version or replace those release assets.
- Stack: Tauri 2, React/TypeScript, Rust engine; no shipped Python or Node.js runtime. Current CLI adapters: Codex, Claude Code, Antigravity, Grok, Cursor Agent, Gemini CLI.
- Optional lead and optional reviewers; bounded correction/recheck workflow, attributed discussion/report, durable chat/drafts/jobs, cancel, Markdown, split view, complete bounded working notes and read-only file previews.
- Account usage is separate from project tokens. Quota periods/model groups, resets, sources and explicitly stale readings are retained. Cursor IDE quota and Agent CLI authentication are independent.
- Engine runs separately as `AgentCouncil.exe --serve`; closing the window does not stop work. Check version/revision and isolate test data when testing backend rebuilds.
- Source workspace now separates `council-core` wire types, GUI-independent `council-host` library/`CouncilHost` executable, and the Tauri desktop shell. Both executables use runtime revision 3; paths, commands and remaining platform limits are in [PORTABLE_HOST.md](PORTABLE_HOST.md). Published v3.1.0 binaries predate this refactor.
- Protocol is authenticated loopback HTTP/SSE. Mobile builds, Tailscale exposure, pairing and remote notifications are not implemented.

## Verification evidence

- Last application-code verification for v3.1.0: 6 frontend tests, 16 Rust tests, 18 browser UI checks, release-executable API integration and native Korean UI / working-note / file-link checks. Details and limitations: [verification.md](verification.md).
- GitHub Windows checks passed for application commit `d9ccd2f5753b2d3bd6bbb766236e8d1dce0e8053`: [run](https://github.com/jwjp/agent-council/actions/runs/42138950917).
- Read-only live usage probes on 2026-11-06 returned data for Codex, Claude Code, Antigravity, Grok and Cursor. Gemini had no local OAuth sign-in. These observations do not prove future login availability or full live coding/review for every provider.
- Model probes were deliberately small: an earlier Codex no-tools response and an Antigravity no-tools streamed response. Full workflows use isolated native fixtures; the Antigravity fixture also exercises streamed text with an empty final response body.
- Portable-host source verification on Windows: 20 Rust tests, 6 frontend tests/build, both debug launchers' real loopback integration using deterministic six-agent fixtures, 18 browser UI checks and core/host dependency-boundary checks passed. This is separate from the older published release/native UI/live-account evidence above. macOS CI result is pending below.

## Decisions and pending work

- **Development:** unsigned debug builds and frontend hot reload. Do not run optimized builds/signing/release publication for each edit. Existing push/PR workflow already uses `Swatinem/rust-cache`.
- **Signing:** recommended for public releases, not a prerequisite for local development. See [BUILD_AND_SIGNING.md](BUILD_AND_SIGNING.md). SignPath requires manual release signing approvals; tagging cannot guarantee unattended completion.
- **Eligibility:** no project-level license has been chosen; the Orca MIT notice is not this project's license. No signing application/approval is recorded. OSSign was not accepting new applications at the last check and has a six-month activity requirement. Recheck external conditions before acting.
- **Release automation:** tag/manual signed release workflow is a proposed next implementation, not an existing feature. Current workflow verifies code; previous release artifacts were built/published separately. Do not claim source-to-signed-binary provenance yet.
- **Microsoft Store:** owner reports Partner Center registration complete. Store-hosted MSIX is a recommended candidate, not a finalized/implemented channel. Current NSIS configuration and GitHub EXE replacement updater are not MSIX-ready. See [STORE_DISTRIBUTION.md](STORE_DISTRIBUTION.md) for source-backed costs, packaging and isolated compatibility trials. Product identity/reservation, packaged CLI/auth/persistence/lifecycle tests and certification remain pending.
- **Future mobile:** build on the shared Rust protocol and explicit device pairing/authentication, with Tailscale/LAN design informed by the user's Orca references. Do not expose the current local token/runtime to a network as a shortcut.
- **Cross-platform direction:** owner authorized implementation. Shared wire types/portable host boundary, native paths, Unix CLI process groups and macOS CI are implemented in source. Next are actual Mac native/provider validation and the paired remote web trial, then Tauri mobile. The current published Windows app has no remote/mobile support.

## Recent tasks — keep the latest five

### 2026-11-06 — Portable execution host implementation

- Added a Cargo workspace with serde-only `council-core`, GUI-independent `council-host`/`CouncilHost`, and a thin Tauri shell. Preserved `/v1` payloads, SQLite import and the portable desktop `--serve` entry point. Runtime revision 3 prevents reusing the older idle engine silently.
- Added native data/Cursor profile paths, Finder-compatible CLI search fallbacks, Unix case-preserving project keys, absolute file-URI handling, private Unix runtime credentials, process-group cancellation and SIGTERM shutdown. Non-Windows update installation rejects before downloading a Windows EXE.
- Made runtime fixtures platform-aware and added host-stop descendant checks, architectural dependency checks and Windows/macOS CI. Updated agent instructions, roadmap and operational documentation; included the preceding uncommitted Store assessment documents.
- Passed locally on Windows: 20 Rust tests, 6 frontend tests/build, runtime integration for both launchers, 18 browser checks, dependency boundaries and whitespace validation. macOS CI is pending; no real Mac GUI/provider, mobile, signing or release evidence is claimed.
- Next: inspect macOS CI, fix failures, then verify Mac native/provider behavior and implement an isolated paired remote vertical slice. No local provider credentials or Tailscale settings were changed.

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

### 2026-11-06 — v3.1.0 quota, notes and file navigation

- Audited quota mappings against Orca commit `0fe7a0beed4d7fd914c3ea9408eccf419bfe22d8`; attribution is in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- Fixed Codex period classification, partial/stale Claude updates, disabled Antigravity buckets and stale refresh display. Added readable complete notes, recovery of finished legacy note text, scoped line-aware file previews and clearer Cursor CLI authentication guidance.
- Published v3.1.0 and verified the uploaded asset digests. Application validation is summarized above; all-provider live coding and remote/mobile support remain unverified/unimplemented respectively.
