@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

REM 分享模式：监听局域网，把打印出来的 http://192.168.x.x:8787/ 发给同一个 WiFi 下的朋友/手机
set "NODE_BIN=node"
where node >nul 2>nul
if errorlevel 1 (
  if exist "%USERPROFILE%\Apps\dshx-trial\app\node\node.exe" (
    set "NODE_BIN=%USERPROFILE%\Apps\dshx-trial\app\node\node.exe"
  ) else (
    echo [NEON CORE] 找不到 node，请先安装 Node.js 18+。
    pause
    exit /b 1
  )
)

echo [NEON CORE] 分享模式启动中（局域网可访问）...
"%NODE_BIN%" "tools\serve.mjs" 8787 lan
