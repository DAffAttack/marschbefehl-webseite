/* ==========================================================================
   Helles Gelaendenetz hinter den Unterseiten — marschbefehl.com
   Dasselbe Gelaende wie auf der Startseite (gleiche Hoehenformel, gleiche
   Maschenweite), nur hell und zurueckhaltend: Das Netz schimmert langsam und
   hebt sich leicht unter der Maus. Es liegt fest hinter dem Inhalt und laesst
   alle Klicks durch. Wird von site-chrome.js nachgeladen.
   Fehlt WebGL, bleibt die Seite einfach ohne Netz.
   Auf Handy und Tablet wird es gar nicht geladen (siehe site-chrome.js). Bei
   "reduzierter Bewegung" wird nur ein ruhendes Bild gezeichnet.
   ========================================================================== */
(function(){
  'use strict';

  var FARBE = 0x7f9f3a;        // Liniengruen, etwas dunkler als das Markengruen
  var PAPIER = 0xfafaf8;       // Seitenhintergrund, siehe --paper
  var GRUND_DECKKRAFT = 0.17;
  var SCHIMMER = 0.04;         // so weit schwankt die Deckkraft
  var HOVER_RADIUS = 2.6;
  var HOVER_HOEHE = 0.8;       // Startseite: 1.3, hier bewusst nur leicht
  var BILDER_JE_SEKUNDE = 30;

  function start(){
    var canvas = document.createElement('canvas');
    canvas.id = 'netz-hintergrund';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.insertBefore(canvas, document.body.firstChild);

    var renderer;
    try{
      renderer = new THREE.WebGLRenderer({canvas:canvas, antialias:true, alpha:true});
    }catch(e){
      canvas.remove();
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));

    var ruhend = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    var scene = new THREE.Scene();
    scene.fog = new THREE.Fog(PAPIER, 6.5, 15);
    var camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 2.3, 5.2);
    camera.lookAt(0, -0.9, -1);

    var geo = new THREE.PlaneGeometry(30, 20, 94, 62);
    var mat = new THREE.MeshBasicMaterial({color:FARBE, wireframe:true, transparent:true, opacity:GRUND_DECKKRAFT});
    var terrain = new THREE.Mesh(geo, mat);
    terrain.rotation.x = -Math.PI/2.3;
    terrain.position.set(0, -1.9, -2);
    scene.add(terrain);

    function terrainHeight(x, y, t){
      var h = 0;
      h += Math.sin(x*0.28 + 1.7 + Math.sin(t*0.05)*0.7) * Math.cos(y*0.22 + 0.4 + Math.cos(t*0.04)*0.6) * 0.95;
      h += Math.sin(x*0.52 - y*0.33 + 3.1 + t*0.08) * 0.42;
      h += Math.cos(x*0.83 + y*0.66 - 1.2 + Math.sin(t*0.065)*0.9) * 0.22;
      h += Math.sin(x*1.5 + y*1.2 + 4.0 + t*0.1) * 0.09;
      return h;
    }

    var rayPlane = new THREE.Mesh(new THREE.PlaneGeometry(30, 20, 1, 1));
    rayPlane.rotation.copy(terrain.rotation);
    rayPlane.position.copy(terrain.position);
    rayPlane.updateMatrixWorld(true);

    var raycaster = new THREE.Raycaster();
    var pointerNDC = new THREE.Vector2(0, 0);
    var hoverTarget = new THREE.Vector2(0, 0);
    var hoverPos = new THREE.Vector2(0, 0);
    var hoverStrength = 0, hoverTargetStrength = 0;

    var clock = new THREE.Clock();
    var posAttr = geo.attributes.position;

    function zeichnen(t){
      hoverStrength += (hoverTargetStrength - hoverStrength) * 0.1;
      hoverPos.x += (hoverTarget.x - hoverPos.x) * 0.18;
      hoverPos.y += (hoverTarget.y - hoverPos.y) * 0.18;
      for(var i = 0; i < posAttr.count; i++){
        var x = posAttr.getX(i), y = posAttr.getY(i);
        var z = terrainHeight(x, y, t);
        if(hoverStrength > 0.001){
          var dx = x - hoverPos.x, dy = y - hoverPos.y;
          z += hoverStrength * HOVER_HOEHE * Math.exp(-(dx*dx + dy*dy) / (2*HOVER_RADIUS*HOVER_RADIUS));
        }
        posAttr.setZ(i, z);
      }
      posAttr.needsUpdate = true;
      mat.opacity = GRUND_DECKKRAFT + (ruhend ? 0 : Math.sin(t*0.7)*SCHIMMER);
      renderer.render(scene, camera);
    }

    function groesse(){
      renderer.setSize(window.innerWidth, window.innerHeight, false);
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      if(ruhend) zeichnen(0);
    }
    groesse();
    window.addEventListener('resize', groesse);
    canvas.classList.add('ist-da');
    // Textspalte bekommt weissen Grund, das Netz bleibt links, rechts und unten
    // sichtbar (Nutzerwunsch 09.11.2026: Text auf dem Netz schlecht lesbar).
    document.documentElement.classList.add('netz-an');

    if(ruhend) return;

    // Das Netz reagiert nur auf den freien Flaechen neben dem Inhalt. Ueber Text,
    // Bildern, Kopf und Fuss bleibt es ruhig, sonst wird die Seite beim Lesen
    // unruhig (Nutzerwunsch 05.11.2026). Vollbreite Huellen zaehlen als frei: Ihr
    // Rand neben der Inhaltsspalte ist fuer das Auge leerer Hintergrund. Im
    // schmalen Fenster fuellt der Inhalt selbst die Breite, dort gilt das nicht.
    function aufFreierFlaeche(el){
      if(el === document.body || el === document.documentElement) return true;
      if(el.closest('.site-header, footer, .hero, .nav-mobile-panel')) return false;
      return window.innerWidth >= 1100 && el.getBoundingClientRect().width >= window.innerWidth*0.9;
    }
    window.netzAufFreierFlaeche = aufFreierFlaeche; // nur fuer die Pruefung von aussen

    window.addEventListener('mousemove', function(e){
      if(!aufFreierFlaeche(e.target)){ hoverTargetStrength = 0; return; }
      pointerNDC.x = (e.clientX / window.innerWidth) * 2 - 1;
      pointerNDC.y = -(e.clientY / window.innerHeight) * 2 + 1;
      raycaster.setFromCamera(pointerNDC, camera);
      var hit = raycaster.intersectObject(rayPlane)[0];
      if(hit){
        var local = rayPlane.worldToLocal(hit.point.clone());
        hoverTarget.set(local.x, local.y);
        hoverTargetStrength = 1;
      }
    });
    document.documentElement.addEventListener('mouseleave', function(){
      hoverTargetStrength = 0;
    });

    var letztes = 0, abstand = 1000/BILDER_JE_SEKUNDE;
    function schleife(jetzt){
      requestAnimationFrame(schleife);
      if(document.hidden || jetzt - letztes < abstand) return;
      letztes = jetzt;
      zeichnen(clock.getElapsedTime());
    }
    requestAnimationFrame(schleife);
  }

  if(typeof THREE !== 'undefined'){
    start();
  }else{
    var s = document.createElement('script');
    s.src = '/assets/vendor/three.min.js';
    s.onload = start;
    document.body.appendChild(s);
  }
})();
