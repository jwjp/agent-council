# Development, release builds and Windows signing

Decision recorded 2026-11-06: keep development fast with unsigned debug builds. Introduce trusted Windows signing for public releases once eligibility and the release pipeline are ready. Signing is not required to implement or test the application.

## Separate the three paths

| Path | Intended behavior | Current implementation |
| --- | --- | --- |
| Local development | `npm run tauri dev`, or debug Rust engine + `npm run dev`; frontend hot reload and incremental Rust builds; no external signing | Available |
| Push / pull request checks | Type/build/format/unit/integration/UI checks without a signing wait | `.github/workflows/check.yml`; already uses npm and Rust caches |
| Public release | Exact revision/tag → optimized build and checks → trusted signing and verification → ZIP → GitHub Release | Signed release automation is not implemented; v3.1.0 was published as unsigned portable EXE/ZIP |

A future public release workflow should run on version tags or explicit manual dispatch, not every ordinary push. Tagging alone must not bypass checks or signing approval. Keep caches, but do not promise instantaneous Rust builds: first builds, dependency changes, linking and release LTO still take time. The UI can usually be iterated through hot reload without rebuilding the optimized executable.

No elapsed-time guarantee is established for provider review or hosted builds. SignPath's initial project review is distinct from the manual approval required for **each release signing request**. Once that approval is supplied, the configured signing/packaging/publishing steps can continue automatically.

## Is signing necessary?

- For local development and controlled internal testing, unsigned builds are sufficient. Self-signed certificates are not a prerequisite for the development loop and do not establish public trust by themselves.
- For public Windows downloads, trusted Authenticode signing is strongly recommended for publisher identity and release integrity. It is not a guarantee that every download/execution prompt or SmartScreen warning disappears immediately.
- Do not disable Windows protections, remove origin markings from distributed files, or install a private root certificate just to make the app appear publicly trusted.
- Sign the final executable before ZIP creation. If an installer is later shipped, sign the application and the installer as appropriate. Do not modify signed executable bytes afterward. Verify the signature and the hashes of the actual uploaded assets.
- The current updater in `src-tauri/crates/council-host/src/updates.rs` checks GitHub's SHA-256 asset digest. Do not describe that checksum check as Authenticode verification or claim the current EXE has a trusted signature. In-place installation is Windows-only; other hosts reject it before downloading a Windows executable.

## Provider readiness — last checked 2026-11-06

Microsoft Store MSIX is a separate candidate distribution channel. Microsoft provides package signing after certification. Store-listed MSI/EXE installers still need publisher signing. The unsigned Windows compatibility trial built and installed two packages using the beta.3 executable. The current app routes installed Windows packages to Store updates and guards the portable install command. Store identity, actual Store servicing and submission remain open. See [Store distribution and trial evidence](STORE_DISTRIBUTION.md).

- **SignPath Foundation:** free for qualifying projects, subject to review of license, reputation and verifiable source-to-binary provenance. Requires a signing policy, team roles/approvers, MFA and appropriate privacy information. Its terms require manual approval for each release. No application or approval is recorded for this project.
- **OSSign:** official site currently says new applications are suspended and requires at least six months of activity on the account, organization and project. Recheck when considering it; do not assume the suspension or eligibility conditions remain unchanged.
- **Agent Council:** the public repository was created on 2026-11-04. There is no project-level OSI license yet; `docs/ORCA_LICENSE.txt` covers the upstream notice only. The owner must decide the project's license before an agent adds a grant of rights.
- Release signing/provenance automation and formal code-signing/privacy policies remain to be implemented. A privacy policy must accurately describe automatic account-usage queries, provider calls and existing-login credential handling; do not substitute an inaccurate generic promise of no network traffic.

## Official references

- [Tauri development loop](https://v2.tauri.app/develop/)
- [Microsoft Windows code-signing options and SmartScreen behavior](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options)
- [Microsoft Attachment Manager and downloaded-file origin markings](https://support.microsoft.com/en-us/windows/security/information-about-the-attachment-manager-in-microsoft-windows)
- [SignPath Foundation conditions](https://signpath.org/terms.html)
- [OSSign eligibility and application status](https://ossign.org/)

Recheck provider conditions before implementation/application. A plan, an application, an approval and a verified signed release are different states; keep the project status explicit.
