# Agent Council

A Windows desktop chat for a coding agent, review agents, or both.

## Install

1. Download `AgentCouncil-Windows-x64.zip` from [Releases](https://github.com/jwjp/agent-council/releases/latest).
2. Extract both files to a writable folder and open `Launch Agent Council.cmd`. Python is bundled.
3. In **Settings**, choose a project folder and the agents you want. Install and sign in to their CLIs and make sure they are on Windows PATH.
4. Type in the main chat. Enter sends. Shift+Enter inserts a new line. Choose **한국어** in Settings to switch the interface and model responses from English. **Appearance** switches between light and dark.

## Roles and permissions

- Choose any supported CLI as the default coding agent, or **Review only**. Reviewers are selected separately on agent cards.
- Reviewers analyze the request and any coding work in parallel, including on analysis-only turns. Agents then exchange opinions and write a final report. Review and conference prompts ask for opinions without modifying files.
- **Permissions** offers standard permissions, full access for the coder, or full access for all selected agents. The last mode passes each CLI's permission-bypass option to coding, review, conference and synthesis calls. The review role remains an instruction and is not a filesystem restriction in that mode. Existing coder-only permissions are preserved when upgrading.
- Add optional **Reference folders** in Settings. Agents receive the paths and are instructed to consult them without editing them. This instruction does not enforce filesystem isolation. Access also depends on CLI permissions.

## Progress and history

The activity panel shows the current request and each agent's phase, elapsed time, and last CLI activity. **Split view** opens two resizable, independently scrollable reports for the current turn. Select which agent to show in each pane. **Activity** switches to a timestamped log of phases, tool events, and paced notes from supported CLI responses. Double-click an agent in the activity table to open its log. Recent notes and events for the latest request are saved with the project and remain available after completion. The final report appears in the right pane when ready and can be reopened from the toolbar. Use **Conversation** to return to the full timeline. A CLI can stay silent while it waits for its provider.

Input and output tokens reported by each CLI are saved per project from 1.4.1 onwards. Open **Usage** or type `/usage` to see all six agents. Codex and Antigravity account limits are read from their local CLIs. Claude Code limits appear when reported during a turn in the current app session. Grok and Cursor rows link to their usage dashboards, and Gemini CLI shows how to check with `/stats`.

The bottom-left status strip shows the most-used reported account window as a used percentage and its reset countdown. Clicking an agent opens its details. Without account quota data it shows reported project token totals with a `t` suffix, or a dash when no data is available. The refresh control queries available local quota readers.

The app keeps one local transcript per folder under `%LOCALAPPDATA%\AgentCouncil\chats`. The ten most recent messages, with excerpts for long messages, carry into each new request. Review prompts may include implementation reports and bounded Git diff and status excerpts. Prior council reports remain in project folders under `multi_ai_runs`.

## Updates

Click **Check for updates** and confirm installation. The app verifies GitHub's SHA-256 digest, then closes, replaces the executable, and restarts automatically. When upgrading from 1.4.1 or earlier, use the old launcher's restart step once, or download the new ZIP.

## Build from source

Use Python with Tkinter. Install Mistune and run the app from source, or install PyInstaller to build the executable:

```powershell
python -m pip install mistune==3.4.0
python app.py
python -m pip install pyinstaller
python -m PyInstaller --noconfirm --onefile --windowed --name AgentCouncil app.py
```
