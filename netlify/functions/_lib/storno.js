// Storno einer Buchung (mit oder ohne Erstattung) und Absage eines ganzen Termins (E5).
//
// Reihenfolge beim Storno mit Erstattung:
//   1. Buchung lesen und prüfen (nicht schon storniert/erstattet).
//   2. Erstattung beim Zahlungsanbieter anstoßen (Idempotenz-Schlüssel je Buchung: ein
//      zweiter Versuch erzeugt bei Stripe keine zweite Erstattung).
//   3. Status setzen: "erstattet" (Geld zurück) oder "storniert" (ohne Erstattung oder
//      nie bezahlt). Protokoll.
//   4. Mail an den Gast; schlägt sie fehl, bleibt der Status, Protokoll "mail-fehlgeschlagen".
//
// Termin absagen = Storno mit Erstattung für jede aktive Buchung + Termin-Status "abgesagt".
// Der Termin bleibt erhalten (Protokoll, Rechnungen), erscheint aber nicht mehr öffentlich.

const { withState, readState, findFuehrung, protokoll } = require('./store');
const { erstatten } = require('./zahlung');
const { mailSenden, stornoMail, absageMail } = require('./mail');

function aktiv(b) {
  const s = b.status || 'bezahlt';
  return s === 'reserviert' || s === 'bezahlt' || s === 'pruefen';
}

/**
 * @param {string} buchungId
 * @param {{erstatten?:boolean, grund?:string, absage?:boolean, quelle?:string}} opt
 */
async function buchungStornieren(buchungId, opt) {
  const o = opt || {};
  const state = await readState();
  const b = state.buchungen.find((x) => x.id === buchungId);
  if (!b) return { ok: false, status: 404, error: 'Buchung nicht gefunden.' };
  if (!aktiv(b)) return { ok: false, status: 400, error: 'Diese Buchung ist bereits ' + (b.status === 'erstattet' ? 'erstattet' : b.status) + '.' };
  const termin = state.termine.find((t) => t.id === b.terminId) || null;
  const fuehrung = findFuehrung(state, b.fuehrungId) || { titel: 'Führung', ort: '' };

  const warBezahlt = (b.status === 'bezahlt' || b.status === 'pruefen') && !!b.stripePaymentIntent;
  const sollErstatten = o.erstatten !== false && warBezahlt;

  let erstattung = null;
  if (sollErstatten) {
    try {
      erstattung = await erstatten({ buchung: b });
    } catch (err) {
      console.error('buchungStornieren: Erstattung fehlgeschlagen:', err.message);
      await withState((st) => {
        const x = st.buchungen.find((y) => y.id === buchungId);
        if (x) protokoll(st, { art: 'erstattung-fehlgeschlagen', buchungId: x.id, nummer: x.nummer, text: String(err.message).slice(0, 200) });
        return { ok: true };
      });
      return { ok: false, status: 502, error: 'Erstattung beim Zahlungsanbieter fehlgeschlagen: ' + err.message + ' Die Buchung bleibt unverändert.' };
    }
  }

  const neuerStatus = sollErstatten ? 'erstattet' : 'storniert';
  const r = await withState((st) => {
    const x = st.buchungen.find((y) => y.id === buchungId);
    if (!x) return { ok: false, status: 404, error: 'Buchung nicht gefunden.' };
    const vorher = x.status || 'bezahlt';
    x.status = neuerStatus;
    x.storniertAm = new Date().toISOString();
    x.stornoGrund = o.grund || (o.absage ? 'Termin abgesagt' : '');
    if (erstattung) {
      x.erstattungId = erstattung.erstattungId;
      x.erstattetAm = x.storniertAm;
      x.erstattetCent = x.betragCent;
    }
    protokoll(st, {
      art: o.absage ? 'buchung-abgesagt' : sollErstatten ? 'buchung-erstattet' : 'buchung-storniert',
      buchungId: x.id,
      nummer: x.nummer,
      text: 'vorher: ' + vorher + (erstattung ? ', Erstattung ' + erstattung.erstattungId + ' (' + x.betragCent / 100 + ' €)' : warBezahlt ? ', ohne Erstattung' : '') + (o.grund ? ' – ' + o.grund : ''),
    });
    return { ok: true, buchung: JSON.parse(JSON.stringify(x)) };
  }, { bestaetigen: (st) => st.buchungen.some((y) => y.id === buchungId && y.status === neuerStatus) });
  if (!r.ok) return r;

  // Mail an den Gast (nur wenn die Buchung je eine E-Mail bekommen hätte: bezahlt/pruefen)
  if (warBezahlt || b.status === 'reserviert') {
    try {
      const m = o.absage
        ? absageMail({ buchung: r.buchung, fuehrung, termin, grund: o.grund, erstattet: sollErstatten })
        : stornoMail({ buchung: r.buchung, fuehrung, termin, grund: o.grund, erstattet: sollErstatten });
      const erg = await mailSenden({ an: r.buchung.email, betreff: m.betreff, text: m.text, html: m.html });
      await withState((st) => {
        const x = st.buchungen.find((y) => y.id === buchungId);
        if (x) protokoll(st, { art: o.absage ? 'mail-absage' : 'mail-storno', buchungId: x.id, nummer: x.nummer, text: erg.betriebsart + ' ' + erg.id });
        return { ok: true };
      });
    } catch (err) {
      console.error('buchungStornieren: Mail fehlgeschlagen:', err.message);
      await withState((st) => {
        const x = st.buchungen.find((y) => y.id === buchungId);
        if (x) protokoll(st, { art: 'mail-fehlgeschlagen', buchungId: x.id, nummer: x.nummer, text: 'Storno/Absage: ' + String(err.message).slice(0, 200) });
        return { ok: true };
      });
    }
  }
  return { ok: true, status: neuerStatus, erstattet: sollErstatten, erstattungId: erstattung ? erstattung.erstattungId : null, nummer: r.buchung.nummer };
}

