// Pruebas de la interfaz del Modeler (5.6): el Modeler compilado, en un
// Chromium de verdad, usado como lo usaria alguien.
//
//     node pruebas/interfaz.mjs
//
// El resto del banco prueba sin navegador el codigo del Modeler -lib/rules,
// lib/people, lib/numbers y lib/logs- y la API con lo que el Modeler manda.
// Aqui se prueba lo que solo existe en la pagina, con el proceso base de
// Modeler/ejemplos/:
//
// 1. Se abre con Open Existing Model y se pinta entero.
// 2. Ctrl+S lo guarda igual, byte a byte, y en UTF-8 aunque lleve acentos.
// 3. Simular manda exactamente lo que integracion.py manda a la API -las reglas
//    de exportadas/ejemplos/ y el propio fichero, sin semilla-, y con la
//    respuesta de la API, los registros congelados del 35, la ventana ofrece un
//    registro por pool con su nombre, sus casos y su fichero; cada descarga es
//    el registro tal cual, en UTF-8, tambien con un nombre con acentos.
// 4. Los paneles validan como el Backend, y lo que no vale se marca y no se
//    guarda: los tiempos de una tarea -iguales valen, y los decimales
//    sobreviven a guardar y abrir-, el porcentaje de una rama -la suma se
//    explica, no se exige-, las instancias del pool, y el nombre y la semilla
//    de la raiz.
// 5. El menu de reemplazo pone y quita la marca de multiinstancia de una tarea
//    y la de multiplicidad de un pool, y llegan al fichero y a las reglas.
// 6. Las personas de una tarea se anaden en el panel y llegan a
//    extensionElements y a las reglas.
// En ninguna puede salir una ventana emergente ni un error en la consola.
//
// No hace falta el Backend: Simular se responde aqui con la respuesta de la API,
// que integracion.py comprueba. Se prueba el Modeler compilado como lo compila
// `npm run bundle`, pero en una carpeta temporal, asi que es siempre el de las
// fuentes de hoy y example/dist no se toca. Necesita, en Modeler/,
// `npm install` y `npx playwright install chromium`; con un Chromium ya
// instalado se puede usar ese: CHROMIUM_PATH=<ejecutable>.
import { spawnSync } from 'child_process';
import { createRequire } from 'module';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, relative } from 'path';
import { fileURLToPath } from 'url';

import { abreChromium, sirve } from './navegador.mjs';

const aqui = dirname(fileURLToPath(import.meta.url));
const modeler = join(aqui, '..', '..', 'Modeler');
const require = createRequire(join(modeler, 'package.json'));
const pagina = join(modeler, 'example');
const EJEMPLO = join(modeler, 'ejemplos', 'proceso-base.bpmn');
const REGLAS = join(aqui, 'exportadas', 'ejemplos', 'proceso-base.txt');
const REGISTROS = join(aqui, 'esperado', '35-proceso-base');
const BACKEND = 'http://localhost:3000';

function sale(mensaje) {
  console.log(mensaje);
  process.exit(1);
}

for (const ruta of [EJEMPLO, REGLAS, REGISTROS]) {
  if (!existsSync(ruta)) sale(`Falta ${relative(join(aqui, '..', '..'), ruta)}.`);
}

let chromium, webpack;
try {
  ({ chromium } = require('playwright'));
  webpack = require.resolve('webpack/bin/webpack.js');
} catch {
  sale('Faltan las dependencias del Modeler: npm install en Modeler/.');
}

// El Modeler compilado, como con npm run bundle, en una carpeta temporal.
const dist = mkdtempSync(join(tmpdir(), 'modeler-dist-'));
const compilacion = spawnSync(process.execPath, [webpack, '--mode', 'production', '--output-path', dist],
  { cwd: modeler, encoding: 'utf8' });
if (compilacion.status !== 0) {
  rmSync(dist, { recursive: true, force: true });
  sale(`No compila el Modeler:\n${`${compilacion.stdout}${compilacion.stderr}`.slice(-3000)}`);
}

// La pagina, servida como la sirve cualquier servidor de ficheros; dist/, la
// recien compilada.
const servidor = await sirve([ [ '/', pagina ], [ '/dist/', dist ] ]);
const base = servidor.base;

let navegador;
try {
  navegador = await abreChromium(chromium);
} catch (error) {
  servidor.cierra();
  rmSync(dist, { recursive: true, force: true });
  sale(error.message);
}

