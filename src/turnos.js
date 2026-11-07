// Lógica del tablero hora×hora: abrir turno, capturar horas, paros y cierre con OEE
const { pool, transaccion, AHORA, HOY } = require('./db');
const { alerta, calcularOEE } = require('./oee');

class ErrorNegocio extends Error {
  constructor(msg, status = 400) { super(msg); this.status = status; }
}

const ahoraSQL = `to_char(${AHORA}, 'YYYY-MM-DD HH24:MI:SS')`;
// Meta de cada hora: UphPlaneado = UphEstandar × MinutosProgramados / 60.
// El UPH estándar del modelo ya incluye el factor de 0.85 de las máquinas
// semiautomatizadas que dependen de un operador, así que aquí no se ajusta.

// ---------- Abrir turno ----------
// Crea el Turno y sus horas (10 en T1, 12 en T2) con la meta del modelo inicial.
async function abrirTurno({ Id_Maquina, Id_TipoTurno, Fecha, Id_Tecnico, Id_Operador, Id_Modelo, AbiertoEn }) {
  if (!Id_Maquina || !Id_TipoTurno || !Id_Tecnico || !Id_Modelo) {
    throw new ErrorNegocio('Faltan datos: máquina, tipo de turno, técnico y modelo son obligatorios');
  }
  return transaccion(async (c) => {
    const activo = await c.query(
      `SELECT Id_Turno FROM Turno WHERE Id_Maquina = $1 AND Estado = 'activo'`, [Id_Maquina]);
    if (activo.rowCount) throw new ErrorNegocio('Esa máquina ya tiene un turno activo; ciérralo primero');

    const t = await c.query(
      `INSERT INTO Turno (Id_Maquina, Id_TipoTurno, Fecha, Id_Tecnico, Id_Operador, AbiertoEn)
       VALUES ($1, $2, COALESCE($3::date, ${HOY}), $4, $5, COALESCE($6::timestamp, ${AHORA}))
       RETURNING Id_Turno, Fecha`,
      [Id_Maquina, Id_TipoTurno, Fecha || null, Id_Tecnico, Id_Operador || null, AbiertoEn || null]);
    const { id_turno, fecha } = t.rows[0];

    // Una fila por hora; la última de T1 dura 30 minutos (570 = 9 × 60 + 30)
    await c.query(
      `INSERT INTO Registro (Id_Turno, NumeroHora, HoraInicio, MinutosProgramados,
                             Id_Modelo, UphEstandar, UphPlaneado)
       SELECT $1, n,
              $2::date + tt.HoraInicio + (n - 1) * INTERVAL '1 hour',
              LEAST(60, tt.MinutosProgramados - (n - 1) * 60),
              m.Id_Modelo, m.UphEstandar,
              ROUND(m.UphEstandar * LEAST(60, tt.MinutosProgramados - (n - 1) * 60) / 60.0)
       FROM TipoTurno tt
       CROSS JOIN Modelo m
       CROSS JOIN generate_series(1, CEIL(tt.MinutosProgramados / 60.0)::int) AS n
       WHERE tt.Id_TipoTurno = $3 AND m.Id_Modelo = $4`,
      [id_turno, fecha, Id_TipoTurno, Id_Modelo]);
    return id_turno;
  });
}

// ---------- Consultar ----------
async function listarTurnos(estado) {
  const r = await pool.query(
    `SELECT t.Id_Turno, t.Id_Maquina, t.Fecha, t.Estado, t.OEE, t.Disponibilidad, t.Rendimiento, t.Calidad,
            m.Codigo AS maquina, m.Nombre AS maquinanombre, tt.Clave AS tipoturno,
            tec.Nombre AS tecnico, op.Nombre AS operador,
            (SELECT COUNT(*) FROM Registro r WHERE r.Id_Turno = t.Id_Turno AND r.UphReal IS NOT NULL)::int AS capturadas,
            (SELECT COUNT(*) FROM Registro r WHERE r.Id_Turno = t.Id_Turno)::int AS horas
     FROM Turno t
     JOIN Maquina m    ON m.Id_Maquina = t.Id_Maquina
     JOIN TipoTurno tt ON tt.Id_TipoTurno = t.Id_TipoTurno
     JOIN Usuario tec  ON tec.Id_Usuario = t.Id_Tecnico
     LEFT JOIN Usuario op ON op.Id_Usuario = t.Id_Operador
     WHERE ($1::text IS NULL OR t.Estado = $1)
     ORDER BY t.Fecha DESC, tt.Clave DESC, m.Codigo`, [estado || null]);
  return r.rows;
}

