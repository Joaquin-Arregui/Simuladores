// La linea de tiempo del visualizador (6.1) con los registros de referencia.
//
//     node pruebas/linea_de_tiempo.mjs
//
// Construye con Modeler/lib/timeline la linea de tiempo de cada modelo que
// tiene registros congelados en esperado/ y comprueba:
//
// 1. Que cada evento del registro es una pieza de la linea, con un ID que no se
//    repite y un intervalo que no acaba antes de empezar.
// 2. Que ningun caso desaparece mientras vive: en cada instante entre su primer
//    evento y el ultimo tiene al menos una pieza activa. Es lo que faltaba sin
//    las esperas canceladas: una recepcion multiinstancia que cerraba vacia
//    dejaba al caso en ninguna parte (el 21 entre 56 y 57). Para ver que la
//    comprobacion lo distingue, se repite con el 21 sin ellas y tiene que
//    fallar ahi.
// 3. Que las solicitudes cuadran: la de una recepcion es quien mando el sobre,
//    y la de una respuesta, a quien va.
// 4. Que el orden es estable: es el de cada traza, y no cambia al leer el
//    mismo registro escrito en una sola linea o con las etiquetas en xes:.
// 5. Lo que tiene que dar en instantes concretos: ramas paralelas, un bucle,
//    las ejecuciones simultaneas de una tarea multiinstancia con sus
//    solicitudes, dos activaciones paralelas de la misma recepcion, las esperas
//    canceladas y el principio y el fin de un caso.
// 6. Que las tareas de duracion cero aparecen entre los instantes, conservan
//    sus datos y su orden, y no se repiten entre dos ventanas consecutivas.
//
// Sin navegador ni dependencias: el modulo es el mismo que usa el visualizador.
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const aqui = dirname(fileURLToPath(import.meta.url));
const modeler = join(aqui, '..', '..', 'Modeler');
const { timelineFromLogs } = await import(pathToFileURL(join(modeler, 'lib', 'timeline', 'timeline.js')).href);

const esperado = join(aqui, 'esperado');
const esCarpeta = ruta => existsSync(ruta) && statSync(ruta).isDirectory();
const carpetas = esCarpeta(esperado)
  ? readdirSync(esperado).flatMap(d => (d === 'con-avisos' ? readdirSync(join(esperado, d)).map(e => join(d, e)) : [ d ]))
    .filter(d => esCarpeta(join(esperado, d)) && readdirSync(join(esperado, d)).some(f => f.endsWith('.xes'))).sort()
  : [];
if (!carpetas.length) {
  // Sin registros no hay nada que comprobar, y eso no es un banco en verde.
  console.log(`No hay registros congelados en ${esperado}.`);
  process.exit(1);
}

const registrosDe = carpeta => readdirSync(join(esperado, carpeta)).filter(f => f.endsWith('.xes')).sort()
  .map(f => ({ pool: f.replace(/\.xes$/, ''), xes: readFileSync(join(esperado, carpeta, f), 'utf8') }));
const nombre = carpeta => carpeta.replace(/^con-avisos[\\/]/, '');

// Los instantes de la vida de un caso en los que no tiene nada activo.
function huecos(linea, caso) {
  const { start, end } = linea.case(caso);
  return linea.changes().filter(t => t >= start && t < end && !linea.positionsOf(caso, t).length);
}

// Lo que no cuadra en la linea de tiempo de un conjunto de registros.
function revisa(registros) {
  const problemas = [];
  const linea = timelineFromLogs(registros);
  const eventos = registros.reduce((n, r) => n + (r.xes.match(/<event>/g) || []).length, 0);
  if (linea.items.length !== eventos) problemas.push(`${eventos} eventos y ${linea.items.length} piezas`);
  for (const pieza of linea.items) {
    if (pieza.end < pieza.start) problemas.push(`${pieza.id} acaba antes de empezar`);
    if (pieza.state === 'waiting-message' && !pieza.cancelled && !pieza.request) {
      problemas.push(`${pieza.id}: una espera de mensaje sin la solicitud que la termino`);
    }
    if (pieza.sender && pieza.request && pieza.sender !== pieza.request) {
      problemas.push(`${pieza.id}: recibe de ${pieza.sender} y dice atender a ${pieza.request}`);
    }
    if (pieza.target && pieza.request && pieza.target !== pieza.request) {
      problemas.push(`${pieza.id}: responde a ${pieza.target} y dice atender a ${pieza.request}`);
    }
  }
  for (const caso of linea.cases) {
    const vacios = huecos(linea, caso.id);
    if (vacios.length) problemas.push(`${caso.id} no esta en ninguna parte en t=${vacios.slice(0, 3).join(', ')}`);
    // El orden de cada caso es el de su traza.
    const ocurrencias = caso.items.map(pieza => pieza.occurrence);
    if (ocurrencias.some((o, i) => i && o < ocurrencias[i - 1])) problemas.push(`${caso.id} sale en otro orden que su traza`);
  }
  return { linea, problemas };
}