// La respuesta de la API para el ejemplo: los registros congelados del 35, en
// el orden de sus pools, y lo que comparten.
const atributo = (xes, clave) => (xes.match(new RegExp(`key="${clave}" value="([^"]*)"`)) || [])[1];
const congelados = readdirSync(REGISTROS).filter(f => f.endsWith('.xes')).map(f => readFileSync(join(REGISTROS, f), 'utf8'));
const orden = atributo(congelados[0], 'simulation:participants').split(', ');
const LOGS = congelados.map(xes => ({ pool: atributo(xes, 'pool:id'), name: atributo(xes, 'pool:name'), xes }))
  .sort((a, b) => orden.indexOf(a.pool) - orden.indexOf(b.pool));
const RESPUESTA = {
  simulationId: atributo(LOGS[0].xes, 'simulation:id'),
  formatVersion: atributo(LOGS[0].xes, 'simulation:formatVersion'),
  model: { id: atributo(LOGS[0].xes, 'model:id'), name: atributo(LOGS[0].xes, 'model:name'),
    rulesSha256: atributo(LOGS[0].xes, 'model:rulesSha256') },
  seed: Number(atributo(LOGS[0].xes, 'simulation:seed')),
  logs: LOGS,
  warnings: []
};
const ejemplo = readFileSync(EJEMPLO);
const reglas = readFileSync(REGLAS, 'utf8');

// ---------------------------------------------------------------------------
// La pagina y lo que se hace en ella.

async function nuevaPagina(respuesta = RESPUESTA) {
  const page = await navegador.newPage({ acceptDownloads: true, viewport: { width: 1600, height: 1000 } });
  page.incidencias = [];
  page.on('dialog', async dialogo => {
    page.incidencias.push(`ventana emergente: ${dialogo.message()}`);
    await dialogo.dismiss();
  });
  page.on('pageerror', error => page.incidencias.push(`error en la pagina: ${error.message.split('\n')[0]}`));
  page.on('console', mensaje => {
    if (mensaje.type() === 'error') page.incidencias.push(`error en la consola: ${mensaje.text().split('\n')[0]}`);
  });
  page.peticiones = [];
  const cabeceras = { 'Access-Control-Allow-Origin': '*' };
  await page.route(`${BACKEND}/simulation-config`, ruta => ruta.fulfill({ json: { timeoutSeconds: 300 }, headers: cabeceras }));
  await page.route(`${BACKEND}/simulate`, async ruta => {
    page.peticiones.push(JSON.parse(ruta.request().postData()));
    await ruta.fulfill({ json: respuesta, headers: cabeceras });
  });
  return page;
}

// Un diagrama abierto en el Modeler, como lo deja la pagina de inicio.
async function abre(xml, respuesta) {
  const page = await nuevaPagina(respuesta);
  await page.goto(`${base}/modeler.html`);
  await page.evaluate(texto => sessionStorage.setItem('importedDiagram', texto), xml.toString());
  await page.reload();
  await page.waitForSelector('.djs-element.djs-shape');
  await page.waitForTimeout(300);
  return page;
}

const utf8 = new TextDecoder('utf-8', { fatal: true });

// Lo que guarda Ctrl+S: los bytes y el texto, que tiene que ser UTF-8.
async function guarda(page) {
  await page.keyboard.press('Escape');
  await page.click('#canvas', { position: { x: 5, y: 5 } });
  const [descarga] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+s')]);
  const bytes = readFileSync(await descarga.path());
  return { bytes, texto: utf8.decode(bytes) };
}

// Un clic en un elemento: en una tarea o un evento, en su esquina; en un pool,
// en la banda del nombre; en un flujo, en su centro.
async function selecciona(page, id, { hit = '.djs-hit', x = 12, y = 12, centro = false } = {}) {
  await page.keyboard.press('Escape');
  await page.click('#canvas', { position: { x: 5, y: 5 } });
  const forma = page.locator(`.djs-element[data-element-id="${id}"] > ${hit}`).first();
  if (centro) {
    // El trazo de un flujo no es una caja: el clic, en el centro de su linea.
    const caja = await forma.boundingBox();
    await page.mouse.click(caja.x + caja.width / 2, caja.y + caja.height / 2);
  } else {
    await forma.click({ position: { x, y } });
  }
  await page.waitForTimeout(150);
}
const POOL = { hit: '.djs-hit-all', x: 10, y: 40 };
const FLUJO = { centro: true };

