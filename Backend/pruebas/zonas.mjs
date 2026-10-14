// Las tres zonas de cada tarea (6.4), con los registros de referencia.
//
//     node pruebas/zonas.mjs
//
// Sin navegador, con la escena (Modeler/lib/scene) de cada modelo de esperado/,
// con los flujos de sus reglas:
//
// 1. Que los recuentos de cada zona cuadran con el XES: la cola a la entrada,
//    lo que esta dentro y lo bloqueado a la salida de cada elemento, con sus
//    ejecuciones, sus casos, de cuantos casos son las solicitudes que tienen en
//    la mano y, a la entrada de una recepcion, los sobres de su buzon. Aqui se
//    cuentan sobre los eventos del XES, leidos con unas expresiones regulares,
//    sin la linea de tiempo ni la escena, en cada instante en que empieza o
//    acaba algo y a mitad de cada dos:
//    - a la entrada, las esperas (StandBy...) en curso; dentro, el resto de
//      eventos con fin en curso;
//    - a la salida, las ejecuciones terminadas cuya activacion registrada
//      tiene todavia alguna pieza sin terminar, tambien en lotes repetidos;
//    - en el buzon, los sobres que han salido hacia el elemento menos los que
//      sus casos han recogido, que son sus recepciones empezadas y sus esperas
//      a una persona en curso.
// 2. Que el transito no cambia ni los recuentos ni lo bloqueado, y que lo
//    hay: si ninguna pelota ni ningun sobre fuera en transito, no se habria
//    comprobado nada.
// 3. Que con N = 50 (14) se ve acumularse el lote: a la salida de Recoger, las
//    solicitudes recogidas van creciendo hasta 49 mientras se recoge la
//    ultima, y al salir el lote pasan todas a Responder, donde la cola se vacia
//    a la vez que se llena la salida; siempre de un solo caso, el orquestador,
//    con una solicitud de cada orquestado.
// 4. Con paralelismo: dos ramas del mismo caso en la misma cola cuentan un
//    caso (37), y la que ya salio no se queda a la salida aunque la otra siga
//    en la tarea (37); dos ramas en tareas distintas (03, 12); dos lotes
//    simultaneos en la misma tarea (38), contrastados con sus eventos de fin.
//
// Para ver que las comprobaciones distinguen, se repiten con tres escenas
// estropeadas a proposito: una que cuenta cada ejecucion como un caso (14),
// una sin salida (35) y una que agrupa la salida por caso y elemento, sin
// activaciones: en el 37, la recepcion de la rama A, que acabo a los 21 s, se
// quedaria a la salida mientras la B sigue en Recoger.
//
// Despues, en un Chromium de verdad, la vista (lib/scene/view.js): las tres
// franjas de cada tarea, las pelotas en la suya, las insignias con sus
// recuentos por encima del umbral -tambien el del buzon-, que una pelota que
// termina pasa a la salida en la misma marca, que el umbral se puede bajar
// -tambien escrito como texto-, que con N = 50 la salida de Recoger crece en
// la pantalla, y que con transito las insignias cuentan lo que llega: las
// pelotas de una zona que es una insignia no se dibujan en su flujo, y el
// buzon lleno cuenta los sobres que aun van de camino.
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
const { timelineFromLogs } = await import(pathToFileURL(join(lib, 'timeline', 'timeline.js')).href);
const { createScene } = await import(pathToFileURL(join(lib, 'scene', 'scene.js')).href);
const { ZONES, countBalls } = await import(pathToFileURL(join(lib, 'scene', 'zones.js')).href);

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

// Los flujos de un modelo, de sus reglas, para que haya transito.
function grafoDeReglas(texto) {
  const grafo = { sequenceFlows: [], messageFlows: [] };
  const valor = (linea, k) => (new RegExp(`\\b${k}='([^']*)'`).exec(linea) || [])[1];
  for (const linea of texto.split('\n')) {
    const tipo = /type=bpmn:(SequenceFlow|MessageFlow)\b/.exec(linea);
    if (!tipo) continue;
    (tipo[1] === 'SequenceFlow' ? grafo.sequenceFlows : grafo.messageFlows).push({ id: valor(linea, 'id_bpmn'),
      source: valor(linea, 'superElement'), target: valor(linea, 'subElement'), name: valor(linea, 'name') || '' });
  }
  return grafo;
}
const reglasDe = carpeta => [ join(aqui, 'modelos', `${nombre(carpeta)}.txt`), join(aqui, 'modelos-con-avisos', `${nombre(carpeta)}.txt`) ]
  .find(existsSync);
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

// --- El XES, sin la linea de tiempo ---------------------------------------------

const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'' };
const sinEntidades = texto => texto.replace(/&(amp|lt|gt|quot|apos);/g, (_, e) => ENTIDADES[e]);

// Los eventos de unos registros: { caso, tipo, id, inicio, fin (null si es un
// instante), ejecucion, solicitud, remitente, origen, destino, destinatario }.
// Cada atributo, el primero con su clave dentro del evento.
function eventosDe(registros) {
  let origen = null;
  const eventos = [];
  for (const { xes } of registros) {
    const fecha = /key="simulation:startDate" value="([^"]*)"/.exec(xes.slice(0, xes.indexOf('<trace>')));
    if (fecha && origen === null) origen = Date.parse(fecha[1]);
    for (const traza of xes.split('<trace>').slice(1)) {
      const cabeza = traza.slice(0, traza.indexOf('<event>') >= 0 ? traza.indexOf('<event>') : traza.length);
      const caso = sinEntidades(/key="concept:name" value="([^"]*)"/.exec(cabeza)[1]);
      for (const bloque of traza.match(/<event>[\s\S]*?<\/event>/g) || []) {
        const a = {};
        for (const [ , clave, valor ] of bloque.matchAll(/key="([^"]+)" value="([^"]*)"/g)) {
          if (!(clave in a)) a[clave] = sinEntidades(valor);
        }
        const segundos = fecha => (Date.parse(fecha) - origen) / 1000;
        eventos.push({
          caso,
          tipo: a['bpmn:type'] || '',
          id: a['bpmn:id'],
          inicio: segundos(a['time:timestamp']),
          fin: a['time:endTime'] ? segundos(a['time:endTime']) : null,
          ejecucion: a['bpmn:execution'] === undefined ? null : Number(a['bpmn:execution']),
          activacion: a['bpmn:activation'] ?? null,
          solicitud: a['bpmn:request'] || null,
          remitente: a['bpmn:messageSender'] || null,
          origen: a['bpmn:messageOrigin'] || null,
          destino: a['bpmn:messageDestiny'] || null,
          destinatario: a['bpmn:messageTarget'] || null
        });
      }
    }
  }
  return eventos;
}

