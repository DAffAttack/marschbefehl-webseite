@echo off
chcp 65001 >nul
cd /d "%~dp0.."
rem Netlify-Anmeldung liegt im AppData der Claude-App (siehe 1 START).
if exist "C:\Users\DAff\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\netlify\Config\config.json" (
  set APPDATA=C:\Users\DAff\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming
)
echo.
echo  Resend-Schluessel bei Netlify eintragen (Branch "buchung")
echo  Einfuegen im schwarzen Fenster: Rechtsklick oder Strg+V, dann Enter.
echo.
node werkzeug\resend-schluessel-setzen.js %*
echo.
echo  Fenster mit beliebiger Taste schliessen.
pause >nul
