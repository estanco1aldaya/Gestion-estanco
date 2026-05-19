const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '../data/gestion.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    usuario TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    rol TEXT NOT NULL CHECK(rol IN ('gerente','empleado'))
  );

  CREATE TABLE IF NOT EXISTS facturas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    numero TEXT NOT NULL,
    cliente TEXT NOT NULL,
    direccion TEXT,
    maquina TEXT,
    plataforma TEXT,
    importe_albaran REAL,
    fecha TEXT NOT NULL,
    estado TEXT DEFAULT 'pendiente' CHECK(estado IN ('pendiente','en_reparto','liquidada')),
    empleado_reparto_id INTEGER,
    hora_reparto TEXT,
    FOREIGN KEY(empleado_reparto_id) REFERENCES usuarios(id)
  );

  CREATE TABLE IF NOT EXISTS recaudaciones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    factura_id INTEGER NOT NULL,
    tel_monedas REAL,
    tel_billetes REAL,
    tel_fecha TEXT,
    rec_monedas REAL,
    rec_billetes REAL,
    discrepancia REAL,
    motivo_discrepancia TEXT,
    confirmado_por INTEGER,
    hora_confirmacion TEXT,
    FOREIGN KEY(factura_id) REFERENCES facturas(id),
    FOREIGN KEY(confirmado_por) REFERENCES usuarios(id)
  );

  CREATE TABLE IF NOT EXISTS tareas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    descripcion TEXT NOT NULL,
    prioridad TEXT DEFAULT 'normal' CHECK(prioridad IN ('normal','urgente')),
    asignada_a TEXT,
    creada_por INTEGER,
    hora_creacion TEXT,
    completada INTEGER DEFAULT 0,
    FOREIGN KEY(creada_por) REFERENCES usuarios(id)
  );

  CREATE TABLE IF NOT EXISTS stock_avisos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    producto TEXT NOT NULL,
    nivel TEXT DEFAULT 'bajo' CHECK(nivel IN ('bajo','critico')),
    nota TEXT,
    resuelto INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS solicitudes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cliente TEXT NOT NULL,
    producto TEXT NOT NULL,
    nota TEXT,
    completada INTEGER DEFAULT 0,
    hora_creacion TEXT
  );

  CREATE TABLE IF NOT EXISTS encargos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cliente TEXT NOT NULL,
    descripcion TEXT NOT NULL,
    para_cuando TEXT,
    completado INTEGER DEFAULT 0,
    hora_creacion TEXT
  );

  CREATE TABLE IF NOT EXISTS tickets_caja (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cliente TEXT NOT NULL,
    descripcion TEXT NOT NULL,
    importe REAL NOT NULL,
    anotado_por TEXT,
    hora_creacion TEXT,
    cobrado INTEGER DEFAULT 0,
    cobrado_por TEXT,
    hora_cobro TEXT
  );
`);

module.exports = db;
