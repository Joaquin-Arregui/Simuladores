// La capa de dibujo del visualizador (6.2), en un Chromium de verdad.
//
//     node pruebas/capa_de_dibujo.mjs
//
// Abre el proceso base de Modeler/ejemplos/ en el bpmn-js de las dependencias
// del Modeler, con Modeler/lib/drawing, le pone marcas -en el centro de una
// tarea, de un evento y de una compuerta, en la esquina de otra tarea, a mitad
// de un flujo y a un cuarto de un flujo de mensaje- y comprueba que cada una
// esta donde tiene que estar EN LA PANTALLA: en el ancla de la forma que pinta
// bpmn-js para su elemento, y la de un flujo, sobre el trazo que pinta bpmn-js y
// en el punto de su recorrido que da el propio navegador con getPointAtLength,
// no la cuenta de la capa. bpmn-js redondea los codos de un flujo (radio 5), lo
// que acorta el trazo: con codos, el punto puede quedar hasta 5 unidades del
// diagrama por codo de donde lo pone el navegador, pero siempre sobre el trazo.
// Lo comprueba:
//
// 1. Al abrir el diagrama.
// 2. Al arrastrar el diagrama con el raton y al desplazarlo con la rueda.
// 3. Al ampliarlo y al reducirlo con Ctrl y la rueda, y al encajarlo en la
//    ventana.
// 4. Al mover una tarea con el raton: su marca la sigue, y la del flujo que
//    sale de ella se coloca en su nuevo trazo.
// 5. Con un clic sobre una marca, que selecciona el elemento de debajo: las
//    marcas no capturan el raton.
// 6. Al borrar un elemento, su marca se oculta, y al deshacer vuelve a su sitio.
// 7. Al cambiar el ID de una tarea, su marca se oculta, porque las marcas van
//    por ID y ese ya no existe; sigue oculta al mover la tarea con el raton, al
//    borrarla y al deshacer el borrado y el movimiento, y al deshacer el cambio
//    de ID vuelve a su sitio. Rehacerlo la oculta otra vez. El ID se cambia con
//    el mismo comando que usa el campo ID del panel General.
// 8. Al abrir otro diagrama, no queda ninguna marca.
//
// Para ver que la comprobacion distingue, se saca la capa del grupo viewport,
// como si las marcas se dibujaran encima del lienzo y no en el: al ampliar, ya
// no siguen a su elemento, y lo tiene que decir.
//
// Antes, sin navegador, la geometria: las anclas de una caja y el punto a una
// fraccion de un recorrido, con sus casos raros.
//
// Necesita, en Modeler/, `npm install` y `npx playwright install chromium`; con
// un Chromium ya instalado se puede usar ese: CHROMIUM_PATH=<ejecutable>.
import { createRequire } from 'module';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

import { abreChromium, sirve } from './navegador.mjs';

const aqui = dirname(fileURLToPath(import.meta.url));
const modeler = join(aqui, '..', '..', 'Modeler');
const require = createRequire(join(modeler, 'package.json'));
const EJEMPLO = join(modeler, 'ejemplos', 'proceso-base.bpmn');
const CAPA = join(modeler, 'lib', 'drawing', 'drawing.js');
const BPMN_JS = join(dirname(require.resolve('bpmn-js/package.json')), 'dist');

function sale(mensaje) {
  console.log(mensaje);
  process.exit(1);
}
for (const ruta of [ EJEMPLO, CAPA, join(BPMN_JS, 'bpmn-modeler.development.js') ]) {
  if (!existsSync(ruta)) sale(`Falta ${ruta}: npm install en Modeler/.`);
}

let fallos = 0;
function informa(que, problemas, detalle) {
  if (problemas.length) {
    fallos += 1;
    console.log(`${que.padEnd(44)} FALLA`);
    for (const p of problemas.slice(0, 8)) console.log(`         ${p}`);
  } else {
    console.log(`${que.padEnd(44)} ok      ${detalle}`);
  }
}

// --- La geometria, sin navegador ---------------------------------------------

