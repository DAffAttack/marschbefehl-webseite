/* ==========================================================================
   Artikel-Verhalten — marschbefehl.com
   Zusammengefuehrt aus den fuenf JavaScript-Varianten der handgeschriebenen
   Artikel (18.08.2026). Grundlage war fronteinsatz-309-infanteriedivision.html
   als vollstaendigste Fassung, ergaenzt um die Buchkarten-Animation aus
   armeegruppe-steiner.html und die breitere Auswahl '.chapter, .article-image'.

   Alle Animationen laufen ins Leere, wenn ein Artikel den jeweiligen Baustein
   nicht enthaelt — gsap.utils.toArray liefert dann eine leere Liste. Eine
   gemeinsame Datei ist damit fuer alle Artikel gefahrlos.

   Voraussetzung: three.min.js, gsap.min.js und ScrollTrigger.min.js sind
   vorher eingebunden. Fehlen sie, steigen beide Bloecke sauber aus.
   ========================================================================== */

(function(){
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var canvas = document.getElementById('terrain-canvas');
  var hero = document.querySelector('.hero');
  if(!canvas || typeof THREE === 'undefined') return;

  var renderer;
  try{
    renderer = new THREE.WebGLRenderer({canvas:canvas, antialias:true, alpha:true});
  }catch(e){ return; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(0, 2.3, 5.2);
  camera.lookAt(0, -0.9, -1);

  var geo = new THREE.PlaneGeometry(18, 13, 56, 40);
  var mat = new THREE.MeshBasicMaterial({color:0xA1C74F, wireframe:true, transparent:true, opacity:0.24});
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

  function resize(){
    var w = hero.clientWidth, h = hero.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);

  var clock = new THREE.Clock();
  var posAttr = geo.attributes.position;

  function animate(){
    var t = reduceMotion ? 0 : clock.getElapsedTime();
    for(var i=0;i<posAttr.count;i++){
      var x = posAttr.getX(i), y = posAttr.getY(i);
      posAttr.setZ(i, terrainHeight(x, y, t));
    }
    posAttr.needsUpdate = true;
    renderer.render(scene, camera);
    if(!reduceMotion){
      requestAnimationFrame(animate);
    }
  }
  animate();
})();

(function(){
  if(typeof gsap === 'undefined') return;
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  gsap.set('.hero-inner > *', {opacity:0, y:16});
  gsap.to('.hero-inner > *', {opacity:1, y:0, duration:0.9, ease:'power2.out', stagger:0.12, delay:0.1});

  if(reduceMotion){
    document.querySelectorAll('.chapter, .article-image').forEach(function(c){ c.style.opacity = 1; c.style.transform = 'none'; });
    return;
  }

  if(typeof ScrollTrigger !== 'undefined'){
    gsap.registerPlugin(ScrollTrigger);
    gsap.utils.toArray('.chapter, .article-image').forEach(function(chapter){
      gsap.to(chapter, {
        opacity:1, y:0, duration:0.7, ease:'power2.out',
        scrollTrigger:{trigger:chapter, start:'top 85%'}
      });
    });
    gsap.fromTo('.video-cta a', {opacity:0, y:24}, {
      opacity:1, y:0, duration:0.6, ease:'power2.out',
      scrollTrigger:{trigger:'.video-cta', start:'top 90%'}
    });
    gsap.utils.toArray('.book-inline').forEach(function(card){
      gsap.fromTo(card, {opacity:0, y:16}, {
        opacity:1, y:0, duration:0.5, ease:'power2.out',
        scrollTrigger:{trigger:card, start:'top 92%'}
      });
    });
    gsap.utils.toArray('.episode-list a').forEach(function(item){
      gsap.fromTo(item, {opacity:0, y:14}, {
        opacity:1, y:0, duration:0.4, ease:'power2.out',
        scrollTrigger:{trigger:item, start:'top 95%'}
      });
    });
  }
})();
