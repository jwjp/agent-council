# iPhone Safari / Home Screen device check

This checklist records **physical-device evidence**, separately from Edge/WebKit fixtures and the native iOS Simulator. It does not require Apple Developer Program membership. It tests the browser companion; it is not native app installation or TestFlight verification.

## Use the current source without replacing active work

Published beta.2 predates the Home Screen and keyboard changes. A successful source build alone does not replace an already-running background host with the same version/revision.

For a separate test session, build `npm run build`, then `cargo build --locked --manifest-path src-tauri/Cargo.toml -p council-host`. In a new PowerShell terminal at the repository root, select a **new unused** directory under `.runtime-test`, for example:

```powershell
$env:AGENT_COUNCIL_DATA = Join-Path $PWD '.runtime-test\iphone-manual-01'
& .\src-tauri\target\debug\CouncilHost.exe
```

Keep that foreground test host open. In a second PowerShell terminal at the same repository root:

```powershell
$env:AGENT_COUNCIL_DATA = Join-Path $PWD '.runtime-test\iphone-manual-01'
npm run dev
```

Use a free port 1420 and open `http://127.0.0.1:1420` locally on the PC. Choose a small test project and the desired team. The browser bridge reconnects to that isolated foreground debug host. Both terminals must use the same new test directory. Keep the production app/jobs intact. Do not reuse a running test directory or forward this development port to the phone.

Use **Connect a phone** and follow [the existing connection steps](MOBILE_COMPANION.md#connect-a-phone). Choose a separate unused gateway port and unused HTTPS port after checking `tailscale serve status`; preserve existing routes. Only the companion gateway may be forwarded. Route creation, pairing and host approval remain explicit owner actions. This checklist does not configure Tailscale automatically. Input can be tested without sending a request or making a model call; a work-enabled grant is needed to display the composer. Its approval carries the actual execution permission policy.

An embedded, launcher-isolated Windows build is now prepared; see [its exact source/hash and handoff](LOCAL_TEST_BUILD.md). When testing alongside the production host on the same DNS name, **use a separate Private Browsing session**: cookies are shared across ports, so another HTTPS port alone does not protect the original Safari login. Do not pair the test host in the regular production browser context. Test a separate Home Screen icon/session afterward; copying/installing cookies varies by iOS version, and private-tab results are not Home Screen results. See [RFC 6265 §8.5](https://www.rfc-editor.org/rfc/rfc6265#section-8.5) and [WebKit's Home Screen cookie behavior](https://webkit.org/blog/14787/webkit-features-in-safari-17-2/#login-cookies).

## Record the device once

Record the source commit, iPhone model, iOS version, Safari tab versus Home Screen app, portrait/landscape, keyboard language and Wi-Fi/cellular. Do not include invitation URLs, cookies, runtime descriptors, account credentials, private project contents or screenshots containing them.

| Check | Steps | Expected result |
| --- | --- | --- |
| Install / reopen | Pair in Safari; Share → Add to Home Screen; open Council. If asked, paste a fresh same-PC link and approve it on the PC. | App opens without browser chrome. No invitation is stored in the icon's launch URL. A new browser storage context can pair normally. |
| Korean composition | Type `한글 마지막 글자 보존` slowly. Confirm a composing syllable with Return, then continue typing. Try English and Shift+Enter with a hardware keyboard if available. | Committing a syllable does not send a request. Final characters remain intact. Shift+Enter adds a line. Explicit Send / a later non-composing Enter submits once. Do not submit unless you intend an actual agent run. |
| Keyboard / rotation | Open the keyboard, scroll the conversation, rotate both ways, and tap the composer's **Done**. Repeat on a small screen or with a taller keyboard. | Text and Send remain above the keyboard. Extra chrome contracts while editing; normal controls return when space returns. Usage and Disconnect remain accessible in landscape. Pinch zoom is still available. |
| App switch / lock | Type an unsent draft, switch to another app, return; repeat with screen lock/unlock. | Latest input returns. Saving/reconnect state is accurate; a delayed host response does not restore older text. No job starts merely because the app resumes. |
| Connection loss | While the page remains open, temporarily disconnect the phone network or Tailscale. Type more, then reconnect and foreground the app. | Draft remains in the tab; Send is unavailable while disconnected; state and progress resume after connection returns. A full offline cold launch is not supported. |
| Reload / revoke | After the draft reports saved, reload. Revoke this test device from the PC while its page is open. | Saved draft survives reload. Revocation removes access and clears detected local recovery. Accepted host work continues; revocation is not cancellation. |

The tests may expose iOS-specific keyboard/viewport timing that cannot be reproduced with synthetic browser events. Mark **Pass / Fail / Not tested** for each row; do not infer Pass from a build or simulator launch.

## Short result template

```text
Source commit:
iPhone / iOS:
Safari tab or Home Screen:
Keyboard / orientation / network:
Install/reopen:
Korean composition:
Keyboard/rotation:
App switch/lock:
Connection loss:
Reload/revoke:
Observed issue and exact steps:
```

When finished, revoke the test device and disable its test gateway. Remove only the explicitly created test Serve route; leave production routes untouched. After the test host is idle, press Ctrl+C in its own foreground terminal and in the separate Vite terminal. Do not broadly terminate all agent/host processes or delete production data.

References: [Apple Home Screen instructions](https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/ios), [CSSOM View visual viewport model](https://www.w3.org/TR/cssom-view-1/#visualViewport), [UI composition events](https://www.w3.org/TR/uievents/#events-compositionevents).
