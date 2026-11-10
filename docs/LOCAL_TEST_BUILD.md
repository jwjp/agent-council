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

On 2026-11-10 the owner confirmed Private Browsing readiness. The old invitation had expired; a fresh five-minute invitation was issued. The test GUI was reopened and the approval panel displayed, then the owner reported successful connection with the input field visible. The host confirmed one device, zero pending claims and no jobs/messages.

The owner subsequently reported **all five no-send physical Private Safari checks normal**:

| Physical check | Owner-reported result |
| --- | --- |
| Korean final character after tapping Done | Preserved |
| Switch to another app and return | Draft preserved |
| Portrait/landscape rotation with keyboard | Composer and Send visible |
| Lock and unlock with an unsent draft | Draft preserved |
| Type while offline, reconnect, wait for host save and reload | Added text preserved |

These results are owner-reported on a physical iPhone; model/iOS remain unknown. Composing-Return, hardware-keyboard shortcuts and physical revocation are not covered by these answers. Continue with [the device checklist](IPHONE_DEVICE_CHECK.md).

The owner then added a separate **Council test** icon from the private-tab share menu and reported its composer visible. After waiting for host-save indication, closing only that Home Screen app through the app switcher and reopening its icon, the owner confirmed that **both connection and draft remained**. This is owner-reported physical Home Screen install/reopen evidence; it is separate from native Tauri/iPhone distribution, and does not establish Home Screen-specific keyboard/rotation/offline behavior or regular Safari's original production login.

A later host read found a completed request at 2026-11-10 11:23 UTC (20:23 KST): one user message, a Codex work response and no subsequent review/discussion rounds. The host reported 22,144 input / 313 output project tokens and zero running jobs. The owner confirmed intentionally sending it; it was not reported as an accidental IME submission. The agent did not initiate it or remove the record. It is not a full coding/review workflow pass. No public release has been made during this handoff.

## Bounded real-provider workflow — 2026-11-10

Ran the same staged executable with a **new** isolated data/project directory, leaving the physical phone test host, selected team and draft unchanged. Used matching existing provider sign-ins: **Codex lead + Claude Code reviewer**, with the selected `all` permission policy retained. No fixture CLIs were substituted and no extra provider sweep was performed.

The request was to implement a small dependency-free JavaScript port parser and Node tests, entirely inside the disposable project. Observed persisted events/messages established this sequence: Codex implementation → Claude review (`PASS`) → both agents' discussion (each result retained) → attributed council report → `done`. It ran from 20:32:27 to 20:34:46 KST, approximately 2 minutes 19 seconds, with no error events. No confirmed blocker was raised, so correction/recheck was not exercised in this live run; those paths retain separate fixture evidence.

- Inspected actual `port.mjs` / `port.test.mjs` and the final report. Independently reran `node --test port.test.mjs`: **3 passed, 0 failed**. Only those two requested files were added; the initial README remained unchanged.
- Both files' SHA-256 values matched the snapshot taken after implementation and the final snapshot. This is observed file stability, not enforced filesystem isolation for reviewers under full access.
- CLI-reported project totals were Codex **160,774 input / 4,267 output tokens** and Claude **186,883 input / 2,835 output tokens**. These totals are not account quota percentages or a billable-cost calculation.
- Private evidence is under `.runtime-test/live-workflow-1794310346293/`: `evidence.json`, `result.json`, `independent-tests.txt` and `project/`. The owned test host PID 32720 exited only after the workflow was idle. The separate phone/production hosts and Serve routes were not changed.

This establishes one successful real-account Windows implementation/review/discussion/report workflow for two providers. It does not validate all six providers, native Mac/iPhone execution, a physical phone view of this separate workflow, or a new distributable release. No application source/version, executable bytes or published assets changed.

Follow-up on 2026-11-10: [beta.3 was published](https://github.com/jwjp/agent-council/releases/tag/v3.2.0-beta.3) after separate optimized-artifact checks; see [shipping evidence](verification.md#published-beta3--2026-11-10). That release keeps this physical/debug and live-provider evidence distinct. At release-time inspection, the original production host still responded, but the phone-test descriptor's PID 27376 was no longer running and its gateway backend was unreachable. The release task did not restart that test host, remove its data or change its Serve route; do not assume the test icon currently connects merely because earlier checks passed.

Check/restore the original regular Safari connection if needed. To clean up the phone test later, revoke its test device, disable its gateway and remove **only** the test route with `tailscale serve --https=8443 off`; preserve HTTPS 443. Stop only owned idle test runtimes/GUIs. Do not broadly terminate agent processes or reset the whole Serve configuration.