async function obtenerTurno(id, c = pool) {
  const t = await c.query(
    `SELECT t.*, m.Codigo AS maquina, m.Nombre AS maquinanombre, tt.Clave AS tipoturno,
            tec.Nombre AS tecnico, op.Nombre AS operador, ${ahoraSQL} AS ahora
     FROM Turno t
     JOIN Maquina m    ON m.Id_Maquina = t.Id_Maquina
     JOIN TipoTurno tt ON tt.Id_TipoTurno = t.Id_TipoTurno
     JOIN Usuario tec  ON tec.Id_Usuario = t.Id_Tecnico
     LEFT JOIN Usuario op ON op.Id_Usuario = t.Id_Operador
     WHERE t.Id_Turno = $1`, [id]);
  if (!t.rowCount) throw new ErrorNegocio('Turno no encontrado', 404);
  const turno = t.rows[0];

  const registros = (await c.query(
    `SELECT r.*, mo.NumeroParte, mo.Nombre AS modelo,
            cap.Nombre AS capturadopor, ed.Nombre AS editadopor
     FROM Registro r
     JOIN Modelo mo ON mo.Id_Modelo = r.Id_Modelo
     LEFT JOIN Usuario cap ON cap.Id_Usuario = r.Id_CapturadoPor
     LEFT JOIN Usuario ed  ON ed.Id_Usuario  = r.Id_EditadoPor
     WHERE r.Id_Turno = $1 ORDER BY r.NumeroHora`, [id])).rows;
  registros.forEach((r) => { r.alerta = alerta(r); });

  const paros = (await c.query(
    `SELECT p.*, cp.Nombre AS categoria, cp.Planeado, u.Nombre AS registradopor,
            ROUND(EXTRACT(EPOCH FROM (COALESCE(p.HoraFin, ${AHORA}) - p.HoraInicio)) / 60)::int AS minutos
     FROM Paro p
     JOIN CategoriaParo cp ON cp.Id_CategoriaParo = p.Id_CategoriaParo
     JOIN Usuario u ON u.Id_Usuario = p.Id_RegistradoPor
     WHERE p.Id_Turno = $1 ORDER BY p.HoraInicio`, [id])).rows;

  // Turno activo: indicadores en vivo · Turno cerrado: los valores congelados en la tabla
  const vivo = calcularOEE(registros, paros, turno.ahora);
  const indicadores = turno.estado === 'cerrado'
    ? { ...vivo, disponibilidad: turno.disponibilidad, rendimiento: turno.rendimiento,
        calidad: turno.calidad, oee: turno.oee }
    : vivo;
  return { turno, registros, paros, indicadores };
}

async function exigirActivo(c, idTurno) {
  const r = await c.query(`SELECT Estado FROM Turno WHERE Id_Turno = $1`, [idTurno]);
  if (!r.rowCount) throw new ErrorNegocio('Turno no encontrado', 404);
  if (r.rows[0].estado !== 'activo') throw new ErrorNegocio('El turno ya está cerrado');
}

