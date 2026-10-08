'use strict';
/* Crea dist/avinox-mode-planner.html: la pagina con planner.js incorporato,
   da aprire offline o da caricare dove serve un unico file. */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'planner.js'), 'utf8');
const tag = '<script src="planner.js"></script>';
if (!html.includes(tag)) throw new Error('index.html non contiene ' + tag);

const out = html.replace(tag, () => '<script>\n' + js + '\n</script>');
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const file = path.join(root, 'dist', 'avinox-mode-planner.html');
fs.writeFileSync(file, out);
console.log('Scritto ' + path.relative(root, file) + ' (' + Math.round(out.length / 1024) + ' KB)');
