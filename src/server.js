require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

// Crear carpeta de datos si no existe
const dataDir = path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

const db = require('./db');
const { getRecaudacion } = require('./scraping');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'gestion-estanco-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 }
}));

// Crear usuarios por defecto si no existen
const initUsuarios = () => {
  const existe = db.prepare('SELECT id FROM usuarios WHERE usuario = ?').get('gerente1');
  if (!existe) {
    const hash = bcrypt.hashSync('admin1234', 10);
    db.prepare('INSERT INTO usuarios (nombre, usuario, password, rol) VALUES (?, ?, ?, ?)').run('Gerente Principal', 'gerente1', hash, 'gerente');
    const hash2 = bcrypt.hashSync('empleado1234', 10);
    db.prepare('INSERT INTO usuarios (nombre, usuario, password, rol) VALUES (?, ?, ?, ?)').run('Empleado Repartidor', 'carlos', hash2, 'empleado');
    console.log('Usuarios creados: gerente1/admin1234 y carlos/empleado1234');
  }
};
initUsuarios();

// Middleware auth
const requireAuth = (req, res, next) => {
  if (!req.session.usuario) return res.status(401).json({ error: 'No autenticado' });
  next();
};
const requireGerente = (req, res, next) => {
  if (!req.session.usuario || req.session.usuario.rol !== 'gerente') return res.status(403).json({ error: 'Sin permisos' });
  next();
};

// ─── AUTH ───────────────────────────────────────────
app.post('/api/login', (req, res) => {
  const { usuario, password } = req.body;
  const user = db.prepare('SELECT * FROM usuarios WHERE usuario = ?').get(usuario);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  }
  req.session.usuario = { id: user.id, nombre: user.nombre, usuario: user.usuario, rol: user.rol };
  res.json({ ok: true, usuario: req.session.usuario });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  if (!req.session.usuario) return res.json({ autenticado: false });
  res.json({ autenticado: true, usuario: req.session.usuario });
});

// ─── FACTURAS ───────────────────────────────────────
app.get('/api/facturas', requireAuth, (req, res) => {
  const fecha = req.query.fecha || new Date().toISOString().split('T')[0];
  const facturas = db.prepare('SELECT * FROM facturas WHERE fecha = ? ORDER BY id DESC').all(fecha);
  res.json(facturas);
});

app.post('/api/facturas', requireGerente, (req, res) => {
  const { numero, cliente, direccion, maquina, plataforma, importe_albaran, fecha } = req.body;
  const result = db.prepare('INSERT INTO facturas (numero, cliente, direccion, maquina, plataforma, importe_albaran, fecha) VALUES (?, ?, ?, ?, ?, ?, ?)').run(numero, cliente, direccion, maquina, plataforma, importe_albaran, fecha || new Date().toISOString().split('T')[0]);
  res.json({ ok: true, id: result.lastInsertRowid });
});

app.patch('/api/facturas/:id/reparto', requireAuth, (req, res) => {
  const hora = new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  db.prepare('UPDATE facturas SET estado = ?, empleado_reparto_id = ?, hora_reparto = ? WHERE id = ?').run('en_reparto', req.session.usuario.id, hora, req.params.id);
  res.json({ ok: true });
});

// ─── RECAUDACIÓN (SCRAPING) ──────────────────────────
app.get('/api/facturas/:id/recaudacion', requireGerente, async (req, res) => {
  const factura = db.prepare('SELECT * FROM facturas WHERE id = ?').get(req.params.id);
  if (!factura) return res.status(404).json({ error: 'Factura no encontrada' });
  const datos = await getRecaudacion(factura.cliente);
  res.json(datos);
});