// ---------- Meta de cada hora descontando paros planeados ----------
// UphPlaneado = UphEstandar × (MinutosProgramados − minutos de paro planeado dentro de esa hora) / 60
// Un paro planeado (comida, junta) se cuenta en la hora real en que ocurrió; si cruza dos horas,
// se reparte según los minutos que cae en cada una. Un paro en curso cuenta hasta este momento.
async function recalcularMetas(c, idTurno) {
  await c.query(
    `UPDATE Registro r SET UphPlaneado = ROUND(r.UphEstandar * GREATEST(0, r.MinutosProgramados - COALESCE((
        SELECT SUM(EXTRACT(EPOCH FROM (
                 LEAST(COALESCE(p.HoraFin, ${AHORA}), r.HoraInicio + r.MinutosProgramados * INTERVAL '1 minute')
               - GREATEST(p.HoraInicio, r.HoraInicio))) / 60)
        FROM Paro p JOIN CategoriaParo cp ON cp.Id_CategoriaParo = p.Id_CategoriaParo
        WHERE p.Id_Turno = r.Id_Turno AND cp.Planeado
          AND p.HoraInicio < r.HoraInicio + r.MinutosProgramados * INTERVAL '1 minute'
          AND COALESCE(p.HoraFin, ${AHORA}) > r.HoraInicio), 0)) / 60.0)
     WHERE r.Id_Turno = $1`, [idTurno]);
}

// ---------- Capturar una hora ----------
async function capturarHora(idRegistro, { UphReal, BuenasPrimera, Motivo, Contramedida, Id_Usuario }) {
  const real = Number(UphReal);
  if (UphReal === '' || UphReal === null || UphReal === undefined || !Number.isInteger(real) || real < 0) {
    throw new ErrorNegocio('Piezas producidas debe ser un entero mayor o igual a 0');
  }
  const buenas = BuenasPrimera === '' || BuenasPrimera === undefined || BuenasPrimera === null ? real : Number(BuenasPrimera);
  if (!Number.isInteger(buenas) || buenas < 0 || buenas > real) {
    throw new ErrorNegocio('Buenas a la primera debe estar entre 0 y las piezas producidas');
  }
  if (!Id_Usuario) throw new ErrorNegocio('Falta el usuario que captura');
  const motivo = (Motivo || '').trim() || null;

  return transaccion(async (c) => {
    const t = await c.query(`SELECT Id_Turno FROM Registro WHERE Id_Registro = $1`, [idRegistro]);
    if (!t.rowCount) throw new ErrorNegocio('Hora no encontrada', 404);
    await exigirActivo(c, t.rows[0].id_turno);
    await recalcularMetas(c, t.rows[0].id_turno);
    const r = await c.query(`SELECT Id_Turno, UphPlaneado, UphReal FROM Registro WHERE Id_Registro = $1`, [idRegistro]);
    const reg = r.rows[0];
    if (real < reg.uphplaneado && !motivo) {
      throw new ErrorNegocio(`No se cumplió la meta (${real} de ${reg.uphplaneado}); el motivo es obligatorio`);
    }
    const yaCapturada = reg.uphreal !== null;
    await c.query(
      `UPDATE Registro SET UphReal = $2, BuenasPrimera = $3, Motivo = $4, Contramedida = $5,
         Id_CapturadoPor = CASE WHEN $6 THEN Id_CapturadoPor ELSE $7 END,
         CapturadoEn     = CASE WHEN $6 THEN CapturadoEn     ELSE ${AHORA} END,
         Id_EditadoPor   = CASE WHEN $6 THEN $7    ELSE Id_EditadoPor END,
         EditadoEn       = CASE WHEN $6 THEN ${AHORA} ELSE EditadoEn END
       WHERE Id_Registro = $1`,
      [idRegistro, real, buenas, motivo, (Contramedida || '').trim() || null, yaCapturada, Id_Usuario]);
    return reg.id_turno;
  });
}

// ---------- Cambio de modelo a partir de una hora ----------
async function cambiarModelo(idTurno, { Id_Modelo, DesdeHora }) {
  if (!Id_Modelo || !DesdeHora) throw new ErrorNegocio('Indica el modelo y la hora desde la que aplica');
  return transaccion(async (c) => {
    await exigirActivo(c, idTurno);
    const r = await c.query(
      `UPDATE Registro r SET Id_Modelo = m.Id_Modelo, UphEstandar = m.UphEstandar,
              UphPlaneado = ROUND(m.UphEstandar * r.MinutosProgramados / 60.0)
       FROM Modelo m
       WHERE m.Id_Modelo = $2 AND r.Id_Turno = $1 AND r.NumeroHora >= $3 AND r.UphReal IS NULL`,
      [idTurno, Id_Modelo, DesdeHora]);
    await recalcularMetas(c, idTurno);
    return r.rowCount;
  });
}

