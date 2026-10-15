@echo off
title BantayKo SQL Database Server
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
    echo Node.js is not installed.
    echo Please download the LTS version from https://nodejs.org and install it.
    pause
    exit /b
)
start "" cmd /c "timeout /t 2 >nul & start http://localhost:3000"
node --disable-warning=ExperimentalWarning server.js
pause
