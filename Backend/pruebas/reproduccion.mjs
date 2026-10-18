// La reproduccion del visualizador (6.7): convocatoria, casos e instante.
//
//     node pruebas/reproduccion.mjs
//
// Sin navegador, el reproductor (Modeler/lib/player) con los registros de
// referencia:
//
// 1. Las convocatorias de cada modelo: cada caso en una, cada una con su
//    ventana, una detras de otra; en el 31, tres, de 0 a 88, de 88 a 151 y de
//    151 a 217 s.
// 2. El filtro, «1-3, 7», y lo que no se entiende; y que el resumen de cada
//    pool -en curso, por llegar, terminados- no cambia con el filtro, en todos
//    los modelos y todos sus instantes: solo cambia cuantos se ven.
// 3. El reloj: avanza a su velocidad desde su ultimo punto de partida, sin
//    acumular errores; se para al final; en pausa se queda exactamente donde
//    se paro o donde se salto; y al cambiar de velocidad sigue desde donde
//    estaba.
// 3b. La convocatoria es el alcance: la escena de cada una, con solo sus
//    casos, tiene en cada instante lo de la escena de toda la simulacion
//    quedandose con sus casos -pelotas, recuentos, plantilla y cola-; en el
//    31, a los 88 y a los 151 s, la que acaba no tiene a nadie ocupado ni
//    nada en la cola, y la que empieza, si.
//
// Despues, el Modeler compilado, en un Chromium de verdad, con el reloj de la
// pagina en la mano (page.clock): la API se responde con los registros
// congelados, y se reproduce sobre el diagrama de integracion de su modelo.
//
// 4. Reproducir y saltar al mismo instante dibujan lo mismo: el 39 entero, a
//    x5, y en cada uno de unos cien fotogramas, las mismas pelotas -caso,
//    elemento, estado, zona, ejecucion y persona-, sobres, insignias, buzones,
//    plantillas -quien esta ocupado con que y la cola- y reloj que saltando a
//    ese instante exacto. Al pausar, el dibujo es identico, tambien donde esta
//    cada marca, al de saltar ahi; y al de salir, volver a entrar y saltar
//    ahi, sin nada dibujado antes. Saltar mientras se reproduce -con el
//    instante exacto, cambio siguiente o la barra de tiempo- y cambiar de
//    velocidad siguen exactamente desde ahi; e Ir sin haber escrito nada no
//    mueve el instante, aunque el campo lo muestre redondeado. Y en el 14, con
//    el buzon lleno y las insignias, lo mismo en 50 fotogramas.
// 5. Con eventos simultaneos y cancelaciones: reproduciendo a x1 hasta
//    exactamente los 22 s del 39 -la recogida cancela su espera de mas-, los
//    23 -empieza la evaluacion: cuatro asignaciones y tres esperas a la vez-,
//    los 37 -Ana acaba el acta y toma una evaluacion- y los 49 -Dani suelta
//    una y toma otra-, lo dibujado es lo de saltar ahi, y lo de llegar con
//    «cambio siguiente».
// 6. El filtro oculta el resto y no cambia ningun recuento: con los
//    solicitantes «3, 5-6» se ven sus pelotas y las de la comision, y solo los
//    sobres entre casos que se ven; las insignias, los buzones, las plantillas
//    y el resumen son los de antes, salvo cuantos se ven; en el 14, con 50
//    orquestados y «1-3», las insignias y el buzon siguen como estaban. Uno
//    que no se entiende se marca, se explica y no filtra.
// 7. La convocatoria, con el 31: se elige una de las tres o todas, y la barra
//    de tiempo va de su principio a su fin; solo se ven sus casos y el resumen
//    cuenta los suyos. Es el alcance tambien de la plantilla y de la cola: en
//    los bordes, 88 y 151 s, cada una solo con lo suyo; y el filtro, dentro de
//    ella, conserva sus recuentos.
// 8. El salto exacto, sin redondear, y fuera de la ventana, a su borde; Salir
//    borra lo dibujado, devuelve los botones de simular y el foco a
//    Reproducir; abrir otro diagrama cierra la reproduccion, y no se puede
//    volver a reproducir hasta simularlo; mientras se simula, tampoco; y la
//    barra no tapa ni la paleta ni el logotipo de bpmn.io, tampoco a 1366 x
//    768. Si se abre otro diagrama mientras el Backend simula, su respuesta
//    no activa Reproducir: es del diagrama de antes.
// En ninguna puede salir una ventana emergente ni un error en la consola.
//
// Se prueba el Modeler compilado como lo compila `npm run bundle`, en una
// carpeta temporal. Necesita, en Modeler/, `npm install` y `npx playwright
// install chromium`; con un Chromium ya instalado se puede usar ese:
// CHROMIUM_PATH=<ejecutable>.
import { spawnSync } from 'child_process';
import { createRequire } from 'module';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

import { abreChromium, sirve } from './navegador.mjs';

const aqui = dirname(fileURLToPath(import.meta.url));
const modeler = join(aqui, '..', '..', 'Modeler');
const require = createRequire(join(modeler, 'package.json'));
const lib = join(modeler, 'lib');
const { timelineFromLogs } = await import(pathToFileURL(join(lib, 'timeline', 'timeline.js')).href);
const player = await import(pathToFileURL(join(lib, 'player', 'player.js')).href);
const { createScene } = await import(pathToFileURL(join(lib, 'scene', 'scene.js')).href);
const { createStaff } = await import(pathToFileURL(join(lib, 'scene', 'staff.js')).href);
const { countZones } = await import(pathToFileURL(join(lib, 'scene', 'zones.js')).href);

function sale(mensaje) {
  console.log(mensaje);
  process.exit(1);
}

const esperado = join(aqui, 'esperado');
const integracion = join(aqui, 'integracion');
const esCarpeta = ruta => existsSync(ruta) && statSync(ruta).isDirectory();
const carpetas = esCarpeta(esperado)
  ? readdirSync(esperado).flatMap(d => (d === 'con-avisos' ? readdirSync(join(esperado, d)).map(e => join(d, e)) : [ d ]))
    .filter(d => esCarpeta(join(esperado, d)) && readdirSync(join(esperado, d)).some(f => f.endsWith('.xes'))).sort()
  : [];
