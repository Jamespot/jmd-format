@echo off
reg delete "HKCU\Software\Classes\.jmd" /f >nul 2>&1
reg delete "HKCU\Software\Classes\Jamespot.JMD" /f >nul 2>&1
rmdir /s /q "%LOCALAPPDATA%\James JMD" 2>nul
echo James JMD removed.
