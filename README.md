# Agent Council

A local workspace for coding agents and independent review. **Tauri 2 + React/TypeScript + Rust throughout.** No Python runtime, Electron or Node.js runtime is shipped. Node.js is a build tool only. Windows uses Microsoft WebView2.

## Install

- **Microsoft Store** — [Install Agent Council for Windows 11 x64](https://apps.microsoft.com/detail/9P6TSDW87WP3). The free Store edition receives updates through Microsoft Store.
- **Portable** — Download the [stable ZIP](https://github.com/jwjp/agent-council/releases/latest) or [3.2.0-beta.4 preview](https://github.com/jwjp/agent-council/releases/tag/v3.2.0-beta.4). Extract the ZIP and open `AgentCouncil.exe` or `Launch Agent Council.cmd`. Portable builds are unsigned.

Install at least one supported agent CLI separately, sign in under your Windows account and make sure the CLI is on PATH.

Open **Agents** to choose an optional lead agent and optional reviewers. The composer offers direct lead and execution permission selectors. Click the project name to select a folder. The top menu or **Ctrl+,** opens workspace and appearance settings, including reference folders, English/Korean, and light/dark/system appearance. Enter sends; Shift+Enter inserts a line. Korean IME composition is handled by WebView2, and Enter during composition does not send a request.

## Runtime and workflow

- The desktop shell starts a separate **Rust** runtime using the same executable (`--serve`). Closing a window leaves accepted work running. Reopening reconnects to the existing runtime.
- The lead agent executes requested changes and relevant checks. Reviewers independently inspect the request and result. For implemented changes with confirmed review findings, the lead makes one bounded correction pass and reviewers recheck it. Participants then compare opinions and contribute to an attributed final report. Analysis does not automatically trigger edits. Review-only and lead-only turns are supported.
- New installations default to all-agent full access. Existing installations retain their saved permission policy. Standard permissions and lead-only full access are also available. Reviews instruct agents not to modify files. With all-agent full access that instruction is not a filesystem restriction.
- Reports render Markdown, code and tables. Split panes show different agents; activity logs retain phases, tools, and paced notes. Scrolling up does not force the reader back to the bottom.
- The beta.2 workflow displays completed reviews immediately and shows real round/member counts through review, optional correction/recheck, discussion and synthesis. A lead question waits for your answer; failed participants are not repeatedly called in later rounds. New opinions can be opened without losing your reading position.
- Cancel stops the running CLI process tree on Windows. Job objects also close child processes if the Rust runtime exits. Interrupted work is marked **interrupted**, not silently restarted.
- Messages, project drafts, job state and events persist in SQLite. Portable builds use `%LOCALAPPDATA%\AgentCouncil` and import existing v2 settings and per-folder chat JSON while keeping the originals. The Store edition keeps its own data in the Windows package's `LocalState` folder. Recent transcript excerpts carry into follow-up requests.
- The bottom usage strip shows **account quota used** and reset countdowns. Click any agent for its quota windows, source, refresh time and separately reported project token counts. Existing local CLI/IDE logins are reused: Codex and Antigravity query their CLIs; Claude, Grok, Cursor and Gemini query the providers' usage endpoints. Credentials remain in memory and are not returned to the UI. Missing sign-ins, unavailable quotas and errors are explicit; token counts are never substituted for account percentages. Provider endpoint changes may require adapter updates. See [protocol acknowledgments](docs/THIRD_PARTY_NOTICES.md).

## Reading and usage

The footer labels the period of the highest reported usage percentage (`5h`, `wk`, `mo` or a model group). The popover shows every reported window. A CLI's partial limit event preserves other known windows; lower stale snapshots for the same period are ignored. Failed refreshes retain the last known quota with an explicit stale label. Usage refreshes after work finishes. Cursor IDE quota access does not imply Cursor Agent CLI is signed in. Use `cursor-agent.cmd login` on Windows or `cursor-agent login` on macOS/Linux; Grok can also install the generic `agent` name. See [CLI troubleshooting](docs/CLI_TROUBLESHOOTING.md). Collision prevention and corrected UI commands ship in beta.2; the older beta.1 download is unchanged.

In beta.4, open **Agents → Claude accounts** or **Codex accounts** to connect an existing CLI sign-in or prepare a separate login. Each account can lead or review and has its own results, project tokens and available account limits. The usage panel shows one row per account and expands to all reported limits. [Account setup](docs/CLI_TROUBLESHOOTING.md#use-multiple-claude-code-sign-ins)

Working notes keep complete snapshots rather than the last few characters. Choose **Read full note** for Markdown, tables and clickable file references. Project/reference file links open a read-only preview at the specified `:line` or `#Lline`, including Windows paths. Previews cap rendering at 512 KiB and 3,000 lines, reject binary content and enforce configured folder boundaries. Final reports remain separate from bounded working notes.

In beta.4, the final report includes the engine's counts of lead and individual reviewer responses. When a request explicitly asks for a short answer, the desktop and companion show the answer first and let the reader expand the review details.

**Changes from this run** in the desktop final report opens a read-only file diff against the start of the request. Git projects use tracked and non-ignored untracked files. Other folders use supported source, documentation and configuration files and skip hidden entries, common generated folders, and nested repositories. Captures are bounded and can be partial or unavailable.

## Updates

For the Store edition, use Microsoft Store to check for updates. For the stable portable edition, choose **App menu → Check for updates**. The portable updater verifies GitHub's SHA-256 asset digest. To update the preview, download the latest preview ZIP. Finish any active work before updating.

## Mobile web companion preview

The Rust engine exposes an authenticated, versioned HTTP/SSE interface on an ephemeral **loopback-only** port. Durable event IDs support replay after a client disconnect. See [runtime protocol](docs/runtime-api.md) and the [OpenAPI contract](docs/openapi.json).

The Store edition and the [**3.2.0-beta.4 Windows preview**](https://github.com/jwjp/agent-council/releases/tag/v3.2.0-beta.4) include **App menu → Connect a phone**. Pairing uses expiring QR invitations, host approval and revocable device access. Phones can continue an approved project's conversation, inspect per-agent results, progress, files and usage, and cancel their own requests. Full-access agents still run with host permissions. [Setup and verification limits](docs/MOBILE_COMPANION.md).

Tailscale Serve HTTPS must be configured by the user, and a disabled tailnet may require account-owner web activation. The app does not publish any port automatically. Stable v3.1.0 has no companion UI; native mobile distribution and background push are not available. The separate [iPhone-first native shell](docs/NATIVE_COMPANION.md) has passed iOS simulator build/launch and Keychain tests; it does not change the published desktop preview.

Beta.3 adds an iPhone **Add to Home Screen** guide, fixed non-secret launch metadata, fresh-link pairing inside the web app and bounded per-tab recovery for interrupted input. Foreground reconnect preserves newer typing and checks uncertain submission IDs without automatically sending another job. Older beta.2 assets remain unchanged. [Home Screen steps and storage limits](docs/MOBILE_COMPANION.md#iphone-home-screen--current-source).

The phone composer guards active IME composition, preserves final input on focus loss and adapts to the visible keyboard area with a compact layout and **Done** control. On a current-source test build, the owner reported successful physical iPhone Private Safari input, rotation, app-switch, lock and offline-recovery checks, plus Home Screen connection/draft retention after reopening. A separate real Codex/Claude workflow completed implementation, review, discussion and reporting. These are bounded checks, not all-provider or native-phone certification. See the [verification record](docs/LOCAL_TEST_BUILD.md) and [remaining device checks](docs/IPHONE_DEVICE_CHECK.md).

## Develop and verify

Coding agents should start with [AGENTS.md](AGENTS.md) and [shared project status](docs/PROJECT_STATUS.md). Claude and Gemini entry points reference the same rules. Update the status file at the end of meaningful work so the next agent has current decisions, verification evidence and unfinished items. See [build and signing guidance](docs/BUILD_AND_SIGNING.md) for the separate development, CI and release paths.

CI uses Node 22 LTS for development/build tools; Node 24's bundled Fetch currently has a [reported macOS socket crash](https://github.com/nodejs/undici/issues/6075). The shipped Rust applications do not require Node.

The public Microsoft Store package was verified on Windows 11 x64, including installation, startup and a read-only Claude Code request. See the [Store packaging and trial results](docs/STORE_DISTRIBUTION.md).

Planned macOS and native mobile roles, shared-code boundaries and validation milestones are described in the [cross-platform roadmap](docs/CROSS_PLATFORM_ROADMAP.md). See the companion preview above for browser support and remaining device/route validation.

Install Rust, Windows C++ build tools, Node.js and WebView2, then:

```powershell
npm ci
npm run tauri dev
```

Opening the source `index.html` directly displays launch instructions. To run the React interface in a browser, build the GUI-independent engine with `cargo build --locked --manifest-path src-tauri/Cargo.toml -p council-host`, then run `npm run dev` and open **http://127.0.0.1:1420**. The browser cannot launch a native directory picker; it accepts the folder path instead. The desktop executable provides the native picker and window controls. See [portable host instructions](docs/PORTABLE_HOST.md) for the new workspace boundaries, macOS paths and verification limits.

```powershell
npm test
cargo test --workspace --locked --manifest-path src-tauri/Cargo.toml
npm run build
cargo build --workspace --locked --manifest-path src-tauri/Cargo.toml
node scripts/check-host-boundary.mjs
node tests/runtime.mjs
node tests/ui.mjs
npm run tauri build
```

The runtime and browser integration tests use isolated data directories and deterministic native Rust CLI fixtures, not paid model calls. They check authentication, input validation, duplicate requests, lead/review/correction/recheck/conference/report ordering, token accounting, replay, descendant cancellation, persistence, distinct button actions, input preservation, Markdown table scrolling and compact layouts. Browser tests require installed Microsoft Edge and a free port 1420. Live agent/provider behavior requires separately signed-in CLIs.

For a cross-version upgrade rehearsal, provide two existing executable paths explicitly: `node tests/upgrade.mjs OLD_EXE NEW_EXE`. It creates a fresh temporary profile with native fixtures and checks busy-host refusal, idle replacement, retained settings/history/drafts/device cookies, unchanged observer permissions and duplicate-request protection. It does not touch the production profile, existing provider sign-ins or Tailscale. [Recorded upgrade evidence](docs/verification.md#cross-version-upgrade--2026-11-10).
