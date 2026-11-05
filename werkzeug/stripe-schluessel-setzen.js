// Fragt die zwei Stripe-Werte ab und trägt sie bei Netlify ein: ohne Zusatz für die Testadresse
// (Kontext branch:buchung, nur sk_test_), mit --echt für die echte Seite (Kontext production, nur
// sk_live_). Die Werte erscheinen nirgends im Chat; sie gehen nur an Netlify.
//
// Aufruf über werkzeug\2 START Stripe-Schluessel eintragen.cmd (Doppelklick, Testadresse),
// werkzeug\4 START Echte Seite einrichten.cmd (echte Seite) oder:
//   node werkzeug/stripe-schluessel-setzen.js [--echt]

const path = require('path');
const readline = require('readline');
const { spawnSync } = require('child_process');

if (process.argv.includes('--alle')) {
  console.error('--alle gibt es nicht mehr: Test und echte Seite haben getrennte Speicher. Fuer die echte Seite: --echt');
  process.exit(2);
}
const echt = process.argv.includes('--echt');
const KONTEXT = echt ? 'production' : 'branch:buchung';
const PRAEFIX = echt ? 'sk_live_' : 'sk_test_';
const WEBHOOK_URL = echt
  ? 'https://marschbefehl.com/.netlify/functions/stripe-webhook'
  : 'https://buchung--zeitreise-seelower-hoehen.netlify.app/.netlify/functions/stripe-webhook';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const frage = (text) => new Promise((res) => rl.question(text, (a) => res((a || '').trim())));

function setzen(name, wert) {
  const args = ['netlify', 'env:set', name, wert, '--secret', '--context', KONTEXT];
  const r = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', args, { cwd: path.join(__dirname, '..'), encoding: 'utf8', shell: process.platform === 'win32' });
  const ok = r.status === 0;
  console.log((ok ? 'OK   ' : 'FEHL ') + name + ' (' + KONTEXT + ')');
  if (!ok) console.log(((r.stdout || '') + (r.stderr || '')).split(wert).join('***'));
  return ok;
}

(async () => {
  console.log('');
  console.log('Webhook-Adresse fuer Stripe (im Stripe-Dashboard unter Webhooks eintragen):');
  console.log('  ' + WEBHOOK_URL);
  console.log('');
  let key = '';
  while (!(key.startsWith(PRAEFIX) && /^sk_(test|live)_[A-Za-z0-9]{10,}$/.test(key))) {
    key = await frage('1) Stripe Secret key (beginnt mit ' + PRAEFIX + '), einfuegen + Enter: ');
    if (!key) { console.log('   Abgebrochen.'); rl.close(); process.exit(2); }
    if (!key.startsWith(PRAEFIX)) console.log('   Das passt nicht: Hier muss der Schluessel mit ' + PRAEFIX + ' beginnen.');
  }
  let whsec = '';
  while (!/^whsec_[A-Za-z0-9]{10,}$/.test(whsec)) {
    whsec = await frage('2) Webhook Signing secret (beginnt mit whsec_), einfuegen + Enter: ');
    if (!whsec) { console.log('   Abgebrochen.'); rl.close(); process.exit(2); }
    if (!whsec.startsWith('whsec_')) console.log('   Das sieht nicht nach einem Signing secret aus (muss mit whsec_ beginnen).');
  }
  rl.close();
  console.log('');
  let gut = setzen('STRIPE_SECRET_KEY', key);
  gut = setzen('STRIPE_WEBHOOK_SECRET', whsec) && gut;
  console.log(gut ? '\nFertig. Claude "erledigt" schreiben, dann wird der Deploy neu angestossen und geprueft.'
                  : '\nMindestens ein Wert konnte nicht gesetzt werden (siehe oben).');
  process.exit(gut ? 0 : 1);
})();