const otrasEscrituras = [
  [ 'en una sola linea', xes => xes.replace(/>\s+</g, '><') ],
  [ 'con prefijo xes', xes => xes.replace('xmlns="http://www.xes-standard.org/"', 'xmlns:xes="http://www.xes-standard.org/"')
    .replace(/<(\/?)(?![?!])([A-Za-z][\w.-]*)/g, '<$1xes:$2') ]
];
const comoTexto = linea => JSON.stringify(linea.items);

let fallos = 0;
const lineas = {};
for (const carpeta of carpetas) {
  const registros = registrosDe(carpeta);
  let resultado;
  try {
    resultado = revisa(registros);
  } catch (error) {
    resultado = { problemas: [ `no se puede leer: ${error.message}` ] };
  }
  const { linea, problemas } = resultado;
  if (linea) {
    lineas[nombre(carpeta)] = linea;
    for (const [ como, escribe ] of otrasEscrituras) {
      const otra = timelineFromLogs(registros.map(r => ({ ...r, xes: escribe(r.xes) })));
      if (comoTexto(otra) !== comoTexto(linea)) problemas.push(`escrito ${como}, da otra linea de tiempo`);
    }
  }
  if (problemas.length) {
    fallos += 1;
    console.log(`${nombre(carpeta).padEnd(40)} PROBLEMAS`);
    for (const p of problemas.slice(0, 8)) console.log(`         ${p}`);
  } else {
    const canceladas = linea.items.filter(p => p.cancelled).length;
    console.log(`${nombre(carpeta).padEnd(40)} ok      ${linea.cases.length} casos, ${linea.items.length} piezas, ` +
      `ningun caso desaparece${canceladas ? `; ${canceladas} esperas canceladas` : ''}`);
  }
}

// (2) Sin las esperas canceladas, el 21 tiene que tener su hueco.
const sinCanceladas = registrosDe('21-nadie-reclama').map(r => ({
  ...r, xes: r.xes.replace(/\s*<event>(?:(?!<\/event>)[\s\S])*?key="bpmn:cancelled" value="true"[\s\S]*?<\/event>/g, '')
}));
const control = huecos(timelineFromLogs(sinCanceladas), 'Pool_Orquestador - 1');
console.log('\nSin las esperas canceladas:');
if (JSON.stringify(control) !== JSON.stringify([ 56 ])) {
  fallos += 1;
  console.log(`${'21-nadie-reclama'.padEnd(40)} NO SE DETECTA  esperaba el hueco en t=56, y da ${JSON.stringify(control)}`);
} else {
  console.log(`${'21-nadie-reclama'.padEnd(40)} ok      el orquestador desaparece en t=56: la comprobacion distingue`);
}

// (5) Instantes concretos, comprobados a mano con los registros.
const describe = piezas => piezas.map(p => `${p.element}:${p.state}${p.execution ? `#${p.execution}` : ''}` +
  `${p.cancelled ? '(cancelada)' : ''}${p.user ? `@${p.user}` : ''}${p.request ? `<${p.request}>` : ''}`).sort();
