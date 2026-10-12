'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../planner.js');

const BAL = P.PRESETS.bilanciato.wkg;
const MAPPING = { flat: 'eco', rolling: 'auto', climb: 'trail', steep: 'turbo', extreme: 'turbo' };
const OPTS = { mapping: MAPPING, minLen: 800, minUp: 400, lead: 100, boost: false, adapt: true };

function levels(m) { return m.levelMin === m.levelMax ? String(m.levelMin) : m.levelMin + '-' + m.levelMax; }
function energyFor(modes, extra) {
  return Object.assign({
    modes: modes.modes, totalWeight: modes.totalWeight, riderW: 85, rpm: 85,
    batteryWh: 800, startPct: 100, reservePct: 15, surface: 'mixed'
  }, extra || {});
}

/* Valori presi da /api/calculate di avinox-setup-app per gli stessi input. */
const FIXTURES = [
  { input: { riderWeight: 87, bikeWeight: 24.2, cadence: 85, riderPower: 85 },
    expect: { eco: ['5', 150, 25], auto: ['7-9', 300, 50], trail: ['11-13', 600, 95], turbo: ['15', 850, 130] } },
  { input: { riderWeight: 80, bikeWeight: 24.2, cadence: 75, riderPower: 200 },
    expect: { eco: ['3', 150, 25], auto: ['4', 300, 50], trail: ['6-8', 550, 90], turbo: ['10', 800, 125] } },
  { input: { riderWeight: 87, bikeWeight: 24.2, cadence: 80, riderPower: 120 },
    expect: { eco: ['4', 150, 25], auto: ['5-8', 300, 50], trail: ['9-11', 600, 95], turbo: ['14', 850, 130] } }
];

test('calcModes riproduce il calcolatore originale', () => {
  for (const f of FIXTURES) {
    const res = P.calcModes(Object.assign({ wkg: BAL }, f.input));
    for (const k of P.MODE_KEYS) {
      const m = res.modes[k];
      assert.deepEqual([levels(m), m.maxPower, m.maxTorque], f.expect[k], `${k} con ${JSON.stringify(f.input)}`);
    }
  }
});

test('calcModes rifiuta input non validi', () => {
  assert.ok(P.calcModes({ riderWeight: 0, bikeWeight: 24, cadence: 80, riderPower: 150, wkg: BAL }).error);
  assert.ok(P.calcModes({ riderWeight: 80, bikeWeight: 24, cadence: 10, riderPower: 150, wkg: BAL }).error);
});

test('il piano copre tutto il giro e rispetta le lunghezze minime', () => {
  const base = P.prepareRoute(P.sampleRoute().points);
  const r = P.plan(base, OPTS, null);
  assert.equal(r.runs[0].start, 0);
  assert.equal(r.runs[r.runs.length - 1].end, base.total);
  for (let i = 1; i < r.runs.length; i++) {
    assert.equal(r.runs[i].start, r.runs[i - 1].end);
    assert.notEqual(r.runs[i].mode, r.runs[i - 1].mode);
  }
  if (r.runs.length > 1) r.runs.forEach((run) => assert.ok(run.length >= OPTS.minUp, `tratto di ${run.length} m`));
  assert.equal(r.waypoints[0].kind, 'start');
  assert.equal(r.waypoints.filter((w) => w.kind !== 'boost').length, r.runs.length);
});

