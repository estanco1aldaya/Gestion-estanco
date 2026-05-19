const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');
const fs = require('fs');

// Asegurarse de que la carpeta data existe
const dataDir = path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(path.join(dataDir, 'estanco.db'));

// Activar WAL para mejor rendimiento
db.pragma('journal_mode = WAL');

// Crear tablas
db.exec(`
  CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    usuario TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    rol TEXT NOT NULL CHECK(rol IN ('gerente', 'empleado')),
    activo INTEGER DEFAULT 1,
    creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS facturas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    numero TEXT UNIQUE NOT NULL,
    cliente TEXT NOT NULL,
    importe REAL NOT NULL,
    ref_maquina TEXT,
    plataforma TEXT CHECK(plataforma IN ('gmbos', 'mivending', 'otro')),
    fecha DATE NOT NULL,
    estado TEXT DEFAULT 'pendiente' CHECK(estado IN ('pendiente', 'en_reparto', 'liquidada')),
    empleado_reparto_id INTEGER REFERENCES usuarios(id),
    hora_salida DATETIME,
    creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS liquidaciones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    factura_id INTEGER UNIQUE REFERENCES facturas(id),
    importe_esperado_hucha REAL,
    importe_esperado_billetes REAL,
    importe_real_monedas REAL,
    importe_real_billetes REAL,
    diferencia REAL,
    confirmada INTEGER DEFAULT 0,
    discrepancia_motivo TEXT,
    gerente_id INTEGER REFERENCES usuarios(id),
    creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS tareas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    titulo TEXT NOT NULL,
    descripcion TEXT,
    prioridad TEXT DEFAULT 'normal' CHECK(prioridad IN ('urgente', 'normal')),
    turno TEXT DEFAULT 'todos' CHECK(turno IN ('mañana', 'tarde', 'todos')),
    completada INTEGER DEFAULT 0,
    creado_por INTEGER REFERENCES usuarios(id),
    creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
    completada_en DATETIME
  );

  CREATE TABLE IF NOT EXISTS stock_alertas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    producto TEXT NOT NULL,
    nivel TEXT DEFAULT 'bajo' CHECK(nivel IN ('critico', 'bajo')),
    resuelto INTEGER DEFAULT 0,
    creado_por INTEGER REFERENCES usuarios(id),
    creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS solicitudes_clientes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cliente TEXT NOT NULL,
    producto TEXT NOT NULL,
    completada INTEGER DEFAULT 0,
    creado_por INTEGER REFERENCES usuarios(id),
    creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS encargos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    descripcion TEXT NOT NULL,
    completado INTEGER DEFAULT 0,
    creado_por INTEGER REFERENCES usuarios(id),
    creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS tickets_caja (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cliente TEXT NOT NULL,
    concepto TEXT NOT NULL,
    importe REAL NOT NULL,
    cobrado INTEGER DEFAULT 0,
    cobrado_por INTEGER REFERENCES usuarios(id),
    cobrado_en DATETIME,
    creado_por INTEGER REFERENCES usuarios(id),
    creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS incidencias_maquinas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cliente TEXT NOT NULL,
    ref_maquina TEXT,
    descripcion TEXT NOT NULL,
    resuelta INTEGER DEFAULT 0,
    creado_por INTEGER REFERENCES usuarios(id),
    creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Crear usuarios iniciales si no existen
const checkUsers = db.prepare('SELECT COUNT(*) as count FROM usuarios').get();
if (checkUsers.count === 0) {
  const hashGerente = bcrypt.hashSync('gerente123', 10);
  const hashEmpleado = bcrypt.hashSync('empleado123', 10);

  db.prepare(`INSERT INTO usuarios (nombre, usuario, password_hash, rol) VALUES (?, ?, ?, ?)`).run('Administrador', 'gerente', hashGerente, 'gerente');
  db.prepare(`INSERT INTO usuarios (nombre, usuario, password_hash, rol) VALUES (?, ?, ?, ?)`).run('Empleado 1', 'empleado', hashEmpleado, 'empleado');

  console.log('✅ Usuarios iniciales creados:');
  console.log('   Gerente → usuario: gerente / contraseña: gerente123');
  console.log('   Empleado → usuario: empleado / contraseña: empleado123');
}

module.exports = db;
