@echo off
cd /d "%~dp0"
start "ExpressCoach AI" cmd /k cd /d "%~dp0" ^& node src\index.js ^& pause
exit
