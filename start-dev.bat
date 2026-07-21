@echo off
chcp 65001 >nul
title 墨章 · 长篇小说创作工作流
cd /d "%~dp0"

echo ================================================
echo   墨章 Novel Atelier - 正在启动开发服务器...
echo   启动后请在浏览器打开: http://localhost:3000
echo   关闭本窗口即可停止服务。
echo ================================================
echo.

REM 首次运行若缺少依赖，自动安装
if not exist "node_modules" (
  echo [提示] 未检测到依赖，正在执行 npm install ...
  call npm install
  echo.
)

REM 后台等待几秒待服务器就绪，再自动打开浏览器（本窗口继续运行服务器）
start "" /min cmd /c "timeout /t 4 >nul & start http://localhost:3000"

npm run dev

echo.
echo 服务器已停止。按任意键关闭窗口...
pause >nul