// Sin registros no hay nada que comprobar, y eso no es un banco en verde.
if (!carpetas.length) sale(`No hay registros congelados en ${esperado}.`);
const MODELOS = [ '39-evaluar-con-cinco-personas', '31-tres-convocatorias', '14-convocatoria-de-50' ];
for (const modelo of MODELOS) {
  if (!carpetas.includes(modelo)) sale(`Falta el modelo ${modelo} en ${esperado}.`);
  if (!existsSync(join(integracion, `${modelo}.bpmn`))) sale(`Falta integracion/${modelo}.bpmn.`);
}
const nombre = carpeta => carpeta.replace(/^con-avisos[\\/]/, '');
const atributo = (xes, clave) => (xes.match(new RegExp(`key="${clave}" value="([^"]*)"`)) || [])[1];
const registrosDe = carpeta => readdirSync(join(esperado, carpeta)).filter(f => f.endsWith('.xes')).sort()
  .map(f => readFileSync(join(esperado, carpeta, f), 'utf8'))
  .map(xes => ({ pool: atributo(xes, 'pool:id'), name: atributo(xes, 'pool:name'), xes }));
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

// --- 1 a 3: el reproductor, sin navegador ------------------------------------------

console.log('El reproductor:');
const lineas = new Map(carpetas.map(c => [ nombre(c), timelineFromLogs(registrosDe(c)) ]));
{
  const problemas = [];
  let rondas = 0;
  for (const [ modelo, linea ] of lineas) {
    const grupos = player.convocatoriasOf(linea);
    rondas += grupos.length;
    const todos = grupos.flatMap(g => g.cases);
    if (todos.length !== linea.cases.length || new Set(todos).size !== todos.length) problemas.push(`${modelo}: casos sin convocatoria o repetidos`);
    for (const g of grupos) {
      const suyos = linea.cases.filter(c => g.cases.includes(c.id));
      if (g.start !== Math.min(...suyos.map(c => c.start)) || g.end !== Math.max(...suyos.map(c => c.end))) {
        problemas.push(`${modelo}, convocatoria ${g.call}: ventana ${g.start}-${g.end}`);
      }
    }
    for (let i = 1; i < grupos.length; i++) {
      if (grupos[i].start < grupos[i - 1].end) problemas.push(`${modelo}: la convocatoria ${grupos[i].call} empieza antes de que acabe la anterior`);
    }
    const todas = player.windowOf(linea, null);
    if (todas.start !== linea.start || todas.end !== linea.end || todas.cases.size !== linea.cases.length) problemas.push(`${modelo}: todas`);
  }
  const de31 = player.convocatoriasOf(lineas.get('31-tres-convocatorias')).map(g => [ g.call, g.start, g.end, g.cases.length ]);
  if (comoTexto(de31) !== comoTexto([ [ 1, 0, 88, 4 ], [ 2, 88, 151, 4 ], [ 3, 151, 217, 4 ] ])) problemas.push(`el 31: ${comoTexto(de31)}`);
  informa('convocatorias', problemas, `${rondas} en ${lineas.size} modelos; el 31, de 0 a 88, de 88 a 151 y de 151 a 217 s`);
}
{
  const problemas = [];
  const casos = [ [ '1-3, 7', [ 1, 2, 3, 7 ] ], [ ' 4 ', [ 4 ] ], [ '2;5 5', [ 2, 5 ] ], [ '', null ], [ '  ', null ] ];
  for (const [ texto, previsto ] of casos) {
    const { numbers, error } = player.parseNumbers(texto);
    if (error || comoTexto(numbers && [ ...numbers ].sort((a, b) => a - b)) !== comoTexto(previsto)) problemas.push(`«${texto}»: ${comoTexto(numbers && [ ...numbers ])}`);
  }
  // Tambien los numeros enormes, que no se pueden recorrer de uno en uno: el
  // de 17 cifras colgaba la pagina.
  const malos = [ 'x', '3-1', '0', '1-', '-2', '1.5', '1-2-3', '10000000000000000', '9007199254740992', '1000001', '1-20000' ];
  for (const texto of malos) {
    if (!player.parseNumbers(texto).error) problemas.push(`«${texto}» se entiende`);
  }

  // El resumen no depende del filtro: con un caso de cada pool, o ninguno.
  let instantes = 0;
  for (const [ modelo, linea ] of lineas) {
    const ventana = player.windowOf(linea, null);
    const filtro = Object.fromEntries(linea.pools.map(p => [ p.id, '1' ]));
    const { cases, errors } = player.visibleCases(linea, ventana, filtro);
    const previstos = linea.cases.filter(c => c.instance === 1).map(c => c.id).sort();
    if (Object.keys(errors).length || comoTexto([ ...cases ].sort()) !== comoTexto(previstos)) problemas.push(`${modelo}: el filtro «1»`);
    for (const t of linea.changes()) {
      instantes += 1;
      const sin = player.summaryAt(linea, t, ventana);
      const con = player.summaryAt(linea, t, ventana, cases);
      const quita = r => r.map(({ shown, ...resto }) => resto);
      if (comoTexto(quita(sin)) !== comoTexto(quita(con))) problemas.push(`${modelo}, t=${t}: el filtro cambia el resumen`);
      for (const r of sin) {
        if (r.pending + r.active + r.finished !== r.total) problemas.push(`${modelo}, t=${t}: ${r.pool} no suma`);
        const casos = linea.cases.filter(c => c.pool === r.pool);
        const activos = casos.filter(c => c.start <= t && t < c.end).length;
        if (r.active !== activos || r.total !== casos.length) problemas.push(`${modelo}, t=${t}: ${r.pool}, ${r.active} en curso`);
      }
      if (con.reduce((n, r) => n + r.shown, 0) !== cases.size) problemas.push(`${modelo}: cuantos se ven`);
    }
  }
  informa('filtro y resumen', problemas, `«1-3, 7» y ${malos.length} que no se entienden, tambien enormes; el resumen no cambia ` +
    `con el filtro en ${instantes} instantes`);
}
{
  const problemas = [];
  const reloj = player.createClock({ start: 10, end: 100, speed: 3 });
  const esperado = (que, valor, previsto) => {
    if (valor !== previsto) problemas.push(`${que}: ${valor} y se esperaba ${previsto}`);
  };
  esperado('al principio', reloj.at(0), 10);
  reloj.play(1000);
  let ultimo;
  for (let ms = 1000; ms <= 17000; ms += 16) ultimo = reloj.at(ms);
  esperado('a x3 durante 16 s, en fotogramas de 16 ms', ultimo, 58);
  esperado('al pausar', reloj.pause(17000), 58);
  esperado('en pausa, pase el tiempo que pase', reloj.at(99999), 58);
  esperado('el salto exacto', reloj.seek(22.123456789, 0), 22.123456789);
  reloj.play(0);
  esperado('al cambiar de velocidad', reloj.setSpeed(10, 2000), 28.123456789);
  esperado('despues, a x10', reloj.at(3000), 38.123456789);
  esperado('al final', reloj.at(100000), 100);
  if (reloj.playing) problemas.push('sigue reproduciendo al final');
  esperado('reproducir desde el final vuelve a empezar', reloj.play(0), 10);
  esperado('fuera de la ventana, a su borde', reloj.seek(500, 0), 100);
  esperado('y por debajo', reloj.seek(-3, 0), 10);
  informa('el reloj', problemas, 'desde su punto de partida, sin acumular; se para al final; pausa y salto exactos');
}