test('stima della batteria e adattamento alla riserva', () => {
  const base = P.prepareRoute(P.sampleRoute().points);
  const modes = P.calcModes({ riderWeight: 87, bikeWeight: 24.2, cadence: 85, riderPower: 85, wkg: BAL });

  const normal = P.plan(base, OPTS, energyFor(modes));
  assert.ok(normal.energy.totalWh > 300 && normal.energy.totalWh < 800);
  assert.ok(normal.energy.fits);
  assert.deepEqual(normal.changes, []);

  const strict = P.plan(base, OPTS, energyFor(modes, { reservePct: 40 }));
  assert.ok(strict.energy.fits, 'con il 40% di riserva il piano deve starci');
  assert.ok(strict.changes.length > 0, 'e deve abbassare qualche fascia');
  assert.ok(strict.energy.totalWh < normal.energy.totalWh);

  const impossible = P.plan(base, OPTS, energyFor(modes, { startPct: 60, reservePct: 40 }));
  assert.ok(impossible.exhausted);
  assert.ok(Object.values(impossible.mapping).every((m) => m === 'eco'));

  const off = P.plan(base, Object.assign({}, OPTS, { adapt: false }), energyFor(modes, { reservePct: 40 }));
  assert.ok(!off.energy.fits);
  assert.deepEqual(off.changes, []);
});

