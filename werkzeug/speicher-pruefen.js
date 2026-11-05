// Prüflauf für die Trennung von Test- und echtem Speicher. Läuft ohne Netz und ohne Server:
//   node werkzeug/speicher-pruefen.js
// Prüft die Store-Namen und die Sperre „Schlüssel passt nicht zum Speicher“. Die Schlüssel hier
// sind Attrappen, es wird nichts an Stripe oder Netlify geschickt.

const path = require('path');
const LIB = path.join(__dirname, '..', 'netlify', 'functions', '_lib');
const { speicherName, speicherIstLive } = require(path.join(LIB, 'store.js'));
const { betriebsart } = require(path.join(LIB, 'zahlung.js'));

let fehler = 0;
function pruef(name, ist, soll) {
  const ok = ist === soll;
  console.log((ok ? 'OK   ' : 'FEHL ') + name + (ok ? '' : '  → ist ' + ist + ', soll ' + soll));
  if (!ok) fehler++;
}

function umgebung(speicher, schluessel, lokal) {
  for (const [name, wert] of [['BUCHUNG_SPEICHER', speicher], ['STRIPE_SECRET_KEY', schluessel], ['NETLIFY_DEV', lokal]]) {
    if (wert === undefined) delete process.env[name];
    else process.env[name] = wert;
  }
}

// Die erwartete Sperre schreibt ins Fehlerprotokoll, das gehört hier nicht in die Ausgabe.
console.error = () => {};

const TEST = 'sk_test_attrappeNurFuerPruefung';
const LIVE = 'sk_live_attrappeNurFuerPruefung';
const FALL = [
  ['Testadresse: Testschlüssel, Testspeicher', undefined, TEST, 'fuehrungen', 'stripe'],
  ['Testadresse: echter Schlüssel wird gesperrt', undefined, LIVE, 'fuehrungen', 'nicht-konfiguriert'],
  ['Testadresse: eingeschränkter echter Schlüssel wird gesperrt', undefined, 'rk_live_attrappeNurFuerPruefung', 'fuehrungen', 'nicht-konfiguriert'],
  ['Echte Seite: echter Schlüssel, echter Speicher', 'live', LIVE, 'fuehrungen-live', 'stripe'],
  ['Echte Seite: Testschlüssel wird gesperrt', 'live', TEST, 'fuehrungen-live', 'nicht-konfiguriert'],
  ['Echte Seite: ohne Schlüssel nicht buchbar', 'live', undefined, 'fuehrungen-live', 'nicht-konfiguriert'],
  ['Falsche Schreibweise der Variable zählt nicht als echt', 'LIVE', LIVE, 'fuehrungen', 'nicht-konfiguriert'],
];

for (const [name, speicher, schluessel, store, art] of FALL) {
  umgebung(speicher, schluessel);
  pruef(name + ' (Speicher)', speicherName('fuehrungen'), store);
  pruef(name + ' (Zahlung)', betriebsart(), art);
}

umgebung('live', LIVE);
pruef('Echte Seite: Bilder getrennt', speicherName('fuehrungen-bilder'), 'fuehrungen-bilder-live');
pruef('Echte Seite: Rechnungen getrennt', speicherName('fuehrungen-rechnungen'), 'fuehrungen-rechnungen-live');
pruef('Echte Seite erkannt', speicherIstLive(), true);

umgebung(undefined, undefined, 'true');
pruef('Lokal ohne Schlüssel bleibt die Attrappe', betriebsart(), 'attrappe');
umgebung(undefined, undefined, undefined);
pruef('Netlify ohne Schlüssel bleibt gesperrt', betriebsart(), 'nicht-konfiguriert');

console.log(fehler ? '\n' + fehler + ' Fehler.' : '\nAlles in Ordnung.');
process.exit(fehler ? 1 : 0);