async function seleccionaLaRaiz(page) {
  await page.keyboard.press('Escape');
  await page.click('#canvas', { position: { x: 1000, y: 950 } });
  await page.waitForTimeout(150);
}

async function abreGrupo(page, titulo) {
  const cabecera = page.locator(`.bio-properties-panel-group-header:has-text("${titulo}")`);
  if (!(await cabecera.getAttribute('class')).includes('open')) await cabecera.click();
}

async function escribe(page, entrada, valor) {
  await page.fill(`#bio-properties-panel-${entrada}`, valor);
  await page.waitForTimeout(450); // el panel guarda pasados 300 ms sin escribir
}

const valor = (page, entrada) => page.inputValue(`#bio-properties-panel-${entrada}`);
const texto = async (page, entrada, clase) =>
  (await page.locator(`[data-entry-id="${entrada}"] .bio-properties-panel-${clase}`).allInnerTexts()).join(' ');
const error = (page, entrada) => texto(page, entrada, 'error');
const descripcion = (page, entrada) => texto(page, entrada, 'description');

async function reemplazo(page, entrada) {
  await page.click('.djs-context-pad [data-action="replace"]');
  await page.click(`.djs-popup [data-id="${entrada}"]`);
  await page.waitForTimeout(150);
}

// Simular, y lo que muestra la ventana de resultados.
async function simula(page) {
  const antes = page.peticiones.length;
  await page.click('#js-simulate');
  await page.waitForSelector('.modal-overlay', { state: 'visible' });
  await page.waitForFunction(() => document.getElementById('js-simulate').textContent === 'Simular');
  const ventana = await page.evaluate(() => ({
    resumen: document.getElementById('simulation-summary').innerText,
    estado: document.getElementById('simulation-status').textContent,
    filas: [...document.querySelectorAll('#simulation-logs tbody tr')]
      .map(tr => [...tr.querySelectorAll('th, td')].slice(0, 3).map(c => c.innerText.trim()))
  }));
  return { peticion: page.peticiones.length > antes ? page.peticiones[page.peticiones.length - 1] : null, ...ventana };
}

async function descarga(page, fila) {
  const [hecha] = await Promise.all([page.waitForEvent('download'),
    page.locator('#simulation-logs tbody tr').nth(fila).getByRole('button', { name: 'Descargar' }).click()]);
  const bytes = readFileSync(await hecha.path());
  return { fichero: hecha.suggestedFilename(), texto: utf8.decode(bytes) };
}

// La etiqueta de apertura de un elemento, o su bloque entero, en un .bpmn.
const etiqueta = (xml, id) => (xml.match(new RegExp(`<[\\w:]+ id="${id}"[^>]*>`)) || [''])[0];
function bloque(xml, id) {
  const inicio = xml.search(new RegExp(`<[\\w:]+ id="${id}"`));
  if (inicio < 0) return '';
  const nombre = xml.slice(inicio + 1).match(/^[\w:]+/)[0];
  const fin = xml.indexOf(`</${nombre}>`, inicio);
  return fin < 0 ? etiqueta(xml, id) : xml.slice(inicio, fin + nombre.length + 3);
}
const lineaDe = (contenido, id) => contenido.split('\n').find(l => l.includes(`id_bpmn="${id}"`)) || '';

// ---------------------------------------------------------------------------

let fallos = 0, total = 0;
async function prueba(nombre, cuerpo) {
  total += 1;
  const problemas = [];
  let detalle = '';
  const paginas = [];
  try {
    detalle = await cuerpo(problemas, async (...args) => {
      const page = await abre(...args);
      paginas.push(page);
      return page;
    }, paginas);
  } catch (error) {
    problemas.push(`no ha podido terminar: ${error.message.split('\n')[0]}`);
  }
  for (const page of paginas) {
    problemas.push(...page.incidencias);
    await page.close();
  }
  if (problemas.length) {
    fallos += 1;
    console.log(`${nombre.padEnd(34)} FALLA`);
    for (const p of problemas) console.log(`         ${p}`);
  } else {
    console.log(`${nombre.padEnd(34)} ok      ${detalle}`);
  }
}
const espera = (problemas, que, obtenido, esperado) => {
  if (JSON.stringify(obtenido) !== JSON.stringify(esperado)) {
    problemas.push(`${que}: ${JSON.stringify(obtenido)}, y tenia que ser ${JSON.stringify(esperado)}`);
  }
};

