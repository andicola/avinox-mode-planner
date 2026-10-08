'use strict';
/* Crea dist/avinox-mode-planner.html: la pagina con gli script locali incorporati,
   da aprire offline o da caricare dove serve un unico file. */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
let count = 0;
// replace con una funzione: così i "$" dentro il codice incorporato restano come sono
const html = source.replace(/<script src="([\w.-]+\.js)"><\/script>/g, (tag, file) => {
    count++;
    return '<script>\n' + fs.readFileSync(path.join(root, file), 'utf8') + '\n</script>';
});
if (!count) throw new Error('index.html non contiene script locali da incorporare');

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const file = path.join(root, 'dist', 'avinox-mode-planner.html');
fs.writeFileSync(file, html);
console.log('Scritto ' + path.relative(root, file) + ' (' + count + ' script, ' + Math.round(html.length / 1024) + ' KB)');
