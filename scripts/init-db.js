// Crea las tablas, carga catálogos y genera turnos de ejemplo.
// Uso:  npm run db:init      (¡borra y recrea todas las tablas!)
require('../src/env');
const fs = require('fs');
const path = require('path');
const { pool } = require('../src/db');
const T = require('../src/turnos');

const sql = (f) => fs.readFileSync(path.join(__dirname, '..', 'db', f), 'utf8');

// Producción de ejemplo por hora como % de la meta (se repite el patrón)
const PATRONES = [
  [0.95, 0.90, 1.02, 0.70, 0.98, 0.85, 1.00, 0.60, 0.97, 0.95, 0.92, 1.00],
  [0.88, 0.92, 0.80, 0.95, 0.75, 0.90, 0.85, 0.92, 0.70, 0.95, 0.90, 0.88],
  [0.65, 0.80, 0.95, 1.00, 0.98, 0.90, 1.02, 0.95, 0.92, 1.00, 0.85, 0.95],
];
const MOTIVOS = [
  ['Atoramiento de material en tolva', 'Limpieza de tolva al inicio de turno'],
  ['Ajuste de molde por rebaba', 'Revisar presión de inyección en arranque'],
  ['Operador cubriendo otra estación', 'Asignar relevo fijo en hora de comida'],
];

async function turnoEjemplo({ fecha, maquina, tipo, modelo, patron, horasACapturar, cerrar, paros, ids }) {
  const tt = (await pool.query(
    `SELECT Id_TipoTurno, to_char($1::date + HoraInicio, 'YYYY-MM-DD HH24:MI:SS') AS inicio,
            to_char($1::date + HoraInicio + MinutosProgramados * INTERVAL '1 minute', 'YYYY-MM-DD HH24:MI:SS') AS fin
     FROM TipoTurno WHERE Clave = $2`, [fecha, tipo])).rows[0];
  const id = await T.abrirTurno({
    Id_Maquina: maquina, Id_TipoTurno: tt.id_tipoturno, Fecha: fecha, Id_Tecnico: ids.tecnico,
    Id_Operador: ids.operador, Id_Modelo: modelo, AbiertoEn: tt.inicio,
  });
  // Primero los paros: los planeados descuentan la meta de su hora
  for (const [cat, desdeMin, dur, desc] of paros) {
    const p = (await pool.query(
      `SELECT to_char($1::timestamp + $2 * INTERVAL '1 minute', 'YYYY-MM-DD HH24:MI:SS') AS i,
              to_char($1::timestamp + ($2 + $3) * INTERVAL '1 minute', 'YYYY-MM-DD HH24:MI:SS') AS f`,
      [tt.inicio, desdeMin, dur])).rows[0];
    await T.registrarParo(id, { Id_CategoriaParo: cat, HoraInicio: p.i, HoraFin: p.f, Descripcion: desc, Id_Usuario: ids.tecnico });
  }
  // Minutos de paro NO planeado dentro de cada hora (en esos minutos tampoco se produce)
  const perdidos = Object.fromEntries((await pool.query(
    `SELECT r.Id_Registro AS id, COALESCE(SUM(CASE WHEN p.Id_Paro IS NULL THEN 0 ELSE EXTRACT(EPOCH FROM (
              LEAST(p.HoraFin, r.HoraInicio + r.MinutosProgramados * INTERVAL '1 minute') - GREATEST(p.HoraInicio, r.HoraInicio))) / 60 END), 0)::float AS min
     FROM Registro r
     LEFT JOIN Paro p ON p.Id_Turno = r.Id_Turno
       AND p.HoraInicio < r.HoraInicio + r.MinutosProgramados * INTERVAL '1 minute' AND p.HoraFin > r.HoraInicio
       AND p.Id_CategoriaParo IN (SELECT Id_CategoriaParo FROM CategoriaParo WHERE NOT Planeado)
     WHERE r.Id_Turno = $1 GROUP BY r.Id_Registro`, [id])).rows.map((x) => [x.id, x.min]));

  const { registros } = await T.obtenerTurno(id);
  for (const r of registros.slice(0, horasACapturar)) {
    const disponibles = (r.uphplaneado * 60) / r.uphestandar; // minutos productivos según la meta
    const factorParo = disponibles ? Math.max(0, 1 - perdidos[r.id_registro] / disponibles) : 0;
    const real = Math.round(r.uphplaneado * PATRONES[patron][(r.numerohora - 1) % 12] * factorParo);
    const m = real < r.uphplaneado && perdidos[r.id_registro] > 0
      ? ['Paro no planeado durante la hora', 'Ver detalle en la lista de paros']
      : MOTIVOS[(r.numerohora + patron) % MOTIVOS.length];
    await T.capturarHora(r.id_registro, {
      UphReal: real, BuenasPrimera: Math.max(0, real - (r.numerohora % 3 === 0 ? 6 : 1)),
      Motivo: real < r.uphplaneado ? m[0] : null, Contramedida: real < r.uphplaneado ? m[1] : null,
      Id_Usuario: ids.operador,
    });
  }
  if (cerrar) await T.cerrarTurno(id, { CerradoEn: tt.fin, Observaciones: 'Turno de ejemplo generado por el script' });
  return id;
}

