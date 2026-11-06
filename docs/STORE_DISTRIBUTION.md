# Microsoft Store distribution assessment

Checked 2026-11-06 against official sources and the current application. This is a recommendation and compatibility plan, not a completed MSIX build, Store submission or certification. The owner reports Partner Center registration is complete; no product identity or name reservation has been recorded in this repository.

## Recommendation and costs

Evaluate **Store-hosted MSIX for stable releases**, retaining GitHub portable builds for development/early testing. Keep the Tauri/React/Rust application; a framework rewrite is not necessary for packaging. Select the final channel after a packaged compatibility trial succeeds.

Microsoft's current onboarding makes Individual and Company registration free. Store MSIX signing is also free after certification; an independently purchased signing certificate is not required for this channel. This does not sign the separately distributed GitHub EXE/ZIP. Provider subscriptions/model usage remain separate costs. [Microsoft registration announcement](https://blogs.windows.com/windowsdeveloper/2026/05/07/publish-to-microsoft-store-as-a-company-now-with-free-registration-and-faster-onboarding/), [signing options](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options).

Store MSIX and Store-listed MSI/EXE are different routes. MSI/EXE submission still requires the publisher's trusted Authenticode signatures. Store installation avoids SmartScreen download prompts; this does not promise that UAC, enterprise policies or prompts from external CLI tools disappear. [Signing options](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options).

Unsigned binaries **can** acquire file-hash reputation; each changed version starts anew. Signed publisher identity can help reputation carry over, but cannot guarantee every future binary avoids warnings. EV signing no longer provides an automatic bypass. [Microsoft SmartScreen explanation](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation).

## Packaging route

The current `src-tauri/tauri.conf.json` targets NSIS only. Tauri's Store guide describes the MSI/EXE route, not a built-in MSIX bundler. Microsoft publishes a Tauri + winapp CLI MSIX sample: use it as a packaging reference, not evidence that Agent Council already works packaged. [Tauri guide](https://v2.tauri.app/distribute/microsoft-store/), [Microsoft sample](https://github.com/microsoft/winappCli/tree/main/samples/tauri-app).

Desktop MSIX can run full-trust processes; it does not inherently require rewriting into UWP/AppContainer. Package files are read-only and filesystem behavior depends on manifest/runtime choices. Full trust here is a Windows application model, not administrator elevation or permission to change a user's selected agent policy. [Packaged desktop behavior](https://learn.microsoft.com/en-us/windows/msix/desktop/desktop-to-uwp-behind-the-scenes).

## Application-specific compatibility trial

| Area / current source | Required evidence before submission |
| --- | --- |
| External CLIs — `process.rs` | Detect and launch all six installed adapters from the packaged process, including Node/Windows command shims and their PATH; test project/reference access, streaming and cancellation. |
| Existing sign-ins/usage — `quota.rs` | Test actual credential locations and quota probes under package identity, especially Cursor IDE database/DPAPI access. Keep secrets out of logs and frontend. Record signed-out states honestly. |
| Persistence — `model.rs`, `store.rs` | Decide migration/coexistence with `%LOCALAPPDATA%\AgentCouncil`; test chat/drafts/settings and SQLite behavior across install/update/uninstall. Do not overwrite production data during trials. |
| Detached engine — `main.rs`, `server.rs` | Test `--serve` launch, reconnect after window close, active-job handling during package updates and engine cleanup on uninstall. Avoid an old engine silently serving a newer GUI. |
| Updates — `updates.rs` | Add channel-aware behavior. The current GitHub updater writes beside/replaces its running EXE via PowerShell; this is incompatible with a read-only MSIX installation. Store builds must use package/Store update handling instead. |
| WebView2 / manifest / assets | Validate runtime prerequisites, Store package identity, appropriate full-trust capability declarations, icons and clean-machine startup. |

Store policies allow disclosed external software dependencies, but require a testable product. Prepare clear CLI/account prerequisites and certification instructions, plus an accurate privacy policy covering provider calls, automatic quota queries and local credential handling. Review the applicable capabilities and AI-content requirements before submission; approval is not established by this assessment. [Store policies](https://learn.microsoft.com/en-us/windows/apps/publish/store-policies).

## Next steps

1. In Partner Center, reserve the product name for the packaged/MSIX route and obtain its exact Identity Name, Publisher and PublisherDisplayName. Do not substitute the Tauri bundle identifier for these values or accidentally select the MSI/EXE listing route.
2. Prepare an isolated MSIX proof of concept with the matching identity; document its local test-signing requirements separately from Store signing. Do not install a certificate or change Windows trust settings without explicit authorization.
3. Run the compatibility trial above, including two package versions and a clean user environment. Existing portable-build tests do not establish MSIX compatibility.
4. Once verified, prepare listing/privacy/certification material and Store-specific release automation. Preserve the fast unsigned development loop. Account actions and final submission require the owner's instruction; neither has been performed here.