try {
  await prueba('abrir, guardar y simular', async (problemas, _abre, paginas) => {
    const page = await nuevaPagina();
    paginas.push(page);
    await page.goto(`${base}/index.html`);
    const [selector] = await Promise.all([page.waitForEvent('filechooser'), page.click('#open-local-model')]);
    await selector.setFiles(EJEMPLO);
    await page.waitForURL(/modeler\.html/);
    await page.waitForSelector('.djs-element.djs-shape');
    await page.waitForTimeout(300);
    // Lo que tiene forma en el DI; el plano es la raiz, que no se pinta.
    const dibujados = [...new Set([...ejemplo.toString().matchAll(/<bpmndi:BPMN(?:Shape|Edge) [^>]*bpmnElement="([^"]+)"/g)]
      .map(m => m[1]))];
    const pintados = new Set(await page.$$eval('.djs-element[data-element-id]', ns => ns.map(n => n.getAttribute('data-element-id'))));
    const faltan = dibujados.filter(id => !pintados.has(id));
    if (faltan.length) problemas.push(`no se pintan: ${faltan.join(', ')}`);

    const { bytes } = await guarda(page);
    if (!bytes.equals(ejemplo)) problemas.push('Ctrl+S no lo guarda igual, byte a byte');

    const { peticion, resumen, estado, filas } = await simula(page);
    espera(problemas, 'Simular manda', Object.keys(peticion || {}).sort(), ['content', 'diagramXML']);
    if (peticion?.content !== reglas) problemas.push('las reglas que manda no son las de exportadas/ejemplos/');
    if (peticion?.diagramXML !== ejemplo.toString()) problemas.push('el diagrama que manda no es el fichero');
    espera(problemas, 'la ventana ofrece', filas, LOGS.map(l => [l.name, String((l.xes.match(/<trace>/g) || []).length), `${l.name}.xes`]));
    if (!resumen.includes(`semilla ${RESPUESTA.seed}`) || !resumen.includes(`«${RESPUESTA.model.name}»`)) {
      problemas.push(`el resumen dice ${JSON.stringify(resumen)}`);
    }
    if (!estado.includes(`${LOGS.length} registros`)) problemas.push(`el estado dice ${JSON.stringify(estado)}`);
    for (const [i, log] of LOGS.entries()) {
      const { fichero, texto: xes } = await descarga(page, i);
      espera(problemas, `la descarga ${i + 1} se llama`, fichero, `${log.name}.xes`);
      if (xes !== log.xes) problemas.push(`${fichero} no es el registro de ${log.pool}`);
    }
    return `${dibujados.length} elementos pintados; Ctrl+S igual; manda las reglas y el fichero; ${LOGS.length} registros descargados`;
  });

  await prueba('acentos en lo guardado', async (problemas, abre) => {
    const xml = ejemplo.toString().replace('name="Proceso base"', 'name="Convocatoria de año académico"');
    const page = await abre(xml);
    const { texto: guardado } = await guarda(page);
    if (guardado !== xml) problemas.push('Ctrl+S no guarda igual un nombre con acentos');
    const nombre = 'Año académico';
    const logs = LOGS.map((log, i) => (i === 1
      ? { ...log, name: nombre, xes: log.xes.replace(`key="pool:name" value="${log.name}"`, `key="pool:name" value="${nombre}"`) }
      : log));
    const otra = await abre(xml, { ...RESPUESTA, logs });
    const { filas } = await simula(otra);
    espera(problemas, 'la fila del pool con acentos', filas[1]?.[2], `${nombre}.xes`);
    const { fichero, texto: xes } = await descarga(otra, 1);
    espera(problemas, 'la descarga se llama', fichero, `${nombre}.xes`);
    if (xes !== logs[1].xes) problemas.push('la descarga con acentos no es el registro');
    return 'el .bpmn y el XES, en UTF-8 e iguales';
  });

  await prueba('tiempos de una tarea', async (problemas, abre) => {
    const t = 'Publicar_Convocatoria';
    let page = await abre(ejemplo);
    await selecciona(page, t);
    await abreGrupo(page, 'Simulation parameters');
    espera(problemas, 'con 10 y 10', [await valor(page, 'minimumTime'), await valor(page, 'maximumTime'),
      await error(page, 'minimumTime'), await error(page, 'maximumTime')], ['10', '10', '', '']);
    await escribe(page, 'maximumTime', '3');
    if (!(await error(page, 'maximumTime'))) problemas.push('un maximo menor que el minimo no se marca');
    let xml = (await guarda(page)).texto;
    espera(problemas, 'con el maximo en 3, se guarda', etiqueta(xml, t).match(/user:maximumTime="[^"]*"/)?.[0], 'user:maximumTime="10"');
    await selecciona(page, t);
    await escribe(page, 'minimumTime', '2.5');
    await escribe(page, 'maximumTime', '4');
    espera(problemas, 'con 2.5 y 4, los errores', [await error(page, 'minimumTime'), await error(page, 'maximumTime')], ['', '']);
    xml = (await guarda(page)).texto;
    espera(problemas, 'con 2.5 y 4, se guarda', etiqueta(xml, t).match(/user:minimumTime="[^"]*" user:maximumTime="[^"]*"/)?.[0],
      'user:minimumTime="2.5" user:maximumTime="4"');
    page = await abre(xml);
    await selecciona(page, t);
    await abreGrupo(page, 'Simulation parameters');
    espera(problemas, 'vuelto a abrir', [await valor(page, 'minimumTime'), await valor(page, 'maximumTime')], ['2.5', '4']);
    return 'iguales valen; un maximo menor no se guarda; 2.5 sobrevive a guardar y abrir';
  });

  await prueba('porcentaje de una rama', async (problemas, abre) => {
    let page = await abre(ejemplo);
    await selecciona(page, 'r5', FLUJO);
    await abreGrupo(page, 'SequenceFlow properties');
    espera(problemas, 'al abrir', [await valor(page, 'sequenceFlow'), await descripcion(page, 'sequenceFlow')],
      ['60', 'The branches add up to 100 %.']);
    await escribe(page, 'sequenceFlow', '70');
    espera(problemas, 'con 70 y 40', [await error(page, 'sequenceFlow'), await descripcion(page, 'sequenceFlow')],
      ['', 'The branches add up to 110 %: the simulator scales them to 100 % and warns.']);
    await escribe(page, 'sequenceFlow', '150');
    espera(problemas, 'con 150', await error(page, 'sequenceFlow'), 'Cannot be more than 100.');
    let xml = (await guarda(page)).texto;
    espera(problemas, 'con 150, se guarda', etiqueta(xml, 'r5').match(/sequenceFlow:percentageOfBranches="[^"]*"/)?.[0],
      'sequenceFlow:percentageOfBranches="70"');
    await selecciona(page, 'r5', FLUJO);
    await escribe(page, 'sequenceFlow', '0');
    await selecciona(page, 'r6', FLUJO);
    await escribe(page, 'sequenceFlow', '0');
    espera(problemas, 'con las dos ramas a 0', await error(page, 'sequenceFlow'),
      'No branch of this gateway could ever be taken: give one a percentage above 0.');
    await escribe(page, 'sequenceFlow', '33.3');
    xml = (await guarda(page)).texto;
    espera(problemas, 'con 0 y 33.3, se guarda', ['r5', 'r6'].map(id => etiqueta(xml, id).match(/percentageOfBranches="([^"]*)"/)?.[1]),
      ['0', '33.3']);
    page = await abre(xml);
    await selecciona(page, 'r6', FLUJO);
    await abreGrupo(page, 'SequenceFlow properties');
    espera(problemas, 'vuelto a abrir', [await valor(page, 'sequenceFlow'), await descripcion(page, 'sequenceFlow')],
      ['33.3', 'The branches add up to 33.3 %: the simulator scales them to 100 % and warns.']);
    return 'la suma se explica y no se exige; mas de 100 o todas a 0 no se guardan; 33.3 sobrevive';
  });

  await prueba('pool y raiz', async (problemas, abre) => {
    const page = await abre(ejemplo);
    await selecciona(page, 'Pool_Residente', POOL);
    await abreGrupo(page, 'Model properties');
    await escribe(page, 'instances', '0');
    if (!(await error(page, 'instances'))) problemas.push('instances=0 no se marca');
    let xml = (await guarda(page)).texto;
    espera(problemas, 'con instances=0, se guarda', etiqueta(xml, 'Pool_Residente').match(/participantWithoutLane:instances="[^"]*"/)?.[0],
      'participantWithoutLane:instances="10"');
    await selecciona(page, 'Pool_Residente', POOL);
    await escribe(page, 'instances', '12');
    await seleccionaLaRaiz(page);
    await abreGrupo(page, 'Model properties');
    await escribe(page, 'seed', '9007199254740992');
    if (!(await error(page, 'seed'))) problemas.push('una semilla de 2^53 no se marca');
    await escribe(page, 'collaborationName', 'Otra convocatoria');
    xml = (await guarda(page)).texto;
    espera(problemas, 'se guarda', [etiqueta(xml, 'Pool_Residente').match(/participantWithoutLane:instances="[^"]*"/)?.[0],
      etiqueta(xml, 'Colaboracion').match(/ name="[^"]*"|collab:seed="[^"]*"/g)],
    ['participantWithoutLane:instances="12"', [' name="Otra convocatoria"', 'collab:seed="20260101"']]);
    await seleccionaLaRaiz(page);
    await escribe(page, 'collaborationName', '');
    xml = (await guarda(page)).texto;
    if (/ name="/.test(etiqueta(xml, 'Colaboracion'))) problemas.push('vaciar Model name no quita el nombre');
    return 'instances=0 y una semilla de 2^53 no se guardan; Model name se pone y se quita';
  });

  await prueba('menu de reemplazo', async (problemas, abre) => {
    const t = 'Publicar_Convocatoria';
    const page = await abre(ejemplo);
    await selecciona(page, t);
    await reemplazo(page, 'toggle-parallel-mi');
    await selecciona(page, 'Pool_SACU', POOL);
    await reemplazo(page, 'toggle-participant-multiplicity');
    let xml = (await guarda(page)).texto;
    if (!/<bpmn:multiInstanceLoopCharacteristics\s*\/>/.test(bloque(xml, t))) problemas.push(`${t} no se guarda con la marca`);
    if (/participantMultiplicity/.test(bloque(xml, 'Pool_SACU').replace(/participantWithoutLane:/g, ''))) {
      problemas.push('Pool_SACU se guarda con el marcador de multiplicidad');
    }
    const { peticion } = await simula(page);
    await page.click('#close-modal');
    espera(problemas, 'en las reglas', [lineaDe(peticion.content, t).match(/multiInstanceType="[^"]*"/)?.[0],
      lineaDe(peticion.content, 'Pool_SACU').match(/participantMultiplicity="[^"]*"/)?.[0]],
    ['multiInstanceType="false"', 'participantMultiplicity="false"']);
    await selecciona(page, t);
    await reemplazo(page, 'toggle-parallel-mi');
    xml = (await guarda(page)).texto;
    if (/multiInstanceLoopCharacteristics/.test(bloque(xml, t))) problemas.push(`${t} no pierde la marca al quitarla`);
    return 'la marca de multiinstancia y la de multiplicidad llegan al fichero y a las reglas, y se quitan';
  });

  await prueba('personas de una tarea', async (problemas, abre) => {
    const t = 'Publicar_Convocatoria';
    const page = await abre(ejemplo);
    await selecciona(page, t);
    await abreGrupo(page, 'Simulation parameters');
    await page.click('.add-role-button:has-text("Add User Task")');
    await page.locator('.user-pool-container .user-task-input').last().fill('Diego');
    await page.waitForTimeout(150);
    const xml = (await guarda(page)).texto;
    espera(problemas, 'en extensionElements', [...bloque(xml, t).matchAll(/<user:userTask>([^<]*)<\/user:userTask>/g)].map(m => m[1]),
      ['Ana', 'Bea', 'Carlos', 'Diego']);
    const { peticion } = await simula(page);
    espera(problemas, 'en las reglas', lineaDe(peticion.content, t).match(/userTask="[^"]*"/)?.[0], 'userTask="Ana, Bea, Carlos, Diego"');
    return 'se anaden en el panel y llegan a extensionElements y a las reglas';
  });
} finally {
  await navegador.close();
  servidor.cierra();
  rmSync(dist, { recursive: true, force: true });
}

console.log(fallos ? `\nInterfaz en rojo: ${fallos} de ${total} pruebas.` : `\nInterfaz en verde: ${total} pruebas.`);
process.exit(fallos ? 1 : 0);
