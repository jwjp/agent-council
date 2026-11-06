# Native companion — iPhone first

The separate Tauri application in `mobile/` reuses the React companion UI and the existing `companion-v1` gateway. It does not bundle the execution host, provider accounts, SQLite or agent CLIs. Desktop releases and their version remain unchanged.

## Connection and storage

1. Connect the PC and phone to the private tailnet.
2. On the PC, enable the companion and create a fresh invitation.
3. Paste the complete HTTPS pairing link into Council Companion, enter a device name and approve it on the PC.
4. Only the resulting device credential is persisted: iOS Keychain (`WhenUnlockedThisDeviceOnly`), Android Keystore AES/GCM. Pending invitations are memory-only; restart requires a fresh invitation.

The Rust bridge permits only companion operations, pins the HTTPS origin from the link, verifies certificates, denies redirects and bounds JSON/SSE. Cookies stay in native memory/storage, never JS/localStorage. No administrator bearer token is used. Native external HTTPS links open the system browser.

| Native command | Scope |
| --- | --- |
| `mobile_pair` | HTTPS invitation link + device name; pending approval remains in memory |
| `mobile_request` | Fixed companion REST allowlist; no arbitrary URLs/administrator routes |
| `mobile_events`, `mobile_stop` | Bounded event replay and cancellation by stream ID |
| `mobile_forget` | Remove this device's local stored connection, without claiming host-side revocation |
| `mobile_open_web` | HTTPS link through the system browser, outside the privileged webview |

**Disconnect** calls host logout/revocation while reachable. **Forget saved connection** is a local recovery action; remove the device in the PC panel as well if host-side revocation is needed. Neither action cancels accepted host work.

Closing/backgrounding the phone does not cancel host work. Foreground reconnect fetches a snapshot and resumes persisted events. Background push and continuous iOS background streaming are not implemented.

## Development and verification

From the repository root:

```sh
npm ci
npm run build:mobile
cargo test --locked --manifest-path src-tauri/Cargo.toml -p council-client
cargo check --locked --manifest-path mobile/src-tauri/Cargo.toml
node scripts/check-mobile-boundary.mjs
```

On macOS with Xcode and XcodeGen, from `mobile/`:

```sh
npm run tauri -- ios init --ci
npm run tauri -- ios build --debug --target aarch64-sim --ci
```

Intel runners use `--target x86_64`. The generated Xcode project is ignored; packaged web assets must be rebuilt first. `.github/workflows/mobile.yml` builds without distribution credentials, lets Xcode generate a local simulator identity and embedded simulated Keychain entitlements, and launches/captures the app. This is not an Apple distribution signature. It also runs `node scripts/ios-vault-tests.mjs` against an isolated XCTest host using the same `ConnectionVault.swift`: save/load/update/clear, protection attributes and corrupt-data rejection. The isolated XCTest host is also ad-hoc signed for its own test access group. Do not re-sign the simulator bundle with restricted iOS entitlements after linking: simulated entitlements belong in the executable, and Xcode handles that split. Check the actual CI result before claiming those tests passed. A desktop compile checks Rust/IPC shapes, not the Swift/Kotlin runtime. Simulator artifacts cannot be installed on an iPhone.

`node tests/native-companion-ui.mjs` uses the packaged frontend and mocked native IPC; it checks pairing, report/file views, native web dispatch, draft writes, reload, revocation and local forget. This is separate from Swift/Keychain execution and from the real-host browser tests. The first native alpha accepts a pasted pairing link; it has no built-in QR scanner yet.

## Verified milestone — 2026-11-06

Source `f5f8115` passed [native CI](https://github.com/jwjp/agent-council/actions/runs/42220316056): 16 frontend tests, packaged/development mock-IPC flows, native iOS build, three actual Keychain XCTest cases, simulator install/launch and an inspected clean iPhone 17 Pro pairing screenshot. [Windows/macOS regression CI](https://github.com/jwjp/agent-council/actions/runs/42220316060) also passed. Artifact `ios-simulator-evidence` contains the simulator bundle, screenshot, launch/entitlement diagnostics and XCTest result.

The initial unsigned test host could not access Keychain. Post-link signing with restricted iOS entitlements then prevented app launch. Letting Xcode generate its simulator signature and embedded simulated entitlements resolved both; do not use `--no-sign` for these Keychain checks. No physical iPhone, native-to-real-tailnet pairing, lock/restore behavior on hardware, built-in QR scanner, Android build, push or distribution is verified by this milestone.

## Distribution boundary

Physical iPhone installation still requires Apple provisioning/signing; TestFlight/App Store distribution requires Apple Developer Program enrollment and App Store Connect setup. This repository has no Apple signing credentials or TestFlight upload configuration. Do not publish a simulator/ad-hoc test bundle as an installable iPhone release. Android native glue is present but Android builds/device validation are a later step.

Owner reported no Apple Developer Program membership on 2026-11-06. No paid enrollment is needed for the CI/simulator work. Until native distribution is prepared, the existing Safari HTTPS companion remains the usable iPhone route. No new Tailscale routes, account sign-ins or paid enrollments are configured by this work.

References: [Apple membership and free Personal Team limits](https://developer.apple.com/help/account/basics/about-your-developer-account), [Tauri iOS signing](https://v2.tauri.app/distribute/sign/ios/), [mobile plugins](https://v2.tauri.app/develop/plugins/develop-mobile/).
