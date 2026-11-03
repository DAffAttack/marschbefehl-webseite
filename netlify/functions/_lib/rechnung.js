// Rechnungs-PDF für eine bezahlte Buchung (Kleinbetragsrechnung, Kleinunternehmer § 19 UStG).
// Erzeugt mit pdf-lib, ohne externe Dienste. Absenderdaten kommen aus Umgebungsvariablen,
// Vorgabe sind die Angaben aus dem Impressum.

const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { datumLesbar } = require('./zahlung');

function absender() {
  return {
    name: process.env.RECHNUNG_ABSENDER_NAME || 'Enrico Holland',
    marke: process.env.RECHNUNG_ABSENDER_MARKE || 'Zeitreise Seelower Höhen',
    strasse: process.env.RECHNUNG_ABSENDER_STRASSE || 'Breite Straße 36',
    ort: process.env.RECHNUNG_ABSENDER_ORT || '15306 Seelow',
    email: process.env.RECHNUNG_ABSENDER_EMAIL || process.env.MAIL_ANTWORT_AN || 'mail.zsh@proton.me',
    web: 'marschbefehl.com',
    steuernummer: process.env.RECHNUNG_STEUERNUMMER || '', // leer, bis die Steuernummer da ist
  };
}

function euro(cent) {
  return (cent / 100).toFixed(2).replace('.', ',') + ' €';
}

function datumDe(iso) {
  const d = iso ? new Date(iso) : new Date();
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Berlin' });
}

// Zeilenumbruch nach Breite (pdf-lib hat keinen eigenen).
function umbrechen(font, text, groesse, breite) {
  const zeilen = [];
  for (const absatz of String(text).split('\n')) {
    let zeile = '';
    for (const wort of absatz.split(' ')) {
      const probe = zeile ? zeile + ' ' + wort : wort;
      if (font.widthOfTextAtSize(probe, groesse) > breite && zeile) {
        zeilen.push(zeile);
        zeile = wort;
      } else {
        zeile = probe;
      }
    }
    zeilen.push(zeile);
  }
  return zeilen;
}

/**
 * @returns {Promise<Uint8Array>} PDF-Bytes
 */
