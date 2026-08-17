// Passwortgeschützte Function für den Verwaltungsbereich der Führungen-Seite.
// Ein einzelner Endpunkt, geroutet über body.action — bewusst kein REST-Zoo aus vielen
// Einzeldateien, da es sich um ein einfaches internes Admin-Werkzeug handelt.
//
// Auth-Modell: Das Admin-Passwort liegt NUR als Netlify-Umgebungsvariable
// (FUEHRUNGEN_ADMIN_PASSWORD) auf dem Server, nie im Code/Repo. Das Frontend schickt
// das Passwort bei JEDER Admin-Aktion im Request-Body mit (der Verwaltungsbereich hält
// es nur clientseitig in sessionStorage, nicht in einem Cookie/Token) — jede einzelne
// Function-Ausführung prüft es serverseitig per zeitkonstantem Vergleich neu nach.
// Für ein zahlungsfreies Phase-1-Admin-Tool mit geringem Risiko ist das angemessen;
// für Phase 2 (mit PayPal) sollte das nochmal überdacht werden (z.B. echtes Session-Token).
//
// Datenmodell (seit dem Führungen/Termine-Umbau, 2026-08-16): zwei Ebenen.
// - "Führung" = Tour-Angebot (Titel, Kurz-/Langbeschreibung, Preis pro Person, zwei
//   getrennte Bilder für Übersicht/Detail). Preis liegt HIER, nicht mehr am Termin.
// - "Termin" gehört immer zu genau einer Führung (fuehrungId), hat nur noch
//   Datum/Uhrzeit/max. Personen — kein eigenes Preisfeld mehr.

const crypto = require('crypto');
const { withState, readState, belegtePersonen, terminDatumZeit, findFuehrung, neueId, getBilderStore } = require('./_lib/store');
const {
  json,
  errorResponse,
  parseBody,
  isNichtLeererText,
  istGanzzahlInBereich,
  istGueltigeId,
  DATUM_RE,
  UHRZEIT_RE,
} = require('./_lib/http');

const KURZBESCHREIBUNG_MAX = 100;
const LANGBESCHREIBUNG_MAX = 5000;
const TITEL_MAX = 150;
const ORT_MAX = 200;

function passwortStimmt(eingabe) {
  const erwartet = process.env.FUEHRUNGEN_ADMIN_PASSWORD;
  if (!erwartet || typeof erwartet !== 'string' || erwartet.length === 0) {
    return { konfiguriert: false, stimmt: false };
  }
  if (typeof eingabe !== 'string' || eingabe.length === 0) {
    return { konfiguriert: true, stimmt: false };
  }
  // Zeitkonstanter Vergleich über gleich lange SHA-256-Digests, damit die Antwortzeit
  // nichts über die Länge/den Inhalt des korrekten Passworts verrät.
  const a = crypto.createHash('sha256').update(eingabe).digest();
  const b = crypto.createHash('sha256').update(erwartet).digest();
  return { konfiguriert: true, stimmt: crypto.timingSafeEqual(a, b) };
}

function gueltigerPreis(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100000;
}

function terminAdminFeld(t, state) {
  const belegt = belegtePersonen(state, t.id);
  return {
    id: t.id,
    fuehrungId: t.fuehrungId,
    datumIso: t.datumIso,
    uhrzeit: t.uhrzeit,
    maxPersonen: t.maxPersonen,
    belegtePersonen: belegt,
    freiePlaetze: Math.max(0, t.maxPersonen - belegt),
    istVergangenheit: terminDatumZeit(t).getTime() < Date.now(),
  };
}

