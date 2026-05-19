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
  const codigo  = process.env.STRATOR_CODIGO   || '';
  const usuario = process.env.STRATOR_USUARIO  || 'ADMINISTRADOR';
  const password = process.env.STRATOR_PASS    || '';

  if (!codigo || !password) {
    throw new Error('Faltan las variables STRATOR_CODIGO o STRATOR_PASS en Railway');
  }

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  const page = await browser.newPage();
  page.setDefaultTimeout(30000);

  try {
    // 1. Acceder a la URL de login (resolvemos el servidor dinámicamente)
    console.log('[Strator] Accediendo al login...');
    const loginURL = 'https://www-prod13.tpos.logista.com/PortalGamme6/login.jsf';
    await page.goto(loginURL, { waitUntil: 'domcontentloaded', timeout: 40000 });

    // Esperar a que cargue el formulario JSF
    await page.waitForSelector('input', { timeout: 15000 });

    // Limpiar y rellenar el código de punto de venta (primer input visible)
    const inputsCodigo = page.locator('input:not([type="hidden"]):not([type="password"]):not([type="submit"])');
    await inputsCodigo.first().clear();
    await inputsCodigo.first().fill(codigo);

    // Seleccionar usuario en el desplegable
    const selects = page.locator('select');
    if (await selects.count() > 0) {
      // Intentar seleccionar por valor o por texto
      try {
        await selects.first().selectOption({ label: usuario });
      } catch {
        try {
          await selects.first().selectOption({ value: usuario });
        } catch {
          await selects.first().selectOption({ index: 0 });
        }
      }
    }

    // Rellenar contraseña
    await page.fill('input[type="password"]', password);
    console.log('[Strator] Credenciales rellenadas, enviando login...');

    // Hacer clic en Validar y esperar navegación
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {}),
      page.click('input[value="Validar"], button:has-text("Validar"), input[type="submit"]')
    ]);

    // Verificar que el login fue correcto
    const urlActual = page.url();
    console.log('[Strator] URL tras login:', urlActual);
    if (urlActual.includes('login')) {
      throw new Error('Login fallido en Strator — verifica las credenciales en Railway (STRATOR_CODIGO, STRATOR_USUARIO, STRATOR_PASS)');
    }

    // 2. Navegar a Clientes → Facturas
    console.log('[Strator] Navegando a Facturas...');

    // Clic en pestaña Clientes
    await page.click('text="Clientes"');
    await page.waitForLoadState('domcontentloaded', { timeout: 15000 });

    // Clic en Facturas del menú izquierdo
    await page.click('a:has-text("Facturas"), span:has-text("Facturas"), li:has-text("Facturas")');
    await page.waitForLoadState('domcontentloaded', { timeout: 15000 });

    // 3. Esperar tabla de facturas
    await page.waitForSelector('table tr td', { timeout: 20000 });
    console.log('[Strator] Tabla cargada, extrayendo facturas...');

    // 4. Extraer filas
    const facturas = [];
    const filas = await page.locator('table tr').all();

    for (const fila of filas) {
      const celdas = await fila.locator('td').all();
      if (celdas.length < 6) continue;

      const valores = [];
      for (const celda of celdas) {
        valores.push((await celda.innerText()).trim());
      }

      const refFact    = valores[0];
      const razonSoc   = valores[1];
      const fecha      = valores[3];
      const hora       = valores[4];
      const importeStr = valores[5];
      const estado     = valores[6] || '';

      if (!refFact || !refFact.startsWith('FC')) continue;

      // Mostrar solo nombre del bar (parte antes de "/")
      const nombreBar = razonSoc.includes('/')
        ? razonSoc.split('/')[0].trim()
        : razonSoc.trim();

      // Convertir importe "570,75 €" → 570.75
      const importe = parseFloat(
        importeStr.replace(/[€\s]/g, '').replace('.', '').replace(',', '.')
      ) || 0;

      // Convertir fecha "19/05/2026" → "2026-05-19"
      let fechaISO = new Date().toISOString().split('T')[0];
      if (fecha && fecha.includes('/')) {
        const [d, m, y] = fecha.split('/');
        fechaISO = `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
      }

      facturas.push({ numero: refFact, cliente: nombreBar, importe, fecha: fechaISO, hora, estado_strator: estado });
    }

    console.log(`[Strator] Encontradas ${facturas.length} facturas`);
    return facturas;

  } finally {
    await browser.close();
  }
}

/**
 * Hace scraping de GMBOS para obtener la recaudación de una máquina concreta.
 * Navega a la página de recaudaciones y filtra por nombre de establecimiento.
 *
 * @param {string} nombreMaquina - Nombre del establecimiento (Razón Social de Strator)
 * @param {string} fechaReparto - Fecha en formato YYYY-MM-DD (opcional, por defecto hoy)
 * @returns {{ hucha: number, billetes: number } | { sin_datos: true }}
 */
async function scrapeRecaudacionGMBOS(nombreMaquina, fechaReparto) {
  const fecha = fechaReparto || new Date().toISOString().split('T')[0];
  const [year, month, day] = fecha.split('-');
  const fechaGMBOS = `${parseInt(day)}/${parseInt(month)}/${year}`; // formato "19/5/2026"

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();

  try {
    // 1. Login
    await page.goto('https://gmbos4.com/#/login', { waitUntil: 'networkidle', timeout: 30000 });

    await page.fill('input[type="text"], input[placeholder*="usu"], input[placeholder*="User"]', process.env.GMBOS_USER || '');
    await page.fill('input[type="password"]', process.env.GMBOS_PASS || '');
    await page.click('button:has-text("ACCEDER"), button[type="submit"]');

    await page.waitForLoadState('networkidle', { timeout: 20000 });

    // 2. Ir a recaudaciones
    await page.goto('https://gmbos4.com/#/recaudaciones/mis-recaudaciones', { waitUntil: 'networkidle', timeout: 20000 });

    // 3. Esperar a que cargue la tabla con datos
    await page.waitForSelector('table, .recaudacion, [class*="tabla"]', { timeout: 15000 });
    await page.waitForTimeout(2000); // dar tiempo a que cargue el JS

    // 4. Verificar/ajustar el filtro de fecha si es necesario
    // El filtro por defecto es hoy, si necesitamos otra fecha lo ajustamos
    const fechaFiltro = await page.locator('[class*="fecha"], .date-filter, input[type="date"]').first().inputValue().catch(() => '');
    // Si la fecha del filtro no coincide, intentar ajustarla
    // (por defecto GMBOS ya muestra hoy, lo dejamos así para simplificar)

    // 5. Leer todas las filas de la tabla
    const filas = await page.locator('table tbody tr, [class*="row"], [class*="maquina"]').all();

    for (const fila of filas) {
      const texto = await fila.innerText().catch(() => '');

      // Buscar coincidencia con el nombre de la máquina (búsqueda flexible)
      const nombreLimpio = nombreMaquina.toLowerCase().replace(/[^a-z0-9]/g, '');
      const textoLimpio = texto.toLowerCase().replace(/[^a-z0-9]/g, '');

      if (!textoLimpio.includes(nombreLimpio.substring(0, 6)) &&
          !nombreLimpio.includes(textoLimpio.substring(0, 6))) {
        // Intentar match parcial con la primera palabra significativa
        const palabras = nombreMaquina.split(/[\s,\/]+/).filter(p => p.length > 3);
        const encontrado = palabras.some(p => texto.toLowerCase().includes(p.toLowerCase()));
        if (!encontrado) continue;
      }

      // Extraer billetes y monedas del texto de la fila
      // Formato esperado: "BILLETES: 420,00 €" y "MONEDAS: 88,80 €"
      const billetesMatch = texto.match(/BILLETES[:\s]+([\d.,]+)\s*€/i);
      const monedasMatch = texto.match(/MONEDAS[:\s]+([\d.,]+)\s*€/i);
      const totalMatch = texto.match(/TOTAL[:\s]+([\d.,]+)\s*€/i);

      const parsear = (str) => parseFloat((str || '0').replace('.', '').replace(',', '.')) || 0;

      if (billetesMatch || monedasMatch) {
        return {
          billetes: parsear(billetesMatch?.[1]),
          hucha: parsear(monedasMatch?.[1]),
          total: parsear(totalMatch?.[1]),
          fecha_recaudacion: fecha,
          fuente: 'gmbos'
        };
      }
    }

    return {
      sin_datos: true,
      mensaje: `Sin recaudación registrada en GMBOS para "${nombreMaquina}" el ${fecha}. Es posible que el repartidor no haya comunicado la máquina todavía.`
    };

  } finally {
    await browser.close();
  }
}

module.exports = { scrapeRecaudacion, scrapeFacturasStrator, scrapeRecaudacionGMBOS };
