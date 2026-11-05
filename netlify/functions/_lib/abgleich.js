// Täglicher Abgleich: Zahlungen beim Zahlungsanbieter gegen die eigene Buchungsliste (E5).
//
// Prüft in beide Richtungen und sammelt Abweichungen mit Note und TO-DO:
//   zahlung-ohne-buchung      Stripe hat Geld, wir keine passende Buchung
//   zahlung-buchung-unbezahlt Stripe hat Geld, Buchung steht nicht auf bezahlt (Webhook verpasst?)
//   buchung-ohne-zahlung      Buchung bezahlt, bei Stripe keine bezahlte Sitzung
//   betrag-abweichung         Beträge stimmen nicht überein
//   erstattung-fehlt          Buchung erstattet, Stripe kennt keine Erstattung
//   stripe-erstattet          Stripe hat erstattet, Buchung steht noch auf bezahlt
//
// Ergebnis liegt in state.abgleich (für die Verwaltung); bei Abweichungen geht eine Mail an
// MAIL_KOPIE_AN (ersatzweise MAIL_ANTWORT_AN).

const { withState, readState, protokoll } = require('./store');
const { zahlungenAbrufen, betriebsart } = require('./zahlung');
const { mailSenden, abgleichMail, kopieAn, antwortAn } = require('./mail');

const ZEITRAUM_TAGE = 35;

const TODO = {
  'zahlung-ohne-buchung': 'Im Stripe-Dashboard prüfen, wer gezahlt hat; ohne Buchung den Betrag erstatten oder die Buchung von Hand anlegen.',
  'zahlung-buchung-unbezahlt': 'Webhook-Zustellung bei Stripe prüfen (Developers → Webhooks); Buchung in der Verwaltung auf bezahlt setzen und Bestätigung senden.',
  'buchung-ohne-zahlung': 'Bei Stripe nach der Sitzung suchen; fehlt die Zahlung wirklich, Buchung stornieren (ohne Erstattung) und den Gast anschreiben.',
  'betrag-abweichung': 'Betrag bei Stripe mit dem Buchungsbetrag vergleichen; Differenz erstatten oder nachfordern, danach Status in der Verwaltung korrigieren.',
  'erstattung-fehlt': 'Erstattung im Stripe-Dashboard manuell auslösen (Zahlung → Erstatten), Erstattungs-ID im Protokoll vermerken.',
  'stripe-erstattet': 'Buchung in der Verwaltung stornieren (ohne erneute Erstattung), Gast informieren.',
};

function note(anzahl) {
  if (anzahl === 0) return { note: 'sehr gut', text: 'Alles stimmt überein.' };
  if (anzahl <= 2) return { note: 'prüfen', text: anzahl + ' Abweichung(en), bitte zeitnah ansehen.' };
  return { note: 'schlecht', text: anzahl + ' Abweichungen, bitte heute klären.' };
}

async function abgleichDurchfuehren() {
  const seit = new Date(Date.now() - ZEITRAUM_TAGE * 24 * 60 * 60 * 1000);
  const state = await readState();
  const art = betriebsart();
  if (art === 'nicht-konfiguriert') {
    return { ok: false, error: 'Zahlung nicht eingerichtet (STRIPE_SECRET_KEY fehlt), Abgleich nicht möglich.' };
  }
  const zahlungen = await zahlungenAbrufen({ seit });
  const buchungen = state.buchungen.filter((b) => b.stripeSessionId && new Date(b.erstelltAm) >= seit);
  const abw = [];
  const jeSitzung = new Map(zahlungen.map((z) => [z.sessionId, z]));
  const jeBuchungSitzung = new Map(buchungen.map((b) => [b.stripeSessionId, b]));

  for (const z of zahlungen) {
    if (!z.bezahlt) continue;
    const b = jeBuchungSitzung.get(z.sessionId);
    if (!b) {
      abw.push({ art: 'zahlung-ohne-buchung', sessionId: z.sessionId, nummer: z.nummer || '', betragStripe: z.betragCent, betragBuchung: null, email: z.email || '' });
      continue;
    }
    const s = b.status || 'bezahlt';
    if (z.erstattetCent >= z.betragCent && z.betragCent > 0) {
      if (s !== 'erstattet') abw.push({ art: 'stripe-erstattet', sessionId: z.sessionId, nummer: b.nummer, betragStripe: z.betragCent, betragBuchung: b.betragCent });
      continue;
    }
    if (s === 'reserviert' || s === 'abgelaufen' || s === 'storniert') {
      abw.push({ art: 'zahlung-buchung-unbezahlt', sessionId: z.sessionId, nummer: b.nummer, betragStripe: z.betragCent, betragBuchung: b.betragCent, statusBuchung: s });
      continue;
    }
    if (s === 'erstattet' && z.erstattetCent < z.betragCent) {
      abw.push({ art: 'erstattung-fehlt', sessionId: z.sessionId, nummer: b.nummer, betragStripe: z.betragCent, betragBuchung: b.betragCent });
      continue;
    }
    if ((s === 'bezahlt' || s === 'pruefen') && z.betragCent !== b.betragCent) {
      abw.push({ art: 'betrag-abweichung', sessionId: z.sessionId, nummer: b.nummer, betragStripe: z.betragCent, betragBuchung: b.betragCent });
    }
  }
  for (const b of buchungen) {
    const s = b.status || 'bezahlt';
    if (s !== 'bezahlt' && s !== 'pruefen' && s !== 'erstattet') continue;
    const z = jeSitzung.get(b.stripeSessionId);
    if (!z || !z.bezahlt) {
      abw.push({ art: 'buchung-ohne-zahlung', sessionId: b.stripeSessionId, nummer: b.nummer, betragStripe: z ? z.betragCent : null, betragBuchung: b.betragCent, statusBuchung: s });
    }
  }

  const bewertung = note(abw.length);
  const ergebnis = {
    zeit: new Date().toISOString(),
    betriebsart: art,
    zeitraumTage: ZEITRAUM_TAGE,
    geprueft: { zahlungen: zahlungen.length, buchungen: buchungen.length },
    note: bewertung.note,
    noteText: bewertung.text,
    abweichungen: abw.map((a) => ({ ...a, todo: TODO[a.art] || '' })),
  };

  await withState((st) => {
    st.abgleich = ergebnis;
    protokoll(st, { art: 'abgleich', text: zahlungen.length + ' Zahlungen, ' + buchungen.length + ' Buchungen, ' + abw.length + ' Abweichung(en) – ' + bewertung.note });
    return { ok: true };
  });

  if (abw.length > 0) {
    const an = kopieAn() || antwortAn();
    try {
      const m = abgleichMail(ergebnis);
      await mailSenden({ an, betreff: m.betreff, text: m.text, html: m.html });
    } catch (err) {
      console.error('abgleich: Mail fehlgeschlagen:', err.message);
    }
  }
  return { ok: true, ...ergebnis };
}

module.exports = { abgleichDurchfuehren, TODO };
