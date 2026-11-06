# Cursor and Grok command collisions

Cursor CLI and Grok can both install a command named `agent`. Windows PowerShell may select Cursor's `.ps1`/`.cmd` wrapper, while a Bash terminal selects Grok's `agent.exe`. Running `agent login` in that terminal can therefore sign in to a different provider. That does not establish that Cursor's session expired.

On the reported PC, explicit read-only checks returned Grok `1.0.77` from `.grok/bin/agent.exe`, and Cursor `2026.11.05-86047df` from the Cursor wrapper. Cursor's own `status` returned `Not logged in`. No historical login-expiry diagnosis or automatic sign-in was performed.

## Sign in to the intended CLI

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