const CASOS = [
  [ 'ramas paralelas', '03-uniones-y-bucle', 'Instance 1', 20, [ 'Tarea_A:working#1@Rosa', 'Tarea_B:working#1@Tomas' ] ],
  [ 'una rama espera a la otra', '03-uniones-y-bucle', 'Instance 1', 35, [ 'Tarea_B:working#1@Tomas', 'Union_P:waiting-join' ] ],
  [ 'bucle: espera a la persona', '03-uniones-y-bucle', 'Instance 1', 90, [ 'Revision:waiting-user#1' ] ],
  [ 'bucle: segunda vuelta', '03-uniones-y-bucle', 'Instance 1', 120, [ 'Revision:working#2@Tomas' ] ],
  [ 'bucle: tercera vuelta', '03-uniones-y-bucle', 'Instance 1', 140, [ 'Revision:working#3@Tomas' ] ],
  [ 'el fin no ocupa tiempo', '03-uniones-y-bucle', 'Instance 1', 148, [] ],
  [ 'multiinstancia: el lote, con sus solicitudes', '35-proceso-base', 'Pool_SACU - 1', 150, [
    'Evaluar_Propuestas:working#1@Carlos<Pool_Residente - 4>', 'Evaluar_Propuestas:working#2@Ana<Pool_Residente - 2>',
    'Evaluar_Propuestas:working#3@Bea<Pool_Residente - 1>', 'Evaluar_Propuestas:waiting-user#4<Pool_Residente - 8>',
    'Evaluar_Propuestas:waiting-user#5<Pool_Residente - 5>', 'Evaluar_Propuestas:waiting-user#6<Pool_Residente - 3>',
    'Evaluar_Propuestas:waiting-user#7<Pool_Residente - 9>', 'Evaluar_Propuestas:waiting-user#8<Pool_Residente - 10>',
    'Evaluar_Propuestas:waiting-user#9<Pool_Residente - 6>', 'Evaluar_Propuestas:waiting-user#10<Pool_Residente - 7>' ] ],
  [ 'recepcion: lo que falta y la cancelada', '35-proceso-base', 'Pool_SACU - 1', 140, [
    'Recibir_Solicitudes:waiting-message#10<Pool_Residente - 7>', 'Recibir_Solicitudes:waiting-message#11(cancelada)' ] ],
  [ 'recepcion vacia: espera cancelada', '21-nadie-reclama', 'Pool_Orquestador - 1', 56.5,
    [ 'Recoger_Reclamaciones:waiting-message#1(cancelada)' ] ],
  [ 'dos activaciones de la recepcion', '12-dos-activaciones', 'Pool_Orquestador - 1', 7.5,
    [ 'Recoger:waiting-message#1<Pool_Orquestado - 2>', 'Valorar:working#1@Ana' ] ],
  [ 'la respuesta, a quien escribio', '12-dos-activaciones', 'Pool_Orquestador - 1', 24.5,
    [ 'Responder:working#1@Ana<Pool_Orquestado - 1>', 'Valorar:working#1@Ana' ] ]
];
console.log('\nInstantes concretos:');
for (const [ que, modelo, caso, t, previsto ] of CASOS) {
  const obtenido = describe(lineas[modelo] ? lineas[modelo].positionsOf(caso, t) : []);
  if (JSON.stringify(obtenido) !== JSON.stringify([ ...previsto ].sort())) {
    fallos += 1;
    console.log(`${que.padEnd(46)} FALLA   ${modelo}, ${caso} en t=${t}`);
    console.log(`         da     ${JSON.stringify(obtenido)}`);
    console.log(`         previsto ${JSON.stringify([ ...previsto ].sort())}`);
  } else {
    console.log(`${que.padEnd(46)} ok      ${previsto.length} piezas en t=${t}`);
  }
}

// Dos ejecuciones de la misma recepcion con el mismo numero son piezas distintas.
const recoger = lineas['12-dos-activaciones']?.case('Pool_Orquestador - 1').items
  .filter(p => p.element === 'Recoger' && p.state === 'working') || [];
const distintas = recoger.length === 2 && recoger[0].id !== recoger[1].id && recoger.every(p => p.execution === 1);
console.log(`${'las dos, con su ID'.padEnd(46)} ${distintas ? 'ok      ' : 'FALLA   '}${recoger.map(p => p.id).join(' y ')}`);
fallos += !distintas;

