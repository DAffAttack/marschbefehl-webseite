/* Slider „Stimmen zu früheren Führungen“ für fuehrungen.html und fuehrung.html.
   Neue Stimme oder neues Foto: nur die Liste STIMMEN ergänzen. Zitate wörtlich, Kürzungen mit […]. */
(function () {
  var STIMMEN = [
    {
      bild: '/assets/stimmen/bw-franzoesische-armee.jpg',
      bildtext: 'Soldaten der französischen Armee',
      text: 'Wenn ich schreibe, dass sowohl meine deutschen als auch meine französischen Kameraden begeistert waren, ist das nicht übertrieben!! Die Geländebegehung ist hervorragend geeignet, um auch junge Menschen an das Thema Krieg und das damit verbundene Grauen auf einem Schlachtfeld heran zu führen, ohne die Wehrmacht oder die Sowjetarmee auf irgendeine Weise zu glorifizieren. […] Die insgesamt sieben Stunden waren hervorragend investierte Zeit […].',
      wer: 'Rüdiger E., Oberstleutnant, DEU/FRA AusbEinr TIGER'
    },
    {
      bild: '/assets/stimmen/bw-panzergrenadiere.jpg',
      bildtext: 'Geländebesprechung mit der Bundeswehr',
      text: 'Selten haben wir so einen interessanten Vortrag und eine derart packende Schlachtfeldtour erlebt. […] Wenn ich ehrlich bin kam ich zu Ihnen mit geringen Erwartungen, wurde aber weit vom Gegenteil überzeugt.',
      wer: 'Andre D., Oberfeldwebel, 3./Panzergrenadierbataillon 33'
    },
    {
      bild: '/assets/stimmen/bw-marine.jpg',
      bildtext: 'Politische Bildung mit der Bundesmarine',
      text: 'Von unserer einwöchigen Fahrt nach Berlin und Dresden war der Aufenthalt an den Seelower Höhen der herausragende Höhepunkt.',
      wer: 'Robert V., Fregattenkapitän der Reserve, Leiter KVK Kiel'
    },
    {
      bild: '/assets/stimmen/bw-offiziere-gelaende.jpg',
      bildtext: 'Mit Offizieren der Bundeswehr im Gelände',
      text: 'Die lagebezogene militärgeschichtliche Geländebesprechung wurde […] mit Sachkenntnis, Umsicht und in einer Methodik und Didaktik durchgeführt, welche ich in meiner militärischen Laufbahn als Offizier selten zuvor so erleben durfte!',
      wer: 'Kai F., Oberstleutnant der Reserve'
    },
    {
      bild: '/assets/stimmen/bw-politische-bildung.jpg',
      bildtext: 'Führung für die Bundeswehr im Programm zur politischen Bildung',
      text: 'Diese fachlich sehr versierten und engagierten Kräfte haben es verstanden, Inhalte wie auch Stimmungen zielgruppenorientiert zu vermitteln.',
      wer: 'Oberstleutnant H. Kunze, Dresden'
    },
    {
      text: 'Meine israelischen Gäste zeigten sich von der sehr guten didaktischen, historisch angemessen balancierten und fachlich sehr detailreichen und engagierten Führung […] sehr beeindruckt. Sie meinten, es sei mit der Höhepunkt ihres Besuchsprogramms gewesen.',
      wer: 'Dr. M. Nassua, Hamburg'
    },
    {
      text: 'Wir erlebten eine Führung, die bildreicher, bewegender und somit einprägsamer kaum sein kann. […] Geschichte, die so berührt, regt zum Nachdenken an.',
      wer: 'Wolfgang Z. aus Berlin'
    },
    {
      text: 'Unsere Erwartungen an den Tag und die Führung wurden absolut erfüllt. Wir haben uns ausgesprochen aufgehoben gefühlt. Mit Sicherheit war es nicht unser letzter Besuch in Seelow.',
      wer: 'Ruth W. aus Pankow'
    },
    {
      text: 'Thank you very much for your very informative explanation of the battle. […] I encourage you to continue your excellent work in preserving the memory of the battle there.',
      wer: 'Mark A. Viney, Oklahoma City'
    }
  ];

  var WECHSEL_MS = 8000;

  function el(tag, klasse, text) {
    var e = document.createElement(tag);
    if (klasse) e.className = klasse;
    if (text) e.textContent = text;
    return e;
  }

  function aufbauen(ziel) {
    ziel.classList.add('gs');
    ziel.setAttribute('aria-label', 'Stimmen zu früheren Führungen');
    ziel.appendChild(el('h2', 'gs-titel', 'Stimmen zu früheren Führungen'));

    var band = el('div', 'gs-band');
    band.tabIndex = 0;
    STIMMEN.forEach(function (s, i) {
      var folie = el('figure', 'gs-folie' + (s.bild ? '' : ' gs-ohne-bild'));
      folie.setAttribute('aria-label', (i + 1) + ' von ' + STIMMEN.length);
      if (s.bild) {
        var rahmen = el('div', 'gs-foto');
        var bild = el('img');
        bild.src = s.bild;
        bild.alt = s.bildtext;
        bild.loading = 'lazy';
        rahmen.appendChild(bild);
        rahmen.appendChild(el('span', 'gs-bildtext', s.bildtext));
        folie.appendChild(rahmen);
      }
      var zitat = el('div', 'gs-zitat');
      var q = el('blockquote');
      q.textContent = '„' + s.text + '“';
      zitat.appendChild(q);
      zitat.appendChild(el('figcaption', '', s.wer));
      folie.appendChild(zitat);
      band.appendChild(folie);
    });
    ziel.appendChild(band);

    var leiste = el('div', 'gs-leiste');
    var zurueck = el('button', 'gs-pfeil', '‹');
    zurueck.type = 'button';
    zurueck.setAttribute('aria-label', 'Vorherige Stimme');
    var weiter = el('button', 'gs-pfeil', '›');
    weiter.type = 'button';
    weiter.setAttribute('aria-label', 'Nächste Stimme');
    var punkte = el('div', 'gs-punkte');
    var knoepfe = STIMMEN.map(function (s, i) {
      var p = el('button', 'gs-punkt');
      p.type = 'button';
      p.setAttribute('aria-label', 'Stimme ' + (i + 1));
      p.addEventListener('click', function () { gehe(i); halten = true; });
      punkte.appendChild(p);
      return p;
    });
    leiste.appendChild(zurueck);
    leiste.appendChild(punkte);
    leiste.appendChild(weiter);
    ziel.appendChild(leiste);

    var halten = false;
    var ruhig = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function aktuell() {
      return band.clientWidth ? Math.round(band.scrollLeft / band.clientWidth) : 0;
    }
    function gehe(i) {
      var n = (i + STIMMEN.length) % STIMMEN.length;
      band.scrollTo({ left: n * band.clientWidth, behavior: ruhig ? 'auto' : 'smooth' });
    }
    function markieren() {
      var a = aktuell();
      knoepfe.forEach(function (k, i) { k.classList.toggle('an', i === a); });
    }
    zurueck.addEventListener('click', function () { gehe(aktuell() - 1); halten = true; });
    weiter.addEventListener('click', function () { gehe(aktuell() + 1); halten = true; });
    band.addEventListener('scroll', markieren, { passive: true });
    band.addEventListener('keydown', function (ev) {
      if (ev.key === 'ArrowLeft') { ev.preventDefault(); gehe(aktuell() - 1); halten = true; }
      if (ev.key === 'ArrowRight') { ev.preventDefault(); gehe(aktuell() + 1); halten = true; }
    });
    ['mouseenter', 'focusin', 'touchstart'].forEach(function (a) {
      ziel.addEventListener(a, function () { pause = true; }, { passive: true });
    });
    ['mouseleave', 'focusout'].forEach(function (a) {
      ziel.addEventListener(a, function () { pause = false; });
    });
    var pause = false;
    markieren();
    if (!ruhig) {
      setInterval(function () {
        if (halten || pause || document.hidden || !band.clientWidth) return;
        gehe(aktuell() + 1);
      }, WECHSEL_MS);
    }
  }

  var ziel = document.getElementById('gaeste-stimmen');
  if (ziel) aufbauen(ziel);
})();
