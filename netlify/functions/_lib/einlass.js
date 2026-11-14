// Einlass am Treffpunkt (14.11.2026): Jede bezahlte Buchung bekommt einen zufälligen
// Einlass-Code. Er steckt im QR-Code der Bestätigungs- und Erinnerungsmail und im
// Ticket-PDF. Am Treffpunkt scannt der Tourleiter ihn mit einlass.html (auch offline).
//
// QR-Inhalt: https://marschbefehl.com/einlass.html#ZSH-2026-0002.K7PX3MQA
//   - Scannt der Tourleiter mit der Handy-Kamera statt mit der Seite, öffnet sich direkt
//     die Einlass-Seite mit dem Code (der Teil nach # geht nie an den Server).
//   - Der Code ist zufällig (8 Zeichen, 32^8 Möglichkeiten) und wird gegen die gespeicherte
//     Liste geprüft; Raten oder Nachbauen aus der Buchungsnummer geht nicht.

const crypto = require('crypto');
const zlib = require('zlib');
const { encode } = require('uqr');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { datumLesbar } = require('./zahlung');
const { treffpunktVon, umbrechen } = require('./rechnung');

const ZEICHEN = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // ohne 0/O, 1/I
const CODE_RE = /(ZSH-\d{4}-\d{4})\.([A-Z2-9]{8})/;
// Buchungen, die am Treffpunkt eine Rolle spielen (bezahlt oder Geld da/unterwegs).
const EINLASS_STATUS = ['bezahlt', 'pruefen', 'wartet-ueberweisung'];

function neuerEinlassCode() {
  const bytes = crypto.randomBytes(8);
  let s = '';
  for (let i = 0; i < 8; i++) s += ZEICHEN[bytes[i] % 32];
  return s;
}

/** Vergibt einen Code, falls die Buchung noch keinen hat. true = geändert. */
function codeSicherstellen(b) {
  if (b && !b.einlassCode) {
    b.einlassCode = neuerEinlassCode();
    return true;
  }
  return false;
}

function einlassText(b) {
  return 'https://marschbefehl.com/einlass.html#' + b.nummer + '.' + b.einlassCode;
}

function codeLesen(text) {
  const m = CODE_RE.exec(String(text || ''));
  return m ? { nummer: m[1], code: m[2] } : null;
}

// ---------------------------------------------------------------- QR als PNG

function qrMatrix(text) {
  return encode(text, { ecc: 'M', border: 4 }).data; // boolean[][]
}