app.post('/api/facturas/:id/confirmar', requireGerente, (req, res) => {
  const { tel_monedas, tel_billetes, rec_monedas, rec_billetes, motivo_discrepancia } = req.body;
  const discrepancia = (parseFloat(rec_monedas) + parseFloat(rec_billetes)) - (parseFloat(tel_monedas) + parseFloat(tel_billetes));
  const hora = new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  db.prepare('INSERT INTO recaudaciones (factura_id, tel_monedas, tel_billetes, rec_monedas, rec_billetes, discrepancia, motivo_discrepancia, confirmado_por, hora_confirmacion) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(req.params.id, tel_monedas, tel_billetes, rec_monedas, rec_billetes, discrepancia, motivo_discrepancia || null, req.session.usuario.id, hora);
  db.prepare('UPDATE facturas SET estado = ? WHERE id = ?').run('liquidada', req.params.id);
  res.json({ ok: true });
});

// ─── TAREAS ─────────────────────────────────────────
app.get('/api/tareas', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM tareas ORDER BY prioridad DESC, id DESC').all());
});
app.post('/api/tareas', requireAuth, (req, res) => {
  const hora = new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  const r = db.prepare('INSERT INTO tareas (descripcion, prioridad, asignada_a, creada_por, hora_creacion) VALUES (?, ?, ?, ?, ?)').run(req.body.descripcion, req.body.prioridad || 'normal', req.body.asignada_a || 'Todos', req.session.usuario.id, hora);
  res.json({ ok: true, id: r.lastInsertRowid });
});
app.patch('/api/tareas/:id', requireAuth, (req, res) => {
  db.prepare('UPDATE tareas SET completada = ? WHERE id = ?').run(req.body.completada ? 1 : 0, req.params.id);
  res.json({ ok: true });
});
app.delete('/api/tareas/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM tareas WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ─── STOCK ──────────────────────────────────────────
app.get('/api/stock', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM stock_avisos WHERE resuelto = 0 ORDER BY nivel DESC, id DESC').all());
});
app.post('/api/stock', requireAuth, (req, res) => {
  const r = db.prepare('INSERT INTO stock_avisos (producto, nivel, nota) VALUES (?, ?, ?)').run(req.body.producto, req.body.nivel || 'bajo', req.body.nota || '');
  res.json({ ok: true, id: r.lastInsertRowid });
});
app.delete('/api/stock/:id', requireAuth, (req, res) => {
  db.prepare('UPDATE stock_avisos SET resuelto = 1 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ─── SOLICITUDES ────────────────────────────────────
app.get('/api/solicitudes', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM solicitudes ORDER BY id DESC').all());
});
app.post('/api/solicitudes', requireAuth, (req, res) => {
  const hora = new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  const r = db.prepare('INSERT INTO solicitudes (cliente, producto, nota, hora_creacion) VALUES (?, ?, ?, ?)').run(req.body.cliente, req.body.producto, req.body.nota || '', hora);
  res.json({ ok: true, id: r.lastInsertRowid });
});
app.patch('/api/solicitudes/:id', requireAuth, (req, res) => {
  db.prepare('UPDATE solicitudes SET completada = ? WHERE id = ?').run(req.body.completada ? 1 : 0, req.params.id);
  res.json({ ok: true });
});
app.delete('/api/solicitudes/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM solicitudes WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ─── ENCARGOS ───────────────────────────────────────
app.get('/api/encargos', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM encargos ORDER BY id DESC').all());
});
app.post('/api/encargos', requireAuth, (req, res) => {
  const hora = new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  const r = db.prepare('INSERT INTO encargos (cliente, descripcion, para_cuando, hora_creacion) VALUES (?, ?, ?, ?)').run(req.body.cliente, req.body.descripcion, req.body.para_cuando || '', hora);
  res.json({ ok: true, id: r.lastInsertRowid });
});
app.patch('/api/encargos/:id', requireAuth, (req, res) => {
  db.prepare('UPDATE encargos SET completado = ? WHERE id = ?').run(req.body.completado ? 1 : 0, req.params.id);
  res.json({ ok: true });
});
app.delete('/api/encargos/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM encargos WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ─── TICKETS CAJA ───────────────────────────────────
app.get('/api/tickets', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM tickets_caja ORDER BY id DESC').all());
});
app.post('/api/tickets', requireAuth, (req, res) => {
  const hora = new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  const r = db.prepare('INSERT INTO tickets_caja (cliente, descripcion, importe, anotado_por, hora_creacion) VALUES (?, ?, ?, ?, ?)').run(req.body.cliente, req.body.descripcion, req.body.importe, req.session.usuario.nombre, hora);
  res.json({ ok: true, id: r.lastInsertRowid });
});
app.patch('/api/tickets/:id/cobrar', requireAuth, (req, res) => {
  const hora = new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  db.prepare('UPDATE tickets_caja SET cobrado = 1, cobrado_por = ?, hora_cobro = ? WHERE id = ?').run(req.session.usuario.nombre, hora, req.params.id);
  res.json({ ok: true });
});
app.delete('/api/tickets/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM tickets_caja WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Fallback para SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