const esEspera = evento => evento.tipo.startsWith('StandBy');
const clave = (...partes) => comoTexto(partes);

// Lo que hace falta para contar: cada activacion registrada, con su primer
// inicio y ultimo fin; y de donde le llegan los sobres a cada recepcion. Las
// piezas sin identidad conservan la comprobacion de los registros antiguos.
function preparaRecuento(eventos) {
  const porPareja = new Map();
  for (const e of eventos) {
    if (e.fin === null || e.ejecucion === null) continue;
    const k = clave(e.caso, e.id, e.activacion);
    if (!porPareja.has(k)) porPareja.set(k, []);
    porPareja.get(k).push(e);
  }
  const simples = new Map();
  const varias = new Set();
  for (const lista of porPareja.values()) {
    const repetidas = new Map();
    let repite = false;
    for (const e of lista) {
      const k = clave(e.tipo, e.ejecucion);
      if (repetidas.has(k)) repite = true;
      repetidas.set(k, true);
    }
    // Si todas son la ejecucion 1, cada paso es una activacion de una sola
    // ejecucion y no deja nada a la salida: como si no pasara nunca.
    if (repite && lista.every(e => e.ejecucion === 1)) continue;
    if (repite) varias.add(lista[0].id);
    else simples.set(clave(lista[0].caso, lista[0].id, lista[0].activacion), { desde: Math.min(...lista.map(e => e.inicio)),
      hasta: Math.max(...lista.map(e => e.fin)), ejecuciones: lista.filter(e => !esEspera(e)) });
  }
  const origenes = new Map(eventos.filter(e => e.origen && e.remitente).map(e => [ e.id, e.origen ]));
  return { simples, varias, origenes };
}

// Los recuentos del XES en el instante t: { elemento: { zona: recuento } },
// solo las zonas con algo. La salida de los elementos por los que algun caso
// pasa varias veces no se cuenta.
function recuentoDelXes(eventos, preparado, t) {
  const zonas = new Map();
  const zona = (elemento, nombreDeZona) => {
    if (!zonas.has(elemento)) zonas.set(elemento, {});
    const z = zonas.get(elemento);
    if (!z[nombreDeZona]) z[nombreDeZona] = { piezas: [], sobres: 0 };
    return z[nombreDeZona];
  };
  for (const e of eventos) {
    if (e.fin === null || !(e.inicio <= t && t < e.fin)) continue;
    zona(e.id, esEspera(e) ? 'entry' : 'inside').piezas.push({ caso: e.caso,
      solicitud: e.tipo === 'StandBy' || !esEspera(e) ? e.solicitud : null });
  }
  for (const [ k, { desde, hasta, ejecuciones } ] of preparado.simples) {
    if (!(desde <= t && t < hasta)) continue;
    const [ caso, elemento ] = JSON.parse(k);
    for (const e of ejecuciones) if (e.fin <= t) zona(elemento, 'exit').piezas.push({ caso, solicitud: e.solicitud });
  }
  const buzon = new Map();
  const suma = (elemento, n) => buzon.set(elemento, (buzon.get(elemento) || 0) + n);
  for (const e of eventos) {
    if (e.destino && e.destinatario && (e.fin ?? e.inicio) <= t) suma(e.destino, 1);
    if (e.origen && e.remitente && e.inicio <= t) suma(e.id, -1);
    if (e.tipo === 'StandBy' && preparado.origenes.has(e.id) && e.solicitud && e.inicio <= t && t < e.fin) suma(e.id, -1);
  }
  for (const [ elemento, n ] of buzon) if (n) zona(elemento, 'entry').sobres = n;
  const resultado = {};
  for (const [ elemento, z ] of [ ...zonas ].sort()) {
    for (const nombreDeZona of ZONES) {
      if (!z[nombreDeZona]) continue;
      const { piezas, sobres } = z[nombreDeZona];
      (resultado[elemento] ||= {})[nombreDeZona] = { executions: piezas.length, cases: new Set(piezas.map(p => p.caso)).size,
        requests: new Set(piezas.map(p => p.solicitud).filter(Boolean)).size, messages: sobres };
    }
  }
  return resultado;
}

// Los recuentos de la escena con la misma forma: solo las zonas con algo, y sin
// la salida de los elementos que el XES no cuenta.
function recuentoDeLaEscena(zonas, sinSalida) {
  const resultado = {};
  for (const elemento of Object.keys(zonas).sort()) {
    for (const zona of ZONES) {
      if (zona === 'exit' && sinSalida.has(elemento)) continue;
      const r = zonas[elemento][zona];
      if (!r.executions && !r.messages) continue;
      (resultado[elemento] ||= {})[zona] = { ...r };
    }
  }
  return resultado;
}
const quitaSalida = (recuento, sinSalida) => Object.fromEntries(Object.entries(recuento)
  .map(([ elemento, z ]) => [ elemento, Object.fromEntries(Object.entries(z).filter(([ zona ]) => zona !== 'exit' ||
    !sinSalida.has(elemento))) ]).filter(([ , z ]) => Object.keys(z).length));

