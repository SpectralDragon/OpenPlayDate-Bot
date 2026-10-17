@echo off
setlocal
if exist "%~dp0ide\dist\OpenPlay-Studio-win32-x64\OpenPlay-Studio.exe" (
  start "" "%~dp0ide\dist\OpenPlay-Studio-win32-x64\OpenPlay-Studio.exe"
  exit /b 0
)
cd /d "%~dp0ide"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 22.12 or newer, then run this launcher again.
  pause
  exit /b 1
)
if not exist node_modules\electron\package.json (
  call npm.cmd install
  if errorlevel 1 goto failed
)
if not exist native\build\openplay-simulator.exe (
  call npm.cmd run build:native
  if errorlevel 1 goto failed
)
call npm.cmd start
if errorlevel 1 goto failed
exit /b 0
:failed
echo OpenPlay Studio could not start. See the message above and ide\README.md.
pause
exit /b 1
