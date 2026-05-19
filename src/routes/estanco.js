const express = require('express');
const router = express.Router();
const db = require('../database');

// ─── TAREAS ────────────────────────────────────────────────
router.get('/tareas', (req, res) => {
  const tareas = db.prepare(`
    SELECT t.*, u.nombre as creado_por_nombre
    FROM tareas t LEFT JOIN usuarios u ON t.creado_por = u.id
    ORDER BY t.completada ASC, t.prioridad DESC, t.creado_en DESC
  `).all();
  res.json(tareas);
});

router.post('/tareas', (req, res) => {
  const { titulo, descripcion, prioridad, turno } = req.body;
  const result = db.prepare(`
    INSERT INTO tareas (titulo, descripcion, prioridad, turno, creado_por)
    VALUES (?, ?, ?, ?, ?)
  `).run(titulo, descripcion || '', prioridad || 'normal', turno || 'todos', req.session.user.id);
  res.json({ ok: true, id: result.lastInsertRowid });
});

router.patch('/tareas/:id/completar', (req, res) => {
  db.prepare(`UPDATE tareas SET completada = 1, completada_en = CURRENT_TIMESTAMP WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

router.patch('/tareas/:id/reabrir', (req, res) => {
  db.prepare(`UPDATE tareas SET completada = 0, completada_en = NULL WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

router.delete('/tareas/:id', (req, res) => {
  db.prepare(`DELETE FROM tareas WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

// ─── STOCK ALERTAS ────────────────────────────────────────
router.get('/stock', (req, res) => {
  const items = db.prepare(`
    SELECT s.*, u.nombre as creado_por_nombre
    FROM stock_alertas s LEFT JOIN usuarios u ON s.creado_por = u.id
    WHERE s.resuelto = 0
    ORDER BY s.nivel DESC, s.creado_en DESC
  `).all();
  res.json(items);
});

router.post('/stock', (req, res) => {
  const { producto, nivel } = req.body;
  const result = db.prepare(`INSERT INTO stock_alertas (producto, nivel, creado_por) VALUES (?, ?, ?)`).run(producto, nivel || 'bajo', req.session.user.id);
  res.json({ ok: true, id: result.lastInsertRowid });
});

router.patch('/stock/:id/resolver', (req, res) => {
  db.prepare(`UPDATE stock_alertas SET resuelto = 1 WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

router.delete('/stock/:id', (req, res) => {
  db.prepare(`DELETE FROM stock_alertas WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

// ─── SOLICITUDES CLIENTES ─────────────────────────────────
router.get('/solicitudes', (req, res) => {
  const items = db.prepare(`
    SELECT s.*, u.nombre as creado_por_nombre
    FROM solicitudes_clientes s LEFT JOIN usuarios u ON s.creado_por = u.id
    ORDER BY s.completada ASC, s.creado_en DESC
  `).all();
  res.json(items);
});

router.post('/solicitudes', (req, res) => {
  const { cliente, producto } = req.body;
  const result = db.prepare(`INSERT INTO solicitudes_clientes (cliente, producto, creado_por) VALUES (?, ?, ?)`).run(cliente, producto, req.session.user.id);
  res.json({ ok: true, id: result.lastInsertRowid });
});

router.patch('/solicitudes/:id/completar', (req, res) => {
  db.prepare(`UPDATE solicitudes_clientes SET completada = 1 WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

router.delete('/solicitudes/:id', (req, res) => {
  db.prepare(`DELETE FROM solicitudes_clientes WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

// ─── ENCARGOS PENDIENTES ──────────────────────────────────
router.get('/encargos', (req, res) => {
  const items = db.prepare(`
    SELECT e.*, u.nombre as creado_por_nombre
    FROM encargos e LEFT JOIN usuarios u ON e.creado_por = u.id
    ORDER BY e.completado ASC, e.creado_en DESC
  `).all();
  res.json(items);
});

router.post('/encargos', (req, res) => {
  const { descripcion } = req.body;
  const result = db.prepare(`INSERT INTO encargos (descripcion, creado_por) VALUES (?, ?)`).run(descripcion, req.session.user.id);
  res.json({ ok: true, id: result.lastInsertRowid });
});

router.patch('/encargos/:id/completar', (req, res) => {
  db.prepare(`UPDATE encargos SET completado = 1 WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

router.delete('/encargos/:id', (req, res) => {
  db.prepare(`DELETE FROM encargos WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

// ─── INCIDENCIAS MÁQUINAS ─────────────────────────────────
router.get('/incidencias', (req, res) => {
  const items = db.prepare(`
    SELECT i.*, u.nombre as creado_por_nombre
    FROM incidencias_maquinas i LEFT JOIN usuarios u ON i.creado_por = u.id
    WHERE i.resuelta = 0
    ORDER BY i.creado_en DESC
  `).all();
  res.json(items);
});

router.post('/incidencias', (req, res) => {
  const { cliente, ref_maquina, descripcion } = req.body;
  const result = db.prepare(`INSERT INTO incidencias_maquinas (cliente, ref_maquina, descripcion, creado_por) VALUES (?, ?, ?, ?)`).run(cliente, ref_maquina || '', descripcion, req.session.user.id);
  res.json({ ok: true, id: result.lastInsertRowid });
});

router.patch('/incidencias/:id/resolver', (req, res) => {
  db.prepare(`UPDATE incidencias_maquinas SET resuelta = 1 WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
