// Copia l'app web (cartella principale del repository) in mobile/www, che Capacitor mette dentro l'app.
const fs = require('fs');
const path = require('path');
const src = path.join(__dirname, '..');
const out = path.join(__dirname, 'www');
const files = ['index.html', 'app.js', 'style.css', 'sw.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'logo.png', 'logo-dark.png', 'logo-geofor.png', 'logo-ecofor.png', 'logo-ecoacciai.png'];
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const f of files) fs.copyFileSync(path.join(src, f), path.join(out, f));
console.log('Copiati in www:', files.length, 'file');