/**
 * Sagt einen Termin ab: alle aktiven Buchungen werden storniert und (wenn bezahlt) erstattet,
 * der Termin bekommt Status "abgesagt".
 */
async function terminAbsagen(terminId, opt) {
  const o = opt || {};
  const state = await readState();
  const termin = state.termine.find((t) => t.id === terminId);
  if (!termin) return { ok: false, status: 404, error: 'Termin nicht gefunden.' };
  if (termin.status === 'abgesagt') return { ok: false, status: 400, error: 'Dieser Termin ist bereits abgesagt.' };

  const betroffene = state.buchungen.filter((b) => b.terminId === terminId && aktiv(b));
  const ergebnisse = [];
  for (const b of betroffene) {
    const r = await buchungStornieren(b.id, { erstatten: true, grund: o.grund, absage: true });
    ergebnisse.push({ nummer: b.nummer, ok: r.ok, status: r.status, erstattet: !!r.erstattet, fehler: r.ok ? null : r.error });
  }
  const fehler = ergebnisse.filter((e) => !e.ok);

  await withState((st) => {
    const t = st.termine.find((x) => x.id === terminId);
    if (!t) return { ok: false, status: 404, error: 'Termin nicht gefunden.' };
    // Erst "abgesagt", wenn keine Buchung mehr aktiv ist — sonst bleibt der Termin sichtbar
    // in der Verwaltung mit Fehlerhinweis und kann erneut abgesagt werden.
    if (fehler.length === 0) {
      t.status = 'abgesagt';
      t.abgesagtAm = new Date().toISOString();
      t.absageGrund = o.grund || '';
    }
    protokoll(st, { art: fehler.length ? 'termin-absage-teilweise' : 'termin-abgesagt', text: t.datumIso + ' ' + t.uhrzeit + ': ' + ergebnisse.length + ' Buchung(en), ' + ergebnisse.filter((e) => e.erstattet).length + ' erstattet' + (fehler.length ? ', ' + fehler.length + ' Fehler' : '') + (o.grund ? ' – ' + o.grund : '') });
    return { ok: true };
  });

  return { ok: fehler.length === 0, status: fehler.length ? 207 : 200, abgesagt: fehler.length === 0, buchungen: ergebnisse, error: fehler.length ? fehler.length + ' Buchung(en) konnten nicht storniert werden; Termin bleibt aktiv.' : undefined };
}

module.exports = { buchungStornieren, terminAbsagen, aktiv };