test('in sella: dove sono, che modalità, ripianifica da qui', () => {
  const base = P.prepareRoute(P.sampleRoute().points);
  const modes = P.calcModes({ riderWeight: 87, bikeWeight: 24.2, cadence: 85, riderPower: 85, wkg: BAL });
  const e = energyFor(modes);
  const plan = P.plan(base, OPTS, e);

  /* dove sono: un punto della traccia si ritrova al suo km, uno spostato di 60 m lo segnala */
  const at = P.positionAt(base.points, 7400);
  const here = P.locate(base, at.lat, at.lon);
  assert.ok(Math.abs(here.d - 7400) < 15, 'km ritrovato: ' + here.d);
  assert.ok(here.off < 2);
  const aside = P.locate(base, at.lat + 60 / 111320, at.lon);
  assert.ok(aside.off > 50 && aside.off < 70, 'scarto ' + aside.off);

  /* che modalità: il tratto che contiene il km, il prossimo avviso oltre */
  const now = P.modeAt(plan, 7400);
  assert.ok(now.run.start <= 7400 && 7400 < now.run.end);
  assert.equal(now.mode, now.run.mode);
  assert.ok(!now.next || now.next.dist > 7400);
  assert.ok(now.battery > 0 && now.battery <= 100);
  assert.ok(Math.abs(now.remaining - (base.total - 7400)) < 1);

  /* ripianifica: dal km 10 con più batteria del previsto il resto ci sta meglio */
  const expectedAt10 = plan.energy.pctAt(10000);
  const again = P.replanFrom(base, OPTS, e, 'waypoint', 10000, Math.round(expectedAt10), plan);
  assert.ok(Math.abs(again.total - (base.total - 10000)) < 20, 'tratto rimanente');
  assert.equal(again.offset, 10000);
  assert.equal(again.waypoints[0].kind, 'start');
  assert.ok(again.from.applied, 'con 10 km fatti la taratura si applica');
  assert.ok(Math.abs(again.from.observedFactor - 1) < 0.08, 'consumo come previsto: fattore ~1, era ' + again.from.observedFactor);
  assert.ok(Math.abs(again.energy.arrivalPct - plan.energy.arrivalPct) < 4, 'stesso arrivo previsto');

  /* consumato il doppio: il fattore sale e l'arrivo scende (o il piano si adatta) */
  const used = e.startPct - expectedAt10;
  const worse = P.replanFrom(base, OPTS, e, 'waypoint', 10000, Math.round(e.startPct - 2 * used), plan);
  assert.ok(worse.from.observedFactor > 1.8, 'fattore osservato ' + worse.from.observedFactor);
  assert.equal(worse.energy.personalFactor, 1.5, 'limitato al massimo ammesso');
  assert.ok(worse.from.clamped && worse.from.applied);
  assert.ok(worse.energy.arrivalPct < again.energy.arrivalPct);

  /* andata e ritorno: lo stesso posto è al km 2 e al km 8; il km di riferimento sceglie il passaggio */
  const out = P.sampleRoute().points.slice(0, 1400);
  const back = out.slice().reverse();
  const ab = P.prepareRoute(out.concat(back.slice(1)));
  const spot = P.positionAt(ab.points, 2000);
  const l1 = P.locate(ab, spot.lat, spot.lon);
  assert.ok(l1.candidates.length >= 2, 'due passaggi: ' + JSON.stringify(l1.candidates));
  assert.ok(Math.abs(l1.d - 2000) < 20, 'senza indizi il primo passaggio');
  const l2 = P.locate(ab, spot.lat, spot.lon, { nearD: ab.total - 2300 });
  assert.ok(Math.abs(l2.d - (ab.total - 2000)) < 20, 'col km noto il ritorno: ' + l2.d);
  /* il km noto non fa saltare avanti di 10 km: da km 2 si resta all'andata */
  const l3 = P.locate(ab, spot.lat, spot.lon, { nearD: 1800 });
  assert.ok(Math.abs(l3.d - 2000) < 20, 'resta all\'andata: ' + l3.d);
  /* la direzione di marcia: col verso del ritorno vince il ritorno anche senza km noto */
  const ret = l1.candidates.find((c) => c.d > ab.total / 2);
  const bearingBack = (P.locate(ab, spot.lat, spot.lon, { nearD: ret.d }).bearing);
  const l4 = P.locate(ab, spot.lat, spot.lon, { heading: bearingBack });
  assert.ok(Math.abs(l4.d - ret.d) < 20, 'col verso del ritorno: ' + l4.d);
  assert.ok(l4.candidates.some((c) => c.against), 'l\'andata è segnata controsenso');
  /* alla partenza via e arrivo coincidono: senza indizi è il via */
  const loop = P.prepareRoute(P.sampleRoute().points);
  const s0 = P.locate(loop, loop.points[0].lat + 3 / 111320, loop.points[0].lon);
  assert.ok(s0.d < 50, 'alla partenza: ' + s0.d);
  assert.ok(s0.candidates.some((c) => c.d > loop.total - 100), 'e l\'arrivo è tra i passaggi');

  /* troppo presto per tarare: il fattore resta quello di partenza */
  const early = P.replanFrom(base, OPTS, e, 'waypoint', 800, 95, plan);
  assert.ok(!early.from.applied);
  assert.equal(early.energy.personalFactor, 1);

  /* tutto in AUTO da metà giro */
  const auto = P.replanFrom(base, { adapt: true, lead: 100, boost: false, maxWaypoints: 25 }, Object.assign({ wkg: BAL }, e), 'auto', 15000, 55, plan);
  assert.equal(auto.strategy, 'auto');
  assert.ok(auto.waypoints.length >= 1);

  /* schema rifatto per il resto: con più batteria i livelli salgono, con meno scendono */
  const calcInput = { riderWeight: 87, bikeWeight: 24.2, cadence: 85, riderPower: 85, wkg: BAL };
  const rich = P.retuneFrom(base, OPTS, e, 'waypoint', 10000, 75, plan, calcInput);
  assert.ok(rich.retuned && rich.retuned.scale > 1.2 && rich.retuned.scale <= 1.6, 'scala ' + (rich.retuned && rich.retuned.scale));
  assert.ok(rich.retuned.modes.modes.eco.levelMin >= e.modes.eco.levelMin);
  assert.ok(rich.retuned.result.energy.arrivalPct >= 15 + 3 - 0.01);
  assert.ok(rich.deltas.some((d) => d.changed) && !rich.same);
  const poor = P.retuneFrom(base, OPTS, e, 'waypoint', 10000, 60, plan, calcInput);
  assert.ok(poor.retuned && poor.retuned.scale < 1, 'scala ' + poor.retuned.scale);
  assert.ok(poor.retuned.modes.modes.turbo.maxPower <= e.modes.turbo.maxPower);
  const hopeless = P.retuneFrom(base, OPTS, e, 'waypoint', 10000, 55, plan, calcInput);
  assert.equal(hopeless.retuned, null, 'i livelli hanno un minimo: qui non basta abbassarli');
  assert.ok(hopeless.current.changes.length > 0, 'ma il piano con lo schema attuale abbassa le fasce');

  /* a fine giro non c'è niente da pianificare */
  assert.throws(() => P.replanFrom(base, OPTS, e, 'waypoint', base.total - 100, 50, plan));
});

