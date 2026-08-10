$ErrorActionPreference = "Continue"
$cwd = $PSScriptRoot
# v9：E2E 使用隔离临时数据库，避免污染生产 data/game.db 的排行榜与账号
$tempDir = Join-Path $env:TEMP ("abyss-e2e-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $tempDir | Out-Null
$job = Start-Job -ScriptBlock {
  Set-Location $using:cwd
  $env:PORT = "3000"
  $env:HOSTNAME = "127.0.0.1"
  $env:NEXT_PUBLIC_BASE_PATH = ""
  $env:ABYSS_DB_PATH = Join-Path $using:tempDir "game.db"
  node .next/standalone/server.js
}
$ready = $false
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Seconds 2
  $code = curl.exe -s -o NUL -w "%{http_code}" http://127.0.0.1:3000 -m 5
  if ($code -eq "200") { $ready = $true; break }
}
Write-Output "server ready: $ready (isolated db: $tempDir)"
if ($ready) {
  node e2e-test.mjs
  $exit = $LASTEXITCODE
} else {
  $exit = 1
  Receive-Job $job -ErrorAction SilentlyContinue | Select-Object -First 20
}
Stop-Job $job -ErrorAction SilentlyContinue
Remove-Job $job -Force -ErrorAction SilentlyContinue
# 清理临时数据库：先解析并确认目标位于系统 TEMP 下，避免误删
$resolved = (Resolve-Path -LiteralPath $tempDir -ErrorAction SilentlyContinue).Path
if ($resolved -and $resolved.StartsWith($env:TEMP, [System.StringComparison]::OrdinalIgnoreCase)) {
  [System.IO.Directory]::Delete($resolved, $true)
}
Write-Output "--- e2e exit: $exit ---"
exit $exit
