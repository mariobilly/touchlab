@echo off
setlocal
cd /d "%~dp0"
echo.
echo  TouchLab setup
echo  ==============
echo.
where node >nul 2>nul || (echo Node.js is missing. Install it from https://nodejs.org and run this again. & pause & exit /b 1)
echo [1/4] Installing packages (also copies the hand-tracking models)...
call npm.cmd install || goto :fail
echo [2/4] Building the app...
call npm.cmd run build || goto :fail
echo [3/4] Drawing the icon...
python scripts\make_icon.py || echo     (Python/Pillow not found - keeping the existing icon)
echo [4/4] Creating the desktop shortcut...
powershell -NoProfile -ExecutionPolicy Bypass -File "Create Desktop Shortcut.ps1" || goto :fail
echo.
echo Done. Double-click "TouchLab" on your desktop.
where ffmpeg >nul 2>nul || echo Note: ffmpeg was not found. Install it with "winget install Gyan.FFmpeg" to export MP4s.
pause
exit /b 0
:fail
echo.
echo Setup failed. See the messages above.
pause
exit /b 1
