@echo off
chcp 65001 >nul
cd /d "%~dp0"
title SAMA 1.1 (最新源码)

echo [SAMA] closing old windows (packaged / previous Electron)...
taskkill /F /IM SAMA.exe >nul 2>&1
rem Only kill Electron that belongs to this SAMA folder
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='electron.exe'\" | Where-Object { $_.CommandLine -like '*\Desktop\SAMA*' -or $_.ExecutablePath -like '*\Desktop\SAMA\*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1

echo [SAMA] building frontend (latest)...
call npm run build
if errorlevel 1 (
  echo [SAMA] build FAILED - check Node.js / npm
  pause
  exit /b 1
)

set "ELECTRON=%~dp0node_modules\electron\dist\electron.exe"
if not exist "%ELECTRON%" (
  echo [SAMA] electron missing, running npm install...
  call npm install
  if errorlevel 1 (
    echo [SAMA] npm install FAILED
    pause
    exit /b 1
  )
)

if not exist "%ELECTRON%" (
  echo [SAMA] still no electron.exe
  pause
  exit /b 1
)

echo [SAMA] launching latest source (not release\win-unpacked)...
start "SAMA 1.1" "%ELECTRON%" "%~dp0."
echo [SAMA] started. Window title should be: SAMA 1.1
echo [SAMA] You can close this window.
exit /b 0
