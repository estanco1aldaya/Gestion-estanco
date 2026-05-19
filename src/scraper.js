const { chromium } = require('playwright');

const MIVENDING_URL = 'https://mivending.es/miVendingV3/';

/**
 * Hace scraping de Mi Vending para obtener la recaudación de una máquina.
 * Busca la fila más reciente del día indicado (o de hoy si no se indica fecha).
 *
 * @param {string} nombreMaquina - Nombre del bar/establecimiento tal como aparece en Mi Vending
 * @param {string} fechaReparto - Fecha en formato YYYY-MM-DD (opcional, por defecto hoy)
 * @returns {{ hucha: number, billetes: number, fecha_recaudacion: string } | { sin_datos: true }}
 */
async function scrapeRecaudacion(nombreMaquina, fechaReparto) {
  const fechaBuscar = fechaReparto || new Date().toISOString().split('T')[0];

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();

  try {
    // 1. Login
    await page.goto(MIVENDING_URL, { waitUntil: 'networkidle', timeout: 30000 });

    await page.fill('input[name="usuario"], input[type="text"]', process.env.MIVENDING_USER || '');
    await page.fill('input[name="password"], input[type="password"]', process.env.MIVENDING_PASS || '');
    await page.click('button[type="submit"], input[type="submit"], .btn-login');

    await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});

    // 2. Ir al listado de máquinas
    await page.waitForSelector('table, .maquina, .listado', { timeout: 15000 });

    // 3. Buscar la máquina por nombre y hacer clic
    const maquinaLink = page.locator(`text="${nombreMaquina}"`).first();
    if (!(await maquinaLink.isVisible())) {
      // Intentar búsqueda parcial
      const links = await page.locator('a, td').filter({ hasText: nombreMaquina }).all();
      if (links.length === 0) {
        throw new Error(`Máquina "${nombreMaquina}" no encontrada en Mi Vending`);
      }
      await links[0].click();
    } else {
      await maquinaLink.click();
    }

    await page.waitForLoadState('networkidle', { timeout: 15000 });

    // 4. Ir a la pestaña de Comunicaciones y Recaudaciones
    const pestanaRecaudacion = page.locator('text="Comunicaciones", text="Recaudaciones", a:has-text("Comunicaci")').first();
    if (await pestanaRecaudacion.isVisible()) {
      await pestanaRecaudacion.click();
      await page.waitForLoadState('networkidle', { timeout: 10000 });
    }

    // 5. Leer la tabla de visitas/recaudaciones
    await page.waitForSelector('table', { timeout: 10000 });

    // Buscar la fila del día de hoy
    const filas = await page.locator('table tr').all();
    let resultado = null;

    for (const fila of filas) {
      const textoFila = await fila.innerText().catch(() => '');
      // Comprobar si la fila contiene la fecha de hoy (en varios formatos)
      const fechaDD_MM = fechaBuscar.split('-').reverse().join('/'); // YYYY-MM-DD → DD/MM/YYYY
      const fechaMM_DD = fechaBuscar.split('-').slice(1).reverse().join('/') + '/' + fechaBuscar.split('-')[0];

      if (textoFila.includes(fechaDD_MM) || textoFila.includes(fechaBuscar)) {
        const celdas = await fila.locator('td').all();
        const valores = [];
        for (const celda of celdas) {
          valores.push((await celda.innerText()).trim());
        }

        // Parsear los valores numéricos de Hucha y Billetes
        // Las columnas varían, buscamos patrones de €
        const numeros = valores.map(v => parseFloat(v.replace('€', '').replace(',', '.').trim())).filter(n => !isNaN(n));

        if (numeros.length >= 2) {
          resultado = {
            hucha: numeros[0],         // Hucha (monedas)
            billetes: numeros[1],       // Billetes
            fecha_recaudacion: fechaBuscar,
            valores_raw: valores
          };
          break;
        }
      }
    }

    if (!resultado) {
      return { sin_datos: true, mensaje: `Sin recaudación registrada hoy (${fechaBuscar}) para "${nombreMaquina}". Es posible que el repartidor no haya comunicado la máquina todavía.` };
    }

    return resultado;

  } finally {
    await browser.close();
  }
}

