param([string]$Cmd, [string]$WorkDir = 'C:\Users\HuaWei\Games\neon-core', [int]$TimeoutSec = 600)

# 统一的命令执行助手：把 stdout/stderr 重定向到文件再读回来，
# 绕过当前环境下 PowerShell 管道拿不到原生命令输出的问题。
$ErrorActionPreference = 'Continue'
$node = 'C:\Users\HuaWei\Apps\dshx-trial\app\node\node.exe'
$outFile = 'C:\tmp\run_out.txt'
$errFile = 'C:\tmp\run_err.txt'
Remove-Item $outFile, $errFile -ErrorAction SilentlyContinue

$wrapped = $Cmd -replace '\bnode\b', "`"$node`""
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$cmdExe = if ($env:ComSpec) { $env:ComSpec } else { 'C:\Windows\System32\cmd.exe' }
$p = Start-Process -FilePath $cmdExe -ArgumentList '/d','/s','/c', $wrapped `
  -WorkingDirectory $WorkDir -NoNewWindow -PassThru `
  -RedirectStandardOutput $outFile -RedirectStandardError $errFile
if (-not $p.WaitForExit($TimeoutSec * 1000)) {
  $p.Kill()
  "TIMEOUT after ${TimeoutSec}s"
}
$sw.Stop()
"=== exit=$($p.ExitCode) in $([math]::Round($sw.Elapsed.TotalSeconds,1))s ==="
"--- CMD: $wrapped"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Get-Content $outFile -Raw -Encoding UTF8 -ErrorAction SilentlyContinue
$err = Get-Content $errFile -Raw -Encoding UTF8 -ErrorAction SilentlyContinue
if ($err) { "--- STDERR ---"; $err }
