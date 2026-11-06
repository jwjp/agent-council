# Cross-platform recommendation

Assessed 2026-11-06. The [portable host](PORTABLE_HOST.md) and [mobile browser companion](MOBILE_COMPANION.md) are implemented; Windows/macOS CI passed. The companion is published as a separate Windows preview with an opt-in gateway, host-approved pairing and device revocation. After owner Serve activation, an isolated HTTPS/browser test passed on 8443. Physical phone/Safari, native Mac/provider verification, native mobile builds and push remain pending. The owner has no MacBook; continue hosted CI without blocking Windows-host/browser work on hardware purchase.

## Platform roles

| Platform | Proposed role | Initial distribution |
| --- | --- | --- |
| Windows | Local execution host and desktop client; can also connect to another host | Existing GitHub portable build; Store MSIX after the separate compatibility trial |
| macOS | Local execution host and desktop client; can also connect to another host | Developer ID-signed, notarized DMG; evaluate Mac App Store later |
| iOS / Android | Companion client: submit requests, inspect progress/reviews/diffs/files/usage, answer questions and cancel jobs on a paired host | Responsive web/PWA trial, then Tauri mobile apps |

Keep **Tauri 2 + React/TypeScript + Rust** as the primary stack. Tauri supports desktop and mobile targets; this does not make the current desktop execution engine suitable for mobile as-is. Mobile clients should not bundle the external desktop AI CLIs or attempt to reproduce desktop background process behavior. iOS has code-execution/container and background-service constraints. [Tauri overview](https://v2.tauri.app/start/), [Apple guidelines 2.5.2/2.5.4](https://developer.apple.com/app-store/review/guidelines/).

A host owns its projects, local CLI sign-ins, quotas, SQLite history and jobs. A phone connected to the Windows host sees the Windows files and that host's account usage; a Mac connected to it can do the same. Choosing a different host does not synchronize repositories, sign-ins or histories automatically. The host must stay powered, awake and reachable for ongoing execution. Client disconnection must not cancel a job.

## Architecture direction

The portable host/shared types and browser companion are now implemented. The design below explains that direction and the remaining native-client work; the implemented browser contract is in [COMPANION_API.md](COMPANION_API.md).

- A small shared Rust domain/protocol crate for typed data and orchestration rules; a desktop-host crate for Axum/SSE, SQLite, CLI subprocesses, filesystem access and usage probes; thin desktop and mobile shells. Keep desktop-only dependencies out of the mobile dependency graph. Refactor incrementally with existing tests rather than rewrite the engine wholesale.
- Share React message/Markdown/file-preview/usage components, types and a host-aware transport. Separate local desktop bootstrap from paired remote bootstrap. Current `src/api.ts` unconditionally invokes desktop `bootstrap` whenever it is in Tauri, so it cannot serve as the mobile connection path unchanged.
- Keep shell-specific actions explicit: a phone's folder picker cannot select the host's project directory. Provide scoped host-side project selection. Client navigation/drafts need client/session ownership instead of one device silently changing another device's active selection.
- Mobile layout: one main conversation/report, agent tabs or a bottom sheet, expandable activity timeline and readable quota details. Preserve side-by-side comparison for wider displays; do not shrink desktop split panes into phone-width columns. Test Korean composition, keyboard/safe areas, touch targets, Markdown-table scrolling and accessibility on real devices.

## Remote connection design

Use Tailscale as the first network transport, with the host service still bound to loopback behind a deliberate HTTPS gateway/proxy. Tailscale Serve can proxy a local service privately within the tailnet and enforce tailnet access controls. It is distinct from public Funnel. Do not configure either during a planning task. [Official Serve documentation](https://tailscale.com/docs/features/tailscale-serve).

Tailscale network membership must not substitute for application authorization. The browser preview implements explicit host approval and a short-lived, single-use QR pairing challenge, separate revocable HttpOnly device cookies, and scoped project/action routing. Keep the existing local runtime bearer and provider secrets private to the host. Never put reusable tokens in URLs or share the local descriptor with the phone. The gateway does not forward local maintenance/update/settings privileges. Secure native credential transport/storage still needs implementation before shipping native clients.

The browser preview reuses durable SSE event IDs/replay, foreground snapshots and idempotent commands, with a `companion-v1` protocol identifier and its own [companion contract](COMPANION_API.md). Keep the [local runtime contract](runtime-api.md) separate from remote authorization and maintain both specs/tests when interfaces change.

Treat mobile background suspension as normal. Persist jobs/events on the host, then resynchronize on foreground/reconnection. Native completion alerts need a separate APNs/FCM notification design and possibly a small relay; Tailscale plus an open SSE connection does not guarantee background push delivery. Keep code and logs on the host by default; an eventual notification relay should carry only the necessary notification metadata. No relay/cloud synchronization is needed for the first foreground companion trial.

## Implementation sequence and exit criteria

1. **Portable host foundation.** Preserve Windows behavior while separating domain, host and shell responsibilities. Audit platform-specific paths, CLI discovery, process-tree cancellation, credential access and update channels. Existing Windows fixtures must continue to pass.
2. **macOS host.** Start with Apple Silicon, then add Intel if needed. Test GUI-launched PATH discovery, data under `~/Library/Application Support`, real provider sign-in/quota handling, process groups, shutdown and signed app lifecycle. Current Cursor protected credentials explicitly fail on non-Windows; generic compilation is insufficient. Add macOS CI plus real-Mac verification.
3. **Remote vertical slice.** Build isolated pairing/gateway and responsive web access to a Windows host. Prove one phone can submit a request, see agent progress/results, disconnect, reconnect without duplicate work and revoke access. Cover host-side project selection and per-device UI state. Maintain the six reliable adapters rather than expanding provider count.
4. **Tauri mobile apps.** Reuse the proven transport/UI on iOS and Android, adding secure device credential storage, QR scanning, deep links and lifecycle integration. Decide whether native push is needed after the foreground workflow works. Verify on real iPhone/Android devices; store acceptance is separate.
5. **Release channels.** Ship desktop/mobile artifacts only after each platform's checks. Windows Store MSIX can proceed independently after compatibility; Mac direct distribution precedes a Mac App Store evaluation. Avoid tying every routine edit to signing or store review.

The macOS Store requires App Sandbox, which warrants separate compatibility work for a tool controlling external CLIs and project folders. Direct macOS distribution with signing/notarization is therefore the recommended first route, not a claim that Store approval is impossible. [Tauri App Store requirements](https://v2.tauri.app/distribute/app-store/), [macOS signing/notarization](https://v2.tauri.app/distribute/sign/macos/).

iOS builds require macOS and Xcode; Mac hardware or a macOS build runner and real-device testing must be available. Platform integration may require Swift/Kotlin in small plugins, although orchestration remains Rust and shared UI remains React. Do not promise that all platform APIs can be handled by unchanged Rust/TypeScript alone. [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

## Evidence and next step

The original assessment read current manifests, host modules, `src/api.ts` and runtime documentation. The subsequent portable-host implementation and its evidence are recorded in [PORTABLE_HOST.md](PORTABLE_HOST.md) and [PROJECT_STATUS.md](PROJECT_STATUS.md); do not treat the original assessment as runtime verification. Native Mac/provider validation and the paired remote vertical slice remain open.
