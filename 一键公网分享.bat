@echo off
chcp 65001 >nul
title ExpressCoach - 公网分享
cd /d "%~dp0"

echo.
echo   ExpressCoach  表达教练
echo   一键公网分享
echo.

REM Check Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo   [ !! ] Node.js 未安装，请先安装 https://nodejs.org
    pause
    exit /b
)

REM Check .env
if not exist ".env" (
    if exist ".env.example" (
        copy ".env.example" ".env" >nul
        echo   [ ! ] 已从 .env.example 复制 .env，请编辑填入 API Key
    ) else (
        echo   [ !! ] .env 文件缺失
        pause
        exit /b
    )
)

REM Ensure dependencies
if not exist "node_modules\" (
    echo   [1/2] 安装依赖...
    call npm config set registry https://registry.npmmirror.com 2>nul
    call npm install
    echo.
) else (
    echo   [1/2] 依赖已就绪
)

echo   [2/2] 启动服务器 + 公网隧道...
echo.

node public-launch.mjs

pause