const { anchorOf, pointAlong } = await import(pathToFileURL(CAPA).href);
const cerca = (a, b) => a && b && Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9 &&
  (b.angle === undefined || Math.abs(a.angle - b.angle) < 1e-9);
const caja = { x: 10, y: 20, width: 100, height: 80 };
const ruta = [ { x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 40 } ]; // 30 + 0 + 40 = 70
const GEOMETRIA = [
  [ 'centro', anchorOf(caja), { x: 60, y: 60 } ],
  [ 'esquina de abajo a la izquierda', anchorOf(caja, 'bottom-left'), { x: 10, y: 100 } ],
  [ 'derecha', anchorOf(caja, 'right'), { x: 110, y: 60 } ],
  [ 'principio del recorrido', pointAlong(ruta, 0), { x: 0, y: 0, angle: 0 } ],
  [ 'a mitad del primer tramo', pointAlong(ruta, 15 / 70), { x: 15, y: 0, angle: 0 } ],
  [ 'en el codo', pointAlong(ruta, 30 / 70), { x: 30, y: 0, angle: 0 } ],
  [ 'a mitad del recorrido, ya en el segundo tramo', pointAlong(ruta, 0.5), { x: 30, y: 5, angle: 90 } ],
  [ 'final del recorrido', pointAlong(ruta, 1), { x: 30, y: 40, angle: 90 } ],
  [ 'fraccion por debajo de 0', pointAlong(ruta, -2), { x: 0, y: 0, angle: 0 } ],
  [ 'fraccion por encima de 1', pointAlong(ruta, 7), { x: 30, y: 40, angle: 90 } ],
  [ 'fraccion que no es un numero', pointAlong(ruta, NaN), { x: 0, y: 0, angle: 0 } ],
  [ 'recorrido de un solo punto', pointAlong([ { x: 5, y: 6 } ], 0.5), { x: 5, y: 6, angle: 0 } ],
  [ 'recorrido de longitud cero', pointAlong([ { x: 5, y: 6 }, { x: 5, y: 6 } ], 0.5), { x: 5, y: 6, angle: 0 } ],
  [ 'hacia atras y hacia arriba', pointAlong([ { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 0, y: 0 } ], 0.75), { x: 0, y: 5, angle: -90 } ]
];
const mal = GEOMETRIA.filter(([ , obtenido, esperado ]) => !cerca(obtenido, esperado))
  .map(([ que, obtenido, esperado ]) => `${que}: ${JSON.stringify(obtenido)}, y tenia que ser ${JSON.stringify(esperado)}`);
if (pointAlong([], 0.5) !== null) mal.push('un recorrido vacio tenia que dar null');
let ancla;
try {
  anchorOf(caja, 'arriba');
} catch (error) {
  ancla = error;
}
if (!ancla) mal.push('un ancla desconocida tenia que dar error');
informa('geometria', mal, `${GEOMETRIA.length + 2} casos: anclas, tramos, codos y recorridos raros`);

// --- En el navegador ----------------------------------------------------------

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
  import capa from '/lib/drawing/drawing.js';
  window.monta = async xml => {
    window.modeler = new window.BpmnJS({ container: '#lienzo', additionalModules: [ capa ], keyboard: { bindTo: document } });
    await window.modeler.importXML(xml);
  };
  window.lista = true;
