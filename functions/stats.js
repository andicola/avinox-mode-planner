/* Pagina delle statistiche anonime (GET /stats), solo per il proprietario.
 * Davanti c'è un'applicazione Cloudflare Access su avinox-planner.pages.dev/stats;
 * qui si verifica comunque il token di Access (firma, audience, scadenza) e senza token valido si risponde 403.
 * Variabili: ACCESS_TEAM (es. andicola.cloudflareaccess.com), ACCESS_AUD (tag dell'applicazione Access). Binding: DB (D1). */
import { EVENTS } from './api/e.js';

const RANGES = [7, 30, 90, 365];
const DETAIL_LABELS = {
    open: { web: 'Browser', app: 'App installata' },
    lang: { it: 'Italiano', en: 'Inglese' },
    lang_switch: { it: 'Verso l\'italiano', en: 'Verso l\'inglese' },
    gpx_download: { waypoint: 'Cambio modalità con gli avvisi', auto: 'Tutto in AUTO' },
    gpx_copy: { waypoint: 'Cambio modalità con gli avvisi', auto: 'Tutto in AUTO' },
    strategy: { waypoint: 'Cambio modalità con gli avvisi', auto: 'Tutto in AUTO' },
    osm: { ok: 'Riuscite', error: 'Non riuscite' },
    donate: { top: 'Pulsante in alto', '3': '3 €', '5': '5 €', '10': '10 €', custom: 'Altro importo', paypal: 'PayPal (Ko-fi)', kofi: 'Ko-fi' }
};

/* ---------- verifica del token di Cloudflare Access ---------- */
function b64urlBytes(s) {
    const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
    return Uint8Array.from(b, (c) => c.charCodeAt(0));
}
function b64urlJson(s) { return JSON.parse(new TextDecoder().decode(b64urlBytes(s))); }

