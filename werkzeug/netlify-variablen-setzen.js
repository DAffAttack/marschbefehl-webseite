// Setzt die Variablen für den Probelauf auf dem Branch-Deploy in Netlify.
// Liest die Werte aus website/.env und ruft die Netlify-CLI auf – der Wert erscheint
// nirgends im Chat oder im Protokoll.
//
// Aufruf im Ordner website:
//   node werkzeug/netlify-variablen-setzen.js                 → nur Kontext branch:buchung (Probelauf)
//   node werkzeug/netlify-variablen-setzen.js --alle          → alle Kontexte (vor dem Livegang)
//
// Gesetzt werden: FUEHRUNGEN_ADMIN_PASSWORD (geheim) und – nur für den Branch – BUCHUNG_BREMSE_JE_STUNDE=1000,
// damit die Prüfläufe nicht an der Buchungsbremse (10 je Stunde und IP) scheitern.
// Stripe- und Resend-Schlüssel kommen NICHT hierher; die trägt der Betreiber nach Anlegen der Konten
// in Netlify ein (Site configuration → Environment variables), siehe BUCHUNG_EINRICHTUNG.md Abschnitt 4.
// Nach dem Setzen braucht der Branch einen neuen Deploy (Netlify → Deploys → Trigger deploy), sonst
// sehen die Functions die Variablen nicht.

const path = require('path');
const { spawnSync } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const alle = process.argv.includes('--alle');
const pw = process.env.FUEHRUNGEN_ADMIN_PASSWORD;
if (!pw) { console.error('FUEHRUNGEN_ADMIN_PASSWORD fehlt in .env'); process.exit(2); }

function setzen(name, wert, geheim) {
  const args = ['netlify', 'env:set', name, wert];
  if (!alle) args.push('--context', 'branch:buchung');
  if (geheim) args.push('--secret');
  const r = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', args, { cwd: path.join(__dirname, '..'), encoding: 'utf8', shell: process.platform === 'win32' });
  const text = (r.stdout || '') + (r.stderr || '');
  const ok = r.status === 0;
  console.log((ok ? 'OK   ' : 'FEHL ') + name + (alle ? ' (alle Kontexte)' : ' (branch:buchung)'));
  if (!ok) console.log(text.split(pw).join('***'));
  return ok;
}

let gut = setzen('FUEHRUNGEN_ADMIN_PASSWORD', pw, true);
if (!alle) gut = setzen('BUCHUNG_BREMSE_JE_STUNDE', '1000', false) && gut;
console.log(gut ? '\nFertig. Jetzt in Netlify unter Deploys → „Trigger deploy“ für den Branch buchung, danach die Prüfläufe.'
                : '\nMindestens eine Variable konnte nicht gesetzt werden (siehe oben).');
process.exit(gut ? 0 : 1);
