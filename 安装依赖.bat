@echo off
title ExpressCoach AI - 安装依赖
cd /d "%~dp0"

echo.
echo ╔══════════════════════════════════════════════════════╗
echo ║           📦 ExpressCoach 安装依赖                   ║
echo ║           首次使用请先运行本文件                      ║
echo ╚══════════════════════════════════════════════════════╝
echo.

REM 检查 Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ 你的电脑还没有安装 Node.js
    echo.
    echo 请按以下步骤操作：
    echo   1. 浏览器会自动打开下载页面
    echo   2. 下载左边 LTS 版本
    echo   3. 安装时务必勾选 "Add to PATH"
    echo   4. 安装完成后，重新双击本文件
    echo.
    start https://nodejs.org
    pause
    exit /b
)

echo ✅ Node.js 版本:
node -v
echo.

REM 如果 node_modules 是从别人电脑复制过来的，先删掉（避免兼容问题）
if exist "node_modules\" (
    echo ⚠️  检测到旧的 node_modules，这是从别人电脑复制过来的，可能不兼容。
    choice /C YN /M "是否删除并重新安装？"
    if %errorlevel% equ 1 (
        echo 正在删除旧版 node_modules ...
        rmdir /s /q node_modules
        echo ✅ 已删除
        echo.
    )
)

REM 切国内镜像
echo 🚀 切换国内镜像加速下载...
call npm config set registry https://registry.npmmirror.com 2>nul

REM 安装
echo.
echo 📦 正在安装依赖，可能需要 1-2 分钟...
echo.
call npm install

if %errorlevel% equ 0 (
    echo.
    echo ╔══════════════════════════════════════════════════════╗
    echo ║  ✅ 安装成功！                                     ║
    echo ║                                                   ║
    echo ║  现在可以双击 启动.bat 开始使用了                   ║
    echo ╚══════════════════════════════════════════════════════╝
) else (
    echo.
    echo ❌ 安装失败，请检查网络连接后重新双击本文件。
    echo    如果国外镜像慢，可以试试：npm config set registry https://registry.npmjs.org
)

echo.
pause
