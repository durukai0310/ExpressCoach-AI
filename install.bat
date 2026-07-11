@echo off
chcp 65001 >nul
title ExpressCoach - Install Dependencies
cd /d "%~dp0"

echo.
echo   ====================================
echo     ExpressCoach - AI Life Coach
echo     Installing Dependencies...
echo   ====================================
echo.

REM Check Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo   [ERROR] Node.js not found!
    echo   Please install Node.js from https://nodejs.org
    echo.
    pause
    exit /b
)

echo   Node.js version:
node -v
echo.

echo   [1/3] Installing root dependencies...
call npm install
if %errorlevel% neq 0 (
    echo   [ERROR] Failed to install root dependencies
    pause
    exit /b
)

echo.
echo   [2/3] Installing server dependencies...
cd server
call npm install
if %errorlevel% neq 0 (
    echo   [ERROR] Failed to install server dependencies
    cd ..
    pause
    exit /b
)
cd ..

echo.
echo   [3/3] Installing client dependencies...
cd client
call npm install
if %errorlevel% neq 0 (
    echo   [ERROR] Failed to install client dependencies
    cd ..
    pause
    exit /b
)
cd ..

echo.
echo   ====================================
echo     All dependencies installed!
echo     Run start.bat to launch
echo   ====================================
echo.
pause
