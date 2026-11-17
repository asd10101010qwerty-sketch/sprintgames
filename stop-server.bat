@echo off
chcp 65001 >nul
rem Останавливает сервер «Арены» (процесс, который слушает порт 3000).
set FOUND=
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:":3000 .*LISTENING"') do (
  taskkill /PID %%p /F >nul 2>&1
  set FOUND=1
)
if defined FOUND (echo Сервер остановлен.) else (echo Сервер не был запущен.)
pause
