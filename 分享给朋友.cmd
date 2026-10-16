@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
cd /d "%~dp0"

REM ============================================================
REM  一键分享（保持在线版）：起服务器 + 公网隧道，窗口开着就一直有效。
REM  临时地址会在下次重启时变化；想要永久固定地址见 README 的「固定地址」。
REM ============================================================

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

set "CF=%USERPROFILE%\Apps\cloudflared.exe"
if not exist "%CF%" (
  echo [NEON CORE] 首次使用，正在下载 cloudflared ^(约 53MB^)...
  powershell -NoProfile -Command "[Net.ServicePointManager]::SecurityProtocol='Tls12'; Invoke-WebRequest -UseBasicParsing 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile '%CF%'"
  if not exist "%CF%" ( echo 下载失败，请检查网络。& pause & exit /b 1 )
)

REM 清掉上次残留
taskkill /f /im cloudflared.exe >nul 2>&1
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":8787" ^| findstr LISTENING') do taskkill /f /pid %%p >nul 2>&1
timeout /t 1 >nul

echo [NEON CORE] 1/3 启动游戏服务器...
start "NEON CORE server" /min "%NODE_BIN%" "tools\serve.mjs" 8787
timeout /t 2 >nul

echo [NEON CORE] 2/3 建立公网隧道...
set "CFLOG=%TEMP%\neon-cf.log"
del /q "%CFLOG%" 2>nul
start "NEON CORE tunnel" /min "%CF%" tunnel --url http://127.0.0.1:8787 --no-autoupdate --logfile "%CFLOG%"

echo [NEON CORE] 3/3 等待公网地址（最多 60 秒）...
set "PUBURL="
for /l %%i in (1,1,60) do (
  if not defined PUBURL (
    timeout /t 1 >nul
    for /f "tokens=*" %%u in ('powershell -NoProfile -Command "if (Test-Path '%CFLOG%') { $m = Select-String -Path '%CFLOG%' -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' | Select-Object -First 1; if ($m) { $m.Matches[0].Value } }"') do set "PUBURL=%%u"
  )
)

if not defined PUBURL (
  echo.
  echo  [X] 没拿到公网地址。看看 %CFLOG% 里的报错。
  echo      也可以改用 share.cmd 走局域网。
  pause
  exit /b 1
)

REM 写文件，方便复制粘贴
> "%~dp0public-url.txt" echo !PUBURL!
> "%~dp0public-url.html" echo ^<meta http-equiv="refresh" content="0;url=!PUBURL!"^>^<title^>NEON CORE^</title^>^<a href="!PUBURL!"^>NEON CORE^</a^>

cls
echo.
echo  ================================================================
echo    手机 / 朋友直接打开（4G、5G、任何网络都行）：
echo.
echo        !PUBURL!
echo.
echo  ================================================================
echo.

"%NODE_BIN%" "tools\qr-print.mjs" "!PUBURL!"

echo   地址已存到 public-url.txt（想发微信就复制这个文件里的内容）
echo.
echo  * 保持这个窗口开着 = 一直能玩。关掉 = 停止分享。
echo  * 地址是临时的，下次重启会变。
echo    想要永久固定地址：看 README「固定地址（永久）」那一节，只需你登录一次。
echo.
echo  按任意键停止分享并关闭...
pause >nul
taskkill /f /im cloudflared.exe >nul 2>&1
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":8787" ^| findstr LISTENING') do taskkill /f /pid %%p >nul 2>&1