// --- 1 y 2: todos los modelos -----------------------------------------------------

function revisa(carpeta, estropea = escena => escena) {
  const problemas = [];
  const registros = registrosDe(carpeta);
  const reglas = reglasDe(carpeta);
  if (!reglas) return { problemas: [ 'no tiene reglas en modelos/ ni en modelos-con-avisos/' ] };
  const escena = estropea(createScene(timelineFromLogs(registros), grafoDeReglas(readFileSync(reglas, 'utf8'))));
  const eventos = eventosDe(registros);
  const tareas = new Set(eventos.filter(e => /Task$/.test(e.tipo)).map(e => e.id));
  if (eventos.some(e => tareas.has(e.id) && !e.activacion)) {
    problemas.push('una tarea o espera no tiene bpmn:activation');
  }
  const preparado = preparaRecuento(eventos);
  const marcas = [ ...new Set(eventos.flatMap(e => (e.fin === null ? [ e.inicio ] : [ e.inicio, e.fin ]))) ].sort((a, b) => a - b);
  const instantes = [ ...new Set([ ...marcas, ...marcas.slice(1).map((t, i) => (t + marcas[i]) / 2) ]) ].sort((a, b) => a - b);
  let maximo = { executions: 0 };
  let enTransito = 0;
  for (const t of instantes) {
    const instante = escena.at(t);
    const delXes = quitaSalida(recuentoDelXes(eventos, preparado, t), preparado.varias);
    const deLaEscena = recuentoDeLaEscena(instante.zones, preparado.varias);
    if (comoTexto(delXes) !== comoTexto(deLaEscena)) {
      const elementos = [ ...new Set([ ...Object.keys(delXes), ...Object.keys(deLaEscena) ]) ]
        .filter(e => comoTexto(delXes[e]) !== comoTexto(deLaEscena[e]));
      for (const e of elementos.slice(0, 2)) {
        problemas.push(`t=${t}, ${e}: la escena da ${comoTexto(deLaEscena[e] || {})} y el XES ${comoTexto(delXes[e] || {})}`);
      }
    }
    for (const [ elemento, z ] of Object.entries(instante.zones)) {
      if (z.exit.executions > maximo.executions) maximo = { ...z.exit, elemento, t };
    }
    // (2) El transito no cambia nada de esto.
    const conTransito = escena.at(t, { transit: 4 });
    enTransito += conTransito.balls.filter(b => b.transit).length + conTransito.envelopes.filter(s => s.transit).length;
    if (comoTexto(conTransito.zones) !== comoTexto(instante.zones) || comoTexto(conTransito.blocked) !== comoTexto(instante.blocked)) {
      problemas.push(`t=${t}: con transito, otros recuentos u otra salida`);
    }
    // Las pelotas de la salida son ejecuciones terminadas, cada una una vez.
    const ids = instante.blocked.map(b => b.id);
    if (new Set(ids).size !== ids.length || instante.blocked.some(b => b.state !== 'blocked' || b.zone !== 'exit' || b.since > t)) {
      problemas.push(`t=${t}: la salida tiene pelotas repetidas o sin terminar`);
    }
  }
  return { escena, problemas, maximo, instantes: instantes.length, varias: preparado.varias, enTransito };
}

console.log('Zonas de cada modelo:');
const escenas = {};
let transitos = 0;
for (const carpeta of carpetas) {
  let resultado;
  try {
    resultado = revisa(carpeta);
  } catch (error) {
    resultado = { problemas: [ `no se puede construir: ${error.message}` ] };
  }
  const { escena, problemas, maximo, instantes, varias, enTransito = 0 } = resultado;
  if (escena) escenas[nombre(carpeta)] = escena;
  transitos += enTransito;
  informa(nombre(carpeta), [ ...new Set(problemas) ], problemas.length ? '' : `${instantes} instantes` +
    (maximo.executions ? `; hasta ${maximo.executions} bloqueada(s) a la salida de ${maximo.elemento}` : '') +
    (varias.size ? `; salida a mano en ${[ ...varias ].join(', ')}` : ''), 40);
}

// Que la comprobacion del transito no pase sin transito.
informa('hay transito que comprobar', transitos ? [] : [ 'ninguna pelota ni ningun sobre en transito' ],
  `${transitos} pelotas y sobres en transito, en todos los instantes, sin cambiar ningun recuento`, 40);

// --- Escenas estropeadas ------------------------------------------------------------