async function rechnungPdf({ rechnungsnummer, rechnungsdatum, buchung, fuehrung, termin }) {
  const A = absender();
  const doc = await PDFDocument.create();
  doc.setTitle('Rechnung ' + rechnungsnummer);
  doc.setAuthor(A.marke);
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const fett = await doc.embedFont(StandardFonts.HelveticaBold);
  const seite = doc.addPage([595.28, 841.89]); // A4
  const rand = 56;
  const breite = 595.28 - 2 * rand;
  const grau = rgb(0.4, 0.4, 0.4);
  const gruen = rgb(0.435, 0.561, 0.18);
  let y = 841.89 - rand;

  const zeichne = (text, x, yy, opt = {}) =>
    seite.drawText(String(text), { x, y: yy, size: opt.size || 10, font: opt.fett ? fett : normal, color: opt.farbe || rgb(0.12, 0.12, 0.12) });

  // Kopf: Marke links, Absender rechts
  zeichne(A.marke, rand, y - 14, { size: 16, fett: true, farbe: gruen });
  zeichne('Führungen zu den Schauplätzen der Schlacht um die Seelower Höhen', rand, y - 30, { size: 9, farbe: grau });
  const absZeilen = [A.name, A.strasse, A.ort, A.email, A.web].concat(A.steuernummer ? ['Steuernummer ' + A.steuernummer] : []);
  absZeilen.forEach((z, i) => {
    const w = normal.widthOfTextAtSize(z, 9);
    zeichne(z, 595.28 - rand - w, y - 14 - i * 12, { size: 9, farbe: grau });
  });
  y -= 110;

  // Empfänger
  zeichne('Rechnung an', rand, y, { size: 8, farbe: grau });
  y -= 14;
  zeichne(buchung.name, rand, y, { size: 11, fett: true });
  y -= 14;
  zeichne(buchung.email, rand, y, { size: 10 });
  y -= 36;

  // Titel + Eckdaten
  zeichne('Rechnung', rand, y, { size: 20, fett: true });
  const eck = [
    ['Rechnungsnummer', rechnungsnummer],
    ['Rechnungsdatum', datumDe(rechnungsdatum)],
    ['Buchungsnummer', buchung.nummer],
    ['Leistungsdatum', datumLesbar(termin.datumIso, termin.uhrzeit)],
  ];
  eck.forEach(([k, v], i) => {
    const yy = y + 8 - i * 13;
    zeichne(k, 330, yy, { size: 9, farbe: grau });
    const w = normal.widthOfTextAtSize(v, 9);
    zeichne(v, 595.28 - rand - w, yy, { size: 9 });
  });
  y -= 70;

  // Tabelle
  const spalten = { pos: rand, anz: 380, einzel: 440, betrag: 595.28 - rand };
  seite.drawLine({ start: { x: rand, y: y + 4 }, end: { x: 595.28 - rand, y: y + 4 }, thickness: 0.8, color: gruen });
  y -= 10;
  zeichne('Leistung', spalten.pos, y, { size: 9, fett: true });
  zeichne('Anzahl', spalten.anz, y, { size: 9, fett: true });
  zeichne('Einzelpreis', spalten.einzel, y, { size: 9, fett: true });
  const wB = fett.widthOfTextAtSize('Betrag', 9);
  zeichne('Betrag', spalten.betrag - wB, y, { size: 9, fett: true });
  y -= 6;
  seite.drawLine({ start: { x: rand, y }, end: { x: 595.28 - rand, y }, thickness: 0.4, color: grau });
  y -= 16;

  const leistung = 'Geführte Tour "' + fuehrung.titel + '" am ' + datumLesbar(termin.datumIso, termin.uhrzeit) + (fuehrung.ort ? ', Treffpunkt ' + fuehrung.ort : '');
  const zeilen = umbrechen(normal, leistung, 10, spalten.anz - rand - 12);
  zeilen.forEach((z, i) => zeichne(z, spalten.pos, y - i * 13, { size: 10 }));
  zeichne(String(buchung.personen) + ' Pers.', spalten.anz, y, { size: 10 });
  zeichne(euro(buchung.preisCentProPerson), spalten.einzel, y, { size: 10 });
  const betragText = euro(buchung.betragCent);
  zeichne(betragText, spalten.betrag - normal.widthOfTextAtSize(betragText, 10), y, { size: 10 });
  y -= 13 * zeilen.length + 10;
  seite.drawLine({ start: { x: rand, y }, end: { x: 595.28 - rand, y }, thickness: 0.4, color: grau });
  y -= 20;

  // Summe
  zeichne('Gesamtbetrag', spalten.einzel - 40, y, { size: 12, fett: true });
  zeichne(betragText, spalten.betrag - fett.widthOfTextAtSize(betragText, 12), y, { size: 12, fett: true });
  y -= 30;

  // Hinweise
  const hinweise = [
    'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet (Kleinunternehmerregelung).',
    'Der Betrag wurde am ' + datumDe(buchung.bezahltAm) + ' über den Zahlungsanbieter Stripe bezahlt. Es ist keine Zahlung mehr offen.',
    'Diese Rechnung wurde maschinell erstellt und ist ohne Unterschrift gültig.',
  ];
  for (const h of hinweise) {
    for (const z of umbrechen(normal, h, 9, breite)) {
      zeichne(z, rand, y, { size: 9, farbe: grau });
      y -= 12;
    }
    y -= 4;
  }
  y -= 20;

  // Treffpunkt / Dank
  zeichne('Vielen Dank für die Buchung. Wir freuen uns auf die gemeinsame Tour.', rand, y, { size: 10 });
  y -= 14;
  if (fuehrung.ort) {
    for (const z of umbrechen(normal, 'Treffpunkt: ' + fuehrung.ort + ' · Beginn ' + termin.uhrzeit + ' Uhr', 10, breite)) {
      zeichne(z, rand, y, { size: 10 });
      y -= 13;
    }
  }

  // Fußzeile
  const fuss = A.name + ' · ' + A.strasse + ' · ' + A.ort + ' · ' + A.email + ' · ' + A.web;
  const wF = normal.widthOfTextAtSize(fuss, 8);
  zeichne(fuss, (595.28 - wF) / 2, 40, { size: 8, farbe: grau });

  return doc.save();
}

module.exports = { rechnungPdf, absender, euro, datumDe };
