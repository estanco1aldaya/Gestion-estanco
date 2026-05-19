const express = require('express');
const router = express.Router();
const db = require('../database');

// Listar tickets (pendientes primero)
router.get('/tickets', (req, res) => {
  const tickets = db.prepare(`
    SELECT t.*,
           u1.nombre as creado_por_nombre,
           u2.nombre as cobrado_por_nombre
    FROM tickets_caja t
    LEFT JOIN usuarios u1 ON t.creado_por = u1.id
    LEFT JOIN usuarios u2 ON t.cobrado_por = u2.id
    ORDER BY t.cobrado ASC, t.creado_en DESC
  `).all();
  res.json(tickets);
});

// Crear ticket pendiente
router.post('/tickets', (req, res) => {
  const { cliente, concepto, importe } = req.body;
  const result = db.prepare(`
    INSERT INTO tickets_caja (cliente, concepto, importe, creado_por)
    VALUES (?, ?, ?, ?)
  `).run(cliente, concepto, importe, req.session.user.id);
  res.json({ ok: true, id: result.lastInsertRowid });
});

// Marcar como cobrado
router.patch('/tickets/:id/cobrar', (req, res) => {
  db.prepare(`
    UPDATE tickets_caja
    SET cobrado = 1, cobrado_por = ?, cobrado_en = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(req.session.user.id, req.params.id);
  res.json({ ok: true });
});

// Eliminar ticket
router.delete('/tickets/:id', (req, res) => {
  db.prepare(`DELETE FROM tickets_caja WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
