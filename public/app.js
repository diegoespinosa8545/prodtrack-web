// Pro(D)Track · frontend (HTML + JavaScript + Bootstrap)
// Una sola página: el sidebar y las vistas se dibujan con JavaScript
// a partir de las respuestas de la API (/api/...).

const estado = {
  usuario: null,     // usuario elegido en la pantalla de acceso
  catalogos: null,   // máquinas, modelos, tipos de turno y categorías de paro
  activos: [],       // turnos activos (lista del sidebar)
  vista: 'tablero',  // tablero | historial | detalle
  turnoSel: null,    // turno mostrado en el tablero
  detalleId: null,   // turno abierto desde el historial
  detalle: null,     // última respuesta de /turnos/:id
  temporizador: null,
};

// ---------- Utilidades ----------
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (x) => (x === null || x === undefined ? '—' : (x * 100).toFixed(1) + ' %');
const hora = (ts) => (ts ? ts.slice(11, 16) : '');
const fechaCorta = (f) => new Date(f + 'T12:00').toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' });
const icono = (nombre, extra = '') => `<span class="material-symbols-outlined ${extra}">${nombre}</span>`;

const ROL = { operador: 'Operador', tecnico: 'Técnico', supervisor: 'Supervisor' };
const TITULO = { tablero: 'Tablero', historial: 'Historial', detalle: 'Historial' };
const puede = {
  capturar: () => ['operador', 'tecnico'].includes(estado.usuario.rol),
  operarTurno: () => estado.usuario.rol === 'tecnico',
};
const colorOEE = (x) => (x === null || x === undefined ? 'secondary' : x >= 0.85 ? 'success' : x >= 0.65 ? 'warning' : 'danger');

// Un color por máquina (mismo esquema de colores por área del sistema de referencia)
const PALETA = [
  { c: '#0BAEF4', f: '#e0f4fd' }, { c: '#E6A800', f: '#fdf5e0' }, { c: '#9D69F5', f: '#f0eafd' },
  { c: '#2dcc70', f: '#d4f5e2' }, { c: '#fe2d98', f: '#ffdeef' }, { c: '#e84c3d', f: '#f9d4d1' },
];
function colorMaquina(idMaquina) {
  const i = estado.catalogos.maquinas.findIndex((m) => m.id_maquina == idMaquina);
  const p = PALETA[(i < 0 ? 0 : i) % PALETA.length];
  return `--c:${p.c};--c-fondo:${p.f}`;
}

async function api(ruta, opciones = {}) {
  const r = await fetch('/api' + ruta, {
    ...opciones,
    headers: { 'Content-Type': 'application/json' },
    body: opciones.body ? JSON.stringify(opciones.body) : undefined,
  });
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(datos.error || 'Error de comunicación con el servidor');
  return datos;
}

function aviso(texto, tipo = 'success') {
  const el = document.createElement('div');
  el.className = `toast align-items-center text-bg-${tipo} border-0`;
  el.innerHTML = `<div class="d-flex"><div class="toast-body">${esc(texto)}</div>
    <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button></div>`;
  $('#avisos').appendChild(el);
  new bootstrap.Toast(el, { delay: 3500 }).show();
  el.addEventListener('hidden.bs.toast', () => el.remove());
}

// ---------- Modal genérico: recibe el formulario y la función que lo envía ----------
const modal = new bootstrap.Modal('#modal');
let alEnviar = null;
function abrirModal(titulo, cuerpo, enviar, textoBoton = 'ACEPTAR') {
  $('#modalTitulo').textContent = titulo;
  $('#modalCuerpo').innerHTML = cuerpo + '<div class="alert alert-danger rounded-4 d-none mt-3 mb-0" id="modalError"></div>';
  $('#modalAceptarTexto').textContent = textoBoton;
  alEnviar = enviar;
  modal.show();
}
$('#modalForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const datos = Object.fromEntries(new FormData(e.target).entries());
  $('#modalAceptar').disabled = true;
  try {
    await alEnviar(datos);
    modal.hide();
  } catch (err) {
    $('#modalError').textContent = err.message;
    $('#modalError').classList.remove('d-none');
  } finally {
    $('#modalAceptar').disabled = false;
  }
});

