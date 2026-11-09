@echo off
title ExpressCoach AI
cd /d "%~dp0"

echo ============================================================
echo            ExpressCoach AI v1.0.0
echo ============================================================
echo.
echo Starting ExpressCoach AI...
echo Enter a scenario and press Enter to analyze.
echo Press Ctrl+C twice to exit.
echo.

node src\index.js
pause
