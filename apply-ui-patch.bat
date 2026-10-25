@echo off
title ZCode 界面壁纸补丁
cd /d "%~dp0"

echo ==================================================
echo    ZCode 界面壁纸补丁  (zcode-wallpaper-engine)
echo ==================================================
echo.

tasklist /FI "IMAGENAME eq ZCode.exe" 2>nul | find /I "ZCode.exe" >nul
if %errorlevel%==0 (
  echo 检测到 ZCode 正在运行。打补丁需要先完全退出 ZCode。
  echo.
  choice /C YN /M "现在自动关闭 ZCode 并继续吗 (Y=关闭并继续, N=取消)"
  if errorlevel 2 goto :cancelled
  echo 正在关闭 ZCode ...
  taskkill /IM ZCode.exe >nul 2>&1
  timeout /t 5 /nobreak >nul
  tasklist /FI "IMAGENAME eq ZCode.exe" 2>nul | find /I "ZCode.exe" >nul
  if %errorlevel%==0 (
    echo 仍在运行，强制关闭 ...
    taskkill /F /IM ZCode.exe >nul 2>&1
    timeout /t 3 /nobreak >nul
  )
)

echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\patch-ui.ps1"
if %errorlevel%==0 (
  echo.
  choice /C YN /M "现在启动 ZCode 吗 (Y=启动, N=稍后自己开)"
  if not errorlevel 2 (
    start "" "D:\新建文件夹 (2)\ZCode\ZCode.exe"
  )
)
echo.
echo 窗口可以关闭了。
pause
goto :eof

:cancelled
echo 已取消。请先退出 ZCode（包括托盘图标）后再运行本脚本。
pause
