# Pro(D)Track · Prototipo web

Monitor de producción hora por hora: tablero por turno con alertas, registro de paros y cálculo de OEE.

**Stack:** PostgreSQL · Node.js + Express (API REST) · HTML + JavaScript + Bootstrap 5 + Material Symbols (frontend servido por Express).

## Estructura

```
db/schema.sql        8 tablas del ERD v2 (restricciones CHECK, UNIQUE, FK e índices)
db/seed.sql          usuarios, máquinas, modelos, tipos de turno y categorías de paro
scripts/init-db.js   crea las tablas, carga el seed y genera 7 turnos de ejemplo
src/db.js            conexión (pool) y transacciones
src/oee.js           alertas por hora y cálculo de Disponibilidad, Rendimiento, Calidad y OEE
src/turnos.js        reglas de negocio: abrir turno, capturar hora, paros, cambio de modelo, cierre
src/routes.js        endpoints /api
public/              index.html, app.js, styles.css (estilos organizados por secciones y variables)
server.js            arranque del servidor
```

## Correr en tu PC

1. Copia `.env.example` como `.env` y pega tu `DATABASE_URL` (Neon o tu PostgreSQL local).
2. `npm install`
3. `npm run db:init`  ← **borra y recrea** las tablas con datos de ejemplo
4. `npm start` y abre http://localhost:3000

## Endpoints

| Método | Ruta | Qué hace |
|---|---|---|
| GET | /api/usuarios | Usuarios activos (selector de acceso) |
| GET | /api/catalogos | Máquinas, modelos, tipos de turno, categorías de paro |
| GET | /api/turnos?estado=activo\|cerrado | Lista de turnos |
| GET | /api/turnos/:id | Turno con sus horas, paros e indicadores |
| POST | /api/turnos | Abre turno y genera sus horas (10 en T1, 12 en T2) |
| PATCH | /api/registros/:id | Captura o edita una hora (Motivo obligatorio bajo la meta) |
| POST | /api/turnos/:id/modelo | Cambia el modelo desde una hora pendiente |
| POST | /api/turnos/:id/paros | Registra un paro |
| PATCH | /api/paros/:id/terminar | Termina un paro en curso |
| POST | /api/turnos/:id/cerrar | Cierra el turno y congela los indicadores |
| GET | /api/resumen | OEE promedio por máquina y Pareto de paros |

## Reglas implementadas

- Una máquina solo puede tener un turno activo, y (Máquina, Fecha, Tipo de turno) es único.
- Meta inicial de cada hora = 90 % del UPH estándar del modelo (la última hora de T1 dura 30 min).
- Alerta por hora: verde ≥ 100 % de la meta, amarilla 85–99 %, roja < 85 %.
- Motivo obligatorio cuando la hora no cumple la meta (validado en la API y con un CHECK en la base).
- Auditoría: quién capturó y quién editó cada hora.
- Paros planeados (comida, juntas) no penalizan la Disponibilidad.
- OEE = Disponibilidad × Rendimiento × Calidad; Rendimiento usa minutos ideales (piezas × 60 / UPH estándar).

## Fuera de alcance del prototipo

Contraseñas (el acceso es por selector de usuario), administración de catálogos, exportar reportes y la app móvil.
