@echo off
setlocal

cd /d "%~dp0"

echo ==========================================
echo Actualizando dependencias y compilando
echo ==========================================
echo.

call npm.cmd install
if errorlevel 1 goto :fail

echo.
echo Ejecutando pruebas...
call npm.cmd run ai-first:test
if errorlevel 1 goto :fail

echo.
echo Compilando app web...
call npm.cmd --prefix apps\ai-first-web run build
if errorlevel 1 goto :fail

echo.
echo Listo. Ya puedes abrir "iniciar-app.bat".
echo.
pause
exit /b 0

:fail
echo.
echo Ocurrio un error durante la actualizacion o compilacion.
echo Revisa los mensajes de esta ventana.
echo.
pause
exit /b 1

endlocal
