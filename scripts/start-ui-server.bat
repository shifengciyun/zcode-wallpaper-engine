@echo off
rem zcode-wallpaper-engine: start the local UI service for the in-app wallpaper panel
cd /d "%~dp0"
where node >nul 2>nul
if %errorlevel%==0 (
  start "zwp-ui-service" /min node "%~dp0ui-server.mjs"
  echo 服务已启动（端口 47613）。可最小化此窗口；关闭窗口不会停止服务。
) else (
  echo 未找到 node，请先安装 Node.js 或检查 PATH。
)
timeout /t 3 >nul
