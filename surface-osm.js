/* Copiato da avinox-setup-app (MIT, © 2026 Luca Donnaloia,
 * https://github.com/lucad87/avinox-setup-app), file public/surface-osm.js, senza modifiche. */
/**
 * Surface type along a route, from OpenStreetMap.
 *
 * An optional, user-clicked feature: nothing is fetched until the caller runs
 * fetchSurfaceMix(). The route itself never leaves the device — only the
 * sampled coordinates go out, as one Overpass around() query, and the way
 * tags that come back are classified locally into the six surface voices the
 * app already knows.
 *
 * Runs in the browser and under Node (tests), like route-file.js.
 *
 *     points ─> samplePoints ─> Overpass query ─> ways
 *                                                   │
 *                      classifyTags <─ matchWay <───┘
 *                           │
 *                           └─> mix, coverage, samples
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.AvinoxOsm = factory();
    }
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
    var EARTH_R_M = 6371000;

    // Tuning constants — all in one place.
    var DEFAULT_SAMPLE_M = 500;        // one sample per this many metres of track
    var DEFAULT_RADIUS_M = 25;         // request ways within this of a sample
    var DEFAULT_MATCH_RADIUS_M = 20;   // ...but only this close counts as a match
    var DEFAULT_TIMEOUT_MS = 25000;    // per request; matches the [timeout:25] below
    var RETRY_DELAY_MS = 1000;         // jitter adds 0..1000 ms more: 1–2 s waits
    var MAX_RETRIES = 2;               // so at most 3 requests per call, one at a time
    var MAX_SAMPLES = 2000;            // guards a silly sampleM; the step widens instead
    var EPS_M = 0.01;                  // float slack when a target lands on the track end

    /**
     * The six surface voices everything downstream speaks. `mix` always has
     * exactly these keys, and is computed over the tagged samples alone, so
     * it totals 100% whenever there is anything to describe.
     */
    var VOICES = ['tarmac', 'compacted', 'hardpack', 'mixed', 'rock', 'mud'];

    /* Tag table. Deliberately conservative — unknown is better than a guess —
       and a way with only highway=* maps to no voice at all. */
    var TARMAC = ['asphalt', 'paved', 'concrete', 'paving_stones', 'concrete:plates'];
    var COMPACTED = ['compacted', 'fine_gravel'];
    var HARDPACK = ['ground', 'dirt', 'earth', 'grass', 'grass_paver'];
    var MIXED = ['gravel', 'pebblestone', 'unpaved', 'cobblestone'];
    var ROCK = ['rock', 'stone', 'bedrock'];
    var MUD = ['mud', 'sand', 'wetland'];
    // A hiking scale at or above mountain_hiking means loose rock underfoot.
    var SAC_ROCK = ['mountain_hiking', 'alpine_hiking', 'demanding_alpine_hiking', 'difficult_alpine_hiking'];

    /* ------------------------------------------------------------------ *
     * Geometry helpers
     * ------------------------------------------------------------------ */

    function toRad(deg) {
        return (deg * Math.PI) / 180;
    }

    /** Great-circle distance in metres between two {lat, lon} points. */
    function haversine(a, b) {
        var dLat = toRad(b.lat - a.lat);
        var dLon = toRad(b.lon - a.lon);
        var la1 = toRad(a.lat);
        var la2 = toRad(b.lat);
        var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        return 2 * EARTH_R_M * Math.asin(Math.min(1, Math.sqrt(h)));
    }

    /**
     * Distance from a point to a segment, in metres. The foot of the
     * perpendicular is found in a local equirectangular plane (exact enough
     * at a radius of tens of metres) and the reported figure is the haversine
     * to that foot, so the result is a true great-circle distance.
     */
    function distanceToSegmentM(point, a, b) {
        var kLon = Math.cos(toRad(point.lat)) * (Math.PI / 180) * EARTH_R_M;
        var kLat = (Math.PI / 180) * EARTH_R_M;
        var ax = (a.lon - point.lon) * kLon;
        var ay = (a.lat - point.lat) * kLat;
        var bx = (b.lon - point.lon) * kLon;
        var by = (b.lat - point.lat) * kLat;
        var dx = bx - ax;
        var dy = by - ay;
        var len2 = dx * dx + dy * dy;
        var t = len2 > 0 ? -(ax * dx + ay * dy) / len2 : 0;
        t = Math.max(0, Math.min(1, t));
        return haversine(point, {
            lat: point.lat + (ay + t * dy) / kLat,
            lon: point.lon + (ax + t * dx) / kLon
        });
    }

    function distanceToGeometryM(point, geometry) {
        if (geometry.length === 1) return haversine(point, geometry[0]);
        var best = Infinity;
        for (var i = 1; i < geometry.length; i++) {
            var d = distanceToSegmentM(point, geometry[i - 1], geometry[i]);
            if (d < best) best = d;
        }
        return best;
    }

    /**
     * Nearest way to a point: the shortest distance from the point to any
     * segment of any way's geometry. Returns { way, distanceM } for the
     * closest way within `radiusM`, or null when nothing is that close.
     */
    function matchWay(point, ways, radiusM) {
        if (!point || !Array.isArray(ways)) return null;
        var limit = positive(radiusM, DEFAULT_MATCH_RADIUS_M);
        var best = null;
        var bestD = Infinity;
        for (var i = 0; i < ways.length; i++) {
            var way = ways[i];
            if (!way || !Array.isArray(way.geometry) || way.geometry.length === 0) continue;
            var d = distanceToGeometryM(point, way.geometry);
            if (d < bestD) {
                bestD = d;
                best = way;
            }
        }
        return best !== null && bestD <= limit ? { way: best, distanceM: bestD } : null;
    }

    /* ------------------------------------------------------------------ *
     * Classification
     * ------------------------------------------------------------------ */

    function text(value) {
        return typeof value === 'string' ? value.trim().toLowerCase() : '';
    }

    function has(list, value) {
        return list.indexOf(value) !== -1;
    }

    /** Tags of one way -> one of VOICES, or null when the tags do not say. */
    function classifyTags(tags) {
        if (!tags) return null;
        var surface = text(tags.surface);
        if (surface) {
            if (has(TARMAC, surface)) return 'tarmac';
            if (has(COMPACTED, surface)) return 'compacted';
            if (surface === 'gravel' && text(tags.tracktype) === 'grade1') return 'compacted';
            if (has(HARDPACK, surface)) return 'hardpack';
            if (has(MIXED, surface)) return 'mixed';
            if (has(ROCK, surface)) return 'rock';
            if (has(MUD, surface)) return 'mud';
        }
        // Without a usable surface, only two scales are unambiguous enough.
        var mtbScale = parseFloat(tags['mtb:scale']);
        if (Number.isFinite(mtbScale) && mtbScale >= 2) return 'rock';
        if (has(SAC_ROCK, text(tags.sac_scale))) return 'rock';
        return null;
    }

    /* ------------------------------------------------------------------ *
     * Sampling
     * ------------------------------------------------------------------ */

    function positive(value, fallback) {
        return Number.isFinite(value) && value > 0 ? value : fallback;
    }

    /**
     * Along-track distance in metres for every point. The input's own
     * distanceKm is trusted when the whole track carries it (it knows about
     * segment gaps); otherwise the distances are measured with haversine.
     */
    function alongTrackM(points) {
        var given = points.length > 1 &&
            Number.isFinite(points[points.length - 1].distanceKm) &&
            points[points.length - 1].distanceKm > 0;
        if (given) {
            for (var k = 0; k < points.length; k++) {
                if (!Number.isFinite(points[k].distanceKm)) {
                    given = false;
                    break;
                }
            }
        }
        var out = new Array(points.length);
        if (given) {
            for (var i = 0; i < points.length; i++) out[i] = points[i].distanceKm * 1000;
        } else {
            out[0] = 0;
            for (var m = 1; m < points.length; m++) out[m] = out[m - 1] + haversine(points[m - 1], points[m]);
        }
        return out;
    }

    /**
     * Samples the track every `sampleM` metres, starting at 0. Coordinates
     * are interpolated along the straight leg between two fixes, so a sparse
     * file still yields samples where the route actually runs. Returns
     * [{ lat, lon, km }] with km the sample's along-track distance.
     */
    function samplePoints(points, sampleM) {
        if (!Array.isArray(points) || points.length === 0) return [];
        var step = positive(sampleM, DEFAULT_SAMPLE_M);
        var along = alongTrackM(points);
        var total = along[along.length - 1];

        var count = Math.floor((total + EPS_M) / step) + 1;
        if (count > MAX_SAMPLES) {
            // A very long track (or a tiny sampleM): widen the step instead
            // of losing the tail of the route.
            step = total / (MAX_SAMPLES - 1);
            count = MAX_SAMPLES;
        }

        var samples = [];
        var seg = 0;
        for (var i = 0; i < count; i++) {
            var d = Math.min(i * step, total);
            while (seg < points.length - 1 && along[seg + 1] < d) seg++;
            if (seg >= points.length - 1) {
                var last = points[points.length - 1];
                samples.push({ lat: last.lat, lon: last.lon, km: total / 1000 });
                continue;
            }
            var a = points[seg];
            var b = points[seg + 1];
            var span = along[seg + 1] - along[seg];
            var t = span > 0 ? (d - along[seg]) / span : 0;
            samples.push({
                lat: a.lat + t * (b.lat - a.lat),
                lon: a.lon + t * (b.lon - a.lon),
                km: d / 1000
            });
        }
        return samples;
    }

    /* ------------------------------------------------------------------ *
     * Query
     * ------------------------------------------------------------------ */

    function coord(value) {
        return Number(value).toFixed(6);
    }

    /** The Overpass query body for a list of samples, as a raw string. */
    function queryForSamples(samples, radiusM) {
        var coords = samples.map(function (s) {
            return coord(s.lat) + ',' + coord(s.lon);
        });
        return '[out:json][timeout:25];way(around:' + radiusM + ',' +
            coords.join(',') + ')[highway];out tags geom;';
    }

    /**
     * Builds the query the way fetchSurfaceMix does, without any network:
     * points are sampled every `sampleM` metres at a radius of `radiusM`.
     */
    function buildQuery(points, sampleM, radiusM) {
        return queryForSamples(
            samplePoints(points, sampleM),
            positive(radiusM, DEFAULT_RADIUS_M)
        );
    }

    /* ------------------------------------------------------------------ *
     * Transport
     * ------------------------------------------------------------------ */

    function defaultFetch(options) {
        if (options && typeof options.fetch === 'function') return options.fetch;
        if (typeof fetch === 'function') return fetch;
        if (root && typeof root.fetch === 'function') return root.fetch;
        return null;
    }

    function delay(ms) {
        return new Promise(function (resolve) { setTimeout(resolve, ms); });
    }

    /** One POST. Resolves with { data } | { httpStatus } | { reason }. */
    function requestOnce(fetchFn, query, timeoutMs) {
        return new Promise(function (resolve) {
            var controller = typeof AbortController === 'function' ? new AbortController() : null;
            var timedOut = false;
            var timer = null;
            if (controller) {
                timer = setTimeout(function () {
                    timedOut = true;
                    controller.abort();
                }, timeoutMs);
            }
            var done = function (result) {
                if (timer !== null) {
                    clearTimeout(timer);
                    timer = null;
                }
                resolve(result);
            };

            var init = {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: 'data=' + encodeURIComponent(query)
            };
            if (controller) init.signal = controller.signal;

            var pending;
            try {
                pending = fetchFn(OVERPASS_URL, init);
            } catch (err) {
                done({ reason: 'network' });
                return;
            }
            if (!pending || typeof pending.then !== 'function') {
                done({ reason: 'network' });
                return;
            }

            pending.then(function (res) {
                if (!res || res.ok !== true) {
                    if (res && Number.isFinite(res.status) && res.status > 0) {
                        done({ httpStatus: res.status });
                    } else {
                        done({ reason: 'network' });
                    }
                    return;
                }
                var body;
                try {
                    body = res.json();
                } catch (err) {
                    done({ reason: 'network' });
                    return;
                }
                Promise.resolve(body).then(
                    function (data) { done({ data: data }); },
                    function () { done({ reason: 'network' }); }
                );
            }, function () {
                done({ reason: timedOut ? 'timeout' : 'network' });
            });
        });
    }

    /**
     * Runs the query with the retry policy: an HTTP 429/504 is retried at
     * most twice, after a 1–2 s jittered wait. The attempts are sequential,
     * so there is never more than one request in flight.
     */
    function postQuery(fetchFn, query, timeoutMs, retryBaseMs) {
        var retries = 0;
        var attempt = function () {
            return requestOnce(fetchFn, query, timeoutMs).then(function (response) {
                if (response.httpStatus === 429 || response.httpStatus === 504) {
                    if (retries < MAX_RETRIES) {
                        retries++;
                        var wait = retryBaseMs + Math.random() * retryBaseMs;
                        return delay(wait).then(attempt);
                    }
                }
                if (response.httpStatus) return { ok: false, reason: 'http-' + response.httpStatus };
                if (response.reason) return { ok: false, reason: response.reason };
                return { ok: true, data: response.data };
            });
        };
        return attempt();
    }

    /* ------------------------------------------------------------------ *
     * Result
     * ------------------------------------------------------------------ */

    function round1(value) {
        return Math.round(value * 10) / 10;
    }

    function buildResult(data, samples, matchRadiusM) {
        var ways = [];
        if (data && Array.isArray(data.elements)) {
            data.elements.forEach(function (el) {
                if (el && el.type === 'way' && Array.isArray(el.geometry) && el.geometry.length > 0) {
                    ways.push(el);
                }
            });
        }
        if (ways.length === 0) return { ok: false, reason: 'empty' };

        var matched = 0;
        var tagged = 0;
        var counts = {};
        VOICES.forEach(function (v) { counts[v] = 0; });

        var outSamples = samples.map(function (sample) {
            var match = matchWay(sample, ways, matchRadiusM);
            var voice = match ? classifyTags(match.way.tags) : null;
            if (match) matched++;
            if (voice) { tagged++; counts[voice]++; }
            return { km: sample.km, voice: voice };
        });

        /* The mix is the composition of the *tagged* samples alone, so it
           totals 100%: a way that carries only highway=* adds to the matched
           count but never to the mix. */
        var mix = {};
        VOICES.forEach(function (v) {
            mix[v] = tagged > 0 ? round1((counts[v] / tagged) * 100) : 0;
        });

        var coverage = samples.length > 0 ? matched / samples.length : 0;
        return {
            ok: true,
            sampled: samples.length,
            matched: matched,
            tagged: tagged,
            mix: mix,
            coverage: coverage,
            unknownShare: 1 - coverage,
            samples: outSamples
        };
    }

    /* ------------------------------------------------------------------ *
     * Entry point
     * ------------------------------------------------------------------ */

    /**
     * Reads the surface mix along a track. `points` is [{ lat, lon,
     * distanceKm }] in order; options: sampleM (500), radiusM (25),
     * matchRadiusM (20), timeoutMs (25000), retryDelayMs (1000) and fetch
     * (a fetch implementation, for tests).
     *
     * Resolves with the result object; never rejects. On failure the shape
     * is { ok: false, reason: 'timeout'|'http-<code>'|'network'|'empty' }.
     */
    function fetchSurfaceMix(points, options) {
        options = options || {};
        var sampleM = positive(options.sampleM, DEFAULT_SAMPLE_M);
        var radiusM = positive(options.radiusM, DEFAULT_RADIUS_M);
        var matchRadiusM = positive(options.matchRadiusM, DEFAULT_MATCH_RADIUS_M);
        var timeoutMs = positive(options.timeoutMs, DEFAULT_TIMEOUT_MS);
        var retryBaseMs = Number.isFinite(options.retryDelayMs) && options.retryDelayMs >= 0
            ? options.retryDelayMs
            : RETRY_DELAY_MS;

        var samples = samplePoints(points, sampleM);
        if (samples.length === 0) return Promise.resolve({ ok: false, reason: 'empty' });

        var fetchFn = defaultFetch(options);
        if (!fetchFn) return Promise.resolve({ ok: false, reason: 'network' });

        var query = queryForSamples(samples, radiusM);
        return postQuery(fetchFn, query, timeoutMs, retryBaseMs).then(function (response) {
            if (!response.ok) return response;
            return buildResult(response.data, samples, matchRadiusM);
        });
    }

    return {
        fetchSurfaceMix: fetchSurfaceMix,
        buildQuery: buildQuery,
        samplePoints: samplePoints,
        classifyTags: classifyTags,
        matchWay: matchWay,
        haversine: haversine,
        VOICES: VOICES,
        constants: {
            OVERPASS_URL: OVERPASS_URL,
            DEFAULT_SAMPLE_M: DEFAULT_SAMPLE_M,
            DEFAULT_RADIUS_M: DEFAULT_RADIUS_M,
            DEFAULT_MATCH_RADIUS_M: DEFAULT_MATCH_RADIUS_M,
            DEFAULT_TIMEOUT_MS: DEFAULT_TIMEOUT_MS,
            RETRY_DELAY_MS: RETRY_DELAY_MS,
            MAX_RETRIES: MAX_RETRIES,
            MAX_SAMPLES: MAX_SAMPLES
        }
    };
});
