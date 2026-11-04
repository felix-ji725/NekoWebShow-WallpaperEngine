@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo   NekoWebShow - fetch assets and install
echo   Assets belong to NEKO WORKs. Download for personal use only, do not redistribute.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\fetch-assets.ps1" %*
echo.
pause