// Las ejecuciones terminadas de un elemento en un caso mientras el caso sigue
// en el, sin mirar de que activacion son: lo que sale de agrupar por caso y
// elemento.
function salidaSinActivaciones(escena) {
  const piezas = escena.timeline.items.filter(p => p.interval);
  return t => {
    const bloqueadas = [];
    for (const entry of escena.timeline.cases) {
      const propias = piezas.filter(p => p.case === entry.id);
      for (const elemento of new Set(propias.map(p => p.element))) {
        const enEl = propias.filter(p => p.element === elemento).sort((a, b) => a.start - b.start);
        if (!enEl.some(p => p.start <= t && t < p.end)) continue;
        // La estancia: los intervalos seguidos que llegan hasta t.
        let desde = Infinity;
        for (const p of enEl) {
          if (p.start <= t && t < p.end) desde = Math.min(desde, p.start);
        }
        let cambia = true;
        while (cambia) {
          cambia = false;
          for (const p of enEl) {
            if (p.start < desde && p.end >= desde) {
              desde = p.start;
              cambia = true;
            }
          }
        }
        for (const p of enEl) if (p.state === 'working' && p.start >= desde && p.end <= t) bloqueadas.push(p);
      }
    }
    return bloqueadas;
  };
}
function conOtraSalida(escena, salida) {
  const casos = new Map(escena.timeline.cases.map(c => [ c.id, c ]));
  return {
    ...escena,
    at(t, opciones) {
      const instante = escena.at(t, opciones);
      const blocked = salida(t).map(p => ({ id: p.id, case: p.case, pool: casos.get(p.case).pool,
        number: p.instance ?? casos.get(p.case).instance, element: p.element, state: 'blocked', zone: 'exit',
        execution: p.execution, request: p.request, user: p.user, cancelled: p.cancelled, since: p.end, transit: null }));
      const zones = {};
      for (const ball of [ ...instante.balls, ...blocked ]) {
        zones[ball.element] ||= Object.fromEntries(ZONES.map(z => [ z, [] ]));
        zones[ball.element][ball.zone].push(ball);
      }
      const recuentos = Object.fromEntries(Object.entries(zones).map(([ e, z ]) => [ e,
        Object.fromEntries(ZONES.map(zona => [ zona, { ...countBalls(z[zona]),
          messages: instante.zones[e] ? instante.zones[e][zona].messages : 0 } ])) ]));
      for (const [ e, z ] of Object.entries(instante.zones)) recuentos[e] ||= z;
      return { ...instante, blocked, zones: recuentos };
    }
  };
}
const CONTROLES = [
  [ 'cada ejecucion, un caso', '14-convocatoria-de-50', /la escena da/, escena => ({
    ...escena,
    at(t, opciones) {
      const instante = escena.at(t, opciones);
      const zones = Object.fromEntries(Object.entries(instante.zones).map(([ e, z ]) => [ e, Object.fromEntries(
        Object.entries(z).map(([ zona, r ]) => [ zona, { ...r, cases: r.executions } ])) ]));
      return { ...instante, zones };
    }
  }) ],
  [ 'sin salida', '35-proceso-base', /la escena da/, escena => conOtraSalida(escena, () => []) ],
  [ 'salida sin activaciones', '37-recogida-antes-de-la-otra-espera', /t=21\.5, Recoger: la escena da/,
    escena => conOtraSalida(escena, salidaSinActivaciones(escena)) ]
];
console.log('\nCon escenas estropeadas:');
for (const [ que, carpeta, previsto, estropea ] of CONTROLES) {
  const { problemas } = revisa(carpeta, estropea);
  informa(que, problemas.some(p => previsto.test(p)) ? [] : [ `no se nota: ${comoTexto(problemas.slice(0, 3))}` ],
    `${carpeta}: la comprobacion lo distingue`, 40);
}

// --- 3 y 4: lo que pide la tarea ---------------------------------------------------

console.log('\nLo que pide la tarea:');
const recuentoEn = (escena, t, elemento) => escena ? escena.at(t).zones[elemento] || null : null;
const corto = r => (r ? ZONES.map(z => `${r[z].executions}/${r[z].cases}/${r[z].requests}/${r[z].messages}`).join(' | ') : '-');

// Con N = 50: Recoger se activa a los 100 s, cuando el orquestador acaba de
// convocar a los 50, y su lote sale a los 746, cuando acaba de recoger la
// ultima solicitud; entonces Responder contesta a los 50, uno detras de otro.
{
  const escena = escenas['14-convocatoria-de-50'];
  const problemas = [];
  if (!escena) problemas.push('falta el 14-convocatoria-de-50');
  else {
    const activacion = nombreDeElemento => escena.activations.find(a => a.element === nombreDeElemento);
    const recoger = activacion('Recoger');
    const responder = activacion('Responder');
    if (!recoger || recoger.start !== 100 || recoger.end !== 746 || !responder || responder.start !== 746) {
      problemas.push(`Recoger de ${recoger?.start} a ${recoger?.end}, Responder desde ${responder?.start}`);
    } else {
      for (const [ elemento, { start, end } ] of [ [ 'Recoger', recoger ], [ 'Responder', responder ] ]) {
        const instantes = escena.timeline.changes().filter(t => t >= start && t < end);
        let antes = -1;
        let cola = Infinity;
        for (const t of instantes) {
          const r = recuentoEn(escena, t, elemento);
          if (r.exit.executions < antes) problemas.push(`${elemento}, t=${t}: la salida baja de ${antes} a ${r.exit.executions}`);
          if (elemento === 'Responder' && r.entry.executions > cola) problemas.push(`Responder, t=${t}: la cola crece`);
          for (const zona of ZONES) {
            if (r[zona].executions && r[zona].cases !== 1) problemas.push(`${elemento}, t=${t}: ${r[zona].cases} casos en ${zona}`);
            if (zona !== 'entry' && r[zona].requests !== r[zona].executions) {
              problemas.push(`${elemento}, t=${t}: ${r[zona].executions} ejecuciones en ${zona} con solicitudes de ${r[zona].requests}`);
            }
          }
          antes = r.exit.executions;
          cola = r.entry.executions;
        }
        const ultimo = recuentoEn(escena, end - 1, elemento);
        if (corto(ultimo) !== `0/0/0/0 | 1/1/1/0 | 49/1/49/0`) problemas.push(`${elemento}, t=${end - 1}: ${corto(ultimo)}`);
        if (recuentoEn(escena, end, elemento)) problemas.push(`${elemento}, t=${end}: el lote sigue ahi`);
      }
      // A los 746 s Ana empieza la primera respuesta y las otras 49 esperan.
      const primero = recuentoEn(escena, 746, 'Responder');
      if (corto(primero) !== '49/1/49/0 | 1/1/1/0 | 0/0/0/0') problemas.push(`Responder, t=746: ${corto(primero)}`);
    }
  }
  informa('con N = 50 se acumula el lote', problemas,
    '14: a la salida de Recoger crece hasta 49 y sale a los 746 s; Responder vacia su cola y llena su salida; un caso');
}

