@echo off
chcp 65001 >nul
title NEON CORE - 修复手机访问（放行防火墙）

net session >nul 2>&1
if errorlevel 1 (
  echo.
  echo  [!] 需要管理员权限。
  echo      请右键这个文件 → "以管理员身份运行"。
  echo.
  pause
  exit /b 1
)

echo [1/3] 放行 8787 端口（入站 TCP）...
netsh advfirewall firewall delete rule name="NEON CORE 8787" >nul 2>&1
netsh advfirewall firewall add rule name="NEON CORE 8787" dir=in action=allow protocol=TCP localport=8787 profile=any

echo.
echo [2/3] 放行 node.exe 的入站连接（所有网络类型）...
for /f "delims=" %%i in ('where node 2^>nul') do set "NODEPATH=%%i"
if not defined NODEPATH (
  if exist "%USERPROFILE%\Apps\dshx-trial\app\node\node.exe" set "NODEPATH=%USERPROFILE%\Apps\dshx-trial\app\node\node.exe"
)
if defined NODEPATH (
  netsh advfirewall firewall delete rule name="NEON CORE node" >nul 2>&1
  netsh advfirewall firewall add rule name="NEON CORE node" dir=in action=allow program="%NODEPATH%" enable=yes profile=any
  echo      已放行: %NODEPATH%
) else (
  echo      [跳过] 没找到 node.exe，请手动确认路径
)

echo.
echo [3/3] 当前放行规则：
netsh advfirewall firewall show rule name="NEON CORE 8787" | findstr /C:"规则名称" /C:"Rule Name" /C:"已启用" /C:"Enabled" /C:"操作" /C:"Action" /C:"本地端口" /C:"LocalPort"
netsh advfirewall firewall show rule name="NEON CORE node" | findstr /C:"规则名称" /C:"Rule Name" /C:"已启用" /C:"Enabled" /C:"操作" /C:"Action"

echo.
echo ================================================================
echo  搞定。现在用手机浏览器打开：
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /C:"IPv4"') do (
  for /f "tokens=1" %%b in ("%%a") do echo      http://%%b:8787/
)
echo ================================================================
echo.
echo  如果手机上还是打不开，那基本可以确定是"路由器隔离了设备"，
echo  不是电脑的问题 —— 这时候请看 README 里的"外网隧道"方案。
echo.
pause
