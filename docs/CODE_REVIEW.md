# Code review findings — open risks

Read-only review by Claude Code on 2026-11-06 against `cd3b6c7` (`feat/native-companion`). Nothing was built or executed for this review. Line numbers refer to that commit and can drift; re-read the source before acting.

**Evidence labels.** *Verified* means the code path was read and confirmed directly. *Reported* means a delegated read-only pass found it and it was not independently re-checked; confirm before fixing. None of these items have a reproducing test yet.

## How to use this file

- **Advisory only.** These are one reviewer's opinions for reference. They are not requirements, do not block other work and do not need to be resolved first. The owner decides if and when any item is addressed.
- When working in an area listed below, it is worth reading the related entries so a change does not make the risk worse.
- If an item is fixed, delete the entry (or mark it fixed with the commit). If an entry is wrong or obsolete, remove it with a one-line reason.
- Product decisions documented in [AGENTS.md](../AGENTS.md) (e.g. new-install all-agent full access) are not defects; they are listed only where they amplify another risk.

## Correctness and resource risks

| # | Risk | Location | Failure scenario | Evidence |
|---|---|---|---|---|
| R1 | Desktop SSE reader has no buffer cap, and a malformed frame loops forever | `src/api.ts` `subscribe` (~88-104) | A stream without a `\n\n` boundary grows memory without limit; a frame whose `data:` is not valid JSON throws, reconnects with the same cursor, receives the same frame and retries every 2 s. The companion transport already caps at 1 MB (`src/companion-transport.ts`). | Verified |
| R2 | CLI line length is checked only after the whole line is buffered | `council-host/src/process.rs` (~525-531, `next_line`) | A CLI that emits a huge line without a newline exhausts memory before the 4 MB check runs. | Verified |
| R3 | Accumulated CLI answers are unbounded for `agent`/`grok` | `process.rs` (~323, ~430) | Only `preview` is clipped; the full answer is kept in memory and stored in SQLite. | Reported |
| R4 | No schema versioning, migration or retention | `council-host/src/store.rs` | Schema is `CREATE TABLE IF NOT EXISTS` only; no `user_version`, `ALTER` or `DELETE`. A future column change will not apply to existing databases, and `events` grows forever. | Verified |
| R5 | Full history loaded on every state/start | `store.rs` `messages()`/`jobs()`; `engine.rs` `state_for`, `start`; `companion.rs` cancel | Long-lived projects make each `/state` and job start slower, and the phone snapshot can exceed the native client's 8 MB `MAX_JSON` (`council-client/src/lib.rs`). | Reported |
| R6 | Blocking work on async paths during job start | `engine.rs` (~147-169), `process.rs` launcher probe (~168) | Job start loads all jobs synchronously and resolves the coder launcher; the generic `agent` probe can block up to 3 s with `thread::sleep`. The delegated pass reported this happens while the `active` mutex is held, and `state_for` resolves launchers for all six agents per request. Can stall tokio workers, cancel and state. | Partly verified (sync calls confirmed; lock scope reported) |
| R7 | Prompts passed as argv for some adapters | `process.rs` (~234, ~259, ~282) | Antigravity, Grok and Cursor receive the prompt on the command line. Large requests plus history can exceed the Windows 32K command-line limit and fail to spawn. Possible: no `--` separator for prompts beginning with `-`. | Reported |
| R8 | Usage probes are not tree-killed | `engine.rs` (~672-706) | `codex app-server` and `agy` probes are spawned without a Job Object/process group; `kill()` reaches only the direct child, so grandchildren may be left behind. | Reported |
| R9 | `/state` responses can apply out of order | `src/App.tsx` `refresh` (~261-273); same pattern in `src/companion.tsx` | An older refresh that resolves after a folder change restores the previous `currentFolder`, misfiltering events and saving drafts under the wrong folder until the next refresh. | Reported (possible) |
| R10 | Companion settings poll can overlap | `src/companion-settings.tsx` (~70) | `setInterval(refresh, 1500)` has no in-flight guard with 30 s timeouts, so requests stack when the host is slow. | Reported |
| R11 | Windows runtime replacement race | `server.rs` (~313) | Old runtime is force-killed with `taskkill /T /F` after a `running_jobs == 0` check; a job could start in between. | Reported (possible) |

## Security and boundary observations

| # | Observation | Location | Note | Evidence |
|---|---|---|---|---|
| S1 | Companion file grants are frozen at pairing time | `companion.rs` `read_file` (~676-690) | Uses `device.settings.folder/references`. Removing a reference folder on the host does not remove phone access until the device is revoked (up to the 30-day credential lifetime). Only `permissions` is capped by the host's current value. | Verified |
| S2 | Vite dev bridge returns the bearer token to any local caller | `vite.config.ts` (~18-95) | While `npm run dev` runs, any local process can request the token from `127.0.0.1:1420`; browser cross-origin and DNS-rebinding reads appear blocked. Dev-only. | Reported |
| S3 | Markdown links keep the real `href` | `src/markdown.tsx` | Only `onClick` is intercepted; middle/ctrl-click can follow a relative file link to the Vite server or open a webview window. | Reported (possible) |
| S4 | Admin token comparison is not constant-time; `runtime.json` mode is restricted only on Unix | `server.rs` (~50, ~237-241) | Low risk because the listener is loopback-only and Windows relies on `%LOCALAPPDATA%` ACLs. | Reported |
| S5 | Update digest is integrity, not authenticity | `updates.rs` (~69) | The SHA-256 comes from the same GitHub response as the asset; it detects corruption, not a compromised release. Signing remains the real fix (see [BUILD_AND_SIGNING.md](BUILD_AND_SIGNING.md)). | Reported |

Checked and found sound in this pass: Markdown does not render raw HTML and blocks unsafe schemes; `files.rs` canonicalizes and checks roots (symlink-safe, with a possible canonicalize/open TOCTOU); companion cookies are HttpOnly/SameSite=Strict with exact Origin checks on mutations; desktop IME/Enter handling.

## Maintainability and test gaps

- `src/App.tsx` (~2,100 lines) holds the shell, conversation, agent panes, settings/team editor and update modal in one component with no store. The companion duplicates the event loop, draft persistence, focus trap and file preview; `api.ts` and `companion-transport.ts` each have an SSE parser.
- `engine.rs` `orchestrate` (~235 lines) mixes prompts, marker parsing (repeated three times) and stage control. Admin (`server.rs`) and companion handlers are near-copies. Adapter behavior is spread across string `match name` blocks rather than a per-adapter abstraction.
- No unit tests for `orchestrate`, cancellation, server auth, host-side companion endpoints, `subscribe` reconnect, `MarkdownContent` link handling or React components. UI e2e scripts run only on Windows; `tests/preview.mjs` is not in CI; there is no lint/format step and no check that `docs/openapi.json` and `docs/companion-openapi.json` match their generators.

## Suggested order (if the owner chooses to address them)

1. R1 and R2 (small, testable bounds on untrusted streams).
2. R4/R5 (schema version + retention/pagination) before any persisted shape changes.
3. S1 and R6, then the remaining items as their areas are touched.
