@echo off
setlocal
chcp 65001 >nul

set "SRC=%~dp0"
set "SRCDIR=%SRC:~0,-1%"
set "LOG=%~dp0_install.log"
set "WE="
echo start > "%LOG%"

rem ??????? Steam ???????????????????
set "STEAMPATH="
for /f "tokens=2,*" %%A in ('reg query "HKCU\Software\Valve\Steam" /v SteamPath 2^>nul ^| find /i "SteamPath"') do set "STEAMPATH=%%B"
if defined STEAMPATH set "STEAMPATH=%STEAMPATH:/=\%"
if defined STEAMPATH if exist "%STEAMPATH%\steamapps\common\wallpaper_engine\wallpaper32.exe" set "WE=%STEAMPATH%\steamapps\common\wallpaper_engine"
echo steampath=%STEAMPATH%>>"%LOG%"

if exist "E:\SteamLibrary\steamapps\common\wallpaper_engine\wallpaper32.exe" set "WE=E:\SteamLibrary\steamapps\common\wallpaper_engine"
if not defined WE if exist "D:\SteamLibrary\steamapps\common\wallpaper_engine\wallpaper32.exe" set "WE=D:\SteamLibrary\steamapps\common\wallpaper_engine"
if not defined WE if exist "C:\Program Files (x86)\Steam\steamapps\common\wallpaper_engine\wallpaper32.exe" set "WE=C:\Program Files (x86)\Steam\steamapps\common\wallpaper_engine"
if not defined WE if exist "D:\Steam\steamapps\common\wallpaper_engine\wallpaper32.exe" set "WE=D:\Steam\steamapps\common\wallpaper_engine"
if not defined WE if exist "E:\Steam\steamapps\common\wallpaper_engine\wallpaper32.exe" set "WE=E:\Steam\steamapps\common\wallpaper_engine"
if not defined WE goto nowe

echo WE=%WE%>>"%LOG%"
set "LINK=%WE%\projects\myprojects\NekoWebShow-Portable"

echo.
echo Install mode:
echo   [J] Link  - instant, this folder must stay where it is (recommended)
echo   [C] Copy  - copy ~1 GB into Wallpaper Engine, folder can be moved later
echo.
choice /C JC /N /T 10 /D J >nul
if errorlevel 2 goto copymode
goto linkmode

:linkmode
if exist "%LINK%" rmdir "%LINK%" 2>nul
if exist "%LINK%" goto dirty
echo Linking...
mklink /J "%LINK%" "%SRCDIR%" >>"%LOG%" 2>&1
if errorlevel 1 goto copymode
goto open

:copymode
echo Copying... this takes about a minute.
if exist "%LINK%" goto dirty
robocopy "%SRCDIR%" "%LINK%" /E /R:1 /W:1 /XD .git /NFL /NDL /NJH /NJS /NP >>"%LOG%" 2>&1
if errorlevel 8 goto copyfail
goto open

:open
echo Installed to: %LINK%
rem ?? WE ?????????????????????? -control ??????
tasklist /FI "IMAGENAME eq wallpaper32.exe" 2>nul | find /i "wallpaper32.exe" >nul
if not errorlevel 1 goto send
echo Starting Wallpaper Engine, waiting...
echo starting WE >>"%LOG%"
start "" "%WE%\launcher.exe"
timeout /t 15 >nul

:send
start "" "%WE%\wallpaper32.exe" -control openWallpaper -file "%LINK%\project.json"
timeout /t 4 >nul
echo.
echo Done. In Wallpaper Engine open "Installed" and pick NekoWebShow-Portable.
goto end

:nowe
echo [ERROR] Wallpaper Engine not found. Edit the WE= line in this file.
goto end

:dirty
echo [ERROR] %LINK% already exists. Delete it in Wallpaper Engine first.
goto end

:copyfail
echo [ERROR] Copy failed. Right-click this file and "Run as administrator".
goto end

:end
echo.
pause