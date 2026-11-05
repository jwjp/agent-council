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
if exist "%~dp0AgentCouncil.exe" (
  start "" "%~dp0AgentCouncil.exe"
  exit /b 0
)
if exist "%~dp0dist\AgentCouncil.exe" (
  start "" "%~dp0dist\AgentCouncil.exe"
  exit /b 0
)
if exist "%~dp0src-tauri\target\release\AgentCouncil.exe" (
  start "" "%~dp0src-tauri\target\release\AgentCouncil.exe"
  exit /b 0
)
echo Build Agent Council with npm run tauri build, or download the Windows release.
pause
