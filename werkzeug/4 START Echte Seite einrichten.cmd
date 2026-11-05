@echo off
chcp 65001 >nul
cd /d "%~dp0.."
rem Netlify-Anmeldung liegt im AppData der Claude-App (siehe 1 START).
if exist "C:\Users\DAff\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\netlify\Config\config.json" (
  set APPDATA=C:\Users\DAff\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming
)
echo.
echo  Echte Seite marschbefehl.com einrichten
echo  Einfuegen im schwarzen Fenster: Rechtsklick oder Strg+V, dann Enter.
echo.
echo  Schritt 1 von 3: Passwort und eigener Speicher (geht von allein)
node werkzeug\netlify-variablen-setzen.js --echt
if errorlevel 1 goto ende
echo.
echo  Schritt 2 von 3: Resend-Schluessel
node werkzeug\resend-schluessel-setzen.js --echt
if errorlevel 1 goto ende
echo.
echo  Schritt 3 von 3: ECHTER Stripe-Schluessel (beginnt mit sk_live_)
node werkzeug\stripe-schluessel-setzen.js --echt
:ende
echo.
echo  Fenster mit beliebiger Taste schliessen.
pause >nul
