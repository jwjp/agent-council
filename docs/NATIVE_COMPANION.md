# Native companion — iPhone first

The separate Tauri application in `mobile/` reuses the React companion UI and the existing `companion-v1` gateway. It does not bundle the execution host, provider accounts, SQLite or agent CLIs. Desktop releases and their version remain unchanged.

## Connection and storage

1. Connect the PC and phone to the private tailnet.
2. On the PC, enable the companion and create a fresh invitation.
3. Paste the complete HTTPS pairing link into Council Companion, enter a device name and approve it on the PC.
4. Only the resulting device credential is persisted: iOS Keychain (`WhenUnlockedThisDeviceOnly`), Android Keystore AES/GCM. Pending invitations are memory-only; restart requires a fresh invitation.

The Rust bridge permits only companion operations, pins the HTTPS origin from the link, verifies certificates, denies redirects and bounds JSON/SSE. Cookies stay in native memory/storage, never JS/localStorage. No administrator bearer token is used. Native external HTTPS links open the system browser.

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
npm run tauri -- ios build --debug --target aarch64-sim --no-sign --ci
```

Intel runners use `--target x86_64`. The generated Xcode project is ignored; packaged web assets must be rebuilt first. `.github/workflows/mobile.yml` performs an unsigned simulator build and native launch/screenshot without developer-account credentials. A desktop compile checks Rust/IPC shapes, not the Swift/Kotlin runtime. Simulator artifacts cannot be installed on an iPhone.

## Distribution boundary

Physical iPhone installation still requires Apple provisioning/signing; TestFlight/App Store distribution requires Apple Developer Program enrollment and App Store Connect setup. This repository has no Apple signing credentials or TestFlight upload configuration. Do not publish an unsigned simulator bundle as an iPhone download. Android native glue is present but Android builds/device validation are a later step.

Until native distribution is prepared, the existing Safari HTTPS companion remains the usable iPhone route. No new Tailscale routes, account sign-ins or paid enrollments are configured by this work.

References: [Tauri iOS signing](https://v2.tauri.app/distribute/sign/ios/), [mobile plugins](https://v2.tauri.app/develop/plugins/develop-mobile/).
