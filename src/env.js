// Carga variables desde el archivo .env (solo en tu PC; en Render se configuran en el panel)
const fs = require('fs');
const path = require('path');

const archivo = path.join(__dirname, '..', '.env');
if (fs.existsSync(archivo)) {
  for (const linea of fs.readFileSync(archivo, 'utf8').split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
