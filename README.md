# Agent Council

A Windows desktop chat for one coding agent and optional reviewers.

## Install

1. Download `AgentCouncil-Windows-x64.zip` from [Releases](https://github.com/jwjp/agent-council/releases/latest).
2. Extract both files to a writable folder and open `Launch Agent Council.cmd`. Python is bundled.
3. In **Settings**, choose an existing project folder and a coding agent (Claude Code or Codex). Install and sign in to the chosen CLI and make sure it is on Windows PATH. Review agents are optional. The coding agent cannot also review its own work.
4. Enter a request in the main chat. Choose **한국어** in Settings to switch the interface and model responses from English.

## Chat and execution

- **Run automatically** is on by default. The coding agent proceeds on clear requests and asks a question when it needs a consequential decision. Turn it off to request a plan and use **Approve and run** when ready.
- If reviewers are selected, they inspect the implementation in parallel. The coding agent verifies concrete findings and makes one revision pass. The chat shows the author of each response.
- **Full execution access** starts off and must be explicitly enabled. It bypasses the selected coding CLI's permission checks using the existing Windows account permissions. With it off, sandbox or permission settings can block some commands.

The app keeps one local transcript per folder under `%LOCALAPPDATA%\AgentCouncil\chats`, including transcripts from 1.2.0. The ten most recent messages, with excerpts for long messages, carry into each new request. Review prompts share the task, implementation report, and bounded Git diff and status excerpts with the selected reviewers. Prior council reports remain in their project folders under `multi_ai_runs`.

## Updates

Click **Check for updates** and confirm the download. The app checks the download against GitHub's SHA-256 digest. Close Agent Council and reopen it with the included launcher to apply the update.

## Build from source

Run `python app.py` using Python with Tkinter. To build the Windows executable, install PyInstaller and run:

```powershell
python -m PyInstaller --noconfirm --onefile --windowed --name AgentCouncil app.py
```
