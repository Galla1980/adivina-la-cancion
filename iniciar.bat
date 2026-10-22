@echo off
title Adivina la Cancion
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  No se encontro Node.js en el sistema.
  echo  Descargalo en https://nodejs.org y vuelve a ejecutar este archivo.
  echo.
  pause
  exit /b 1
)
node server.js
pause
