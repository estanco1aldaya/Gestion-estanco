const puppeteer = require('puppeteer');

const MIVENDING_URL = 'https://mivending.es/miVendingV3/';

async function getRecaudacion(nombreMaquina) {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    // Login
    await page.goto(MIVENDING_URL, { waitUntil: 'networkidle2' });
    await page.type('input[type="text"]', process.env.MIVENDING_USER);
    await page.type('input[type="password"]', process.env.MIVENDING_PASS);
    await page.click('button[type="submit"], .btn-acceder, button');
    await page.waitForNavigation({ waitUntil: 'networkidle2' });

    // Ir al listado de máquinas
    await page.goto(MIVENDING_URL + 'mivending.php#maquinasListado.php', { waitUntil: 'networkidle2' });
    await page.waitForSelector('table', { timeout: 10000 });

    // Buscar la máquina por nombre
    const filas = await page.$$('table tbody tr');
    let urlMaquina = null;

    for (const fila of filas) {
      const texto = await fila.evaluate(el => el.textContent);
      if (texto.toLowerCase().includes(nombreMaquina.toLowerCase())) {
        const enlace = await fila.$('a');
        if (enlace) {
          urlMaquina = await enlace.evaluate(el => el.href);
          break;
        }
      }
    }

    if (!urlMaquina) {
      return { error: 'Máquina no encontrada en Mi Vending' };
    }

    // Entrar en el detalle de la máquina
    await page.goto(urlMaquina, { waitUntil: 'networkidle2' });

    // Ir a pestaña Comunicaciones y Recaudaciones
    const pestanas = await page.$$('.nav-tabs a, .tabs a, [role="tab"]');
    for (const pestana of pestanas) {
      const texto = await pestana.evaluate(el => el.textContent);
      if (texto.includes('Comunicaciones') || texto.includes('Recaudaciones')) {
        await pestana.click();
        await page.waitForTimeout(1500);
        break;
      }
    }

    // Leer la tabla de recaudaciones
    await page.waitForSelector('table', { timeout: 8000 });

    const hoy = new Date().toISOString().split('T')[0];

    const recaudaciones = await page.evaluate((hoy) => {
      const tablas = document.querySelectorAll('table');
      let datos = [];

      for (const tabla of tablas) {
        const headers = Array.from(tabla.querySelectorAll('th')).map(th => th.textContent.trim().toLowerCase());
        const tieneRecaudacion = headers.some(h => h.includes('recaudaci') || h.includes('hucha') || h.includes('billetes'));

        if (tieneRecaudacion) {
          const filas = tabla.querySelectorAll('tbody tr');
          for (const fila of filas) {
            const celdas = Array.from(fila.querySelectorAll('td')).map(td => td.textContent.trim());
            datos.push(celdas);
          }
          break;
        }
      }
      return datos;
    }, hoy);

    if (!recaudaciones.length) {
      return { error: 'Sin datos de recaudación disponibles' };
    }

    // Buscar la fila de hoy
    const filaHoy = recaudaciones.find(fila => {
      return fila.some(celda => celda.includes(hoy.split('-').reverse().join('-')) || celda.startsWith(hoy));
    });

    if (!filaHoy) {
      return { 
        error: 'Sin recaudación registrada hoy',
        mensaje: 'Es posible que el repartidor no haya comunicado la máquina aún'
      };
    }

    // Extraer hucha y billetes
    const valores = filaHoy.map(v => v.replace('€', '').replace(',', '.').trim());
    
    return {
      ok: true,
      fecha: filaHoy[0] || '',
      hucha: parseFloat(valores[2]) || 0,
      billetes: parseFloat(valores[3]) || 0,
      total: (parseFloat(valores[2]) || 0) + (parseFloat(valores[3]) || 0)
    };

  } catch (err) {
    console.error('Error scraping Mi Vending:', err.message);
    return { error: 'Error al conectar con Mi Vending: ' + err.message };
  } finally {
    if (browser) await browser.close();
  }
}

module.exports = { getRecaudacion };
