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
