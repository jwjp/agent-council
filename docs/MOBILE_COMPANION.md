# Mobile web companion preview

Source version: **3.2.0-beta.2**, runtime revision **4**. This is a browser companion for a Windows/macOS execution host, not an iOS/Android native app. The gateway is off by default. See project status for the actual preview release and verification state.

## Connect a phone

1. Start the preview `AgentCouncil.exe` (or the current source desktop build). In the top app menu choose **Connect a phone**. The older stable v3.1.0 app has no companion panel.
2. Install/sign in to Tailscale on the host and phone so they can reach each other. In a host terminal, run the command shown in the panel. A typical unused HTTPS port is 8443:

   ```text
   tailscale serve --bg --https=8443 http://127.0.0.1:43128
   ```

   If Tailscale says Serve is not enabled, open the account-authorization URL printed by that command and enable it, then retry. This step belongs to the tailnet account owner. Check existing Serve configuration before choosing a port; do not overwrite another service. The app does not change Serve/Funnel, firewall, sign-in or certificate settings automatically.
3. Paste the printed HTTPS origin, such as `https://your-pc.your-tailnet.ts.net:8443`, into the panel (no `/companion` path), then choose **Start gateway**. The local port must match the command. Only this separate gateway is shared; the administrator runtime and Vite ports stay private.
4. Choose **View progress** or **Send requests**, then **Create pairing QR**. It captures the current project, reference folders, team and permission ceiling. Open the QR with the phone's camera/browser; enter a recognizable device name and request connection.
5. Confirm the name and project on the host and choose **Approve**. Invitations are single-use and expire after five minutes. Completed devices receive their own revocable, 30-day HttpOnly browser cookie; provider sign-ins and the local runtime bearer stay on the host.

The host must remain powered, awake and reachable. Closing the desktop window or leaving the phone browser does not cancel accepted work. Returning to the browser reloads state and resumes event streaming. Background push delivery is not implemented.

## What the phone can do

- Continue the bound project's conversation, follow actual agent activity and inspect attributed council/agent results. The desktop can select another project independently.
- Read Markdown, tables and bounded line-aware previews of files within the approved project/reference roots. Each device has a separate draft; the desktop draft is unaffected.
- View account quota windows, resets and source state separately from project token totals. Missing quota data is not zero usage; protected provider sign-ins still follow host-platform support.
- A work-enabled device can submit requests and cancel only its own requests. The selected agents run with the host's approved/current permission ceiling. **Project routing is not a filesystem sandbox:** full-access agent tools can affect files outside that project. Pair only devices intended to have that authority. Observers cannot submit or cancel work.
- **Disconnect** on the phone revokes its credential. The host can revoke any device, reject a pending claim or turn the gateway off. Revocation ends an open companion event stream; already accepted work continues.

Changing the configured HTTPS origin revokes existing devices. Disabling/re-enabling the same origin preserves paired devices but invalidates outstanding invitations. Phone cookies are not stored in localStorage or exposed to JavaScript. Only the short-lived invitation challenge appears in a QR fragment, which the page immediately removes from browser history.

## iPhone Home Screen — current source

These improvements are in source after beta.2; the published beta.2 EXE/ZIP has not changed. Rebuild the frontend and host together to try them.

Open the paired page in Safari, then choose **Share → Add to Home Screen** (Safari may put Share under More). Enable **Open as Web App** if shown, then open the new Council icon. The page's **Add to Home Screen** button explains these steps in English or Korean. See [Apple's instructions](https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/ios).

The icon always launches `/companion/`; its manifest and launch URL contain no invitation. Depending on iOS/browser storage, the new web app may require pairing again. If it asks for a connection, create a fresh invitation on the same PC, paste that full link into **Pairing link** in the web app, and approve it on the host. A link for another host is rejected locally. The original QR browser flow still works.

Unsynced browser input and an ambiguous submission's request ID have a temporary **per-tab sessionStorage** backup, scoped to the approved device grant. Text is bounded to 64,000 UTF-8 bytes and recovery expires after 24 hours. It is ordinary browser tab storage, not an encrypted native vault. No authentication cookie is copied into it. It is cleared after synchronization/accepted submission, disconnect or detected revocation; a pending submission ID remains until acceptance is resolved. Different grants cannot restore one another's input. Blocked storage is tolerated and the UI explains when input is not backed up.

Returning to the foreground or reconnecting reloads host state before streaming. Delayed saves/snapshots cannot overwrite newer typing; an uncertain submission is checked against the device-scoped request ID, without automatically submitting another job. Clearing browser data, closing a tab or OS storage eviction can lose unsynced input. There is no service worker, offline cold launch, cached private history or background notification delivery. Keep the PC awake and both devices reachable through Tailscale.

## Development and verification

Build the frontend **before** the host so the current companion assets are embedded:

```text
npm ci
npm run build
cargo build --workspace --locked --manifest-path src-tauri/Cargo.toml
node tests/companion.mjs
```

The host package can still build without frontend assets; its companion page then explains that a frontend/host rebuild is required. Static browser assets carry content hashes and cache immutably; HTML/API responses are not cached. The shared Markdown renderer is used by desktop and phone.

With a free port 1420, `node tests/companion-ui.mjs` verifies a phone-sized Edge browser and host setup panel on Windows. macOS CI uses `npx playwright install webkit`, then `COUNCIL_UI_BROWSER=webkit node tests/companion-ui.mjs` to exercise the same flow with WebKit. Edge captures screenshots; WebKit skips screenshot capture because Playwright injects a temporary inline stylesheet that the host's strict CSP correctly rejects. CSP event checks remain enabled. These are browser-engine tests, not physical iPhone Safari/Home Screen installation or Android evidence. Existing desktop checks are in `tests/ui.mjs`. Runtime tests isolate settings, credentials and native CLI fixtures, so no paid model calls are needed.

Local API contracts: [COMPANION_API.md](COMPANION_API.md), [companion OpenAPI](companion-openapi.json), and [local administrator OpenAPI](openapi.json). Regenerate JSON with `node scripts/generate-contract.mjs` and `node scripts/generate-companion-contract.mjs`.

The local Postman v3 collection `postman/collections/Companion Boundaries` holds four credential-free boundary requests and five assertions. Run it against a deliberately enabled test gateway with `--env-var companionOrigin=http://127.0.0.1:PORT --no-report-events`. `COUNCIL_POSTMAN_VERIFY=1 node tests/companion.mjs` runs it within the isolated native harness if Postman is installed. Full approval/cookie flows remain in the native integration harness. Do not put real device cookies in committed Postman files. The CLI's automatic OpenAPI conversion mapped cookie auth to a header, so the checked-in collection is deliberately curated rather than preserving that invalid mapping.

After the owner enabled Serve, an isolated release-EXE test passed over actual Tailscale HTTPS on port 8443: certificate validation, embedded UI, denial of administrator routes, browser pairing/host approval, Secure/HttpOnly/Strict cookies, fixture execution, streamed report, reload and live revocation. The temporary route and isolated runtime were removed afterward. A first attempt on port 18443 timed out on this PC; use the panel's tested 8443 default and verify any alternative port separately.

That test used a phone-sized Edge browser on the host, not a physical phone or Safari. The owner later reported successful phone connection; this does not establish the new Home Screen lifecycle/keyboard behavior. A separate [native shell and secure credential client](NATIVE_COMPANION.md) have passed hosted simulator checks. Native distribution, physical native pairing and APNs/FCM remain later milestones.

Official connection reference: [Tailscale Serve CLI](https://tailscale.com/docs/reference/tailscale-cli/serve).
