/* Drehschalter – zentrales Auswahl-Element auf der Startseite.
   Funkgeräte-Optik: das freigegebene Produktfoto (freigestellt, transparenter
   Hintergrund) wird als rotierendes Bild verwendet -- kein nachgebautes 3D,
   sondern das echte Foto per CSS transform gedreht (der Zeiger ist bereits
   Teil des Fotos und dreht dadurch automatisch korrekt mit).
   Drehen per Maus/Touch/Tastatur, Einrasten mit synthetischem Klick-Sound,
   zweiter separater Klick (mit eigenem, tieferem Bestätigungs-Sound)
   navigiert erst dann zur Zielseite.
   Barrierefreier Fallback: echte <a href>-Liste bleibt immer im DOM/sichtbar. */
(function(){
  'use strict';

  var TOPICS = [
    {label:'Videos', href:'/videos.html'},
    {label:'Artikel', href:'/artikel/index.html'},
    {label:'Karte', href:'/karte.html'},
    {label:'Führungen', href:'/fuehrungen.html'},
    {label:'Literatur', href:'/quellen.html'},
    {label:'Unterstützen', href:'/unterstuetzen.html'},
    {label:'Kontakt', href:'/kontakt.html'},
    {label:'Kooperationen', href:'/kooperationen.html'}
  ];
  var STEP = (Math.PI*2)/TOPICS.length;
  // Das Foto zeigt den Zeiger in Ruhestellung nach RECHTS (= 90° im Uhrzeigersinn
  // von oben, unsere Winkel-Konvention). Offset gleicht das aus, damit currentTheta=0
  // (Index 0, "Videos") den Zeiger optisch nach oben zeigen lässt.
  var IMG_REST_OFFSET_DEG = 90;

  var section = document.querySelector('.dial-section');
  var knobWrap = document.getElementById('dialKnob');
  var rotor = document.getElementById('dialRotor');
  var knobImg = document.getElementById('dialKnobImg');
  var lightCone = document.getElementById('dialLightCone');
  var labelsHost = document.getElementById('dialLabels');
  var readoutLabel = document.getElementById('dialReadoutLabel');
  var lightBtn = document.getElementById('dialLightBtn');
  if(!section || !knobWrap || !rotor || !labelsHost || !readoutLabel) return;

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Feste Beschriftungen im Ring positionieren ---------- */
  function layoutLabels(){
    var rect = knobWrap.getBoundingClientRect();
    var r = rect.width/2 + Math.max(38, rect.width*0.19);
    labelsHost.querySelectorAll('.dial-label').forEach(function(el, i){
      var theta = i*STEP;
      var x = Math.sin(theta)*r;
      var y = -Math.cos(theta)*r;
      el.style.transform = 'translate(-50%,-50%) translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px)';
    });
  }
  TOPICS.forEach(function(topic, i){
    var plate = document.createElement('div');
    plate.className = 'dial-label';
    plate.dataset.index = i;
    var text = document.createElement('span');
    text.className = 'dial-label-text';
    text.textContent = topic.label;
    plate.appendChild(text);
    labelsHost.appendChild(plate);
  });

  /* ---------- Web Audio: zwei unterschiedliche synthetische Sounds ---------- */
  var audioCtx = null;
  function ensureAudio(){
    if(audioCtx) return audioCtx;
    try{ audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch(e){ audioCtx = null; }
    return audioCtx;
  }

  // Sound A: kurzer, heller Rast-Klick beim Weiterdrehen auf die nächste Position.
  function playDetentClick(){
    var ctx = ensureAudio();
    if(!ctx) return;
    if(ctx.state === 'suspended'){ ctx.resume(); }
    var now = ctx.currentTime;
    var len = Math.floor(ctx.sampleRate*0.035);
    var buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    var data = buffer.getChannelData(0);
    for(var i=0;i<len;i++){
      data[i] = (Math.random()*2-1) * Math.pow(1 - i/len, 3.2);
    }
    var noise = ctx.createBufferSource();
    noise.buffer = buffer;
    var band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.setValueAtTime(2400, now);
    band.frequency.exponentialRampToValueAtTime(750, now+0.03);
    band.Q.value = 4;
    var gain = ctx.createGain();
    gain.gain.setValueAtTime(0.55, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now+0.04);
    noise.connect(band); band.connect(gain); gain.connect(ctx.destination);
    noise.start(now);
    noise.stop(now+0.05);
  }

  // Sound B: satter, mechanischer Schnapper wie ein alter Kippschalter/Relais --
  // rein Noise-basiert (kein Sinuston/Piepser), hörbar voller/tiefer als der
  // helle Rast-Klick, mit tiefem "Thunk"-Nachschlag für das Gefühl von Gewicht.
  function playConfirmSound(){
    var ctx = ensureAudio();
    if(!ctx) return;
    if(ctx.state === 'suspended'){ ctx.resume(); }
    var now = ctx.currentTime;

    function noiseBurst(startTime, dur, curve, connectChain, peakGain, attack){
      var len = Math.max(4, Math.floor(ctx.sampleRate*dur));
      var buffer = ctx.createBuffer(1, len, ctx.sampleRate);
      var data = buffer.getChannelData(0);
      for(var i=0;i<len;i++){
        data[i] = (Math.random()*2-1) * Math.pow(1 - i/len, curve);
      }
      var src = ctx.createBufferSource();
      src.buffer = buffer;
      var gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, startTime);
      gain.gain.exponentialRampToValueAtTime(peakGain, startTime + attack);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + dur);
      var node = src;
      connectChain.forEach(function(filter){ node.connect(filter); node = filter; });
      node.connect(gain);
      gain.connect(ctx.destination);
      src.start(startTime);
      src.stop(startTime + dur + 0.02);
    }

    // 1) Harter, kurzer Anschlag -- der eigentliche "Schnapper" des Kontakts,
    //    sehr kurzer Attack/Decay, breitbandig+crisp (Hochpass) für metallische Härte.
    var hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 900;
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 6000;
    noiseBurst(now, 0.016, 1.5, [hp, lp], 0.9, 0.001);

    // 2) Tiefer Thunk direkt danach -- mechanisches Gewicht/Gehäuse-Resonanz,
    //    NUR gefilterter Noise (kein Oszillator), damit es nicht "piept".
    var thunkStart = now + 0.014;
    var lpThunk = ctx.createBiquadFilter();
    lpThunk.type = 'lowpass';
    lpThunk.frequency.setValueAtTime(420, thunkStart);
    lpThunk.frequency.exponentialRampToValueAtTime(110, thunkStart + 0.08);
    lpThunk.Q.value = 1.1;
    noiseBurst(thunkStart, 0.1, 2.1, [lpThunk], 0.75, 0.006);

    // 3) Winziger Feder-Nachklapper (Rückstellung des Schaltmechanismus)
    var tailStart = now + 0.078;
    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1900;
    bp.Q.value = 3;
    noiseBurst(tailStart, 0.018, 1.8, [bp], 0.22, 0.001);
  }

  // Sound C: der Kippschalter fürs Licht -- lauter/kräftiger Umleg-Klick,
  // bewusst deutlicher gemischt als die beiden Hauptschalter-Sounds oben,
  // ebenfalls reiner gefilterter Noise (kein Oszillator), damit es nach
  // echtem Metall-Kontakt statt Piepton klingt. Gleicher Klick für beide
  // Richtungen (an/aus) -- ein Kippschalter macht in beide Richtungen
  // denselben Anschlag.
  function playToggleClick(){
    var ctx = ensureAudio();
    if(!ctx) return;
    if(ctx.state === 'suspended'){ ctx.resume(); }
    var now = ctx.currentTime;

    function noiseBurst(startTime, dur, curve, connectChain, peakGain, attack){
      var len = Math.max(4, Math.floor(ctx.sampleRate*dur));
      var buffer = ctx.createBuffer(1, len, ctx.sampleRate);
      var data = buffer.getChannelData(0);
      for(var i=0;i<len;i++){
        data[i] = (Math.random()*2-1) * Math.pow(1 - i/len, curve);
      }
      var src = ctx.createBufferSource();
      src.buffer = buffer;
      var gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, startTime);
      gain.gain.exponentialRampToValueAtTime(peakGain, startTime + attack);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + dur);
      var node = src;
      connectChain.forEach(function(filter){ node.connect(filter); node = filter; });
      node.connect(gain);
      gain.connect(ctx.destination);
      src.start(startTime);
      src.stop(startTime + dur + 0.02);
    }

    // 1) Harter metallischer Anschlag -- kräftiger/lauter als der Haupt-
    //    schalter-Klick (Sound A), breitbandiger Hochpass für schärferes,
    //    knackigeres Transient.
    var hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 700;
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 7200;
    noiseBurst(now, 0.02, 1.3, [hp, lp], 1.0, 0.0008);

    // 2) Voller, kräftiger Thunk direkt danach -- deutlich lauter/tiefer
    //    im Pegel als der Bestätigungs-Sound des Hauptschalters, damit der
    //    Kippschalter spürbar "kräftiger" wirkt.
    var thunkStart = now + 0.012;
    var lpThunk = ctx.createBiquadFilter();
    lpThunk.type = 'lowpass';
    lpThunk.frequency.setValueAtTime(500, thunkStart);
    lpThunk.frequency.exponentialRampToValueAtTime(90, thunkStart + 0.1);
    lpThunk.Q.value = 1.3;
    noiseBurst(thunkStart, 0.13, 2.0, [lpThunk], 0.95, 0.005);

    // 3) Kurzer metallischer Nachklang (Gehäuseresonanz)
    var tailStart = now + 0.09;
    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1500;
    bp.Q.value = 2.6;
    noiseBurst(tailStart, 0.03, 1.6, [bp], 0.32, 0.001);
  }

  /* ---------- Zustand ---------- */
  var currentTheta = 0;        // aktuell gerenderter Drehwinkel (Bildschirm-CW-von-oben)
  var settleTarget = 0;        // Ziel beim Einrasten
  var settling = false;
  var loopRunning = false;
  var armedIndex = 0;          // aktuell "eingerastet" angezeigtes Thema
  var lastSnapIndex = 0;
  var isLit = false;

  function normIndex(i){ return ((i % TOPICS.length) + TOPICS.length) % TOPICS.length; }

  function setArmed(idx, opts){
    opts = opts || {};
    armedIndex = normIndex(idx);
    var topic = TOPICS[armedIndex];
    if(readoutLabel.textContent !== topic.label){
      if(!reduceMotion && typeof gsap !== 'undefined' && !opts.silent){
        gsap.fromTo(readoutLabel, {opacity:0, y:6}, {opacity:1, y:0, duration:0.22, ease:'power2.out'});
      }
      readoutLabel.textContent = topic.label;
    }
    knobWrap.setAttribute('aria-valuenow', String(armedIndex));
    knobWrap.setAttribute('aria-valuetext', topic.label);
    labelsHost.querySelectorAll('.dial-label').forEach(function(el){
      el.classList.toggle('is-active', Number(el.dataset.index) === armedIndex);
    });
  }

  function updateFromTheta(theta, opts){
    opts = opts || {};
    var rawIndex = Math.round(theta/STEP);
    var snapIndex = normIndex(rawIndex);
    if(snapIndex !== lastSnapIndex || opts.force){
      lastSnapIndex = snapIndex;
      if(!opts.silent) playDetentClick();
      setArmed(snapIndex, opts);
    }
  }

  /* ---------- Rotation des Foto-Elements ---------- */
  function applyRotation(){
    var deg = currentTheta*180/Math.PI - IMG_REST_OFFSET_DEG;
    rotor.style.transform = 'rotate(' + deg.toFixed(2) + 'deg)';
  }

  function startLoop(){
    if(loopRunning) return;
    loopRunning = true;
    requestAnimationFrame(loopTick);
  }
  function loopTick(){
    if(settling){
      currentTheta += (settleTarget - currentTheta) * 0.22;
      if(Math.abs(settleTarget - currentTheta) < 0.0008){
        currentTheta = settleTarget;
        settling = false;
      }
      applyRotation();
      requestAnimationFrame(loopTick);
    } else {
      applyRotation();
      loopRunning = false;
    }
  }

  /* ---------- Interaktion: Drag / Touch ---------- */
  var dragging = false;
  var dragStartX = 0, dragStartY = 0, dragMoved = false;
  var lastPointerTheta = 0;
  var pointerDownTime = 0;
  var focusFromPointer = false;

  function screenThetaFromEvent(e){
    var rect = knobWrap.getBoundingClientRect();
    var cx = rect.left + rect.width/2, cy = rect.top + rect.height/2;
    var dx = e.clientX - cx, dy = e.clientY - cy;
    return Math.atan2(dx, -dy);
  }
  function shortestDiff(a, b){
    var d = a - b;
    while(d > Math.PI) d -= Math.PI*2;
    while(d < -Math.PI) d += Math.PI*2;
    return d;
  }

  // knobWrap ist ein eckiges Element (für die kreisrunde Drehgeste braucht es
  // ein Quadrat als Referenzrahmen), der sichtbare Knopf darin ist aber rund
  // und kleiner als das Quadrat. Ohne diese Prüfung reagieren Klicks in den
  // Ecken des Quadrats (dort, wo die schräg stehenden Ring-Schildchen sitzen,
  // z.B. Kooperationen/Artikel/Unterstützen/Führungen) fälschlich auf den
  // Knopf, obwohl dort optisch nur leerer Raum bzw. ein Schildchen zu sehen
  // ist -- vom Nutzer am 2026-08-17 gemeldet und hierdurch behoben.
  function istInnerhalbDesRundenKnopfs(e){
    var rect = knobWrap.getBoundingClientRect();
    var cx = rect.left + rect.width/2, cy = rect.top + rect.height/2;
    var dx = e.clientX - cx, dy = e.clientY - cy;
    var radius = Math.min(rect.width, rect.height) / 2;
    return Math.hypot(dx, dy) <= radius;
  }

  function onPointerDown(e){
    if(e.button !== undefined && e.button !== 0) return;
    if(!istInnerhalbDesRundenKnopfs(e)) return;
    dragging = true;
    dragMoved = false;
    settling = false;
    pointerDownTime = Date.now();
    dragStartX = e.clientX; dragStartY = e.clientY;
    lastPointerTheta = screenThetaFromEvent(e);
    knobWrap.classList.add('is-dragging');
    focusFromPointer = true;
    knobWrap.focus({preventScroll:true});
    try{ knobWrap.setPointerCapture(e.pointerId); }catch(err){}
    ensureAudio();
  }
  function onPointerMove(e){
    if(!dragging) return;
    var dist = Math.hypot(e.clientX-dragStartX, e.clientY-dragStartY);
    if(dist > 5) dragMoved = true;
    var theta = screenThetaFromEvent(e);
    var delta = shortestDiff(theta, lastPointerTheta);
    lastPointerTheta = theta;
    currentTheta += delta;
    applyRotation();
    updateFromTheta(currentTheta);
  }
  function onPointerUp(e){
    if(!dragging) return;
    dragging = false;
    knobWrap.classList.remove('is-dragging');
    var wasQuickTap = !dragMoved && (Date.now() - pointerDownTime) < 400;
    var rawIndex = Math.round(currentTheta/STEP);
    settleTarget = rawIndex*STEP;
    settling = true;
    startLoop();
    updateFromTheta(currentTheta, {silent:true});
    if(wasQuickTap){
      navigateToArmed();
    }
  }

  knobWrap.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);

  /* ---------- Tastatur ---------- */
  knobWrap.addEventListener('keydown', function(e){
    var handled = true;
    var base = settling ? settleTarget : Math.round(currentTheta/STEP)*STEP;
    if(e.key === 'ArrowRight' || e.key === 'ArrowUp'){
      settleTarget = base + STEP;
      settling = true; startLoop();
      updateFromTheta(settleTarget);
    } else if(e.key === 'ArrowLeft' || e.key === 'ArrowDown'){
      settleTarget = base - STEP;
      settling = true; startLoop();
      updateFromTheta(settleTarget);
    } else if(e.key === 'Home'){
      settleTarget = 0; settling = true; startLoop(); updateFromTheta(settleTarget);
    } else if(e.key === 'End'){
      settleTarget = (TOPICS.length-1)*STEP; settling = true; startLoop(); updateFromTheta(settleTarget);
    } else if(e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar'){
      navigateToArmed();
    } else {
      handled = false;
    }
    if(handled) e.preventDefault();
  });

  function navigateToArmed(){
    var topic = TOPICS[armedIndex];
    if(!topic) return;
    // Sound darf die Navigation nie blockieren -- falls WebAudio in einer
    // bestimmten Browser-/Umgebungskonstellation wirft (z.B. Autoplay-Policy,
    // deaktiviertes WebAudio), muss die Seite trotzdem wechseln.
    try{ playConfirmSound(); } catch(err){ /* Sound ist rein kosmetisch */ }
    knobWrap.classList.add('is-confirmed');
    // kurze Pause, damit der Bestätigungs-Sound spürbar anklingen kann, bevor die Seite wechselt
    window.setTimeout(function(){
      window.location.href = topic.href;
    }, 130);
  }

  /* ---------- Beleuchtungs-Knopf ---------- */
  if(lightBtn){
    lightBtn.addEventListener('click', function(){
      isLit = !isLit;
      ensureAudio();
      playToggleClick();
      lightBtn.setAttribute('aria-pressed', String(isLit));
      lightBtn.classList.toggle('is-lit', isLit);
      if(lightCone) lightCone.classList.toggle('is-lit', isLit);
    });
  }

  /* ---------- Fokus-Ring nur für echte Tastatur-Bedienung (kein Ring bei Maus/Touch) ---------- */
  knobWrap.addEventListener('focus', function(){
    if(!focusFromPointer){
      knobWrap.classList.add('kbd-focus');
    }
    focusFromPointer = false;
  });
  knobWrap.addEventListener('blur', function(){
    knobWrap.classList.remove('kbd-focus');
  });

  /* ---------- Init / Resize / Fallback ---------- */
  function activateFallback(){
    section.classList.add('dial-fallback-active');
  }

  window.addEventListener('resize', function(){
    layoutLabels();
  });

  if(reduceMotion){
    activateFallback();
  } else if(knobImg){
    knobImg.addEventListener('error', activateFallback);
  }

  layoutLabels();
  setArmed(0, {silent:true});
  lastSnapIndex = 0;
  applyRotation();

  /* Einblende-Animation des Panels */
  if(!reduceMotion && typeof gsap !== 'undefined'){
    gsap.set('.dial-panel', {opacity:0, y:24});
    if(typeof ScrollTrigger !== 'undefined'){
      gsap.registerPlugin(ScrollTrigger);
      gsap.to('.dial-panel', {opacity:1, y:0, duration:0.7, ease:'power2.out', scrollTrigger:{trigger:'.dial-panel', start:'top 90%'}});
    } else {
      gsap.to('.dial-panel', {opacity:1, y:0, duration:0.7, ease:'power2.out', delay:0.1});
    }
  } else {
    var panel = document.querySelector('.dial-panel');
    if(panel){ panel.style.opacity = 1; panel.style.transform = 'none'; }
  }
})();
