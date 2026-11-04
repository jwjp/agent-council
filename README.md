# Agent Council

A Windows desktop chat for a coding agent, review agents, or both.

## Install

1. Download `AgentCouncil-Windows-x64.zip` from [Releases](https://github.com/jwjp/agent-council/releases/latest).
2. Extract both files to a writable folder and open `Launch Agent Council.cmd`. Python is bundled.
3. In **Settings**, choose a project folder and the agents you want. Install and sign in to their CLIs and make sure they are on Windows PATH.
4. Type in the main chat. Enter sends. Shift+Enter inserts a new line. Choose **한국어** in Settings to switch the interface and model responses from English.

## Roles and permissions

- Choose Claude Code or Codex as the coding agent. It acts on clear work requests and asks for clarification when it needs a decision.
- Choose **None (review only)** as the coding agent to send requests directly to your selected reviewers for findings and opinions. Reviewers use their review, plan, or read-only CLI modes.
- If you select both roles, reviewers inspect the coding agent's work in parallel. The coding agent verifies concrete findings and makes one revision pass.
- **Full execution access** applies only to the coding agent. It starts off and requires confirmation to enable for the selected project and agent. It bypasses CLI permission checks using the existing Windows account permissions.
- Add optional **Reference folders** in Settings. Agents receive the paths and are instructed to consult them without editing them. This instruction does not enforce filesystem isolation. Access also depends on CLI permissions.

## Progress and history

The activity panel shows the active phase, elapsed time, and when CLI output was last received. A CLI can stay silent while it waits for its provider. Token counters show session input and output totals when the CLI reports them. Remaining account quota is unavailable in the supported streams and appears as a dash.

The app keeps one local transcript per folder under `%LOCALAPPDATA%\AgentCouncil\chats`. The ten most recent messages, with excerpts for long messages, carry into each new request. Review prompts may include implementation reports and bounded Git diff and status excerpts. Prior council reports remain in project folders under `multi_ai_runs`.

## Updates

Click **Check for updates** and confirm the download. The app checks the download against GitHub's SHA-256 digest. Close Agent Council and reopen it with the included launcher to apply the update.

## Build from source

Run `python app.py` using Python with Tkinter. To build the Windows executable, install PyInstaller and run:

```powershell
python -m PyInstaller --noconfirm --onefile --windowed --name AgentCouncil app.py
```