export async function verifyAccess(request, env, fetchImpl = fetch) {
    const token = request.headers.get('Cf-Access-Jwt-Assertion');
    if (!token || !env.ACCESS_TEAM || !env.ACCESS_AUD) return false;
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    try {
        const header = b64urlJson(parts[0]), payload = b64urlJson(parts[1]);
        const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
        if (!aud.includes(env.ACCESS_AUD)) return false;
        if (payload.iss !== 'https://' + env.ACCESS_TEAM) return false;
        if (!payload.exp || payload.exp * 1000 < Date.now()) return false;
        const certs = await (await fetchImpl('https://' + env.ACCESS_TEAM + '/cdn-cgi/access/certs')).json();
        const jwk = (certs.keys || []).find((k) => k.kid === header.kid);
        if (!jwk) return false;
        const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
            { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
        return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlBytes(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
    } catch (e) {
        return false;
    }
}

/* ---------- dati ---------- */
export function summarize(rows, days, today = new Date()) {
    const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    const dates = [];
    for (let i = days - 1; i >= 0; i--) dates.push(new Date(end.getTime() - i * 86400000).toISOString().slice(0, 10));
    const first = dates[0];
    const byName = {}, byDetail = {}, opensByDay = Object.fromEntries(dates.map((d) => [d, 0]));
    rows.filter((r) => r.day >= first).forEach((r) => {
        byName[r.name] = (byName[r.name] || 0) + r.n;
        const d = byDetail[r.name] = byDetail[r.name] || {};
        d[r.detail] = (d[r.detail] || 0) + r.n;
        if (r.name === 'open' && r.day in opensByDay) opensByDay[r.day] += r.n;
    });
    return { dates, first, byName, byDetail, opensByDay };
}

/* ---------- pagina ---------- */
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (n) => Number(n).toLocaleString('it-IT');
const pct = (a, b) => (b ? Math.round((a / b) * 100) + '%' : '—');

function bars(entries, label) {
    if (!entries.length) return '<p class="empty">Ancora nessun dato in questo periodo.</p>';
    const max = Math.max(...entries.map((e) => e[1]));
    return '<ul class="bars">' + entries.map(([k, v]) =>
        `<li title="${esc(label(k))}: ${fmt(v)}"><span class="name">${esc(label(k))}</span><span class="track"><i style="width:${Math.max(2, (v / max) * 100)}%"></i></span><span class="val">${fmt(v)}</span></li>`).join('') + '</ul>';
}

function detailBlock(s, name, title) {
    const d = s.byDetail[name] || {};
    const map = DETAIL_LABELS[name] || {};
    const entries = Object.entries(d).sort((a, b) => b[1] - a[1]);
    return `<section class="card"><h2>${esc(title)}</h2>${bars(entries, (k) => map[k] || k || '—')}</section>`;
}

function columns(s) {
    const vals = s.dates.map((d) => s.opensByDay[d]);
    const max = Math.max(1, ...vals);
    const step = Math.ceil(s.dates.length / 6);
    const lastTick = Math.floor((s.dates.length - 1) / step) * step;
    const showLast = s.dates.length - 1 - lastTick >= step * 0.9;
    const cols = s.dates.map((d, i) => {
        const v = s.opensByDay[d], h = (v / max) * 100;
        const lab = new Date(d + 'T00:00:00Z').toLocaleDateString('it-IT', { day: 'numeric', month: 'short', timeZone: 'UTC' });
        return `<div class="col" title="${esc(lab)}: ${fmt(v)} aperture"><i style="height:${v ? Math.max(2, h) : 0}%"></i>${i % step === 0 || (showLast && i === s.dates.length - 1) ? `<span>${esc(lab)}</span>` : ''}</div>`;
    }).join('');
    const table = '<table><thead><tr><th>Giorno</th><th>Aperture</th></tr></thead><tbody>' +
        s.dates.slice().reverse().map((d) => `<tr><td>${d}</td><td>${fmt(s.opensByDay[d])}</td></tr>`).join('') + '</tbody></table>';
    return `<div class="chart"><div class="grid"><span>${fmt(max)}</span><span>${fmt(Math.round(max / 2))}</span><span>0</span></div><div class="cols" style="--n:${s.dates.length}">${cols}</div></div>
<details><summary>Vedi come tabella</summary>${table}</details>`;
}

export function renderStats(rows, days, today = new Date()) {
    const s = summarize(rows, days, today);
    const n = (k) => s.byName[k] || 0;
    const opens = n('open'), app = s.byDetail.open?.app || 0;
    const actions = Object.entries(s.byName).filter(([k]) => !['open', 'lang', 'setup'].includes(k)).sort((a, b) => b[1] - a[1]);
    const range = RANGES.map((r) => `<a href="?days=${r}"${r === days ? ' aria-current="page"' : ''}>${r} giorni</a>`).join('');
    const tile = (k, v, sub) => `<div class="tile"><span class="k">${esc(k)}</span><span class="v">${v}</span>${sub ? `<span class="s">${esc(sub)}</span>` : ''}</div>`;
    return `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Statistiche · Avinox Mode Planner</title>
<style>
:root { --bg:#ECEFED; --panel:#FAFBFA; --ink:#161A19; --muted:#59625F; --line:#CDD4D0; --bar:#3466B0; --r:6px; color-scheme: light; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg:#0F1211; --panel:#171B1A; --ink:#E6EBE8; --muted:#98A29E; --line:#2B3331; --bar:#6C9DE3; color-scheme: dark; } }
:root[data-theme="dark"] { --bg:#0F1211; --panel:#171B1A; --ink:#E6EBE8; --muted:#98A29E; --line:#2B3331; --bar:#6C9DE3; color-scheme: dark; }
* { box-sizing: border-box; } html, body { margin: 0; }
body { background: var(--bg); color: var(--ink); font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
.wrap { max-width: 1040px; margin: 0 auto; padding: 24px 16px 56px; display: grid; gap: 20px; }
h1 { margin: 0; font-size: 28px; } h2 { margin: 0 0 12px; font-size: 17px; }
.head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 12px; }
.range { display: flex; flex-wrap: wrap; gap: 6px; } .range a { color: var(--ink); text-decoration: none; border: 1px solid var(--line); border-radius: 5px; padding: 5px 10px; font-size: 14px; }
.range a[aria-current] { background: var(--ink); color: var(--bg); border-color: var(--ink); }
.note { color: var(--muted); font-size: 14px; margin: 0; } .note a { color: var(--ink); }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; }
.tile, .card { background: var(--panel); border: 1px solid var(--line); border-radius: var(--r); padding: 14px 16px; min-width: 0; }
.tile { display: grid; gap: 2px; } .tile .k { font-size: 13px; color: var(--muted); } .tile .v { font-size: 30px; font-weight: 700; font-variant-numeric: tabular-nums; } .tile .s { font-size: 13px; color: var(--muted); }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 12px; }
.bars { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.bars li { display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr) auto; gap: 10px; align-items: center; font-size: 14px; }
.bars .name { overflow-wrap: anywhere; } .bars .val { font-variant-numeric: tabular-nums; font-weight: 600; min-width: 3ch; text-align: right; }
.bars .track { height: 10px; } .bars i { display: block; height: 100%; background: var(--bar); border-radius: 0 4px 4px 0; }
.bars li:hover i { opacity: .8; }
.chart { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 8px; height: 220px; padding-bottom: 22px; }
.grid { display: flex; flex-direction: column; justify-content: space-between; font-size: 12px; color: var(--muted); text-align: right; font-variant-numeric: tabular-nums; }
.cols { display: grid; grid-template-columns: repeat(var(--n), minmax(0, 1fr)); gap: 2px; align-items: end; border-bottom: 1px solid var(--line); background: linear-gradient(var(--line), var(--line)) 0 50% / 100% 1px no-repeat; }
.col { position: relative; height: 100%; display: flex; align-items: flex-end; }
.col i { display: block; width: 100%; background: var(--bar); border-radius: 4px 4px 0 0; }
.col:hover i { opacity: .8; }
.col span { position: absolute; top: 100%; left: 50%; transform: translateX(-50%); margin-top: 4px; font-size: 11px; color: var(--muted); white-space: nowrap; }
details { margin-top: 8px; font-size: 14px; } summary { cursor: pointer; color: var(--muted); }
table { border-collapse: collapse; margin-top: 8px; font-variant-numeric: tabular-nums; } td, th { border-bottom: 1px solid var(--line); padding: 4px 16px 4px 0; text-align: left; }
.empty { color: var(--muted); font-size: 14px; margin: 0; }
</style></head><body><div class="wrap">
<div class="head"><h1>Statistiche · Avinox Mode Planner</h1><nav class="range" aria-label="Periodo">${range}</nav></div>
<p class="note">Contatori anonimi dal ${esc(s.first)} a oggi (UTC): solo quante volte è stata usata ogni funzione, senza dati personali. Visite, paesi e provenienza (per esempio Facebook) sono in <a href="https://dash.cloudflare.com/?to=/:account/web-analytics" target="_blank" rel="noopener">Cloudflare Web Analytics</a>.</p>
<div class="tiles">
${tile('Aperture', fmt(opens), app ? `${pct(app, opens)} dall'app installata` : '')}
${tile('GPX caricati', fmt(n('gpx_load')), opens ? `${pct(n('gpx_load'), opens)} delle aperture` : '')}
${tile('GPX scaricati', fmt(n('gpx_download')), n('gpx_load') ? `${pct(n('gpx_download'), n('gpx_load'))} dei GPX caricati` : '')}
${tile('Clic sulle donazioni', fmt(n('donate')))}
</div>
<section class="card"><h2>Aperture al giorno</h2>${columns(s)}</section>
<section class="card"><h2>Funzioni usate</h2>${bars(actions, (k) => EVENTS[k] || k)}</section>
<div class="cards">
${detailBlock(s, 'gpx_download', 'Come pianificano il giro (GPX scaricati)')}
${detailBlock(s, 'setup', 'Motore e batteria (al download)')}
${detailBlock(s, 'open', 'App installata o browser')}
${detailBlock(s, 'lang', 'Lingua')}
${detailBlock(s, 'donate', 'Donazioni: pulsanti cliccati')}
${detailBlock(s, 'osm', 'Fondo da OpenStreetMap')}
</div>
</div></body></html>`;
}

export async function onRequestGet({ request, env }) {
    const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store, private', 'X-Robots-Tag': 'noindex' };
    if (!(await verifyAccess(request, env))) return new Response('Accesso negato.', { status: 403, headers });
    if (!env.DB) return new Response('Database non collegato.', { status: 500, headers });
    const asked = parseInt(new URL(request.url).searchParams.get('days'), 10);
    const days = RANGES.includes(asked) ? asked : 30;
    const since = new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);
    const res = await env.DB.prepare('SELECT day, name, detail, n FROM counts WHERE day >= ?1').bind(since).all();
    return new Response(renderStats(res.results || [], days), { headers });
}
