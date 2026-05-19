const { chromium } = require('playwright');
const fetch = require('node-fetch');
const cheerio = require('cheerio');

const MIVENDING_URL = 'https://mivending.es/miVendingV3/';
const STRATOR_BASE = 'https://www-prod13.tpos.logista.com/PortalGamme6';

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
  const codigo   = process.env.STRATOR_CODIGO  || '';
  const usuario  = process.env.STRATOR_USUARIO || '';
  const password = process.env.STRATOR_PASS    || '';

  if (!codigo || !password) {
    throw new Error('Faltan las variables STRATOR_CODIGO o STRATOR_PASS en Railway');
  }

  const LOGIN_URL  = `${STRATOR_BASE}/login.jsf`;
  const START_URL  = `${STRATOR_BASE}/pages/start.jsf`;

  // Gestión de cookies manual
  let cookies = {};
  const saveCookies = (res) => {
    const setCookie = res.headers.raw()['set-cookie'] || [];
    setCookie.forEach(c => {
      const [pair] = c.split(';');
      const [k, v] = pair.split('=');
      if (k && v) cookies[k.trim()] = v.trim();
    });
  };
  const getCookieHeader = () => Object.entries(cookies).map(([k,v]) => `${k}=${v}`).join('; ');

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'es-ES,es;q=0.9',
    'Connection': 'keep-alive'
  };

  // 1. GET login page para obtener ViewState y nombres de campos JSF
  console.log('[Strator] GET login page...');
  const loginRes = await fetch(LOGIN_URL, { headers, redirect: 'follow' });
  saveCookies(loginRes);

  if (!loginRes.ok) {
    throw new Error(`No se puede acceder a Strator (HTTP ${loginRes.status}). ¿El servidor está disponible desde Railway?`);
  }

  const loginHtml = await loginRes.text();
  const $login = cheerio.load(loginHtml);

  // Extraer ViewState y nombres de campos del formulario JSF
  const viewState = $login('input[name="javax.faces.ViewState"]').val();
  if (!viewState) {
    throw new Error('No se encontró ViewState en el login de Strator — la estructura de la página puede haber cambiado');
  }

  // Encontrar los nombres de los campos del form (JSF genera IDs dinámicos)
  let fieldCodigo = '', fieldUsuario = '', fieldPassword = '', fieldSubmit = '';
  $login('input:not([type="hidden"])').each((i, el) => {
    const name = $login(el).attr('name') || '';
    const type = $login(el).attr('type') || 'text';
    if (type === 'password') fieldPassword = name;
    else if (type === 'submit') fieldSubmit = name;
    else if (i === 0 || name.toLowerCase().includes('codigo') || name.toLowerCase().includes('pdv')) fieldCodigo = name;
  });
  $login('select').each((i, el) => {
    fieldUsuario = $login(el).attr('name') || '';
  });

  console.log('[Strator] Campos encontrados:', { fieldCodigo, fieldUsuario, fieldPassword, fieldSubmit });

  // Obtener el valor del usuario en el select
  let valorUsuario = usuario;
  $login('select option').each((i, el) => {
    const text = $login(el).text().trim().toUpperCase();
    if (text === usuario.toUpperCase()) {
      valorUsuario = $login(el).attr('value') || usuario;
    }
  });

  // 2. POST login
  console.log('[Strator] POST login...');
  const formData = new URLSearchParams();
  if (fieldCodigo) formData.append(fieldCodigo, codigo);
  if (fieldUsuario) formData.append(fieldUsuario, valorUsuario);
  if (fieldPassword) formData.append(fieldPassword, password);
  if (fieldSubmit) formData.append(fieldSubmit, 'Validar');
  formData.append('javax.faces.ViewState', viewState);
  // Añadir el nombre del formulario JSF
  const formName = $login('form').attr('id') || $login('form').attr('name') || '';
  if (formName) formData.append(formName, formName);

  const postRes = await fetch(LOGIN_URL, {
    method: 'POST',
    headers: { ...headers, 'Cookie': getCookieHeader(), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formData.toString(),
    redirect: 'follow'
  });
  saveCookies(postRes);

  const postUrl = postRes.url;
  const postHtml = await postRes.text();
  console.log('[Strator] URL tras login:', postUrl);

  if (postUrl.includes('login') && !postHtml.includes('start')) {
    throw new Error('Login fallido en Strator — verifica STRATOR_CODIGO, STRATOR_USUARIO y STRATOR_PASS en Railway');
  }

  // 3. Navegar a la página de facturas
  // La URL de facturas en Strator es dinámica via JSF, necesitamos simular clicks
  // Primero obtenemos la página principal y buscamos el link a facturas
  console.log('[Strator] Buscando enlace a Facturas...');
  const startRes = await fetch(START_URL, {
    headers: { ...headers, 'Cookie': getCookieHeader() },
    redirect: 'follow'
  });
  saveCookies(startRes);
  const startHtml = await startRes.text();
  const $start = cheerio.load(startHtml);

  // Buscar el ViewState de la página principal
  const vsStart = $start('input[name="javax.faces.ViewState"]').val() || '';

  // Buscar link o form action para Facturas en el menú
  let facturasAction = '';
  $start('a, button, span').each((i, el) => {
    const text = $start(el).text().trim();
    if (text === 'Facturas') {
      const href = $start(el).attr('href') || $start(el).attr('onclick') || '';
      facturasAction = href;
    }
  });

  console.log('[Strator] Acción Facturas:', facturasAction || '(no encontrada, intentando URL directa)');

  // Intentar navegar directamente a la sección de facturas via POST JSF
  const formStart = $start('form').first().attr('id') || $start('form').first().attr('name') || 'form';
  const facturasFormData = new URLSearchParams();
  facturasFormData.append('javax.faces.ViewState', vsStart);
  facturasFormData.append('javax.faces.partial.ajax', 'true');
  facturasFormData.append('javax.faces.source', 'menuForm:j_idt_facturas');

  // Hacer click simulado en Facturas buscando el botón/link correcto en el formulario
  $start('a[id*="factura"], a[id*="Factura"], span[id*="factura"]').each((i, el) => {
    const id = $start(el).attr('id') || '';
    if (id) facturasFormData.set('javax.faces.source', id);
  });

  // Obtener la página de facturas via GET con las cookies de sesión
  const facturasURL = `${STRATOR_BASE}/pages/start.jsf#`;
  const facturasRes = await fetch(facturasURL, {
    headers: { ...headers, 'Cookie': getCookieHeader() },
    redirect: 'follow'
  });
  saveCookies(facturasRes);
  const facturasHtml = await facturasRes.text();
  const $f = cheerio.load(facturasHtml);

  // 4. Extraer facturas de la tabla
  console.log('[Strator] Extrayendo tabla de facturas...');
  const facturas = [];

  $f('table tr').each((i, row) => {
    const celdas = $f(row).find('td');
    if (celdas.length < 6) return;

    const vals = [];
    celdas.each((j, td) => vals.push($f(td).text().trim()));

    const refFact    = vals[0];
    const razonSoc   = vals[1];
    const fecha      = vals[3];
    const hora       = vals[4];
    const importeStr = vals[5];
    const estado     = vals[6] || '';

    if (!refFact || !refFact.startsWith('FC')) return;

    const nombreBar = razonSoc.includes('/') ? razonSoc.split('/')[0].trim() : razonSoc.trim();
    const importe = parseFloat(importeStr.replace(/[€\s.]/g, '').replace(',', '.')) || 0;

    let fechaISO = new Date().toISOString().split('T')[0];
    if (fecha && fecha.includes('/')) {
      const [d, m, y] = fecha.split('/');
      fechaISO = `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
    }

    facturas.push({ numero: refFact, cliente: nombreBar, importe, fecha: fechaISO, hora, estado_strator: estado });
  });

  console.log(`[Strator] Encontradas ${facturas.length} facturas`);

  if (facturas.length === 0) {
    console.log('[Strator] HTML recibido (primeros 500 chars):', facturasHtml.substring(0, 500));
    throw new Error('Strator respondió pero no se encontraron facturas en la tabla. Es posible que la navegación al menú de Clientes → Facturas no haya funcionado.');
  }

  return facturas;
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