</script></body></html>`;

const servidor = await sirve([ [ '/bpmn-js/', BPMN_JS ], [ '/lib/', join(modeler, 'lib') ] ],
  { '/prueba.html': PRUEBA, '/favicon.ico': '' });
let navegador;
try {
  navegador = await abreChromium(chromium);
} catch (error) {
  servidor.cierra();
  sale(error.message);
}

// Las marcas que se ponen: [nombre, elemento, opciones].
const MARCAS = [
  [ 'tarea', 'Evaluar_Propuestas', {} ],
  [ 'evento', 'Ini_S', {} ],
  [ 'compuerta', 'Aceptada', {} ],
  [ 'esquina', 'Publicar_Convocatoria', { anchor: 'top-left' } ],
  [ 'flujo', 's4', { fraction: 0.5 } ],
  [ 'mensaje', 'Solicitud', { fraction: 0.25 } ]
];
const TOLERANCIA = 0.05; // pixeles
const RADIO_DE_LOS_CODOS = 5; // el de bpmn-js, en unidades del diagrama

try {
  const page = await navegador.newPage({ viewport: { width: 1400, height: 900 } });
  const incidencias = [];
  page.on('pageerror', error => incidencias.push(`error en la pagina: ${error.message.split('\n')[0]}`));
  page.on('console', m => { if (m.type() === 'error') incidencias.push(`error en la consola: ${m.text().split('\n')[0]}`); });
  page.on('dialog', async d => { incidencias.push(`ventana emergente: ${d.message()}`); await d.dismiss(); });
  await page.goto(`${servidor.base}/prueba.html`);
  await page.waitForFunction(() => window.lista && window.BpmnJS);
  const xml = readFileSync(EJEMPLO, 'utf8');
  await page.evaluate(texto => window.monta(texto), xml);
  await page.evaluate(marcas => {
    const capa = window.modeler.get('drawingLayer');
    window.marcas = Object.fromEntries(marcas.map(([ nombre, elemento, opciones ]) => [ nombre, capa.addMark(elemento, opciones) ]));
  }, MARCAS);

  // Donde estan en la pantalla las marcas y donde tendrian que estar, segun lo
  // que pinta bpmn-js para cada elemento.
  const ANCLAS = { center: [ 0.5, 0.5 ], 'top-left': [ 0, 0 ] };
  const mide = () => page.evaluate(([ marcas, anclas, radio ]) => {
    const centro = nodo => {
      const r = nodo.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    };
    const zoom = window.modeler.get('canvas').zoom();
    return marcas.map(([ nombre, elemento, opciones ]) => {
      const marca = window.marcas[nombre];
      const visible = marca.node.getAttribute('visibility') !== 'hidden';
      const real = visible ? centro(marca.node) : null;
      const gfx = document.querySelector(`.djs-element[data-element-id="${elemento}"] > .djs-visual`);
      if (!gfx) return { nombre, visible, esperado: null, real };
      if (opciones.fraction === undefined) {
        const r = gfx.firstElementChild.getBoundingClientRect();
        const [ fx, fy ] = anclas[opciones.anchor || 'center'];
        return { nombre, visible, real, esperado: { x: r.left + r.width * fx, y: r.top + r.height * fy }, margen: 0 };
      }
      // Un flujo: el punto de su trazo a esa fraccion, y lo cerca que queda la
      // marca del trazo entero.
      const trazo = gfx.querySelector(':scope > path');
      const largo = trazo.getTotalLength();
      const enPantalla = d => trazo.getPointAtLength(d).matrixTransform(trazo.getScreenCTM());
      const p = enPantalla(largo * opciones.fraction);
      let alTrazo = Infinity;
      for (let i = 0; i <= 4000 && real; i++) {
        const q = enPantalla(largo * i / 4000);
        alTrazo = Math.min(alTrazo, Math.hypot(q.x - real.x, q.y - real.y));
      }
      const codos = window.modeler.get('elementRegistry').get(elemento).waypoints.length - 2;
      return { nombre, visible, real, esperado: { x: p.x, y: p.y }, alTrazo, margen: codos * radio * zoom };
    });
  }, [ MARCAS, ANCLAS, RADIO_DE_LOS_CODOS ]);
  const desviaciones = medidas => medidas.flatMap(m => {
    if (!m.visible || !m.esperado) return [ `${m.nombre}: ${m.visible ? 'su elemento no esta' : 'oculta'}` ];
    const lejos = Math.hypot(m.real.x - m.esperado.x, m.real.y - m.esperado.y);
    const problemas = [];
    if (lejos > TOLERANCIA + m.margen) {
      problemas.push(`${m.nombre}: esta en ${JSON.stringify(m.real)} y tenia que estar en ${JSON.stringify(m.esperado)}`);
    }
    if (m.alTrazo !== undefined && m.alTrazo > 0.5) problemas.push(`${m.nombre}: queda a ${m.alTrazo.toFixed(2)} px de su trazo`);
    return problemas;
  });
  const vista = () => page.evaluate(() => {
    const c = window.modeler.get('canvas');
    const v = c.viewbox();
    return { zoom: c.zoom(), x: v.x, y: v.y };
  });
  // Un punto vacio del lienzo, en la pantalla: debajo de los dos pools.
  const vacio = () => page.evaluate(() => {
    const v = window.modeler.get('canvas').viewbox();
    return { x: (900 - v.x) * v.scale, y: (820 - v.y) * v.scale };
  });
  const comprueba = async (que, detalle) => informa(que, desviaciones(await mide()), detalle);

  await comprueba('al abrir', `${MARCAS.length} marcas en su sitio`);

  let antes = await vista();
  let p = await vacio();
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x - 140, p.y - 90, { steps: 8 });
  await page.mouse.up();
  let ahora = await vista();
  const arrastrado = ahora.x !== antes.x && ahora.y !== antes.y;
  informa('al arrastrar el diagrama', [ ...(arrastrado ? [] : [ 'el diagrama no se ha movido' ]), ...desviaciones(await mide()) ],
    `vista de (${antes.x}, ${antes.y}) a (${ahora.x}, ${ahora.y})`);

  antes = ahora;
  await page.mouse.move(700, 450);
  await page.mouse.wheel(60, 120);
  await page.waitForTimeout(150);
  ahora = await vista();
  informa('al desplazarlo con la rueda', [ ...(ahora.y !== antes.y ? [] : [ 'la rueda no lo ha desplazado' ]), ...desviaciones(await mide()) ],
    `vista de (${antes.x}, ${antes.y}) a (${ahora.x}, ${ahora.y})`);

  // Cada vuelta de la rueda es un paso de zoom, sea del tamano que sea: cinco
  // para ampliar, y diez para reducir hasta por debajo de 1.
  for (const [ que, delta, mas, vueltas ] of [ [ 'al ampliarlo', -300, true, 5 ], [ 'al reducirlo', 300, false, 10 ] ]) {
    antes = ahora;
    await page.mouse.move(650, 380);
    await page.keyboard.down('Control');
    for (let i = 0; i < vueltas; i++) {
      await page.mouse.wheel(0, delta);
      await page.waitForTimeout(60);
    }
    await page.keyboard.up('Control');
    await page.waitForTimeout(150);
    ahora = await vista();
    const bien = mas ? ahora.zoom > antes.zoom : ahora.zoom < 1 && ahora.zoom < antes.zoom;
    informa(`${que} con Ctrl y la rueda`, [ ...(bien ? [] : [ `el zoom ha ido de ${antes.zoom} a ${ahora.zoom}` ]), ...desviaciones(await mide()) ],
      `zoom de ${antes.zoom.toFixed(2)} a ${ahora.zoom.toFixed(2)}`);
  }

  // Para mover y pulsar elementos tienen que estar en la ventana: el diagrama
  // entero, encajado en ella.
  antes = ahora;
  await page.evaluate(() => window.modeler.get('canvas').zoom('fit-viewport'));
  ahora = await vista();
  informa('al encajarlo en la ventana', desviaciones(await mide()), `zoom de ${antes.zoom.toFixed(2)} a ${ahora.zoom.toFixed(2)}`);

  // Mover la tarea con el raton: se arrastra desde su centro, justo debajo de
  // su marca, que no captura el raton.
  const tarea = () => page.evaluate(() => {
    const e = window.modeler.get('elementRegistry').get('Evaluar_Propuestas');
    return { x: e.x, y: e.y };
  });
  const sitioDeLaTarea = await tarea();
  const marcaTarea = (await mide()).find(m => m.nombre === 'tarea').real;
  await page.mouse.move(marcaTarea.x, marcaTarea.y);
  await page.mouse.down();
  await page.mouse.move(marcaTarea.x + 25, marcaTarea.y + 12, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(100);
  const sitioNuevo = await tarea();
  const movida = sitioNuevo.x !== sitioDeLaTarea.x && sitioNuevo.y !== sitioDeLaTarea.y;
  const trasMover = await mide();
  const flujo = trasMover.find(m => m.nombre === 'flujo');
  const codos = await page.evaluate(() => window.modeler.get('elementRegistry').get('s4').waypoints.length - 2);
  informa('al mover la tarea con el raton', [ ...(movida ? [] : [ 'la tarea no se ha movido' ]), ...desviaciones(trasMover) ],
    `de (${sitioDeLaTarea.x}, ${sitioDeLaTarea.y}) a (${sitioNuevo.x}, ${sitioNuevo.y}); la de s4, con ${codos} codos, ` +
    `a ${flujo.alTrazo.toFixed(2)} px de su trazo y a ` +
    `${Math.hypot(flujo.real.x - flujo.esperado.x, flujo.real.y - flujo.esperado.y).toFixed(2)} px de su mitad`);

  // Un clic sobre la marca del evento selecciona el evento. diagram-js se traga
  // el primer clic despues de arrastrar: ese, en un sitio vacio.
  p = await vacio();
  await page.mouse.click(p.x, p.y);
  const marcaEvento = (await mide()).find(m => m.nombre === 'evento').real;
  await page.mouse.click(marcaEvento.x, marcaEvento.y);
  const seleccion = await page.evaluate(() => window.modeler.get('selection').get().map(e => e.id));
  informa('un clic sobre una marca', JSON.stringify(seleccion) === JSON.stringify([ 'Ini_S' ]) ? [] : [ `selecciona ${JSON.stringify(seleccion)}` ],
    'selecciona el elemento de debajo');

  // Borrar la compuerta con la tecla Supr y deshacer con Ctrl+Z.
  await page.evaluate(() => window.modeler.get('selection').select(window.modeler.get('elementRegistry').get('Aceptada')));
  await page.keyboard.press('Delete');
  const tras = (await mide()).find(m => m.nombre === 'compuerta');
  const borrada = await page.evaluate(() => !window.modeler.get('elementRegistry').get('Aceptada'));
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(100);
  const vuelta = await page.evaluate(() => !!window.modeler.get('elementRegistry').get('Aceptada'));
  informa('al borrar y deshacer', [
    ...(borrada ? [] : [ 'Supr no ha borrado la compuerta' ]),
    ...(tras.visible ? [ 'la marca sigue visible sin su elemento' ] : []),
    ...(vuelta ? [] : [ 'Ctrl+Z no ha devuelto la compuerta' ]),
    ...desviaciones(await mide())
  ], 'se oculta sin su elemento y vuelve a su sitio con el');

  // Cambiar el ID de la tarea, moverla, borrarla y deshacerlo todo.
  const estadoDeLaTarea = () => page.evaluate(() => {
    const e = window.modeler.get('elementRegistry').get('Evaluar_Propuestas') ||
      window.modeler.get('elementRegistry').get('Evaluar_Renombrada');
    return { visible: window.marcas.tarea.node.getAttribute('visibility') !== 'hidden', id: e && e.id,
      sitio: e && { x: e.x, y: e.y } };
  });
  const inicial = await estadoDeLaTarea();
  const pasos = [];
  const anota = async que => pasos.push([ que, await estadoDeLaTarea() ]);
  await page.evaluate(() => {
    const m = window.modeler;
    m.get('modeling').updateProperties(m.get('elementRegistry').get('Evaluar_Propuestas'), { id: 'Evaluar_Renombrada' });
  });
  await anota('renombrada');
  const renombrada = await page.evaluate(() => {
    const r = document.querySelector('.djs-element[data-element-id="Evaluar_Renombrada"] > .djs-visual').firstElementChild
      .getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.move(renombrada.x, renombrada.y);
  await page.mouse.down();
  await page.mouse.move(renombrada.x + 20, renombrada.y + 10, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(100);
  await anota('movida');
  await page.evaluate(() => window.modeler.get('selection').select(window.modeler.get('elementRegistry').get('Evaluar_Renombrada')));
  await page.keyboard.press('Delete');
  await anota('borrada');
  for (const que of [ 'deshecho el borrado', 'deshecho el movimiento', 'deshecho el cambio de ID' ]) {
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(100);
    await anota(que);
  }
  const vueltaASuSitio = desviaciones(await mide());
  await page.keyboard.press('Control+y');
  await page.waitForTimeout(100);
  await anota('rehecho el cambio de ID');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(100);
  await anota('deshecho otra vez');
  const PREVISTO = [
    [ 'renombrada', false, 'Evaluar_Renombrada' ], [ 'movida', false, 'Evaluar_Renombrada' ], [ 'borrada', false, undefined ],
    [ 'deshecho el borrado', false, 'Evaluar_Renombrada' ], [ 'deshecho el movimiento', false, 'Evaluar_Renombrada' ],
    [ 'deshecho el cambio de ID', true, 'Evaluar_Propuestas' ], [ 'rehecho el cambio de ID', false, 'Evaluar_Renombrada' ],
    [ 'deshecho otra vez', true, 'Evaluar_Propuestas' ]
  ];
  const renombrado = pasos.flatMap(([ que, estado ], i) => {
    const [ , visible, id ] = PREVISTO[i];
    const mal = [];
    if (estado.id !== id) mal.push(`${que}: la tarea tiene el ID ${estado.id}, y tenia que ser ${id}`);
    if (estado.visible !== visible) mal.push(`${que}: la marca esta ${estado.visible ? 'visible' : 'oculta'}`);
    return mal;
  });
  const movidaDeVerdad = pasos[1][1].sitio && (pasos[1][1].sitio.x !== inicial.sitio.x || pasos[1][1].sitio.y !== inicial.sitio.y);
  if (!movidaDeVerdad) renombrado.push('el raton no ha movido la tarea renombrada');
  if (JSON.stringify(pasos[5][1].sitio) !== JSON.stringify(inicial.sitio)) {
    renombrado.push(`deshecho todo, la tarea esta en ${JSON.stringify(pasos[5][1].sitio)} y no en ${JSON.stringify(inicial.sitio)}`);
  }
  renombrado.push(...vueltaASuSitio.map(d => `deshecho todo: ${d}`), ...desviaciones(await mide()).map(d => `al final: ${d}`));
  informa('al cambiar el ID, mover, borrar y deshacer', renombrado,
    'oculta mientras su ID no existe; vuelve a su sitio al deshacer el cambio de ID');

  // El control: la capa fuera del viewport no sigue al diagrama.
  await page.evaluate(() => {
    const capa = document.querySelector('.layer-simulation-drawing');
    window.sitioDeLaCapa = [ capa.parentNode, capa.nextSibling ];
    capa.ownerSVGElement.appendChild(capa);
    const canvas = window.modeler.get('canvas');
    canvas.zoom(canvas.zoom() * 1.5);
  });
  const fuera = new Set(desviaciones(await mide()).map(d => d.split(':')[0]));
  await page.evaluate(() => {
    const [ padre, siguiente ] = window.sitioDeLaCapa;
    padre.insertBefore(document.querySelector('.layer-simulation-drawing'), siguiente);
  });
  const dentro = desviaciones(await mide());
  informa('una capa fuera del lienzo, se nota', [
    ...(fuera.size === MARCAS.length ? [] : [ `solo se notan ${fuera.size} de ${MARCAS.length} marcas despegadas` ]),
    ...dentro.map(d => `de vuelta en su sitio: ${d}`)
  ], `las ${MARCAS.length} marcas se despegan, y vuelven al devolverla`);

  await page.evaluate(texto => window.modeler.importXML(texto), xml);
  const quedan = await page.evaluate(() => [ window.modeler.get('drawingLayer').marks().length,
    document.querySelectorAll('.layer-simulation-drawing > *').length ]);
  informa('al abrir otro diagrama', quedan.some(n => n) ? [ `quedan ${quedan[0]} marcas y ${quedan[1]} nodos` ] : [],
    'no queda ninguna marca');

  informa('sin errores ni ventanas', incidencias, 'ninguno');
} finally {
  await navegador.close();
  servidor.cierra();
}

console.log(fallos ? `\nCapa de dibujo en rojo: ${fallos} problema(s).` : '\nCapa de dibujo en verde.');
process.exit(fallos ? 1 : 0);
