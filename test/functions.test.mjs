// Test delle Pages Functions: contatori anonimi (/api/e) e pagina delle statistiche (/stats).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { EVENTS, parseEvent, onRequestPost, onRequestGet as eGet } from '../functions/api/e.js';
import { onRequestGet, verifyAccess, renderStats, summarize } from '../functions/stats.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://avinox-planner.pages.dev';

/* D1 finto sopra SQLite in memoria, con la stessa interfaccia usata dalle Functions. */
function fakeD1() {
    const db = new DatabaseSync(':memory:');
    db.exec(fs.readFileSync(path.join(root, 'db/schema.sql'), 'utf8'));
    return {
        db,
        prepare(sql) {
            const st = db.prepare(sql);
            let args = [];
            const o = {
                bind(...a) { args = a; return o; },
                async run() { st.run(...args); return { success: true }; },
                async all() { return { results: st.all(...args).map((r) => ({ ...r })) }; }
            };
            return o;
        }
    };
}
const post = (body, origin = SITE) => new Request(SITE + '/api/e', { method: 'POST', body, headers: origin ? { Origin: origin } : {} });

test('contatori: accetta solo azioni note e dettagli corti', () => {
    assert.deepEqual(parseEvent('{"e":"gpx_download","d":"auto"}'), { name: 'gpx_download', detail: 'auto' });
    assert.deepEqual(parseEvent('{"e":"setup","d":"M2S/RS800"}'), { name: 'setup', detail: 'M2S/RS800' });
    assert.equal(parseEvent('{"e":"boh"}'), null);
    assert.equal(parseEvent('{"e":"open","d":"<script>"}'), null);
    assert.equal(parseEvent('{"e":"open","d":"' + 'x'.repeat(30) + '"}'), null);
    assert.equal(parseEvent('non json'), null);
    assert.equal(parseEvent('{"e":"open","d":"' + 'x'.repeat(300) + '"}'), null);
});

test('contatori: somma per giorno, rifiuta altri siti e il GET', async () => {
    const DB = fakeD1();
    const env = { DB };
    assert.equal((await onRequestPost({ request: post('{"e":"open","d":"web"}'), env })).status, 204);
    assert.equal((await onRequestPost({ request: post('{"e":"open","d":"web"}', null), env })).status, 204);
    assert.equal((await onRequestPost({ request: post('{"e":"open","d":"app"}'), env })).status, 204);
    assert.equal((await onRequestPost({ request: post('{"e":"open","d":"web"}', 'https://evil.example'), env })).status, 403);
    assert.equal((await onRequestPost({ request: post('{"e":"nope"}'), env })).status, 400);
    assert.equal(eGet().status, 405);
    const rows = DB.db.prepare('SELECT name, detail, n FROM counts ORDER BY detail').all().map((r) => ({ ...r }));
    assert.deepEqual(rows, [{ name: 'open', detail: 'app', n: 1 }, { name: 'open', detail: 'web', n: 2 }]);
    // nessuna colonna con dati personali
    const cols = DB.db.prepare('PRAGMA table_info(counts)').all().map((c) => c.name);
    assert.deepEqual(cols, ['day', 'name', 'detail', 'n']);
});

