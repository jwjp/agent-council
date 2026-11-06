# Portable desktop host foundation

Implemented in source on 2026-11-06; no new application version or release has been published. This is the first cross-platform milestone, not completed mobile/remote support.

## Workspace boundaries

The Cargo workspace root remains `src-tauri/Cargo.toml`, so existing Tauri tooling and target paths continue to work.

| Package | Responsibility |
| --- | --- |
| `council-core` | Shared message/job/event/runtime wire types, version and runtime compatibility revision; serde only |
| `council-host` | Orchestration, SQLite, authenticated loopback HTTP/SSE, adapters, quotas, files, platform helpers and Windows updater; no GUI dependencies |
| `agent-council` | Tauri window/native commands, delegates host execution to the library |

The desktop executable still serves its own `--serve` mode, preserving portable EXE installation. The optional `CouncilHost` executable runs the same engine without linking the desktop webview. Vite prefers the headless debug host, then debug desktop, then release equivalents. They use the same data directory/lock and cannot run duplicate engines against it.

Runtime revision is now **3**, with unchanged `/v1` operations and event payloads. Bootstrap will not reuse a revision-2 engine; an idle incompatible engine can be replaced, while active work blocks replacement. Use isolated data for rebuilt-engine tests. The latest public release remains v3.1.0 with its prior engine revision.

## Build and run

```text
# Headless host only: no Tauri/WebView dependency is built
cargo build --locked --manifest-path src-tauri/Cargo.toml -p council-host

# Browser UI with the local engine
npm run dev

# Full desktop workspace
npm run build
cargo build --workspace --locked --manifest-path src-tauri/Cargo.toml

# Shared/host unit tests and architectural boundary check
cargo test --workspace --locked --manifest-path src-tauri/Cargo.toml
node scripts/check-host-boundary.mjs
```

Run `src-tauri/target/debug/CouncilHost.exe` on Windows or `src-tauri/target/debug/CouncilHost` on macOS. No argument starts the host in the foreground; `--ensure-server` starts/reconnects in background and exits. `--serve` is also accepted. This host listens only on `127.0.0.1`; it does not print the bearer token.

`AGENT_COUNCIL_DATA` overrides the data directory for isolated tests. Default data locations:

- Windows: `%LOCALAPPDATA%\AgentCouncil` (existing data and project keys preserved).
- macOS: `~/Library/Application Support/AgentCouncil`.
- Linux: absolute `$XDG_DATA_HOME/AgentCouncil`, otherwise `~/.local/share/AgentCouncil`. Linux is a path/host-code target, not a packaged desktop release claim.

CLI lookup preserves inherited PATH priority. On Unix it also searches common user/Homebrew locations without running interactive shell startup scripts. Node installed only through an unexported version-manager setup can still require a configured PATH. Cursor's profile directory follows the host OS; protected Cursor credentials are still supported only by the Windows decryption path.

Windows continues to use kill-on-close Job Objects. Unix coding/review CLI children get their own process group; cancellation/error/completion drops that owned group. SIGTERM/Ctrl+C on a Unix host stops admission, cancels active work and gives tasks up to ten seconds to persist state before exit. Forced SIGKILL/crashes are not a guaranteed Unix descendant-cleanup mechanism. Jobs not finalized before a restart become interrupted as before. GUI closure alone does not stop the background host.

Unix host data directory and new runtime descriptor are created with user-private permissions. File previews preserve `file:///Users/...` absolute paths. Unix project keys retain path case, avoiding collisions on case-sensitive volumes. Non-Windows update installation fails before network/download work because the existing in-place updater handles a Windows portable EXE only.

## Verification and remaining gaps

`node tests/runtime.mjs` uses the desktop executable by default, with platform-correct executable suffix/PATH. Supply the headless executable path to verify it independently. Fixtures simulate all six adapters, inspect real loopback responses and verify descendant cancellation, host-stop cleanup, persistence, replay and file scopes. They do not exercise real provider accounts.

Windows local evidence: 20 Rust tests, 6 frontend tests, both debug executables' runtime integration and 18 browser UI checks passed. Windows and macOS full workspace compilation/unit tests and both runtime launchers passed in [the first CI run](https://github.com/jwjp/agent-council/actions/runs/42148931804). Subsequent bootstrap regression checks additionally cover matching-engine reuse and refusing to replace an incompatible engine with active work; see shared project status for their final CI result.

Still required before a supported Mac release: native GUI/IME/file-picker checks, real installed CLI/PATH combinations, Keychain/provider quota access where needed, lifecycle under sleep/update, Apple Silicon/Intel coverage appropriate to the release, and signing/notarization. No Mac installer is published. No phone pairing, remote gateway, mobile binary or push implementation is enabled. The next cross-platform feature is an isolated paired phone-to-host connection with explicit per-device access.
