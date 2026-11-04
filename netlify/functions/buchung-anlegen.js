// Öffentliche Function: legt eine Buchung an und leitet zur Bezahlseite weiter.
//
// Ablauf (E2, 03.11.2026):
//   1. Eingaben prüfen (Name, E-Mail, Telefon, Personen, Fahrzeug, AGB-Haken, Honigtopf).
//   2. Atomar über withState(): Termin vorhanden und in der Zukunft, genug freie Plätze
//      (bezahlte + laufende Reservierungen zählen), Buchung als "reserviert" mit Ablauf
//      in 15 Minuten anlegen. Betrag wird HIER aus dem Führungspreis berechnet, nie aus
//      dem Browser übernommen.
//   3. Bezahlsitzung anlegen (Stripe Checkout, lokal Attrappe) und die Sitzungs-ID an der
//      Buchung speichern. Schlägt das fehl, wird die Reservierung sofort wieder freigegeben.
//   4. Antwort: { ok, nummer, url } — der Browser leitet auf url weiter.
//
// Bremse: je IP höchstens 10 Buchungsversuche pro Stunde (im Speicher der Function-
// Instanz; auf Netlify je Instanz, also nur eine erste Hürde, keine harte Grenze).

const {
  withState,
  terminDatumZeit,
  findFuehrung,
  belegtePersonen,
  neueId,
  neueBuchungsnummer,
  protokoll,
  verfuegbarkeitsStatus,
  blobsVerbinden,
  RESERVIERUNG_MINUTEN,
} = require('./_lib/store');
const { checkoutAnlegen, betriebsart } = require('./_lib/zahlung');
const { json, errorResponse, parseBody, isNichtLeererText, istGueltigeEmail, istGanzzahlInBereich } = require('./_lib/http');

// Grenze über BUCHUNG_BREMSE_JE_STUNDE anpassbar (lokal für Prüfläufe hochsetzen).
const MAX_VERSUCHE_JE_STUNDE = Number(process.env.BUCHUNG_BREMSE_JE_STUNDE) > 0 ? Number(process.env.BUCHUNG_BREMSE_JE_STUNDE) : 10;
const versuche = new Map(); // ip -> [zeitstempel]

function bremseGreift(ip) {
  const jetzt = Date.now();
  const liste = (versuche.get(ip) || []).filter((t) => jetzt - t < 60 * 60 * 1000);
  liste.push(jetzt);
  versuche.set(ip, liste);
  return liste.length > MAX_VERSUCHE_JE_STUNDE;
}

function clientIp(event) {
  const h = event.headers || {};
  return h['x-nf-client-connection-ip'] || (h['x-forwarded-for'] || '').split(',')[0].trim() || 'unbekannt';
}

const TELEFON_RE = /^[0-9+\s\/()-]{6,30}$/;

