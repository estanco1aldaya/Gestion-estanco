const express = require('express');
const router = express.Router();
const { scrapeRecaudacion } = require('../scraper');

// Obtener recaudación de Mi Vending para una máquina
// Solo accesible por gerentes (ver server.js)
router.get('/recaudacion', async (req, res) => {
  const { nombre_maquina, fecha_reparto } = req.query;

  if (!nombre_maquina) {
    return res.status(400).json({ error: 'Se necesita el nombre de la máquina' });
  }

  try {
    const datos = await scrapeRecaudacion(nombre_maquina, fecha_reparto);
    res.json(datos);
  } catch (error) {
    console.error('Error scraping Mi Vending:', error.message);
    res.status(500).json({
      error: 'No se pudo obtener la recaudación de Mi Vending',
      detalle: error.message
    });
  }
});

module.exports = router;