test('GPX con un waypoint per avviso e tutta la traccia', () => {
  const s = P.sampleRoute();
  const base = P.prepareRoute(s.points);
  const r = P.plan(base, Object.assign({}, OPTS, { boost: true }), null);
  const gpx = P.buildGpx(s.name, r);
  assert.equal((gpx.match(/<wpt /g) || []).length, r.waypoints.length);
  assert.equal((gpx.match(/<trkpt /g) || []).length, base.points.length);
  assert.ok(gpx.startsWith('<?xml'));
  assert.ok(gpx.trim().endsWith('</gpx>'));
});

test('zip valido con un solo file', () => {
  const buf = P.zipSingle('prova.gpx', '<gpx/>');
  const dv = new DataView(buf.buffer);
  assert.equal(dv.getUint32(0, true), 0x04034b50);
  assert.equal(dv.getUint32(buf.length - 22, true), 0x06054b50);
  assert.equal(dv.getUint16(buf.length - 22 + 10, true), 1, 'un solo file nella directory centrale');
  const nameLen = dv.getUint16(26, true);
  assert.equal(Buffer.from(buf.slice(30, 30 + nameLen)).toString(), 'prova.gpx');
  assert.equal(Buffer.from(buf.slice(30 + nameLen, 30 + nameLen + 6)).toString(), '<gpx/>');
});

test('tutto in AUTO: impostazioni nei limiti dell\'app e adattamento alla riserva', () => {
  const base = P.prepareRoute(P.sampleRoute().points);
  const modes = P.calcModes({ riderWeight: 87, bikeWeight: 24.2, cadence: 80, riderPower: 140, wkg: BAL });
  const e = (extra) => Object.assign(energyFor(modes, { riderW: 140, rpm: 80 }), { wkg: BAL }, extra || {});

  const r = P.autoPlan(base, { adapt: true, lead: 100, boost: false }, e());
  const st = r.auto.setting;
  assert.ok(st.levelMin >= 3 && st.levelMax <= 11 && st.levelMin <= st.levelMax, `livelli ${st.levelMin}-${st.levelMax}`);
  assert.ok(st.maxPower % 50 === 0 && st.maxPower >= 200 && st.maxPower <= 1300);
  assert.ok(st.maxTorque % 5 === 0 && st.maxTorque <= 130);
  assert.ok(st.levelMax >= modes.modes.auto.levelMax, 'su un giro con salite ripide AUTO deve salire oltre quella della scheda');
  assert.equal(r.waypoints[0].kind, 'start');
  assert.ok(r.energy.fits);

  const strict = P.autoPlan(base, { adapt: true, lead: 100, boost: false }, e({ reservePct: 40 }));
  assert.ok(strict.energy.fits);
  assert.ok(strict.auto.adapted);
  assert.ok(strict.auto.setting.levelMax < st.levelMax);

  const impossible = P.autoPlan(base, { adapt: true, lead: 100, boost: false }, e({ startPct: 60, reservePct: 50 }));
  assert.ok(impossible.exhausted);
  assert.equal(impossible.auto.setting.levelMin, 3);
});

test('rispetta il limite di waypoint di Wikiloc', () => {
  // quattro giri dell'anello di esempio uno dopo l'altro: ~118 km
  const one = P.sampleRoute().points;
  const long = [].concat(one, one, one, one);
  const base = P.prepareRoute(long);
  const many = Object.assign({}, OPTS, { minLen: 500, minUp: 300, boost: true });

  const free = P.plan(base, many, null);
  assert.ok(free.waypoints.length > 25, `senza limite: ${free.waypoints.length} waypoint`);

  const capped = P.plan(base, Object.assign({}, many, { maxWaypoints: 25 }), null);
  assert.ok(capped.waypoints.length <= 25, `con limite: ${capped.waypoints.length} waypoint`);
  assert.ok(capped.cap.escalated);
  assert.ok(capped.cap.minUp > 300);

  const tight = P.plan(base, Object.assign({}, many, { maxWaypoints: 5 }), null);
  assert.ok(tight.waypoints.length <= 5);
});