// ---------- Paros ----------
// Horario del turno: de Fecha + HoraInicio a + MinutosProgramados (T2 cruza la medianoche)
const FMT = `'YYYY-MM-DD HH24:MI'`;
async function ventanaTurno(c, idTurno) {
  const r = await c.query(
    `SELECT to_char(t.Fecha + tt.HoraInicio, ${FMT}) AS inicio,
            to_char(t.Fecha + tt.HoraInicio + tt.MinutosProgramados * INTERVAL '1 minute', ${FMT}) AS fin,
            to_char(${AHORA}, ${FMT}) AS ahora
     FROM Turno t JOIN TipoTurno tt ON tt.Id_TipoTurno = t.Id_TipoTurno WHERE t.Id_Turno = $1`, [idTurno]);
  return r.rows[0];
}
// '2026-11-06T11:45' o '2026-11-06 11:45:00' -> '2026-11-06 11:45' (así se comparan como texto)
const normalizar = (ts) => String(ts).replace('T', ' ').slice(0, 16);
const horario = (v) => `${v.inicio.slice(11)} a ${v.fin.slice(11)}${v.fin.slice(0, 10) !== v.inicio.slice(0, 10) ? ' del día siguiente' : ''}`;

async function registrarParo(idTurno, { Id_CategoriaParo, HoraInicio, HoraFin, Descripcion, Id_Usuario }) {
  if (!Id_CategoriaParo || !Id_Usuario) throw new ErrorNegocio('Indica la categoría del paro');
  return transaccion(async (c) => {
    await exigirActivo(c, idTurno);
    const v = await ventanaTurno(c, idTurno);
    const ini = HoraInicio ? normalizar(HoraInicio) : v.ahora;
    const fin = HoraFin ? normalizar(HoraFin) : null;

    // 1. Dentro del horario del turno
    if (ini < v.inicio || ini >= v.fin) {
      throw new ErrorNegocio(`El paro debe iniciar dentro del horario del turno (${horario(v)})`);
    }
    if (fin && fin <= ini) throw new ErrorNegocio('La hora de fin debe ser posterior a la de inicio');
    if (fin && fin > v.fin) throw new ErrorNegocio(`El paro no puede terminar después del fin del turno (${v.fin.slice(11)})`);
    // 2. "En curso" solo si el turno está transcurriendo ahora
    if (!fin && (v.ahora < v.inicio || v.ahora >= v.fin || ini > v.ahora)) {
      throw new ErrorNegocio('Fuera del horario del turno no se puede dejar un paro en curso; indica la hora de fin');
    }
    // 3. Sin traslape con otros paros del mismo turno
    const choque = await c.query(
      `SELECT cp.Nombre, to_char(p.HoraInicio, 'HH24:MI') AS i, COALESCE(to_char(p.HoraFin, 'HH24:MI'), 'en curso') AS f
       FROM Paro p JOIN CategoriaParo cp ON cp.Id_CategoriaParo = p.Id_CategoriaParo
       WHERE p.Id_Turno = $1 AND p.HoraInicio < COALESCE($3::timestamp, 'infinity')
         AND COALESCE(p.HoraFin, 'infinity') > $2::timestamp
       LIMIT 1`, [idTurno, ini, fin]);
    if (choque.rowCount) {
      const x = choque.rows[0];
      throw new ErrorNegocio(`Se traslapa con otro paro: ${x.nombre} ${x.i}–${x.f}`);
    }

    const r = await c.query(
      `INSERT INTO Paro (Id_Turno, Id_CategoriaParo, HoraInicio, HoraFin, Descripcion, Id_RegistradoPor)
       VALUES ($1, $2, $3::timestamp, $4::timestamp, $5, $6) RETURNING Id_Paro`,
      [idTurno, Id_CategoriaParo, ini, fin, (Descripcion || '').trim() || null, Id_Usuario]);
    await recalcularMetas(c, idTurno);
    return r.rows[0].id_paro;
  });
}