/**
 * Hace scraping de Strator para obtener las facturas del día actual
 * más cualquier factura pendiente de días anteriores.
 * Devuelve array de facturas con: numero, cliente (solo nombre del bar), importe, fecha, hora, estado
 */
async function scrapeFacturasStrator() {
  const STRATOR_URL = 'https://www-prod13.tpos.logista.com/PortalGamme6/login.jsf';
  const codigo = process.env.STRATOR_CODIGO || '';
  const usuario = process.env.STRATOR_USUARIO || 'ADMINISTRADOR';
  const password = process.env.STRATOR_PASS || '';

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();

  try {
    // 1. Login en Strator
    await page.goto(STRATOR_URL, { waitUntil: 'networkidle', timeout: 30000 });

    // Rellenar código punto de venta
    const inputCodigo = page.locator('input').first();
    await inputCodigo.fill(codigo);

    // Seleccionar usuario en el desplegable
    const selectUsuario = page.locator('select');
    if (await selectUsuario.count() > 0) {
      await selectUsuario.selectOption({ label: usuario });
    }

    // Rellenar contraseña
    await page.fill('input[type="password"]', password);

    // Pulsar Validar
    await page.click('input[value="Validar"], button:has-text("Validar")');
    await page.waitForLoadState('networkidle', { timeout: 20000 });

    // 2. Navegar a Clientes → Facturas
    // Clic en la pestaña Clientes del menú superior
    await page.click('text="Clientes"');
    await page.waitForLoadState('networkidle', { timeout: 10000 });

    // Clic en Facturas del menú lateral izquierdo
    await page.click('text="Facturas"');
    await page.waitForLoadState('networkidle', { timeout: 10000 });

    // 3. Esperar a que cargue la tabla
    await page.waitForSelector('table', { timeout: 15000 });

    // 4. Extraer todas las filas de la tabla
    const facturas = [];

    const filas = await page.locator('table tr').all();

    for (const fila of filas) {
      const celdas = await fila.locator('td').all();
      if (celdas.length < 6) continue; // saltar cabeceras o filas vacías

      const valores = [];
      for (const celda of celdas) {
        valores.push((await celda.innerText()).trim());
      }

      // Columnas: Ref.Fact | Razón Social | Tipo | Fecha | Hora | Importe | Estado | Estado2
      const refFact   = valores[0];
      const razonSoc  = valores[1];
      const fecha     = valores[3]; // formato DD/MM/YYYY
      const hora      = valores[4];
      const importeStr = valores[5];
      const estado    = valores[6];

      if (!refFact || !refFact.startsWith('FC')) continue;

      // Extraer solo el nombre del bar (parte antes de "/")
      const nombreBar = razonSoc.includes('/')
        ? razonSoc.split('/')[0].trim()
        : razonSoc.trim();

      // Convertir importe: "570,75 €" → 570.75
      const importe = parseFloat(
        importeStr.replace('€', '').replace('.', '').replace(',', '.').trim()
      ) || 0;

      // Convertir fecha: "19/05/2026" → "2026-05-19"
      let fechaISO = '';
      if (fecha && fecha.includes('/')) {
        const [d, m, y] = fecha.split('/');
        fechaISO = `${y}-${m}-${d}`;
      }

      facturas.push({
        numero: refFact,
        cliente: nombreBar,
        importe,
        fecha: fechaISO,
        hora,
        estado_strator: estado || ''
      });
    }

    return facturas;

  } finally {
    await browser.close();
  }
}

module.exports = { scrapeRecaudacion, scrapeFacturasStrator };