// ==================================================
//  ACCESO (selector de usuario, sin contraseña en el prototipo)
// ==================================================
async function mostrarAcceso() {
  $('#pantallaApp').classList.add('d-none');
  const usuarios = await api('/usuarios');
  const grupos = ['operador', 'tecnico', 'supervisor'].map((rol) => `
    <optgroup label="${ROL[rol]}">
      ${usuarios.filter((u) => u.rol === rol).map((u) =>
        `<option value="${u.id_usuario}">${esc(u.nombre)} · ${esc(u.numeroempleado)}</option>`).join('')}
    </optgroup>`).join('');

  const pantalla = $('#pantallaAcceso');
  pantalla.innerHTML = `
    <div class="text-center mb-3">
      <h3 class="marca mb-0">Pro(D)Track</h3>
      <small class="text-secondary">Monitor de producción hora por hora</small>
    </div>
    <form class="card card-login" id="formAcceso">
      <div class="card-body p-4">
        <h4 class="card-title animado">Iniciar sesión</h4>
        <p class="text-secondary small animado">Selecciona tu usuario para continuar</p>
        <div class="mb-3 animado">
          <label class="form-label fw-bold small" for="selUsuario">Usuario</label>
          <select class="form-select" id="selUsuario" required>${grupos}</select>
        </div>
        <div class="d-grid animado"><button class="btn btn-primary" type="submit">Ingresar</button></div>
        <p class="text-secondary text-center small mt-3 mb-0 animado">Prototipo: el acceso no pide contraseña</p>
      </div>
    </form>`;
  pantalla.classList.remove('d-none');
  $('#formAcceso').addEventListener('submit', (e) => {
    e.preventDefault();
    const u = usuarios.find((x) => x.id_usuario == $('#selUsuario').value);
    try { localStorage.setItem('prodtrack.usuario', JSON.stringify(u)); } catch {}
    iniciarSesion(u);
  });
}

async function iniciarSesion(u) {
  estado.usuario = u;
  estado.catalogos = await api('/catalogos');
  $('#pantallaAcceso').classList.add('d-none');
  $('#pantallaApp').classList.remove('d-none');
  irA(u.rol === 'supervisor' ? 'historial' : 'tablero');
}

function cerrarSesion() {
  try { localStorage.removeItem('prodtrack.usuario'); } catch {}
  clearInterval(estado.temporizador);
  Object.assign(estado, { usuario: null, turnoSel: null, detalleId: null, detalle: null });
  bootstrap.Offcanvas.getInstance('#menuMovil')?.hide();
  mostrarAcceso();
}

// ==================================================
//  SIDEBAR (se dibuja igual en escritorio y en el menú móvil)
// ==================================================
async function cargarActivos() {
  estado.activos = await api('/turnos?estado=activo');
  dibujarSidebar();
}

