@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

set "NODE_BIN=node"
where node >nul 2>nul
if errorlevel 1 (
  if exist "%USERPROFILE%\Apps\dshx-trial\app\node\node.exe" (
    set "NODE_BIN=%USERPROFILE%\Apps\dshx-trial\app\node\node.exe"
  ) else (
    echo [NEON CORE] 找不到 node，请先安装 Node.js 18+ 后再运行。
    pause
    exit /b 1
  )
)

echo [NEON CORE] 启动本地服务器 http://127.0.0.1:8787/ ...
start "NEON CORE server" /min "%NODE_BIN%" "tools\serve.mjs" 8787
timeout /t 2 >nul
start "" "http://127.0.0.1:8787/"
echo [NEON CORE] 关掉那个最小化的窗口就等于关服务器。
