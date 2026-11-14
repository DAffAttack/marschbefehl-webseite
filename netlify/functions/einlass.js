// Einlass am Treffpunkt (14.11.2026). Nur mit Verwaltungs-Sitzung (Cookie).
//
// GET  ?aktion=termine           -> anstehende Termine (ab gestern) mit Zahl der Buchungen
// GET  ?terminId=<id>            -> Gästeliste eines Termins für die Einlass-Seite. Vergibt
//                                   fehlende Einlass-Codes (Buchungen vor dem 14.11.2026).
//                                   Stornierte Buchungen sind dabei, damit ein alter Code
//                                   beim Scannen "storniert" statt "unbekannt" zeigt.
// POST {terminId, eintraege:[{buchungId, eingecheckt:true|false, zeit}]}
//                                -> Einchecken/Rückgängig, auch gesammelt nach Funkloch.
//                                   Wiederholbar: gleicher Eintrag zweimal ändert nichts.

const { readState, withState, findFuehrung, protokoll, blobsVerbinden } = require('./_lib/store');
const { angemeldet } = require('./_lib/sitzung');
const { json, errorResponse, parseBody, istGueltigeId } = require('./_lib/http');
const { treffpunktVon } = require('./_lib/rechnung');
const { codeSicherstellen, EINLASS_STATUS } = require('./_lib/einlass');

const LISTEN_STATUS = EINLASS_STATUS.concat(['storniert']);

function gestrigesDatum() {
  const d = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

function gastFuerListe(b) {
  return {
    id: b.id,
    nummer: b.nummer,
    code: b.einlassCode || '',
    name: b.name,
    personen: b.personen,
    telefon: b.telefon || '',
    fahrzeug: b.fahrzeug || '',
    status: b.status || 'bezahlt',
    eingechecktAm: b.eingechecktAm || '',
  };
}

exports.handler = async (event) => {
  blobsVerbinden(event);
  const body = event.httpMethod === 'POST' ? parseBody(event) : {};
  if (body === null) return errorResponse(400, 'Ungültige Anfrage.');
  const a = angemeldet(event, body);
  if (!a.konfiguriert) return errorResponse(500, 'Verwaltung nicht eingerichtet.');
  if (!a.ok) return errorResponse(401, 'Bitte anmelden.');

  try {
    if (event.httpMethod === 'GET') {
      const q = event.queryStringParameters || {};
      if (q.aktion === 'termine') {
        const state = await readState();
        const ab = gestrigesDatum();
        const termine = state.termine
          .filter((t) => t.datumIso >= ab && t.status !== 'abgesagt')
          .sort((x, y) => (x.datumIso + x.uhrzeit).localeCompare(y.datumIso + y.uhrzeit))
          .map((t) => {
            const f = findFuehrung(state, t.fuehrungId);
            const gaeste = state.buchungen.filter((b) => b.terminId === t.id && EINLASS_STATUS.includes(b.status || 'bezahlt'));
            return { id: t.id, datumIso: t.datumIso, uhrzeit: t.uhrzeit, titel: f ? f.titel : 'Führung', buchungen: gaeste.length, personen: gaeste.reduce((s, b) => s + b.personen, 0) };
          });
        return json(200, { ok: true, termine });
      }

      const terminId = typeof q.terminId === 'string' ? q.terminId.trim() : '';
      if (!istGueltigeId(terminId)) return errorResponse(400, 'Ungültige Termin-ID.');
      // Fehlende Codes vergeben (nur schreiben, wenn sich etwas ändert).
      const r = await withState((state) => {
        if (!state.termine.some((t) => t.id === terminId)) return { ok: false, status: 404, error: 'Termin nicht gefunden.' };
        let geaendert = false;
        for (const b of state.buchungen) {
          if (b.terminId === terminId && EINLASS_STATUS.includes(b.status || 'bezahlt') && codeSicherstellen(b)) geaendert = true;
        }
        return geaendert ? { ok: true } : { ok: false, status: 200, error: 'unverändert' };
      });
      if (!r.ok && r.status !== 200) return errorResponse(r.status, r.error);

      const state = await readState();
      const termin = state.termine.find((t) => t.id === terminId);
      const fuehrung = findFuehrung(state, termin.fuehrungId) || { titel: 'Führung' };
      const gaeste = state.buchungen
        .filter((b) => b.terminId === terminId && LISTEN_STATUS.includes(b.status || 'bezahlt'))
        .sort((x, y) => x.name.localeCompare(y.name, 'de'))
        .map(gastFuerListe);
      return json(200, {
        ok: true,
        termin: { id: termin.id, datumIso: termin.datumIso, uhrzeit: termin.uhrzeit, titel: fuehrung.titel, treffpunkt: treffpunktVon(fuehrung), maxPersonen: termin.maxPersonen },
        gaeste,
        stand: new Date().toISOString(),
      });
    }

    if (event.httpMethod === 'POST') {
      const terminId = typeof body.terminId === 'string' ? body.terminId.trim() : '';
      if (!istGueltigeId(terminId)) return errorResponse(400, 'Ungültige Termin-ID.');
      const eintraege = Array.isArray(body.eintraege) ? body.eintraege.slice(0, 200) : [];
      if (!eintraege.length) return errorResponse(400, 'Keine Einträge.');
      const r = await withState((state) => {
        let angewendet = 0;
        for (const e of eintraege) {
          if (!e || !istGueltigeId(String(e.buchungId || ''))) continue;
          const b = state.buchungen.find((x) => x.id === e.buchungId && x.terminId === terminId);
          if (!b) continue;
          const zeit = typeof e.zeit === 'string' && !isNaN(Date.parse(e.zeit)) ? new Date(e.zeit).toISOString() : new Date().toISOString();
          if (e.eingecheckt === true && !b.eingechecktAm) {
            b.eingechecktAm = zeit;
            protokoll(state, { art: 'einlass', buchungId: b.id, nummer: b.nummer, text: 'eingecheckt ' + zeit });
            angewendet++;
          } else if (e.eingecheckt === false && b.eingechecktAm) {
            delete b.eingechecktAm;
            protokoll(state, { art: 'einlass-zurueck', buchungId: b.id, nummer: b.nummer, text: 'Einchecken zurückgenommen' });
            angewendet++;
          }
        }
        return angewendet ? { ok: true, angewendet } : { ok: false, status: 200, error: 'unverändert' };
      });
      if (!r.ok && r.status !== 200) return errorResponse(r.status, r.error);
      const state = await readState();
      const gaeste = state.buchungen.filter((b) => b.terminId === terminId && LISTEN_STATUS.includes(b.status || 'bezahlt')).map(gastFuerListe);
      return json(200, { ok: true, angewendet: r.angewendet || 0, gaeste, stand: new Date().toISOString() });
    }
    return errorResponse(405, 'Nur GET oder POST.');
  } catch (err) {
    console.error('einlass Fehler:', err);
    return errorResponse(500, 'Einlass-Daten konnten nicht geladen werden.');
  }
};
