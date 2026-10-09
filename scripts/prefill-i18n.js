'use strict';
/* Scrive in index.html i testi italiani di i18n.js dentro gli elementi con data-i18n / data-i18n-html,
   così la pagina è leggibile anche prima che parta lo script (e senza JavaScript).
   Uso: node scripts/prefill-i18n.js   (i test controllano che il file sia allineato). */
const fs = require('fs');
const path = require('path');

const ELEMENT = /(<([a-z][a-z0-9]*)\b[^>]*?\sdata-i18n(-html)?="([^"]+)"[^>]*>)([\s\S]*?)(<\/\2>)/g;

function escapeText(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function prefill(html, dict) {
    return html.replace(ELEMENT, function (all, open, tag, isHtml, key, inner, close) {
        if (!(key in dict)) throw new Error('Chiave mancante in i18n.js: ' + key);
        return open + (isHtml ? dict[key] : escapeText(dict[key])) + close;
    });
}

function usedKeys(html) {
    const keys = [];
    html.replace(/\sdata-i18n(?:-html|-ph|-aria)?="([^"]+)"/g, function (m, k) { keys.push(k); return m; });
    return keys;
}

module.exports = { prefill, usedKeys };

if (require.main === module) {
    const file = path.join(__dirname, '..', 'index.html');
    const dict = require('../i18n.js').it;
    const html = fs.readFileSync(file, 'utf8');
    const out = prefill(html, dict);
    fs.writeFileSync(file, out);
    console.log(out === html ? 'index.html già allineato' : 'index.html aggiornato con i testi italiani');
}
