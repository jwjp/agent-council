# Current local Windows test build

Prepared on 2026-11-07 for the ordered test-build → physical iPhone → real-provider → preview-release sequence. This is a local test artifact, not a new public release or version upgrade.

| Item | Verified value |
| --- | --- |
| Source revision | `6e67aae21505a69f6d51277ad0dad32d36205c38` (application code last changed in `2aba999`) |
| Build command | `npm run tauri -- build --debug --no-bundle --config .runtime-test/test-build-tauri.json` |
| Build flavor | Embedded frontend, debug, unsigned; separate test window title and Tauri identifier |
| Local directory | `dist/test-6e67aae-20261107` (ignored/private artifact) |
| Start | `Launch Agent Council Test.cmd` in that directory |
| Payload | `app/AgentCouncil.exe`, 32,299,008 bytes |
| SHA-256 | `55e0ff43c7f514ef1e5bedf98006d91c9c2da35ae27be0dc3e993253b113c276` |
| Authenticode | `NotSigned` |
| App version / runtime revision | `3.2.0-beta.2` / `4`; local test identity is not a new release version |

Use the launcher: it sets `AGENT_COUNCIL_DATA` to the bundle's `data` directory and hides the debug console while the GUI opens. Do not run its internal payload directly against the production profile. The runtime's executable path, data directory, PID and revision were verified separately from the existing application. The native webview displayed `http://tauri.localhost/` and Engine connected without a Vite server on port 1420.

Only the owner's selected agent roles, execution policy, language and appearance were imported into the new settings. Project routing uses the separate `sample-project`; references and draft start empty. Production history/provider credential stores were not copied. The host can use matching existing provider sign-ins for ordinary quota reads; pressing Send can run actual agents. Automated verification uses separate fixture profiles instead.

## Checks on these exact executable bytes

- `node tests/runtime.mjs dist/test-6e67aae-20261107/app/AgentCouncil.exe` passed authenticated API, validation, idempotency, coding/review/discussion/report orchestration, usage totals, SSE replay, process-tree cancellation, persistence/restart and compatible/busy bootstrap checks.
- `node tests/companion.mjs dist/test-6e67aae-20261107/app/AgentCouncil.exe` passed pairing/approval, cookies/CSRF/admin separation, observer/work scopes, independent drafts/idempotency, file/event scope, execution, revocation/SSE and persistence using native CLI fixtures.
- Native Windows UI was inspected using Computer Use: embedded page, correct scratch project, selected all-agent policy and separate phone panel. Five provider quota readings appeared; Gemini reported missing sign-in. This is not a complete real-agent workflow or evidence that Cursor IDE quota implies CLI sign-in.
- Private Tailscale HTTPS served the exact embedded companion asset (`companion-CpwOfoI4.js`), manifest and strict CSP with normal certificate validation. Administrator routes are not forwarded.

## Phone handoff and isolation

The active test gateway is loopback `127.0.0.1:43129`, reached through a separately added **private Serve HTTPS port 8443** on the existing host DNS name. The original production HTTPS 443 → gateway 43128 route was compared before/after and preserved; its runtime and two stored device records remain intact. Neither runtime/Vite nor public Funnel was exposed. The test route/runtime remain active for the owner's phone check.

**Different ports do not isolate browser cookies.** On the same DNS name, pairing this test host in the existing regular Safari context can replace the production browser cookie. Use a separate **Private Browsing** session for the initial test. The owner reported successful iPhone access to the connection screen, then requested a retry because it had not been done privately. One completed test-device grant was revoked, no test jobs were running, and a fresh invitation will be issued only after the private tab is ready. If regular Safari was used for pairing, its original login may require re-pairing afterward; stored production device records/history being intact does not prove that the phone cookie stayed intact. [RFC 6265 §8.5](https://www.rfc-editor.org/rfc/rfc6265#section-8.5).

Physical authenticated input, keyboard/IME, rotation, lock/restore, reconnection and Home Screen behavior are **not yet verified**. Continue with [the device checklist](IPHONE_DEVICE_CHECK.md). A Home Screen test must use a separate test icon/session and fresh pairing; Safari Private Browsing evidence alone is not Home Screen evidence. No real model requests or public release have been made during this handoff.

After physical tests, restore/check the original regular Safari connection if needed, then run a small authorized real-provider workflow. Retain source/check evidence before preparing a new public preview. To clean up later, revoke the test device, disable its gateway and remove **only** the test route with `tailscale serve --https=8443 off`; preserve HTTPS 443. Stop only the owned idle test runtime/GUI. Do not broadly terminate agent processes or reset the whole Serve configuration.
