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
- Cancel stops the running CLI process tree on Windows. Job objects also close child processes if the Rust runtime exits. Interrupted work is marked **interrupted**, not silently restarted.
- Messages, project drafts, job state and events persist in SQLite. Portable builds use `%LOCALAPPDATA%\AgentCouncil`. The Store edition keeps its own data in the Windows package's `LocalState` folder. Recent transcript excerpts carry into follow-up requests.
- The bottom usage strip shows **account quota used** and reset countdowns. Click any agent for its quota windows, source, refresh time and separately reported project token counts. Existing local CLI/IDE logins are reused: Codex and Antigravity query their CLIs; Claude, Grok, Cursor and Gemini query the providers' usage endpoints. Credentials remain in memory and are not returned to the UI. Missing sign-ins, unavailable quotas and errors are explicit; token counts are never substituted for account percentages. Provider endpoint changes may require adapter updates. See [protocol acknowledgments](docs/THIRD_PARTY_NOTICES.md).

## Reading and usage

The footer labels the period of the highest reported usage percentage (`5h`, `wk`, `mo` or a model group). The popover shows every reported window. A CLI's partial limit event preserves other known windows; lower stale snapshots for the same period are ignored. Failed refreshes retain the last known quota with an explicit stale label. Usage refreshes after work finishes. Cursor IDE quota access does not imply Cursor Agent CLI is signed in; `agent login` is a separate CLI action.

Working notes keep complete snapshots rather than the last few characters. Choose **Read full note** for Markdown, tables and clickable file references. Project/reference file links open a read-only preview at the specified `:line` or `#Lline`, including Windows paths. Previews cap rendering at 512 KiB and 3,000 lines, reject binary content and enforce configured folder boundaries. Final reports remain separate from bounded working notes.

## Updates

For the Store edition, use Microsoft Store to check for updates. For the stable portable edition, choose **App menu → Check for updates**. The portable updater verifies GitHub's SHA-256 asset digest. To update the preview, download the latest preview ZIP. Finish any active work before updating.

## Remote/mobile foundation

The Rust engine exposes an authenticated, versioned HTTP/SSE interface on an ephemeral **loopback-only** port. Durable event IDs support replay after a client disconnect. See [runtime protocol](docs/runtime-api.md) and the [OpenAPI contract](docs/openapi.json).

The Store edition and the Windows preview include **App menu → Connect a phone** for optional browser pairing. The phone connects to the PC over a private network, such as a Tailscale connection configured by the user.

## Develop and verify

Coding agents should start with [AGENTS.md](AGENTS.md) and [shared project status](docs/PROJECT_STATUS.md). Claude and Gemini entry points reference the same rules. Update the status file at the end of meaningful work so the next agent has current decisions, verification evidence and unfinished items. See [build and signing guidance](docs/BUILD_AND_SIGNING.md) for the separate development, CI and release paths.

Install Rust, Windows C++ build tools, Node.js and WebView2, then:

```powershell
npm ci
npm run tauri dev
```

Opening the source `index.html` directly displays launch instructions. To run the React interface in a browser against the real Rust engine, first build the debug executable, then run `npm run dev` and open **http://127.0.0.1:1420**. The browser cannot launch a native directory picker; it accepts the folder path instead. The desktop executable provides the native picker and window controls.

```powershell
npm test
cargo test --manifest-path src-tauri/Cargo.toml
npm run build
cargo build --manifest-path src-tauri/Cargo.toml
node tests/runtime.mjs
node tests/ui.mjs
npm run tauri build
```

The runtime and browser integration tests use isolated data directories and deterministic native Rust CLI fixtures, not paid model calls. They check authentication, input validation, duplicate requests, lead/review/correction/recheck/conference/report ordering, token accounting, replay, descendant cancellation, persistence, distinct button actions, input preservation, Markdown table scrolling and compact layouts. Browser tests require installed Microsoft Edge and a free port 1420. Live agent/provider behavior requires separately signed-in CLIs.
