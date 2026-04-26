@echo off
setlocal

cd /d "%~dp0"

echo ==========================================
echo Iniciando Mesa de Ofertas AI
echo ==========================================
echo.

if not exist "apps\ai-first-web\.next\BUILD_ID" (
  echo No existe un build de produccion listo.
  echo Ejecuta primero "actualizar-y-compilar.bat".
  echo.
  pause
  exit /b 1
)

start "" "http://127.0.0.1:3000"
npm.cmd --prefix apps\ai-first-web run start -- --hostname 127.0.0.1 --port 3000

endlocal
