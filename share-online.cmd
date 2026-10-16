@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
cd /d "%~dp0"

REM 公网分享：起一个 cloudflared 隧道，把游戏映射成一个 HTTPS 公网地址。
REM 手机用什么网都能开（4G/5G/别的 WiFi 都行），而且 HTTPS 让 PWA/离线缓存生效。
REM 关掉这个窗口 = 隧道和服务器一起停。

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
  echo [NEON CORE] 没找到 cloudflared.exe，正在下载 ^(约 53MB^)...
  powershell -NoProfile -Command "[Net.ServicePointManager]::SecurityProtocol='Tls12'; Invoke-WebRequest -UseBasicParsing 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile '%CF%'"
  if not exist "%CF%" (
    echo [NEON CORE] 下载失败，请检查网络后重试。
    pause
    exit /b 1
  )
)

echo [NEON CORE] 1/3 启动游戏服务器...
start "NEON CORE server" /min "%NODE_BIN%" "tools\serve.mjs" 8787
timeout /t 2 >nul

echo [NEON CORE] 2/3 建立公网隧道（拿到地址后会打印二维码）...
del /q "%TEMP%\neon-cf.log" 2>nul
start /min "" "%CF%" tunnel --url http://127.0.0.1:8787 --no-autoupdate --logfile "%TEMP%\neon-cf.log"

echo [NEON CORE] 3/3 等待公网地址...
set "PUBURL="
for /l %%i in (1,1,40) do (
  if not defined PUBURL (
    timeout /t 1 >nul
    for /f "tokens=*" %%u in ('powershell -NoProfile -Command "if (Test-Path '%TEMP%\neon-cf.log') { $m = Select-String -Path '%TEMP%\neon-cf.log' -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' | Select-Object -First 1; if ($m) { $m.Matches[0].Value } }"') do set "PUBURL=%%u"
  )
)

if not defined PUBURL (
  echo.
  echo  [X] 没拿到公网地址，隧道可能没起来。
  echo      看看 %TEMP%\neon-cf.log 里的报错，或者改用 share.cmd 走局域网。
  pause
  exit /b 1
)

echo.
echo  ================================================================
echo   手机直接打开这个地址（4G/5G 也行）：
echo.
echo      !PUBURL!
echo.
echo   ================================================================
echo.

REM 顺手在终端里印个二维码：手机相机对着扫，不用手输
"%NODE_BIN%" -e "import('./src/qr.js').then(m=>{const q=m.encodeQr(process.env.PUBURL||'');const t=m.qrToText(q,{quiet:2});console.log(t.split('\n').map(l=>'   '+l).join('\n'))})" 2>nul
echo.
echo   地址也写进了 public-url.txt，方便复制。
echo   !PUBURL!> "%~dp0public-url.txt"
echo.
echo  * 保持这个窗口开着，关掉就等于停止分享。
echo  * 这是临时的匿名隧道，地址每次重启都会变；
echo    要固定地址就把项目传到 Netlify / Cloudflare Pages（见 README）。
echo.
pause
