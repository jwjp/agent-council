# Cursor and Grok command collisions

Cursor CLI and Grok can both install a command named `agent`. Windows PowerShell may select Cursor's `.ps1`/`.cmd` wrapper, while a Bash terminal selects Grok's `agent.exe`. Running `agent login` in that terminal can therefore sign in to a different provider. That does not establish that Cursor's session expired.

On the reported PC, explicit read-only checks returned Grok `1.0.77` from `.grok/bin/agent.exe`, and Cursor `2026.11.05-86047df` from the Cursor wrapper. Cursor's own `status` returned `Not logged in`. No historical login-expiry diagnosis or automatic sign-in was performed.

## Sign in to the intended CLI

### Use multiple Claude Code sign-ins

Open **Agents → Claude accounts → Connect existing account**. Agent Council checks the default login, registered folders and common `.claude-*` folders in your home directory. Select the signed-in account or use **Choose a different folder** for another location. Choose it as lead or reviewer and save.

For a fresh account, use **Sign in to a new account → Prepare login**. Windows generates a command for a fresh PowerShell window. macOS generates a command for Terminal's default zsh shell, and Linux generates the same POSIX shell syntax. The macOS/Linux command applies the account directory and environment changes inside a subshell. After the official sign-in completes, choose **Check sign-in → Connect**, then save. An unfinished login can be resumed from the discovered account list. New folders live under `claude-accounts` in the local app data directory. [Claude Code authentication commands](https://code.claude.com/docs/en/cli-reference)

The desktop account list shows the email Claude Code reports for a signed-in Claude.ai session. An API-key session or a CLI response without an email can still show its authentication status. The app does not store the reported email in project data or return it to paired devices.

Additional Claude sign-ins receive numbered names such as `Claude Code 2`. Use the details under a connected account to rename or disconnect it. Renaming preserves its participant ID and token totals. Disconnecting removes it from the team and keeps the CLI login files. Usage refresh uses the selected profile's OAuth data when available locally. Claude Code can also report limits during work. The usage panel shows one row per account and expands to show every reported window. If the profile's folder mapping changes or is removed, a phone using the old team needs to pair again before starting work.

### Use multiple Codex sign-ins

Open **Agents → Codex accounts** and follow the same connect or new sign-in steps. The app detects common `.codex-*` directories and lets you select another folder. An additional Codex profile uses its own `CODEX_HOME` and file-based CLI authentication. Sign-ins stored only in the system keyring cannot be imported as additional profiles. Usage is read through the Codex CLI using the same profile home. [Codex authentication](https://learn.chatgpt.com/docs/auth)

In Windows PowerShell, use the installed Cursor wrapper explicitly:

```powershell
& "$env:LOCALAPPDATA\cursor-agent\cursor-agent.cmd" --version
& "$env:LOCALAPPDATA\cursor-agent\cursor-agent.cmd" login
& "$env:LOCALAPPDATA\cursor-agent\cursor-agent.cmd" status
```

If that folder is on PATH, `cursor-agent.cmd login` and `cursor-agent.cmd status` also work. In Git Bash/MSYS, include `.cmd` or use the full `/c/Users/YOUR_USER/AppData/Local/cursor-agent/cursor-agent.cmd` path. The explicit `.cmd` version check was verified in Git Bash without loading shell profiles. On macOS/Linux use `cursor-agent login` and `cursor-agent status`.

Cursor IDE account usage is separate from Cursor CLI authentication. A successful dashboard/quota query is not proof that a CLI coding request can authenticate. Cursor's [official authentication guide](https://prod.cursor.com/docs/cli/reference/authentication) documents browser login and `status`; its generic `agent` examples must be resolved to Cursor's executable when another program owns that name.

## Source fix after beta.1

The resolver now prefers the dedicated `cursor-agent` alias for the internal Cursor ID `agent`. Windows wrappers still resolve to their installed Node runtime/index. If only a generic native `agent` exists, a bounded, cached `--help` probe requires Cursor-specific identification before any project prompt is sent; an unrelated command reports a resolution error. No model call or provider login is used for discovery. Cache entries are invalidated when executable size/mtime changes.

The desktop's error guidance and login-copy button use `cursor-agent.cmd` on Windows and `cursor-agent` elsewhere. Runtime fixtures provide their own dedicated alias, including a regression where the generic `agent` belongs to a fake Grok and must never receive the Cursor request. These fixes ship in [beta.2](https://github.com/jwjp/agent-council/releases/tag/v3.2.0-beta.2); published beta.1 assets are unchanged.

## Workspace trust after login

`Workspace Trust Required` is a separate gate from authentication. With **Full access · coder**, only the implementing lead receives full-access flags; a Cursor reviewer still runs with standard/ask settings. **Full access · all agents** gives Cursor `--yolo --sandbox disabled`. Cursor documents that `--yolo` also approves workspace trust in its [official CLI changelog](https://cursor.com/changelog/cli-feb-18-2026). The installed CLI separately exposes `--trust` for headless trust without granting all command permissions.

Choose the intended scope in the composer or Agents settings. Do not silently upgrade a saved restricted/lead-only policy just because a CLI asks for trust. In this case the owner requested all-agent full access; the live policy was changed from `coder` to `all` and read back successfully. The lead/reviewer selection was preserved, no job was launched and no release rebuild was needed. Review instructions are still opinion-only, but full-access tool permissions are not a filesystem restriction. A phone paired under a lower permission ceiling needs a new host-approved pairing to increase its grant.
