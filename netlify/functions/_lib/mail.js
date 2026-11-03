// Mailschicht: Versand über Resend (https://resend.com) per HTTP, ohne eigenes SDK.
//
// Betriebsarten:
//   resend             RESEND_API_KEY gesetzt. Absender MAIL_ABSENDER (Domain muss bei Resend
//                      bestätigt sein), Antworten an MAIL_ANTWORT_AN, Kopie an MAIL_KOPIE_AN.
//   attrappe           kein RESEND_API_KEY und NETLIFY_DEV === 'true': jede Mail landet als
//                      Dateien in website/.netlify/mail-ausgang/ (HTML, Text, Anhänge, JSON).
//   nicht-konfiguriert auf Netlify ohne Schlüssel: mailSenden wirft, der Aufrufer protokolliert
//                      "mail-fehlgeschlagen" — die Buchung selbst bleibt davon unberührt.

const fs = require('fs');
const path = require('path');
const { datumLesbar } = require('./zahlung');
const { euro } = require('./rechnung');

function betriebsart() {
  if (process.env.RESEND_API_KEY) return 'resend';
  if (process.env.NETLIFY_DEV === 'true') return 'attrappe';
  return 'nicht-konfiguriert';
}

function absender() {
  return process.env.MAIL_ABSENDER || 'Zeitreise Seelower Höhen <buchung@marschbefehl.com>';
}
function antwortAn() {
  return process.env.MAIL_ANTWORT_AN || 'mail.zsh@proton.me';
}
function kopieAn() {
  return process.env.MAIL_KOPIE_AN || '';
}

function attrappeOrdner() {
  return process.env.MAIL_ATTRAPPE_ORDNER || path.resolve(process.cwd(), '.netlify', 'mail-ausgang');
}

