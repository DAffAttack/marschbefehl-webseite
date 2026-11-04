// Fragt die zwei Stripe-Werte ab und trägt sie bei Netlify ein (Kontext branch:buchung,
// mit --alle für alle Kontexte). Die Werte erscheinen nirgends im Chat; sie gehen nur an Netlify.
//
// Aufruf über werkzeug\2 START Stripe-Schluessel eintragen.cmd (Doppelklick) oder:
//   node werkzeug/stripe-schluessel-setzen.js [--alle]

const path = require('path');
const readline = require('readline');
const { spawnSync } = require('child_process');

const alle = process.argv.includes('--alle');
const WEBHOOK_URL = alle
  ? 'https://marschbefehl.com/.netlify/functions/stripe-webhook'
  : 'https://buchung--zeitreise-seelower-hoehen.netlify.app/.netlify/functions/stripe-webhook';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const frage = (text) => new Promise((res) => rl.question(text, (a) => res((a || '').trim())));

function setzen(name, wert) {
  const args = ['netlify', 'env:set', name, wert, '--secret'];
  if (!alle) args.push('--context', 'branch:buchung');
  const r = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', args, { cwd: path.join(__dirname, '..'), encoding: 'utf8', shell: process.platform === 'win32' });
  const ok = r.status === 0;
  console.log((ok ? 'OK   ' : 'FEHL ') + name + (alle ? ' (alle Kontexte)' : ' (branch:buchung)'));
  if (!ok) console.log(((r.stdout || '') + (r.stderr || '')).split(wert).join('***'));
  return ok;
}

(async () => {
  console.log('');
  console.log('Webhook-Adresse fuer Stripe (im Stripe-Dashboard unter Webhooks eintragen):');
  console.log('  ' + WEBHOOK_URL);
  console.log('');
  let key = '';
  while (!/^sk_(test|live)_[A-Za-z0-9]{10,}$/.test(key)) {
    key = await frage('1) Stripe Secret key (beginnt mit sk_test_ oder sk_live_), einfuegen + Enter: ');
    if (!key) { console.log('   Abgebrochen.'); rl.close(); process.exit(2); }
    if (!/^sk_(test|live)_/.test(key)) console.log('   Das sieht nicht nach einem Secret key aus (muss mit sk_test_ oder sk_live_ beginnen).');
  }
  if (alle && key.startsWith('sk_test_')) console.log('   Hinweis: Testschluessel fuer alle Kontexte – fuer den Livegang spaeter sk_live_ eintragen.');
  if (!alle && key.startsWith('sk_live_')) console.log('   Hinweis: Live-Schluessel auf dem Branch-Deploy – fuer den Probelauf besser sk_test_.');
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
