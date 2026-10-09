'use strict';
/* Prepara _site/ con i soli file pubblici dell'app.
   Lo usano GitHub Pages e Cloudflare Pages (build command: npm run build:site, output: _site). */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, '_site');
const FILES = ['index.html', 'planner.js', 'surface-osm.js', 'i18n.js', 'app.js', 'manifest.webmanifest', 'sw.js', '_headers', 'og-image.png'];

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'icons'), { recursive: true });
FILES.forEach((f) => {
    if (fs.existsSync(path.join(root, f))) fs.copyFileSync(path.join(root, f), path.join(out, f));
});
fs.readdirSync(path.join(root, 'icons'))
    .filter((f) => /\.(png|svg)$/.test(f))
    .forEach((f) => fs.copyFileSync(path.join(root, 'icons', f), path.join(out, 'icons', f)));
console.log('Sito pronto in _site/: ' + fs.readdirSync(out).join(', '));
