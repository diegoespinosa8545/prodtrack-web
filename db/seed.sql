-- Pro(D)Track · Catálogos y usuarios de ejemplo (ejecutar después de schema.sql)
-- Prototipo: el acceso es por selector de usuario, por eso PasswordHash lleva un valor de relleno.

INSERT INTO Usuario (NumeroEmpleado, Nombre, PasswordHash, Rol) VALUES
  ('OP-1001', 'Laura Méndez',     'sin-password-prototipo', 'operador'),
  ('OP-1002', 'Carlos Ruiz',      'sin-password-prototipo', 'operador'),
  ('TE-2001', 'Jorge Ramírez',    'sin-password-prototipo', 'tecnico'),
  ('TE-2002', 'Ana Torres',       'sin-password-prototipo', 'tecnico'),
  ('SU-3001', 'Patricia Gómez',   'sin-password-prototipo', 'supervisor');

INSERT INTO Maquina (Codigo, Nombre, Area) VALUES
  ('INY-01', 'Inyectora Engel 200T', 'Moldeo'),
  ('INY-02', 'Inyectora Arburg 150T', 'Moldeo'),
  ('ENS-01', 'Línea de ensamble 1',  'Ensamble');

INSERT INTO Modelo (NumeroParte, Nombre, UphEstandar) VALUES
  ('PT-4410', 'Carcasa frontal',     120),
  ('PT-4420', 'Tapa trasera',        150),
  ('PT-5100', 'Soporte de batería',   90);

INSERT INTO TipoTurno (Clave, HoraInicio, HoraFin, MinutosProgramados) VALUES
  ('T1', '06:00', '15:30', 570),
  ('T2', '18:00', '06:00', 720);

INSERT INTO CategoriaParo (Nombre, Planeado) VALUES
  ('Mecánico',          FALSE),
  ('Eléctrico',         FALSE),
  ('Falta de material', FALSE),
  ('Cambio de modelo',  FALSE),
  ('Comida',            TRUE),
  ('Junta de arranque', TRUE);
