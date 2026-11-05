// Eleventy-Konfiguration — marschbefehl.com
//
// Zweck: Artikel entstehen als Markdown-Dateien in artikel/ und werden in die
// bestehende Optik gegossen. Alle handgeschriebenen Seiten (Startseite, Videos,
// Karte, ...) werden unveraendert durchgereicht — Eleventy fasst sie nicht an.
//
// Ausgabe landet in _site/. Netlify veroeffentlicht diesen Ordner statt der
// Projektwurzel (siehe netlify.toml).

module.exports = function (eleventyConfig) {
  // Nur Markdown und Nunjucks werden verarbeitet. Alles andere wandert
  // unveraendert in die Ausgabe.
  eleventyConfig.setTemplateFormats(["md", "njk"]);

  eleventyConfig.addPassthroughCopy("assets");
  eleventyConfig.addPassthroughCopy("*.html");
  eleventyConfig.addPassthroughCopy("robots.txt");
  // Noch nicht nach Markdown umgezogene Artikel weiterhin ausliefern.
  eleventyConfig.addPassthroughCopy("artikel/*.html");

  eleventyConfig.ignores.add("node_modules/**");
  eleventyConfig.ignores.add(".netlify/**");
  eleventyConfig.ignores.add("netlify/**");
  eleventyConfig.ignores.add("_site/**");
  // Verirrte Skill-Dateien im Projektordner (gehoeren nicht zur Webseite)
  eleventyConfig.ignores.add("SKILL.md");
  eleventyConfig.ignores.add(".claude/**");
  eleventyConfig.ignores.add("werkzeug/**");

  // Sammlung aller Artikel, nach Datum absteigend — fuer Uebersicht, Sitemap
  // und RSS-Feed.
  eleventyConfig.addCollection("artikel", (sammlung) =>
    sammlung
      .getFilteredByGlob("artikel/*.md")
      .filter((eintrag) => !eintrag.data.entwurf)
      .sort((a, b) => b.data.datum - a.data.datum)
  );

  // Wandelt die von Markdown erzeugte Abfolge aus <h2> und <p> in die
  // Kapitelstruktur der bestehenden Artikel um:
  //   <section class="chapter"><h2>…</h2><p class="kicker">…</p><p>…</p></section>
  // Der erste Absatz nach einer Ueberschrift wird zum Kicker — diese Konvention
  // gilt in allen bisherigen Artikeln ausnahmslos (51 von 51 Kapiteln).
  // Inhalte, die im Original hinter dem Hauptbereich standen (z. B. die
  // Serienuebersicht), sind in der Markdown-Datei durch <!-- nachspann -->
  // abgetrennt. Beide Filter teilen an dieser Marke.
  const MARKE = "<!-- nachspann -->";

  eleventyConfig.addFilter("nachspann", function (inhalt) {
    if (!inhalt || !inhalt.includes(MARKE)) return "";
    return inhalt.slice(inhalt.indexOf(MARKE) + MARKE.length).trim();
  });

  // Zerlegt HTML in seine unmittelbaren Kind-Elemente. Zaehlt gleichnamige
  // Tags mit, damit verschachtelte Bloecke zusammenbleiben. Notwendig, weil ein
  // einfaches Aufteilen an "<h2" auch Ueberschriften INNERHALB eingebetteter
  // Bausteine erwischt — die Serienuebersicht enthaelt eine eigene <h2> und
  // erzeugte dadurch ein Geisterkapitel.
  const LEERE_TAGS = new Set(["img", "br", "hr", "input", "meta", "link", "source"]);
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

  // Bausteine, die im Original Geschwister der Kapitel sind und deshalb nie in
  // ein Kapitel hineingezogen werden duerfen.
  const GESCHWISTER = /^<(div class="episodes"|figure class="article-image")/;

  function zerlegen(roh) {
    const inhalt = roh.includes(MARKE) ? roh.slice(0, roh.indexOf(MARKE)) : roh;
    const vorspann = [];
    const rumpf = [];
    let offen = null;
    const schliessen = () => {
      if (offen) {
        rumpf.push(`<section class="chapter">\n${offen.join("\n")}\n</section>`);
        offen = null;
      }
    };
    for (const block of topBloecke(inhalt)) {
      if (/^<h2[ >]/.test(block)) {
        schliessen();
        offen = [block];
      } else if (GESCHWISTER.test(block)) {
        schliessen();
        (rumpf.length || offen ? rumpf : vorspann).push(block);
      } else if (offen) {
        // Erster Absatz nach der Ueberschrift wird zum Kicker.
        offen.push(
          offen.length === 1 && /^<p>/.test(block)
            ? block.replace(/^<p>/, '<p class="kicker">')
            : block
        );
      } else {
        vorspann.push(block);
      }
    }
    schliessen();
    return { vorspann: vorspann.join("\n").trim(), rumpf: rumpf.join("\n") };
  }

  // Alles, was im Original vor dem Hauptbereich stand (z. B. eine Bildtafel).
  eleventyConfig.addFilter("vorspann", (roh) => (roh ? zerlegen(roh).vorspann : ""));

  // Die Kapitel selbst, in der Struktur der bisherigen Artikel.
  eleventyConfig.addFilter("kapitel", (roh) => (roh ? zerlegen(roh).rumpf : ""));

  // Deutsches Datumsformat fuer die Anzeige, ISO fuer Sitemap und RSS.
  eleventyConfig.addFilter("datumDe", (d) =>
    new Date(d).toLocaleDateString("de-DE", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    })
  );
  eleventyConfig.addFilter("datumIso", (d) => new Date(d).toISOString());
  // RFC-822, wie es der RSS-Standard verlangt
  eleventyConfig.addFilter("datumRfc", (d) => new Date(d).toUTCString());

  return {
    dir: {
      input: ".",
      includes: "_includes",
      data: "_data",
      output: "_site",
    },
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk",
  };
};