// Con paralelismo.
for (const [ que, modelo, t, previsto ] of [
  [ 'dos ramas en la misma cola, un caso', '37-recogida-antes-de-la-otra-espera', 8,
    { Recoger: '2/1/1/0 | 0/0/0/0 | 0/0/0/0' } ],
  [ 'la rama que ya salio no se queda', '37-recogida-antes-de-la-otra-espera', 21.5,
    { Recoger: '0/0/0/0 | 1/1/1/0 | 0/0/0/0' } ],
  [ 'dos ramas en dos tareas', '03-uniones-y-bucle', 20,
    { Tarea_A: '0/0/0/0 | 1/1/0/0 | 0/0/0/0', Tarea_B: '0/0/0/0 | 1/1/0/0 | 0/0/0/0' } ],
  [ 'la recepcion y la tarea, a la vez', '12-dos-activaciones', 7.5,
    { Recoger: '1/1/0/0 | 0/0/0/0 | 0/0/0/0', Valorar: '0/0/0/0 | 1/1/0/0 | 0/0/0/0' } ],
  [ 'las vueltas de un bucle, a la salida', '03-uniones-y-bucle', 140,
    { Revision: '0/0/0/0 | 1/1/0/0 | 2/1/0/0' } ]
]) {
  const escena = escenas[modelo];
  const problemas = [];
  for (const [ elemento, esperado ] of Object.entries(previsto)) {
    const obtenido = corto(recuentoEn(escena, t, elemento));
    if (obtenido !== esperado) problemas.push(`${elemento} en t=${t}: ${obtenido}, y es ${esperado}`);
  }
  informa(que, problemas, `${modelo}, t=${t}: ${Object.entries(previsto).map(([ e, r ]) => `${e} ${r}`).join('; ')}`);
}

