// API REST de Pro(D)Track
const express = require('express');
const { pool } = require('./db');
const T = require('./turnos');

const router = express.Router();
const h = (fn) => (req, res, next) => fn(req, res).catch(next);

// ---------- Catálogos ----------
router.get('/usuarios', h(async (req, res) => {
  const r = await pool.query(
    `SELECT Id_Usuario, NumeroEmpleado, Nombre, Rol FROM Usuario WHERE Activo ORDER BY Rol, Nombre`);
  res.json(r.rows);
}));

router.get('/catalogos', h(async (req, res) => {
  const [maquinas, modelos, tiposTurno, categorias] = await Promise.all([
    pool.query(`SELECT Id_Maquina, Codigo, Nombre, Area FROM Maquina WHERE Activa ORDER BY Codigo`),
    pool.query(`SELECT Id_Modelo, NumeroParte, Nombre, UphEstandar FROM Modelo WHERE Activo ORDER BY NumeroParte`),
    pool.query(`SELECT Id_TipoTurno, Clave, to_char(HoraInicio, 'HH24:MI') AS horainicio,
                       to_char(HoraFin, 'HH24:MI') AS horafin, MinutosProgramados FROM TipoTurno ORDER BY Clave`),
    pool.query(`SELECT Id_CategoriaParo, Nombre, Planeado FROM CategoriaParo WHERE Activo ORDER BY Planeado, Nombre`),
  ]);
  res.json({ maquinas: maquinas.rows, modelos: modelos.rows, tiposTurno: tiposTurno.rows, categorias: categorias.rows });
}));

// ---------- Turnos ----------
router.get('/turnos', h(async (req, res) => res.json(await T.listarTurnos(req.query.estado))));
router.get('/turnos/:id', h(async (req, res) => res.json(await T.obtenerTurno(req.params.id))));
router.post('/turnos', h(async (req, res) => {
  const id = await T.abrirTurno(req.body);
  res.status(201).json({ Id_Turno: id });
}));
router.post('/turnos/:id/modelo', h(async (req, res) => {
  const n = await T.cambiarModelo(req.params.id, req.body);
  res.json({ horasActualizadas: n });
}));
router.post('/turnos/:id/paros', h(async (req, res) => {
  const id = await T.registrarParo(req.params.id, req.body);
  res.status(201).json({ Id_Paro: id });
}));
router.post('/turnos/:id/cerrar', h(async (req, res) => res.json(await T.cerrarTurno(req.params.id, req.body))));

// ---------- Horas y paros ----------
router.patch('/registros/:id', h(async (req, res) => {
  const idTurno = await T.capturarHora(req.params.id, req.body);
  res.json({ Id_Turno: idTurno });
}));
router.patch('/paros/:id/terminar', h(async (req, res) => {
  const idTurno = await T.terminarParo(req.params.id);
  res.json({ Id_Turno: idTurno });
}));

router.get('/resumen', h(async (req, res) => res.json(await T.resumen())));

// ---------- Errores ----------
// Las restricciones de la base (CHECK, UNIQUE, FK) también se traducen a mensajes legibles
router.use((err, req, res, next) => {
  if (err instanceof T.ErrorNegocio) return res.status(err.status).json({ error: err.message });
  const porCodigo = {
    23505: 'Ya existe un registro con esos datos (por ejemplo, ese turno ya se abrió en esa fecha)',
    23503: 'Uno de los datos hace referencia a un registro que no existe',
    23514: 'Los datos no cumplen una regla de la base de datos',
    '22P02': 'Formato de dato inválido',
    '22007': 'Fecha u hora inválida',
    '22008': 'Fecha u hora fuera de rango',
  };
  if (porCodigo[err.code]) return res.status(400).json({ error: porCodigo[err.code], detalle: err.detail || err.constraint });
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

module.exports = router;