// La convocatoria es el alcance: la escena de una convocatoria -su linea de
// tiempo, con solo sus casos- tiene solo sus pelotas, sus sobres, sus
// recuentos y, en su plantilla y su cola, solo sus ejecuciones. Se contrasta,
// en cada instante de cada convocatoria de cada modelo con mas de una, con la
// escena de toda la simulacion quedandose con lo de sus casos.
{
  const problemas = [];
  let instantes = 0;
  let rondas = 0;
  for (const [ modelo, linea ] of lineas) {
    const grupos = player.convocatoriasOf(linea);
    if (grupos.length < 2) continue;
    const toda = createScene(linea);
    const plantilla = createStaff(linea);
    for (const grupo of grupos) {
      rondas += 1;
      const suyos = new Set(grupo.cases);
      const escena = createScene(linea.only(suyos));
      const cambios = linea.changes().filter(t => t >= grupo.start && t <= grupo.end);
      for (const t of [ ...cambios, ...cambios.slice(1).map((t, i) => (t + cambios[i]) / 2) ]) {
        instantes += 1;
        const suya = escena.at(t);
        const de = toda.at(t);
        const pelotas = [ ...de.balls, ...de.blocked ].filter(b => suyos.has(b.case));
        const buzon = de.envelopes.filter(e => suyos.has(e.sender) && suyos.has(e.target));
        if (comoTexto(suya.zones) !== comoTexto(countZones(pelotas, buzon))) problemas.push(`${modelo}, ${grupo.call}, t=${t}: recuentos`);
        if (comoTexto([ ...suya.balls, ...suya.blocked ].map(b => b.id).sort()) !== comoTexto(pelotas.map(b => b.id).sort())) {
          problemas.push(`${modelo}, ${grupo.call}, t=${t}: pelotas`);
        }
        const previsto = Object.fromEntries(Object.entries(plantilla.at(t)).map(([ pool, p ]) => [ pool, {
          gente: p.people.map(x => [ x.name, x.work.filter(w => suyos.has(w.case)).map(w => w.id) ]),
          cola: p.queue.filter(q => suyos.has(q.case)).map(q => q.id) } ]));
        const visto = Object.fromEntries(Object.entries(suya.staff).map(([ pool, p ]) => [ pool, {
          gente: p.people.map(x => [ x.name, x.work.map(w => w.id) ]), cola: p.queue.map(q => q.id) } ]));
        if (comoTexto(visto) !== comoTexto(previsto)) problemas.push(`${modelo}, ${grupo.call}, t=${t}: plantilla ${comoTexto(visto).slice(0, 160)}`);
      }
    }
  }

  // En el 31, en los bordes: al acabar la primera, a los 88 s, nadie esta
  // ocupado y la cola esta vacia, aunque la segunda ya ha empezado.
  const linea31 = lineas.get('31-tres-convocatorias');
  const ocupados = (call, t) => {
    const escena = call === null ? createScene(linea31) : createScene(linea31.only(player.windowOf(linea31, call).cases));
    const s = escena.at(t).staff.Pool_Orquestador;
    return `${s.busy} ocupadas, ${s.queue.length} en cola`;
  };
  const bordes = [ [ 1, 88, '0 ocupadas, 0 en cola' ], [ 2, 88, '1 ocupadas, 2 en cola' ], [ 2, 151, '0 ocupadas, 0 en cola' ],
    [ 3, 151, '1 ocupadas, 2 en cola' ], [ null, 88, '1 ocupadas, 2 en cola' ] ];
  for (const [ call, t, previsto ] of bordes) {
    if (ocupados(call, t) !== previsto) problemas.push(`el 31, convocatoria ${call ?? 'todas'} a los ${t} s: ${ocupados(call, t)}`);
  }
  informa('la convocatoria, como alcance', problemas, `${rondas} convocatorias, ${instantes} instantes: solo sus pelotas, recuentos, ` +
    'plantilla y cola; el 31 a los 88 y 151 s');
}

// --- 4 a 8: en el navegador ----------------------------------------------------------

console.log('\nEn el navegador:');
let chromium, webpack;
try {
  ({ chromium } = require('playwright'));
  webpack = require.resolve('webpack/bin/webpack.js');
} catch {
  sale('Faltan las dependencias del Modeler: npm install en Modeler/.');
}

// El Modeler compilado, como con npm run bundle, en una carpeta temporal.
const dist = mkdtempSync(join(tmpdir(), 'modeler-dist-'));
const compilacion = spawnSync(process.execPath, [ webpack, '--mode', 'production', '--output-path', dist ],
  { cwd: modeler, encoding: 'utf8' });
if (compilacion.status !== 0) {
  rmSync(dist, { recursive: true, force: true });
  sale(`No compila el Modeler:\n${`${compilacion.stdout}${compilacion.stderr}`.slice(-3000)}`);
}
const servidor = await sirve([ [ '/', join(modeler, 'example') ], [ '/dist/', dist ] ]);
let navegador;
try {
  navegador = await abreChromium(chromium);
} catch (error) {
  servidor.cierra();
  rmSync(dist, { recursive: true, force: true });
  sale(error.message);
}

