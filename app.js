/* Avinox Mode Planner — interfaccia. Tutti i calcoli sono in planner.js, i testi in i18n.js. */
(function () {
  'use strict';
  var P = window.AvinoxPlanner, I18N = window.AvinoxI18n;
  var $ = function (id) { return document.getElementById(id); };
  var LABEL = { eco: 'ECO', auto: 'AUTO', trail: 'TRAIL', turbo: 'TURBO', boost: 'BOOST' };
  var SENS = { alta: { minUp: 300, minLen: 500 }, media: { minUp: 400, minLen: 800 }, bassa: { minUp: 600, minLen: 1200 } };
  var DEFAULT_MAP = { flat: 'eco', rolling: 'auto', climb: 'trail', steep: 'turbo', extreme: 'turbo' };
  var STORE_KEY = 'avinox-mode-planner-v1';
  var RIDES_KEY = 'avinox-mode-planner-rides';
  var LANG_KEY = 'avinox-mode-planner-lang';
  var NEW_HOME = 'https://avinox-planner.pages.dev/';   // indirizzo principale dell'app (Cloudflare Pages)
  /* Donazioni. Con i Payment Link di Stripe (https://buy.stripe.com/...) la pagina mostra gli importi:
     un tocco e si paga con Apple Pay, Google Pay o carta, poi Stripe riporta qui con ?grazie.
     Finché i link sono vuoti resta il pulsante di Ko-fi. */
  var DONATE = {
    kofi: 'https://ko-fi.com/andicola',
    paypal: 'https://ko-fi.com/andicola',   // PayPal passa da Ko-fi (collegato lì)
    amounts: [
      { eur: 3, url: 'https://buy.stripe.com/7sYfZi9Ehg1r9i57vE7IY00' },
      { eur: 5, url: 'https://buy.stripe.com/fZu6oIbMpg1rbqd03c7IY01' },
      { eur: 10, url: 'https://buy.stripe.com/7sYfZibMp2aBcuh5nw7IY02' }
    ],
    custom: 'https://buy.stripe.com/aFa8wQ5o1bLbdylcPY7IY03'
  };
  /* Spinta stimata dal peso del ciclista quando potenza e cadenza non sono note. */
  var EFFORT = { poco: { wkg: 1.2 }, normale: { wkg: 1.6 }, tanto: { wkg: 2.2 } };
  var EST_CADENCE = 80;

  var state = {
    rider: { riderWeight: 82, bikeWeight: 24.2, bike: 'M2S', battery: 'RS800', style: 'bilanciato', effort: 'normale', riderPower: 150, cadence: 80 },
    route: { strategy: 'waypoint', maxWp: 25, temperature: 'warm', useCal: true, mapping: Object.assign({}, DEFAULT_MAP), sens: 'media', lead: 100, boost: false, startPct: 100, reservePct: 15, surface: 'mixed', adapt: true },
    modes: null, file: null, base: null, result: null, schemaText: '', osm: null, rides: []
  };

  /* ---------------- lingua ---------------- */
  var LANG = 'it';
  function detectLang() {
    try { var s = localStorage.getItem(LANG_KEY); if (s === 'it' || s === 'en') return s; } catch (e) { /* ignora */ }
    var nav = (navigator.languages && navigator.languages[0]) || navigator.language || 'it';
    return /^it\b/i.test(nav) ? 'it' : 'en';
  }
  function t(key, vars) {
    var s = (I18N[LANG] && I18N[LANG][key]) || I18N.it[key] || key;
    return vars ? s.replace(/\{(\w+)\}/g, function (m, k) { return vars[k] != null ? vars[k] : m; }) : s;
  }
  function locale() { return LANG === 'en' ? 'en-GB' : 'it-IT'; }
  function n1(x) { return (Math.round(x * 10) / 10).toLocaleString(locale()); }
  function d2(x) { return P.dec(x, 2); }
  function applyStatic() {
    document.documentElement.lang = LANG;
    Array.prototype.forEach.call(document.querySelectorAll('[data-i18n]'), function (el) { el.textContent = t(el.dataset.i18n); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-i18n-html]'), function (el) { el.innerHTML = t(el.dataset.i18nHtml); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-i18n-ph]'), function (el) { el.placeholder = t(el.dataset.i18nPh); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-i18n-aria]'), function (el) { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
    Array.prototype.forEach.call(document.querySelectorAll('#langSeg button'), function (b) { b.setAttribute('aria-pressed', b.dataset.lang === LANG ? 'true' : 'false'); });
  }
  function setLang(l) {
    LANG = l === 'en' ? 'en' : 'it';
    P.setLang(LANG);
    try { localStorage.setItem(LANG_KEY, LANG); } catch (e) { /* ignora */ }
    applyStatic();
    fillSelects();
    renderEffort();
    renderStrategy();
    renderSchema();
    if (state.file && state.file.sample) state.file.name = P.sampleRoute().name;
    $('calMsg').textContent = ''; delete $('calMsg').dataset.keep;
    $('dataMsg').textContent = ''; $('dlStatus').textContent = '';
    renderDonate();
    replan();
  }

  /* ---------------- donazioni ---------------- */
  var HEART = '';
  function stripeOn() { return DONATE.amounts.some(function (a) { return a.url; }) || !!DONATE.custom; }
  function renderDonate() {
    var on = stripeOn(), text = $('donateText');
    text.dataset.i18n = on ? 'donate.textStripe' : 'donate.text';
    text.textContent = t(text.dataset.i18n);
    $('donateHint').hidden = !on;
    $('donateHint').textContent = on ? t('donate.stripeHint') + (DONATE.paypal ? ' ' + t('donate.paypalHint') : '') : '';
    var link = function (url, cls, label) { return '<a class="btn ' + cls + '" href="' + esc(url) + '" target="_blank" rel="noopener">' + label + '</a>'; };
    var html;
    if (on) {
      var fmt = function (eur) { try { return new Intl.NumberFormat(locale(), { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(eur); } catch (e) { return eur + ' €'; } };
      html = DONATE.amounts.filter(function (a) { return a.url; }).map(function (a) { return link(a.url, 'primary donate', HEART + '<span>' + esc(fmt(a.eur)) + '</span>'); }).join('') +
        (DONATE.custom ? link(DONATE.custom, 'donate', '<span>' + esc(t('donate.other')) + '</span>') : '') +
        (DONATE.paypal ? link(DONATE.paypal, 'donate', '<span>PayPal</span>') : '');
    } else {
      html = link(DONATE.kofi, 'primary donate', HEART + '<span>' + esc(t('donate.cta')) + '</span>');
    }
    $('donateActions').innerHTML = html;
    var top = document.querySelector('.top-actions .donate-link');
    if (on) { top.href = '#donate'; top.removeAttribute('target'); top.removeAttribute('rel'); }
    else { top.href = DONATE.kofi; top.target = '_blank'; top.rel = 'noopener'; }
  }
  function bindDonate() {
    var top = document.querySelector('.top-actions .donate-link');
    HEART = top.querySelector('svg').outerHTML;
    top.addEventListener('click', function (ev) {
      if (top.getAttribute('href') !== '#donate') return;
      ev.preventDefault();
      $('donate').scrollIntoView({ behavior: 'smooth', block: 'center' });
      var first = $('donateActions').querySelector('a');
      if (first) setTimeout(function () { first.focus({ preventScroll: true }); }, 400);
    });
    // ritorno da Stripe dopo il pagamento
    var q = location.search;
    if (/[?&](grazie|thanks)\b/.test(q)) {
      $('thanks').dataset.i18n = 'donate.thanks';
      $('thanks').hidden = false;
      try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) { /* ignora */ }
    }
  }

  /* ---------------- memoria del browser ---------------- */
  function loadRides() {
    try { var a = JSON.parse(localStorage.getItem(RIDES_KEY) || '[]'); state.rides = Array.isArray(a) ? a : []; } catch (e) { state.rides = []; }
  }
  function saveRides() { try { localStorage.setItem(RIDES_KEY, JSON.stringify(state.rides)); } catch (e) { /* ignora */ } }
  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      var s = JSON.parse(raw);
      if (s.rider) {
        // salvataggi precedenti senza "effort": avevano potenza e cadenza scritte a mano
        if (!s.rider.effort && s.rider.riderPower) s.rider.effort = 'manuale';
        Object.assign(state.rider, s.rider);
      }
      if (s.route) { Object.assign(state.route, s.route); state.route.mapping = Object.assign({}, DEFAULT_MAP, s.route.mapping || {}); }
      if (!P.BIKES[state.rider.bike]) state.rider.bike = 'M2S';
      if (!P.BATTERIES[state.rider.battery]) state.rider.battery = 'RS800';
    } catch (e) { /* memoria del browser non disponibile */ }
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ rider: state.rider, route: state.route })); } catch (e) { /* ignora */ }
  }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function batteryWh() { return (P.BATTERIES[state.rider.battery] || P.BATTERIES.RS800).wh; }

  /* ---------------- schema ---------------- */
  function riderPower() {
    var r = state.rider, e = EFFORT[r.effort];
    return e ? Math.max(40, Math.round((e.wkg * r.riderWeight) / 5) * 5) : r.riderPower;
  }
  function riderCadence() { return EFFORT[state.rider.effort] ? EST_CADENCE : state.rider.cadence; }
  function modesFor(style) {
    var r = state.rider;
    return P.calcModes({ bike: r.bike, riderWeight: r.riderWeight, bikeWeight: r.bikeWeight, cadence: riderCadence(), riderPower: riderPower(), wkg: P.PRESETS[style].wkg });
  }
  function modeRow(cls, name, sub, m, extra) {
    var range = m.levelMin !== m.levelMax;
    var row = el('div', 'mrow ' + cls);
    row.appendChild(el('div', 'mname', '<b>' + esc(name) + '</b><span>' + esc(sub) + '</span>'));
    row.appendChild(el('div', 'cell c1', '<span class="k">' + t(range ? 'cell.levels' : 'cell.level') + '</span><span class="v">' +
      (range ? m.levelMin + '–' + m.levelMax : m.levelMin) + '</span><span class="s">' + (range ? m.pctMin + '–' + m.pctMax : m.pctMin) + '%</span>'));
    row.appendChild(el('div', 'cell', '<span class="k">' + t('cell.power') + '</span><span class="v">' + m.maxPower + '<small>W</small></span><span class="s">' + d2(m.wkg) + ' W/kg</span>'));
    row.appendChild(el('div', 'cell', '<span class="k">' + t('cell.torque') + '</span><span class="v">' + m.maxTorque + '<small>Nm</small></span><span class="s">&nbsp;</span>'));
    row.appendChild(el('div', 'dyn', '<span>' + t('dyn.overrun') + ' <b>' + m.overrun + '</b></span><span>' + t('dyn.start') + ' <b>' + m.start + '</b></span><span>' +
      t('dyn.cont') + ' <b>' + m.continued + '</b></span>' + (m.accel != null ? '<span>' + t('dyn.accel') + ' <b>' + m.accel + '</b></span>' : '') +
      (extra ? '<span>' + esc(extra) + '</span>' : '')));
    (m.warnings || []).forEach(function (w) { row.appendChild(el('div', 'mwarn', esc(w))); });
    return row;
  }
  function copyLine(label, m) {
    var range = m.levelMin !== m.levelMax;
    return (label + '      ').slice(0, 6) + (range ? t('copy.levels') + ' ' + m.levelMin + '–' + m.levelMax : t('copy.level') + ' ' + m.levelMin) +
      ' · ' + m.maxPower + ' W · ' + m.maxTorque + ' Nm · overrun ' + m.overrun + ' · ' + t('copy.start') + ' ' + m.start + ' · ' + t('copy.cont') + ' ' + m.continued +
      (m.accel != null ? ' · ' + t('copy.accel') + ' ' + m.accel : '');
  }

  function renderSchema() {
    var r = state.rider;
    var res = modesFor(r.style);
    state.modes = res.error ? null : res;
    var box = $('modes');
    box.innerHTML = '';
    $('styleHint').textContent = t('styleHint.' + r.style);
    if (res.error) {
      box.appendChild(el('div', 'callout', esc(res.error)));
      $('sheetFoot').innerHTML = ''; $('sheetMeta').textContent = ''; state.schemaText = '';
      return;
    }
    var est = EFFORT[r.effort];
    var pw = riderPower(), cad = riderCadence();
    var who = est ? t('who.est', { w: pw, label: t('effort.' + r.effort) }) : pw + ' W · ' + cad + ' rpm';
    var style = t('style.' + r.style);
    $('sheetMeta').textContent = res.bike.name + ' · ' + t('sheet.meta', { kg: n1(res.totalWeight), who: who, style: style });
    var lines = [t('copy.head', { motor: res.bike.id, kg: n1(res.totalWeight), who: who, style: style })];
    P.MODE_KEYS.forEach(function (k) {
      var m = res.modes[k];
      box.appendChild(modeRow('mode-' + k, m.label, t(m.levelMin !== m.levelMax ? 'mode.range' : 'mode.fixed'), m));
      lines.push(copyLine(m.label, m));
    });
    var rv = res.reserve;
    box.appendChild(modeRow('mode-reserve', t('reserve.name'), t('mode.custom'), rv, t('dyn.extra')));
    lines.push(t('copy.reserve') + ' ' + t('copy.level') + ' ' + rv.levelMin + ' · ' + rv.maxPower + ' W · ' + rv.maxTorque + ' Nm · overrun 1 · ' +
      t('copy.start') + ' 1 · ' + t('copy.cont') + ' 1');
    var bat = P.BATTERIES[r.battery] || P.BATTERIES.RS800, bike = res.bike, boost;
    if (bike.id === 'M2') boost = t('foot.boostM2', { p: bike.boostPower, t: bike.boostTorque });
    else if (bat.fullBoost) boost = t('foot.boostFull', { p: bike.boostPower, t: bike.boostTorque, bat: bat.id });
    else boost = t('foot.boostLimited', { t: bike.boostTorque, bat: bat.id });
    var foot = '<p class="boost">' + boost + '</p><p>' + t('foot.reserve') + '</p><p>' + t('foot.range') + '</p><p>' + t('foot.names') + '</p>';
    res.warnings.filter(function (w) { return !(est && w.indexOf('120 W') >= 0); })
      .forEach(function (w) { foot += '<p class="callout">' + esc(w) + '</p>'; });
    $('sheetFoot').innerHTML = foot;
    lines.push('Boost ' + (bike.id === 'M2' || bat.fullBoost ? bike.boostPower : 1300) + ' W / ' + bike.boostTorque + ' Nm (' + bat.id + '), 30 s');
    state.schemaText = lines.join('\n');
  }

  function onRiderChange() { save(); renderSchema(); replan(); }

  function renderEffort() {
    var r = state.rider, est = EFFORT[r.effort];
    $('manualIn').hidden = !!est;
    $('effortEst').textContent = est ? t('effort.est', { w: riderPower(), rpm: EST_CADENCE }) : '';
    $('effortEst').hidden = !est;
  }

  function pressGroup(selector, attr, value) {
    Array.prototype.forEach.call(document.querySelectorAll(selector), function (b) { b.setAttribute('aria-pressed', b.dataset[attr] === value ? 'true' : 'false'); });
  }

  function bindRider() {
    Array.prototype.forEach.call(document.querySelectorAll('#effortSeg button'), function (b) {
      b.addEventListener('click', function () { state.rider.effort = b.dataset.effort; pressGroup('#effortSeg button', 'effort', state.rider.effort); renderEffort(); onRiderChange(); });
    });
    pressGroup('#effortSeg button', 'effort', state.rider.effort);
    ['riderWeight', 'bikeWeight', 'cadence', 'riderPower'].forEach(function (id) {
      $(id).value = state.rider[id];
      $(id).addEventListener('input', function () {
        var v = parseFloat($(id).value);
        if (isFinite(v)) { state.rider[id] = v; renderEffort(); onRiderChange(); }
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('#bikeSeg button'), function (b) {
      b.addEventListener('click', function () { state.rider.bike = b.dataset.bike; pressGroup('#bikeSeg button', 'bike', state.rider.bike); onRiderChange(); });
    });
    pressGroup('#bikeSeg button', 'bike', state.rider.bike);
    $('battery').addEventListener('change', function () { state.rider.battery = $('battery').value; onRiderChange(); });
    Array.prototype.forEach.call(document.querySelectorAll('#styleSeg button'), function (b) {
      b.addEventListener('click', function () { state.rider.style = b.dataset.style; pressGroup('#styleSeg button', 'style', state.rider.style); onRiderChange(); });
    });
    pressGroup('#styleSeg button', 'style', state.rider.style);
    $('riderForm').addEventListener('submit', function (e) { e.preventDefault(); });
    renderEffort();
  }

  /* Select con testi che dipendono dalla lingua. */
  function fillSelects() {
    var R = state.route, r = state.rider;
    $('battery').innerHTML = Object.keys(P.BATTERIES).map(function (k) { return '<option value="' + k + '">' + k + ' · ' + P.BATTERIES[k].wh + ' Wh</option>'; }).join('');
    $('battery').value = r.battery;
    $('temperature').innerHTML = Object.keys(P.TEMPERATURES).map(function (k) { return '<option value="' + k + '">' + t('temp.' + k) + '</option>'; }).join('');
    $('temperature').value = R.temperature;
    $('surface').innerHTML = Object.keys(P.SURFACES).map(function (k) { return '<option value="' + k + '">' + t('surface.' + k) + '</option>'; }).join('');
    $('surface').value = R.surface;
    $('sens').innerHTML = ['alta', 'media', 'bassa'].map(function (k) { return '<option value="' + k + '">' + t('sens.' + k) + '</option>'; }).join('');
    $('sens').value = R.sens;
    var v = SENS[R.sens] || SENS.media;
    $('sensHint').textContent = t('sens.hint', { up: v.minUp, len: v.minLen });
  }

  /* ---------------- percorso ---------------- */
  function renderStrategy() {
    var auto = state.route.strategy === 'auto';
    pressGroup('#stratSeg button', 'strategy', state.route.strategy);
    document.querySelector('.grp-map').hidden = auto;
    $('sensField').hidden = auto;
    $('adaptTxt').textContent = t(auto ? 'adapt.auto' : 'adapt.waypoint');
    $('stratHint').textContent = t(auto ? 'strat.hintAuto' : 'strat.hintWaypoint');
  }

  function bindRoute() {
    var R = state.route;
    Array.prototype.forEach.call(document.querySelectorAll('#stratSeg button'), function (b) {
      b.addEventListener('click', function () { R.strategy = b.dataset.strategy; renderStrategy(); save(); replan(); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('#mapGrid select'), function (s) {
      s.innerHTML = P.MODE_KEYS.map(function (k) { return '<option value="' + k + '">' + LABEL[k] + '</option>'; }).join('');
      var band = s.dataset.band;
      s.value = R.mapping[band];
      s.className = 'mode-' + s.value;
      s.addEventListener('change', function () { R.mapping[band] = s.value; s.className = 'mode-' + s.value; save(); replan(); });
    });
    $('temperature').addEventListener('change', function () { R.temperature = $('temperature').value; save(); replan(); });
    $('surface').addEventListener('change', function () { R.surface = $('surface').value; save(); replan(); });
    $('osmBtn').addEventListener('click', readOsm);
    $('calibForm').addEventListener('submit', function (ev) { ev.preventDefault(); saveRide(); });
    $('calUse').checked = !!R.useCal;
    $('calUse').addEventListener('change', function () { R.useCal = $('calUse').checked; save(); replan(); });
    var slider = function (id, out, key) {
      $(id).value = R[key]; $(out).textContent = R[key] + '%';
      $(id).addEventListener('input', function () { R[key] = +$(id).value; $(out).textContent = R[key] + '%'; save(); replan(); });
    };
    slider('startPct', 'startOut', 'startPct');
    slider('reservePct', 'reserveOut', 'reservePct');
    $('adaptChk').checked = !!R.adapt;
    $('adaptChk').addEventListener('change', function () { R.adapt = $('adaptChk').checked; save(); replan(); });
    $('sens').addEventListener('change', function () {
      R.sens = $('sens').value;
      var v = SENS[R.sens] || SENS.media;
      $('sensHint').textContent = t('sens.hint', { up: v.minUp, len: v.minLen });
      save(); replan();
    });
    $('lead').value = String(R.lead);
    $('lead').addEventListener('change', function () { R.lead = +$('lead').value; save(); replan(); });
    $('maxWp').value = R.maxWp;
    $('maxWp').addEventListener('input', function () {
      var v = parseInt($('maxWp').value, 10);
      if (v >= 2) { R.maxWp = v; save(); replan(); }
    });
    $('boostChk').checked = !!R.boost;
    $('boostChk').addEventListener('change', function () { R.boost = $('boostChk').checked; save(); replan(); });
    $('gpxFile').addEventListener('change', function () {
      var f = $('gpxFile').files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var parsed = P.parseRoute(String(reader.result), f.name);
          var base = P.prepareRoute(parsed.points);
          state.file = { name: parsed.name, sample: false, filename: f.name };
          state.base = base;
          state.osm = null;
          showError('');
          replan();
        } catch (err) { showError(err.message); }
      };
      reader.onerror = function () { showError(t('err.read')); };
      reader.readAsText(f);
      $('gpxFile').value = '';
    });
  }
  function showError(msg) { var e = $('routeError'); e.textContent = msg; e.hidden = !msg; }

  function energyParams(modesRes) {
    var r = state.rider, R = state.route;
    if (!modesRes) return null;
    return { modes: modesRes.modes, totalWeight: modesRes.totalWeight, riderW: riderPower(), rpm: riderCadence(), wkg: P.PRESETS[r.style].wkg, bike: r.bike,
      batteryWh: batteryWh(), startPct: R.startPct, reservePct: R.reservePct, surface: R.surface,
      temperature: R.temperature, personalFactor: R.useCal ? P.personalFactorFrom(state.rides).factor : 1,
      surfaceSamples: state.osm && state.osm.base === state.base ? state.osm.samples : null };
  }
  function planOpts() {
    var R = state.route, sens = SENS[R.sens] || SENS.media;
    return { mapping: R.mapping, minLen: sens.minLen, minUp: sens.minUp, lead: R.lead, boost: R.boost, adapt: R.adapt, maxWaypoints: R.maxWp };
  }

  function replan() {
    if (!state.base) return;
    var e = energyParams(state.modes), R = state.route;
    state.result = (R.strategy === 'auto' && e)
      ? P.autoPlan(state.base, { adapt: R.adapt, lead: R.lead, boost: R.boost, maxWaypoints: R.maxWp }, e)
      : P.plan(state.base, planOpts(), e);
    renderRoute();
  }

  /* ---------------- fondo da OpenStreetMap ---------------- */
  function renderOsm() {
    var btn = $('osmBtn'), st = $('osmStatus'), o = state.osm;
    var sample = state.file && state.file.sample;
    btn.disabled = !!sample || !window.AvinoxOsm || (o && o.loading);
    if (sample) { st.textContent = t('osm.sample'); return; }
    if (!o) { st.textContent = t('osm.idle'); return; }
    if (o.loading) { st.textContent = t('osm.loading'); return; }
    if (o.error) { st.textContent = o.error === 'network' ? t('osm.network') : o.error === 'empty' ? t('osm.empty') : t('osm.other', { why: o.error }); return; }
    var parts = Object.keys(o.mix).filter(function (k) { return o.mix[k] >= 5; })
      .sort(function (a, b) { return o.mix[b] - o.mix[a]; })
      .map(function (k) { return Math.round(o.mix[k]) + '% ' + t('voice.' + k); });
    st.textContent = t('osm.result', { parts: parts.join(', ') || t('osm.none'), cov: Math.round(o.coverage * 100) });
  }
  function readOsm() {
    if (!state.base || !window.AvinoxOsm) return;
    var base = state.base;
    state.osm = { loading: true, base: base };
    renderOsm();
    var pts = base.points.map(function (p) { return { lat: p.lat, lon: p.lon, distanceKm: p.d / 1000 }; });
    window.AvinoxOsm.fetchSurfaceMix(pts).then(function (res) {
      if (state.base !== base) return;
      state.osm = res.ok ? { base: base, samples: res.samples, mix: res.mix, coverage: res.coverage } : { base: base, error: res.reason };
      renderOsm(); replan();
    });
  }

  /* ---------------- taratura ---------------- */
  function renderCalib() {
    var list = $('rides');
    list.innerHTML = '';
    var pf = P.personalFactorFrom(state.rides), range = P.FACTOR_RANGE;
    state.rides.forEach(function (ride, i) {
      var f = P.rideFactor(ride), ok = isFinite(f) && f >= range[0] && f <= range[1];
      var li = el('li', '', '<span>' + esc(ride.date) + ' · ' + esc(ride.name) + '</span><span>' + n1(ride.km) + ' km · +' + Math.round(ride.gain) + ' m</span>' +
        '<span>' + ride.startPct + '% → ' + ride.endPct + '%</span><span class="f' + (ok ? '' : ' out') + '" title="' + esc(t(ok ? 'calib.factorTitle' : 'calib.factorOut')) + '">×' +
        (isFinite(f) ? d2(f) : '—') + '</span>');
      var del = el('button', 'btn', esc(t('btn.delete'))); del.type = 'button';
      del.addEventListener('click', function () { state.rides.splice(i, 1); saveRides(); replan(); });
      li.appendChild(del);
      list.appendChild(li);
    });
    $('calUseTxt').textContent = pf.used ? t('calib.use', { f: d2(pf.factor), n: pf.used, rides: t(pf.used === 1 ? 'calib.ride' : 'calib.rides') }) : t('calib.useNone');
    var sample = state.file && state.file.sample;
    $('calSave').disabled = !!sample;
    if (sample && !$('calMsg').dataset.keep) $('calMsg').textContent = t('calib.needGpx');
  }
  function saveRide() {
    var r = state.result, msg = $('calMsg');
    msg.dataset.keep = '1';
    if (!r || !r.energy || state.file.sample) { msg.textContent = t('calib.needGpxShort'); return; }
    var a = parseFloat($('calStart').value), b = parseFloat($('calEnd').value);
    if (!(a > 0 && a <= 100 && b >= 0 && b < a)) { msg.textContent = t('calib.badValues'); return; }
    var ride = {
      date: new Date().toLocaleDateString(locale()), name: state.file.name, km: r.total / 1000, gain: r.gain,
      startPct: a, endPct: b, batteryWh: batteryWh(), temperature: state.route.temperature,
      predictedWh: Math.round(r.energy.rawTotalWh), strategy: state.route.strategy
    };
    var f = P.rideFactor(ride), range = P.FACTOR_RANGE;
    state.rides.push(ride); saveRides();
    msg.textContent = (isFinite(f) && f >= range[0] && f <= range[1])
      ? t(f >= 1 ? 'calib.savedMore' : 'calib.savedLess', { p: Math.round(Math.abs(f - 1) * 100) })
      : t('calib.outOfRange', { f: isFinite(f) ? d2(f) : '?' });
    $('calEnd').value = '';
    replan();
  }

  /* ---------------- riepilogo e note ---------------- */
  function renderRoute() {
    var r = state.result, f = state.file, en = r.energy;
    $('routeName').innerHTML = esc(f.name) + (f.sample ? '<span class="tag">' + esc(t('route.sampleTag')) + '</span>' : '');
    $('routeMeta').textContent = f.sample ? t('route.sampleMeta') : (f.filename || '');

    // fasce abbassate dal piano
    Array.prototype.forEach.call(document.querySelectorAll('.adapted'), function (s) {
      var c = r.changes.filter(function (x) { return x.band === s.dataset.for; })[0];
      s.textContent = c ? t('adapted', { mode: LABEL[c.to] }) : '';
    });

    var changes = r.waypoints.filter(function (w) { return w.kind === 'up' || w.kind === 'down'; }).length;
    var sum = $('summary');
    sum.innerHTML = '';
    var stat = function (k, v, cls, s) { sum.appendChild(el('div', 'stat', '<span class="k">' + esc(k) + '</span><span class="v' + (cls ? ' ' + cls : '') + '">' + esc(v) + '</span>' + (s ? '<span class="s">' + esc(s) + '</span>' : ''))); };
    stat(t('stat.distance'), P.fmtKm(r.total) + ' km');
    stat(t('stat.gain'), '+' + Math.round(r.gain) + ' m');
    if (r.auto) stat('AUTO', r.auto.setting.levelMin + '–' + r.auto.setting.levelMax, '', r.auto.setting.maxPower + ' W · ' + r.auto.setting.maxTorque + ' Nm');
    else stat(t('stat.changes'), String(changes));
    stat(t('stat.waypoints'), String(r.waypoints.length), r.cap && r.cap.limit && r.waypoints.length >= r.cap.limit ? 'bad' : '', r.cap && r.cap.limit ? t('stat.maxPerFile', { n: r.cap.limit }) : '');
    if (en) {
      stat(t('stat.consumption'), Math.round(en.totalWh) + ' Wh', '', Math.round(en.low) + '–' + Math.round(en.high) + ' Wh' +
        (en.personalFactor !== 1 ? ' · ' + t('stat.calibrated', { f: d2(en.personalFactor) }) : ''));
      stat(t('stat.startWith'), en.needStartPct > 100 ? t('stat.over100') : t('stat.atLeast', { p: en.needStartPct }), en.needStartPct > 100 ? 'bad' : '',
        en.needStartPrudentPct > 100 ? t('stat.marginNo') : t('stat.margin', { p: en.needStartPrudentPct }));
      if (en.arrivalPct < 0) {
        var emptyAt = null;
        for (var pi = 0; pi < r.profile.length; pi++) { if (r.profile[pi].pct <= 0) { emptyAt = r.profile[pi].d; break; } }
        stat(t('stat.finish'), t('stat.empty'), 'bad', t('stat.emptyAt', { km: emptyAt != null ? P.fmtKm(emptyAt) : '?', r: en.reservePct }));
      } else {
        stat(t('stat.finish'), '~' + Math.round(en.arrivalPct) + '%', en.fits ? 'ok' : 'bad',
          t('stat.between', { a: Math.max(0, Math.round(en.arrivalWorst)), b: Math.max(0, Math.round(en.arrivalBest)), r: en.reservePct }));
      }
    }
    var share = el('div', 'share');
    var bar = el('div', 'share-bar'), legend = el('div', 'share-legend');
    P.MODE_KEYS.forEach(function (k) {
      var pct = (r.share[k] / r.total) * 100;
      if (pct <= 0) return;
      var i = el('i', 'mode-' + k); i.style.width = pct + '%'; i.title = LABEL[k] + ' ' + Math.round(pct) + '%';
      bar.appendChild(i);
      legend.appendChild(el('span', 'mode-' + k, LABEL[k] + ' ' + P.fmtKm(r.share[k]) + ' km'));
    });
    share.appendChild(el('span', 'stat', '<span class="k">' + esc(t('stat.kmPerMode')) + '</span>'));
    share.appendChild(bar); share.appendChild(legend);
    sum.appendChild(share);

    renderPlanNote();
    renderAutoCard();
    renderOsm();
    renderCalib();
    if (!$('calStart').dataset.touched) $('calStart').value = state.route.startPct;
    drawChart(); drawShape(); renderCues();
  }

  function renderAutoCard() {
    var r = state.result, box = $('autoCard');
    box.hidden = !r.auto;
    if (!r.auto) { box.innerHTML = ''; return; }
    var a = r.auto, st = a.setting, en = r.energy, R = state.route;
    var pct = function (x) { return Math.max(0, Math.round(x)) + '%'; };
    var why = [];
    why.push(t('auto.why1', { p90: Math.round(a.p90), max: Math.round(a.gMax) }));
    why.push(t(st.levelMin === a.tuned.levelMin ? 'auto.why2same' : 'auto.why2', { lv: st.levelMin }));
    if (a.levelCapped && !a.adapted) why.push(t('auto.cap'));
    var tf = a.surfaceTorque;
    if (Math.abs(tf - 1) >= 0.02) {
      var surf = a.surfaceFromOsm ? t('auto.surfaceOsm') : t('surface.' + a.surfaceKey).toLowerCase();
      why.push(t(tf < 1 ? 'auto.torqueDown' : 'auto.torqueUp', { p: Math.round(Math.abs(1 - tf) * 100), surface: esc(surf) }));
    }
    if (a.soft) why.push(t('auto.soft'));
    if (a.adapted && !r.exhausted) {
      why.push(t('auto.adapted', { r: R.reservePct, a1: a.proposed.levelMin, a2: a.proposed.levelMax, p1: a.proposed.maxPower, b1: st.levelMin, b2: st.levelMax, p2: st.maxPower }));
    }
    why.push(t(a.tunedEnergy.arrivalPct < 0 ? 'auto.compareEmpty' : 'auto.compare',
      { l1: a.tuned.levelMin, l2: a.tuned.levelMax, p: a.tuned.maxPower, wh: Math.round(a.tunedEnergy.totalWh), a: pct(a.tunedEnergy.arrivalPct) }));
    box.innerHTML = '<div class="auto-head"><div><h3>' + esc(t('auto.title')) + '</h3><div class="meta">' +
      esc(t('auto.meta', { wh: Math.round(en.totalWh), a: pct(en.arrivalPct), r: R.reservePct })) +
      '</div></div><button type="button" class="btn" id="copyAuto">' + esc(t('btn.copyAuto')) + '</button></div>' +
      '<div id="autoRow"></div>' +
      '<ul class="auto-why">' + why.map(function (w) { return '<li>' + w + '</li>'; }).join('') + '</ul>' +
      '<div class="manual" id="autoManual" hidden><textarea id="autoManualText" readonly></textarea></div>';
    var m = Object.assign({ wkg: st.maxPower / state.modes.totalWeight, warnings: [] }, st);
    $('autoRow').appendChild(modeRow('mode-auto', 'AUTO', t(st.levelMin !== st.levelMax ? 'mode.range' : 'mode.fixed'), m));
    $('copyAuto').addEventListener('click', function () {
      copy(state.file.name + ' – ' + t('copy.auto', { l1: st.levelMin, l2: st.levelMax, p: st.maxPower, t: st.maxTorque, o: st.overrun, s: st.start, c: st.continued, a: st.accel }),
        $('copyAuto'), $('autoManual'), $('autoManualText'));
    });
  }

  function capNote(r) {
    var c = r.cap, parts = [];
    if (!c || !c.limit) return '';
    if (c.escalated) parts.push(t('cap.merged', { n: c.limit, up: c.minUp, len: c.minLen }));
    if (c.droppedBoost) parts.push(c.droppedBoost === 1 ? t('cap.boost1') : t('cap.boostN', { n: c.droppedBoost }));
    return parts.length ? parts.join('; ').replace(/^./, function (x) { return x.toUpperCase(); }) + '.' : '';
  }

  function renderPlanNote() {
    var r = state.result, en = r.energy, box = $('planNote'), R = state.route;
    box.innerHTML = '';
    var cn = capNote(r);
    if (cn) box.appendChild(el('p', 'callout', esc(cn)));
    if (!en) { box.appendChild(el('p', 'callout', esc(t('plan.fixSchema')))); return; }
    var bits = {
      arrive: en.arrivalPct < 0 ? t('plan.empty') : t('plan.arrive', { p: Math.round(en.arrivalPct) }),
      under: en.arrivalPct < 0 ? '' : t('plan.under', { r: R.reservePct })
    };
    var note = function (key, extra) { box.appendChild(el('p', 'callout', esc(t(key, bits) + (extra || '')))); };
    if (r.auto) {
      if (r.exhausted) note('plan.autoExhausted');
      else if (!en.fits) note('plan.autoShort');
      return;
    }
    if (r.exhausted) {
      var extra = '';
      if (state.rider.style !== 'risparmio') {
        var alt = modesFor('risparmio');
        if (!alt.error) {
          var altPct = P.plan(state.base, planOpts(), energyParams(alt)).energy.arrivalPct;
          extra = altPct < 0 ? t('plan.saverEmpty') : t('plan.saver', { p: Math.round(altPct) });
        }
      } else extra = t('plan.moreCharge');
      note('plan.ecoExhausted', extra);
    } else if (r.changes.length) {
      var list = r.changes.map(function (c) { return t('bandName.' + c.band) + ' ' + LABEL[c.from] + ' → ' + LABEL[c.to]; }).join(', ');
      box.appendChild(el('p', 'callout', esc(t('plan.adapted', { r: R.reservePct, list: list }))));
    } else if (!en.fits) {
      note('plan.short');
    }
  }

  /* ---------------- grafici ---------------- */
  var NS = 'http://www.w3.org/2000/svg';
  function svgEl(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function niceStep(span, target) {
    var raw = span / target, mag = Math.pow(10, Math.floor(Math.log10(raw))), n = raw / mag;
    return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * mag;
  }
  function colors() { var css = getComputedStyle(document.documentElement); return function (k) { return css.getPropertyValue('--' + k).trim(); }; }
  function txt(parent, x, y, s, attrs) {
    var a = Object.assign({ x: x, y: y, 'font-size': 11, 'font-family': 'JetBrains Mono, monospace' }, attrs || {});
    var e = svgEl('text', a, parent); e.textContent = s; return e;
  }

  /* Profilo altimetrico colorato per modalità e, sotto, la carica prevista. */
  function drawChart() {
    var r = state.result, box = $('chart'), en = r.energy;
    var col = colors();
    var W = Math.max(300, box.clientWidth - 12), narrow = W < 560;
    var ml = 46, mr = 14, mt = 58, eleH = narrow ? 150 : 190, gap = 32, batH = en ? (narrow ? 70 : 84) : 0, mb = 24;
    var H = mt + eleH + (en ? gap + batH : 0) + mb, pw = W - ml - mr;
    var eStep = niceStep(r.maxEle - r.minEle || 50, 4);
    var e0 = Math.floor(r.minEle / eStep) * eStep, e1 = Math.ceil(r.maxEle / eStep) * eStep;
    if (e1 === e0) e1 = e0 + eStep;
    var x = function (d) { return ml + (d / r.total) * pw; };
    var y = function (e) { return mt + eleH - ((e - e0) / (e1 - e0)) * eleH; };
    var bTop = mt + eleH + gap;
    var yb = function (p) { return bTop + batH - (Math.max(0, Math.min(100, p)) / 100) * batH; };
    box.innerHTML = '';
    var svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, role: 'img' }, box);
    svgEl('title', {}, svg).textContent = t(en ? 'chart.titleBattery' : 'chart.title');
    var prof = r.profile;
    function at(d, key) {
      var lo = 0, hi = prof.length - 1;
      while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (prof[mid].d <= d) lo = mid; else hi = mid; }
      var a = prof[lo], b = prof[hi]; if (b.d === a.d) return a[key];
      return a[key] + (b[key] - a[key]) * Math.min(1, Math.max(0, (d - a.d) / (b.d - a.d)));
    }
    var plotBottom = en ? bTop + batH : mt + eleH;
    r.runs.forEach(function (run) {
      svgEl('rect', { x: x(run.start), y: mt, width: Math.max(0.5, x(run.end) - x(run.start)), height: plotBottom - mt, fill: col(run.mode), 'fill-opacity': 0.07 }, svg);
    });
    for (var e = e0; e <= e1 + 0.01; e += eStep) {
      svgEl('line', { x1: ml, x2: ml + pw, y1: y(e), y2: y(e), stroke: col('line'), 'stroke-width': 1, 'stroke-dasharray': e === e0 ? '' : '3 4' }, svg);
      txt(svg, ml - 6, y(e) + 4, Math.round(e) + ' m', { 'text-anchor': 'end', fill: col('muted') });
    }
    var kStep = niceStep(r.total / 1000, narrow ? 5 : 9);
    for (var km = 0; km <= r.total / 1000 + 1e-9; km += kStep) {
      txt(svg, x(km * 1000), H - 7, (Math.round(km * 10) / 10).toLocaleString(locale()) + (km === 0 ? ' km' : ''), { 'text-anchor': km === 0 ? 'start' : 'middle', fill: col('muted') });
    }
    r.runs.forEach(function (run) {
      var pts = [[run.start, at(run.start, 'ele')]];
      prof.forEach(function (p) { if (p.d > run.start && p.d < run.end) pts.push([p.d, p.ele]); });
      pts.push([run.end, at(run.end, 'ele')]);
      var line = pts.map(function (p) { return x(p[0]).toFixed(1) + ',' + y(p[1]).toFixed(1); }).join('L');
      svgEl('path', { d: 'M' + x(run.start).toFixed(1) + ',' + (mt + eleH) + 'L' + line + 'L' + x(run.end).toFixed(1) + ',' + (mt + eleH) + 'Z', fill: col(run.mode), 'fill-opacity': 0.42 }, svg);
      svgEl('path', { d: 'M' + line, fill: 'none', stroke: col(run.mode), 'stroke-width': 2.2, 'stroke-linejoin': 'round' }, svg);
    });
    if (en) {
      txt(svg, ml, bTop - 8, t('chart.battery'), { fill: col('muted'), 'font-size': 10.5 });
      [0, 50, 100].forEach(function (p) {
        svgEl('line', { x1: ml, x2: ml + pw, y1: yb(p), y2: yb(p), stroke: col('line'), 'stroke-width': 1, 'stroke-dasharray': p === 0 ? '' : '3 4' }, svg);
        txt(svg, ml - 6, yb(p) + 4, p + '%', { 'text-anchor': 'end', fill: col('muted') });
      });
      var res = en.reservePct;
      svgEl('rect', { x: ml, y: yb(res), width: pw, height: Math.max(0, yb(0) - yb(res)), fill: col('bad'), 'fill-opacity': 0.08 }, svg);
      svgEl('line', { x1: ml, x2: ml + pw, y1: yb(res), y2: yb(res), stroke: col('bad'), 'stroke-width': 1.2, 'stroke-dasharray': '5 4' }, svg);
      txt(svg, ml + 4, yb(res) - 4, t('chart.reserve', { r: res }), { 'text-anchor': 'start', fill: col('bad'), 'font-size': 10.5 });
      var bl = prof.map(function (p) { return x(p.d).toFixed(1) + ',' + yb(p.pct).toFixed(1); }).join('L');
      svgEl('path', { d: 'M' + x(0) + ',' + yb(0) + 'L' + bl + 'L' + x(r.total).toFixed(1) + ',' + yb(0) + 'Z', fill: col('ink'), 'fill-opacity': 0.06 }, svg);
      svgEl('path', { d: 'M' + bl, fill: 'none', stroke: col('ink'), 'stroke-width': 2, 'stroke-linejoin': 'round' }, svg);
      var endP = prof[prof.length - 1].pct;
      svgEl('circle', { cx: x(r.total), cy: yb(endP), r: 4, fill: col(en.fits ? 'ok' : 'bad') }, svg);
      txt(svg, x(r.total) - 8, yb(endP) - 7, '~' + Math.round(endP) + '%', { 'text-anchor': 'end', fill: col(en.fits ? 'ok' : 'bad'), 'font-weight': 600 });
    }
    var lastX = [-1e9, -1e9];
    r.waypoints.forEach(function (w, i) {
      var wx = x(w.dist), row = wx - lastX[0] >= 24 ? 0 : (wx - lastX[1] >= 24 ? 1 : 0);
      lastX[row] = wx;
      var cy = row === 0 ? 14 : 38;
      var g = svgEl('g', { 'data-n': i, class: 'wpm' }, svg);
      svgEl('line', { x1: wx, x2: wx, y1: cy + 10, y2: y(at(w.dist, 'ele')), stroke: col(w.mode), 'stroke-width': 1.2, 'stroke-dasharray': '2 3' }, g);
      svgEl('circle', { cx: wx, cy: cy, r: 10, fill: col(w.mode) }, g);
      txt(g, wx, cy + 4, String(i + 1), { 'text-anchor': 'middle', 'font-weight': 600, fill: col('on-mode') });
      svgEl('title', {}, g).textContent = 'km ' + P.fmtKm(w.dist) + ' · ' + w.name;
    });
  }

  function drawShape() {
    var r = state.result, box = $('shape');
    var tr = r.track, lat0 = tr[0].lat, c = Math.cos(lat0 * Math.PI / 180);
    var proj = function (p) { return [(p.lon - tr[0].lon) * c, -(p.lat - lat0)]; };
    var xs = tr.map(function (p) { return proj(p)[0]; }), ys = tr.map(function (p) { return proj(p)[1]; });
    var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs), minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
    var S = 300, pad = 18, span = Math.max(maxX - minX, maxY - minY) || 1e-6, k = (S - 2 * pad) / span;
    var ox = pad + ((S - 2 * pad) - (maxX - minX) * k) / 2, oy = pad + ((S - 2 * pad) - (maxY - minY) * k) / 2;
    var P2 = function (p) { var q = proj(p); return [ox + (q[0] - minX) * k, oy + (q[1] - minY) * k]; };
    var col = colors();
    box.innerHTML = '';
    var svg = svgEl('svg', { viewBox: '0 0 ' + S + ' ' + S, role: 'img' }, box);
    svgEl('title', {}, svg).textContent = t('shape.title');
    r.runs.forEach(function (run) {
      var pts = [P2(P.positionAt(r.points, run.start))];
      tr.forEach(function (p) { if (p.d > run.start && p.d < run.end) pts.push(P2(p)); });
      pts.push(P2(P.positionAt(r.points, run.end)));
      svgEl('polyline', { points: pts.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' '), fill: 'none', stroke: col(run.mode), 'stroke-width': 3.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, svg);
    });
    var s0 = P2(tr[0]);
    svgEl('circle', { cx: s0[0], cy: s0[1], r: 7, fill: col('panel'), stroke: col('ink'), 'stroke-width': 2 }, svg);
    r.waypoints.forEach(function (w, i) {
      if (w.kind === 'start') return;
      var q = P2(w);
      var g = svgEl('g', { 'data-n': i, class: 'wpm' }, svg);
      svgEl('circle', { cx: q[0], cy: q[1], r: 8, fill: col(w.mode), stroke: col('panel'), 'stroke-width': 1.5 }, g);
      txt(g, q[0], q[1] + 3.5, String(i + 1), { 'text-anchor': 'middle', 'font-size': 9.5, 'font-weight': 600, fill: col('on-mode') });
    });
  }

  function renderCues() {
    var r = state.result, list = $('cueList'), en = r.energy;
    list.innerHTML = '';
    r.waypoints.forEach(function (w, i) {
      var li = el('li', 'cue mode-' + w.mode);
      var rest = w.name.replace(/^START · /, '').replace(/^(ECO|AUTO|TRAIL|TURBO|BOOST)\s*(· )?/, '').replace(/ · min \d+%$/, '');
      var head = (w.kind === 'start' ? '<span class="tag" style="margin:0 6px 0 0">start</span>' : '') + '<b>' + LABEL[w.mode] + '</b><span class="rest">' + esc(rest) + '</span>';
      var batt = w.battery != null ? '<i class="' + (en && w.battery < en.reservePct ? 'low' : '') + '">~' + Math.max(0, Math.round(w.battery)) + '%</i>' +
        (w.minBattery != null ? '<i>min ' + Math.max(0, Math.round(w.minBattery)) + '%</i>' : '') : '';
      li.innerHTML = '<span class="n">' + (i + 1) + '</span><span class="km">km ' + P.fmtKm(w.dist) + batt + '</span><div class="t">' + head + '<p>' + esc(w.note || '') + '</p></div>';
      li.addEventListener('mouseenter', function () { hot(i, true); });
      li.addEventListener('mouseleave', function () { hot(i, false); });
      list.appendChild(li);
    });
  }
  function hot(i, on) {
    Array.prototype.forEach.call(document.querySelectorAll('.wpm[data-n="' + i + '"] circle'), function (c) { c.setAttribute('r', on ? 13 : (c.closest('#shape') ? 8 : 10)); });
  }

  /* ---------------- copia e download ---------------- */
  function copy(text, btn, manualBox, manualText) {
    var done = function () { var o = btn.textContent; btn.textContent = t('copied'); setTimeout(function () { btn.textContent = o; }, 1500); };
    var fallback = function () { manualText.value = text; manualBox.hidden = false; manualText.focus(); manualText.select(); };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
      else fallback();
    } catch (e) { fallback(); }
  }
  function baseName() {
    var s = (state.file && state.file.name || t('file.route')).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return (s || t('file.route')) + t('file.suffix');
  }
  function gpxText() { return P.buildGpx(t('file.gpxName', { name: state.file.name }), state.result); }
  function saveBlob(text, type, name) {
    var url = URL.createObjectURL(new Blob([text], { type: type }));
    var a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  var downloads = null;
  var inViewer = !!(window.claude && typeof window.claude.use === 'function');
  function setStatus(s) { $('dlStatus').textContent = s; }

  function bindFiles() {
    $('calStart').addEventListener('input', function () { $('calStart').dataset.touched = '1'; });
    if (inViewer) {
      window.claude.use('downloads').then(function (ns) {
        downloads = ns;
        $('dlBtn').hidden = !ns;
        if (!ns) setStatus(t('dl.notHere'));
      }, function () { setStatus(t('dl.notHereShort')); });
    } else {
      $('dlBtn').hidden = false;
    }
    $('dlBtn').addEventListener('click', function () {
      if (!state.result) return;
      var name = baseName();
      if (downloads) {
        setStatus(t('dl.confirm'));
        downloads.save({ filename: name + '.zip', data: P.zipSingle(name + '.gpx', gpxText()) }).then(function (res) {
          setStatus(res && res.status === 'delivered' ? t('dl.delivered') : t('dl.zipSaved', { name: name }));
        }, function (err) {
          var code = err && err.code;
          if (code === 'declined') setStatus(t('dl.declined'));
          else if (code === 'rate_limited') setStatus(t('dl.busy'));
          else if (code === 'extension_not_enabled' || code === 'rejected_extension') setStatus(t('dl.noZip'));
          else { setStatus(t('dl.notHereShort')); $('dlBtn').hidden = true; }
        });
      } else if (!inViewer) {
        saveBlob(gpxText(), 'application/gpx+xml', name + '.gpx');
        setStatus(t('dl.saved', { name: name }));
      }
    });
    $('copyGpx').addEventListener('click', function () { if (state.result) copy(gpxText(), $('copyGpx'), $('cueManual'), $('cueManualText')); });
    $('copyCues').addEventListener('click', function () { if (state.result) copy(P.cueText(state.file.name, state.result), $('copyCues'), $('cueManual'), $('cueManualText')); });
    $('copySchema').addEventListener('click', function () { if (state.schemaText) copy(state.schemaText, $('copySchema'), $('schemaManual'), $('schemaManualText')); });

    /* esporta / importa i dati */
    var exportData = function () {
      var text = JSON.stringify({ app: 'avinox-mode-planner', version: 1, exportedAt: new Date().toISOString(),
        settings: { rider: state.rider, route: state.route }, rides: state.rides, lang: LANG }, null, 2);
      var name = t('data.fileName'), msg = $('dataMsg');
      if (downloads) {
        downloads.save({ filename: name, data: text }).then(function () { msg.textContent = t('data.exported', { name: name }); },
          function (err) { msg.textContent = err && err.code === 'declined' ? t('data.declined') : t('data.noSave'); });
      } else if (!inViewer) {
        saveBlob(text, 'application/json', name);
        msg.textContent = t('data.exportedWeb', { name: name });
      } else {
        msg.textContent = t('data.noSave');
      }
    };
    $('exportBtn').addEventListener('click', exportData);
    $('moveExport').addEventListener('click', function () { exportData(); $('h-data').scrollIntoView({ behavior: 'smooth' }); });
    $('importFile').addEventListener('change', function () {
      var f = $('importFile').files[0], msg = $('dataMsg');
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var d = JSON.parse(String(reader.result));
          if (!d || d.app !== 'avinox-mode-planner' || !d.settings) throw new Error('formato');
          localStorage.setItem(STORE_KEY, JSON.stringify({ rider: d.settings.rider || {}, route: d.settings.route || {} }));
          localStorage.setItem(RIDES_KEY, JSON.stringify(Array.isArray(d.rides) ? d.rides : []));
          if (d.lang === 'it' || d.lang === 'en') localStorage.setItem(LANG_KEY, d.lang);
          msg.textContent = t('data.imported');
          setTimeout(function () { location.reload(); }, 600);
        } catch (e) {
          msg.textContent = e.message === 'formato' ? t('data.badFile') : t('data.importFail');
        }
      };
      reader.readAsText(f);
      $('importFile').value = '';
    });
  }

  /* ---------------- avvio ---------------- */
  LANG = detectLang();
  P.setLang(LANG);
  load();
  loadRides();
  bindDonate();
  applyStatic();
  renderDonate();
  fillSelects();
  bindRider();
  bindRoute();
  renderStrategy();
  bindFiles();
  Array.prototype.forEach.call(document.querySelectorAll('#langSeg button'), function (b) {
    b.addEventListener('click', function () { if (b.dataset.lang !== LANG) setLang(b.dataset.lang); });
  });

  // app installata: niente istruzioni di installazione; fuori da claude.ai, lavoro offline col service worker
  var standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
  if (standalone) $('install').hidden = true;
  if (!inViewer && 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () { /* resta online */ }); });
  }
  // vecchio indirizzo: invito a spostarsi sul nuovo portando i dati
  if (NEW_HOME && location.hostname === 'andicola.github.io') {
    $('moveLink').href = NEW_HOME; $('moveLink').textContent = NEW_HOME.replace(/^https:\/\//, '').replace(/\/$/, '');
    $('moveBanner').hidden = false;
  }

  renderSchema();
  var sample = P.sampleRoute();
  state.file = { name: sample.name, sample: true };
  state.base = P.prepareRoute(sample.points);
  replan();
  var rt = null;
  window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(function () { if (state.result) drawChart(); }, 120); });
  var redraw = function () { if (state.result) { drawChart(); drawShape(); } };
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    if (mq.addEventListener) mq.addEventListener('change', redraw);
  }
  new MutationObserver(redraw).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
})();