// Dos lotes simultaneos: el oraculo cuenta los envios terminados menos dos
// por cada Fin_O, sin usar ni las activaciones ni sus tiempos reconstruidos.
{
  const escena = escenas['38-lotes-simultaneos'];
  const problemas = [];
  if (!escena) problemas.push('falta el 38-lotes-simultaneos');
  else {
    const eventos = eventosDe(registrosDe('38-lotes-simultaneos'));
    const envios = eventos.filter(e => e.id === 'Convocar' && !esEspera(e));
    const salidas = eventos.filter(e => e.id === 'Fin_O');
    if (envios.length !== 4 || comoTexto(salidas.map(e => e.inicio)) !== '[11,16]') problemas.push('ha cambiado el caso de referencia');
    for (const t of [ 8, 9, 10, 10.5, 11, 12, 15, 16 ]) {
      const esperado = envios.filter(e => e.fin <= t).length - 2 * salidas.filter(e => e.inicio <= t).length;
      const r = recuentoEn(escena, t, 'Convocar');
      if ((r?.exit.executions || 0) !== esperado) problemas.push(`t=${t}: salida ${r?.exit.executions || 0}, esperada ${esperado}`);
    }
    const sinIdentidad = registrosDe('38-lotes-simultaneos').map(r => ({ ...r,
      xes: r.xes.replace(/<int key="bpmn:activation" value="[^"]*"\s*\/>/g, '') }));
    try {
      createScene(timelineFromLogs(sinIdentidad));
      problemas.push('sin identidad inventa la agrupacion de lotes ambiguos');
    } catch (error) {
      if (!error.message.includes('bpmn:activation')) problemas.push(error.message);
    }
  }
  informa('dos lotes simultaneos en la misma tarea', problemas, '38: salida contrastada con Fin_O; sin identidad, diagnostico explicito');
}

// Compatibilidad con XES anteriores cuando la reconstruccion no es ambigua.
{
  const problemas = [];
  for (const [ modelo, t ] of [ [ '35-proceso-base', 200 ], [ '37-recogida-antes-de-la-otra-espera', 21.5 ] ]) {
    const registros = registrosDe(modelo).map(r => ({ ...r,
      xes: r.xes.replace(/<int key="bpmn:activation" value="[^"]*"\s*\/>/g, '') }));
    const antigua = createScene(timelineFromLogs(registros), grafoDeReglas(readFileSync(reglasDe(modelo), 'utf8')));
    if (comoTexto(antigua.at(t).zones) !== comoTexto(escenas[modelo].at(t).zones)) problemas.push(`${modelo}: cambian los recuentos`);
  }
  informa('registros antiguos sin ambiguedad', problemas, '35 y 37: mismos recuentos sin bpmn:activation');
}

// --- En el navegador ---------------------------------------------------------------

console.log('\nEn el navegador:');
const BPMN_JS = join(dirname(require.resolve('bpmn-js/package.json')), 'dist');
const integracion = join(aqui, 'integracion');
for (const ruta of [ join(BPMN_JS, 'bpmn-modeler.development.js'), ...[ '14-convocatoria-de-50', '35-proceso-base' ]
  .map(m => join(integracion, `${m}.bpmn`)) ]) {
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
    if (!window.modeler) {
      window.modeler = new window.BpmnJS({ container: '#lienzo', additionalModules: [ escena ], keyboard: { bindTo: document } });
    }
    await window.modeler.importXML(xml);
    window.modeler.get('canvas').zoom('fit-viewport');
    window.modeler.get('sceneView').load(timelineFromLogs(registros));
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
  const monta = modelo => page.evaluate(([ xml, registros ]) => window.monta(xml, registros),
    [ readFileSync(join(integracion, `${modelo}.bpmn`), 'utf8'), registrosDe(modelo) ]);
  const muestra = (t, opciones) => page.evaluate(([ t, opciones ]) => window.modeler.get('sceneView').show(t, opciones).zones,
    [ t, opciones ]);

  // Lo que hay dibujado en un elemento: sus pelotas, insignias, buzon y zonas,
  // con sus datos y donde estan en la pantalla, y la caja de su forma.
  const dibujo = elemento => page.evaluate(elemento => {
    const caja = nodo => {
      const r = nodo.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 };
    };
    const gfx = document.querySelector(`.djs-element[data-element-id="${elemento}"] > .djs-visual`);
    const marcas = [ ...document.querySelectorAll('.layer-simulation-drawing > g') ]
      .filter(nodo => nodo.dataset.element === elemento && nodo.getAttribute('visibility') !== 'hidden')
      .map(nodo => ({ ...nodo.dataset, sitio: caja(nodo.querySelector('circle, rect') || nodo), texto: nodo.textContent,
        lineas: nodo.querySelectorAll('line').length }));
    const original = gfx && gfx.querySelector('.djs-label');
    return { forma: gfx && caja(gfx.firstElementChild), marcas,
      originalVisible: original && getComputedStyle(original).visibility !== 'hidden' };
  }, elemento);
  // La franja de una zona en la pantalla.
  const franja = (forma, zona) => {
    const ancho = (forma.right - forma.left) / 3;
    const i = [ 'entry', 'inside', 'exit' ].indexOf(zona);
    return { left: forma.left + i * ancho, right: forma.left + (i + 1) * ancho };
  };
  const enSuFranja = (marca, forma) => {
    const f = franja(forma, marca.zone);
    return marca.sitio.x > f.left && marca.sitio.x < f.right && marca.sitio.y > forma.top && marca.sitio.y < forma.bottom;
  };
  // Lo dibujado en cada zona, en su orden: cuantas pelotas, o la insignia.
  const resumen = marcas => {
    const r = {};
    for (const m of marcas) {
      if (m.kind === 'ball') r[m.zone] = (r[m.zone] || 0) + 1;
      if (m.kind === 'badge') r[m.zone] = `insignia ${m.executions}/${m.cases}/${m.requests}`;
    }
    return Object.fromEntries(ZONES.filter(z => z in r).map(z => [ z, r[z] ]));
  };

  // El nombre tiene su propio espacio, separado de pelotas, insignias y buzon.
  const revisaNombre = async elemento => {
    const { forma, marcas, originalVisible } = await dibujo(elemento);
    const nombre = marcas.find(m => m.kind === 'label');
    const problemas = [];
    if (!nombre || originalVisible) problemas.push(`${elemento}: nombre sin trasladar`);
    else {
      if (!(nombre.sitio.bottom < forma.top || nombre.sitio.top > forma.bottom)) problemas.push(`${elemento}: nombre dentro de las zonas`);
      if (forma.top >= 0 && nombre.sitio.top < 0) problemas.push(`${elemento}: nombre recortado por el lienzo`);
      const solapa = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      if (marcas.some(m => m !== nombre && m.kind !== 'zones' && solapa(m.sitio, nombre.sitio))) {
        problemas.push(`${elemento}: una marca tapa el nombre`);
      }
    }
    return problemas;
  };

  // El lote del proceso base a los 200 s: en Evaluar_Propuestas, cuatro en la
  // cola, tres evaluando y tres evaluadas, cada pelota en su franja.
  await monta('35-proceso-base');
  let zonas = await muestra(200);
  {
    const problemas = [];
    const { forma, marcas } = await dibujo('Evaluar_Propuestas');
    const pelotas = marcas.filter(m => m.kind === 'ball');
    const previsto = { entry: 4, inside: 3, exit: 3 };
    if (comoTexto(resumen(marcas)) !== comoTexto(previsto)) problemas.push(`dibuja ${comoTexto(resumen(marcas))}`);
    const recuento = zonas.Evaluar_Propuestas;
    if (comoTexto(ZONES.map(z => recuento[z].executions)) !== comoTexto([ 4, 3, 3 ])) problemas.push(`cuenta ${corto(recuento)}`);
    const fuera = pelotas.filter(m => !enSuFranja(m, forma));
    if (fuera.length) problemas.push(`fuera de su franja: ${fuera.map(m => `${m.zone} ${m.execution}`).join(', ')}`);
    if (new Set(pelotas.map(m => `${Math.round(m.sitio.x)},${Math.round(m.sitio.y)}`)).size !== pelotas.length) {
      problemas.push('dos pelotas en el mismo sitio');
    }
    if (pelotas.some(m => m.zone === 'exit' && m.state !== 'blocked')) problemas.push('a la salida, una pelota sin terminar');
    const zonasDibujadas = marcas.filter(m => m.kind === 'zones');
    if (zonasDibujadas.length !== 1 || zonasDibujadas[0].lineas !== 2 || !/cola.*dentro.*salida/.test(zonasDibujadas[0].texto)) {
      problemas.push('sin las dos lineas y los nombres de las zonas');
    }
    problemas.push(...await revisaNombre('Evaluar_Propuestas'));
    informa('las tres franjas, a los 200 s', problemas, '35, Evaluar_Propuestas: 4 en la cola, 3 dentro y 3 a la salida, cada una en su franja');
  }

  // Una pelota que termina pasa a la salida en la misma marca.
  {
    const problemas = [];
    const escena = escenas['35-proceso-base'];
    const lote = escena.activations.find(a => a.element === 'Evaluar_Propuestas');
    const ejecucion = lote.chains.map(c => c.pieces[c.pieces.length - 1]).find(p => p.state === 'working' && p.end < lote.end);
    const durante = (ejecucion.start + ejecucion.end) / 2;
    await muestra(durante);
    const nodo = `.scene-ball[data-element="Evaluar_Propuestas"][data-execution="${ejecucion.execution}"]`;
    const antes = await page.evaluate(selector => {
      window.marcaQueTermina = document.querySelector(selector);
      return window.marcaQueTermina && { ...window.marcaQueTermina.dataset };
    }, nodo);
    await muestra(ejecucion.end);
    const despues = await page.evaluate(selector => {
      const ahora = document.querySelector(selector);
      return ahora && { misma: ahora === window.marcaQueTermina, ...ahora.dataset,
        discontinua: ahora.querySelector('circle').getAttribute('stroke-dasharray') !== 'none' };
    }, nodo);
    if (!antes || antes.zone !== 'inside' || antes.state !== 'working') problemas.push(`a los ${durante} s: ${comoTexto(antes)}`);
    if (!despues || !despues.misma || despues.zone !== 'exit' || despues.state !== 'blocked' || !despues.discontinua) {
      problemas.push(`a los ${ejecucion.end} s: ${comoTexto(despues)}`);
    }
    const { forma, marcas } = await dibujo('Evaluar_Propuestas');
    const suya = marcas.find(m => m.kind === 'ball' && m.execution === String(ejecucion.execution));
    if (!suya || !enSuFranja(suya, forma)) problemas.push('no esta en la franja de la salida');
    informa('al terminar, a la salida', problemas,
      `la ejecucion ${ejecucion.execution} de Evaluar_Propuestas: dentro a los ${durante} s, a la salida a los ${ejecucion.end}, la misma marca`);
  }

  // El umbral: con 2, las tres zonas de Evaluar_Propuestas son insignias con
  // sus recuentos; sin el, vuelven las pelotas.
  {
    const problemas = [];
    zonas = await muestra(200, { threshold: 2 });
    let { forma, marcas } = await dibujo('Evaluar_Propuestas');
    const previsto = { entry: 'insignia 4/1/4', inside: 'insignia 3/1/3', exit: 'insignia 3/1/3' };
    if (comoTexto(resumen(marcas)) !== comoTexto(previsto)) problemas.push(`con umbral 2 dibuja ${comoTexto(resumen(marcas))}`);
    problemas.push(...await revisaNombre('Evaluar_Propuestas'));
    if (process.env.SCENE_SCREENSHOT) await page.screenshot({ path: process.env.SCENE_SCREENSHOT });
    const insignias = marcas.filter(m => m.kind === 'badge');
    if (insignias.some(m => !enSuFranja(m, forma))) problemas.push('una insignia fuera de su franja');
    if (insignias.some(m => !/caso/.test(m.texto) || !/ejec/.test(m.texto) || !/sol/.test(m.texto))) {
      problemas.push(`insignias sin rotulos: ${comoTexto(insignias.map(m => m.texto))}`);
    }
    // Escrito como texto, como el de un campo de formulario, es el mismo umbral.
    await muestra(200, { threshold: '2' });
    ({ forma, marcas } = await dibujo('Evaluar_Propuestas'));
    if (comoTexto(resumen(marcas)) !== comoTexto(previsto)) problemas.push(`con umbral «2» dibuja ${comoTexto(resumen(marcas))}`);
    await muestra(200);
    ({ forma, marcas } = await dibujo('Evaluar_Propuestas'));
    if (comoTexto(resumen(marcas)) !== comoTexto({ entry: 4, inside: 3, exit: 3 })) problemas.push(`sin umbral, ${comoTexto(resumen(marcas))}`);
    informa('el umbral', problemas, 'con 2 o «2», tres insignias rotuladas: «4 ejec. 1 caso 4 sol.», 3 y 3; sin el, las pelotas');
  }

  // Con N = 50, la salida de Recoger crece en la pantalla, y a los 745 s es una
  // insignia de 49 ejecuciones de un caso con 49 solicitudes, con la ultima
  // dentro.
  await monta('14-convocatoria-de-50');
  {
    const problemas = [];
    const vistos = [];
    for (const t of [ 150, 300, 450, 600, 745 ]) {
      zonas = await muestra(t);
      const { forma, marcas } = await dibujo('Recoger');
      const salida = marcas.filter(m => m.zone === 'exit');
      const enPantalla = salida.reduce((n, m) => n + (m.kind === 'badge' ? Number(m.executions) : 1), 0);
      if (enPantalla !== zonas.Recoger.exit.executions) problemas.push(`t=${t}: ${enPantalla} a la salida en la pantalla y ${zonas.Recoger.exit.executions} en la escena`);
      if (salida.some(m => !enSuFranja(m, forma))) problemas.push(`t=${t}: algo fuera de la franja de la salida`);
      vistos.push(enPantalla);
    }
    if (vistos.some((n, i) => i && n < vistos[i - 1]) || vistos[vistos.length - 1] !== 49) problemas.push(`la salida: ${vistos.join(', ')}`);
    const { marcas } = await dibujo('Recoger');
    if (comoTexto(resumen(marcas)) !== comoTexto({ inside: 1, exit: 'insignia 49/1/49' })) problemas.push(`a los 745 s: ${comoTexto(resumen(marcas))}`);
    const resultado = resumen((await dibujo('Esperar_Resultado')).marcas);
    if (comoTexto(resultado) !== comoTexto({ entry: 'insignia 50/50/0' })) problemas.push(`Esperar_Resultado: ${comoTexto(resultado)}`);
    informa('con N = 50, el lote en la pantalla', problemas, `14, salida de Recoger: ${vistos.join(', ')}; a los 745 s, 49 ejecuciones de 1 caso y la ultima dentro`);
  }

  // Con transito: a los 746,5 s las 50 respuestas acaban de llegar a Responder.
  // Las 49 de la cola van en su insignia, sin dibujarse en el flujo; la que ya
  // trabaja, que cabe, se ve llegar por el. Y a los 18 s, el buzon lleno cuenta
  // tambien los sobres que aun van de camino, que se ven en su flujo.
  {
    const problemas = [];
    zonas = await muestra(746.5, { transit: 4 });
    const pelotas = await page.evaluate(() => [ ...document.querySelectorAll('.scene-ball[data-element="Responder"]') ]
      .map(n => n.dataset.zone));
    const { marcas } = await dibujo('Responder');
    const insignia = marcas.find(m => m.kind === 'badge' && m.zone === 'entry');
    if (comoTexto(pelotas) !== comoTexto([ 'inside' ]) || !insignia || Number(insignia.executions) !== 49 ||
      zonas.Responder.entry.executions !== 49) {
      problemas.push(`a los 746,5 s: pelotas ${comoTexto(pelotas)} y la insignia de la cola, ${insignia?.executions}`);
    }
    zonas = await muestra(18, { transit: 4 });
    const buzon = (await dibujo('Esperar_Convocatoria')).marcas.find(m => m.kind === 'mailbox');
    const deCamino = await page.evaluate(() => [ ...document.querySelectorAll('.scene-envelope') ]
      .filter(n => n.dataset.flow === 'Convocatoria').length);
    const cuenta = zonas.Esperar_Convocatoria.entry.messages;
    if (!buzon || Number(buzon.messages) !== cuenta || !deCamino || cuenta <= 4) {
      problemas.push(`a los 18 s: el buzon dice ${buzon?.messages}, la escena ${cuenta}, y ${deCamino} van de camino`);
    }
    informa('las insignias, con transito', problemas,
      `746,5 s: 49 en la insignia de la cola y 1 llegando; 18 s: «× ${cuenta}» con ${deCamino} de camino`);
  }

  // El buzon lleno: a los 200 s, 36 convocatorias esperan a orquestados que aun
  // no han llegado.
  {
    const problemas = [];
    zonas = await muestra(200);
    const { forma, marcas } = await dibujo('Esperar_Convocatoria');
    const buzon = marcas.filter(m => m.kind === 'mailbox');
    const sueltos = await page.evaluate(() => document.querySelectorAll('.scene-envelope').length);
    const previstos = zonas.Esperar_Convocatoria.entry.messages;
    if (buzon.length !== 1 || Number(buzon[0].messages) !== previstos || previstos !== 36) {
      problemas.push(`el buzon: ${comoTexto(buzon.map(m => m.messages))}, y la escena cuenta ${previstos}`);
    }
    if (!buzon[0] || !(buzon[0].sitio.y < forma.top) || !/× 36/.test(buzon[0].texto)) problemas.push('no esta encima de la recepcion con «× 36»');
    if (sueltos) problemas.push(`ademas, ${sueltos} sobres sueltos`);
    problemas.push(...await revisaNombre('Esperar_Convocatoria'));
    informa('el buzon lleno', problemas, '14, t=200: un sobre «× 36» encima de Esperar_Convocatoria, en vez de 36');
  }

  // Al ampliar, todo sigue en su franja.
  {
    const problemas = [];
    await muestra(745);
    await page.evaluate(() => window.modeler.get('canvas').zoom(2.5, { x: 700, y: 300 }));
    for (const elemento of [ 'Recoger', 'Esperar_Resultado' ]) {
      const { forma, marcas } = await dibujo(elemento);
      const fuera = marcas.filter(m => m.zone && m.kind !== 'zones' && !enSuFranja(m, forma));
      if (fuera.length) problemas.push(`${elemento}: ${fuera.map(m => `${m.kind} ${m.zone}`).join(', ')} fuera de su franja`);
    }
    problemas.push(...await revisaNombre('Recoger'));
    informa('al ampliar', problemas, 'las insignias y las pelotas siguen en su franja');
  }

  // Al salir de la tarea, al editarla y al limpiar, el titulo vuelve al dibujo
  // original y el XML no lleva ninguna modificacion de la vista.
  {
    const problemas = [];
    await monta('35-proceso-base');
    let antes = await page.evaluate(async () => (await window.modeler.saveXML({ format: true })).xml);
    await muestra(200, { threshold: 2 });
    const conMarcas = await page.evaluate(async () => (await window.modeler.saveXML({ format: true })).xml);
    if (antes !== conMarcas) problemas.push('dibujar ha modificado el XML');
    await page.evaluate(() => {
      const m = window.modeler;
      m.get('modeling').updateLabel(m.get('elementRegistry').get('Evaluar_Propuestas'), 'Evaluar con nombre cambiado');
    });
    problemas.push(...await revisaNombre('Evaluar_Propuestas'));
    if (!(await dibujo('Evaluar_Propuestas')).marcas.find(m => m.kind === 'label')?.texto.includes('nombre cambiado')) {
      problemas.push('al editar, el rotulo no cambia');
    }
    await page.evaluate(() => window.modeler.get('commandStack').undo());
    antes = await page.evaluate(async () => (await window.modeler.saveXML({ format: true })).xml);
    await muestra(0);
    let d = await dibujo('Evaluar_Propuestas');
    if (!d.originalVisible || d.marcas.some(m => m.kind === 'label')) problemas.push('al salir no restaura el nombre');
    await muestra(200);
    await page.evaluate(() => window.modeler.get('sceneView').clear());
    d = await dibujo('Evaluar_Propuestas');
    if (!d.originalVisible || d.marcas.length) problemas.push('clear no restaura el nombre');
    const despues = await page.evaluate(async () => (await window.modeler.saveXML({ format: true })).xml);
    if (antes !== despues) problemas.push('la vista ha modificado el XML');
    informa('nombres legibles y restaurados', problemas, 'pelotas, insignias, buzon, zoom, edicion y clear; XML intacto');
  }

  informa('sin errores ni ventanas', incidencias, 'ninguno');
} finally {
  await navegador.close();
  servidor.cierra();
}

console.log(fallos ? `\nZonas en rojo: ${fallos} problema(s).` : `\nZonas en verde: ${carpetas.length} modelos.`);
process.exit(fallos ? 1 : 0);
