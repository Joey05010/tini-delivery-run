@echo off
rem Serves the game on port 5510 so phones on the same Wi-Fi can open it.
cd /d "%~dp0"
echo.
echo Tini Delivery Run is being served on port 5510.
echo On your phone (same Wi-Fi), open one of these addresses:
echo.
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do for /f "tokens=*" %%b in ("%%a") do echo    http://%%b:5510/
echo.
echo Keep this window open while you play. Close it to stop the server.
echo.
python -m http.server 5510 --bind 0.0.0.0
pause