test('batteria minima, carica consigliata, freddo e taratura', () => {
  const base = P.prepareRoute(P.sampleRoute().points);
  const modes = P.calcModes({ riderWeight: 87, bikeWeight: 24.2, cadence: 80, riderPower: 140, wkg: BAL });
  const e = (extra) => Object.assign(energyFor(modes, { riderW: 140, rpm: 80 }), extra || {});
  const r = P.plan(base, OPTS, e());
  const en = r.energy;

  // la minima per finire scende lungo il giro e all'arrivo vale la riserva
  assert.ok(Math.abs(en.minPctAt(base.total) - en.reservePct) < 0.5);
  assert.ok(en.minPctAt(0) > en.minPctAt(base.total / 2));
  assert.ok(en.needStartPct % 5 === 0 && en.needStartPct >= en.minPctAt(0));
  assert.ok(en.needStartPrudentPct >= en.needStartPct);
  assert.match(r.waypoints[1].name, / · min \d+%$/);

  // col freddo si arriva più scarichi
  const cold = P.plan(base, Object.assign({}, OPTS, { adapt: false }), e({ temperature: 'frost' }));
  assert.ok(cold.energy.arrivalPct < en.arrivalPct);

  // il fattore personale scala i Wh
  const heavy = P.plan(base, Object.assign({}, OPTS, { adapt: false }), e({ personalFactor: 1.2 }));
  assert.ok(Math.abs(heavy.energy.totalWh / en.totalWh - 1.2) < 0.01);
  assert.ok(Math.abs(heavy.energy.rawTotalWh - en.totalWh) < 0.5);

  // fondo da OSM: tutto asfalto consuma meno del misto
  const road = P.plan(base, Object.assign({}, OPTS, { adapt: false }), e({ surfaceSamples: [{ km: 0, voice: 'tarmac' }, { km: 100, voice: 'tarmac' }] }));
  assert.ok(road.energy.totalWh < en.totalWh);
});

test('fattore personale: mediana dei giri plausibili', () => {
  const ride = (endPct, predictedWh) => ({ startPct: 100, endPct, batteryWh: 800, temperature: 'warm', predictedWh });
  assert.ok(Math.abs(P.rideFactor(ride(50, 400)) - 1) < 1e-9);
  const f = P.personalFactorFrom([ride(50, 400), ride(40, 400), ride(55, 400), ride(98, 400)]);
  assert.equal(f.used, 3);
  assert.equal(f.rejected, 1);
  assert.ok(Math.abs(f.factor - 1) < 1e-9);
  assert.equal(P.personalFactorFrom([]).factor, 1);
});

test('modalità RISERVA sotto ECO', () => {
  const m = P.calcModes({ riderWeight: 87, bikeWeight: 24.2, cadence: 80, riderPower: 140, wkg: BAL });
  assert.ok(m.reserve.levelMin <= m.modes.eco.levelMin);
  assert.ok(m.reserve.maxPower <= m.modes.eco.maxPower);
  assert.equal(m.reserve.maxPower % 50, 0);
});

