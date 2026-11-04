// Fragt den Resend-Schlüssel und die Kopie-Adresse ab und trägt beides bei Netlify ein
// (Kontext branch:buchung, mit --alle für alle Kontexte). Werte erscheinen nirgends im Chat.
//
// Aufruf über werkzeug\3 START Resend-Schluessel eintragen.cmd (Doppelklick) oder:
//   node werkzeug/resend-schluessel-setzen.js [--alle]

const path = require('path');
const readline = require('readline');
const { spawnSync } = require('child_process');

const alle = process.argv.includes('--alle');
const KOPIE_VORGABE = 'mail.zsh@proton.me';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const frage = (text) => new Promise((res) => rl.question(text, (a) => res((a || '').trim())));

function setzen(name, wert, geheim) {
  const args = ['netlify', 'env:set', name, wert];
  if (geheim) args.push('--secret');
  if (!alle) args.push('--context', 'branch:buchung');
  const r = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', args, { cwd: path.join(__dirname, '..'), encoding: 'utf8', shell: process.platform === 'win32' });
  const ok = r.status === 0;
  console.log((ok ? 'OK   ' : 'FEHL ') + name + (alle ? ' (alle Kontexte)' : ' (branch:buchung)'));
  if (!ok) console.log(((r.stdout || '') + (r.stderr || '')).split(wert).join('***'));
  return ok;
}

(async () => {
  console.log('');
  let key = '';
  while (!/^re_[A-Za-z0-9_]{10,}$/.test(key)) {
    key = await frage('1) Resend API Key (beginnt mit re_), einfuegen + Enter: ');
    if (!key) { console.log('   Abgebrochen.'); rl.close(); process.exit(2); }
    if (!key.startsWith('re_')) console.log('   Das sieht nicht nach einem Resend-Schluessel aus (muss mit re_ beginnen).');
  }
  let kopie = '';
  while (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(kopie)) {
    kopie = (await frage('2) Deine E-Mail fuer Kopien ("Neue Buchung", Abgleich) [Enter = ' + KOPIE_VORGABE + ']: ')) || KOPIE_VORGABE;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(kopie)) console.log('   Das ist keine E-Mail-Adresse.');
  }
  rl.close();
  console.log('');
  let gut = setzen('RESEND_API_KEY', key, true);
  gut = setzen('MAIL_KOPIE_AN', kopie, false) && gut;
  console.log(gut ? '\nFertig. Claude "erledigt" schreiben, dann wird der Deploy neu angestossen und die Mail geprueft.'
                  : '\nMindestens ein Wert konnte nicht gesetzt werden (siehe oben).');
  process.exit(gut ? 0 : 1);
})();
