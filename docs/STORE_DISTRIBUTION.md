# Microsoft Store distribution assessment

Updated 2026-11-11. The Windows x64 MSIX compatibility trial passed in an isolated Windows Server 2025 runner. The owner reports Partner Center registration is complete. Product name reservation, Store identity, submission and certification remain open.

## Recommendation and costs

Evaluate **Store-hosted MSIX for stable releases**, retaining GitHub portable builds for development and early testing. The compatibility trial used the existing Tauri/React/Rust executable. Final channel selection depends on the remaining account, update and release checks below.

Microsoft's current onboarding makes Individual and Company registration free. Store MSIX signing is also free after certification; an independently purchased signing certificate is not required for this channel. This does not sign the separately distributed GitHub EXE/ZIP. Provider subscriptions/model usage remain separate costs. [Microsoft registration announcement](https://blogs.windows.com/windowsdeveloper/2026/05/07/publish-to-microsoft-store-as-a-company-now-with-free-registration-and-faster-onboarding/), [signing options](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options).

Store MSIX and Store-listed MSI/EXE are different routes. MSI/EXE submission still requires the publisher's trusted Authenticode signatures. Store installation avoids SmartScreen download prompts; this does not promise that UAC, enterprise policies or prompts from external CLI tools disappear. [Signing options](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options).

Unsigned binaries **can** acquire file-hash reputation; each changed version starts anew. Signed publisher identity can help reputation carry over, but cannot guarantee every future binary avoids warnings. EV signing no longer provides an automatic bypass. [Microsoft SmartScreen explanation](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation).

## Packaging route

The current `src-tauri/tauri.conf.json` targets NSIS. The compatibility trial uses Windows SDK MakeAppx separately from Tauri's normal bundle step. [Tauri guide](https://v2.tauri.app/distribute/microsoft-store/), [Microsoft MakeAppx guide](https://learn.microsoft.com/en-us/windows/msix/package/create-app-package-with-makeappx-tool).

Desktop MSIX can run full-trust processes; it does not inherently require rewriting into UWP/AppContainer. Package files are read-only and filesystem behavior depends on manifest/runtime choices. Full trust here is a Windows application model, not administrator elevation or permission to change a user's selected agent policy. [Packaged desktop behavior](https://learn.microsoft.com/en-us/windows/msix/desktop/desktop-to-uwp-behind-the-scenes).

## Compatibility trial results

The two unsigned x64 packages (`0.0.1.0` and `0.0.2.0`) wrap the verified beta.3 EXE with a trial-only launcher. The distinct `AgentCouncil.CompatibilityTrial` family stores the runtime, WebView2 profile and isolated auth under its own `LocalState`. Both package versions contain the same application bytes; the version change exercises package replacement and data retention. The manifest uses `packagedClassicApp`, `mediumIL`, `runFullTrust` and Microsoft's unsigned development identity suffix. [Unsigned MSIX testing](https://learn.microsoft.com/en-us/windows/msix/package/unsigned-package).

Run from the repository root in PowerShell with the x64 Windows SDK and Rust installed. Use a disposable Windows test environment with an elevated session for deployment.

```powershell
./scripts/build-msix-trial.ps1 -Executable path/to/verified-beta3/AgentCouncil.exe -OutputDirectory .runtime-test/msix-local
./tests/msix-trial.ps1 -PackageDirectory .runtime-test/msix-local
```

Source `49b327e` [passed the hosted trial](https://github.com/jwjp/agent-council/actions/runs/42971839499). Windows registered and launched the app via AppsFolder. Win32 process queries confirmed the registered identity for both GUI and `--serve`. All six CLI fixtures ran, including reads from the external project and reference directory and a fixture write to the project. Closing the GUI preserved an active job, reopening reused the engine, and cancellation stopped the fixture process tree. The idle package upgrade retained the selected project, draft, history and job state. Uninstall removed the package registration and preserved the external project. Downloaded both packages and confirmed their embedded EXE SHA-256 matched the verified beta.3 bytes. [Trial artifacts](https://github.com/jwjp/agent-council/actions/runs/42971839499/artifacts/13834045526).

The local Windows 11 non-elevated attempt failed with `0x80073D2B` when deployment encountered unsigned executable activation. The hosted elevated installation succeeded. The trial uses no local certificate import or Windows security setting changes. Provider login reuse was outside the isolated fixture check. Update while active, clean Windows 11 startup without developer tools, production data migration and Store servicing remain open. [Detailed verification](verification.md#windows-msix-compatibility-trial--2026-11-11).

## Application-specific release checks

| Area / current source | Required evidence before submission |
| --- | --- |
| External CLIs — `process.rs` | Repeat with real installed adapters, including Node/Windows command shims and their PATH. Fixture discovery, execution, project/reference access and cancellation passed. |
| Existing sign-ins/usage — `quota.rs` | Test actual credential locations and quota probes under package identity, especially Cursor IDE database/DPAPI access. Keep secrets out of logs and frontend. Record signed-out states honestly. |
| Persistence — `model.rs`, `store.rs` | Decide migration/coexistence with `%LOCALAPPDATA%\AgentCouncil`. Trial `LocalState` survived the idle upgrade. |
| Detached engine — `main.rs`, `server.rs` | Verify package updates and removal while a job is active. Trial `--serve` launch, GUI reopen and idle upgrade passed. |
| Updates — `updates.rs` | Add channel-aware behavior. The current GitHub updater writes beside/replaces its running EXE via PowerShell; this is incompatible with a read-only MSIX installation. Store builds must use package/Store update handling instead. |
| WebView2 / manifest / assets | Validate runtime prerequisites, Store package identity, appropriate full-trust capability declarations, icons and clean-machine startup. |

Store policies allow disclosed external software dependencies, but require a testable product. Prepare clear CLI/account prerequisites and certification instructions, plus an accurate privacy policy covering provider calls, automatic quota queries and local credential handling. Review the applicable capabilities and AI-content requirements before submission; approval is not established by this assessment. [Store policies](https://learn.microsoft.com/en-us/windows/apps/publish/store-policies).

## Next steps

1. In Partner Center, reserve the product name for the packaged/MSIX route and obtain its exact Identity Name, Publisher and PublisherDisplayName. Do not substitute the Tauri bundle identifier for these values or accidentally select the MSI/EXE listing route.
2. Select the Store data path/migration strategy and use the package channel for updates. Add a backend guard against running the portable updater in an installed MSIX.
3. Verify the release-style package on Windows 11 with real CLI installations, existing sign-ins, a clean user environment and package servicing during active work.
4. Prepare listing/privacy/certification material and Store-specific release automation. Preserve the unsigned development loop. Account actions and final submission remain owner decisions.