async function terminarParo(idParo) {
  return transaccion(async (c) => {
    const p = await c.query(`SELECT Id_Turno, HoraFin FROM Paro WHERE Id_Paro = $1`, [idParo]);
    if (!p.rowCount) throw new ErrorNegocio('Paro no encontrado', 404);
    if (p.rows[0].horafin) throw new ErrorNegocio('Ese paro ya estaba terminado');
    await exigirActivo(c, p.rows[0].id_turno);
    const v = await ventanaTurno(c, p.rows[0].id_turno);
    // Se termina ahora, pero nunca después del fin del turno
    await c.query(
      `UPDATE Paro SET HoraFin = GREATEST(HoraInicio, LEAST(date_trunc('minute', ${AHORA}), $2::timestamp))
       WHERE Id_Paro = $1`, [idParo, v.fin]);
    await recalcularMetas(c, p.rows[0].id_turno);
    return p.rows[0].id_turno;
  });
}

// ---------- Cerrar turno: congela Disponibilidad, Rendimiento, Calidad y OEE ----------
async function cerrarTurno(idTurno, { Observaciones, CerradoEn } = {}) {
  return transaccion(async (c) => {
    await exigirActivo(c, idTurno);
    const pend = await c.query(
      `SELECT COUNT(*)::int AS n FROM Registro WHERE Id_Turno = $1 AND UphReal IS NULL`, [idTurno]);
    if (pend.rows[0].n > 0) throw new ErrorNegocio(`Faltan ${pend.rows[0].n} horas por capturar`);

    const cierre = CerradoEn || (await c.query(`SELECT ${ahoraSQL} AS a`)).rows[0].a;
    const v = await ventanaTurno(c, idTurno);
    // Los paros que sigan en curso se terminan al cierre, sin pasar del fin del turno
    await c.query(
      `UPDATE Paro SET HoraFin = GREATEST(HoraInicio, LEAST($2::timestamp, $3::timestamp))
       WHERE Id_Turno = $1 AND HoraFin IS NULL`,
      [idTurno, cierre, v.fin]);
    await recalcularMetas(c, idTurno);

    const { indicadores: k } = await obtenerTurno(idTurno, c);
    await c.query(
      `UPDATE Turno SET Estado = 'cerrado', CerradoEn = GREATEST(AbiertoEn, $2::timestamp),
              Disponibilidad = $3, Rendimiento = $4, Calidad = $5, OEE = $6, Observaciones = $7
       WHERE Id_Turno = $1`,
      [idTurno, cierre, k.disponibilidad, k.rendimiento, k.calidad, k.oee, (Observaciones || '').trim() || null]);
    return k;
  });
}

// ---------- Resumen para el supervisor ----------
async function resumen() {
  const porMaquina = (await pool.query(
    `SELECT m.Codigo AS maquina, m.Nombre AS nombre, COUNT(t.Id_Turno)::int AS turnos,
            ROUND(AVG(t.OEE), 4)::float AS oee, ROUND(AVG(t.Disponibilidad), 4)::float AS disponibilidad,
            ROUND(AVG(t.Rendimiento), 4)::float AS rendimiento, ROUND(AVG(t.Calidad), 4)::float AS calidad
     FROM Maquina m
     LEFT JOIN Turno t ON t.Id_Maquina = m.Id_Maquina AND t.Estado = 'cerrado'
     WHERE m.Activa
     GROUP BY m.Id_Maquina ORDER BY m.Codigo`)).rows;
  const paretoParos = (await pool.query(
    `SELECT cp.Nombre AS categoria, cp.Planeado AS planeado, COUNT(*)::int AS paros,
            ROUND(SUM(EXTRACT(EPOCH FROM (COALESCE(p.HoraFin, ${AHORA}) - p.HoraInicio)) / 60))::int AS minutos
     FROM Paro p JOIN CategoriaParo cp ON cp.Id_CategoriaParo = p.Id_CategoriaParo
     GROUP BY cp.Id_CategoriaParo ORDER BY minutos DESC`)).rows;
  return { porMaquina, paretoParos };
}

module.exports = {
  ErrorNegocio, abrirTurno, listarTurnos, obtenerTurno, capturarHora,
  cambiarModelo, registrarParo, terminarParo, cerrarTurno, resumen,
};