// El principio y el fin de un caso: el residente 6 del 35 llega a los 112 s.
const residente = lineas['35-proceso-base'];
const vida = [ 100, 112, 316, 317 ].map(t => residente.statusOf('Pool_Residente - 6', t));
const vidaPrevista = [ 'pending', 'active', 'active', 'finished' ];
const vidaBien = JSON.stringify(vida) === JSON.stringify(vidaPrevista);
console.log(`${'llegada y fin de un caso'.padEnd(46)} ${vidaBien ? 'ok      ' : 'FALLA   '}${vida.join(', ')} en t=100, 112, 316 y 317`);
fallos += !vidaBien;

// (6) XES del motor: Preparar y Sellar duran cero, Revisar ocupa diez segundos.
// Se comprueban ventanas consecutivas (from, to], incluido el instante inicial.
const instantaneas = lineas['36-tareas-instantaneas'];
const VENTANAS = [
  [ -1, -0.001, [] ],
  [ -1, 0, [ 'Instance 1#1', 'Instance 1#2', 'Instance 1#3' ] ],
  [ 0, 0, [] ],
  [ 0, 30, [ 'Instance 1#5', 'Instance 2#1', 'Instance 2#2', 'Instance 2#3' ] ],
  [ 30, 30, [] ],
  [ 30, 40, [ 'Instance 2#5' ] ]
];
console.log('\nTareas de duracion cero:');
for (const [ desde, hasta, previstos ] of VENTANAS) {
  const obtenidos = instantaneas?.passedBetween(desde, hasta).map(p => p.id) || [];
  const bien = !!instantaneas && JSON.stringify(obtenidos) === JSON.stringify(previstos);
  fallos += !bien;
  console.log(`${`instantes entre ${desde} y ${hasta}`.padEnd(46)} ${bien ? 'ok      ' : 'FALLA   '}${JSON.stringify(obtenidos)}`);
}
const tareasInstantaneas = instantaneas?.passedBetween(-1, 40).filter(p => p.type === 'bpmn:Task') || [];
const datosInstantaneas = tareasInstantaneas.map(p => [ p.id, p.element, p.state, p.execution, p.user, p.start, p.end ]);
const datosPrevistos = [
  [ 'Instance 1#2', 'Preparar', 'working', 1, 'Ana', 0, 0 ],
  [ 'Instance 1#3', 'Sellar', 'working', 1, 'Ana', 0, 0 ],
  [ 'Instance 2#2', 'Preparar', 'working', 1, 'Ana', 30, 30 ],
  [ 'Instance 2#3', 'Sellar', 'working', 1, 'Ana', 30, 30 ]
];
const datosBien = JSON.stringify(datosInstantaneas) === JSON.stringify(datosPrevistos) &&
  tareasInstantaneas.every(p => p.interval && instantaneas.items.includes(p));
console.log(`${'identidad, datos y orden de las tareas'.padEnd(46)} ${datosBien ? 'ok' : 'FALLA'}`);
fallos += !datosBien;
const activos = [ [ 'Instance 1', 0 ], [ 'Instance 2', 30 ] ]
  .map(([ caso, t ]) => describe(instantaneas?.positionsOf(caso, t) || []));
const activosBien = activos.every(piezas => JSON.stringify(piezas) === JSON.stringify([ 'Revisar:working#1@Luis' ]));
console.log(`${'solo Revisar ocupa tiempo'.padEnd(46)} ${activosBien ? 'ok' : 'FALLA'}`);
fallos += !activosBien;

// Lo que no es un XES no da una linea de tiempo a medias.
const malos = [ '<log><trace>', 'esto no es XML', '<log><trace><event><date key="time:timestamp" value="ayer"/></event></trace></log>' ];
const rechazados = malos.filter(xes => {
  try {
    timelineFromLogs([ { pool: 'P', xes } ]);
    return false;
  } catch {
    return true;
  }
});
const todosRechazados = rechazados.length === malos.length;
console.log(`${'registros rotos'.padEnd(46)} ${todosRechazados ? 'ok      ' : 'FALLA   '}${rechazados.length} de ${malos.length} rechazados`);
fallos += !todosRechazados;

console.log(fallos ? `\nLinea de tiempo en rojo: ${fallos} problema(s).` : `\nLinea de tiempo en verde: ${carpetas.length} modelos.`);
process.exit(fallos ? 1 : 0);
