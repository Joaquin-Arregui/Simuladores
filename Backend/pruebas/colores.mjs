// El color de cada caso (6.5), con los registros de referencia.
//
//     node pruebas/colores.mjs
//
// Cada caso tiene su color, constante de principio a fin y distinto del de los
// demas casos de su pool; sus sobres -los de los que es la solicitud- llevan el
// mismo. Sin navegador, comprueba la paleta (Modeler/lib/scene/colors.js):
//
// 1. Que los ocho primeros son la paleta categorica de referencia, en su orden,
//    y que hasta el caso 1000 no se repite ningun color.
// 2. Que no depende del orden en que se pidan: otra copia del modulo, pidiendo
//    primero el 700, da los mismos.
// 3. Que dos casos seguidos -los que mas probablemente estan a la vez en
//    pantalla- se distinguen: al menos 15 de distancia con vision normal y 8
//    con daltonismo rojo o verde (OKLab x 100, las cotas de la guia de
//    visualizacion), y que el numero de cada pelota se lee sobre su color.
// 4. Que en cada pool de cada modelo de esperado/ los numeros de sus casos no
//    se repiten: con eso, dos casos del mismo pool nunca comparten color.
//
// Despues, en un Chromium de verdad, con la vista (lib/scene/view.js), recorre
// todos los instantes del 02, el 35 y el 10 -sin transito y con el- y mira lo
// dibujado: que cada caso lleva siempre el mismo color, el de su numero, en
// todas sus pelotas y en cualquier zona; que dos casos del mismo pool nunca
// lo comparten; que cada sobre lleva el color del caso de su solicitud; que el
// numero va en la tinta que mejor se lee; y que una insignia o un buzon lleno
// de un solo caso se tine con el suyo, y de varios es blanco. Para ver que las
// comprobaciones distinguen, se repiten con lo dibujado estropeado a
// proposito: el color cambiando con la zona, ocho colores repartidos en ciclo
// y el sobre del color de su remitente; cada una tiene que fallar.
//
// La parte del navegador necesita, en Modeler/, `npm install` y `npx
// playwright install chromium`; con un Chromium ya instalado se puede usar
// ese: CHROMIUM_PATH=<ejecutable>.
import { createRequire } from 'module';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

import { abreChromium, sirve } from './navegador.mjs';

const aqui = dirname(fileURLToPath(import.meta.url));
const modeler = join(aqui, '..', '..', 'Modeler');
const require = createRequire(join(modeler, 'package.json'));
const lib = join(modeler, 'lib');
const colores = pathToFileURL(join(lib, 'scene', 'colors.js')).href;
const { PALETTE, NEUTRAL, caseColor, contrast, deltaE, inkOn, tint } = await import(colores);
const { timelineFromLogs } = await import(pathToFileURL(join(lib, 'timeline', 'timeline.js')).href);

function sale(mensaje) {
  console.log(mensaje);
  process.exit(1);
}

const esperado = join(aqui, 'esperado');
const esCarpeta = ruta => existsSync(ruta) && statSync(ruta).isDirectory();
const carpetas = esCarpeta(esperado)
  ? readdirSync(esperado).flatMap(d => (d === 'con-avisos' ? readdirSync(join(esperado, d)).map(e => join(d, e)) : [ d ]))
    .filter(d => esCarpeta(join(esperado, d)) && readdirSync(join(esperado, d)).some(f => f.endsWith('.xes'))).sort()
  : [];
// Sin registros no hay nada que comprobar, y eso no es un banco en verde.
if (!carpetas.length) sale(`No hay registros congelados en ${esperado}.`);
const nombre = carpeta => carpeta.replace(/^con-avisos[\\/]/, '');
const registrosDe = carpeta => readdirSync(join(esperado, carpeta)).filter(f => f.endsWith('.xes')).sort()
  .map(f => ({ pool: f.replace(/\.xes$/, ''), xes: readFileSync(join(esperado, carpeta, f), 'utf8') }));
const comoTexto = valor => JSON.stringify(valor);

