@echo off
title ExpressCoach AI
cd /d "%~dp0"

echo.
echo ╔══════════════════════════════════════════════════════╗
echo ║     🎯 ExpressCoach AI - 社交表达教练               ║
echo ╚══════════════════════════════════════════════════════╝
echo.

REM 检查 Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ 你的电脑还没有安装 Node.js
    echo    https://nodejs.org （左侧 LTS → 安装勾选 Add to PATH）
    start https://nodejs.org
    pause
    exit /b
)

REM 检查 .env
if not exist ".env" (
    if exist ".env.example" (copy ".env.example" ".env" >nul) else (
        echo DEEPSEEK_API_KEY=sk-你的Key填这里> ".env"
    )
)

findstr /C:"sk-你的" .env >nul 2>&1
if %errorlevel% equ 0 (
    echo ⚠️  还没有配置 API Key
    echo    浏览器会打开 DeepSeek，注册后把 Key 填入 .env
    start https://platform.deepseek.com/api_keys
    pause
    start notepad ".env"
    exit /b
)

REM 检查 node_modules
if not exist "node_modules\" (
    echo ⚠️  未安装依赖，请先双击 安装依赖.bat
    pause
    exit /b
)

REM 快速验证 sqlite3 是否可用（从别人电脑复制过来的可能损坏）
node -e "require('sqlite3')" >nul 2>&1
if %errorlevel% neq 0 (
    echo ⚠️  node_modules 可能损坏（从别人电脑复制的不兼容）
    echo    请双击 安装依赖.bat 重新安装
    pause
    exit /b
)

REM 启动
echo 🚀 启动中...
echo.
node src\index.js

echo.
echo 程序已退出。
pause
