// Prüflauf für die Löschfristen, ohne Netz und ohne Speicher, nur mit erfundenen Daten:
//   node werkzeug/bereinigung-pruefen.js

const path = require('path');
const { datenBereinigen } = require(path.join(__dirname, '..', 'netlify', 'functions', '_lib', 'bereinigung.js'));

let fehler = 0;
function pruef(name, ok) { console.log((ok ? 'OK   ' : 'FEHL ') + name); if (!ok) fehler++; }

const JETZT = new Date('2028-06-15T12:00:00Z').getTime();
const vorTagen = (t) => new Date(JETZT - t * 86400000).toISOString();
const buchung = (nummer, felder) => ({ nummer, telefon: '0170 0000000', fahrzeug: 'eigen', name: 'Probe', email: 'probe@example.com', terminId: 'alt', ...felder });

const state = {
  termine: [{ id: 'alt', datumIso: '2027-01-01' }, { id: 'neu', datumIso: '2028-05-01' }],
  buchungen: [
    buchung('alt-bezahlt', { status: 'bezahlt', bezahltAm: vorTagen(600), rechnungsnummer: 'R-1' }),
    buchung('neu-bezahlt', { status: 'bezahlt', bezahltAm: vorTagen(60), terminId: 'neu', rechnungsnummer: 'R-2' }),
    buchung('abgelaufen-alt', { status: 'abgelaufen', reserviertBis: vorTagen(41), terminId: 'neu' }),
    buchung('abgelaufen-frisch', { status: 'abgelaufen', reserviertBis: vorTagen(39), terminId: 'neu' }),
    buchung('ueberweisung-alt', { status: 'abgelaufen', ueberweisungFrist: vorTagen(41), terminId: 'neu' }),
    buchung('abgelaufen-ohne-frist', { status: 'abgelaufen', terminId: 'neu' }),
    buchung('abgelaufen-mit-rechnung', { status: 'abgelaufen', reserviertBis: vorTagen(100), rechnungsnummer: 'R-3', terminId: 'neu' }),
    buchung('termin-geloescht', { status: 'bezahlt', bezahltAm: vorTagen(400), terminId: 'weg', erstelltAm: vorTagen(400), rechnungsnummer: 'R-4' }),
    buchung('reserviert-offen', { status: 'reserviert', reserviertBis: vorTagen(100), terminId: 'neu' }),
  ],
};

const r = datenBereinigen(state, JETZT);
const finde = (n) => state.buchungen.find((b) => b.nummer === n);

pruef('Nach einem Jahr: Telefon und Anreise weg', finde('alt-bezahlt').telefon === '' && finde('alt-bezahlt').fahrzeug === '');
pruef('Nach einem Jahr: Name, E-Mail, Rechnung bleiben', finde('alt-bezahlt').name === 'Probe' && finde('alt-bezahlt').email === 'probe@example.com' && finde('alt-bezahlt').rechnungsnummer === 'R-1');
pruef('Vor einem Jahr: Telefon bleibt', finde('neu-bezahlt').telefon !== '');
pruef('Termin gelöscht: Frist läuft ab Buchungsdatum', finde('termin-geloescht').telefon === '');
pruef('Abgelaufen, 41 Tage: entfernt', !finde('abgelaufen-alt'));
pruef('Abgelaufen, 39 Tage: bleibt', !!finde('abgelaufen-frisch'));
pruef('Überweisung verfallen, 41 Tage: entfernt', !finde('ueberweisung-alt'));
pruef('Abgelaufen ohne Frist: bleibt', !!finde('abgelaufen-ohne-frist'));
pruef('Abgelaufen mit Rechnung: bleibt', !!finde('abgelaufen-mit-rechnung'));
pruef('Noch reserviert: bleibt', !!finde('reserviert-offen'));
pruef('Zählung stimmt', r.kontakte === 2 && r.entfernt.length === 2);

const zweiter = datenBereinigen(state, JETZT);
pruef('Zweiter Lauf: nichts mehr zu tun', zweiter.kontakte === 0 && zweiter.entfernt.length === 0);

console.log(fehler ? '\n' + fehler + ' Fehler.' : '\nAlles in Ordnung.');
process.exit(fehler ? 1 : 0);