function dibujarSidebar() {
  const u = estado.usuario;
  const turnoMarcado = estado.vista === 'tablero' ? estado.turnoSel : null;

  const turnos = estado.activos.map((t) => {
    const activo = t.id_turno == turnoMarcado;
    return `
      <button type="button" class="turno-opcion ${activo ? 'activo' : ''}" style="${colorMaquina(t.id_maquina)}"
              data-accion="turno" data-id="${t.id_turno}">
        ${icono(activo ? 'radio_button_checked' : 'radio_button_unchecked')}
        <span>${esc(t.maquina)} · ${esc(t.tipoturno)}</span>
        <span class="progreso">${t.capturadas}/${t.horas}</span>
      </button>`;
  }).join('') || '<div class="text-secondary small text-center py-1">Sin turnos activos</div>';

  const modulo = (vista, ico, texto) => `
    <a href="#" class="btn-modulo ${estado.vista === vista || (vista === 'historial' && estado.vista === 'detalle') ? 'activo' : ''}"
       data-accion="vista" data-vista="${vista}">${icono(ico)}<span>${texto}</span></a>`;

  const html = `
    <div class="sidebar">
      <div class="card card-pt tarjeta-usuario">
        <div class="card-body">
          <div class="pildora-dato">${esc(u.nombre)}</div>
          <div class="pildora-dato">${esc(u.numeroempleado)}</div>
          <div class="pildora-dato">${ROL[u.rol]}</div>
        </div>
      </div>

      <div class="card card-pt">
        <div class="card-header encabezado-pildora">Turnos activos</div>
        <div class="card-body py-2 px-3 d-flex flex-column gap-1">
          ${turnos}
          ${puede.operarTurno() ? `<button type="button" class="btn btn-pill btn-contorno c-verde btn-sm mt-2" data-accion="abrir">
            ${icono('add_circle')} Abrir turno</button>` : ''}
        </div>
      </div>

      <div class="card card-pt flex-grow-1">
        <div class="card-header encabezado-pildora">Módulos</div>
        <div class="card-body py-2 px-3 d-flex flex-column gap-1">
          ${modulo('tablero', 'grid_view', 'Tablero hora × hora')}
          ${modulo('historial', 'history', 'Historial y OEE')}
        </div>
      </div>

      <div class="text-center py-1">
        <button type="button" class="btn btn-pill btn-pill-lg btn-salir" data-accion="salir">
          ${icono('logout')}<span>SALIR</span>
        </button>
      </div>
    </div>`;
  $$('[data-sidebar]').forEach((el) => { el.innerHTML = html; });
  $$('[data-titulo-vista]').forEach((el) => { el.textContent = TITULO[estado.vista]; });
}

// ==================================================
//  NAVEGACIÓN
// ==================================================
function irA(vista) {
  estado.vista = vista;
  clearInterval(estado.temporizador);
  bootstrap.Offcanvas.getInstance('#menuMovil')?.hide();
  $('#contenido').scrollTop = 0;
  if (vista === 'tablero') {
    vistaTablero();
    estado.temporizador = setInterval(vistaTablero, 30000); // refresco automático
  } else {
    vistaHistorial();
  }
}

function refrescar() {
  if (estado.vista === 'tablero') return vistaTablero();
  if (estado.vista === 'detalle') return cargarActivos().then(() => dibujarDetalle(estado.detalleId, true));
  return vistaHistorial();
}

// Un solo manejador de clics para el sidebar y los botones de las vistas
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-accion]');
  if (!el) return;
  e.preventDefault();
  const d = estado.detalle;
  switch (el.dataset.accion) {
    case 'vista': irA(el.dataset.vista); break;
    case 'turno': estado.turnoSel = Number(el.dataset.id); irA('tablero'); break;
    case 'salir': cerrarSesion(); break;
    case 'abrir': bootstrap.Offcanvas.getInstance('#menuMovil')?.hide(); formAbrirTurno(); break;
    case 'capturar': formCapturar(d.registros.find((r) => r.id_registro == el.dataset.id)); break;
    case 'paro': formParo(d.turno.id_turno); break;
    case 'modelo': formModelo(d.turno.id_turno, d.registros); break;
    case 'cerrar': formCerrar(d.turno.id_turno, d.registros); break;
    case 'terminar':
      try { await api(`/paros/${el.dataset.id}/terminar`, { method: 'PATCH' }); aviso('Paro terminado'); refrescar(); }
      catch (err) { aviso(err.message, 'danger'); }
      break;
    case 'ver-turno':
      estado.vista = 'detalle'; estado.detalleId = Number(el.dataset.id);
      dibujarSidebar(); dibujarDetalle(estado.detalleId, true); $('#contenido').scrollTop = 0;
      break;
    case 'volver': irA('historial'); break;
  }
});