test('motore M2: stessi risultati del calcolatore originale', () => {
  const lv = (m) => [levels(m), m.maxPower, m.maxTorque];
  const a = P.calcModes({ bike: 'M2', riderWeight: 87, bikeWeight: 24.2, cadence: 80, riderPower: 140, wkg: BAL });
  assert.deepEqual(lv(a.modes.eco), ['4', 150, 25]);
  assert.deepEqual(lv(a.modes.auto), ['5-7', 300, 50]);
  assert.deepEqual(lv(a.modes.trail), ['8-10', 600, 95]);
  assert.deepEqual(lv(a.modes.turbo), ['13', 850, 110]);
  const b = P.calcModes({ bike: 'M2', riderWeight: 95, bikeWeight: 25, cadence: 70, riderPower: 120, wkg: P.PRESETS.enduro.wkg });
  assert.deepEqual(lv(b.modes.eco), ['5', 200, 30]);
  assert.deepEqual(lv(b.modes.auto), ['6-10', 450, 70]);
  assert.deepEqual(lv(b.modes.trail), ['10-13', 800, 110]);
  assert.deepEqual(lv(b.modes.turbo), ['15', 1050, 110]);
  assert.equal(b.modes.turbo.warnings.length, 1);
  assert.equal(b.warnings.length, 1);
});

test('traduzioni: italiano e inglese hanno le stesse chiavi e i segnaposto', () => {
  const T = require('../i18n.js');
  const it = Object.keys(T.it).sort(), en = Object.keys(T.en).sort();
  assert.deepEqual(en, it);
  const vars = (s) => (s.match(/\{\w+\}/g) || []).sort().join(',');
  it.forEach((k) => assert.equal(vars(T.en[k]), vars(T.it[k]), 'segnaposto diversi in ' + k));
});

test('testi del planner in inglese', () => {
  P.setLang('en');
  try {
    const base = P.prepareRoute(P.sampleRoute().points);
    const r = P.plan(base, OPTS, null);
    assert.match(r.waypoints[1].desc, /switch to/);
    assert.match(P.fmtKm(1500), /^1\.5$/);
    assert.match(P.calcModes({ riderWeight: 0, bikeWeight: 1, cadence: 80, riderPower: 100, wkg: BAL }).error, /positive/);
  } finally { P.setLang('it'); }
  assert.match(P.fmtKm(1500), /^1,5$/);
});

test('pagina: chiavi di traduzione esistenti, testi italiani allineati, script e id usati da app.js', () => {
  const fs = require('fs');
  const path = require('path');
  const T = require('../i18n.js');
  const { prefill, usedKeys } = require('../scripts/prefill-i18n.js');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  usedKeys(html).forEach((k) => assert.ok(k in T.it && k in T.en, 'chiave mancante: ' + k));
  assert.equal(prefill(html, T.it), html, 'esegui: node scripts/prefill-i18n.js');
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(scripts, ['surface-osm.js', 'planner.js', 'i18n.js', 'app.js']);
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const ids = new Set([...app.matchAll(/\$\('([\w-]+)'\)/g)].map((m) => m[1]));
  ['copyAuto', 'autoRow', 'autoManual', 'autoManualText', 'useKmBtn', 'replanCues', 'dlRestBtn', 'copyRestBtn', 'restStatus', 'restManual', 'restManualText', 'retuneRows'].forEach((id) => ids.delete(id)); // creati da app.js
  ids.forEach((id) => assert.ok(html.includes('id="' + id + '"'), 'manca id="' + id + '" in index.html'));
  // ogni chiave usata da app.js con t('...') esiste
  [...app.matchAll(/\bt\('([\w.]+)'\s*[,)]/g)].forEach((m) => assert.ok(m[1] in T.it, 'chiave mancante in i18n.js: ' + m[1]));
  assert.match(html, /href="https:\/\/ko-fi\.com\/andicola"/);
  // link di pagamento Stripe: solo indirizzi buy.stripe.com
  const stripe = [...app.matchAll(/\burl: '([^']*)'|custom: '([^']*)'/g)].map((m) => m[1] || m[2]).filter(Boolean);
  assert.equal(stripe.length, 4);
  stripe.forEach((u) => assert.match(u, /^https:\/\/buy\.stripe\.com\/[A-Za-z0-9]+$/));
  assert.match(html, /property="og:image" content="https:\/\/avinox-planner\.pages\.dev\/og-image\.png"/);
});
