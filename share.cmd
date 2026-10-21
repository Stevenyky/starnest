@echo off
setlocal
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo.
  echo Python 3 was not found.
  echo Install Python 3.9 or newer from https://www.python.org/downloads/
  echo and enable "Add python.exe to PATH" during installation.
  echo.
  pause
  exit /b 1
)

echo.
echo   STARNEST / LAN share
echo   This server listens on your local network.
echo   Keep this window open. Press Ctrl+C to stop.
echo.
echo   If Windows Firewall asks, allow access on Private networks.
echo   Do not expose this port directly to the public internet.
echo.

python serve.py 8765 --lan
if errorlevel 1 (
  echo.
  echo The server stopped unexpectedly. Port 8765 may be in use.
  echo Try: python serve.py 9000 --lan
  pause
)