// ==================================================
//  TABLERO HORA × HORA
// ==================================================
async function vistaTablero() {
  await cargarActivos();
  if (!estado.activos.some((t) => t.id_turno == estado.turnoSel)) {
    estado.turnoSel = estado.activos[0]?.id_turno ?? null;
    dibujarSidebar();
  }
  if (!estado.turnoSel) {
    $('#contenido').innerHTML = `
      <div class="card card-pt shadow-sm"><div class="card-body text-center text-secondary py-5">
        ${icono('event_busy')} <div class="mt-2">No hay turnos activos.
        ${puede.operarTurno() ? 'Abre uno desde el menú lateral.' : 'Un técnico debe abrir el turno.'}</div>
      </div></div>`;
    return;
  }
  await dibujarDetalle(estado.turnoSel);
}

async function dibujarDetalle(id, desdeHistorial = false) {
  let d;
  try { d = await api('/turnos/' + id); } catch (e) {
    $('#contenido').innerHTML = `<div class="alert alert-warning rounded-4">${esc(e.message)}</div>`; return;
  }
  estado.detalle = d;
  const { turno: t, registros, paros, indicadores: k } = d;
  const activo = t.estado === 'activo';
  const sinDatos = !registros.some((r) => r.uphreal !== null);
  const ind = (x) => (sinDatos ? '—' : pct(x));

  const kpi = (etiqueta, valor, clase = '') => `
    <div class="col-6 col-lg"><div class="card kpi h-100"><div class="card-body py-2 px-3">
      <div class="etiqueta">${etiqueta}</div><div class="valor ${clase}">${valor}</div></div></div></div>`;

  const filas = registros.map((r) => {
    const cumpl = r.uphreal === null ? '—' : r.uphplaneado ? Math.round((r.uphreal / r.uphplaneado) * 100) + ' %' : '—';
    const btn = activo && puede.capturar()
      ? (r.uphreal === null
        ? `<button class="btn btn-pill btn-contorno c-azul btn-sm" data-accion="capturar" data-id="${r.id_registro}">Capturar</button>`
        : `<button class="btn-icono" title="Editar" data-accion="capturar" data-id="${r.id_registro}">${icono('edit')}</button>`)
      : '';
    const audit = r.editadopor ? `Editado por ${esc(r.editadopor)}` : r.capturadopor ? `Capturado por ${esc(r.capturadopor)}` : '';
    return `<tr class="fila-${r.alerta}">
      <th scope="row" class="text-center">${r.numerohora}</th>
      <td>${hora(r.horainicio)} <span class="text-secondary small">${r.minutosprogramados}′</span></td>
      <td title="${esc(r.modelo)}">${esc(r.numeroparte)}</td>
      <td class="text-end">${r.uphplaneado}</td>
      <td class="text-end fw-bold">${r.uphreal ?? ''}</td>
      <td class="text-end">${r.buenasprimera ?? ''}</td>
      <td class="text-end">${cumpl}</td>
      <td class="text-center"><span class="semaforo ${r.alerta}" title="${r.alerta}"></span></td>
      <td class="motivo">${esc(r.motivo || '')}${r.contramedida ? `<div class="text-secondary">↳ ${esc(r.contramedida)}</div>` : ''}
        ${audit ? `<div class="text-secondary small fst-italic">${audit}</div>` : ''}</td>
      <td class="text-end">${btn}</td>
    </tr>`;
  }).join('');

  const listaParos = paros.map((p) => `
    <tr>
      <td>
        <span class="badge rounded-pill ${p.planeado ? 'text-bg-info' : 'text-bg-danger'}">${esc(p.categoria)}</span>
        <div class="small mt-1">${hora(p.horainicio)}–${p.horafin ? hora(p.horafin) : '<span class="text-danger fw-bold">en curso</span>'} · ${p.minutos} min</div>
        ${p.descripcion ? `<div class="small text-secondary">${esc(p.descripcion)}</div>` : ''}
      </td>
      <td class="text-end">${!p.horafin && activo && puede.operarTurno()
        ? `<button class="btn btn-pill btn-contorno c-rojo btn-sm" data-accion="terminar" data-id="${p.id_paro}">Terminar</button>` : ''}</td>
    </tr>`).join('') || '<tr><td colspan="2" class="text-center text-secondary small">Sin paros registrados</td></tr>';

  $('#contenido').innerHTML = `
    ${desdeHistorial ? `<button class="btn btn-link px-0 mb-2 text-decoration-none" data-accion="volver">${icono('arrow_back')} Volver al historial</button>` : ''}

    <div class="card card-pt shadow-sm mb-3">
      <div class="card-body d-flex flex-wrap gap-3 justify-content-between align-items-center">
        <div>
          <div class="d-flex align-items-center gap-2 flex-wrap">
            <span class="etiqueta-maquina" style="${colorMaquina(t.id_maquina)}">${icono('precision_manufacturing')} ${esc(t.maquina)}</span>
            <h2 class="h5 mb-0">${esc(t.maquinanombre)}</h2>
            <span class="badge rounded-pill ${activo ? 'text-bg-success' : 'text-bg-secondary'}">${activo ? 'Activo' : 'Cerrado'}</span>
          </div>
          <div class="small text-secondary mt-1">Turno ${esc(t.tipoturno)} · ${fechaCorta(t.fecha)} · Técnico: ${esc(t.tecnico)}${t.operador ? ' · Operador: ' + esc(t.operador) : ''}</div>
        </div>
        ${activo && puede.operarTurno() ? `<div class="d-flex flex-wrap gap-2">
          <button class="btn btn-pill btn-contorno c-naranja" data-accion="paro">${icono('pause_circle')} Registrar paro</button>
          <button class="btn btn-pill btn-contorno c-morado" data-accion="modelo">${icono('swap_horiz')} Cambiar modelo</button>
          <button class="btn btn-pill btn-contorno c-rojo" data-accion="cerrar">${icono('lock')} Cerrar turno</button>
        </div>` : ''}
      </div>
    </div>

    <div class="row g-2 mb-3">
      ${kpi('OEE' + (activo ? ' en vivo' : ''), ind(k.oee), 'text-' + (sinDatos ? 'secondary' : colorOEE(k.oee)))}
      ${kpi('Disponibilidad', ind(k.disponibilidad))}
      ${kpi('Rendimiento', ind(k.rendimiento))}
      ${kpi('Calidad', ind(k.calidad))}
      ${kpi('Piezas / meta', `${k.piezas} <span class="fs-6 text-secondary fw-normal">/ ${k.meta}</span>`)}
    </div>

    <div class="row g-3">
      <div class="col-12">
        <div class="card card-pt shadow-sm">
          <div class="card-header encabezado-pildora">Hora por hora</div>
          <div class="card-body pt-1 px-3 px-md-4">
            <div class="table-responsive">
              <table class="table tabla-pt tabla-tablero">
                <thead><tr>
                  <th class="text-center">#</th><th>Hora</th><th>Modelo</th><th class="text-end">Meta</th>
                  <th class="text-end">Real</th><th class="text-end">Buenas</th><th class="text-end">Cumpl.</th>
                  <th class="text-center">Alerta</th><th>Motivo / contramedida</th><th></th>
                </tr></thead>
                <tbody>${filas}</tbody>
              </table>
            </div>
            <div class="small text-secondary mt-2 d-flex flex-wrap gap-3">
              <span><span class="semaforo verde"></span> ≥ 100 % de la meta</span>
              <span><span class="semaforo amarilla"></span> 85–99 %</span>
              <span><span class="semaforo roja"></span> &lt; 85 %</span>
              <span><span class="semaforo"></span> pendiente</span>
            </div>
          </div>
        </div>
      </div>
      <div class="col-lg-6">
        <div class="card card-pt shadow-sm h-100">
          <div class="card-header encabezado-pildora">Paros · ${k.minutosParoNoPlaneado + k.minutosParoPlaneado} min</div>
          <div class="card-body pt-1 px-3">
            <table class="table tabla-pt"><tbody>${listaParos}</tbody></table>
          </div>
        </div>
      </div>
      ${t.observaciones ? `<div class="col-lg-6"><div class="card card-pt shadow-sm h-100">
        <div class="card-header encabezado-pildora">Observaciones</div>
        <div class="card-body">${esc(t.observaciones)}</div></div></div>` : ''}
    </div>`;
}

