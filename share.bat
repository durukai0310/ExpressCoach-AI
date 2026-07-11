@echo off
chcp 65001 >nul
title ExpressCoach - Public Share
cd /d "%~dp0"

echo.
echo   ==========================================
echo     ExpressCoach - Public Share Mode
echo   ==========================================
echo.

REM Kill existing server on port 3001
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3001 ^| findstr LISTENING 2^>nul') do (
    taskkill /f /pid %%a >nul 2>&1
)
timeout /t 1 /nobreak >nul

REM Build frontend if needed
if not exist "client\dist\index.html" (
    echo   [1/3] Building frontend...
    cd client
    call npm run build 2>nul
    cd ..
)

REM Start server
echo   [1/3] Starting server on port 3001...
start "ExpressCoach-Server" cmd /c "cd /d %~dp0server && node index.js"
timeout /t 3 /nobreak >nul

REM Start tunnel with keepalive
echo   [2/3] Starting public tunnel...
echo.
echo   ==========================================
echo     Look for the URL below and share it!
echo     (Tunnel auto-reconnects if it drops)
echo   ==========================================
echo.

start "ExpressCoach-Tunnel" cmd /c "cd /d %~dp0 && node tunnel.mjs"

echo.
echo   Server and tunnel are running.
echo   Check the Tunnel window for the public URL.
echo   Close both windows to stop.
echo.
pause
