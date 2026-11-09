@echo off
title ExpressCoach AI - Setup
cd /d "%~dp0"

echo.
echo ============================================================
echo            ExpressCoach AI - Install Dependencies
echo            Run this file FIRST before using the app
echo ============================================================
echo.

REM Try to find Node.js in PATH first
where node >nul 2>&1
if %errorlevel% equ 0 goto :found

REM Not in PATH - try common install locations
echo [WARN] Node.js not found in PATH. Searching common locations...

set "NODE_PATH="

REM Check D: drive locations first
if exist "D:\Program Files\nodejs\node.exe" set "NODE_PATH=D:\Program Files\nodejs"
if exist "D:\Program Files (x86)\nodejs\node.exe" set "NODE_PATH=D:\Program Files (x86)\nodejs"
if exist "D:\nodejs\node.exe" set "NODE_PATH=D:\nodejs"

REM Check C: drive locations
if not defined NODE_PATH if exist "C:\Program Files\nodejs\node.exe" set "NODE_PATH=C:\Program Files\nodejs"
if not defined NODE_PATH if exist "C:\Program Files (x86)\nodejs\node.exe" set "NODE_PATH=C:\Program Files (x86)\nodejs"

REM Check where npm is (installed by nvm or other tools)
if not defined NODE_PATH where npm >nul 2>&1
if not defined NODE_PATH if %errorlevel% equ 0 (
    for /f "delims=" %%i in ('where npm') do (
        if exist "%%~dpi\node.exe" set "NODE_PATH=%%~dpi"
    )
)

if defined NODE_PATH (
    echo [OK] Found Node.js at: %NODE_PATH%
    set "PATH=%NODE_PATH%;%PATH%"
    goto :found
)

REM Still not found - Node.js is not installed
echo.
echo ============================================================
echo   [ERROR] Node.js is NOT installed on this computer.
echo.
echo   Please:
echo     1. Open https://nodejs.org
echo     2. Download the LTS version (left button)
echo     3. Install it -> MAKE SURE to check "Add to PATH"
echo     4. Restart your computer OR reopen this file
echo.
echo ============================================================
start https://nodejs.org
pause
exit /b

:found
echo [OK] Node.js version:
node -v
echo.

REM Remove incompatible node_modules from other PCs
if exist "node_modules\" (
    echo [WARN] Found node_modules from another PC - may be incompatible.
    choice /C YN /M "Delete and reinstall? [Y/N]"
    if %errorlevel% equ 1 (
        echo Deleting old node_modules ...
        rmdir /s /q node_modules
        echo [OK] Deleted
        echo.
    )
)

REM Install (use China mirror for this install only, without changing global config)
echo.
echo [INFO] Installing dependencies via China mirror, this may take 1-2 minutes...
echo.
call npm install --registry=https://registry.npmmirror.com

if %errorlevel% equ 0 (
    echo.
    echo ============================================================
    echo   [SUCCESS] Installation complete!
    echo.
    echo   You can now double-click Æô¶¯.bat to start the app.
    echo ============================================================
) else (
    echo.
    echo [ERROR] Installation failed. Please check your network.
    echo You can retry with the official registry:
    echo   npm install --registry=https://registry.npmjs.org
)

echo.
pause
