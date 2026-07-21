@echo off
cd /d "%~dp0"
if not exist mediamtx.exe (
  echo.
  echo   Falta o mediamtx.exe nesta pasta.
  echo   Baixe "mediamtx_vX.X.X_windows_amd64.zip" em:
  echo   https://github.com/bluenviron/mediamtx/releases
  echo   Extraia e coloque o mediamtx.exe aqui, depois rode este .bat de novo.
  echo.
  pause
  exit /b 1
)
start "MediaMTX local" mediamtx.exe mediamtx.yml
timeout /t 2 >nul
start "" "%~dp0grid.html"
