/* Contatori anonimi delle funzioni usate (Cloudflare Pages Function, POST /api/e).
 * La pagina invia solo { e: azione, d: dettaglio corto }. Qui si somma per giorno:
 * niente IP, niente user agent, niente cookie o identificativi, solo (giorno, azione, dettaglio, conteggio).
 * Binding richiesto: DB (D1) con la tabella
 *   counts(day TEXT, name TEXT, detail TEXT, n INTEGER, PRIMARY KEY (day, name, detail)). */

export const SITE = 'https://avinox-planner.pages.dev';

/* Azioni accettate, con l'etichetta usata nella pagina /stats. */
export const EVENTS = {
    open: 'Aperture',
    lang: 'Lingua all\'apertura',
    lang_switch: 'Cambi di lingua',
    gpx_load: 'GPX caricati',
    strategy: 'Scelte della strategia',
    gpx_download: 'GPX scaricati',
    gpx_copy: 'GPX copiati',
    cues_copy: 'Liste waypoint copiate',
    schema_copy: 'Schemi copiati',
    auto_copy: 'Impostazioni AUTO copiate',
    setup: 'Motore e batteria (al download)',
    osm: 'Letture del fondo da OpenStreetMap',
    ride_saved: 'Giri di taratura salvati',
    donate: 'Clic sulle donazioni',
    data_export: 'Esportazioni dati',
    data_import: 'Importazioni dati'
};

const DETAIL = /^[A-Za-z0-9_./-]{0,24}$/;

export function parseEvent(text) {
    if (typeof text !== 'string' || text.length > 200) return null;
    let data;
    try { data = JSON.parse(text); } catch (e) { return null; }
    if (!data || typeof data !== 'object') return null;
    const name = String(data.e || ''), detail = String(data.d == null ? '' : data.d);
    if (!Object.prototype.hasOwnProperty.call(EVENTS, name) || !DETAIL.test(detail)) return null;
    return { name, detail };
}

export async function countEvent(db, ev, now = new Date()) {
    const day = now.toISOString().slice(0, 10);
    await db.prepare('INSERT INTO counts (day, name, detail, n) VALUES (?1, ?2, ?3, 1) ' +
        'ON CONFLICT(day, name, detail) DO UPDATE SET n = n + 1').bind(day, ev.name, ev.detail).run();
}

export async function onRequestPost({ request, env }) {
    const origin = request.headers.get('Origin');
    if (origin && origin !== SITE) return new Response(null, { status: 403 });
    const ev = parseEvent(await request.text());
    if (!ev) return new Response(null, { status: 400 });
    if (env.DB) await countEvent(env.DB, ev);
    return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}

export function onRequestGet() {
    return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'POST' } });
}
