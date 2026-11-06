# Shared project status and handoff

Last updated: 2026-11-06. Read with [AGENTS.md](../AGENTS.md); verify time-sensitive claims against source and live services. Replace stale current-state information instead of accumulating a second conversation transcript.

## Current product

- Latest published application: [v3.1.0](https://github.com/jwjp/agent-council/releases/tag/v3.1.0), Windows x64 portable EXE/ZIP, **unsigned**. Version is unchanged by the instruction/documentation task below.
- Stack: Tauri 2, React/TypeScript, Rust engine; no shipped Python or Node.js runtime. Current CLI adapters: Codex, Claude Code, Antigravity, Grok, Cursor Agent, Gemini CLI.
- Optional lead and optional reviewers; bounded correction/recheck workflow, attributed discussion/report, durable chat/drafts/jobs, cancel, Markdown, split view, complete bounded working notes and read-only file previews.
- Account usage is separate from project tokens. Quota periods/model groups, resets, sources and explicitly stale readings are retained. Cursor IDE quota and Agent CLI authentication are independent.
- Engine runs separately as `AgentCouncil.exe --serve`; closing the window does not stop work. Check version/revision and isolate test data when testing backend rebuilds.
- Protocol is authenticated loopback HTTP/SSE. Mobile builds, Tailscale exposure, pairing and remote notifications are not implemented.

## Verification evidence

- Last application-code verification for v3.1.0: 6 frontend tests, 16 Rust tests, 18 browser UI checks, release-executable API integration and native Korean UI / working-note / file-link checks. Details and limitations: [verification.md](verification.md).
- GitHub Windows checks passed for application commit `d9ccd2f5753b2d3bd6bbb766236e8d1dce0e8053`: [run](https://github.com/jwjp/agent-council/actions/runs/42138950917).
- Read-only live usage probes on 2026-11-06 returned data for Codex, Claude Code, Antigravity, Grok and Cursor. Gemini had no local OAuth sign-in. These observations do not prove future login availability or full live coding/review for every provider.
- Model probes were deliberately small: an earlier Codex no-tools response and an Antigravity no-tools streamed response. Full workflows use isolated native fixtures; the Antigravity fixture also exercises streamed text with an empty final response body.
- Current documentation task changes no application behavior. Its link/consistency and whitespace checks are recorded in the latest task entry, not counted as a fresh application test run.

## Decisions and pending work

- **Development:** unsigned debug builds and frontend hot reload. Do not run optimized builds/signing/release publication for each edit. Existing push/PR workflow already uses `Swatinem/rust-cache`.
- **Signing:** recommended for public releases, not a prerequisite for local development. See [BUILD_AND_SIGNING.md](BUILD_AND_SIGNING.md). SignPath requires manual release signing approvals; tagging cannot guarantee unattended completion.
- **Eligibility:** no project-level license has been chosen; the Orca MIT notice is not this project's license. No signing application/approval is recorded. OSSign was not accepting new applications at the last check and has a six-month activity requirement. Recheck external conditions before acting.
- **Release automation:** tag/manual signed release workflow is a proposed next implementation, not an existing feature. Current workflow verifies code; previous release artifacts were built/published separately. Do not claim source-to-signed-binary provenance yet.
- **Future mobile:** build on the shared Rust protocol and explicit device pairing/authentication, with Tailscale/LAN design informed by the user's Orca references. Do not expose the current local token/runtime to a network as a shortcut.

## Recent tasks — keep the latest five

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
