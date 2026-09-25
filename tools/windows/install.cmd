@echo off
rem James JMD — installs the .jmd opener for the current user (no admin, nothing else required):
rem copies the runtime + launcher to %LOCALAPPDATA%\James JMD and associates .jmd with it.
rem Double-click a .jmd afterwards: it renders in the default browser, like a .pptx opens in PowerPoint.
setlocal
set DEST=%LOCALAPPDATA%\James JMD
if not exist "%DEST%" mkdir "%DEST%"
copy /y "%~dp0james-jmd.html" "%DEST%\james-jmd.html" >nul
copy /y "%~dp0jmd-open.ps1" "%DEST%\jmd-open.ps1" >nul
> "%DEST%\jmd-open.cmd" echo @echo off
>> "%DEST%\jmd-open.cmd" echo powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%DEST%\jmd-open.ps1" -Path %%1
reg add "HKCU\Software\Classes\.jmd" /ve /d "Jamespot.JMD" /f >nul
reg add "HKCU\Software\Classes\.jmd" /v "Content Type" /d "text/markdown" /f >nul
reg add "HKCU\Software\Classes\Jamespot.JMD" /ve /d "JMD presentation" /f >nul
reg add "HKCU\Software\Classes\Jamespot.JMD\shell\open" /ve /d "Open with James JMD" /f >nul
reg add "HKCU\Software\Classes\Jamespot.JMD\shell\open\command" /ve /d "\"%DEST%\jmd-open.cmd\" \"%%1\"" /f >nul
echo Installed in "%DEST%". Double-click a .jmd to open it.
echo To uninstall: uninstall.cmd
