@echo off
title ExpressCoach AI - Web
cd /d "%~dp0"

REM ═══════════════════════════════════════════════════════
REM  ExpressCoach AI — 一键启动 Web 版
REM  用法: 双击此文件即可
REM ═══════════════════════════════════════════════════════

echo.
echo   ExpressCoach AI
echo   social expression coach
echo.

REM ── Check Node.js ──────────────────────────────────
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo   [ERROR] Node.js not installed
    echo   Please download: https://nodejs.org
    pause
    exit /b
)

REM ── Check .env ─────────────────────────────────────
if not exist ".env" (
    echo   [WARN] .env file missing - copying from .env.example
    if exist ".env.example" (
        copy ".env.example" ".env" >nul
        echo   [INFO] .env.example copied to .env
        echo   [INFO] Please edit .env and add your API keys!
    ) else (
        echo   [ERROR] Neither .env nor .env.example found
        pause
        exit /b
    )
)

REM ── Install deps if needed ─────────────────────────
if not exist "node_modules\" (
    echo   [1/3] Installing dependencies, please wait...
    echo.
    call npm config set registry https://registry.npmmirror.com 2>nul
    call npm install
    if %errorlevel% neq 0 (
        echo   [ERROR] npm install failed
        pause
        exit /b
    )
    echo   [OK] Dependencies installed
    echo.
) else (
    echo   [1/3] Dependencies: found
)

REM ── Start server ───────────────────────────────────
echo   [2/3] Starting web server...
echo.

REM Kill any existing server on port 3000
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3000 ^| findstr LISTENING 2^>nul') do (
    taskkill /f /pid %%a >nul 2>&1
)

REM Start the server
start "ExpressCoach" node src\server.js

REM Wait for it to start
echo   [3/3] Waiting for server to be ready...
timeout /t 4 /nobreak >nul

REM Open browser
start http://localhost:3000

echo.
echo   ===========================================
echo     ExpressCoach is running!
echo     Open http://localhost:3000
echo   ===========================================
echo.
echo   Close this window to stop the server.
echo.
pause