(async () => {
  console.log('1/3 Creando tablas (schema.sql)...');
  await pool.query(sql('schema.sql'));
  console.log('2/3 Cargando catálogos y usuarios (seed.sql)...');
  await pool.query(sql('seed.sql'));

  console.log('3/3 Generando turnos de ejemplo...');
  const id = async (q, v) => (await pool.query(q, [v])).rows[0];
  const u = async (num) => (await id(`SELECT Id_Usuario AS x FROM Usuario WHERE NumeroEmpleado = $1`, num)).x;
  const maq = async (cod) => (await id(`SELECT Id_Maquina AS x FROM Maquina WHERE Codigo = $1`, cod)).x;
  const mod = async (np) => (await id(`SELECT Id_Modelo AS x FROM Modelo WHERE NumeroParte = $1`, np)).x;
  const cat = async (n) => (await id(`SELECT Id_CategoriaParo AS x FROM CategoriaParo WHERE Nombre = $1`, n)).x;
  const dia = async (d) => (await id(`SELECT to_char((NOW() AT TIME ZONE 'America/Mexico_City')::date - $1::int, 'YYYY-MM-DD') AS x`, d)).x;

  const A = { tecnico: await u('TE-2001'), operador: await u('OP-1001') };
  const B = { tecnico: await u('TE-2002'), operador: await u('OP-1002') };
  const [mec, ele, mat, comida, junta] = await Promise.all(
    ['Mecánico', 'Eléctrico', 'Falta de material', 'Comida', 'Junta de arranque'].map(cat));
  const [i1, i2, e1] = await Promise.all(['INY-01', 'INY-02', 'ENS-01'].map(maq));
  const [m1, m2, m3] = await Promise.all(['PT-4410', 'PT-4420', 'PT-5100'].map(mod));

  // Turnos cerrados de días anteriores (historial del supervisor)
  const cerrados = [
    { d: 3, maquina: i1, tipo: 'T1', modelo: m1, patron: 0, ids: A, paros: [[junta, 0, 10, 'Arranque de turno'], [comida, 300, 30, null], [mec, 420, 55, 'Falla en expulsor']] },
    { d: 3, maquina: i2, tipo: 'T2', modelo: m2, patron: 1, ids: B, paros: [[comida, 360, 30, null], [ele, 500, 15, 'Disparo de térmico']] },
    { d: 2, maquina: i1, tipo: 'T1', modelo: m1, patron: 2, ids: A, paros: [[junta, 0, 10, 'Arranque de turno'], [comida, 300, 30, null], [mat, 30, 50, 'Sin resina en almacén']] },
    { d: 2, maquina: e1, tipo: 'T1', modelo: m3, patron: 1, ids: B, paros: [[comida, 300, 30, null]] },
    { d: 1, maquina: i2, tipo: 'T1', modelo: m2, patron: 0, ids: B, paros: [[junta, 0, 10, 'Arranque de turno'], [comida, 300, 30, null], [mec, 200, 70, 'Cambio de boquilla']] },
    { d: 1, maquina: e1, tipo: 'T2', modelo: m3, patron: 2, ids: A, paros: [[comida, 360, 30, null], [ele, 60, 35, 'Sensor de presencia']] },
  ];
  for (const c of cerrados) {
    await turnoEjemplo({ ...c, fecha: await dia(c.d), horasACapturar: 12, cerrar: true });
  }
  // Un turno activo de hoy con 4 horas capturadas, para ver el tablero en vivo
  await turnoEjemplo({ fecha: await dia(0), maquina: i2, tipo: 'T1', modelo: m2, patron: 0, ids: B,
    horasACapturar: 4, cerrar: false, paros: [[junta, 0, 10, 'Arranque de turno']] });

  const n = await pool.query(`SELECT
    (SELECT COUNT(*) FROM Turno)::int AS turnos, (SELECT COUNT(*) FROM Registro)::int AS registros,
    (SELECT COUNT(*) FROM Paro)::int AS paros`);
  console.log('Listo:', n.rows[0]);
  await pool.end();
})().catch(async (e) => {
  console.error('Error al inicializar la base:', e.message);
  await pool.end();
  process.exit(1);
});