// ==================================================
//  FORMULARIOS
// ==================================================
const opciones = (lista, valor, texto, sel) =>
  lista.map((x) => `<option value="${x[valor]}" ${x[valor] == sel ? 'selected' : ''}>${esc(texto(x))}</option>`).join('');

async function formAbrirTurno() {
  const c = estado.catalogos;
  const usuarios = await api('/usuarios');
  const hoy = new Date().toLocaleDateString('en-CA');
  abrirModal('Abrir turno', `
    <div class="mb-2"><label class="form-label">Máquina</label>
      <select name="Id_Maquina" class="form-select">${opciones(c.maquinas, 'id_maquina', (m) => `${m.codigo} · ${m.nombre}`)}</select></div>
    <div class="row g-2 mb-2">
      <div class="col-sm"><label class="form-label">Turno</label>
        <select name="Id_TipoTurno" class="form-select">${opciones(c.tiposTurno, 'id_tipoturno', (t) => `${t.clave} (${t.horainicio}–${t.horafin})`)}</select></div>
      <div class="col-sm"><label class="form-label">Fecha</label><input type="date" name="Fecha" class="form-control" value="${hoy}"></div>
    </div>
    <div class="mb-2"><label class="form-label">Modelo inicial</label>
      <select name="Id_Modelo" class="form-select">${opciones(c.modelos, 'id_modelo', (m) => `${m.numeroparte} · ${m.nombre} (UPH ${m.uphestandar})`)}</select></div>
    <div class="mb-2"><label class="form-label">Operador</label>
      <select name="Id_Operador" class="form-select"><option value="">— Sin asignar —</option>
        ${opciones(usuarios.filter((u) => u.rol === 'operador'), 'id_usuario', (u) => u.nombre)}</select></div>
    <div class="form-text">Se crean las horas del turno con la meta del modelo (90 % del UPH estándar).</div>`,
  async (f) => {
    const r = await api('/turnos', { method: 'POST', body: { ...f, Id_Tecnico: estado.usuario.id_usuario } });
    estado.turnoSel = r.Id_Turno; aviso('Turno abierto'); irA('tablero');
  }, 'ABRIR');
}