function slug(t) {
  return String(t).toLowerCase().replace(/[äöüß]/g, (c) => ({ ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' }[c])).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

/**
 * @param {{an:string, betreff:string, text:string, html:string, anhaenge?:{dateiname:string, inhalt:Buffer|Uint8Array, typ:string}[], kopie?:boolean}} m
 * @returns {Promise<{id:string, betriebsart:string}>}
 */
async function mailSenden(m) {
  const art = betriebsart();
  const anhaenge = (m.anhaenge || []).map((a) => ({ dateiname: a.dateiname, inhalt: Buffer.from(a.inhalt), typ: a.typ }));

  if (art === 'attrappe') {
    const ordner = attrappeOrdner();
    fs.mkdirSync(ordner, { recursive: true });
    const stempel = new Date().toISOString().replace(/[:.]/g, '-');
    const basis = path.join(ordner, stempel + '_' + slug(m.betreff));
    fs.writeFileSync(basis + '.html', m.html, 'utf8');
    fs.writeFileSync(basis + '.txt', 'An: ' + m.an + '\nVon: ' + absender() + '\nBetreff: ' + m.betreff + '\n\n' + m.text, 'utf8');
    for (const a of anhaenge) fs.writeFileSync(basis + '_' + a.dateiname, a.inhalt);
    fs.writeFileSync(basis + '.json', JSON.stringify({ an: m.an, von: absender(), antwortAn: antwortAn(), kopieAn: m.kopie ? kopieAn() : '', betreff: m.betreff, anhaenge: anhaenge.map((a) => a.dateiname), zeit: new Date().toISOString() }, null, 2));
    return { id: 'attrappe_' + stempel, betriebsart: art };
  }
  if (art !== 'resend') {
    throw new Error('Mailversand ist noch nicht eingerichtet (RESEND_API_KEY fehlt).');
  }

  const body = {
    from: absender(),
    to: [m.an],
    reply_to: antwortAn(),
    subject: m.betreff,
    text: m.text,
    html: m.html,
  };
  if (m.kopie && kopieAn()) body.bcc = [kopieAn()];
  if (anhaenge.length) body.attachments = anhaenge.map((a) => ({ filename: a.dateiname, content: a.inhalt.toString('base64') }));

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const antwort = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('Resend antwortet ' + r.status + ': ' + JSON.stringify(antwort).slice(0, 300));
  return { id: antwort.id || '', betriebsart: art };
}

// ------------------------------------------------------------------ Mailtexte

function htmlRahmen(titel, inhaltHtml) {
  return (
    '<!DOCTYPE html><html lang="de"><body style="margin:0;background:#F7F7F2;font-family:Segoe UI,Arial,sans-serif;color:#1E1E1E;">' +
    '<div style="max-width:600px;margin:0 auto;padding:28px 20px;">' +
    '<div style="font-weight:700;color:#6F8F2E;font-size:18px;margin-bottom:18px;">Zeitreise Seelower Höhen</div>' +
    '<div style="background:#fff;border:1px solid #E3E3DC;border-radius:12px;padding:24px;">' +
    '<h1 style="font-size:20px;margin:0 0 12px;">' + titel + '</h1>' + inhaltHtml + '</div>' +
    '<p style="color:#777;font-size:12px;margin-top:18px;">Antworten auf diese Mail gehen an ' + antwortAn() + '. Impressum und Datenschutz: https://marschbefehl.com/impressum.html</p>' +
    '</div></body></html>'
  );
}

function tabelle(zeilen) {
  return (
    '<table style="border-collapse:collapse;width:100%;margin:14px 0;">' +
    zeilen.map(([k, v]) => '<tr><td style="padding:6px 0;color:#777;width:40%;border-bottom:1px solid #eee;">' + k + '</td><td style="padding:6px 0;font-weight:600;border-bottom:1px solid #eee;">' + v + '</td></tr>').join('') +
    '</table>'
  );
}

function esc(t) {
  return String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function bestaetigungsMail({ buchung, fuehrung, termin, rechnungsnummer }) {
  const wann = datumLesbar(termin.datumIso, termin.uhrzeit);
  const betreff = 'Buchung ' + buchung.nummer + ' bestätigt: ' + fuehrung.titel + ' am ' + wann;
  const daten = [
    ['Buchungsnummer', buchung.nummer],
    ['Führung', fuehrung.titel],
    ['Termin', wann],
    ['Treffpunkt', fuehrung.ort || 'wird noch mitgeteilt'],
    ['Personen', String(buchung.personen)],
    ['Anreise', buchung.fahrzeug === 'eigen' ? 'mit eigenem Fahrzeug (Kolonnenfahrt)' : 'als Mitfahrer'],
    ['Betrag', euro(buchung.betragCent) + ' (bezahlt)'],
    ['Rechnung', rechnungsnummer + ' (im Anhang)'],
  ];
  const hinweise = [
    'Festes Schuhwerk und wetterfeste Kleidung mitbringen, wir sind den ganzen Tag im Gelände.',
    'Die Stationen werden in Kolonnenfahrt mit den eigenen Fahrzeugen angefahren; an jeder Station sammeln wir uns kurz.',
    'Drei Tage vor dem Termin kommt eine Erinnerung mit den letzten Hinweisen.',
    'Stornierung laut Teilnahmebedingungen (https://marschbefehl.com/agb.html). Bei Fragen einfach auf diese Mail antworten.',
  ];
  const text =
    'Hallo ' + buchung.name + ',\n\nvielen Dank, die Buchung ist bestätigt und bezahlt.\n\n' +
    daten.map(([k, v]) => k + ': ' + v).join('\n') +
    '\n\nHinweise:\n' + hinweise.map((h) => '- ' + h).join('\n') +
    '\n\nBis bald im Oderbruch\nEnrico Holland\nZeitreise Seelower Höhen · marschbefehl.com\n';
  const html = htmlRahmen(
    'Buchung bestätigt',
    '<p>Hallo ' + esc(buchung.name) + ',</p><p>vielen Dank, die Buchung ist bestätigt und bezahlt. Die Rechnung hängt als PDF an.</p>' +
      tabelle(daten.map(([k, v]) => [esc(k), esc(v)])) +
      '<p style="font-weight:600;margin-bottom:6px;">Hinweise</p><ul style="padding-left:18px;color:#444;">' + hinweise.map((h) => '<li style="margin-bottom:6px;">' + esc(h) + '</li>').join('') + '</ul>' +
      '<p>Bis bald im Oderbruch<br>Enrico Holland<br>Zeitreise Seelower Höhen · <a href="https://marschbefehl.com" style="color:#6F8F2E;">marschbefehl.com</a></p>'
  );
  return { betreff, text, html };
}

function erinnerungsMail({ buchung, fuehrung, termin }) {
  const wann = datumLesbar(termin.datumIso, termin.uhrzeit);
  const betreff = 'Erinnerung: ' + fuehrung.titel + ' am ' + wann + ' (Buchung ' + buchung.nummer + ')';
  const daten = [
    ['Termin', wann],
    ['Treffpunkt', fuehrung.ort || 'wird noch mitgeteilt'],
    ['Personen', String(buchung.personen)],
    ['Buchungsnummer', buchung.nummer],
  ];
  const hinweise = [
    'Bitte 10 Minuten vor Beginn am Treffpunkt sein, damit die Kolonne pünktlich losfahren kann.',
    'Festes Schuhwerk, wetterfeste Kleidung, etwas zu trinken und eine Kleinigkeit zu essen mitnehmen.',
    'Tank voll und Handy geladen; die Telefonnummer aus der Buchung ist für kurzfristige Rückfragen hinterlegt.',
    'Bei Unwetter oder Sperrungen melden wir uns spätestens am Vorabend per Mail und Telefon.',
  ];
  const text =
    'Hallo ' + buchung.name + ',\n\nin drei Tagen ist es so weit. Hier die letzten Hinweise:\n\n' +
    daten.map(([k, v]) => k + ': ' + v).join('\n') +
    '\n\n' + hinweise.map((h) => '- ' + h).join('\n') +
    '\n\nBis bald im Oderbruch\nEnrico Holland\nZeitreise Seelower Höhen · marschbefehl.com\n';
  const html = htmlRahmen(
    'In drei Tagen geht es los',
    '<p>Hallo ' + esc(buchung.name) + ',</p><p>in drei Tagen ist es so weit. Hier die letzten Hinweise:</p>' +
      tabelle(daten.map(([k, v]) => [esc(k), esc(v)])) +
      '<ul style="padding-left:18px;color:#444;">' + hinweise.map((h) => '<li style="margin-bottom:6px;">' + esc(h) + '</li>').join('') + '</ul>' +
      '<p>Bis bald im Oderbruch<br>Enrico Holland<br>Zeitreise Seelower Höhen · <a href="https://marschbefehl.com" style="color:#6F8F2E;">marschbefehl.com</a></p>'
  );
  return { betreff, text, html };
}

function neueBuchungMail({ buchung, fuehrung, termin }) {
  const wann = datumLesbar(termin.datumIso, termin.uhrzeit);
  const betreff = 'Neue Buchung ' + buchung.nummer + ': ' + buchung.personen + ' Pers. für ' + wann;
  const text = buchung.nummer + '\n' + fuehrung.titel + ' am ' + wann + '\n' + buchung.name + ' · ' + buchung.email + ' · ' + buchung.telefon + '\n' + buchung.personen + ' Pers., ' + (buchung.fahrzeug === 'eigen' ? 'eigenes Kfz' : 'Mitfahrer') + ', ' + euro(buchung.betragCent) + ' bezahlt\nVerwaltung: https://marschbefehl.com/fuehrungen-verwaltung.html\n';
  const html = htmlRahmen('Neue Buchung', '<pre style="white-space:pre-wrap;font:inherit;">' + esc(text) + '</pre>');
  return { betreff, text, html };
}

function stornoMail({ buchung, fuehrung, termin, grund, erstattet }) {
  const wann = termin ? datumLesbar(termin.datumIso, termin.uhrzeit) : '';
  const betreff = 'Buchung ' + buchung.nummer + ' storniert' + (erstattet ? ', Betrag wird erstattet' : '');
  const geld = erstattet
    ? 'Der Betrag von ' + euro(buchung.betragCent) + ' wird über den Zahlungsanbieter erstattet und erscheint je nach Bank innerhalb von 5 bis 10 Werktagen auf dem Konto bzw. der Karte, mit der bezahlt wurde.'
    : (buchung.status === 'storniert' && buchung.bezahltAm ? 'Eine Erstattung erfolgt laut Teilnahmebedingungen nicht.' : 'Es war noch keine Zahlung eingegangen, es ist nichts zu erstatten.');
  const text = 'Hallo ' + buchung.name + ',\n\ndie Buchung ' + buchung.nummer + (fuehrung ? ' für "' + fuehrung.titel + '"' : '') + (wann ? ' am ' + wann : '') + ' wurde storniert.' + (grund ? '\nGrund: ' + grund : '') + '\n\n' + geld + '\n\nBei Fragen einfach auf diese Mail antworten.\n\nViele Grüße\nEnrico Holland\nZeitreise Seelower Höhen · marschbefehl.com\n';
  const html = htmlRahmen('Buchung storniert', '<p>Hallo ' + esc(buchung.name) + ',</p><p>die Buchung <strong>' + esc(buchung.nummer) + '</strong>' + (fuehrung ? ' für „' + esc(fuehrung.titel) + '“' : '') + (wann ? ' am ' + esc(wann) : '') + ' wurde storniert.' + (grund ? '<br>Grund: ' + esc(grund) : '') + '</p><p>' + esc(geld) + '</p><p>Bei Fragen einfach auf diese Mail antworten.</p><p>Viele Grüße<br>Enrico Holland<br>Zeitreise Seelower Höhen · <a href="https://marschbefehl.com" style="color:#6F8F2E;">marschbefehl.com</a></p>');
  return { betreff, text, html };
}

function absageMail({ buchung, fuehrung, termin, grund, erstattet }) {
  const wann = termin ? datumLesbar(termin.datumIso, termin.uhrzeit) : '';
  const betreff = 'Termin abgesagt: ' + (fuehrung ? fuehrung.titel : 'Führung') + (wann ? ' am ' + wann : '') + ' (Buchung ' + buchung.nummer + ')';
  const geld = erstattet
    ? 'Der volle Betrag von ' + euro(buchung.betragCent) + ' wird automatisch erstattet und erscheint je nach Bank innerhalb von 5 bis 10 Werktagen auf dem Konto bzw. der Karte, mit der bezahlt wurde.'
    : 'Es war noch keine Zahlung eingegangen, es ist nichts zu erstatten.';
  const text = 'Hallo ' + buchung.name + ',\n\nleider muss die Führung' + (fuehrung ? ' "' + fuehrung.titel + '"' : '') + (wann ? ' am ' + wann : '') + ' abgesagt werden.' + (grund ? '\nGrund: ' + grund : '') + '\n\n' + geld + '\n\nNeue Termine stehen auf https://marschbefehl.com/fuehrungen.html. Es tut mir leid für die Umstände.\n\nViele Grüße\nEnrico Holland\nZeitreise Seelower Höhen · marschbefehl.com\n';
  const html = htmlRahmen('Termin abgesagt', '<p>Hallo ' + esc(buchung.name) + ',</p><p>leider muss die Führung' + (fuehrung ? ' „' + esc(fuehrung.titel) + '“' : '') + (wann ? ' am <strong>' + esc(wann) + '</strong>' : '') + ' abgesagt werden.' + (grund ? '<br>Grund: ' + esc(grund) : '') + '</p><p>' + esc(geld) + '</p><p>Neue Termine stehen auf <a href="https://marschbefehl.com/fuehrungen.html" style="color:#6F8F2E;">marschbefehl.com/fuehrungen</a>. Es tut mir leid für die Umstände.</p><p>Viele Grüße<br>Enrico Holland<br>Zeitreise Seelower Höhen</p>');
  return { betreff, text, html };
}

function abgleichMail(e) {
  const betreff = 'Abgleich Buchungen: ' + e.abweichungen.length + ' Abweichung(en) – ' + e.note;
  const zeilen = e.abweichungen.map((a) => '- ' + a.art + ' | Buchung ' + (a.nummer || '–') + ' | Sitzung ' + a.sessionId + ' | Stripe ' + (a.betragStripe != null ? euro(a.betragStripe) : '–') + ' | Buchung ' + (a.betragBuchung != null ? euro(a.betragBuchung) : '–') + '\n  TO-DO: ' + a.todo);
  const text = 'Abgleich vom ' + new Date(e.zeit).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' }) + ' (' + e.geprueft.zahlungen + ' Zahlungen, ' + e.geprueft.buchungen + ' Buchungen, letzte ' + e.zeitraumTage + ' Tage)\nNote: ' + e.note + ' – ' + e.noteText + '\n\n' + zeilen.join('\n') + '\n\nVerwaltung: https://marschbefehl.com/fuehrungen-verwaltung.html (Abschnitt Abgleich)\n';
  const html = htmlRahmen('Abgleich: ' + esc(e.note), '<pre style="white-space:pre-wrap;font:inherit;">' + esc(text) + '</pre>');
  return { betreff, text, html };
}

module.exports = { betriebsart, mailSenden, bestaetigungsMail, erinnerungsMail, neueBuchungMail, stornoMail, absageMail, abgleichMail, absender, antwortAn, kopieAn, attrappeOrdner };
