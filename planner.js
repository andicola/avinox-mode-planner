/* Avinox Mode Planner — calcolo delle modalità, generatore di waypoint e stima della batteria.
 * Il calcolo delle modalità e il modello di consumo sono il porting lato browser di
 * avinox-setup-app (MIT, © 2026 Luca Donnaloia, https://github.com/lucad87/avinox-setup-app).
 */
(function (root) {
    'use strict';
    var L = {};

    /* ======================= MODALITÀ (Tuner) ======================= */

    var BIKE = { name: 'Avinox M2S', maxTorque: 130, maxPower: 1300 };
    // Rapporto motore/ciclista per livello (tabella comunitaria M2S), indice = livello.
    var ASSIST = [0, 0.35, 0.70, 1.00, 1.50, 1.85, 2.15, 2.45, 3.00, 3.60, 4.35, 5.15, 6.05, 7.00, 7.65, 8.00];
    var BP = {
        eco:   { label: 'ECO',   type: 'fixed', band: [1, 7],  minPower: 100, overrun: 1, start: 3, continued: 3, accel: null },
        auto:  { label: 'AUTO',  type: 'range', band: [3, 11], floorWkg: 1.80, minPower: 200, overrun: 2, start: 5, continued: 5, accel: 3 },
        trail: { label: 'TRAIL', type: 'range', band: [6, 13], floorWkg: 3.60, minPower: 300, overrun: 2, start: 5, continued: 3, accel: null },
        turbo: { label: 'TURBO', type: 'fixed', band: [8, 15], minPower: 400, overrun: 3, start: 5, continued: 3, accel: null }
    };
    var MODE_KEYS = ['eco', 'auto', 'trail', 'turbo'];
    var PRESETS = {
        bilanciato: { label: 'Bilanciato', wkg: [1.36, 2.73, 5.45, 7.72] },
        risparmio:  { label: 'Risparmio',  wkg: [0.85, 1.75, 3.00, 4.25] },
        enduro:     { label: 'Enduro',     wkg: [1.75, 3.75, 6.75, 8.75] }
    };
    var CLIMB_RPM = 60;

    function clamp(v, min, max) { if (min > max) return max; return Math.min(Math.max(v, min), max); }
    function snap(v, step, min, max) {
        var c = Math.min(Math.max(v, min), max);
        return Math.min(Math.max(Math.round(c / step) * step, min), max);
    }
    function nearestLevel(target, lo, hi) {
        var best = -1, bd = Infinity;
        for (var l = lo; l <= hi; l++) {
            var d = ASSIST[l] - target;
            if (d >= 0 && d < bd) { bd = d; best = l; }
        }
        return best < 0 ? hi : best;
    }

    function buildMode(key, lo, hi, targetPower, pRider, rpm, total) {
        var bp = BP[key];
        var idealPower = clamp(Math.round(targetPower), bp.minPower, BIKE.maxPower);
        var maxPower = snap(idealPower, 50, bp.minPower, BIKE.maxPower);
        var idealTorque = (maxPower * 9.55) / Math.min(rpm, CLIMB_RPM);
        var maxTorque = snap(Math.round(idealTorque), 5, 5, BIKE.maxTorque);
        var cruiseTorque = (maxPower * 9.55) / rpm;
        var warnings = [];
        if (cruiseTorque > BIKE.maxTorque + 0.5) {
            warnings.push('A ' + Math.round(rpm) + ' rpm il motore arriva al massimo a ~' +
                Math.round((BIKE.maxTorque * rpm) / 9.55) + ' W: per ' + maxPower + ' W servono almeno ' +
                Math.ceil((maxPower * 9.55) / BIKE.maxTorque) + ' rpm.');
        }
        return {
            key: key, label: bp.label, type: bp.type,
            levelMin: lo, levelMax: hi,
            pctMin: Math.round(ASSIST[lo] * 100), pctMax: Math.round(ASSIST[hi] * 100),
            maxPower: maxPower, maxTorque: maxTorque,
            overrun: bp.overrun, start: bp.start, continued: bp.continued, accel: bp.accel,
            wkg: maxPower / total, warnings: warnings
        };
    }

    /** Stessa sequenza di /api/calculate: ECO → AUTO → TRAIL → TURBO, ognuna ancorata alla precedente. */
    L.calcModes = function (input) {
        var rider = +input.riderWeight, bike = +input.bikeWeight, rpm = +input.cadence, pRider = +input.riderPower;
        if (![rider, bike, rpm, pRider].every(function (n) { return isFinite(n) && n > 0; })) {
            return { error: 'Inserisci peso, cadenza e potenza come numeri positivi.' };
        }
        if (rpm < 20 || rpm > 140) return { error: 'La cadenza deve stare tra 20 e 140 rpm.' };
        var wkg = input.wkg;
        var total = rider + bike;
        var out = {};

        var ecoPower = clamp(Math.round(total * wkg[0]), BP.eco.minPower, BIKE.maxPower);
        var ecoLevel = nearestLevel(ecoPower / pRider, 1, 7);
        out.eco = buildMode('eco', ecoLevel, ecoLevel, ecoPower, pRider, rpm, total);

        var autoPower = clamp(Math.round(total * wkg[1]), BP.auto.minPower, BIKE.maxPower);
        var autoFloor = clamp(Math.round(total * BP.auto.floorWkg), BP.auto.minPower, autoPower);
        var autoMax = nearestLevel(autoPower / pRider, 3, 11);
        var autoMin = clamp(Math.max(nearestLevel(autoFloor / pRider, 3, 11), ecoLevel + 1), 3, autoMax);
        out.auto = buildMode('auto', autoMin, autoMax, autoPower, pRider, rpm, total);

        var trailPower = clamp(Math.round(total * wkg[2]), BP.trail.minPower, BIKE.maxPower);
        var trailFloor = clamp(Math.round(total * BP.trail.floorWkg), BP.trail.minPower, trailPower);
        var trailMax = nearestLevel(trailPower / pRider, 6, 13);
        var trailMin = clamp(Math.max(nearestLevel(trailFloor / pRider, 6, 13), autoMax), 6, trailMax);
        out.trail = buildMode('trail', trailMin, trailMax, trailPower, pRider, rpm, total);

        var turboPower = clamp(Math.round(total * wkg[3]), BP.turbo.minPower, BIKE.maxPower);
        var turboLevel = clamp(Math.max(nearestLevel(turboPower / pRider, 8, 15), trailMax), 8, 15);
        out.turbo = buildMode('turbo', turboLevel, turboLevel, turboPower, pRider, rpm, total);

        var warnings = [];
        var ceiling = Math.round((BIKE.maxTorque * rpm) / 9.55);
        if (out.turbo.maxPower > ceiling) {
            warnings.push('A ' + Math.round(rpm) + ' rpm il motore eroga al massimo ' + ceiling + ' W: il TURBO a ' +
                out.turbo.maxPower + ' W richiede una cadenza più alta.');
        }
        if (pRider < 120) {
            warnings.push('Con una potenza tua sotto i 120 W i livelli escono alti. Se il valore è la media dell\'app su tutto il giro, ' +
                'include discese e soste: la potenza mentre pedali è più alta.');
        }
        // RISERVA: modalità personalizzata (livello fisso) per allungare l'ultima parte del giro,
        // come la "ROUTE RESERVE" proposta dal calcolatore originale (1,10 W/kg, rampa morbida).
        var resPower = snap(clamp(Math.round(total * 1.10), 100, BIKE.maxPower), 50, 100, BIKE.maxPower);
        var resLevel = Math.min(nearestLevel(resPower / pRider, 1, 15), ecoLevel);
        var reserve = {
            key: 'reserve', label: 'RISERVA', type: 'fixed', levelMin: resLevel, levelMax: resLevel,
            pctMin: Math.round(ASSIST[resLevel] * 100), pctMax: Math.round(ASSIST[resLevel] * 100),
            maxPower: resPower, maxTorque: snap(Math.round((resPower * 9.55) / Math.min(rpm, CLIMB_RPM)), 5, 5, BIKE.maxTorque),
            overrun: 1, start: 1, continued: 1, accel: null, wkg: resPower / total, warnings: []
        };
        return { modes: out, reserve: reserve, totalWeight: total, warnings: warnings };
    };

    /* ======================= PERCORSO ======================= */

    var RANK = { eco: 0, auto: 1, trail: 2, turbo: 3 };
    var BANDS = [
        { key: 'descent', label: 'Discesa',  max: -2 },
        { key: 'flat',    label: 'Pianura',  max: 3 },
        { key: 'rolling', label: 'Ondulato', max: 7 },
        { key: 'climb',   label: 'Salita',   max: 12 },
        { key: 'steep',   label: 'Ripida',   max: 18 },
        { key: 'extreme', label: 'Estrema',  max: Infinity }
    ];
    var BAND_ORDER = ['flat', 'rolling', 'climb', 'steep', 'extreme'];
    var STEP = 10;          // m tra i campioni ricampionati
    var SMOOTH = 4;         // ±40 m di media mobile sulla quota
    var HALF_WIN = 7;       // pendenza su ±70 m (finestra 140 m)

    function bandOf(g) {
        for (var i = 0; i < BANDS.length; i++) if (g < BANDS[i].max) return BANDS[i].key;
        return 'extreme';
    }
    function toRad(d) { return (d * Math.PI) / 180; }
    function hav(a, b) {
        var dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
        var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(s)));
    }
    function fmtKm(m) { return (m / 1000).toFixed(1).replace('.', ','); }

    /** GPX (trk/rte) o KML (LineString, gx:Track). Richiede DOMParser (browser). */
    L.parseRoute = function (text, filename) {
        var doc = new DOMParser().parseFromString(text, 'application/xml');
        if (doc.getElementsByTagName('parsererror').length) throw new Error('Il file non è un GPX o KML leggibile.');
        var all = function (name) { return Array.prototype.slice.call(doc.getElementsByTagNameNS('*', name)); };
        var pts = [];
        var name = '';
        var firstName = all('name')[0];
        if (firstName) name = (firstName.textContent || '').trim();
        var gpxPts = all('trkpt');
        if (!gpxPts.length) gpxPts = all('rtept');
        gpxPts.forEach(function (el) {
            var eleEl = el.getElementsByTagNameNS('*', 'ele')[0];
            var ele = eleEl ? parseFloat(eleEl.textContent) : NaN;
            pts.push({ lat: parseFloat(el.getAttribute('lat')), lon: parseFloat(el.getAttribute('lon')), ele: isFinite(ele) ? ele : null });
        });
        if (!pts.length) {
            all('coord').forEach(function (el) { // gx:coord "lon lat ele"
                var p = el.textContent.trim().split(/\s+/).map(parseFloat);
                pts.push({ lat: p[1], lon: p[0], ele: isFinite(p[2]) ? p[2] : null });
            });
        }
        if (!pts.length) {
            all('LineString').forEach(function (ls) {
                var c = ls.getElementsByTagNameNS('*', 'coordinates')[0];
                if (!c) return;
                c.textContent.trim().split(/\s+/).forEach(function (tok) {
                    var p = tok.split(',').map(parseFloat);
                    if (p.length >= 2) pts.push({ lat: p[1], lon: p[0], ele: isFinite(p[2]) ? p[2] : null });
                });
            });
        }
        if (!name) name = String(filename || 'percorso').replace(/\.(gpx|kml)$/i, '');
        return { name: name, points: pts };
    };

    /** Punti puliti con distanza cumulata e quota completa. */
    function cleanPoints(points) {
        var pts = [];
        points.forEach(function (p) {
            if (!isFinite(p.lat) || !isFinite(p.lon) || Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180) return;
            if (p.lat === 0 && p.lon === 0) return;
            var q = { lat: p.lat, lon: p.lon, ele: isFinite(p.ele) && p.ele !== null ? p.ele : null, d: 0 };
            if (pts.length) {
                var step = hav(pts[pts.length - 1], q);
                if (step < 0.5) return;
                q.d = pts[pts.length - 1].d + step;
            }
            pts.push(q);
        });
        if (pts.length < 2) throw new Error('Il file non contiene una traccia.');
        var withEle = pts.filter(function (p) { return p.ele !== null; }).length;
        if (withEle < pts.length * 0.5) throw new Error('La traccia non ha la quota: senza altimetria non si possono calcolare le pendenze. Esportala da Wikiloc o da un planner che aggiunge la quota.');
        var lastIdx = -1;
        for (var i = 0; i < pts.length; i++) {
            if (pts[i].ele === null) continue;
            if (lastIdx === -1) { for (var j = 0; j < i; j++) pts[j].ele = pts[i].ele; }
            else if (i - lastIdx > 1) {
                var a = pts[lastIdx], b = pts[i];
                for (var k = lastIdx + 1; k < i; k++) pts[k].ele = a.ele + (b.ele - a.ele) * ((pts[k].d - a.d) / (b.d - a.d));
            }
            lastIdx = i;
        }
        for (var m = lastIdx + 1; m < pts.length; m++) pts[m].ele = pts[lastIdx].ele;
        return pts;
    }

    function positionAt(pts, d) {
        if (d <= 0) return { lat: pts[0].lat, lon: pts[0].lon, ele: pts[0].ele };
        var lo = 0, hi = pts.length - 1;
        if (d >= pts[hi].d) return { lat: pts[hi].lat, lon: pts[hi].lon, ele: pts[hi].ele };
        while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (pts[mid].d <= d) lo = mid; else hi = mid; }
        var a = pts[lo], b = pts[hi], t = (d - a.d) / (b.d - a.d);
        return { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t, ele: a.ele + (b.ele - a.ele) * t };
    }

    /**
     * Lettura del percorso, fatta una volta sola: ricampionamento ogni 10 m,
     * quota mediata su ±40 m, pendenza su 140 m, fascia di pendenza per campione.
     */
    L.prepareRoute = function (points) {
        var pts = cleanPoints(points);
        var total = pts[pts.length - 1].d;
        if (total < 300) throw new Error('La traccia è troppo corta (meno di 300 m).');
        var N = Math.floor(total / STEP) + 1, ele = new Array(N), j = 0, k;
        for (k = 0; k < N; k++) {
            var t = k * STEP;
            while (j < pts.length - 2 && pts[j + 1].d < t) j++;
            var a = pts[j], b = pts[j + 1], f = (t - a.d) / (b.d - a.d);
            ele[k] = a.ele + (b.ele - a.ele) * Math.min(Math.max(f, 0), 1);
        }
        var pre = [0];
        for (k = 0; k < N; k++) pre.push(pre[k] + ele[k]);
        var es = new Array(N);
        for (k = 0; k < N; k++) {
            var lo = Math.max(0, k - SMOOTH), hi = Math.min(N - 1, k + SMOOTH);
            es[k] = (pre[hi + 1] - pre[lo]) / (hi - lo + 1);
        }
        var g = new Array(N);
        for (k = 0; k < N; k++) {
            var l2 = Math.max(0, k - HALF_WIN), h2 = Math.min(N - 1, k + HALF_WIN);
            g[k] = h2 > l2 ? ((es[h2] - es[l2]) / ((h2 - l2) * STEP)) * 100 : 0;
        }
        var gain = 0, loss = 0;
        for (k = 1; k < N; k++) { var dz = es[k] - es[k - 1]; if (dz > 0) gain += dz; else loss -= dz; }
        var trackStride = Math.max(1, Math.round(pts.length / 800));
        return {
            points: pts, total: total, N: N, es: es, g: g, band: g.map(bandOf),
            gain: gain, loss: loss,
            minEle: Math.min.apply(null, es), maxEle: Math.max.apply(null, es),
            stride: Math.max(1, Math.round(N / 600)),
            track: pts.filter(function (p, i) { return i % trackStride === 0 || i === pts.length - 1; })
        };
    };

    function coalesce(runs) {
        for (var i = runs.length - 1; i > 0; i--) {
            if (runs[i].mode === runs[i - 1].mode) { runs[i - 1].end = runs[i].end; runs.splice(i, 1); }
        }
    }

    /**
     * Assorbe i tratti troppo corti nel vicino più simile (a parità, il più forte).
     * Un tratto che alza l'assistenza rispetto a entrambi i vicini (una salita vera)
     * resta se è lungo almeno minUp; tutti gli altri devono arrivare a minLen.
     */
    function mergeShort(runs, minLen, minUp) {
        for (;;) {
            coalesce(runs);
            if (runs.length <= 1) return runs;
            var idx = -1, best = Infinity;
            for (var i = 0; i < runs.length; i++) {
                var len = runs[i].end - runs[i].start;
                var lr = runs[i - 1] ? RANK[runs[i - 1].mode] : -1, rr = runs[i + 1] ? RANK[runs[i + 1].mode] : -1;
                var need = RANK[runs[i].mode] > Math.max(lr, rr) ? minUp : minLen;
                if (len < need && len < best) { best = len; idx = i; }
            }
            if (idx < 0) return runs;
            var r = runs[idx], left = runs[idx - 1], right = runs[idx + 1], target;
            if (!left) target = right;
            else if (!right) target = left;
            else {
                var dl = Math.abs(RANK[left.mode] - RANK[r.mode]), dr = Math.abs(RANK[right.mode] - RANK[r.mode]);
                target = dl < dr ? left : dr < dl ? right : (RANK[left.mode] >= RANK[right.mode] ? left : right);
            }
            r.mode = target.mode;
        }
    }

    /** Tratti di modalità per una data associazione fascia → modalità. */
    function segment(base, mapping, minLen, minUp) {
        var N = base.N, es = base.es, g = base.g, k;
        var label = base.band.map(function (bk) { return bk === 'descent' ? null : mapping[bk]; });
        var first = null;
        for (k = 0; k < N; k++) if (label[k]) { first = label[k]; break; }
        var prev = first || mapping.flat;
        for (k = 0; k < N; k++) { if (label[k]) prev = label[k]; else label[k] = prev; }
        var runs = [];
        for (k = 0; k < N; k++) {
            if (!runs.length || runs[runs.length - 1].mode !== label[k]) {
                if (runs.length) runs[runs.length - 1].end = k * STEP;
                runs.push({ mode: label[k], start: k * STEP, end: base.total });
            }
        }
        runs[runs.length - 1].end = base.total;
        mergeShort(runs, minLen, minUp);
        runs.forEach(function (r) {
            var i0 = idxOf(base, r.start), i1 = idxOf(base, r.end), gain = 0, loss = 0, maxG = -Infinity;
            for (var i = i0; i <= i1; i++) {
                if (i > i0) { var dz = es[i] - es[i - 1]; if (dz > 0) gain += dz; else loss -= dz; }
                if (g[i] > maxG) maxG = g[i];
            }
            r.i0 = i0; r.i1 = i1; r.length = r.end - r.start; r.gain = gain; r.loss = loss; r.maxGrade = maxG;
        });
        return runs;
    }
    function idxOf(base, d) { return Math.min(base.N - 1, Math.max(0, Math.round(d / STEP))); }

    /**
     * Come segment, ma resta entro maxRuns tratti: se ce ne sono di più alza le
     * lunghezze minime del 25% alla volta, così spariscono per primi i tratti più corti.
     * Ogni tratto è un waypoint (il primo è lo START): Wikiloc ne accetta al massimo 25.
     */
    function segmentWithin(base, mapping, minLen, minUp, maxRuns) {
        var len = minLen, up = minUp, runs = segment(base, mapping, len, up), steps = 0;
        while (maxRuns && runs.length > maxRuns && steps < 40) {
            len *= 1.25; up *= 1.25; steps++;
            runs = segment(base, mapping, len, up);
        }
        return { runs: runs, minLen: Math.round(len), minUp: Math.round(up), escalated: steps > 0 };
    }

    /* ---------------- energia (stesso modello del calcolatore) ---------------- */
    /* Consumo dal pacco: 3,8 Wh/km in piano + 0,24 Wh per metro di dislivello ogni
       100 kg, per il fattore del fondo e +35% sui tratti oltre il 12%. Questo è il
       consumo con le modalità DJI di serie nel mix tipico di quel terreno; ogni
       modalità ne prende la sua parte in proporzione alla quota di lavoro del motore. */
    var FLAT_WH_PER_KM = 3.8, CLIMB_WH_PER_M_PER_100KG = 0.24, STEEP_PENALTY = 0.35, MARGIN = 0.22;
    var STOCK = { eco: [4, 4, 200, 50], auto: [3, 11, 1300, 130], trail: [6, 11, 1300, 130], turbo: [13, 13, 1300, 130] };
    /* factor: consumo; torque: tetto di coppia consigliato per l'aderenza (dal calcolatore originale). */
    var SURFACES = {
        road:      { label: 'Asfalto', factor: 1.00, torque: 1.15 },
        gravel:    { label: 'Sterrato compatto', factor: 1.12, torque: 1.05 },
        mixed:     { label: 'Misto MTB: terra, sassi, radici', factor: 0.2 * 1.12 + 0.4 * 1.18 + 0.4 * 1.22, torque: 0.2 * 1.05 + 0.4 * 1.00 + 0.4 * 0.90 },
        technical: { label: 'Tecnico: roccia e radici', factor: 1.35, torque: 0.85, soft: true },
        mud:       { label: 'Fango o sabbia', factor: 1.55, torque: 0.95, soft: true }
    };
    /* Le sei voci di fondo del calcolatore originale: [consumo, coppia]. */
    var VOICE_FACTORS = {
        tarmac: [1.00, 1.15], compacted: [1.12, 1.05], hardpack: [1.18, 1.00],
        mixed: [1.22, 0.90], rock: [1.35, 0.85], mud: [1.55, 0.95]
    };
    var VOICE_LABELS = {
        tarmac: 'asfalto', compacted: 'sterrato compatto', hardpack: 'terra battuta',
        mixed: 'sassi e radici', rock: 'roccia', mud: 'fango o sabbia'
    };
    /* Capacità utilizzabile col freddo: stime prudenti, non dati DJI. */
    var TEMPERATURES = {
        warm: { label: 'Sopra 15 °C', factor: 1.00 },
        mild: { label: 'Tra 5 e 15 °C', factor: 0.95 },
        cold: { label: 'Tra 0 e 5 °C', factor: 0.88 },
        frost: { label: 'Sotto 0 °C', factor: 0.80 }
    };

    /**
     * Fattori di fondo campione per campione. Con i dati di OpenStreetMap
     * (e.surfaceSamples: [{km, voice}] ogni ~500 m) ogni campione prende la voce
     * del punto OSM più vicino; dove OSM non dice nulla vale il fondo scelto.
     */
    function surfaceProfile(base, e) {
        if (e._surf && e._surf.base === base) return e._surf;
        var def = SURFACES[e.surface] || SURFACES.mixed;
        var smp = Array.isArray(e.surfaceSamples) && e.surfaceSamples.length ? e.surfaceSamples : null;
        var sf = new Array(base.N), tf = new Array(base.N), j = 0, known = 0, torqueSum = 0, soft = 0;
        for (var k = 0; k < base.N; k++) {
            var voice = null;
            if (smp) {
                var d = k * STEP;
                while (j + 1 < smp.length && Math.abs(smp[j + 1].km * 1000 - d) <= Math.abs(smp[j].km * 1000 - d)) j++;
                voice = smp[j].voice;
            }
            if (voice && VOICE_FACTORS[voice]) {
                sf[k] = VOICE_FACTORS[voice][0]; tf[k] = VOICE_FACTORS[voice][1]; known++;
                if (voice === 'rock' || voice === 'mud') soft++;
            } else { sf[k] = def.factor; tf[k] = def.torque; if (def.soft) soft++; }
            torqueSum += tf[k];
        }
        e._surf = { base: base, sf: sf, tf: tf, meanTorque: torqueSum / base.N, knownShare: known / base.N, softShare: soft / base.N, fromOsm: !!smp };
        return e._surf;
    }

    function modeMixFor(c) {
        c = clamp(c, 0, 1); var f = 1 - c;
        return { eco: 0.40 * f + 0.15 * c, auto: 0.50 * f + 0.45 * c, trail: 0.10 * f + 0.32 * c, turbo: 0.08 * c };
    }
    function motorShare(w, rider) { return w > 0 && rider > 0 ? w / (w + rider) : 0; }

    /** Quote di lavoro del motore per le modalità impostate e per quelle di serie. */
    function shares(e) {
        var mine = {}, stock = {};
        MODE_KEYS.forEach(function (k) {
            var m = e.modes[k];
            var w = Math.round(Math.min(m.maxPower, (BIKE.maxTorque * e.rpm) / 9.55, ((ASSIST[m.levelMin] + ASSIST[m.levelMax]) / 2) * e.riderW));
            mine[k] = motorShare(w, e.riderW);
            var s = STOCK[k];
            var ws = Math.round(Math.min(((ASSIST[s[0]] + ASSIST[s[1]]) / 2) * e.riderW, s[2], (s[3] * e.rpm) / 9.55));
            stock[k] = motorShare(ws, e.riderW);
        });
        return { mine: mine, stock: stock };
    }

    /** Quota del mix DJI di serie sul terreno di un tratto: il riferimento del modello. */
    function anchorOf(r, sh, cW) {
        var flatWh = (r.length / 1000) * FLAT_WH_PER_KM, climbWh = r.gain * cW;
        var mix = modeMixFor(climbWh / (flatWh + climbWh || 1));
        return MODE_KEYS.reduce(function (s, k) { return s + mix[k] * sh.stock[k]; }, 0);
    }

    /** Wh cumulati campione per campione e batteria prevista lungo il giro. */
    function energyOf(base, runs, e) {
        var sh = shares(e);
        var cW = (CLIMB_WH_PER_M_PER_100KG * e.totalWeight) / 100;
        var factor = new Array(base.N);
        runs.forEach(function (r) {
            var anchor = anchorOf(r, sh, cW);
            r.whFactor = anchor > 0 ? sh.mine[r.mode] / anchor : 1;
            for (var i = r.i0; i <= r.i1; i++) factor[i] = r.whFactor;
        });
        var en = energyFromFactors(base, e, factor);
        runs.forEach(function (r) { r.wh = en.cum[r.i1] - en.cum[r.i0]; });
        return en;
    }

    /**
     * factor[k] = quota motore / riferimento per il campione k. Qui si aggiungono
     * il fondo (per campione), il fattore personale della taratura e il freddo.
     */
    function energyFromFactors(base, e, factor) {
        var cW = (CLIMB_WH_PER_M_PER_100KG * e.totalWeight) / 100;
        var sf = surfaceProfile(base, e).sf;
        var personal = e.personalFactor > 0 ? e.personalFactor : 1;
        var cum = new Array(base.N); cum[0] = 0;
        for (var k = 1; k < base.N; k++) {
            var dz = base.es[k] - base.es[k - 1];
            var wh = ((STEP / 1000) * FLAT_WH_PER_KM + Math.max(dz, 0) * cW) * (base.g[k] >= 12 ? 1 + STEEP_PENALTY : 1) * factor[k] * sf[k] * personal;
            cum[k] = cum[k - 1] + wh;
        }
        var totalWh = cum[base.N - 1];
        var effWh = e.batteryWh * ((TEMPERATURES[e.temperature] || TEMPERATURES.warm).factor);
        var pctPerWh = 100 / effWh;
        var arrival = e.startPct - totalWh * pctPerWh;
        var ceil5 = function (x) { return Math.ceil(x / 5) * 5; };
        return {
            cum: cum, totalWh: totalWh, rawTotalWh: totalWh / personal, personalFactor: personal,
            low: totalWh * (1 - MARGIN), high: totalWh * (1 + MARGIN),
            batteryWh: e.batteryWh, effectiveWh: effWh, startPct: e.startPct, reservePct: e.reservePct,
            usableWh: (effWh * (e.startPct - e.reservePct)) / 100,
            arrivalPct: arrival,
            arrivalBest: e.startPct - totalWh * (1 - MARGIN) * pctPerWh,
            arrivalWorst: e.startPct - totalWh * (1 + MARGIN) * pctPerWh,
            fits: arrival >= e.reservePct,
            // carica che serve alla partenza per arrivare con la riserva (stima e con il margine)
            needStartPct: ceil5(e.reservePct + totalWh * pctPerWh),
            needStartPrudentPct: ceil5(e.reservePct + totalWh * (1 + MARGIN) * pctPerWh),
            pctAt: function (d) { return e.startPct - cum[idxOf(base, d)] * pctPerWh; },
            // carica minima in quel punto per finire il giro con la riserva
            minPctAt: function (d) { return e.reservePct + (totalWh - cum[idxOf(base, d)]) * pctPerWh; }
        };
    }

    /** Passi per risparmiare: ogni giro abbassa di una modalità le fasce, dalla più facile alla più ripida. */
    function downgradeSteps(mapping) {
        var m = Object.assign({}, mapping), steps = [];
        for (var round = 0; round < 3; round++) {
            BAND_ORDER.forEach(function (b) {
                if (RANK[m[b]] > 0) { m[b] = MODE_KEYS[RANK[m[b]] - 1]; steps.push({ band: b, to: m[b] }); }
            });
        }
        return steps;
    }

    function buildWaypoints(base, runs, mapping, opts, energy, maxBoost) {
        var pts = base.points, g = base.g, N = base.N, lead = opts.lead, wps = [], lastD = -Infinity, k;
        var batt = function (d) {
            if (!energy) return '';
            var min = Math.max(0, Math.round(energy.minPctAt(d)));
            return ' Batteria prevista ~' + Math.round(energy.pctAt(d)) + '%. Se sei sotto il ' + min + '%, passa a una modalità più bassa o a RISERVA.';
        };
        var minTxt = function (d) { return energy ? ' · min ' + Math.max(0, Math.round(energy.minPctAt(d))) + '%' : ''; };
        runs.forEach(function (r, i) {
            var kind = i === 0 ? 'start' : (RANK[r.mode] > RANK[runs[i - 1].mode] ? 'up' : 'down');
            var d = kind === 'up' ? r.start - lead : r.start;
            d = Math.max(d, 0, lastD + 50);
            lastD = d;
            var p = positionAt(pts, d);
            var gainTxt = r.gain >= 20 ? ' +' + Math.round(r.gain) + ' m' : '';
            wps.push({
                kind: kind, mode: r.mode, dist: d, changeAt: r.start, lat: p.lat, lon: p.lon, ele: p.ele, run: r,
                battery: energy ? energy.pctAt(d) : null, minBattery: energy ? energy.minPctAt(d) : null,
                name: (kind === 'start' ? 'START · ' : '') + BP[r.mode].label + ' · ' + fmtKm(r.length) + ' km' + gainTxt + minTxt(d),
                desc: 'km ' + fmtKm(d) + ': passa a ' + BP[r.mode].label + ' per ' + fmtKm(r.length) + ' km' +
                    (r.gain >= 20 ? ', D+ ' + Math.round(r.gain) + ' m' : '') +
                    (r.maxGrade >= 3 ? ', pendenza max ' + Math.round(r.maxGrade) + '%' : '') + '.' + batt(d)
            });
        });
        // rampe brevi e ripide dentro tratti con meno assistenza della fascia "Ripida"
        // i pezzi oltre il 14% separati da meno di 100 m sono la stessa rampa
        var ramps = [], rs = -1, lastSteep = -1;
        for (k = 0; k <= N; k++) {
            var isSteep = k < N && g[k] >= 14;
            if (isSteep) { if (rs < 0) rs = k; lastSteep = k; continue; }
            if (rs >= 0 && (k === N || k - lastSteep > 10)) {
                var end = lastSteep + 1, len = (end - rs) * STEP, mid = ((rs + end) / 2) * STEP;
                var host = runs.filter(function (r) { return mid >= r.start && mid < r.end; })[0] || runs[runs.length - 1];
                if (len >= 80 && len <= 300 && RANK[host.mode] < RANK[mapping.steep]) {
                    var mx = -Infinity;
                    for (var q = rs; q < end; q++) mx = Math.max(mx, g[q]);
                    ramps.push({ start: rs * STEP, length: len, maxGrade: mx });
                }
                rs = -1;
            }
        }
        var droppedBoost = 0;
        if (opts.boost) {
            var room = isFinite(maxBoost) ? Math.max(0, maxBoost) : Infinity, own = [];
            ramps.forEach(function (rp) {
                var d = Math.max(0, rp.start - lead);
                var lenTxt = Math.round(rp.length / 10) * 10 + ' m';
                var near = wps.filter(function (w) { return w.kind !== 'boost' && Math.abs(w.dist - d) < 200; })[0];
                if (near) { near.desc += ' Subito dopo: rampa di ' + lenTxt + ' al ' + Math.round(rp.maxGrade) + '%, usa il Boost.'; return; }
                own.push({ rp: rp, d: d, lenTxt: lenTxt });
            });
            own.sort(function (x, y) { return y.rp.maxGrade - x.rp.maxGrade; });
            droppedBoost = Math.max(0, own.length - room);
            own.slice(0, room).forEach(function (o) {
                var rp = o.rp, d = o.d, lenTxt = o.lenTxt;
                var p = positionAt(pts, d);
                wps.push({
                    kind: 'boost', mode: 'boost', dist: d, changeAt: rp.start, lat: p.lat, lon: p.lon, ele: p.ele, run: null,
                    battery: energy ? energy.pctAt(d) : null, minBattery: energy ? energy.minPctAt(d) : null,
                    name: 'BOOST · rampa ' + lenTxt + ' al ' + Math.round(rp.maxGrade) + '%',
                    desc: 'km ' + fmtKm(d) + ': rampa breve di ' + lenTxt + ', pendenza max ' + Math.round(rp.maxGrade) +
                        '%. Usa il Boost senza cambiare modalità.' + batt(d)
                });
            });
            wps.sort(function (x, y) { return x.dist - y.dist; });
        }
        return { waypoints: wps, ramps: ramps, droppedBoost: droppedBoost };
    }

    /**
     * Piano completo.
     * opts: { mapping, minLen, minUp, lead, boost, adapt, maxWaypoints }
     * e (facoltativo): { modes, totalWeight, riderW, rpm, batteryWh, startPct, reservePct, surface }
     * Con adapt attivo e arrivo sotto la riserva, abbassa le fasce finché il giro ci sta.
     */
    L.plan = function (base, opts, e) {
        var wanted = Object.assign({}, opts.mapping), mapping = Object.assign({}, wanted);
        var limit = opts.maxWaypoints > 0 ? Math.floor(opts.maxWaypoints) : 0;
        var seg = segmentWithin(base, mapping, opts.minLen, opts.minUp, limit);
        var runs = seg.runs;
        var energy = e ? energyOf(base, runs, e) : null;
        var exhausted = false;
        if (energy && opts.adapt && !energy.fits) {
            var steps = downgradeSteps(mapping), i = 0;
            while (!energy.fits && i < steps.length) {
                mapping[steps[i].band] = steps[i].to; i++;
                seg = segmentWithin(base, mapping, opts.minLen, opts.minUp, limit);
                runs = seg.runs;
                energy = energyOf(base, runs, e);
            }
            exhausted = !energy.fits;
        }
        var changes = BAND_ORDER.filter(function (b) { return mapping[b] !== wanted[b]; })
            .map(function (b) { return { band: b, from: wanted[b], to: mapping[b] }; });
        var wp = buildWaypoints(base, runs, mapping, opts, energy, limit ? limit - runs.length : Infinity);
        var share = { eco: 0, auto: 0, trail: 0, turbo: 0 };
        runs.forEach(function (r) { share[r.mode] += r.length; });
        var profile = [];
        for (var k = 0; k < base.N; k += base.stride) {
            profile.push({ d: k * STEP, ele: base.es[k], pct: energy ? energy.startPct - energy.cum[k] * 100 / energy.batteryWh : null });
        }
        var last = base.N - 1;
        if (profile[profile.length - 1].d !== last * STEP) {
            profile.push({ d: last * STEP, ele: base.es[last], pct: energy ? energy.arrivalPct : null });
        }
        return {
            total: base.total, gain: base.gain, loss: base.loss, minEle: base.minEle, maxEle: base.maxEle,
            points: base.points, track: base.track, profile: profile,
            runs: runs, waypoints: wp.waypoints, ramps: wp.ramps, share: share,
            mapping: mapping, changes: changes, energy: energy, exhausted: exhausted,
            cap: { limit: limit, escalated: seg.escalated, minLen: seg.minLen, minUp: seg.minUp, droppedBoost: wp.droppedBoost }
        };
    };

    /* ---------------- tutto il giro in AUTO ---------------- */
    function quantile(sorted, q) {
        if (!sorted.length) return 0;
        var i = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
        return sorted[i];
    }
    function lerpPoints(x, pts) {
        if (x <= pts[0][0]) return pts[0][1];
        for (var i = 1; i < pts.length; i++) {
            if (x <= pts[i][0]) { var a = pts[i - 1], b = pts[i]; return a[1] + ((x - a[0]) / (b[0] - a[0])) * (b[1] - a[1]); }
        }
        return pts[pts.length - 1][1];
    }

    /**
     * Impostazioni di AUTO per fare tutto il giro senza cambiare modalità.
     * e: come in plan, più wkg (i W/kg dello stile: eco, auto, trail, turbo).
     * opts: { adapt, lead, boost }
     *
     * - Livello minimo: quello di AUTO nello schema (serve in piano).
     * - Livello massimo e potenza: dimensionati sulle salite più dure del giro
     *   (90° percentile della pendenza in salita), interpolando tra i W/kg di
     *   AUTO (6%), TRAIL (10%) e TURBO (15%) dello stile. In app AUTO arriva al livello 11.
     * - Coppia: potenza a 60 rpm, ridotta o alzata per l'aderenza del fondo.
     * - Il modello fa salire l'aiuto dal minimo al massimo tra il 2% e la
     *   pendenza delle salite più dure, come AUTO che cresce con la resistenza.
     * - Se il giro non ci sta nella riserva, abbassa prima il massimo e poi il minimo.
     */
    L.autoPlan = function (base, opts, e) {
        var g = base.g, N = base.N, k;
        var climbs = [];
        var steepCount = 0;
        for (k = 0; k < N; k++) { if (g[k] >= 3) climbs.push(g[k]); if (g[k] >= 12) steepCount++; }
        climbs.sort(function (a, b) { return a - b; });
        var p90 = quantile(climbs, 0.9), gMax = Math.max.apply(null, g), steepShare = steepCount / N;
        var surface = SURFACES[e.surface] || SURFACES.mixed;
        var surf = surfaceProfile(base, e);
        var tuned = e.modes.auto;
        var W = e.totalWeight, rider = e.riderW, rpm = e.rpm;
        var gTop = Math.max(8, p90);

        var wkgTop = lerpPoints(p90, [[6, e.wkg[1]], [10, e.wkg[2]], [15, e.wkg[3]]]);
        var targetPower = clamp(Math.round(W * wkgTop), BP.auto.minPower, BIKE.maxPower);
        var soft = surf.softShare >= 0.25 || steepShare >= 0.12;

        function setting(lo, hi, power) {
            var maxPower = snap(power, 50, BP.auto.minPower, BIKE.maxPower);
            var torque = snap(Math.round(((maxPower * 9.55) / Math.min(rpm, 60)) * surf.meanTorque), 5, 5, BIKE.maxTorque);
            return {
                levelMin: lo, levelMax: hi, pctMin: Math.round(ASSIST[lo] * 100), pctMax: Math.round(ASSIST[hi] * 100),
                maxPower: maxPower, maxTorque: torque,
                overrun: BP.auto.overrun, start: soft ? 2 : BP.auto.start, continued: BP.auto.continued, accel: soft ? 2 : BP.auto.accel
            };
        }

        // riferimento del modello per tratti di terreno omogeneo
        var sh = shares(e), cW = (CLIMB_WH_PER_M_PER_100KG * e.totalWeight) / 100;
        var refRuns = segment(base, { flat: 'eco', rolling: 'auto', climb: 'trail', steep: 'turbo', extreme: 'turbo' }, 800, 400);
        var anchor = new Array(N);
        refRuns.forEach(function (r) { var a = anchorOf(r, sh, cW); for (var i = r.i0; i <= r.i1; i++) anchor[i] = a; });
        var torqueCeil = (BIKE.maxTorque * rpm) / 9.55;

        function simulate(st) {
            var lo = ASSIST[st.levelMin], hi = ASSIST[st.levelMax], factor = new Array(N);
            for (var i = 0; i < N; i++) {
                var t = clamp((g[i] - 2) / (gTop - 2), 0, 1);
                var w = Math.min(st.maxPower, torqueCeil, (lo + t * (hi - lo)) * rider);
                var shareI = motorShare(w, rider);
                factor[i] = anchor[i] > 0 ? shareI / anchor[i] : 1;
            }
            return energyFromFactors(base, e, factor);
        }

        var minLevel = tuned.levelMin;
        var maxLevel = clamp(nearestLevel(targetPower / rider, 3, 11), minLevel, 11);
        var proposed = setting(minLevel, maxLevel, targetPower);
        var current = proposed, energy = simulate(current), steps = [], exhausted = false;
        if (opts.adapt && !energy.fits) {
            var lo = minLevel, hi = maxLevel;
            while (!energy.fits) {
                if (hi > lo) hi--;
                else if (lo > 3) { lo--; hi = lo; }
                else { exhausted = true; break; }
                var power = Math.min(targetPower, Math.max(BP.auto.minPower, ASSIST[hi] * rider));
                current = setting(lo, hi, power);
                energy = simulate(current);
            }
            steps.push({ from: proposed, to: current });
        }
        var tunedSetting = setting(tuned.levelMin, tuned.levelMax, tuned.maxPower);
        tunedSetting.maxTorque = tuned.maxTorque; tunedSetting.start = tuned.start; tunedSetting.accel = tuned.accel;

        var run = { mode: 'auto', start: 0, end: base.total, i0: 0, i1: N - 1, length: base.total, gain: base.gain, loss: base.loss, maxGrade: gMax };
        var limit = opts.maxWaypoints > 0 ? Math.floor(opts.maxWaypoints) : 0;
        var wp = buildWaypoints(base, [run], { steep: 'turbo' }, opts, energy, limit ? limit - 1 : Infinity);
        var startWp = wp.waypoints.filter(function (w) { return w.kind === 'start'; })[0];
        if (startWp) {
            var after = startWp.desc.indexOf(' Subito dopo:') >= 0 ? startWp.desc.slice(startWp.desc.indexOf(' Subito dopo:')) : '';
            startWp.name = 'START · AUTO ' + current.levelMin + '–' + current.levelMax + ' · ' + current.maxPower + ' W · min ' + energy.needStartPct + '%';
            startWp.desc = 'km 0,0: tutto il giro in AUTO, livelli ' + current.levelMin + '–' + current.levelMax + ', potenza max ' +
                current.maxPower + ' W, coppia max ' + current.maxTorque + ' Nm. Parti con almeno il ' + energy.needStartPct + '%.' + after;
        }
        var profile = [];
        for (k = 0; k < N; k += base.stride) profile.push({ d: k * STEP, ele: base.es[k], pct: e.startPct - energy.cum[k] * 100 / e.batteryWh });
        if (profile[profile.length - 1].d !== (N - 1) * STEP) profile.push({ d: (N - 1) * STEP, ele: base.es[N - 1], pct: energy.arrivalPct });

        return {
            strategy: 'auto',
            total: base.total, gain: base.gain, loss: base.loss, minEle: base.minEle, maxEle: base.maxEle,
            points: base.points, track: base.track, profile: profile,
            runs: [run], waypoints: wp.waypoints, ramps: wp.ramps, share: { eco: 0, auto: base.total, trail: 0, turbo: 0 },
            mapping: null, changes: [], energy: energy, exhausted: exhausted,
            cap: { limit: limit, escalated: false, droppedBoost: wp.droppedBoost },
            auto: {
                setting: current, proposed: proposed, tuned: tunedSetting, tunedEnergy: simulate(tunedSetting),
                adapted: steps.length > 0, p90: p90, gMax: gMax, steepShare: steepShare, soft: soft,
                surface: surface, surfaceTorque: surf.meanTorque, surfaceFromOsm: surf.fromOsm, targetPower: targetPower, levelCapped: nearestLevel(targetPower / rider, 3, 15) > 11
            }
        };
    };

    /* ---------------- taratura con i giri reali ---------------- */
    var FACTOR_MIN = 0.5, FACTOR_MAX = 1.5;

    /** Fattore di un giro: Wh consumati davvero / Wh previsti dal modello senza taratura. */
    L.rideFactor = function (ride) {
        var measured = ((ride.startPct - ride.endPct) / 100) * ride.batteryWh * ((TEMPERATURES[ride.temperature] || TEMPERATURES.warm).factor);
        return ride.predictedWh > 0 ? measured / ride.predictedWh : NaN;
    };

    /** Mediana dei fattori plausibili (0,5–1,5): un giro anomalo non sposta tutto. */
    L.personalFactorFrom = function (rides) {
        var ok = [], rejected = 0;
        (rides || []).forEach(function (r) {
            var f = L.rideFactor(r);
            if (isFinite(f) && f >= FACTOR_MIN && f <= FACTOR_MAX) ok.push(f); else rejected++;
        });
        if (!ok.length) return { factor: 1, used: 0, rejected: rejected };
        ok.sort(function (a, b) { return a - b; });
        var mid = ok.length >> 1;
        var factor = ok.length % 2 ? ok[mid] : (ok[mid - 1] + ok[mid]) / 2;
        return { factor: factor, used: ok.length, rejected: rejected };
    };

    function xml(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    L.buildGpx = function (name, result) {
        var out = ['<?xml version="1.0" encoding="UTF-8"?>',
            '<gpx version="1.1" creator="Avinox Mode Planner" xmlns="http://www.topografix.com/GPX/1/1">',
            '  <metadata><name>' + xml(name) + '</name><desc>Cambi di modalità Avinox</desc></metadata>'];
        result.waypoints.forEach(function (w) {
            out.push('  <wpt lat="' + w.lat.toFixed(6) + '" lon="' + w.lon.toFixed(6) + '">' +
                '<ele>' + w.ele.toFixed(1) + '</ele><name>' + xml(w.name) + '</name><desc>' + xml(w.desc) + '</desc>' +
                '<sym>Flag, Blue</sym><type>' + (w.kind === 'boost' ? 'BOOST' : BP[w.mode].label) + '</type></wpt>');
        });
        out.push('  <trk><name>' + xml(name) + '</name><trkseg>');
        result.points.forEach(function (p) {
            out.push('    <trkpt lat="' + p.lat.toFixed(6) + '" lon="' + p.lon.toFixed(6) + '"><ele>' + p.ele.toFixed(1) + '</ele></trkpt>');
        });
        out.push('  </trkseg></trk>', '</gpx>');
        return out.join('\n');
    };

    L.cueText = function (name, result) {
        var en = result.energy;
        var head = name + ' · ' + fmtKm(result.total) + ' km · D+ ' + Math.round(result.gain) + ' m';
        if (en) head += ' · arrivo stimato ~' + Math.round(en.arrivalPct) + '% (riserva ' + en.reservePct + '%)';
        var lines = [head];
        result.waypoints.forEach(function (w) {
            lines.push('km ' + fmtKm(w.dist).padStart(5, ' ') + '  ' + w.name + (w.battery != null ? '  (prevista ~' + Math.round(w.battery) + '%)' : ''));
        });
        return lines.join('\n');
    };

    /* ======================= ZIP (store, senza compressione) ======================= */
    var CRC_TABLE = (function () {
        var t = new Uint32Array(256);
        for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
        return t;
    })();
    function crc32(bytes) {
        var c = 0xFFFFFFFF;
        for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
        return (c ^ 0xFFFFFFFF) >>> 0;
    }
    L.zipSingle = function (filename, text) {
        var enc = new TextEncoder();
        var data = enc.encode(text), fname = enc.encode(filename), crc = crc32(data);
        var local = new DataView(new ArrayBuffer(30));
        local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true);
        local.setUint16(8, 0, true); local.setUint16(10, 0, true); local.setUint16(12, 0x21, true);
        local.setUint32(14, crc, true); local.setUint32(18, data.length, true); local.setUint32(22, data.length, true);
        local.setUint16(26, fname.length, true); local.setUint16(28, 0, true);
        var central = new DataView(new ArrayBuffer(46));
        central.setUint32(0, 0x02014b50, true); central.setUint16(4, 20, true); central.setUint16(6, 20, true);
        central.setUint16(8, 0x0800, true); central.setUint16(10, 0, true); central.setUint16(12, 0, true); central.setUint16(14, 0x21, true);
        central.setUint32(16, crc, true); central.setUint32(20, data.length, true); central.setUint32(24, data.length, true);
        central.setUint16(28, fname.length, true); central.setUint16(30, 0, true); central.setUint16(32, 0, true);
        central.setUint16(34, 0, true); central.setUint16(36, 0, true); central.setUint32(38, 0, true); central.setUint32(42, 0, true);
        var cdOffset = 30 + fname.length + data.length, cdSize = 46 + fname.length;
        var end = new DataView(new ArrayBuffer(22));
        end.setUint32(0, 0x06054b50, true); end.setUint16(8, 1, true); end.setUint16(10, 1, true);
        end.setUint32(12, cdSize, true); end.setUint32(16, cdOffset, true);
        var total = cdOffset + cdSize + 22, buf = new Uint8Array(total), o = 0;
        [new Uint8Array(local.buffer), fname, data, new Uint8Array(central.buffer), fname, new Uint8Array(end.buffer)]
            .forEach(function (part) { buf.set(part, o); o += part.length; });
        return buf;
    };

    /* ======================= PERCORSO DI ESEMPIO ======================= */
    /** Anello sintetico di ~29,5 km e ~1050 m D+, solo per mostrare lo strumento. */
    L.sampleRoute = function () {
        var prof = [[1.6, 1.5], [1.4, 5], [0.6, 0], [2.6, 9.5], [0.8, 14.5], [1.2, 8], [2.4, -7], [1.8, 1],
            [0.25, 16], [1.6, 4.5], [2.0, 11], [0.7, 16], [1.0, 3.5], [3.6, -8.5], [1.5, 0.5], [6.5, -9]];
        var lengthM = prof.reduce(function (s, p) { return s + p[0] * 1000; }, 0);
        function eleAt(d) {
            var z = 780, acc = 0;
            for (var i = 0; i < prof.length; i++) {
                var segLen = prof[i][0] * 1000;
                var part = Math.min(Math.max(d - acc, 0), segLen);
                z += (part * prof[i][1]) / 100;
                acc += segLen;
            }
            return z + 1.4 * Math.sin(d / 37) + 0.9 * Math.sin(d / 13 + 1);
        }
        var lat0 = 42.18, lon0 = 13.86, M = 4000;
        function shape(th) { return 1 + 0.22 * Math.sin(3 * th + 0.5) + 0.08 * Math.sin(7 * th); }
        var xy = [];
        for (var i = 0; i <= M; i++) {
            var th = (2 * Math.PI * i) / M, r = shape(th);
            xy.push([r * Math.cos(th), r * Math.sin(th)]);
        }
        var per = 0;
        for (i = 1; i < xy.length; i++) per += Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]);
        var R = lengthM / per;
        var pts = [], cd = 0;
        for (i = 0; i < xy.length; i++) {
            if (i > 0) cd += R * Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]);
            if (i % 2) continue;
            pts.push({
                lat: lat0 + (R * xy[i][1]) / 111320,
                lon: lon0 + (R * xy[i][0]) / (111320 * Math.cos(toRad(lat0))),
                ele: Math.round(eleAt(cd) * 10) / 10
            });
        }
        return { name: 'Anello di esempio', points: pts };
    };

    L.positionAt = positionAt; L.SURFACES = SURFACES; L.TEMPERATURES = TEMPERATURES; L.VOICE_LABELS = VOICE_LABELS; L.FACTOR_RANGE = [FACTOR_MIN, FACTOR_MAX]; L.BAND_ORDER = BAND_ORDER; L.BANDS = BANDS; L.BP = BP; L.MODE_KEYS = MODE_KEYS; L.PRESETS = PRESETS; L.RANK = RANK; L.fmtKm = fmtKm;
    if (typeof module !== 'undefined' && module.exports) module.exports = L; else root.AvinoxPlanner = L;
})(this);
