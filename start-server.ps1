# Запускает сервер «Арены на четверых» в фоне, без окна.
# Журнал: server.log и server-errors.log в этой же папке.
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$busy = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
if ($busy) { exit 0 }   # уже запущен
Start-Process -FilePath "C:\Program Files\nodejs\node.exe" -ArgumentList "server.js" `
  -WorkingDirectory $dir -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $dir "server.log") `
  -RedirectStandardError (Join-Path $dir "server-errors.log")
