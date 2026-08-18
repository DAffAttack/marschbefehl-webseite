#!/usr/bin/env node
// Wandelt einen handgeschriebenen Artikel (HTML) in eine Markdown-Datei fuer
// Eleventy um. Einmalig genutzt fuer die Umstellung am 18.08.2026 — bleibt
// erhalten, falls noch alte Artikel nachzuziehen sind.
//
// Aufruf:  node werkzeug/artikel-nach-markdown.js artikel/schattenmine.html
//          node werkzeug/artikel-nach-markdown.js --alle
//
// Grundsatz: Es darf nichts verloren gehen. Nur Ueberschrift, Absatz und Zitat
// werden zu Markdown; jeder andere Baustein — Bildtafeln, Buchempfehlungen,
// Zahlenbloecke, Serienuebersichten — wandert unveraendert als HTML mit.
// Markdown erlaubt eingebettetes HTML, deshalb bleibt so jede Auszeichnung
// erhalten.
//
// Die Bloecke werden klammerzaehlend ermittelt und nicht ueber eine Liste
// erwarteter Tags. Ein frueherer Ansatz mit fester Tag-Liste verlor die
// Buchempfehlungen, weil diese <a>-Elemente sind, und verstuemmelte
// verschachtelte <div>-Bloecke.

const fs = require("fs");
const path = require("path");

const LEERE_TAGS = new Set([
  "img", "br", "hr", "input", "meta", "link", "source", "area", "col", "embed",
]);

