@echo off
chcp 65001 >nul
title ExpressCoach AI - 社交表达教练

echo.
echo ╔══════════════════════════════════════════════════════╗
echo ║     🎯 ExpressCoach AI - 社交表达教练 (Day 14)        ║
echo ╚══════════════════════════════════════════════════════╝
echo.

REM 检查 .env 是否存在
if not exist ".env" (
    echo ⚠️  未找到 .env 配置文件！
    echo.
    echo 正在从 .env.example 创建模板...
    copy .env.example .env >nul 2>&1
    echo.
    echo 请先完成以下步骤:
    echo   1. 用记事本打开项目文件夹里的 .env 文件
    echo   2. 去 https://platform.deepseek.com/ 免费注册拿 API Key
    echo   3. 把 .env 里的 sk-你的... 换成你自己的 Key
    echo   4. 保存后重新双击 启动.bat
    echo.
    start https://platform.deepseek.com/
    echo 按任意键打开 .env 文件...
    pause >nul
    start notepad .env
    exit /b
)

REM 检查 .env 是否还是占位符
findstr /C:"sk-你的" .env >nul 2>&1
if %errorlevel% equ 0 (
    echo ⚠️  .env 中的 API Key 还是占位符，没有换成你自己的！
    echo.
    echo 请完成以下步骤:
    echo   1. 打开 https://platform.deepseek.com/ 注册登录
    echo   2. 进入 API Keys 页面创建 Key 并复制
    echo   3. 粘贴到 .env 文件替换 sk-你的... 那一行
    echo.
    start https://platform.deepseek.com/api_keys
    echo 按任意键打开 .env 文件...
    pause >nul
    start notepad .env
    exit /b
)

REM 检查 node_modules 是否存在
if not exist "node_modules\" (
    echo ⚠️  未检测到依赖包，正在自动安装...
    call npm install
    if %errorlevel% neq 0 (
        echo ❌ 安装失败，请检查 Node.js 是否已安装
        echo 下载: https://nodejs.org
        start https://nodejs.org
        pause
        exit /b
    )
    echo ✅ 安装完成！
    echo.
)

REM 启动
echo 🚀 启动中...
echo.
node src\index.js

if %errorlevel% equ 9009 (
    echo.
    echo ❌ 未找到 Node.js！请先安装: https://nodejs.org
    start https://nodejs.org
)

pause
