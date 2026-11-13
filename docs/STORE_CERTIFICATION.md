# Agent Council certification handoff

Windows 11 x64 · Store package `3.2.0.0` · App build `3.2.0-beta.3` · Product `9P6TSDW87WP3`

## Notes for certification

In Partner Center, open **Additional Testing Information**. Paste the opening paragraph and steps 1–5 below into **Description**, then select **Save description**. Use **New credential** if you have authorized reviewer access to a provider test account. Add those credentials only in the **Credentials** section.

Agent Council coordinates separately installed AI coding CLIs. The app opens without an Agent Council account. Live AI responses require a supported CLI on the user's PATH, a working sign-in with its provider and provider connectivity. WebView2 is required. The app does not install the CLIs or open an account with the provider.

1. On Windows 11 x64, open Agent Council and confirm that the workspace, project picker and agent settings load. With no CLI available, the app should show the missing tool state.
2. Install Codex using the provider's standard Windows instructions. Sign in with a test account that can run the CLI, then reopen Agent Council. Create a disposable project with a `README.md` containing “Sample Tasks is a demo API for listing and creating tasks.” Select that folder in Agent Council. Choose Codex as the lead from **Agents**, leave reviewers unselected and select **Standard permissions**.
3. Send “Read README.md and summarize the project in three bullets. Do not change any files.” Verify that progress is visible, a result appears and the sample file remains unchanged. Close and reopen the window and verify the result is retained.
4. For the multi-agent path, also install and sign in to Claude Code using a test account, select it as a reviewer and repeat the request. Verify the separate review and final report, and use the split selectors to compare them.
5. Open **App menu → Check for updates**. The Store build directs the user to Microsoft Store updates. Phone pairing is optional and off by default. It is not needed for the desktop scenarios above.

Provider logins are a prerequisite for the live scenarios. Before submission, confirm with the publisher how certification testers can use suitable test accounts without using the publisher's personal sign-ins. Use a sanitized example project and only authorized test access.

## Restricted capability justification

Paste the paragraph below into **Submission Options → Restricted capabilities**. The field accepts up to 500 characters.

```text
Agent Council requires runFullTrust to launch its local background engine, discover and run separately installed AI coding CLIs, and access user-selected project folders outside the MSIX package. The engine keeps active jobs running when the window closes and uses an authenticated loopback API. The app and engine run at medium integrity under the signed-in Windows user.
```

## Before submitting for certification

- Submission 1 shows the uploaded x64 package as `Validated` and **Packages** as `Complete`. Save the `runFullTrust` justification in **Submission options** for review during certification.
- Provide the reviewed privacy policy in Properties as text or as a URL that opens without signing in. Verify the support route accepts redacted AI-output reports, assign a maintainer to respond and decide how to handle reports that need private follow-up. The current binary links to the repository through **App menu → GitHub**. It has no dedicated in-app report action or separate output moderation layer.
- Evaluate consent for sending potentially personal data to third-party AI providers under Store policy §10.5. Sending a job and choosing participants are existing controls. The current build has no separate opt-in or off switch for automatic account usage queries. Review this before the publisher makes any compliance claims.
- Confirm the required test access and record the first-run experience on a clean Windows 11 x64 machine. Run Windows App Certification Kit with the appropriate elevation and record its results separately from package structure and fixture checks.
- For the first test distribution, consider a private audience and a manual publishing hold. Confirm the intended audience, price and markets with the publisher before submission. Validate the Store-signed install, existing local CLI sign-ins, and updating with a running job before opening the listing publicly.

[Submission options and test notes](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/manage-submission-options) · [Store policies](https://learn.microsoft.com/en-us/windows/apps/publish/store-policies) · [Private audience](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/visibility-options)
