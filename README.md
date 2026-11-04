# Agent Council

A Windows desktop app that asks locally installed AI CLIs for independent proposals, runs a cross-review, and combines the results into a recommendation.

## Install

1. Download `AgentCouncil-Windows-x64.zip` from [Releases](https://github.com/jwjp/agent-council/releases/latest).
2. Extract both files to a writable folder and open `Launch Agent Council.cmd`. Python is bundled.
3. Install and sign in to at least two supported CLIs, and make sure they are on Windows PATH. Select those agents in Settings. Clearing a checkbox disconnects the agent from the app while keeping its CLI login available for other uses.
4. Select a project folder, enter your request, and click **Run council**. English is the default. Choose **한국어** to switch the interface and model responses.

The selected folder is the working directory for all CLI calls. The workflow asks for proposals and reviews in text. It saves run artifacts under `multi_ai_runs` in that folder. The progress bar and timers show how long the app has been waiting for each CLI. Each call has a five-minute timeout. The workflow may use multiple calls per CLI and sends proposal excerpts to other selected providers for review.

## Updates

Click **Check for updates** and confirm the download. The app checks the download against GitHub's SHA-256 digest. Close Agent Council and reopen it with the included launcher to apply the update.

## Build from source

Run `python app.py` using Python with Tkinter. To build the Windows executable, install PyInstaller and run:

```powershell
python -m PyInstaller --noconfirm --onefile --windowed --name AgentCouncil app.py
```