function formCapturar(r) {
  abrirModal(`Hora ${r.numerohora} · ${hora(r.horainicio)}`, `
    <p class="small text-secondary mb-3">Modelo ${esc(r.numeroparte)} · Meta de la hora: <strong>${r.uphplaneado}</strong> piezas</p>
    <div class="row g-2 mb-2">
      <div class="col"><label class="form-label">Piezas producidas</label>
        <input type="number" min="0" name="UphReal" class="form-control" value="${r.uphreal ?? ''}" required></div>
      <div class="col"><label class="form-label">Buenas a la primera</label>
        <input type="number" min="0" name="BuenasPrimera" class="form-control" value="${r.buenasprimera ?? ''}" placeholder="= producidas"></div>
    </div>
    <div class="mb-2"><label class="form-label">Motivo <span class="text-secondary fw-normal small">(obligatorio si no se cumplió la meta)</span></label>
      <input name="Motivo" maxlength="300" class="form-control" value="${esc(r.motivo || '')}"></div>
    <div class="mb-2"><label class="form-label">Contramedida</label>
      <input name="Contramedida" maxlength="300" class="form-control" value="${esc(r.contramedida || '')}"></div>`,
  async (f) => {
    await api('/registros/' + r.id_registro, { method: 'PATCH', body: { ...f, Id_Usuario: estado.usuario.id_usuario } });
    aviso(`Hora ${r.numerohora} guardada`); refrescar();
  }, 'GUARDAR');
  setTimeout(() => $('[name=UphReal]')?.focus(), 400);
}

