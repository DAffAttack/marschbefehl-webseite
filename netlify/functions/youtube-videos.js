// Öffentliche, ungeschützte Function: liefert die neuesten Videos des Kanals
// (für die Videos-Seite, inkl. "Weitere Videos laden"-Pagination) serverseitig
// statt wie zuvor per direktem Browser-Aufruf mit offen im Quelltext liegendem
// API-Schlüssel. Der Schlüssel liegt jetzt nur noch als Umgebungsvariable
// YOUTUBE_API_KEY auf dem Server (dieselbe Variable wie bei youtube-stats.js).
//
// Shorts/Reels gehören NICHT auf die Webseite. YouTube führt zu jedem Kanal neben
// der Uploads-Liste (UU…) eine eigene Shorts-Liste (UUSH…). Wir holen beide und
// ziehen die Shorts ab; Live-Streams bleiben dabei drin. Die UU-/UUSH-Vorsilben
// sind von YouTube nicht offiziell dokumentiert (Stand 04.11.2026 geprüft).
// Schlägt die Shorts-Liste fehl, gibt es bewusst eine Fehlermeldung statt einer
// Videoliste mit Shorts. Nur "nicht gefunden" heißt: der Kanal hat keine Shorts.
//
// "Weitere Videos laden": nextPageToken ist hier die laufende Nummer des nächsten
// Videos in der gefilterten Liste, damit jede Seite genau 12 Videos zeigt. Das
// Frontend reicht den Wert nur durch.

const { json, errorResponse } = require('./_lib/http');

const YT_CHANNEL_ID = 'UCS66v6xykvKupyUme3wpMwA';
const UPLOADS_PLAYLIST = 'UU' + YT_CHANNEL_ID.slice(2);
const SHORTS_PLAYLIST = 'UUSH' + YT_CHANNEL_ID.slice(2);
const PAGE_SIZE = 12;

// Holt alle Einträge einer Playlist (YouTube liefert höchstens 50 je Abruf).
async function ganzePlaylist(playlistId, apiKey, leerBeiNichtGefunden) {
  const items = [];
  let token = '';
  do {
    const url =
      'https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=' +
      playlistId +
      '&key=' +
      apiKey +
      (token ? '&pageToken=' + encodeURIComponent(token) : '');
    const res = await fetch(url);
    if (res.status === 404 && leerBeiNichtGefunden) return [];
    const data = await res.json();
    if (!data.items) {
      console.error('youtube-videos: keine items für ' + playlistId, JSON.stringify(data).slice(0, 500));
      throw new Error('Playlist nicht lesbar: ' + playlistId);
    }
    items.push(...data.items);
    token = data.nextPageToken || '';
  } while (token);
  return items;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return errorResponse(405, 'Nur GET erlaubt.');
  }

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return errorResponse(500, 'Die Umgebungsvariable YOUTUBE_API_KEY fehlt im Netlify-Projekt.');
  }

  const params = event.queryStringParameters || {};
  const start = Math.max(parseInt(params.pageToken, 10) || 0, 0);

  try {
    const [uploads, shorts] = await Promise.all([
      ganzePlaylist(UPLOADS_PLAYLIST, apiKey, false),
      ganzePlaylist(SHORTS_PLAYLIST, apiKey, true),
    ]);
    const shortIds = new Set(shorts.map((item) => item.snippet.resourceId.videoId));
    const videos = uploads.filter((item) => !shortIds.has(item.snippet.resourceId.videoId));
    const ende = start + PAGE_SIZE;

    return json(200, {
      ok: true,
      uploadsPlaylistId: UPLOADS_PLAYLIST,
      items: videos.slice(start, ende),
      nextPageToken: ende < videos.length ? String(ende) : null,
    });
  } catch (err) {
    console.error('youtube-videos Fehler:', err);
    return errorResponse(502, 'Videos konnten nicht geladen werden.');
  }
};
