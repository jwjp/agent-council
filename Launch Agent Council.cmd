@echo off
cd /d "%~dp0"
if not exist "AgentCouncil.update.exe" goto launch
move /y "AgentCouncil.update.exe" "AgentCouncil.exe" >nul
if errorlevel 1 (
  echo Could not apply update. Close any running Agent Council windows and try again.
  pause
  exit /b 1
)
:launch
start "" "%~dp0AgentCouncil.exe"
