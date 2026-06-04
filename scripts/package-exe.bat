@echo off
setlocal
cd /d "%~dp0.."

echo [1/3] Checking npm dependencies...
if not exist "node_modules" (
  call npm install
  if errorlevel 1 exit /b %errorlevel%
)

echo [2/3] Building NSIS installer exe...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0package-exe.ps1"
if errorlevel 1 exit /b %errorlevel%

echo [3/3] Done.
echo Installer output:
dir /b "src-tauri\target\release\bundle\nsis\*.exe"
echo.
echo Portable app exe:
echo src-tauri\target\release\aaalice_mc_translator.exe
pause
