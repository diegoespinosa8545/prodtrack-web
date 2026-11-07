// Conexión a PostgreSQL con un pool de conexiones (node-postgres)
const { Pool, types } = require('pg');

// Fechas y horas se devuelven como texto tal cual las guarda PostgreSQL,
// para que no se muevan por la zona horaria del servidor.
types.setTypeParser(1114, (v) => v); // TIMESTAMP
types.setTypeParser(1082, (v) => v); // DATE
types.setTypeParser(1700, (v) => (v === null ? null : Number(v))); // DECIMAL -> número

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Falta la variable DATABASE_URL (ver .env.example)');
  process.exit(1);
}

// El SSL se configura aquí, así que se quitan esos parámetros de la cadena (Neon los incluye)
const cadena = new URL(url);
['sslmode', 'channel_binding'].forEach((p) => cadena.searchParams.delete(p));
const esLocal = /^(localhost|127\.0\.0\.1)$/.test(cadena.hostname);
const pool = new Pool({
  connectionString: cadena.toString(),
  ssl: esLocal ? false : { rejectUnauthorized: false },
});

// Hora local de la planta (el servidor de la base puede estar en UTC)
const ZONA = (process.env.ZONA_HORARIA || 'America/Mexico_City').replace(/[^A-Za-z_/+-]/g, '');
const AHORA = `(NOW() AT TIME ZONE '${ZONA}')`;
const HOY = `(${AHORA})::date`;

// Ejecuta varias consultas dentro de una transacción (todo o nada)
async function transaccion(fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}

module.exports = { pool, transaccion, AHORA, HOY };