const CRC_TABELLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABELLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngStueck(typ, daten) {
  const laenge = Buffer.alloc(4);
  laenge.writeUInt32BE(daten.length);
  const td = Buffer.concat([Buffer.from(typ, 'ascii'), daten]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([laenge, td, crc]);
}

/** Schwarz-weißes PNG (Graustufen 8 Bit) des QR-Codes, `skala` Pixel je Modul. */
function qrPng(text, skala) {
  const m = qrMatrix(text);
  const s = skala || 8;
  const n = m.length;
  const breite = n * s;
  const roh = Buffer.alloc((breite + 1) * breite);
  for (let y = 0; y < breite; y++) {
    const zeile = m[Math.floor(y / s)];
    const o = y * (breite + 1);
    roh[o] = 0; // Filter: keiner
    for (let x = 0; x < breite; x++) roh[o + 1 + x] = zeile[Math.floor(x / s)] ? 0 : 255;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(breite, 0);
  ihdr.writeUInt32BE(breite, 4);
  ihdr[8] = 8; // Bittiefe
  ihdr[9] = 0; // Graustufen
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngStueck('IHDR', ihdr),
    pngStueck('IDAT', zlib.deflateSync(roh, { level: 9 })),
    pngStueck('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- Ticket-PDF

/** A4-Ticket mit großem QR-Code, für Handy oder Ausdruck. */
async function ticketPdf({ buchung, fuehrung, termin }) {
  const doc = await PDFDocument.create();
  doc.setTitle('Ticket ' + buchung.nummer);
  doc.setAuthor('Zeitreise Seelower Höhen');
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const fett = await doc.embedFont(StandardFonts.HelveticaBold);
  const B = 595.28;
  const H = 841.89;
  const seite = doc.addPage([B, H]);
  const gruen = rgb(0.435, 0.561, 0.18);
  const grau = rgb(0.4, 0.4, 0.4);
  const dunkel = rgb(0.1, 0.1, 0.1);
  const mitte = (t, y, size, font, farbe) => seite.drawText(t, { x: (B - font.widthOfTextAtSize(t, size)) / 2, y, size, font, color: farbe || dunkel });

  mitte('Zeitreise Seelower Höhen', H - 70, 14, fett, gruen);
  mitte('Ticket', H - 110, 30, fett);
  const titelZeilen = umbrechen(fett, fuehrung.titel, 15, B - 140);
  let y = H - 145;
  for (const z of titelZeilen) { mitte(z, y, 15, fett); y -= 20; }
  mitte(datumLesbar(termin.datumIso, termin.uhrzeit), y - 4, 12, normal, grau);

  // QR-Code (Module als Rechtecke, ohne Bild)
  const m = qrMatrix(einlassText(buchung));
  const groesse = 300;
  const modul = groesse / m.length;
  const x0 = (B - groesse) / 2;
  const y0 = y - 30 - groesse;
  // Je Zeile zusammenhängende Läufe als ein Rechteck, leicht überlappend: keine hellen
  // Haarlinien zwischen den Modulen in PDF-Betrachtern.
  for (let r = 0; r < m.length; r++) {
    let c = 0;
    while (c < m.length) {
      if (!m[r][c]) { c++; continue; }
      const start = c;
      while (c < m.length && m[r][c]) c++;
      seite.drawRectangle({ x: x0 + start * modul, y: y0 + (m.length - 1 - r) * modul - 0.3, width: (c - start) * modul, height: modul + 0.6, color: rgb(0, 0, 0) });
    }
  }
  y = y0 - 30;
  mitte(buchung.nummer, y, 18, fett);
  y -= 22;
  mitte('Einlass-Code ' + buchung.einlassCode, y, 11, normal, grau);
  y -= 40;

  const zeilen = [
    ['Name', buchung.name],
    ['Personen', String(buchung.personen)],
    ['Treffpunkt', treffpunktVon(fuehrung) || 'wird noch mitgeteilt'],
  ];
  for (const [k, v] of zeilen) {
    seite.drawText(k, { x: 110, y, size: 11, font: normal, color: grau });
    const vz = umbrechen(fett, v, 11, B - 290);
    vz.forEach((z, i) => seite.drawText(z, { x: 220, y: y - i * 14, size: 11, font: fett, color: dunkel }));
    y -= 14 * vz.length + 8;
  }
  y -= 20;
  for (const z of umbrechen(normal, 'Bitte diesen Code am Treffpunkt vorzeigen, auf dem Handy oder ausgedruckt. Ein Code gilt für alle Personen dieser Buchung.', 10, B - 180)) {
    mitte(z, y, 10, normal, grau);
    y -= 14;
  }
  return doc.save();
}

/** Anhänge für eine Mail: QR-Bild (inline) und Ticket-PDF. Leer, wenn kein Code da ist. */
async function einlassAnhaenge({ buchung, fuehrung, termin }) {
  if (!buchung.einlassCode) return [];
  return [
    { dateiname: 'einlass-qr.png', inhalt: qrPng(einlassText(buchung), 8), typ: 'image/png', inlineId: 'einlass-qr' },
    { dateiname: 'Ticket-' + buchung.nummer + '.pdf', inhalt: Buffer.from(await ticketPdf({ buchung, fuehrung, termin })), typ: 'application/pdf' },
  ];
}

module.exports = { neuerEinlassCode, codeSicherstellen, einlassText, codeLesen, qrMatrix, qrPng, ticketPdf, einlassAnhaenge, EINLASS_STATUS, CODE_RE };