// Lo que se ve en la pagina: `estado` es lo que hay -que pelotas, en que
// elemento, estado y zona, con que persona; que sobres, insignias, buzones y
// plantillas; el reloj-, y `dibujo`, ademas, donde esta cada marca, en
// coordenadas del diagrama, sin el numero de marca de la capa de dibujo.
// Mientras se reproduce, el transito mueve las marcas por sus flujos, y un
// sobre que acaba de salir se ve llegar aunque ya este recogido o cuente ya en
// un buzon lleno: es cosmetico, y no cuenta en el estado.
const MIRA = () => {
  const barra = document.getElementById('replay');
  const t = Number(barra.dataset.t);
  const todas = [ ...document.querySelectorAll('.layer-simulation-drawing > g') ]
    .filter(n => n.getAttribute('visibility') !== 'hidden');
  const llenos = new Set(todas.filter(n => n.classList.contains('scene-mailbox')).map(n => n.dataset.element));
  const cosmetico = n => n.classList.contains('scene-envelope') && n.dataset.transit === 'true' &&
    (Number(n.dataset.pickup) <= t || llenos.has(n.dataset.to));
  const capa = todas.filter(n => !cosmetico(n));
  const de = (clase, campos) => capa.filter(n => n.classList.contains(clase))
    .map(n => campos.map(c => n.dataset[c] ?? '').join('|')).sort();
  const plantillas = capa.filter(n => n.classList.contains('scene-roster')).map(n => [ n.dataset.pool,
    [ ...n.querySelectorAll('.scene-person') ].map(p => `${p.dataset.person}:${p.dataset.state}:${p.dataset.executions}`),
    [ ...n.querySelectorAll('.scene-queue-entry') ].map(q => q.dataset.id), n.dataset.queue ]).sort();
  const reloj = document.querySelector('.scene-clock');
  const estado = {
    t: barra.dataset.t,
    pelotas: de('scene-ball', [ 'case', 'element', 'state', 'zone', 'execution', 'user', 'request' ]),
    sobres: de('scene-envelope', [ 'id', 'sender', 'target' ]),
    insignias: de('scene-badge', [ 'element', 'zone', 'executions', 'cases', 'requests', 'color' ]),
    buzones: de('scene-mailbox', [ 'element', 'messages', 'color' ]),
    plantillas,
    reloj: reloj ? reloj.textContent : null
  };
  const dibujo = capa.map(n => {
    const { markId, ...datos } = n.dataset;
    return `${n.getAttribute('class')} ${JSON.stringify(datos)} ${n.getAttribute('transform')}`;
  }).sort();
  return { estado, dibujo, resumen: document.getElementById('replay-summary').innerText,
    reproduciendo: barra.dataset.playing === 'true', transito: capa.some(n => n.dataset.transit === 'true') };
};

// Lo que responde el Backend al simular un modelo: sus registros congelados.
// Tienen que ser del diagrama abierto, o no se pueden reproducir (6.8).
function respuestaDe(modelo) {
  const logs = registrosDe(modelo);
  return { simulationId: atributo(logs[0].xes, 'simulation:id'), seed: Number(atributo(logs[0].xes, 'simulation:seed')),
    model: { name: atributo(logs[0].xes, 'model:name') }, logs, warnings: [] };
}

async function abre(modelo) {
  const page = await navegador.newPage({ viewport: { width: 1600, height: 1000 } });
  page.incidencias = [];
  page.on('dialog', async dialogo => {
    page.incidencias.push(`ventana emergente: ${dialogo.message()}`);
    await dialogo.dismiss();
  });
  page.on('pageerror', error => page.incidencias.push(`error en la pagina: ${error.message.split('\n')[0]}`));
  page.on('console', m => { if (m.type() === 'error') page.incidencias.push(`error en la consola: ${m.text().split('\n')[0]}`); });
  const respuesta = respuestaDe(modelo);
  const cabeceras = { 'Access-Control-Allow-Origin': '*' };
  await page.route('http://localhost:3000/simulation-config', r => r.fulfill({ json: { timeoutSeconds: 300 }, headers: cabeceras }));
  await page.route('http://localhost:3000/simulate', r => r.fulfill({ json: respuesta, headers: cabeceras }));
  page.respuesta = respuesta;

  // El reloj de la pagina, quieto: solo avanza con runFor, en fotogramas de
  // 16 ms alineados, asi que reproducir 2 s a x1 avanza exactamente 2 s.
  await page.clock.install({ time: 0 });
  await page.goto(`${servidor.base}/modeler.html`);
  await page.evaluate(texto => sessionStorage.setItem('importedDiagram', texto), readFileSync(join(integracion, `${modelo}.bpmn`), 'utf8'));
  await page.reload();
  await page.waitForSelector('.djs-element.djs-shape');
  await page.clock.pauseAt(160000);
  page.antes = await page.evaluate(() => document.getElementById('js-replay').disabled);
  await page.click('#js-simulate');
  await page.waitForSelector('.modal-overlay', { state: 'visible' });
  await page.click('#close-modal');
  await page.click('#js-replay');
  await page.waitForSelector('#replay:not([hidden])');
  page.mira = () => page.evaluate(MIRA);
  page.salta = async t => {
    await page.fill('#replay-instant', String(t));
    await page.click('#replay-go');
    return page.mira();
  };
  page.velocidad = v => page.selectOption('#replay-speed', String(v));
  return page;
}

const diferencia = (a, b) => {
  for (const clave of Object.keys(a)) {
    if (comoTexto(a[clave]) !== comoTexto(b[clave])) return `${clave}: ${comoTexto(a[clave]).slice(0, 160)} y ${comoTexto(b[clave]).slice(0, 160)}`;
  }
  return null;
};