test('ogni azione inviata da app.js è tra quelle accettate', () => {
    const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
    const used = [...new Set([...app.matchAll(/\btrack\('([a-z_]+)'/g)].map((m) => m[1]))];
    assert.ok(used.length >= 10);
    used.forEach((n) => assert.ok(n in EVENTS, 'azione non accettata da /api/e: ' + n));
});

/* Token di Access firmato con una chiave generata qui, servita da un fetch finto. */
async function accessFixture() {
    const { publicKey, privateKey } = await webcrypto.subtle.generateKey(
        { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
    const jwk = await webcrypto.subtle.exportKey('jwk', publicKey);
    const env = { ACCESS_TEAM: 'team.cloudflareaccess.com', ACCESS_AUD: 'aud123' };
    const b64 = (x) => Buffer.from(x).toString('base64url');
    const sign = async (payload, kid = 'k1') => {
        const h = b64(JSON.stringify({ alg: 'RS256', kid })), p = b64(JSON.stringify(payload));
        const sig = await webcrypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(h + '.' + p));
        return h + '.' + p + '.' + b64(new Uint8Array(sig));
    };
    const fetchImpl = async () => ({ json: async () => ({ keys: [{ ...jwk, kid: 'k1', alg: 'RS256' }] }) });
    const good = { aud: ['aud123'], iss: 'https://team.cloudflareaccess.com', exp: Math.floor(Date.now() / 1000) + 600, email: 'x@example.com' };
    return { env, sign, fetchImpl, good };
}
const withToken = (tok) => new Request(SITE + '/stats', { headers: tok ? { 'Cf-Access-Jwt-Assertion': tok } : {} });

test('statistiche: serve un token di Access valido', async () => {
    const { env, sign, fetchImpl, good } = await accessFixture();
    assert.equal(await verifyAccess(withToken(await sign(good)), env, fetchImpl), true);
    assert.equal(await verifyAccess(withToken(null), env, fetchImpl), false);
    assert.equal(await verifyAccess(withToken(await sign({ ...good, aud: ['altro'] })), env, fetchImpl), false);
    assert.equal(await verifyAccess(withToken(await sign({ ...good, exp: 1 })), env, fetchImpl), false);
    assert.equal(await verifyAccess(withToken(await sign({ ...good, iss: 'https://altro.cloudflareaccess.com' })), env, fetchImpl), false);
    assert.equal(await verifyAccess(withToken(await sign(good, 'sconosciuta')), env, fetchImpl), false);
    const tok = await sign(good);
    const tampered = tok.split('.'); tampered[1] = Buffer.from(JSON.stringify({ ...good, aud: ['aud123'], email: 'y@example.com' })).toString('base64url');
    assert.equal(await verifyAccess(withToken(tampered.join('.')), env, fetchImpl), false);
    // senza token la pagina risponde 403, anche se il database c'è
    const res = await onRequestGet({ request: withToken(null), env: { ...env, DB: fakeD1() } });
    assert.equal(res.status, 403);
});

test('statistiche: riepilogo e pagina', () => {
    const today = new Date(Date.UTC(2026, 9, 9));
    const rows = [
        { day: '2026-10-09', name: 'open', detail: 'web', n: 8 },
        { day: '2026-10-09', name: 'open', detail: 'app', n: 2 },
        { day: '2026-10-08', name: 'open', detail: 'web', n: 5 },
        { day: '2026-10-08', name: 'gpx_load', detail: 'gpx', n: 4 },
        { day: '2026-10-08', name: 'gpx_download', detail: 'auto', n: 1 },
        { day: '2026-10-09', name: 'gpx_download', detail: 'waypoint', n: 2 },
        { day: '2026-10-09', name: 'setup', detail: 'M2S/RS800', n: 3 },
        { day: '2026-10-09', name: 'donate', detail: '5', n: 1 },
        { day: '2026-09-01', name: 'open', detail: 'web', n: 99 }
    ];
    const s = summarize(rows, 7, today);
    assert.equal(s.dates.length, 7);
    assert.equal(s.first, '2026-10-03');
    assert.equal(s.byName.open, 15);
    assert.equal(s.opensByDay['2026-10-09'], 10);
    assert.deepEqual(s.byDetail.gpx_download, { auto: 1, waypoint: 2 });
    const html = renderStats(rows, 7, today);
    assert.match(html, /<span class="v">15<\/span>/);
    assert.match(html, /13% dall'app installata/);
    assert.match(html, /Tutto in AUTO/);
    assert.match(html, /M2S\/RS800/);
    assert.match(html, /aria-current="page">7 giorni/);
    assert.doesNotMatch(html, /99/);
});