async function bildLoeschenBestEffort(imageId) {
  if (!imageId) return;
  try {
    await getBilderStore().delete(imageId);
  } catch (err) {
    // Verwaistes Bild im Blob-Store ist kein kritischer Fehler (kostet nur etwas
    // Speicherplatz) — lieber die eigentliche Aktion nicht daran scheitern lassen.
    console.error('Bild konnte nicht gelöscht werden (nicht kritisch):', imageId, err);
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return errorResponse(405, 'Nur POST erlaubt.');
  }

  const body = parseBody(event);
  if (body === null) {
    return errorResponse(400, 'Ungültige Anfrage.');
  }

  const pruefung = passwortStimmt(body.password);
  if (!pruefung.konfiguriert) {
    return errorResponse(
      500,
      'Der Verwaltungsbereich ist noch nicht eingerichtet: Die Umgebungsvariable FUEHRUNGEN_ADMIN_PASSWORD fehlt im Netlify-Projekt.'
    );
  }
  if (!pruefung.stimmt) {
    return errorResponse(401, 'Falsches Passwort.');
  }

  const action = body.action;

  try {
    if (action === 'login') {
      return json(200, { ok: true });
    }

    if (action === 'list') {
      const state = await readState();
      const fuehrungen = state.fuehrungen
        .slice()
        .sort((a, b) => new Date(a.erstelltAm) - new Date(b.erstelltAm))
        .map((f) => {
          const termineDieserFuehrung = state.termine.filter((t) => t.fuehrungId === f.id);
          const zukuenftig = termineDieserFuehrung.filter((t) => terminDatumZeit(t).getTime() >= Date.now());
          const vergangen = termineDieserFuehrung.filter((t) => terminDatumZeit(t).getTime() < Date.now());
          const buchungenAnzahl = vergangen.reduce(
            (sum, t) => sum + state.buchungen.filter((b) => b.terminId === t.id).length,
            0
          );
          return {
            id: f.id,
            titel: f.titel,
            kurzbeschreibung: f.kurzbeschreibung,
            langbeschreibung: f.langbeschreibung,
            ort: f.ort || '',
            preisProPerson: f.preisProPerson,
            bildUebersichtId: f.bildUebersichtId || null,
            bildDetailId: f.bildDetailId || null,
            terminAnzahlZukuenftig: zukuenftig.length,
            terminAnzahlVergangen: vergangen.length,
            buchungenAnzahlVergangen: buchungenAnzahl,
          };
        });

      const termine = state.termine
        .map((t) => terminAdminFeld(t, state))
        .sort((a, b) => new Date(`${a.datumIso}T${a.uhrzeit}`) - new Date(`${b.datumIso}T${b.uhrzeit}`));
      const buchungen = state.buchungen
        .slice()
        .sort((a, b) => new Date(b.erstelltAm) - new Date(a.erstelltAm))
        .map((b) => ({
          id: b.id,
          terminId: b.terminId,
          name: b.name,
          email: b.email,
          personen: b.personen,
          erstelltAm: b.erstelltAm,
        }));
      return json(200, { ok: true, fuehrungen, termine, buchungen });
    }

    // ---------------- Führungen ----------------

    if (action === 'create-fuehrung') {
      const titel = typeof body.titel === 'string' ? body.titel.trim() : '';
      const kurzbeschreibung = typeof body.kurzbeschreibung === 'string' ? body.kurzbeschreibung.trim() : '';
      const langbeschreibung = typeof body.langbeschreibung === 'string' ? body.langbeschreibung.trim() : '';
      const ort = typeof body.ort === 'string' ? body.ort.trim() : '';
      const preisProPerson = Number(body.preisProPerson);
      const bildUebersichtId = typeof body.bildUebersichtId === 'string' ? body.bildUebersichtId.trim() : '';
      const bildDetailId = typeof body.bildDetailId === 'string' ? body.bildDetailId.trim() : '';

      if (!isNichtLeererText(titel, TITEL_MAX)) return errorResponse(400, `Bitte einen Titel angeben (max. ${TITEL_MAX} Zeichen).`);
      if (!isNichtLeererText(kurzbeschreibung, KURZBESCHREIBUNG_MAX)) {
        return errorResponse(400, `Kurzbeschreibung fehlt oder ist zu lang (max. ${KURZBESCHREIBUNG_MAX} Zeichen).`);
      }
      if (!isNichtLeererText(langbeschreibung, LANGBESCHREIBUNG_MAX)) {
        return errorResponse(400, `Langbeschreibung fehlt oder ist zu lang (max. ${LANGBESCHREIBUNG_MAX} Zeichen).`);
      }
      if (!isNichtLeererText(ort, ORT_MAX)) return errorResponse(400, `Bitte einen Treffpunkt/Ort angeben (max. ${ORT_MAX} Zeichen).`);
      if (!gueltigerPreis(preisProPerson)) return errorResponse(400, 'Ungültiger Preis pro Person.');
      if (!istGueltigeId(bildUebersichtId)) return errorResponse(400, 'Bitte ein Übersichtsbild hochladen.');
      if (!istGueltigeId(bildDetailId)) return errorResponse(400, 'Bitte ein Detailbild hochladen.');

      const result = await withState((state) => {
        const fuehrung = {
          id: neueId(),
          titel,
          kurzbeschreibung,
          langbeschreibung,
          ort,
          preisProPerson,
          bildUebersichtId,
          bildDetailId,
          erstelltAm: new Date().toISOString(),
        };
        state.fuehrungen.push(fuehrung);
        return { ok: true, fuehrung };
      });
      if (!result.ok) return errorResponse(result.status || 400, result.error);
      return json(200, result);
    }

    if (action === 'edit-fuehrung') {
      const fuehrungId = typeof body.fuehrungId === 'string' ? body.fuehrungId.trim() : '';
      const titel = typeof body.titel === 'string' ? body.titel.trim() : '';
      const kurzbeschreibung = typeof body.kurzbeschreibung === 'string' ? body.kurzbeschreibung.trim() : '';
      const langbeschreibung = typeof body.langbeschreibung === 'string' ? body.langbeschreibung.trim() : '';
      const ort = typeof body.ort === 'string' ? body.ort.trim() : '';
      const preisProPerson = Number(body.preisProPerson);
      // Bild-IDs sind beim Bearbeiten OPTIONAL — nur mitschicken, wenn der Admin ein
      // neues Bild hochgeladen hat. Ohne Angabe bleibt das bisherige Bild bestehen.
      const neuesBildUebersichtId = typeof body.bildUebersichtId === 'string' && body.bildUebersichtId.trim()
        ? body.bildUebersichtId.trim()
        : null;
      const neuesBildDetailId = typeof body.bildDetailId === 'string' && body.bildDetailId.trim()
        ? body.bildDetailId.trim()
        : null;

      if (!fuehrungId) return errorResponse(400, 'Keine Führung angegeben.');
      if (!isNichtLeererText(titel, TITEL_MAX)) return errorResponse(400, `Bitte einen Titel angeben (max. ${TITEL_MAX} Zeichen).`);
      if (!isNichtLeererText(kurzbeschreibung, KURZBESCHREIBUNG_MAX)) {
        return errorResponse(400, `Kurzbeschreibung fehlt oder ist zu lang (max. ${KURZBESCHREIBUNG_MAX} Zeichen).`);
      }
      if (!isNichtLeererText(langbeschreibung, LANGBESCHREIBUNG_MAX)) {
        return errorResponse(400, `Langbeschreibung fehlt oder ist zu lang (max. ${LANGBESCHREIBUNG_MAX} Zeichen).`);
      }
      if (!isNichtLeererText(ort, ORT_MAX)) return errorResponse(400, `Bitte einen Treffpunkt/Ort angeben (max. ${ORT_MAX} Zeichen).`);
      if (!gueltigerPreis(preisProPerson)) return errorResponse(400, 'Ungültiger Preis pro Person.');
      if (neuesBildUebersichtId && !istGueltigeId(neuesBildUebersichtId)) return errorResponse(400, 'Ungültiges Übersichtsbild.');
      if (neuesBildDetailId && !istGueltigeId(neuesBildDetailId)) return errorResponse(400, 'Ungültiges Detailbild.');

      let altesBildUebersichtId = null;
      let altesBildDetailId = null;

      const result = await withState((state) => {
        const fuehrung = state.fuehrungen.find((f) => f.id === fuehrungId);
        if (!fuehrung) return { ok: false, status: 404, error: 'Führung nicht gefunden.' };

        fuehrung.titel = titel;
        fuehrung.kurzbeschreibung = kurzbeschreibung;
        fuehrung.langbeschreibung = langbeschreibung;
        fuehrung.ort = ort;
        fuehrung.preisProPerson = preisProPerson;

        if (neuesBildUebersichtId && neuesBildUebersichtId !== fuehrung.bildUebersichtId) {
          altesBildUebersichtId = fuehrung.bildUebersichtId || null;
          fuehrung.bildUebersichtId = neuesBildUebersichtId;
        }
        if (neuesBildDetailId && neuesBildDetailId !== fuehrung.bildDetailId) {
          altesBildDetailId = fuehrung.bildDetailId || null;
          fuehrung.bildDetailId = neuesBildDetailId;
        }

        return { ok: true, fuehrung };
      });
      if (!result.ok) return errorResponse(result.status || 400, result.error);

      // Erst NACH erfolgreichem Schreiben die alten, jetzt verwaisten Bilder löschen —
      // best-effort, darf die eigentliche Bearbeitung nicht mehr zum Scheitern bringen.
      await bildLoeschenBestEffort(altesBildUebersichtId);
      await bildLoeschenBestEffort(altesBildDetailId);

      return json(200, result);
    }

    if (action === 'delete-fuehrung') {
      const fuehrungId = typeof body.fuehrungId === 'string' ? body.fuehrungId.trim() : '';
      if (!fuehrungId) return errorResponse(400, 'Keine Führung angegeben.');

      let bilderZumLoeschen = [];

      const result = await withState((state) => {
        const fuehrung = state.fuehrungen.find((f) => f.id === fuehrungId);
        if (!fuehrung) return { ok: false, status: 404, error: 'Führung nicht gefunden.' };

        const termineDieserFuehrung = state.termine.filter((t) => t.fuehrungId === fuehrungId);
        const zukuenftig = termineDieserFuehrung.filter((t) => terminDatumZeit(t).getTime() >= Date.now());
        if (zukuenftig.length > 0) {
          return {
            ok: false,
            status: 400,
            error: `Diese Führung hat noch ${zukuenftig.length} zukünftige${zukuenftig.length === 1 ? 'n' : ''} Termin${zukuenftig.length === 1 ? '' : 'e'} — bitte diese zuerst löschen, bevor die Führung gelöscht wird.`,
          };
        }

        // Nur noch vergangene (oder gar keine) Termine übrig — diese werden inklusive
        // ihrer Buchungen mitgelöscht (kaskadierend), das Frontend weist den Admin vorher
        // klar darauf hin, wie viele Termine/Buchungen das betrifft.
        const terminIdsDieserFuehrung = termineDieserFuehrung.map((t) => t.id);
        state.termine = state.termine.filter((t) => t.fuehrungId !== fuehrungId);
        state.buchungen = state.buchungen.filter((b) => !terminIdsDieserFuehrung.includes(b.terminId));
        state.fuehrungen = state.fuehrungen.filter((f) => f.id !== fuehrungId);

        bilderZumLoeschen = [fuehrung.bildUebersichtId, fuehrung.bildDetailId].filter(Boolean);

        return { ok: true };
      });
      if (!result.ok) return errorResponse(result.status || 400, result.error);

      for (const bildId of bilderZumLoeschen) {
        await bildLoeschenBestEffort(bildId);
      }

      return json(200, result);
    }

    // ---------------- Termine ----------------

    if (action === 'create-termin') {
      const fuehrungId = typeof body.fuehrungId === 'string' ? body.fuehrungId.trim() : '';
      const datumIso = typeof body.datumIso === 'string' ? body.datumIso.trim() : '';
      const uhrzeit = typeof body.uhrzeit === 'string' ? body.uhrzeit.trim() : '';
      const maxPersonen = Number(body.maxPersonen);

      if (!fuehrungId) return errorResponse(400, 'Keine Führung angegeben.');
      if (!DATUM_RE.test(datumIso)) return errorResponse(400, 'Ungültiges Datum.');
      if (!UHRZEIT_RE.test(uhrzeit)) return errorResponse(400, 'Ungültige Uhrzeit.');
      if (!istGanzzahlInBereich(maxPersonen, 1, 500)) {
        return errorResponse(400, 'Maximale Personenzahl muss eine ganze Zahl zwischen 1 und 500 sein.');
      }
      if (Number.isNaN(new Date(`${datumIso}T${uhrzeit}:00`).getTime())) {
        return errorResponse(400, 'Datum/Uhrzeit konnte nicht interpretiert werden.');
      }

      const result = await withState((state) => {
        const fuehrung = state.fuehrungen.find((f) => f.id === fuehrungId);
        if (!fuehrung) return { ok: false, status: 404, error: 'Führung nicht gefunden.' };

        const termin = {
          id: neueId(),
          fuehrungId,
          datumIso,
          uhrzeit,
          maxPersonen,
          erstelltAm: new Date().toISOString(),
        };
        state.termine.push(termin);
        return { ok: true, termin };
      });
      if (!result.ok) return errorResponse(result.status || 400, result.error);
      return json(200, result);
    }

    if (action === 'edit-termin') {
      const terminId = typeof body.terminId === 'string' ? body.terminId.trim() : '';
      const maxPersonen = Number(body.maxPersonen);

      if (!terminId) return errorResponse(400, 'Kein Termin angegeben.');
      if (!istGanzzahlInBereich(maxPersonen, 1, 500)) {
        return errorResponse(400, 'Maximale Personenzahl muss eine ganze Zahl zwischen 1 und 500 sein.');
      }

      const result = await withState((state) => {
        const termin = state.termine.find((t) => t.id === terminId);
        if (!termin) return { ok: false, status: 404, error: 'Termin nicht gefunden.' };
        if (terminDatumZeit(termin).getTime() < Date.now()) {
          return { ok: false, status: 400, error: 'Vergangene Termine können nicht mehr bearbeitet werden.' };
        }
        const belegt = belegtePersonen(state, terminId);
        if (maxPersonen < belegt) {
          return {
            ok: false,
            status: 400,
            error: `Es sind bereits ${belegt} Plätze gebucht — die maximale Personenzahl kann nicht darunter gesetzt werden.`,
          };
        }
        termin.maxPersonen = maxPersonen;
        return { ok: true, termin };
      });
      if (!result.ok) return errorResponse(result.status || 400, result.error);
      return json(200, result);
    }

    if (action === 'delete-termin') {
      const terminId = typeof body.terminId === 'string' ? body.terminId.trim() : '';
      if (!terminId) return errorResponse(400, 'Kein Termin angegeben.');

      const result = await withState((state) => {
        const idx = state.termine.findIndex((t) => t.id === terminId);
        if (idx === -1) return { ok: false, status: 404, error: 'Termin nicht gefunden.' };
        state.termine.splice(idx, 1);
        state.buchungen = state.buchungen.filter((b) => b.terminId !== terminId);
        return { ok: true };
      });
      if (!result.ok) return errorResponse(result.status || 400, result.error);
      return json(200, result);
    }

    // ---------------- Buchungen ----------------

    if (action === 'cancel-buchung') {
      const buchungId = typeof body.buchungId === 'string' ? body.buchungId.trim() : '';
      if (!buchungId) return errorResponse(400, 'Keine Buchung angegeben.');

      const result = await withState((state) => {
        const idx = state.buchungen.findIndex((b) => b.id === buchungId);
        if (idx === -1) return { ok: false, status: 404, error: 'Buchung nicht gefunden.' };
        state.buchungen.splice(idx, 1);
        return { ok: true };
      });
      if (!result.ok) return errorResponse(result.status || 400, result.error);
      return json(200, result);
    }

    return errorResponse(400, 'Unbekannte Aktion.');
  } catch (err) {
    console.error('admin-api Fehler:', action, err);
    return errorResponse(500, 'Es ist ein Serverfehler aufgetreten.');
  }
};
