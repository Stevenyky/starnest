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
echo   STARNEST / local preview
echo   http://127.0.0.1:8765/
echo   Press Ctrl+C to stop.
echo.

start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 1; Start-Process 'http://127.0.0.1:8765/'"
python serve.py
if errorlevel 1 (
  echo.
  echo The server stopped unexpectedly. Port 8765 may be in use.
  echo Try: python serve.py 9000
  pause
)