function entschaerfen(s) {
  return s.replace(/"/g, '\\"').replace(/\s+/g, " ").trim();
}

function textVon(html) {
  return html.replace(/<br\s*\/?>/g, " ").replace(/\s+/g, " ").trim();
}

function inlineNachMarkdown(html) {
  return html
    .replace(/<(em|i)>(.*?)<\/\1>/gs, "*$2*")
    .replace(/<(strong|b)>(.*?)<\/\1>/gs, "**$2**");
}

// Zerlegt einen HTML-Abschnitt in seine unmittelbaren Kind-Elemente.
// Zaehlt oeffnende und schliessende Tags mit, damit verschachtelte gleiche
// Tags (<div> in <div>) korrekt zusammengehalten werden.
function topBloecke(html) {
  const bloecke = [];
  let i = 0;
  while (i < html.length) {
    const start = html.indexOf("<", i);
    if (start === -1) break;
    const auf = /^<([a-zA-Z][\w-]*)([^>]*)>/.exec(html.slice(start));
    if (!auf) {
      i = start + 1;
      continue;
    }
    const tag = auf[1].toLowerCase();
    if (LEERE_TAGS.has(tag) || auf[0].endsWith("/>")) {
      bloecke.push(html.slice(start, start + auf[0].length));
      i = start + auf[0].length;
      continue;
    }
    const re = new RegExp(`</?${tag}\\b[^>]*>`, "gi");
    re.lastIndex = start;
    let tiefe = 0;
    let ende = html.length;
    let m;
    while ((m = re.exec(html)) !== null) {
      if (m[0][1] === "/") tiefe -= 1;
      else if (!m[0].endsWith("/>")) tiefe += 1;
      if (tiefe === 0) {
        ende = m.index + m[0].length;
        break;
      }
    }
    bloecke.push(html.slice(start, ende));
    i = ende;
  }
  return bloecke;
}

function blockNachMarkdown(block) {
  const auf = /^<([a-zA-Z][\w-]*)([^>]*)>/.exec(block);
  if (!auf) return block.trim();
  const tag = auf[1].toLowerCase();
  const attrs = auf[2] || "";
  const klasse = (attrs.match(/class="([^"]*)"/) || [])[1] || "";
  const inhalt = block.slice(auf[0].length, block.lastIndexOf("</"));

  // Schlichte Absaetze ohne Sonderauszeichnung werden zu Fliesstext.
  if (tag === "p" && !klasse) return inlineNachMarkdown(textVon(inhalt));
  if (tag === "blockquote") {
    return "> " + inlineNachMarkdown(textVon(inhalt.replace(/<\/?p>/g, "")));
  }
  // Alles andere unveraendert uebernehmen.
  return block.trim();
}

let DATEN = {};
try {
  DATEN = JSON.parse(
    fs.readFileSync(path.join(__dirname, "artikel-daten.json"), "utf8")
  );
} catch (e) {
  console.warn("  Hinweis: artikel-daten.json fehlt — Datum bleibt Platzhalter.");
}

function datumFuer(pfad) {
  const eintrag = DATEN[pfad.split(path.sep).join("/")];
  return eintrag ? eintrag.datum : "2026-01-01   # BITTE PRUEFEN";
}

function wandeln(pfad) {
  const html = fs.readFileSync(pfad, "utf8");
  const hole = (re) => {
    const m = html.match(re);
    return m ? textVon(m[1]) : "";
  };

  const titel = hole(/<h1>(.*?)<\/h1>/s);
  const beschreibung = hole(/<meta name="description" content="([^"]*)"/);
  const eyebrow = hole(/<p class="eyebrow">(.*?)<\/p>/s);
  const lead = hole(/<p class="lead">(.*?)<\/p>/s);
  const heroText = hole(/<h1>.*?<\/h1>\s*<p>(.*?)<\/p>/s);
  const youtubeId = (html.match(/youtube\.com\/watch\?v=([\w-]+)/) || [])[1] || "";
  const youtubeTitel = hole(/<p class="vtitle">(.*?)<\/p>/s);
  const ctaLabel = hole(/<div class="video-cta">\s*<p class="label">(.*?)<\/p>/s);

  // Drei der acht Artikel tragen bewusst einen anderen <title> als ihre
  // Ueberschrift — laenger und stichwortreicher fuer die Suchmaschine. Dieser
  // Unterschied darf beim Umzug nicht eingeebnet werden.
  const seitentitel = hole(/<title>(.*?)<\/title>/s)
    .replace(/\s*[–-]\s*Zeitreise Seelower Höhen\s*$/, "")
    .trim();

  // --- Zwischen Hero-Abschnitt und <main> ---
  // Manche Artikel stellen eine Bildtafel vor den Hauptbereich. Diese Bloecke
  // gingen zunaechst verloren, weil nur der Inhalt von <main> ausgewertet wurde.
  const heroEnde = html.indexOf("</section>") + "</section>".length;
  const vorMain = topBloecke(html.slice(heroEnde, html.indexOf("<main")))
    .join("\n")
    .trim();

  // --- Hauptbereich ---
  const mAnfang = html.indexOf("<main");
  const mInhalt = html.slice(html.indexOf(">", mAnfang) + 1, html.indexOf("</main>"));

  const teile = [];
  for (const block of topBloecke(mInhalt)) {
    if (/^<p class="lead">/.test(block)) continue; // steckt im Vorspann
    if (/^<section class="chapter">/.test(block)) {
      const auf = /^<section[^>]*>/.exec(block)[0];
      const innen = block.slice(auf.length, block.lastIndexOf("</section>"));
      const ueber = (innen.match(/<h2>(.*?)<\/h2>/s) || [])[1];
      if (ueber) teile.push("## " + textVon(ueber));
      const rest = innen.replace(/<h2>.*?<\/h2>/s, "");
      for (const kind of topBloecke(rest)) teile.push(blockNachMarkdown(kind));
    } else {
      teile.push(block.trim());
    }
  }

  // --- Zwischen </main> und den Zurueck-Links, ohne den Video-Hinweis ---
  const nachMain = html.slice(
    html.indexOf("</main>") + 7,
    html.indexOf('<div class="back-links">')
  );
  const nachspann = topBloecke(nachMain)
    .filter((b) => !/^<div class="video-cta">/.test(b))
    .join("\n")
    .trim();

  const kopfZeilen = [
    "---",
    "layout: artikel.njk",
    `titel: "${entschaerfen(titel)}"`,
    seitentitel && seitentitel !== titel
      ? `seitentitel: "${entschaerfen(seitentitel)}"`
      : null,
    `beschreibung: "${entschaerfen(beschreibung)}"`,
    `eyebrow: "${entschaerfen(eyebrow)}"`,
    `heroText: "${entschaerfen(heroText)}"`,
    `lead: "${entschaerfen(lead)}"`,
    youtubeId ? `youtubeId: "${youtubeId}"` : null,
    youtubeTitel ? `youtubeTitel: "${entschaerfen(youtubeTitel)}"` : null,
    ctaLabel ? `ctaLabel: "${entschaerfen(ctaLabel)}"` : null,
    `datum: ${datumFuer(pfad)}`,
    "---",
  ].filter(Boolean);

  const rumpf = (vorMain ? vorMain + "\n\n" : "") + teile.join("\n\n");
  let md = kopfZeilen.join("\n") + "\n\n" + rumpf + "\n";
  if (nachspann) {
    md += "\n<!-- nachspann -->\n" + nachspann + "\n";
  }
  const kapitelZahl = (html.match(/<section class="chapter">/g) || []).length;
  return { markdown: md, kapitelZahl, nachspann: Boolean(nachspann) };
}

const args = process.argv.slice(2);
const dateien =
  args[0] === "--alle"
    ? fs
        .readdirSync("artikel")
        .filter((f) => f.endsWith(".html") && f !== "index.html")
        .map((f) => path.join("artikel", f))
    : args;

for (const f of dateien) {
  const { markdown, kapitelZahl, nachspann } = wandeln(f);
  const ziel = f.replace(/\.html$/, ".md");
  fs.writeFileSync(ziel, markdown, "utf8");
  console.log(
    `  ${path.basename(ziel).padEnd(42)} ${kapitelZahl} Kapitel, ${markdown.length.toLocaleString("de-DE").padStart(7)} Zeichen${nachspann ? ", + Nachspann" : ""}`
  );
}
