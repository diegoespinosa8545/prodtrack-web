// Cálculo de indicadores: alertas por hora y OEE del turno
const UMBRAL_AMARILLA = 1.0;  // debajo de la meta
const UMBRAL_ROJA = 0.85;     // debajo del 85 % de la meta

// Color de la hora según piezas reales contra la meta
function alerta(r) {
  if (r.uphreal === null || r.uphreal === undefined) return 'pendiente';
  if (r.uphplaneado === 0) return 'verde';
  const pct = r.uphreal / r.uphplaneado;
  if (pct >= UMBRAL_AMARILLA) return 'verde';
  if (pct >= UMBRAL_ROJA) return 'amarilla';
  return 'roja';
}

const minutosEntre = (a, b) => Math.max(0, (new Date(b.replace(' ', 'T')) - new Date(a.replace(' ', 'T'))) / 60000);
const recortar = (x) => Math.max(0, Math.min(1, x));
const r4 = (x) => Math.round(x * 10000) / 10000;

// registros: horas del turno · paros: con planeado (bool) · ahora: texto 'YYYY-MM-DD HH:MM:SS'
function calcularOEE(registros, paros, ahora) {
  const programados = registros.reduce((s, r) => s + r.minutosprogramados, 0);
  let planeados = 0, noPlaneados = 0;
  for (const p of paros) {
    const min = minutosEntre(p.horainicio, p.horafin || ahora);
    if (p.planeado) planeados += min; else noPlaneados += min;
  }
  // Los paros planeados (comida, juntas) no penalizan la Disponibilidad
  const tiempoPlaneado = Math.max(programados - planeados, 1);
  const tiempoOperativo = Math.max(tiempoPlaneado - noPlaneados, 0);

  const capturadas = registros.filter((r) => r.uphreal !== null);
  const piezas = capturadas.reduce((s, r) => s + r.uphreal, 0);
  const buenas = capturadas.reduce((s, r) => s + (r.buenasprimera ?? r.uphreal), 0);
  // Minutos ideales = piezas × (60 / UPH estándar del modelo de esa hora)
  const minutosIdeales = capturadas.reduce((s, r) => s + (r.uphreal * 60) / r.uphestandar, 0);

  // Solo cuenta el tiempo de las horas ya capturadas mientras el turno sigue abierto
  const minCapturados = capturadas.reduce((s, r) => s + r.minutosprogramados, 0);
  const baseRend = Math.max(minCapturados - planeados - noPlaneados, 1);

  const disponibilidad = recortar(tiempoOperativo / tiempoPlaneado);
  const rendimiento = capturadas.length ? recortar(minutosIdeales / baseRend) : 0;
  const calidad = piezas ? recortar(buenas / piezas) : 0;
  return {
    disponibilidad: r4(disponibilidad),
    rendimiento: r4(rendimiento),
    calidad: r4(calidad),
    oee: r4(disponibilidad * rendimiento * calidad),
    piezas, buenas,
    meta: registros.reduce((s, r) => s + r.uphplaneado, 0),
    minutosParoNoPlaneado: Math.round(noPlaneados),
    minutosParoPlaneado: Math.round(planeados),
  };
}

module.exports = { alerta, calcularOEE, UMBRAL_AMARILLA, UMBRAL_ROJA };
