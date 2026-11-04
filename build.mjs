// Inlines the station list into the page and writes the static site to public/.
import fs from 'fs';
fs.mkdirSync('public', { recursive: true });
const src = fs.readFileSync('src.html', 'utf8');
const st = fs.readFileSync('stations.json', 'utf8').trim();
fs.writeFileSync('public/index.html', src.replace('__STATIONS__', st));
console.log('built public/index.html');