function formParo(idTurno) {
  const ahora = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  abrirModal('Registrar paro', `
    <div class="mb-2"><label class="form-label">Categoría</label>
      <select name="Id_CategoriaParo" class="form-select">${opciones(estado.catalogos.categorias, 'id_categoriaparo',
        (c) => c.nombre + (c.planeado ? ' (planeado)' : ''))}</select></div>
    <div class="row g-2 mb-2">
      <div class="col-sm"><label class="form-label">Inicio</label><input type="datetime-local" name="HoraInicio" class="form-control" value="${ahora}"></div>
      <div class="col-sm"><label class="form-label">Fin <span class="text-secondary fw-normal small">(vacío = en curso)</span></label>
        <input type="datetime-local" name="HoraFin" class="form-control"></div>
    </div>
    <div class="mb-2"><label class="form-label">Descripción</label><input name="Descripcion" maxlength="300" class="form-control"></div>`,
  async (f) => {
    await api(`/turnos/${idTurno}/paros`, { method: 'POST', body: { ...f, Id_Usuario: estado.usuario.id_usuario } });
    aviso('Paro registrado'); refrescar();
  }, 'REGISTRAR');
}

function formModelo(idTurno, registros) {
  const pendientes = registros.filter((r) => r.uphreal === null);
  if (!pendientes.length) return aviso('No quedan horas pendientes', 'warning');
  abrirModal('Cambiar modelo', `
    <div class="mb-2"><label class="form-label">Nuevo modelo</label>
      <select name="Id_Modelo" class="form-select">${opciones(estado.catalogos.modelos, 'id_modelo', (m) => `${m.numeroparte} · ${m.nombre} (UPH ${m.uphestandar})`)}</select></div>
    <div class="mb-2"><label class="form-label">A partir de la hora</label>
      <select name="DesdeHora" class="form-select">${pendientes.map((r) => `<option value="${r.numerohora}">${r.numerohora} (${hora(r.horainicio)})</option>`).join('')}</select></div>
    <div class="form-text">Solo cambian las horas que aún no se capturan; la meta se recalcula con el nuevo modelo.</div>`,
  async (f) => {
    const r = await api(`/turnos/${idTurno}/modelo`, { method: 'POST', body: f });
    aviso(`Modelo actualizado en ${r.horasActualizadas} horas`); refrescar();
  });
}

function formCerrar(idTurno, registros) {
  const faltan = registros.filter((r) => r.uphreal === null).length;
  abrirModal('Cerrar turno', `
    ${faltan ? `<div class="alert alert-warning rounded-4 py-2">Faltan ${faltan} horas por capturar; el cierre se rechazará.</div>` : ''}
    <p>Al cerrar se calculan y <strong>congelan</strong> Disponibilidad, Rendimiento, Calidad y OEE. Los paros en curso se terminan en este momento.</p>
    <div class="mb-2"><label class="form-label">Observaciones</label><textarea name="Observaciones" maxlength="300" rows="2" class="form-control"></textarea></div>`,
  async (f) => {
    const k = await api(`/turnos/${idTurno}/cerrar`, { method: 'POST', body: f });
    aviso(`Turno cerrado · OEE ${pct(k.oee)}`); estado.turnoSel = null; refrescar();
  }, 'CERRAR');
}