try {
  const page = await abre(MODELOS[0]);
  const linea = lineas.get(MODELOS[0]);

  // 4. Reproducir y saltar, en cada fotograma.
  {
    const problemas = [];
    if (!page.antes) problemas.push('Reproducir estaba activo antes de simular');
    const visibles = await page.evaluate(() => [ getComputedStyle(document.querySelector('.bottom-links')).display,
      document.getElementById('js-simulate').offsetParent !== null ]);
    if (visibles[0] !== 'none' || visibles[1]) problemas.push('los botones de simular siguen a la vista');
    await page.velocidad(5);
    const inicial = await page.mira();
    if (inicial.estado.t !== String(linea.start)) problemas.push(`empieza en ${inicial.estado.t}`);
    await page.click('#replay-play');
    const fotogramas = [];
    for (let i = 0; i < 200; i++) {
      await page.clock.runFor(160);
      const visto = await page.mira();
      fotogramas.push(visto);
      if (!visto.reproduciendo) break;
    }
    const ultimo = fotogramas[fotogramas.length - 1];
    if (ultimo.reproduciendo || ultimo.estado.t !== String(linea.end)) problemas.push(`no se para al final: ${ultimo.estado.t}`);
    const transito = fotogramas.filter(f => f.transito).length;
    if (!transito) problemas.push('ningun fotograma con transito: no se ha probado reproducir');
    for (const f of fotogramas) {
      const saltado = await page.salta(f.estado.t);
      const cual = diferencia(f.estado, saltado.estado);
      if (cual) problemas.push(`t=${f.estado.t}: ${cual}`);
    }
    informa('reproducir y saltar, en cada fotograma', problemas, `39 a x5: ${fotogramas.length} fotogramas hasta ${ultimo.estado.t} s ` +
      `(${transito} con transito), cada uno igual que saltar a su instante exacto`);
  }

  // Pausar es lo mismo que saltar, tambien donde esta cada marca; y que salir,
  // volver a entrar y saltar, sin nada dibujado antes.
  {
    const problemas = [];
    await page.salta(10);
    await page.velocidad(5);
    await page.click('#replay-play');
    await page.clock.runFor(3200);
    await page.click('#replay-play');
    const pausado = await page.mira();
    if (pausado.reproduciendo || pausado.estado.t !== '26') problemas.push(`pausado en ${pausado.estado.t}`);
    await page.salta(60);
    const saltado = await page.salta(pausado.estado.t);
    if (comoTexto(saltado) !== comoTexto(pausado)) problemas.push(`al saltar: ${diferencia(pausado.estado, saltado.estado) || 'otro dibujo'}`);
    await page.click('#replay-exit');
    await page.click('#js-replay');
    const otraVez = await page.salta(pausado.estado.t);
    if (comoTexto(otraVez.estado) !== comoTexto(pausado.estado) || comoTexto(otraVez.dibujo) !== comoTexto(pausado.dibujo)) {
      problemas.push(`al volver a entrar: ${diferencia(pausado.estado, otraVez.estado) || 'otro dibujo'}`);
    }
    informa('pausar, saltar y volver a entrar', problemas, `a los ${pausado.estado.t} s, el mismo dibujo, marca a marca`);
  }

  // Saltar mientras se reproduce: con el instante exacto, cambio siguiente, la
  // barra de tiempo y la velocidad, sigue desde ahi, exactamente.
  {
    const problemas = [];
    await page.salta(10);
    await page.velocidad(5);
    await page.click('#replay-play');
    await page.clock.runFor(160);
    const paso = async (que, accion, previsto) => {
      await accion();
      const justo = await page.mira();
      await page.clock.runFor(400);
      const despues = await page.mira();
      const velocidad = Number(await page.inputValue('#replay-speed'));
      const luego = Number(previsto) + velocidad * 0.4;
      if (justo.estado.t !== String(previsto) || Number(despues.estado.t) !== luego || !despues.reproduciendo) {
        problemas.push(`${que}: ${justo.estado.t} y luego ${despues.estado.t}, y se esperaba ${previsto} y ${luego}`);
      }
      return despues;
    };
    let visto = await paso('el instante exacto', async () => {
      await page.fill('#replay-instant', '30');
      await page.click('#replay-go');
    }, 30);
    const siguiente = player.nextChange(player.changesIn(linea, player.windowOf(linea, 1)), Number(visto.estado.t));
    visto = await paso('cambio siguiente', () => page.click('#replay-next'), siguiente);
    visto = await paso('la barra de tiempo', () => page.evaluate(() => {
      const barra = document.getElementById('replay-time');
      barra.value = '50';
      barra.dispatchEvent(new Event('input', { bubbles: true }));
    }), 50);
    const antes = Number(visto.estado.t);
    await page.velocidad(10);
    await page.clock.runFor(400);
    const rapido = await page.mira();
    if (Number(rapido.estado.t) !== antes + 4) problemas.push(`al pasar a x10 en ${antes}: ${rapido.estado.t}`);
    await page.click('#replay-play');

    // Ir sin haber escrito nada no mueve el instante, aunque el campo lo
    // muestre redondeado.
    await page.salta(21.9996);
    await page.focus('#replay-instant');
    await page.keyboard.press('Enter');
    await page.click('#replay-go');
    const quieto = await page.mira();
    if (quieto.estado.t !== '21.9996' || await page.inputValue('#replay-instant') !== '22') {
      problemas.push(`Ir sin escribir: ${quieto.estado.t}, el campo dice ${await page.inputValue('#replay-instant')}`);
    }
    informa('saltar mientras se reproduce', problemas, 'instante exacto, cambio siguiente y barra de tiempo, y sigue desde ' +
      'ahi; x10 desde donde iba; Ir sin escribir no mueve');
  }

  // 5. Eventos simultaneos y cancelaciones: reproduciendo a x1 exactamente
  // hasta su instante.
  {
    const problemas = [];
    const instantes = [ [ 22, 'la recogida cancela su espera de mas' ], [ 23, 'empieza la evaluacion' ],
      [ 37, 'Ana acaba el acta y toma una evaluacion' ], [ 49, 'Dani suelta una evaluacion y toma otra' ] ];
    await page.velocidad(1);
    for (const [ t ] of instantes) {
      await page.salta(t - 2);
      await page.click('#replay-play');
      await page.clock.runFor(2000);
      const reproducido = await page.mira();
      await page.click('#replay-play');
      const pausado = await page.mira();
      const saltado = await page.salta(t);
      await page.salta(t - 0.5);
      await page.click('#replay-next');
      const siguiente = await page.mira();
      if (reproducido.estado.t !== String(t) || pausado.estado.t !== String(t)) {
        problemas.push(`no llega a ${t}: ${reproducido.estado.t}, ${pausado.estado.t}`);
        continue;
      }
      const cual = diferencia(reproducido.estado, saltado.estado);
      if (cual) problemas.push(`t=${t}, reproduciendo: ${cual}`);
      if (comoTexto(pausado) !== comoTexto(saltado)) problemas.push(`t=${t}, en pausa: ${diferencia(pausado.estado, saltado.estado) || 'otro dibujo'}`);
      if (comoTexto(siguiente) !== comoTexto(saltado)) problemas.push(`t=${t}, con cambio siguiente: ${siguiente.estado.t}`);
    }

    // Lo que tiene que haber: a los 22 la espera cancelada no esta en ninguna
    // parte, y a los 23, cuatro evaluando y tres en la cola de la comision.
    const a22 = await page.salta(22);
    if (a22.estado.pelotas.some(p => p.startsWith('Pool_Comision - 1|Recoger|waiting-message'))) problemas.push('a los 22, la espera cancelada sigue');
    const a23 = await page.salta(23);
    const evaluan = a23.estado.pelotas.filter(p => p.includes('|Evaluar|working|')).length;
    const comision = a23.estado.plantillas.find(p => p[0] === 'Pool_Comision');
    if (evaluan !== 4 || comision[3] !== '3') problemas.push(`a los 23: ${evaluan} evaluando y ${comision[3]} en la cola`);
    informa('con simultaneos y cancelaciones', problemas, `39 a x1 hasta ${instantes.map(i => i[0]).join(', ')} s: ` +
      'igual que saltar y que llegar con cambio siguiente');
  }

  // 6. El filtro: oculta el resto, y no cambia ningun recuento.
  {
    const problemas = [];
    const todo = await page.salta(40);
    await page.fill('#replay-filters input[data-pool="Pool_Solicitante"]', '3, 5-6');
    const filtrado = await page.mira();
    const casos = new Set([ 'Pool_Comision - 1', 'Pool_Solicitante - 3', 'Pool_Solicitante - 5', 'Pool_Solicitante - 6' ]);
    const ajenas = filtrado.estado.pelotas.filter(p => !casos.has(p.split('|')[0]));
    const previstas = todo.estado.pelotas.filter(p => casos.has(p.split('|')[0]));
    if (ajenas.length || comoTexto(filtrado.estado.pelotas) !== comoTexto(previstas)) problemas.push(`pelotas: ${comoTexto(filtrado.estado.pelotas)}`);
    const sobres = todo.estado.sobres.filter(s => { const [ , de, a ] = s.split('|'); return casos.has(de) && casos.has(a); });
    if (comoTexto(filtrado.estado.sobres) !== comoTexto(sobres)) problemas.push(`sobres: ${comoTexto(filtrado.estado.sobres)}`);
    for (const clave of [ 'insignias', 'buzones', 'plantillas', 'reloj' ]) {
      if (comoTexto(filtrado.estado[clave]) !== comoTexto(todo.estado[clave])) problemas.push(`el filtro cambia ${clave}`);
    }
    const sinVer = texto => texto.replace(/ · se vee? \d+ de \d+/g, '').replace(/ · se ven \d+ de \d+/g, '');
    if (sinVer(filtrado.resumen) !== todo.resumen || !/Solicitante: .* · se ven 3 de 7/.test(filtrado.resumen)) {
      problemas.push(`resumen: «${filtrado.resumen}» y antes «${todo.resumen}»`);
    }
    if (todo.estado.pelotas.length === filtrado.estado.pelotas.length) problemas.push('el filtro no oculta nada');

    // Reproduciendo con el filtro, lo mismo que saltando.
    await page.velocidad(5);
    await page.click('#replay-play');
    await page.clock.runFor(1600);
    const reproduciendo = await page.mira();
    await page.click('#replay-play');
    const saltado = await page.salta(reproduciendo.estado.t);
    if (diferencia(reproduciendo.estado, saltado.estado)) problemas.push(`con filtro, a los ${reproduciendo.estado.t}: ${diferencia(reproduciendo.estado, saltado.estado)}`);

    // Uno que no se entiende: se marca, se explica y no filtra.
    await page.salta(40);
    await page.fill('#replay-filters input[data-pool="Pool_Solicitante"]', '3, x');
    const malo = await page.mira();
    const marcado = await page.getAttribute('#replay-filters input[data-pool="Pool_Solicitante"]', 'aria-invalid');
    if (marcado !== 'true' || !/Filtro de Solicitante: «x»/.test(malo.resumen) || comoTexto(malo.estado) !== comoTexto(todo.estado)) {
      problemas.push(`el filtro «3, x»: ${marcado}, «${malo.resumen}»`);
    }
    await page.fill('#replay-filters input[data-pool="Pool_Solicitante"]', '');
    const vacio = await page.mira();
    if (comoTexto(vacio.estado) !== comoTexto(todo.estado)) problemas.push('vacio no lo ve todo');
    informa('el filtro, sin cambiar recuentos', problemas, `39 a los 40 s, solicitantes «3, 5-6»: ${filtrado.estado.pelotas.length} de ` +
      `${todo.estado.pelotas.length} pelotas; insignias, buzones, plantillas y resumen, los mismos`);
  }

  // 8. El salto exacto y sus bordes; Salir; y otro diagrama cierra.
  {
    const problemas = [];
    const exacto = await page.salta(22.123456789);
    if (exacto.estado.t !== '22.123456789') problemas.push(`22.123456789 da ${exacto.estado.t}`);
    if ((await page.salta(1000)).estado.t !== String(linea.end)) problemas.push('por encima del final');
    if ((await page.salta(-5)).estado.t !== String(linea.start)) problemas.push('por debajo del principio');
    await page.fill('#replay-instant', '');
    await page.click('#replay-go');
    if (await page.getAttribute('#replay-instant', 'aria-invalid') !== 'true') problemas.push('vacio no se marca');
    await page.click('#replay-next');
    if (await page.getAttribute('#replay-instant', 'aria-invalid') !== 'false') problemas.push('vacio sigue marcado al saltar');

    // La barra no tapa ni la paleta ni el logotipo de bpmn.io, tampoco en una
    // pantalla de 1366 x 768, con la paleta en una columna larga.
    for (const [ ancho, alto ] of [ [ 1600, 1000 ], [ 1366, 768 ] ]) {
      await page.setViewportSize({ width: ancho, height: alto });
      await page.clock.runFor(160);
      const tapa = await page.evaluate(() => {
        const caja = selector => document.querySelector(selector).getBoundingClientRect();
        const barra = caja('#replay');
        const solapa = r => barra.left < r.right && r.left < barra.right && barra.top < r.bottom && r.top < barra.bottom;
        return [ '.djs-palette', '.bjs-powered-by' ].filter(s => document.querySelector(s) && solapa(caja(s)));
      });
      if (tapa.length) problemas.push(`a ${ancho} x ${alto}, la barra tapa ${tapa.join(' y ')}`);
    }
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.salta(40);
    await page.click('#replay-exit');
    if (await page.evaluate(() => document.activeElement && document.activeElement.id) !== 'js-replay') {
      problemas.push('al salir, el foco no vuelve a Reproducir');
    }
    const fuera = await page.evaluate(() => ({
      marcas: document.querySelectorAll('.layer-simulation-drawing > g').length,
      reloj: !!document.querySelector('.scene-clock'),
      barra: document.getElementById('replay').hidden,
      simular: document.getElementById('js-simulate').offsetParent !== null
    }));
    if (fuera.marcas || fuera.reloj || !fuera.barra || !fuera.simular) problemas.push(`al salir: ${comoTexto(fuera)}`);
    await page.click('#js-replay');
    await page.salta(40);
    await page.setInputFiles('#canvas input[type=file]', { name: 'otro.bpmn', mimeType: 'application/xml',
      buffer: readFileSync(join(integracion, '01-simple.bpmn')) });
    await page.waitForFunction(() => document.getElementById('replay').hidden);
    const otro = await page.evaluate(() => ({
      marcas: document.querySelectorAll('.layer-simulation-drawing > g').length,
      reloj: !!document.querySelector('.scene-clock'),
      reproducir: document.getElementById('js-replay').disabled
    }));
    if (otro.marcas || otro.reloj || !otro.reproducir) problemas.push(`con otro diagrama: ${comoTexto(otro)}`);

    // Mientras se simula, Reproducir esta desactivado; al acabar, se activa.
    // Se simula el 01, que es el abierto.
    let suelta;
    const pendiente = new Promise(resolve => {
      suelta = resolve;
    });
    await page.unroute('http://localhost:3000/simulate');
    await page.route('http://localhost:3000/simulate', async r => {
      await pendiente;
      await r.fulfill({ json: respuestaDe('01-simple'), headers: { 'Access-Control-Allow-Origin': '*' } });
    });
    await page.click('#js-simulate');
    await page.waitForFunction(() => document.getElementById('js-simulate').disabled);
    const simulando = await page.evaluate(() => document.getElementById('js-replay').disabled);
    suelta();
    await page.waitForSelector('.modal-overlay', { state: 'visible' });
    await page.click('#close-modal');
    const despues = await page.evaluate(() => document.getElementById('js-replay').disabled);
    if (!simulando || despues) problemas.push(`Reproducir, simulando: ${simulando ? 'desactivado' : 'activo'}; despues: ${despues ? 'desactivado' : 'activo'}`);
    informa('salto exacto, salir y otro diagrama', problemas, '22.123456789 sin redondear, bordes de la ventana, vacio; al salir y al ' +
      'abrir otro diagrama no queda nada dibujado, y hasta simular no se reproduce; sin tapar la paleta ni el logotipo');
  }

  // Abrir otro diagrama mientras el Backend simula: su respuesta es del que se
  // simulo, y no se puede reproducir sobre el que esta abierto. Con el 39
  // simulandose se abre el 01; al llegar la respuesta, Reproducir sigue
  // desactivado y el estado lo explica. Simulando el 01, vuelve a activarse.
  {
    const problemas = [];
    const abreFichero = async (modelo, forma) => {
      await page.setInputFiles('#canvas input[type=file]', { name: `${modelo}.bpmn`, mimeType: 'application/xml',
        buffer: readFileSync(join(integracion, `${modelo}.bpmn`)) });
      await page.waitForSelector(`.djs-element[data-element-id="${forma}"]`);
    };
    await abreFichero(MODELOS[0], 'Pool_Comision');
    let suelta;
    const pendiente = new Promise(resolve => {
      suelta = resolve;
    });
    await page.unroute('http://localhost:3000/simulate');
    await page.route('http://localhost:3000/simulate', async r => {
      await pendiente;
      await r.fulfill({ json: page.respuesta, headers: { 'Access-Control-Allow-Origin': '*' } });
    });
    await page.click('#js-simulate');
    await page.waitForFunction(() => document.getElementById('js-simulate').disabled);
    await abreFichero('01-simple', 'Preparar');
    suelta();
    await page.waitForSelector('.modal-overlay', { state: 'visible' });
    await page.click('#close-modal');
    await page.evaluate(() => document.getElementById('js-replay').click());
    const tras = await page.evaluate(() => ({ desactivado: document.getElementById('js-replay').disabled,
      barra: !document.getElementById('replay').hidden, marcas: document.querySelectorAll('.layer-simulation-drawing > g').length,
      estado: document.getElementById('simulation-status').textContent }));
    if (!tras.desactivado || tras.barra || tras.marcas) problemas.push(`con el 01 abierto: ${comoTexto(tras)}`);
    if (!/se abrió otro diagrama/.test(tras.estado)) problemas.push(`el estado no lo dice: «${tras.estado}»`);
    if (tras.barra) await page.click('#replay-exit');
    await page.unroute('http://localhost:3000/simulate');
    await page.route('http://localhost:3000/simulate', r => r.fulfill({ json: respuestaDe('01-simple'), headers: { 'Access-Control-Allow-Origin': '*' } }));
    await page.click('#js-simulate');
    await page.waitForSelector('.modal-overlay', { state: 'visible' });
    await page.click('#close-modal');
    if (await page.evaluate(() => document.getElementById('js-replay').disabled)) problemas.push('simulando el abierto, sigue desactivado');
    informa('otro diagrama mientras se simula', problemas, 'el 39 simulandose y el 01 abierto: Reproducir desactivado y el estado ' +
      'lo explica; simulando el 01, se activa');
  }
  informa('sin errores ni ventanas (39)', page.incidencias, 'ninguno');
  await page.close();

  // 7. Las convocatorias del 31.
  {
    const de31 = await abre(MODELOS[1]);
    const linea31 = lineas.get(MODELOS[1]);
    const problemas = [];
    const opciones = await de31.evaluate(() => [ ...document.querySelectorAll('#replay-call option') ].map(o => [ o.value, o.textContent ]));
    if (comoTexto(opciones.map(o => o[0])) !== comoTexto([ '1', '2', '3', '' ])) problemas.push(`opciones ${comoTexto(opciones)}`);
    const rango = () => de31.evaluate(() => [ 'min', 'max' ].map(a => document.getElementById('replay-time').getAttribute(a)));
    if (comoTexto(await rango()) !== comoTexto([ '0', '88' ])) problemas.push(`la primera, ${comoTexto(await rango())}`);
    await de31.selectOption('#replay-call', '2');
    const segunda = await de31.mira();
    if (comoTexto(await rango()) !== comoTexto([ '88', '151' ]) || segunda.estado.t !== '88') problemas.push(`la segunda: ${comoTexto(await rango())}, t=${segunda.estado.t}`);
    const suyos = new Set(linea31.cases.filter(c => c.call === 2).map(c => c.id));
    let vistas = 0;
    for (const t of linea31.changes().filter(t => t >= 88 && t <= 151)) {
      const visto = await de31.salta(t);
      vistas += visto.estado.pelotas.length;
      const ajenas = visto.estado.pelotas.filter(p => !suyos.has(p.split('|')[0]));
      if (ajenas.length) problemas.push(`t=${t}: pelotas de otra convocatoria, ${ajenas[0]}`);
    }
    if (!vistas) problemas.push('en la segunda no se ve ninguna pelota');
    const a120 = await de31.salta(120);
    // En el orden de los pools de la simulacion, y con sus resultados si los hay.
    const orden = atributo(registrosDe(MODELOS[1])[0].xes, 'simulation:participants').split(', ');
    const previsto = player.summaryAt(linea31, 120, player.windowOf(linea31, 2))
      .sort((x, y) => orden.indexOf(x.pool) - orden.indexOf(y.pool))
      .map(r => `${r.name}: ${r.active} en curso · ${r.pending} por llegar · ${r.finished} ${r.finished === 1 ? 'terminado' : 'terminados'}` +
        (r.results.length ? ` · fin: ${r.results.map(x => `${x.name} ${x.count}`).join(', ')}` : '')).join('\n');
    if (a120.resumen !== previsto) problemas.push(`resumen «${a120.resumen}», y se esperaba «${previsto}»`);
    if ((await de31.salta(10)).estado.t !== '88') problemas.push('se sale de la ventana de la segunda');
    await de31.selectOption('#replay-call', '');
    if (comoTexto(await rango()) !== comoTexto([ '0', '217' ])) problemas.push(`todas, ${comoTexto(await rango())}`);
    informa('la convocatoria', problemas, `31: ${opciones.map(o => o[1]).join(', ')}; en la segunda, solo sus casos y su resumen`);
    problemas.length = 0;

    // La convocatoria es el alcance, tambien de la plantilla y de la cola: en
    // los bordes del 31, a los 88 y a los 151 s, cada una solo con lo suyo,
    // contrastado con la plantilla de toda la simulacion quedandose con sus
    // casos. Con todas, a los 88 s Ana ya trabaja para el orquestador 2. Y el
    // filtro, dentro de la segunda, conserva sus recuentos.
    const plantilla = createStaff(linea31);
    const suPlantilla = (casos, t) => Object.entries(plantilla.at(t)).map(([ pool, p ]) => [ pool,
      p.people.map(x => { const w = x.work.filter(a => casos.has(a.case)); return `${x.name}:${w.length ? 'busy' : 'free'}:${w.map(a => a.id).join('|')}`; }),
      p.queue.filter(q => casos.has(q.case)).map(q => q.id), String(p.queue.filter(q => casos.has(q.case)).length) ]).sort();
    const bordes = [ [ '1', 88 ], [ '2', 88 ], [ '2', 151 ], [ '3', 151 ], [ '', 88 ] ];
    const vistos = [];
    for (const [ call, t ] of bordes) {
      await de31.selectOption('#replay-call', call);
      const visto = await de31.salta(t);
      const casos = call === '' ? new Set(linea31.cases.map(c => c.id)) : player.windowOf(linea31, Number(call)).cases;
      if (comoTexto(visto.estado.plantillas) !== comoTexto(suPlantilla(casos, t))) {
        problemas.push(`convocatoria ${call || 'todas'} a los ${t} s: ${comoTexto(visto.estado.plantillas)}`);
      }
      const ajenas = visto.estado.pelotas.filter(p => !casos.has(p.split('|')[0]));
      if (ajenas.length) problemas.push(`convocatoria ${call || 'todas'} a los ${t} s: pelotas ajenas, ${ajenas[0]}`);
      const orquestador = visto.estado.plantillas.find(p => p[0] === 'Pool_Orquestador');
      vistos.push(`${call || 'todas'} a los ${t} s, ${orquestador[1].filter(x => x.includes(':busy:')).length} ocupada y ` +
        `${orquestador[3]} en cola`);
    }
    await de31.selectOption('#replay-call', '1');
    const fin1 = await de31.salta(88);
    if (!/Orquestador: 0 en curso · 0 por llegar · 1 terminado\b/.test(fin1.resumen) ||
      fin1.estado.plantillas.some(p => p[1].some(x => x.includes(':busy:')) || p[3] !== '0')) {
      problemas.push(`al final de la primera: «${fin1.resumen}», ${comoTexto(fin1.estado.plantillas)}`);
    }

    // El filtro, dentro de la segunda, conserva sus recuentos.
    await de31.selectOption('#replay-call', '2');
    const sinFiltro = await de31.salta(120);
    await de31.fill('#replay-filters input[data-pool="Pool_Orquestado"]', '5');
    const conFiltro = await de31.mira();
    for (const clave of [ 'insignias', 'buzones', 'plantillas' ]) {
      if (comoTexto(conFiltro.estado[clave]) !== comoTexto(sinFiltro.estado[clave])) problemas.push(`el filtro cambia ${clave} en la segunda`);
    }
    if (conFiltro.resumen.replace(/ · se ven? \d+ de \d+/g, '') !== sinFiltro.resumen || !/se ve 1 de 3/.test(conFiltro.resumen)) {
      problemas.push(`resumen con filtro: «${conFiltro.resumen}»`);
    }
    await de31.fill('#replay-filters input[data-pool="Pool_Orquestado"]', '');
    informa('la convocatoria, como alcance', problemas, `31: ${vistos.join('; ')}; el filtro, en la segunda, con sus recuentos`);
    informa('sin errores ni ventanas (31)', de31.incidencias, 'ninguno');
    await de31.close();
  }

  // 6, con insignias y buzon: en el 14, con 50 orquestados, a los 18 s -el
  // buzon de Esperar_Convocatoria, «× 36»- y a los 746 -las insignias de
  // Responder y de Esperar_Resultado-, el filtro «1-3» deja las insignias y el
  // buzon como estaban.
  {
    const de14 = await abre(MODELOS[2]);
    const problemas = [];
    const vistos = [];

    // Reproducir y saltar, tambien con el buzon lleno y las insignias: de 10 a
    // 30 s y de 736 a 756, a x5.
    let fotogramas = 0;
    await de14.velocidad(5);
    for (const desde of [ 10, 736 ]) {
      await de14.salta(desde);
      await de14.click('#replay-play');
      const grabados = [];
      for (let i = 0; i < 25; i++) {
        await de14.clock.runFor(160);
        grabados.push(await de14.mira());
      }
      await de14.click('#replay-play');
      fotogramas += grabados.length;
      for (const f of grabados) {
        const cual = diferencia(f.estado, (await de14.salta(f.estado.t)).estado);
        if (cual) problemas.push(`reproduciendo, t=${f.estado.t}: ${cual}`);
      }
    }
    for (const t of [ 18, 746 ]) {
      await de14.fill('#replay-filters input[data-pool="Pool_Orquestado"]', '');
      const todo = await de14.salta(t);
      await de14.fill('#replay-filters input[data-pool="Pool_Orquestado"]', '1-3');
      const filtrado = await de14.mira();
      vistos.push(`${t} s: ${todo.estado.insignias.length} insignias y ${todo.estado.buzones.length} buzones`);
      if (!todo.estado.insignias.length && !todo.estado.buzones.length) problemas.push(`a los ${t} s no hay ni insignias ni buzones`);
      for (const clave of [ 'insignias', 'buzones', 'plantillas' ]) {
        if (comoTexto(filtrado.estado[clave]) !== comoTexto(todo.estado[clave])) problemas.push(`a los ${t} s, el filtro cambia ${clave}`);
      }
      const ajenas = filtrado.estado.pelotas.filter(p => /^Pool_Orquestado - /.test(p) && !/^Pool_Orquestado - [123]\|/.test(p));
      if (ajenas.length) problemas.push(`a los ${t} s, pelotas que no se tenian que ver: ${ajenas[0]}`);
    }
    informa('el 14: reproducir, saltar y filtrar', problemas, `${fotogramas} fotogramas igual que saltar; con «1-3»: ` +
      `${vistos.join('; ')}, las mismas`);
    informa('sin errores ni ventanas (14)', de14.incidencias, 'ninguno');
    await de14.close();
  }
} finally {
  await navegador.close();
  servidor.cierra();
  rmSync(dist, { recursive: true, force: true });
}

console.log(fallos ? `\nReproduccion en rojo: ${fallos} problema(s).` : `\nReproduccion en verde: ${carpetas.length} modelos.`);
process.exit(fallos ? 1 : 0);
