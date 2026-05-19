const express = require('express');
const router = express.Router();
const db = require('../database');

// Obtener facturas del día (o de una fecha)
router.get('/facturas', (req, res) => {
  const fecha = req.query.fecha || new Date().toISOString().split('T')[0];
  const facturas = db.prepare(`
    SELECT f.*, u.nombre as empleado_nombre
    FROM facturas f
    LEFT JOIN usuarios u ON f.empleado_reparto_id = u.id
    WHERE f.fecha = ?
    ORDER BY f.creado_en DESC
  `).all(fecha);
  res.json(facturas);
});

// Añadir factura manualmente (o desde Strator cuando haya API)
router.post('/facturas', (req, res) => {
  const { numero, cliente, importe, ref_maquina, plataforma, fecha } = req.body;
  const fechaUso = fecha || new Date().toISOString().split('T')[0];
  try {
    const result = db.prepare(`
      INSERT INTO facturas (numero, cliente, importe, ref_maquina, plataforma, fecha)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(numero, cliente, importe, ref_maquina, plataforma, fechaUso);
    res.json({ ok: true, id: result.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ error: 'Número de factura duplicado' });
  }
});

// Marcar factura como "en reparto"
router.patch('/facturas/:id/en-reparto', (req, res) => {
  const { id } = req.params;
  const empleadoId = req.session.user.id;
  db.prepare(`
    UPDATE facturas
    SET estado = 'en_reparto', empleado_reparto_id = ?, hora_salida = CURRENT_TIMESTAMP
    WHERE id = ? AND estado = 'pendiente'
  `).run(empleadoId, id);
  res.json({ ok: true });
});

// Obtener facturas en reparto (vista gerente)
router.get('/en-reparto', (req, res) => {
  const facturas = db.prepare(`
    SELECT f.*, u.nombre as empleado_nombre, l.id as liquidacion_id,
           l.confirmada, l.importe_real_monedas, l.importe_real_billetes, l.diferencia
    FROM facturas f
    LEFT JOIN usuarios u ON f.empleado_reparto_id = u.id
    LEFT JOIN liquidaciones l ON f.id = l.factura_id
    WHERE f.estado IN ('en_reparto', 'liquidada')
    AND f.fecha = date('now')
    ORDER BY f.hora_salida DESC
  `).all();
  res.json(facturas);
});

// Obtener o crear liquidación de una factura
router.get('/facturas/:id/liquidacion', (req, res) => {
  const { id } = req.params;
  const factura = db.prepare('SELECT * FROM facturas WHERE id = ?').get(id);
  if (!factura) return res.status(404).json({ error: 'Factura no encontrada' });

  let liquidacion = db.prepare('SELECT * FROM liquidaciones WHERE factura_id = ?').get(id);
  res.json({ factura, liquidacion });
});

// Guardar datos de liquidación
router.post('/facturas/:id/liquidacion', (req, res) => {
  const { id } = req.params;
  const {
    importe_esperado_hucha,
    importe_esperado_billetes,
    importe_real_monedas,
    importe_real_billetes,
    confirmada,
    discrepancia_motivo
  } = req.body;

  const diferencia = ((importe_real_monedas || 0) + (importe_real_billetes || 0)) -
                     ((importe_esperado_hucha || 0) + (importe_esperado_billetes || 0));

  const existente = db.prepare('SELECT id FROM liquidaciones WHERE factura_id = ?').get(id);

  if (existente) {
    db.prepare(`
      UPDATE liquidaciones SET
        importe_esperado_hucha = ?,
        importe_esperado_billetes = ?,
        importe_real_monedas = ?,
        importe_real_billetes = ?,
        diferencia = ?,
        confirmada = ?,
        discrepancia_motivo = ?,
        gerente_id = ?
      WHERE factura_id = ?
    `).run(importe_esperado_hucha, importe_esperado_billetes, importe_real_monedas,
           importe_real_billetes, diferencia, confirmada ? 1 : 0, discrepancia_motivo,
           req.session.user.id, id);
  } else {
    db.prepare(`
      INSERT INTO liquidaciones
        (factura_id, importe_esperado_hucha, importe_esperado_billetes,
         importe_real_monedas, importe_real_billetes, diferencia,
         confirmada, discrepancia_motivo, gerente_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, importe_esperado_hucha, importe_esperado_billetes,
           importe_real_monedas, importe_real_billetes, diferencia,
           confirmada ? 1 : 0, discrepancia_motivo, req.session.user.id);
  }

  if (confirmada) {
    db.prepare("UPDATE facturas SET estado = 'liquidada' WHERE id = ?").run(id);
  }

  res.json({ ok: true, diferencia });
});

module.exports = router;
