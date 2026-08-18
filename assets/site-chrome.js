/* ==========================================================================
   Gemeinsame Navigation — marschbefehl.com
   Rendert die Kopf-Navigation in <header id="site-header"></header>.
   Einbindung: <script defer src="/assets/site-chrome.js"></script> im <head>,
   zusammen mit <link rel="stylesheet" href="/assets/nav.css">.
   ========================================================================== */
(function(){
  var NAV_ITEMS = [
    {href:'/index.html',        label:'Start'},
    {href:'/videos.html',       label:'Videos'},
    {href:'/artikel/index.html',label:'Artikel', prefix:'/artikel'},
    {href:'/unterstuetzen.html',label:'Unterstützen'},
    {href:'/karte.html',        label:'Karte'},
    {href:'/fuehrungen.html',   label:'Führungen'},
    {href:'/quellen.html',      label:'Literatur'},
    {href:'/kooperationen.html',label:'Kooperationen'},
    {href:'/kontakt.html',      label:'Kontakt'}
  ];

  function normalize(path){
    path = path.replace(/index\.html$/, '');
    if(path === '') path = '/';
    if(path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
    return path;
  }

  function isActive(item){
    var current = normalize(window.location.pathname);
    if(item.prefix){
      return current === item.prefix || current.indexOf(item.prefix + '/') === 0;
    }
    var target = normalize(item.href);
    if(target === '/') return current === '/';
    return current === target;
  }

  function buildLinks(){
    return NAV_ITEMS.map(function(item){
      var active = isActive(item);
      return '<a href="' + item.href + '"' + (active ? ' aria-current="page"' : '') + '>' + item.label + '</a>';
    }).join('');
  }

  function init(){
    var header = document.getElementById('site-header');
    if(!header) return;

    header.className = 'site-header';
    header.innerHTML =
      '<a class="brand" href="/index.html"><img src="/assets/logo.png" alt="">Zeitreise Seelower Höhen</a>' +
      '<nav class="nav-desktop" aria-label="Hauptnavigation">' + buildLinks() + '</nav>' +
      '<button type="button" class="nav-toggle" aria-label="Menü öffnen" aria-expanded="false">' +
        '<span class="bars"><span></span><span></span><span></span></span>' +
      '</button>';

    var backdrop = document.createElement('div');
    backdrop.className = 'nav-mobile-backdrop';
    document.body.appendChild(backdrop);

    var panel = document.createElement('div');
    panel.className = 'nav-mobile-panel';
    panel.innerHTML =
      '<div class="spacer"></div>' +
      '<nav class="nav-mobile-list" aria-label="Hauptnavigation (mobil)">' +
        NAV_ITEMS.map(function(item){
          var active = isActive(item);
          return '<a href="' + item.href + '"' + (active ? ' aria-current="page"' : '') + '>' + item.label + '<span class="arrow" aria-hidden="true">&#8594;</span></a>';
        }).join('') +
      '</nav>';
    document.body.appendChild(panel);

    var toggle = header.querySelector('.nav-toggle');
    var isOpen = false;
    var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function openMenu(){
      isOpen = true;
      toggle.setAttribute('aria-expanded', 'true');
      toggle.setAttribute('aria-label', 'Menü schließen');
      backdrop.classList.add('is-visible');
      document.documentElement.style.overflow = 'hidden';
      if(typeof gsap !== 'undefined' && !reduceMotion){
        gsap.killTweensOf(panel);
        gsap.to(panel, {height:'auto', duration:0.36, ease:'power2.out'});
      }else{
        panel.style.height = 'auto';
      }
    }

    function closeMenu(){
      isOpen = false;
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-label', 'Menü öffnen');
      backdrop.classList.remove('is-visible');
      document.documentElement.style.overflow = '';
      if(typeof gsap !== 'undefined' && !reduceMotion){
        gsap.killTweensOf(panel);
        gsap.to(panel, {height:0, duration:0.28, ease:'power2.in'});
      }else{
        panel.style.height = 0;
      }
    }

    toggle.addEventListener('click', function(){
      if(isOpen) closeMenu(); else openMenu();
    });
    backdrop.addEventListener('click', closeMenu);
    panel.querySelectorAll('a').forEach(function(a){
      a.addEventListener('click', closeMenu);
    });
    document.addEventListener('keydown', function(e){
      if(e.key === 'Escape' && isOpen) closeMenu();
    });
    window.addEventListener('resize', function(){
      if(isOpen && window.innerWidth >= 1040) closeMenu();
    });
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  }else{
    init();
  }
})();