// ==================================================
//  HISTORIAL Y RESUMEN
// ==================================================
async function vistaHistorial() {
  const [turnos, res] = await Promise.all([api('/turnos'), api('/resumen'), cargarActivos()]);
  const maxMin = Math.max(1, ...res.paretoParos.map((p) => p.minutos));
  const idMaquina = (codigo) => estado.catalogos.maquinas.find((m) => m.codigo === codigo)?.id_maquina;

  const porMaquina = res.porMaquina.map((m) => `
    <tr>
      <th scope="row"><span class="etiqueta-maquina" style="${colorMaquina(idMaquina(m.maquina))}">${esc(m.maquina)}</span>
        <div class="small text-secondary fw-normal mt-1">${esc(m.nombre)}</div></th>
      <td class="text-center">${m.turnos}</td>
      <td><span class="badge rounded-pill text-bg-${colorOEE(m.oee)} fs-6">${pct(m.oee)}</span></td>
      <td>${pct(m.disponibilidad)}</td><td>${pct(m.rendimiento)}</td><td>${pct(m.calidad)}</td>
    </tr>`).join('');

  const pareto = res.paretoParos.map((p) => `
    <div class="mb-2">
      <div class="d-flex justify-content-between small">
        <span>${esc(p.categoria)} ${p.planeado ? '<span class="text-secondary">(planeado)</span>' : ''}</span>
        <span class="text-secondary">${p.minutos} min · ${p.paros} ${p.paros === 1 ? 'paro' : 'paros'}</span>
      </div>
      <div class="progress barra-pareto"><div class="progress-bar rounded-pill ${p.planeado ? 'bg-info' : 'bg-danger'}" style="width:${(p.minutos / maxMin) * 100}%"></div></div>
    </div>`).join('') || '<div class="text-secondary small">Sin paros.</div>';

  const filas = turnos.map((t) => `
    <tr class="clicable" data-accion="ver-turno" data-id="${t.id_turno}" title="Ver tablero del turno">
      <th scope="row">${fechaCorta(t.fecha)}</th>
      <td>${esc(t.tipoturno)}</td>
      <td><span class="etiqueta-maquina" style="${colorMaquina(t.id_maquina)}">${esc(t.maquina)}</span></td>
      <td>${esc(t.tecnico)}</td>
      <td>${t.estado === 'activo'
        ? `<span class="badge rounded-pill text-bg-success">Activo · ${t.capturadas}/${t.horas}</span>`
        : '<span class="badge rounded-pill text-bg-secondary">Cerrado</span>'}</td>
      <td>${pct(t.disponibilidad)}</td><td>${pct(t.rendimiento)}</td><td>${pct(t.calidad)}</td>
      <td>${t.oee !== null ? `<span class="badge rounded-pill text-bg-${colorOEE(t.oee)}">${pct(t.oee)}</span>` : '—'}</td>
    </tr>`).join('');

  $('#contenido').innerHTML = `
    <div class="row g-3 mb-3">
      <div class="col-xl-7"><div class="card card-pt shadow-sm h-100">
        <div class="card-header encabezado-pildora">OEE promedio por máquina</div>
        <div class="card-body pt-1 px-3 px-md-4"><div class="table-responsive">
          <table class="table tabla-pt">
            <thead><tr><th>Máquina</th><th class="text-center">Turnos</th><th>OEE</th><th>Disp.</th><th>Rend.</th><th>Calidad</th></tr></thead>
            <tbody>${porMaquina}</tbody>
          </table>
        </div></div>
      </div></div>
      <div class="col-xl-5"><div class="card card-pt shadow-sm h-100">
        <div class="card-header encabezado-pildora">Pareto de paros (minutos)</div>
        <div class="card-body px-4">${pareto}</div>
      </div></div>
    </div>

    <div class="card card-pt shadow-sm">
      <div class="card-header encabezado-pildora">Historial de turnos</div>
      <div class="card-body pt-1 px-3 px-md-4">
        <p class="small text-secondary text-center mb-1">Clic en un turno para ver su tablero</p>
        <div class="table-responsive">
          <table class="table tabla-pt">
            <thead><tr><th>Fecha</th><th>Turno</th><th>Máquina</th><th>Técnico</th><th>Estado</th>
              <th>Disp.</th><th>Rend.</th><th>Calidad</th><th>OEE</th></tr></thead>
            <tbody>${filas}</tbody>
          </table>
        </div>
      </div>
    </div>`;
}

// ---------- Arranque ----------
(async () => {
  let guardado = null;
  try { guardado = JSON.parse(localStorage.getItem('prodtrack.usuario')); } catch {}
  try {
    if (guardado) await iniciarSesion(guardado); else await mostrarAcceso();
  } catch (e) {
    $('#pantallaAcceso').classList.remove('d-none');
    $('#pantallaAcceso').innerHTML = `<div class="alert alert-danger rounded-4">No se pudo conectar con el servidor: ${esc(e.message)}</div>`;
  }
})();