let fallos = 0;
function informa(que, problemas, detalle, ancho = 46) {
  if (problemas.length) {
    fallos += 1;
    console.log(`${que.padEnd(ancho)} FALLA`);
    for (const p of problemas.slice(0, 8)) console.log(`         ${p}`);
  } else {
    console.log(`${que.padEnd(ancho)} ok      ${detalle}`);
  }
}

// --- 1 a 4: la paleta -------------------------------------------------------------

console.log('La paleta:');
const HASTA = 1000;
const todos = Array.from({ length: HASTA }, (_, i) => caseColor(i + 1));
{
  const problemas = [];
  if (comoTexto(todos.slice(0, 8)) !== comoTexto(PALETTE) || comoTexto(PALETTE) !== comoTexto([ '#2a78d6', '#eb6834',
    '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948' ])) {
    problemas.push(`los ocho primeros son ${comoTexto(todos.slice(0, 8))}`);
  }
  if (new Set(todos).size !== HASTA) problemas.push(`${HASTA - new Set(todos).size} colores repetidos`);
  if (todos.some(c => !/^#[0-9a-f]{6}$/.test(c))) problemas.push('un color que no es un hexadecimal');
  if ([ 0, -1, null, undefined, 1.5 ].some(n => caseColor(n) !== NEUTRAL)) problemas.push('sin numero, no da el neutro');
  informa('ocho de referencia y ninguno repetido', problemas, `los 8 de la guia y ${HASTA} distintos`);
}
{
  const otra = await import(`${colores}?otra-copia`);
  const primero = otra.caseColor(700);
  const problemas = [];
  if (primero !== todos[699]) problemas.push(`el 700 da ${primero} y ${todos[699]}`);
  const resto = Array.from({ length: HASTA }, (_, i) => otra.caseColor(i + 1));
  if (comoTexto(resto) !== comoTexto(todos)) problemas.push('pidiendo primero el 700, otros colores');
  informa('no depende del orden', problemas, 'otra copia, empezando por el 700, da los mismos');
}
{
  const problemas = [];
  let peor = { normal: Infinity, cvd: Infinity, tinta: Infinity };
  for (let i = 1; i < HASTA; i++) {
    const normal = deltaE(todos[i], todos[i - 1]);
    const cvd = Math.min(deltaE(todos[i], todos[i - 1], 'protan'), deltaE(todos[i], todos[i - 1], 'deutan'));
    if (normal < 15) problemas.push(`${i} y ${i + 1}: ${normal.toFixed(1)} con vision normal`);
    if (cvd < 8) problemas.push(`${i} y ${i + 1}: ${cvd.toFixed(1)} con daltonismo`);
    peor = { ...peor, normal: Math.min(peor.normal, normal), cvd: Math.min(peor.cvd, cvd) };
  }
  for (const [ i, c ] of todos.entries()) {
    const tinta = contrast(c, inkOn(c));
    if (tinta < 3.9) problemas.push(`el numero del ${i + 1} se lee a ${tinta.toFixed(2)}:1`);
    peor.tinta = Math.min(peor.tinta, tinta);
  }
  informa('dos casos seguidos se distinguen', problemas, `peor par: ${peor.normal.toFixed(1)} normal, ` +
    `${peor.cvd.toFixed(1)} daltonismo; numero a ${peor.tinta.toFixed(2)}:1 o mas`);
}
{
  const problemas = [];
  let casos = 0;
  for (const carpeta of carpetas) {
    const linea = timelineFromLogs(registrosDe(carpeta));
    const porPool = new Map();
    for (const caso of linea.cases) {
      casos += 1;
      if (!Number.isInteger(caso.instance) || caso.instance < 1) problemas.push(`${nombre(carpeta)}, ${caso.id}: sin numero`);
      if (!porPool.has(caso.pool)) porPool.set(caso.pool, new Map());
      const otro = porPool.get(caso.pool).get(caso.instance);
      if (otro) problemas.push(`${nombre(carpeta)}: ${otro} y ${caso.id} tienen el numero ${caso.instance}`);
      porPool.get(caso.pool).set(caso.instance, caso.id);
    }
  }
  informa('numeros distintos en cada pool', problemas, `${casos} casos de ${carpetas.length} modelos: ningun color compartido en su pool`);
}

// --- Lo dibujado, en el navegador ----------------------------------------------------

// Lo que tiene que cumplir lo dibujado, sobre las observaciones: { pelotas:
// [{ case, pool, number, color, tinta }], sobres: [{ request, color }],
// insignias: [{ cases, color, fondo, numeros }] }, de todos los instantes.
function revisaColores(obs, numeroDe) {
  const problemas = [];
  const porCaso = new Map();
  for (const p of obs.pelotas) {
    if (!porCaso.has(p.case)) porCaso.set(p.case, new Set());
    porCaso.get(p.case).add(p.color);
    if (p.color !== caseColor(p.number)) problemas.push(`${p.case}: ${p.color}, y su numero da ${caseColor(p.number)}`);
    if (p.tinta !== inkOn(p.color)) problemas.push(`${p.case}: el numero en ${p.tinta} sobre ${p.color}`);
  }
  for (const [ caso, colors ] of porCaso) {
    if (colors.size > 1) problemas.push(`${caso} cambia de color: ${[ ...colors ].join(', ')}`);
  }
  const porPool = new Map();
  for (const p of obs.pelotas) {
    const clave = `${p.pool} ${[ ...porCaso.get(p.case) ][0]}`;
    if (porPool.has(clave) && porPool.get(clave) !== p.case) problemas.push(`${p.case} y ${porPool.get(clave)} comparten color`);
    porPool.set(clave, p.case);
  }
  for (const s of obs.sobres) {
    const delCaso = porCaso.has(s.request) ? [ ...porCaso.get(s.request) ][0] : caseColor(numeroDe(s.request));
    if (s.color !== delCaso) problemas.push(`un sobre de la solicitud de ${s.request} en ${s.color}, y el caso va en ${delCaso}`);
  }
  // La insignia, con el color de su caso aclarado; el buzon lleno, que es un
  // sobre, con el de su solicitud, como los sobres.
  for (const i of obs.insignias) {
    const uno = new Set(i.numeros).size === 1;
    const previsto = !uno ? NEUTRAL : i.buzon ? caseColor(i.numeros[0]) : tint(caseColor(i.numeros[0]));
    if (i.fondo !== previsto) {
      problemas.push(`${i.buzon ? 'un buzon' : 'una insignia'} de ${comoTexto([ ...new Set(i.numeros) ])} con fondo ${i.fondo}`);
    }
  }
  return [ ...new Set(problemas) ];
}

console.log('\nEn el navegador:');
const BPMN_JS = join(dirname(require.resolve('bpmn-js/package.json')), 'dist');
const integracion = join(aqui, 'integracion');
const MODELOS = [ '02-colaboracion', '35-proceso-base', '10-convocatoria-1-a-n', '27-parejas-con-cadena-de-respuestas' ];
for (const ruta of [ join(BPMN_JS, 'bpmn-modeler.development.js'), ...MODELOS.map(m => join(integracion, `${m}.bpmn`)) ]) {
  if (!existsSync(ruta)) sale(`Falta ${ruta}${ruta.includes('bpmn-js') ? ': npm install en Modeler/.' : '.'}`);
}
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  sale('Faltan las dependencias del Modeler: npm install en Modeler/.');
}

const PRUEBA = `<!doctype html>
<html><head><meta charset="utf-8">
<link rel="stylesheet" href="/bpmn-js/assets/diagram-js.css">
<link rel="stylesheet" href="/bpmn-js/assets/bpmn-js.css">
<style>html, body { margin: 0; height: 100%; } #lienzo { width: 1400px; height: 900px; }</style>
</head><body><div id="lienzo"></div>
<script src="/bpmn-js/bpmn-modeler.development.js"></script>
<script type="module">
  import escena from '/lib/scene/view.js';
  import { timelineFromLogs } from '/lib/timeline/timeline.js';
  window.monta = async (xml, registros) => {
    if (!window.modeler) window.modeler = new window.BpmnJS({ container: '#lienzo', additionalModules: [ escena ] });
    await window.modeler.importXML(xml);
    window.modeler.get('canvas').zoom('fit-viewport');
    const linea = timelineFromLogs(registros);
    window.modeler.get('sceneView').load(linea);
    return linea.changes();
  };
  // Lo dibujado en el instante t: las pelotas, los sobres y las insignias, con
  // el color que de verdad pintan.
  window.mira = (t, opciones) => {
    const estado = window.modeler.get('sceneView').show(t, opciones);
    const capa = '.layer-simulation-drawing > g';
    const pelotas = [ ...document.querySelectorAll(capa + '.scene-ball') ].map(n => ({ case: n.dataset.case,
      pool: n.dataset.pool, number: Number(n.dataset.number), color: n.querySelector('circle').getAttribute('fill'),
      tinta: n.querySelector('text').getAttribute('fill') }));
    const sobres = [ ...document.querySelectorAll(capa + '.scene-envelope') ].map(n => ({ request: n.dataset.request,
      sender: n.dataset.sender, color: n.querySelector('rect').getAttribute('fill') }));
    const enZona = (elemento, zona) => [ ...estado.balls, ...estado.blocked ]
      .filter(b => b.element === elemento && (zona === 'center' || b.zone === zona)).map(b => b.number);
    const insignias = [ ...document.querySelectorAll(capa + '.scene-badge') ].map(n => ({ cases: Number(n.dataset.cases),
      fondo: n.querySelector('rect').getAttribute('fill'), numeros: enZona(n.dataset.element, n.dataset.zone) }));
    for (const n of document.querySelectorAll(capa + '.scene-mailbox')) {
      const numeros = estado.envelopes.filter(e => e.to === n.dataset.element && t < e.pickup).map(e => e.numbers.request);
      insignias.push({ buzon: true, fondo: n.querySelector('rect').getAttribute('fill'), numeros,
        tintado: new Set(numeros).size === 1 });
    }
    return { pelotas, sobres, insignias };
  };
  window.lista = true;
</script></body></html>`;

const servidor = await sirve([ [ '/bpmn-js/', BPMN_JS ], [ '/lib/', lib ] ], { '/prueba.html': PRUEBA, '/favicon.ico': '' });
let navegador;
try {
  navegador = await abreChromium(chromium);
} catch (error) {
  servidor.cierra();
  sale(error.message);
}

try {
  const page = await navegador.newPage({ viewport: { width: 1400, height: 900 } });
  const incidencias = [];
  page.on('pageerror', error => incidencias.push(`error en la pagina: ${error.message.split('\n')[0]}`));
  page.on('console', m => { if (m.type() === 'error') incidencias.push(`error en la consola: ${m.text().split('\n')[0]}`); });
  page.on('dialog', async d => { incidencias.push(`ventana emergente: ${d.message()}`); await d.dismiss(); });
  await page.goto(`${servidor.base}/prueba.html`);
  await page.waitForFunction(() => window.lista && window.BpmnJS);

  // Todos los instantes de un modelo, y a mitad de cada dos, con y sin
  // transito: lo dibujado, junto.
  const recorre = async (modelo, opciones = {}) => {
    const cambios = await page.evaluate(([ xml, registros ]) => window.monta(xml, registros),
      [ readFileSync(join(integracion, `${modelo}.bpmn`), 'utf8'), registrosDe(modelo) ]);
    const instantes = [ ...cambios, ...cambios.slice(1).map((t, i) => (t + cambios[i]) / 2) ];
    const obs = { pelotas: [], sobres: [], insignias: [], instantes: instantes.length };
    for (const transit of [ 0, 4 ]) {
      for (const t of instantes) {
        const visto = await page.evaluate(([ t, o ]) => window.mira(t, o), [ t, { ...opciones, transit } ]);
        obs.pelotas.push(...visto.pelotas);
        obs.sobres.push(...visto.sobres);
        obs.insignias.push(...visto.insignias);
      }
    }
    return obs;
  };
  const numeroDe = modelo => {
    const casos = new Map(timelineFromLogs(registrosDe(modelo)).cases.map(c => [ c.id, c.instance ]));
    return id => casos.get(id);
  };

  const vistos = {};
  for (const modelo of [ '02-colaboracion', '35-proceso-base', '10-convocatoria-1-a-n' ]) {
    const obs = await recorre(modelo);
    vistos[modelo] = obs;
    const casos = new Set(obs.pelotas.map(p => p.case));
    const pools = new Set(obs.pelotas.map(p => p.pool));
    const problemas = revisaColores(obs, numeroDe(modelo));
    if (!obs.pelotas.length || !obs.sobres.length) problemas.push('no se ha visto ninguna pelota o ningun sobre');
    informa(`${modelo}`, problemas, `${obs.instantes} instantes con y sin transito: ${casos.size} casos de ${pools.size} ` +
      `pools, ${obs.pelotas.length} pelotas y ${obs.sobres.length} sobres, cada uno de su color`);
  }

  // Las insignias: con el umbral en 1, las del lote del SACU 1 -un caso- se
  // tinen con su color, y la de los diez residentes que esperan el resultado
  // queda blanca; el buzon del 27 a los 2 s, con avisos de dos servicios,
  // blanco, y el de la convocatoria del 10, de un solo orquestador, tenido.
  {
    const problemas = [];
    const insignias = [];
    const conUmbral = async (modelo, t) => {
      await page.evaluate(([ xml, registros ]) => window.monta(xml, registros),
        [ readFileSync(join(integracion, `${modelo}.bpmn`), 'utf8'), registrosDe(modelo) ]);
      const visto = await page.evaluate(([ t, o ]) => window.mira(t, o), [ t, { threshold: 1 } ]);
      problemas.push(...revisaColores(visto, numeroDe(modelo)));
      insignias.push(...visto.insignias);
    };
    await conUmbral('35-proceso-base', 200);
    await conUmbral('27-parejas-con-cadena-de-respuestas', 2);
    await conUmbral('10-convocatoria-1-a-n', 10);
    const tintadas = insignias.filter(i => i.fondo !== NEUTRAL).length;
    const blancas = insignias.filter(i => i.fondo === NEUTRAL && new Set(i.numeros).size > 1).length;
    const buzones = insignias.filter(i => i.buzon);
    if (!tintadas || !blancas) problemas.push(`${tintadas} insignias tenidas y ${blancas} blancas de varios casos`);
    if (!buzones.some(b => b.tintado) || !buzones.some(b => !b.tintado)) problemas.push('falta un buzon de un caso o de varios');
    informa('insignias y buzones', problemas, `${tintadas} tenidas con el color de su unico caso y ${blancas} blancas de varios; ` +
      'buzones de uno y de varios');
  }

  // Lo dibujado, estropeado a proposito: cada comprobacion tiene que fallar.
  {
    const problemas = [];
    const obs = vistos['35-proceso-base'];
    const numero35 = numeroDe('35-proceso-base');
    const zonas = [ '#000001', '#000002', '#000003' ];
    const controles = [
      [ 'el color cambiando con la zona', { ...obs, pelotas: obs.pelotas.map((p, i) => ({ ...p, color: zonas[i % 3] })) },
        /cambia de color/ ],
      [ 'ocho colores en ciclo', { ...obs, pelotas: obs.pelotas.map(p => ({ ...p, color: PALETTE[(p.number - 1) % 8],
        tinta: inkOn(PALETTE[(p.number - 1) % 8]) })) }, /comparten color/ ],
      [ 'el sobre del color de su remitente', { ...obs, sobres: obs.sobres.map(s => ({ ...s,
        color: caseColor(numero35(s.sender)) })) }, /un sobre de la solicitud/ ]
    ];
    for (const [ que, estropeado, previsto ] of controles) {
      const vistosAqui = revisaColores(estropeado, numero35);
      if (!vistosAqui.some(p => previsto.test(p))) problemas.push(`${que}: no se nota`);
    }
    informa('lo dibujado estropeado, se nota', problemas, 'el color cambiando con la zona, ocho en ciclo, el sobre del remitente');
  }

  informa('sin errores ni ventanas', incidencias, 'ninguno');
} finally {
  await navegador.close();
  servidor.cierra();
}

console.log(fallos ? `\nColores en rojo: ${fallos} problema(s).` : `\nColores en verde: ${carpetas.length} modelos.`);
process.exit(fallos ? 1 : 0);
