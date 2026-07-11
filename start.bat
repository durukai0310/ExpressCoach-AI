@echo off
chcp 65001 >nul
title ExpressCoach - AI Life Coach
cd /d "%~dp0"

echo.
echo   ====================================
echo     ExpressCoach - AI Life Coach
echo     Starting development server...
echo   ====================================
echo.

REM Check Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo   [ERROR] Node.js not found. Install from https://nodejs.org
    pause
    exit /b
)

REM Kill existing processes on ports 3001 and 5173
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3001 ^| findstr LISTENING 2^>nul') do (
    taskkill /f /pid %%a >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :5173 ^| findstr LISTENING 2^>nul') do (
    taskkill /f /pid %%a >nul 2>&1
)

echo   Starting server (port 3001)...
start "ExpressCoach-Server" cmd /c "cd /d %~dp0server && node index.js"
timeout /t 3 /nobreak >nul

echo   Starting client (port 5173)...
start "ExpressCoach-Client" cmd /c "cd /d %~dp0client && npx vite --host 0.0.0.0"
timeout /t 4 /nobreak >nul

echo   Opening browser...
start http://localhost:5173

echo.
echo   ====================================
echo     ExpressCoach is running!
echo.
echo     Local:    http://localhost:5173
echo     Network:  http://YOUR_IP:5173
echo.
echo     To share publicly, run: share.bat
echo   ====================================
echo.
echo   Close this window to stop all services.
pause
