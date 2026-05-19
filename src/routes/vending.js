const express = require('express');
const router = express.Router();
const { scrapeRecaudacion, scrapeRecaudacionGMBOS } = require('../scraper');

/**
 * Obtiene la recaudación de una máquina consultando primero GMBOS y luego Mi Vending.
 * Solo accesible por gerentes.
 *
 * Query params:
 *   - nombre_maquina: nombre del establecimiento (Razón Social de Strator)
 *   - fecha_reparto: YYYY-MM-DD (opcional, por defecto hoy)
 *   - plataforma: 'gmbos' | 'mivending' | 'auto' (por defecto 'auto')
 */
router.get('/recaudacion', async (req, res) => {
  const { nombre_maquina, fecha_reparto, plataforma } = req.query;

  if (!nombre_maquina) {
    return res.status(400).json({ error: 'Se necesita el nombre de la máquina' });
  }

  const modo = plataforma || 'auto';

  try {
    // Si se especifica plataforma concreta, usar solo esa
    if (modo === 'gmbos') {
      const datos = await scrapeRecaudacionGMBOS(nombre_maquina, fecha_reparto);
      return res.json(datos);
    }

    if (modo === 'mivending') {
      const datos = await scrapeRecaudacion(nombre_maquina, fecha_reparto);
      return res.json(datos);
    }

    // Modo auto: intentar GMBOS primero, luego Mi Vending
    let datos = null;

    // Buscar primero en Mi Vending (mayoría de máquinas)
    if (process.env.MIVENDING_USER) {
      datos = await scrapeRecaudacion(nombre_maquina, fecha_reparto).catch(() => null);
    }

    // Si no encuentra, buscar en GMBOS
    if (!datos || datos.sin_datos) {
      if (process.env.GMBOS_USER) {
        datos = await scrapeRecaudacionGMBOS(nombre_maquina, fecha_reparto).catch(() => null);
      }
    }

    if (!datos) {
      return res.json({
        sin_datos: true,
        mensaje: 'No se encontraron datos de recaudación en ninguna plataforma de telemetría.'
      });
    }

    res.json(datos);

  } catch (error) {
    console.error('Error obteniendo recaudación:', error.message);
    res.status(500).json({
      error: 'Error al consultar la telemetría',
      detalle: error.message
    });
  }
});

module.exports = router;