exports.handler = async (event) => {
  blobsVerbinden(event);
  if (event.httpMethod !== 'POST') return errorResponse(405, 'Nur POST erlaubt.');

  if (betriebsart() === 'nicht-konfiguriert') {
    return errorResponse(503, 'Die Online-Zahlung ist noch nicht freigeschaltet. Bitte über Kontakt anfragen.');
  }

  const body = parseBody(event);
  if (body === null) return errorResponse(400, 'Ungültige Anfrage.');

  // Honigtopf: echte Gäste füllen dieses unsichtbare Feld nie aus.
  if (typeof body.firma === 'string' && body.firma.trim() !== '') {
    return json(200, { ok: true, nummer: 'ZSH-0000-0000', url: '/fuehrungen.html' });
  }

  if (bremseGreift(clientIp(event))) {
    return errorResponse(429, 'Zu viele Buchungsversuche. Bitte in einer Stunde erneut versuchen.');
  }

  const terminId = typeof body.terminId === 'string' ? body.terminId.trim() : '';
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const telefon = typeof body.telefon === 'string' ? body.telefon.trim() : '';
  const fahrzeug = body.fahrzeug === 'mitfahrer' ? 'mitfahrer' : body.fahrzeug === 'eigen' ? 'eigen' : '';
  const personen = Number(body.personen);
  const agb = body.agb === true;

  if (!terminId) return errorResponse(400, 'Kein Termin angegeben.');
  if (!isNichtLeererText(name, 120)) return errorResponse(400, 'Bitte einen Namen angeben.');
  if (!istGueltigeEmail(email)) return errorResponse(400, 'Bitte eine gültige E-Mail-Adresse angeben.');
  if (!TELEFON_RE.test(telefon)) return errorResponse(400, 'Bitte eine Telefonnummer angeben (für Rückfragen am Tourtag).');
  if (!istGanzzahlInBereich(personen, 1, 30)) return errorResponse(400, 'Bitte eine Personenzahl zwischen 1 und 30 angeben.');
  if (!fahrzeug) return errorResponse(400, 'Bitte angeben, ob ein eigenes Fahrzeug dabei ist.');
  if (!agb) return errorResponse(400, 'Bitte die Teilnahmebedingungen bestätigen.');

  let angelegt;
  try {
    angelegt = await withState((state) => {
      const termin = state.termine.find((t) => t.id === terminId);
      if (!termin) return { ok: false, status: 404, error: 'Dieser Termin existiert nicht mehr.' };
      if (termin.status === 'abgesagt') return { ok: false, status: 400, error: 'Dieser Termin wurde abgesagt.' };
      if (terminDatumZeit(termin).getTime() < Date.now()) {
        return { ok: false, status: 400, error: 'Dieser Termin liegt bereits in der Vergangenheit.' };
      }
      const fuehrung = findFuehrung(state, termin.fuehrungId);
      if (!fuehrung || typeof fuehrung.preisProPerson !== 'number') {
        return { ok: false, status: 500, error: 'Zu diesem Termin fehlt der Preis. Bitte über Kontakt anfragen.' };
      }

      const belegt = belegtePersonen(state, terminId);
      const frei = termin.maxPersonen - belegt;
      if (personen > frei) {
        return {
          ok: false,
          status: 409,
          error:
            frei <= 0
              ? 'Dieser Termin ist inzwischen ausgebucht.'
              : 'Für diese Personenzahl sind nicht mehr genug Plätze frei — bitte weniger Personen angeben oder einen anderen Termin wählen.',
        };
      }

      const preisCentProPerson = Math.round(fuehrung.preisProPerson * 100);
      const jetzt = new Date();
      const buchung = {
        id: neueId(),
        nummer: neueBuchungsnummer(state, jetzt),
        terminId,
        fuehrungId: fuehrung.id,
        name,
        email,
        telefon,
        personen,
        fahrzeug,
        preisCentProPerson,
        betragCent: preisCentProPerson * personen,
        status: 'reserviert',
        reserviertBis: new Date(jetzt.getTime() + RESERVIERUNG_MINUTEN * 60 * 1000).toISOString(),
        stripeSessionId: null,
        stripePaymentIntent: null,
        bezahltAm: null,
        erstelltAm: jetzt.toISOString(),
      };
      state.buchungen.push(buchung);
      protokoll(state, { art: 'buchung-reserviert', buchungId: buchung.id, nummer: buchung.nummer, text: `${personen} Pers., ${buchung.betragCent / 100} €` });

      return {
        ok: true,
        buchung,
        fuehrung: { id: fuehrung.id, titel: fuehrung.titel },
        termin: { datumIso: termin.datumIso, uhrzeit: termin.uhrzeit },
        verfuegbarkeitDanach: verfuegbarkeitsStatus(frei - personen, termin.maxPersonen),
      };
    }, {
      // Erst zufrieden, wenn die eigene Buchung im frisch gelesenen Stand steht.
      bestaetigen: (state, result) => state.buchungen.some((b) => b.id === result.buchung.id),
    });
  } catch (err) {
    console.error('buchung-anlegen Fehler (Speicher):', err);
    return errorResponse(500, 'Buchung konnte nicht gespeichert werden. Bitte später erneut versuchen.');
  }
  if (!angelegt.ok) return errorResponse(angelegt.status || 400, angelegt.error);

  const { buchung, fuehrung, termin } = angelegt;

  let sitzung;
  try {
    sitzung = await checkoutAnlegen({ buchung, fuehrung, termin, event });
  } catch (err) {
    console.error('buchung-anlegen Fehler (Bezahlsitzung):', err);
    // Reservierung sofort wieder freigeben, damit kein Platz hängen bleibt.
    try {
      await withState((state) => {
        const b = state.buchungen.find((x) => x.id === buchung.id);
        if (b && b.status === 'reserviert') b.status = 'abgelaufen';
        protokoll(state, { art: 'bezahlsitzung-fehlgeschlagen', buchungId: buchung.id, nummer: buchung.nummer, text: String(err && err.message) });
        return { ok: true };
      });
    } catch (e2) {
      console.error('buchung-anlegen: Freigabe nach Fehler misslungen:', e2);
    }
    return errorResponse(502, 'Die Bezahlseite konnte nicht geöffnet werden. Bitte später erneut versuchen.');
  }

  try {
    await withState((state) => {
      const b = state.buchungen.find((x) => x.id === buchung.id);
      if (!b) return { ok: false, status: 500, error: 'Buchung verschwunden.' };
      b.stripeSessionId = sitzung.sessionId;
      b.stripeCustomerId = sitzung.stripeCustomerId || null;
      b.zahlungsart = sitzung.betriebsart;
      protokoll(state, { art: 'bezahlsitzung-angelegt', buchungId: b.id, nummer: b.nummer, text: sitzung.sessionId + (sitzung.zahlungsarten ? ' [' + sitzung.zahlungsarten.join(',') + ']' : '') });
      if (sitzung.zahlungsartenHinweis) protokoll(state, { art: 'zahlungsarten-rueckfall', buchungId: b.id, nummer: b.nummer, text: sitzung.zahlungsartenHinweis });
      return { ok: true };
    });
  } catch (err) {
    console.error('buchung-anlegen Fehler (Sitzung speichern):', err);
    return errorResponse(500, 'Buchung konnte nicht gespeichert werden. Bitte später erneut versuchen.');
  }

  return json(200, { ok: true, nummer: buchung.nummer, url: sitzung.url, reserviertBis: buchung.reserviertBis, zahlungsarten: sitzung.zahlungsarten || null });
};
