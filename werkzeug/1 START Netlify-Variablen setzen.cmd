@echo off
chcp 65001 >nul
cd /d "%~dp0.."
set LOG=%~dp0letzter_lauf.txt
rem Die Netlify-Anmeldung liegt im umgeleiteten AppData der Claude-App (Paket Claude_pzs8sxrjxfjjc).
rem Ausserhalb der App findet die Netlify-Befehlszeile sie nur, wenn APPDATA dorthin zeigt.
if exist "C:\Users\DAff\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\netlify\Config\config.json" (
  set APPDATA=C:\Users\DAff\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming
)
echo.
echo  Netlify-Variablen fuer den Branch "buchung" setzen
echo  (Passwort kommt aus website\.env, wird nicht angezeigt)
echo.
echo Lauf vom %DATE% %TIME% > "%LOG%"
echo Ordner: %CD% >> "%LOG%"
echo APPDATA: %APPDATA% >> "%LOG%"
node werkzeug\netlify-variablen-setzen.js >> "%LOG%" 2>&1
echo Exit-Code: %ERRORLEVEL% >> "%LOG%"
type "%LOG%"
echo.
echo  Der Text oben steht auch in werkzeug\letzter_lauf.txt - Claude kann ihn lesen.
echo  Fenster mit beliebiger Taste schliessen.
pause >nul
