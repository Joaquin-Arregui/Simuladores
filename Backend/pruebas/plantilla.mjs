// El orquestador y sus recursos, por nombre (6.6), con los registros de
// referencia.
//
//     node pruebas/plantilla.mjs
//
// Sin navegador, con la plantilla (Modeler/lib/scene/staff.js) de cada modelo
// de esperado/, contrastada con el XES leido aqui con unas expresiones
// regulares, sin la linea de tiempo ni la escena:
//
// 1. Que la plantilla de cada pool es la de la cabecera de su registro
//    -pool:staff, en su orden, y los carriles de cada persona-, tambien con
//    quien no trabaja nunca: Carla en el 32, Diana en el 08 y Hugo en el 39, que
//    salen libres de principio a fin.
// 2. Que en cada instante en que empieza o acaba algo, y a mitad de cada dos,
//    cada persona esta ocupada justo con los eventos que la nombran
//    (bpmn:userTask) y estan en curso: con su ID de ejecucion -caso y
//    bpmn:occurrence-, su tarea, su numero de ejecucion, su solicitud y su
//    intervalo, los del XES. Con recursos finitos, nunca con dos a la vez.
// 3. Que la cola de cada pool son sus esperas a una persona (StandBy) en
//    curso, de cualquier tarea, por orden de llegada; que con recursos
//    infinitos nunca hay nadie en ella; y que una espera cancelada no esta
//    nunca ni en la cola ni en manos de nadie.
// 4. Lo que pide la tarea, con el 39 -evaluar siete solicitudes con cinco
//    personas-: a los 30 s evaluan cuatro y Ana, que tambien evalua, sigue
//    ocupada en otra tarea, Preparar_Acta, mientras su cola espera; a los 40,
//    las cinco asignaciones, cada una con su solicitud y su intervalo real; al
//    cancelarse la espera de mas de la recogida, nadie la tiene; y al acabar
//    una evaluacion la persona queda libre o toma la siguiente de la cola, en
//    el mismo instante.
//
// Para ver que las comprobaciones distinguen, se repiten con plantillas
// estropeadas a proposito: la de las reglas de ahora, sin Hugo; una sin quien
// no trabaja; una que alarga cada asignacion hasta su duracion maxima; y una
// cola con la espera cancelada.
//
// Donde va la plantilla (placeRoster), con un pool y obstaculos puestos a
// mano: a la derecha si cabe; si no, deslizandose por ese lado, a la
// izquierda, debajo o encima; sin sitio, por debajo de lo que la tape. Y en
// 2000 disposiciones al azar, nunca encima de nada.
//
// Despues, en un Chromium de verdad, la vista (lib/scene/view.js) con el 39:
// la plantilla junto a la comision, a su derecha, y la de los solicitantes sin
// solaparse; con los solicitantes a 50 a la derecha de la comision -donde su
// plantilla tapaba Ini_S- y a 50 a su izquierda, en todos los instantes, cada
// plantilla pegada a su pool por el lado libre, siempre en el mismo sitio y
// sin tapar ninguna forma, ni lo demas dibujado, ni la otra plantilla; lo
// que dice de cada persona y de la cola, igual que el XES; las
// cinco pelotas de Evaluar con su persona y su solicitud, dentro de su franja,
// sin taparse ni tapar el marcador de multiinstancia; que fit() encaja las
// plantillas; y que, cambiadas despues las reglas en el diagrama -sin Hugo,
// Evaluar solo para Ana, otro nombre para la comision-, tambien guardado,
// abierto otra vez y con los registros cargados despues, y en el 08 borrado el
// carril de Diana, la plantilla sigue siendo la del registro; y que fit() no
// cuenta las marcas ocultas de un elemento borrado. Con el 01, un Process, la
// plantilla va a la derecha del diagrama. Lo dibujado, estropeado -sin Hugo, o
// con Ana en la ejecucion de Bea-, tiene que fallar.
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
const { createStaff } = await import(pathToFileURL(join(lib, 'scene', 'staff.js')).href);
const { placeRoster } = await import(pathToFileURL(join(lib, 'scene', 'view.js')).href);

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
const MODELO = '39-evaluar-con-cinco-personas';
if (!carpetas.includes(MODELO)) sale(`Falta el modelo ${MODELO} en ${esperado}.`);
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

// --- El XES, leido aqui ------------------------------------------------------------

const ENTIDADES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: '\'' };
const decodifica = texto => texto.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (_, n) => (n[0] === '#'
  ? String.fromCodePoint(n[1] === 'x' ? parseInt(n.slice(2), 16) : Number(n.slice(1))) : ENTIDADES[n]));
const atributos = bloque => {
  const valores = {};
  for (const [ , clave, valor ] of bloque.matchAll(/<(?:string|int|float|date|boolean|id) key="([^"]+)" value="([^"]*)"/g)) {
    if (!(clave in valores)) valores[clave] = decodifica(valor);
  }
  return valores;
};
const personas = bloque => [ ...bloque.matchAll(/<string key="person" value="([^"]*)"/g) ].map(m => decodifica(m[1]));

// Lo que dice un registro: su pool, su plantilla y sus carriles, y sus eventos
// con lo que hace falta aqui.
function leeRegistro(xes) {
  const cabecera = xes.slice(0, xes.indexOf('<trace>') < 0 ? xes.length : xes.indexOf('<trace>'));
  const datos = atributos(cabecera.replace(/<list[\s\S]*<\/list>/, ''));
  const plantilla = /<list key="pool:staff">([\s\S]*?)<\/list>/.exec(cabecera);
  const carriles = /<list key="pool:lanes">([\s\S]*)<\/list>\s*(?:<list key="pool:roles">|$)/.exec(cabecera);
  const deCarriles = carriles ? [ ...carriles[1].matchAll(/<list key="([^"]+)">\s*<values>([\s\S]*?)<\/values>\s*<\/list>/g) ]
    .map(([ , id, dentro ]) => ({ id, nombre: (/<string key="name" value="([^"]*)"/.exec(dentro) || [])[1], personas: personas(dentro) }))
    : [];
  const inicio = Date.parse(datos['simulation:startDate']);
  const eventos = [];
  for (const [ , traza ] of xes.matchAll(/<trace>([\s\S]*?)<\/trace>/g)) {
    const caso = atributos(traza.slice(0, traza.indexOf('<event>')))['concept:name'];
    for (const [ , bloque ] of traza.matchAll(/<event>([\s\S]*?)<\/event>/g)) {
      const e = atributos(bloque);
      if (!('time:endTime' in e)) continue;
      eventos.push({ id: `${caso}#${e['bpmn:occurrence']}`, caso, pool: e['bpmn:participant'] || datos['pool:id'],
        tipo: e['bpmn:type'], elemento: e['bpmn:id'], persona: e['bpmn:userTask'] || null,
        ejecucion: e['bpmn:execution'] === undefined ? null : Number(e['bpmn:execution']), solicitud: e['bpmn:request'] || null,
        cancelada: e['bpmn:cancelled'] === 'true', inicio: (Date.parse(e['time:timestamp']) - inicio) / 1000,
        fin: (Date.parse(e['time:endTime']) - inicio) / 1000, orden: eventos.length });
    }
  }
  return { pool: datos['pool:id'], recursos: datos['pool:resources'], plantilla: plantilla ? personas(plantilla[1]) : null,
    carriles: deCarriles, eventos };
}

// Lo que tiene que decir la plantilla de un modelo en el instante t, sacado de
// sus registros: { pool: { gente: [[persona, [ID de lo que tiene]]], cola: [ID] } }.
function previstoEn(leidos, t) {
  const previsto = {};
  for (const r of leidos) {
    const enCurso = r.eventos.filter(e => e.inicio <= t && t < e.fin);
    previsto[r.pool] = {
      gente: r.plantilla.map(p => [ p, enCurso.filter(e => e.persona === p).map(e => e.id).sort() ]),
      cola: enCurso.filter(e => e.tipo === 'StandBy').sort((a, b) => a.inicio - b.inicio || a.orden - b.orden).map(e => e.id)
    };
  }
  return previsto;
}

// Lo mismo, de lo que da la plantilla.
const vistoEn = (staff, t) => Object.fromEntries(Object.entries(staff.at(t)).map(([ pool, p ]) => [ pool, {
  gente: p.people.map(persona => [ persona.name, persona.work.map(w => w.id).sort() ]), cola: p.queue.map(q => q.id) } ]));

const instantesDe = linea => {
  const cambios = linea.changes();
  return [ ...cambios, ...cambios.slice(1).map((t, i) => (t + cambios[i]) / 2) ].sort((a, b) => a - b);
};

// Todo lo que se comprueba de un modelo, sobre una plantilla ya hecha: si se
// estropea la plantilla, tiene que fallar.
function revisa(modelo, leidos, staff, linea) {
  const problemas = [];
  for (const r of leidos) {
    const suya = staff.roster.find(p => p.pool === r.pool);
    if (!suya) {
      problemas.push(`${modelo}: falta la plantilla de ${r.pool}`);
      continue;
    }
    if (r.plantilla === null) problemas.push(`${modelo}: el registro de ${r.pool} no trae su plantilla`);
    if (comoTexto(suya.people.map(p => p.name)) !== comoTexto(r.plantilla)) {
      problemas.push(`${modelo}, ${r.pool}: ${comoTexto(suya.people.map(p => p.name))} y el registro dice ${comoTexto(r.plantilla)}`);
    }
    for (const persona of suya.people) {
      const carriles = r.carriles.filter(c => c.personas.includes(persona.name)).map(c => c.nombre ?? c.id);
      if (comoTexto(persona.lanes) !== comoTexto(carriles)) problemas.push(`${modelo}, ${persona.name}: carriles ${comoTexto(persona.lanes)}`);
    }
    if (suya.resources !== r.recursos) problemas.push(`${modelo}, ${r.pool}: recursos ${suya.resources}`);
  }
  const eventos = new Map(leidos.flatMap(r => r.eventos.map(e => [ e.id, e ])));
  for (const a of staff.assignments) {
    const e = eventos.get(a.id);
    if (!e || e.persona !== a.person || e.elemento !== a.element || e.ejecucion !== a.execution || e.solicitud !== a.request ||
      e.inicio !== a.start || e.fin !== a.end || e.pool !== a.pool) {
      problemas.push(`${modelo}: la asignacion ${a.id} no es la del XES: ${comoTexto([ a.person, a.element, a.start, a.end ])}`);
    }
  }
  const conPersona = [ ...eventos.values() ].filter(e => e.persona).length;
  if (conPersona !== staff.assignments.length) problemas.push(`${modelo}: ${staff.assignments.length} asignaciones de ${conPersona}`);
  const finitos = new Set(leidos.filter(r => r.recursos !== 'infinite').map(r => r.pool));
  const canceladas = new Set([ ...eventos.values() ].filter(e => e.cancelada).map(e => e.id));
  for (const t of instantesDe(linea)) {
    const previsto = previstoEn(leidos, t);
    const visto = vistoEn(staff, t);
    if (comoTexto(visto) !== comoTexto(previsto)) {
      const pool = Object.keys(previsto).find(p => comoTexto(visto[p]) !== comoTexto(previsto[p]));
      problemas.push(`${modelo}, t=${t}, ${pool}: ${comoTexto(visto[pool])} y el XES dice ${comoTexto(previsto[pool])}`);
    }
    for (const [ pool, p ] of Object.entries(visto)) {
      if (finitos.has(pool) && p.gente.some(([ , cosas ]) => cosas.length > 1)) problemas.push(`${modelo}, t=${t}: alguien con dos cosas a la vez`);
      if (!finitos.has(pool) && p.cola.length) problemas.push(`${modelo}, t=${t}: cola en ${pool}, con recursos infinitos`);
      if (p.cola.some(id => canceladas.has(id)) || p.gente.some(([ , cosas ]) => cosas.some(id => canceladas.has(id)))) {
        problemas.push(`${modelo}, t=${t}: una espera cancelada en la cola o en manos de alguien`);
      }
    }
  }
  return [ ...new Set(problemas) ];
}

// --- 1 a 3: todos los modelos -------------------------------------------------------

console.log('La plantilla, contra el XES:');
const leidosDe = new Map();
const plantillas = new Map();
const lineas = new Map();
{
  const problemas = [];
  let personasVistas = 0;
  let instantes = 0;
  let asignaciones = 0;
  let enCola = 0;
  for (const carpeta of carpetas) {
    const registros = registrosDe(carpeta);
    const linea = timelineFromLogs(registros);
    const leidos = registros.map(r => leeRegistro(r.xes));
    const staff = createStaff(linea);
    leidosDe.set(nombre(carpeta), leidos);
    plantillas.set(nombre(carpeta), staff);
    lineas.set(nombre(carpeta), linea);
    problemas.push(...revisa(nombre(carpeta), leidos, staff, linea));
    personasVistas += staff.roster.reduce((n, p) => n + p.people.length, 0);
    instantes += instantesDe(linea).length;
    asignaciones += staff.assignments.length;
    enCola += leidos.reduce((n, r) => n + r.eventos.filter(e => e.tipo === 'StandBy').length, 0);
  }
  informa('plantilla, ocupacion y cola', problemas, `${carpetas.length} modelos, ${personasVistas} personas, ` +
    `${asignaciones} asignaciones y ${enCola} esperas en cola, en ${instantes} instantes`);
}
{
  const problemas = [];
  const sinTrabajo = { '32-convocatorias-que-empiezan-de-cero': [ 'Pool_Orquestador', 'Carla' ],
    '08-carriles-y-subcarriles': [ 'Pool_Banco', 'Diana' ], [MODELO]: [ 'Pool_Comision', 'Hugo' ] };
  for (const [ modelo, [ pool, persona ] ] of Object.entries(sinTrabajo)) {
    const staff = plantillas.get(modelo);
    const suya = staff.roster.find(p => p.pool === pool);
    if (!suya || !suya.people.some(p => p.name === persona)) problemas.push(`${modelo}: ${persona} no esta en la plantilla`);
    const ocupada = instantesDe(lineas.get(modelo)).filter(t => staff.at(t)[pool].people.find(p => p.name === persona)?.state !== 'free');
    if (ocupada.length) problemas.push(`${modelo}: ${persona} no sale libre en t=${ocupada[0]}`);
    if (staff.assignments.some(a => a.person === persona)) problemas.push(`${modelo}: ${persona} con alguna asignacion`);
  }
  const diana = plantillas.get('08-carriles-y-subcarriles').roster.find(p => p.pool === 'Pool_Banco').people.find(p => p.name === 'Diana');
  if (comoTexto(diana?.lanes) !== comoTexto([ 'Reserva' ])) problemas.push(`Diana, en los carriles ${comoTexto(diana?.lanes)}`);
  informa('quien no trabaja, en la plantilla y libre', problemas, 'Carla en el 32, Diana -de Reserva- en el 08 y Hugo en el 39');
}

// --- 4: lo que pide la tarea -----------------------------------------------------------

console.log('\nLo que pide la tarea, con el 39:');
const staff39 = plantillas.get(MODELO);
const leidos39 = leidosDe.get(MODELO);
const eventos39 = leidos39.flatMap(r => r.eventos);
const comision = t => staff39.at(t).Pool_Comision;
const quien = t => Object.fromEntries(comision(t).people.map(p => [ p.name,
  p.work.map(w => `${w.element}${w.requestNumber === null ? '' : ` ${w.requestNumber}`}`).join(',') || 'libre' ]));
const solicitudDe = e => (e.solicitud ? Number(e.solicitud.split(' - ').pop()) : null);
{
  const problemas = [];
  const previsto = { Ana: 'Preparar_Acta', Bea: 'Evaluar 1', Carlos: 'Evaluar 2', Dani: 'Evaluar 3', Eva: 'Evaluar 4', Gema: 'libre',
    Hugo: 'libre' };
  if (comoTexto(quien(30)) !== comoTexto(previsto)) problemas.push(`a los 30 s: ${comoTexto(quien(30))}`);
  const cola = comision(30).queue;
  if (comoTexto(cola.map(q => [ q.element, q.requestNumber ])) !== comoTexto([ [ 'Evaluar', 5 ], [ 'Evaluar', 6 ], [ 'Evaluar', 7 ] ])) {
    problemas.push(`la cola a los 30 s: ${comoTexto(cola.map(q => [ q.element, q.requestNumber ]))}`);
  }

  // Mientras Ana prepara el acta, la cola de Evaluar no se vacia aunque Gema y
  // Hugo esten libres: no pueden evaluar.
  const acta = eventos39.find(e => e.elemento === 'Preparar_Acta');
  const enEspera = eventos39.filter(e => e.elemento === 'Evaluar' && e.tipo === 'StandBy');
  const solapa = enEspera.filter(e => e.inicio < acta.fin && acta.inicio < e.fin);
  if (acta.persona !== 'Ana' || solapa.length !== 3 || !eventos39.some(e => e.elemento === 'Evaluar' && e.persona === 'Ana')) {
    problemas.push('Ana no esta en otra tarea mientras su cola espera');
  }
  informa('ocupada en otra tarea', problemas, 'a los 30 s Ana prepara el acta y evaluan cuatro; en la cola, las solicitudes 5, 6 y 7');
}
{
  const problemas = [];
  const previsto = { Ana: 'Evaluar 5', Bea: 'Evaluar 1', Carlos: 'Evaluar 2', Dani: 'Evaluar 3', Eva: 'Evaluar 4', Gema: 'libre',
    Hugo: 'libre' };
  if (comoTexto(quien(40)) !== comoTexto(previsto)) problemas.push(`a los 40 s: ${comoTexto(quien(40))}`);
  const cinco = comision(40).people.flatMap(p => p.work).filter(w => w.element === 'Evaluar');
  for (const w of cinco) {
    const e = eventos39.find(x => x.id === w.id);
    if (!e || e.persona !== w.person || e.inicio !== w.start || e.fin !== w.end || solicitudDe(e) !== w.requestNumber ||
      e.ejecucion !== w.execution) problemas.push(`la asignacion ${w.id}: ${comoTexto(w)}`);
  }
  if (cinco.length !== 5 || new Set(cinco.map(w => w.request)).size !== 5) problemas.push(`${cinco.length} asignaciones a la vez`);
  if (comoTexto(comision(40).queue.map(q => q.requestNumber)) !== comoTexto([ 6, 7 ])) problemas.push('la cola a los 40 s');
  informa('las cinco asignaciones', problemas, `a los 40 s: ${cinco.map(w => `${w.person} con la ${w.requestNumber} (${w.id}, ` +
    `${w.start}-${w.end} s)`).join(', ')}`, 46);
}
{
  const problemas = [];
  const cancelada = eventos39.find(e => e.cancelada);
  if (!cancelada || cancelada.elemento !== 'Recoger' || cancelada.tipo !== 'StandByMessage') problemas.push('no hay espera cancelada en Recoger');
  else {
    for (const t of [ cancelada.inicio, (cancelada.inicio + cancelada.fin) / 2, cancelada.fin - 0.5, cancelada.fin, cancelada.fin + 0.5 ]) {
      const ahora = comision(t);
      if (ahora.queue.some(q => q.id === cancelada.id) || ahora.people.some(p => p.work.some(w => w.id === cancelada.id))) {
        problemas.push(`a los ${t} s, la espera cancelada esta en la cola o en manos de alguien`);
      }
    }
    // Al cerrar el lote, la recogida suelta a Gema en cuanto recoge la ultima.
    const ultima = eventos39.filter(e => e.elemento === 'Recoger' && e.persona).sort((a, b) => b.fin - a.fin)[0];
    const despues = comision(ultima.fin);
    if (despues.people.some(p => p.work.some(w => w.element === 'Recoger')) || despues.people.find(p => p.name === 'Gema').state !== 'free') {
      problemas.push(`a los ${ultima.fin} s alguien sigue en Recoger`);
    }
  }
  informa('libre al cancelar', problemas, `la espera ${cancelada?.id}, cancelada a los ${cancelada?.fin} s, no tiene a nadie; Gema, libre al recoger la ultima`);
}
{
  const problemas = [];
  // Dani acaba la 3 a los 49 s y toma la 6 en ese mismo instante.
  const tercera = eventos39.find(e => e.elemento === 'Evaluar' && e.persona && solicitudDe(e) === 3);
  const dani = t => comision(t).people.find(p => p.name === tercera.persona).work.map(w => w.requestNumber);
  if (comoTexto(dani(tercera.fin - 0.5)) !== comoTexto([ 3 ]) || comoTexto(dani(tercera.fin)) !== comoTexto([ 6 ])) {
    problemas.push(`${tercera.persona}: ${comoTexto(dani(tercera.fin - 0.5))} y luego ${comoTexto(dani(tercera.fin))}`);
  }
  const ultima = Math.max(...staff39.assignments.map(a => a.end));
  if (comision(ultima).busy !== 0) problemas.push(`al final, ${comision(ultima).busy} ocupadas`);
  informa('liberar y tomar la siguiente', problemas, `a los ${tercera.fin} s ${tercera.persona} suelta la 3 y toma la 6; al final, nadie ocupado`);
}

// --- Plantillas estropeadas: cada una se tiene que notar ------------------------------

{
  const problemas = [];
  const linea = lineas.get(MODELO);
  const deOtra = (cambia) => {
    const copia = { ...staff39, roster: staff39.roster.map(p => ({ ...p })), at: t => cambia.at ? cambia.at(t) : staff39.at(t) };
    if (cambia.roster) copia.roster = cambia.roster(copia.roster);
    if (cambia.assignments) copia.assignments = cambia.assignments(staff39.assignments);
    return copia;
  };
  const sinHugo = pool => ({ ...pool, people: pool.people.filter(p => p.name !== 'Hugo') });
  const cancelada = eventos39.find(e => e.cancelada);
  const controles = [
    [ 'la de las reglas de ahora, sin Hugo', deOtra({ roster: r => r.map(sinHugo),
      at: t => Object.fromEntries(Object.entries(staff39.at(t)).map(([ k, p ]) => [ k, sinHugo(p) ])) }) ],
    [ 'sin quien no trabaja', deOtra({ at: t => Object.fromEntries(Object.entries(staff39.at(t)).map(([ k, p ]) => [ k,
      { ...p, people: p.people.filter(x => staff39.assignments.some(a => a.person === x.name)) } ])) }) ],
    [ 'cada asignacion hasta su duracion maxima', deOtra({ assignments: list => list.map(a => ({ ...a,
      end: a.element === 'Evaluar' ? a.start + 40 : a.end })) }) ],
    [ 'la espera cancelada en la cola', deOtra({ at: t => Object.fromEntries(Object.entries(staff39.at(t)).map(([ k, p ]) => [ k,
      k === 'Pool_Comision' && cancelada.inicio <= t && t < cancelada.fin ? { ...p, queue: [ ...p.queue, { id: cancelada.id } ] } : p ])) }) ]
  ];
  for (const [ que, estropeada ] of controles) {
    if (!revisa(MODELO, leidos39, estropeada, linea).length) problemas.push(`${que}: no se nota`);
  }
  informa('plantillas estropeadas, se nota', problemas, controles.map(c => c[0]).join('; '));
}

// --- Donde va la plantilla, sin navegador ------------------------------------------

// placeRoster con un pool de 400 x 200 en (0, 0) y una plantilla de 150 x 120:
// a la derecha si cabe; si no, deslizandose por ese lado, a la izquierda,
// debajo o encima, y si todo esta ocupado, a la derecha, por debajo de lo que
// la tape. Y en 2000 disposiciones al azar, nunca encima de nada.
console.log('\nDonde va la plantilla:');
{
  const problemas = [];
  const pool = { x: 0, y: 0, width: 400, height: 200 };
  const tam = { width: 150, height: 120 };
  const toca = (a, b) => a.x - 4 < b.x + b.width && b.x < a.x + a.width + 4 && a.y - 4 < b.y + b.height && b.y < a.y + a.height + 4;
  const derecha = { x: 450, y: -500, width: 300, height: 1200 };
  const izquierda = { x: -350, y: -500, width: 300, height: 1200 };
  const debajo = { x: -500, y: 250, width: 1400, height: 300 };
  const encima = { x: -500, y: -400, width: 1400, height: 350 };
  const casos = [
    [ 'libre', [], { side: 'right', x: 412, y: 0 } ],
    [ 'otro pool a la derecha', [ derecha ], { side: 'left', x: -162, y: 0 } ],
    [ 'arriba a la derecha, ocupado', [ { x: 420, y: -20, width: 100, height: 40 } ], { side: 'right', x: 412, y: 30 } ],
    [ 'a los dos lados', [ derecha, izquierda ], { side: 'below', x: 0, y: 212 } ],
    [ 'a los lados y debajo', [ derecha, izquierda, debajo ], { side: 'above', x: 0, y: -132 } ],
    [ 'todo ocupado', [ derecha, izquierda, debajo, encima ], { side: 'right', x: 412, y: 705 } ]
  ];
  for (const [ que, obstaculos, previsto ] of casos) {
    const sitio = placeRoster(pool, tam, obstaculos);
    if (comoTexto(sitio) !== comoTexto(previsto)) problemas.push(`${que}: ${comoTexto(sitio)}, y se esperaba ${comoTexto(previsto)}`);
    if (obstaculos.some(o => toca({ ...sitio, ...tam }, o))) problemas.push(`${que}: tapa algo`);
  }
  let semilla = 20260101;
  const azar = () => ((semilla = (semilla * 1103515245 + 12345) % 2147483648) / 2147483648);
  let tapadas = 0;
  const lados = {};
  for (let i = 0; i < 2000; i++) {
    const obstaculos = Array.from({ length: 1 + Math.floor(azar() * 8) }, () => {
      const o = { x: -600 + azar() * 1600, y: -500 + azar() * 1200, width: 20 + azar() * 500, height: 20 + azar() * 400 };
      return toca(o, pool) ? null : o;
    }).filter(Boolean);
    const sitio = placeRoster(pool, tam, obstaculos);
    lados[sitio.side] = (lados[sitio.side] || 0) + 1;
    if (obstaculos.some(o => toca({ ...sitio, ...tam }, o)) || toca({ ...sitio, ...tam }, pool)) tapadas += 1;
  }
  if (tapadas) problemas.push(`${tapadas} de 2000 al azar tapan algo`);
  // Que al azar no salga siempre la derecha: si no, no se habria probado nada.
  if (Object.keys(lados).length < 3) problemas.push(`al azar solo salen ${comoTexto(lados)}`);
  informa('a un lado del pool, sin tapar nada', problemas, 'derecha, deslizandose, izquierda, debajo, encima y, sin sitio, ' +
    `por debajo de lo que tape; 2000 al azar sin tapar nada: ${Object.entries(lados).map(([ l, n ]) => `${n} ${l}`).join(', ')}`);
}

// --- En el navegador ---------------------------------------------------------------

console.log('\nEn el navegador:');
const BPMN_JS = join(dirname(require.resolve('bpmn-js/package.json')), 'dist');
const integracion = join(aqui, 'integracion');
const DIAGRAMAS = [ MODELO, '08-carriles-y-subcarriles', '01-simple' ];
for (const ruta of [ join(BPMN_JS, 'bpmn-modeler.development.js'), ...DIAGRAMAS.map(m => join(integracion, `${m}.bpmn`)) ]) {
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
    window.modeler.get('sceneView').load(timelineFromLogs(registros));
  };
  const caja = nodo => {
    const r = nodo.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  };
  const forma = id => {
    const gfx = document.querySelector('.djs-element[data-element-id="' + id + '"] > .djs-visual');
    return gfx && caja(gfx.firstElementChild);
  };
  // Lo dibujado en t: las plantillas, con cada persona y la cola, y las
  // pelotas con su etiqueta, con donde estan en la pantalla.
  window.mira = t => {
    window.modeler.get('sceneView').show(t);
    const capa = '.layer-simulation-drawing > g';
    const plantillas = [ ...document.querySelectorAll(capa + '.scene-roster') ].map(n => ({ ...n.dataset,
      caja: caja(n.querySelector('rect')), texto: n.textContent,
      gente: [ ...n.querySelectorAll('.scene-person') ].map(p => ({ ...p.dataset, texto: p.textContent })),
      cola: [ ...n.querySelectorAll('.scene-queue-entry') ].map(q => ({ ...q.dataset, texto: q.textContent })) }));
    const pelotas = [ ...document.querySelectorAll(capa + '.scene-ball') ].map(n => {
      const etiqueta = n.querySelector('.scene-ball-person');
      return { ...n.dataset, pelota: caja(n.querySelector('circle')), etiqueta: etiqueta && { ...etiqueta.dataset,
        texto: etiqueta.textContent, caja: caja(etiqueta.querySelector('rect')), relleno: etiqueta.querySelector('rect').getAttribute('fill') } };
    });
    return { plantillas, pelotas };
  };
  window.forma = forma;
  // Lo que una plantilla no puede tapar, en la pantalla: las formas del
  // diagrama -pools, carriles, elementos y rotulos, sin los grupos- y lo demas
  // dibujado; y la escala del lienzo, para medir en unidades del diagrama.
  window.formas = () => {
    const registro = window.modeler.get('elementRegistry');
    return [ ...document.querySelectorAll('.djs-element.djs-shape') ].map(n => ({ id: n.dataset.elementId,
      tipo: (registro.get(n.dataset.elementId) || {}).type, caja: caja(n.querySelector('.djs-visual')) }))
      .filter(f => f.tipo && f.tipo !== 'bpmn:Group' && f.caja.right > f.caja.left);
  };
  window.marcas = () => [ ...document.querySelectorAll('.layer-simulation-drawing > g:not(.scene-roster)') ]
    .filter(n => n.getAttribute('visibility') !== 'hidden').map(n => ({ clase: n.getAttribute('class'), caja: caja(n) }))
    .filter(m => m.caja.right > m.caja.left);
  window.escala = () => window.modeler.get('canvas').viewbox().scale;
  // Los solicitantes, a 50 de la comision, a su derecha o a su izquierda y a
  // su misma altura.
  window.mueve = donde => {
    const registro = window.modeler.get('elementRegistry');
    const comision = registro.get('Pool_Comision');
    const solicitante = registro.get('Pool_Solicitante');
    const x = donde === 'derecha' ? comision.x + comision.width + 50 : comision.x - 50 - solicitante.width;
    window.modeler.get('modeling').moveElements([ solicitante ], { x: x - solicitante.x, y: comision.y - solicitante.y });
    return { comision: forma('Pool_Comision'), solicitante: forma('Pool_Solicitante') };
  };
  // El marcador de multiinstancia de una tarea, en la pantalla.
  window.marcador = id => {
    const gfx = document.querySelector('.djs-element[data-element-id="' + id + '"] > .djs-visual');
    return [ ...gfx.querySelectorAll('path[data-marker="parallel"], path[data-marker="sequential"], path[data-marker="loop"]') ]
      .map(caja);
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

const solapan = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
const dentro = (a, b) => a.left >= b.left - 0.5 && a.right <= b.right + 0.5 && a.top >= b.top - 0.5 && a.bottom <= b.bottom + 0.5;

// Lo que tiene que decir una plantilla dibujada en t, del XES.
function revisaDibujo(visto, leidos, t) {
  const problemas = [];
  const previsto = previstoEn(leidos, t);
  for (const r of leidos) {
    const suya = visto.plantillas.find(p => p.pool === r.pool);
    if (!suya) {
      problemas.push(`t=${t}: sin la plantilla de ${r.pool}`);
      continue;
    }
    const gente = suya.gente.map(p => [ p.person, p.executions ? p.executions.split('|').sort() : [] ]);
    if (comoTexto(gente) !== comoTexto(previsto[r.pool].gente)) problemas.push(`t=${t}, ${r.pool}: ${comoTexto(gente)}`);
    for (const p of suya.gente) {
      const e = r.eventos.find(x => x.id === p.execution);
      if (p.state === 'free' && !/libre/.test(p.texto)) problemas.push(`t=${t}: ${p.person} libre sin decirlo`);
      if (e && r.recursos !== 'infinite' && (p.element !== e.elemento || Number(p.start) !== e.inicio || Number(p.end) !== e.fin ||
        (p.request || null) !== e.solicitud || !p.texto.includes(`ejec. ${e.ejecucion}`))) {
        problemas.push(`t=${t}: ${p.person} dice ${comoTexto(p)}`);
      }
    }
    if (r.recursos !== 'infinite' && comoTexto(suya.cola.map(q => q.id)) !== comoTexto(previsto[r.pool].cola.slice(0, 5))) {
      problemas.push(`t=${t}, ${r.pool}: la cola ${comoTexto(suya.cola.map(q => q.id))}`);
    }
    if (Number(suya.queue) !== previsto[r.pool].cola.length) problemas.push(`t=${t}, ${r.pool}: ${suya.queue} en la cola`);
  }
  return problemas;
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
  const mira = t => page.evaluate(t => window.mira(t), t);

  await monta(MODELO);

  // Lo que dice cada plantilla, en todos los instantes.
  {
    const problemas = [];
    const instantes = instantesDe(lineas.get(MODELO));
    for (const t of instantes) problemas.push(...revisaDibujo(await mira(t), leidos39, t));
    // Lo dibujado, estropeado: sin Hugo, o con Ana en la ejecucion de Bea.
    const visto = await mira(40);
    const comisionVista = visto.plantillas.find(p => p.pool === 'Pool_Comision');
    const conGente = gente => ({ ...visto, plantillas: visto.plantillas.map(p => (p === comisionVista ? { ...p, gente } : p)) });
    const bea = comisionVista.gente.find(p => p.person === 'Bea');
    const estropeados = [ conGente(comisionVista.gente.filter(p => p.person !== 'Hugo')),
      conGente(comisionVista.gente.map(p => (p.person === 'Ana' ? { ...p, executions: bea.executions, execution: bea.execution } : p))) ];
    if (estropeados.some(e => !revisaDibujo(e, leidos39, 40).length)) problemas.push('lo dibujado estropeado no se nota');
    informa('lo que dice la plantilla dibujada', problemas, `39: las dos, en ${instantes.length} instantes, como el XES; estropeada, se nota`);
  }

  // Junto a su pool, sin solaparse.
  {
    const problemas = [];
    const visto = await mira(40);
    const pools = await page.evaluate(() => [ 'Pool_Comision', 'Pool_Solicitante' ].map(id => window.forma(id)));
    visto.plantillas.forEach(p => {
      const pool = pools[[ 'Pool_Comision', 'Pool_Solicitante' ].indexOf(p.pool)];
      if (!(p.caja.left > pool.right && p.caja.left - pool.right < 40 && Math.abs(p.caja.top - pool.top) < 2)) {
        problemas.push(`${p.pool}: la plantilla no esta junto a su pool, a la derecha`);
      }
    });
    if (visto.plantillas.length !== 2 || solapan(visto.plantillas[0].caja, visto.plantillas[1].caja)) problemas.push('las plantillas se solapan');
    const comisionVista = visto.plantillas.find(p => p.pool === 'Pool_Comision');
    if (!/Hugo/.test(comisionVista.texto) || !/Cola del pool: 2/.test(comisionVista.texto)) problemas.push(`dice ${comisionVista.texto}`);
    const solicitante = visto.plantillas.find(p => p.pool === 'Pool_Solicitante');
    if (!/recursos infinitos/.test(solicitante.texto) || solicitante.cola.length) problemas.push(`los solicitantes: ${solicitante.texto}`);

    // fit() encaja tambien las plantillas.
    const fuera = await page.evaluate(() => {
      window.modeler.get('sceneView').fit();
      const lienzo = document.querySelector('#lienzo').getBoundingClientRect();
      return [ ...document.querySelectorAll('.scene-roster rect:first-of-type') ].map(r => r.getBoundingClientRect())
        .filter(r => r.right > lienzo.right || r.bottom > lienzo.bottom || r.left < lienzo.left || r.top < lienzo.top).length;
    });
    if (fuera) problemas.push(`con fit(), ${fuera} plantillas fuera del lienzo`);
    informa('junto a su pool', problemas, 'a la derecha de cada pool, sin solaparse; con fit(), dentro del lienzo');
  }

  // Sin tapar nada del diagrama, tampoco otro pool: el 39 tal cual, con los
  // solicitantes a 50 a la derecha de la comision -menos de lo que ocupa su
  // plantilla, que ya no cabe ahi- y a 50 a su izquierda. En todos los
  // instantes, cada plantilla junto a su pool, en el mismo sitio de principio
  // a fin, sin tapar ninguna forma -tampoco Ini_S, el inicio de los
  // solicitantes-, ni lo demas dibujado, ni la otra plantilla.
  {
    const problemas = [];
    const disposiciones = [ [ 'tal cual', null, { Pool_Comision: 'right', Pool_Solicitante: 'right' } ],
      [ 'a la derecha', 'derecha', { Pool_Comision: 'left', Pool_Solicitante: 'right' } ],
      [ 'a la izquierda', 'izquierda', { Pool_Comision: 'right', Pool_Solicitante: 'left' } ] ];
    const instantes = lineas.get(MODELO).changes();
    for (const [ que, donde, lados ] of disposiciones) {
      await monta(MODELO);
      if (donde) {
        const pools = await page.evaluate(donde => window.mueve(donde), donde);
        const separacion = donde === 'derecha' ? pools.solicitante.left - pools.comision.right : pools.comision.left - pools.solicitante.right;
        if (Math.abs(separacion / await page.evaluate(() => window.escala()) - 50) > 1) problemas.push(`${que}: no se han movido`);
      }
      const escala = await page.evaluate(() => window.escala());
      const sitios = new Map();
      for (const t of instantes) {
        const visto = await mira(t);
        const formas = await page.evaluate(() => window.formas());
        const marcas = await page.evaluate(() => window.marcas());
        for (const p of visto.plantillas) {
          const tapa = formas.filter(f => solapan(f.caja, p.caja)).map(f => f.id);
          if (tapa.length) problemas.push(`${que}, t=${t}: la plantilla de ${p.pool} tapa ${tapa.slice(0, 4).join(', ')}`);
          const marca = marcas.find(m => solapan(m.caja, p.caja));
          if (marca) problemas.push(`${que}, t=${t}: la plantilla de ${p.pool} tapa ${marca.clase}`);
          const otra = visto.plantillas.find(o => o !== p && solapan(o.caja, p.caja));
          if (otra) problemas.push(`${que}, t=${t}: se solapan las plantillas`);
          if (p.side !== lados[p.pool]) problemas.push(`${que}: la de ${p.pool} va a ${p.side}, y se esperaba ${lados[p.pool]}`);
          const pool = formas.find(f => f.id === p.pool).caja;
          const huecos = { right: p.caja.left - pool.right, left: pool.left - p.caja.right, below: p.caja.top - pool.bottom,
            above: pool.top - p.caja.bottom };
          const hueco = huecos[p.side] / escala;
          const deLado = p.side === 'right' || p.side === 'left'
            ? p.caja.top < pool.bottom && p.caja.bottom > pool.top : p.caja.left < pool.right && p.caja.right > pool.left;
          if (!(hueco >= 0 && hueco <= 20 && deLado)) problemas.push(`${que}, t=${t}: la de ${p.pool} no esta junto a su pool`);
          const sitio = `${p.side} ${Math.round(p.side === 'left' ? p.caja.right : p.caja.left)} ` +
            `${Math.round(p.side === 'above' ? p.caja.bottom : p.caja.top)}`;
          if (!sitios.has(p.pool)) sitios.set(p.pool, new Set());
          sitios.get(p.pool).add(sitio);
        }
        if (visto.plantillas.length !== 2) problemas.push(`${que}, t=${t}: ${visto.plantillas.length} plantillas`);
      }
      for (const [ pool, vistos ] of sitios) if (vistos.size !== 1) problemas.push(`${que}: la de ${pool} cambia de sitio`);
    }
    await monta(MODELO);
    informa('sin tapar otro pool', problemas, `39 tal cual, y con los solicitantes a 50 a la derecha -la de la comision ` +
      `pasa a su izquierda- y a la izquierda, en ${instantes.length} instantes: sin tapar nada, cada una en su sitio`);
  }

  // En la tarea, quien atiende que solicitud.
  {
    const problemas = [];
    const visto = await mira(40);
    const evaluar = visto.pelotas.filter(p => p.element === 'Evaluar');
    const trabajan = evaluar.filter(p => p.state === 'working');
    const etiquetas = trabajan.map(p => p.etiqueta && `${p.etiqueta.person} ${p.etiqueta.requestNumber}`).sort();
    if (comoTexto(etiquetas) !== comoTexto([ 'Ana 5', 'Bea 1', 'Carlos 2', 'Dani 3', 'Eva 4' ])) problemas.push(`etiquetas ${comoTexto(etiquetas)}`);
    if (trabajan.some(p => p.etiqueta && p.etiqueta.texto.replace(/\s+/g, ' ') !== `${p.etiqueta.person} ${p.etiqueta.requestNumber}`)) {
      problemas.push('una etiqueta no dice persona y solicitud');
    }
    if (evaluar.some(p => p.state !== 'working' && p.etiqueta)) problemas.push('una pelota que no trabaja con etiqueta');
    const tarea = await page.evaluate(() => window.forma('Evaluar'));
    const ancho = (tarea.right - tarea.left) / 3;
    const franja = { left: tarea.left + ancho, right: tarea.left + 2 * ancho, top: tarea.top, bottom: tarea.bottom };
    const cajas = trabajan.flatMap(p => [ p.pelota, p.etiqueta.caja ]);
    if (trabajan.some(p => !dentro(p.pelota, franja) || !dentro(p.etiqueta.caja, franja))) problemas.push('fuera de la franja de dentro');
    if (cajas.some((a, i) => cajas.some((b, j) => i < j && solapan(a, b)))) problemas.push('etiquetas o pelotas que se tapan');
    const marcador = await page.evaluate(() => window.marcador('Evaluar'));
    if (!marcador.length) problemas.push('no se encuentra el marcador de multiinstancia');
    if (marcador.some(m => cajas.some(c => solapan(c, m)))) problemas.push('una etiqueta tapa el marcador de multiinstancia');
    const relleno = trabajan.find(p => p.etiqueta.person === 'Ana').etiqueta.relleno;
    if (!relleno || relleno === '#ffffff') problemas.push('la etiqueta sin el color de su solicitud');
    informa('quien atiende que solicitud', problemas, '39, a los 40 s: Ana 5, Bea 1, Carlos 2, Dani 3, Eva 4, en la franja de dentro');
  }

  // Cambiar despues las reglas en el diagrama no cambia la plantilla.
  {
    const problemas = [];
    const antes = await mira(40);
    const cambio = await page.evaluate(async () => {
      const evaluar = xml => (/<bpmn:task id="Evaluar"[\s\S]*?<\/bpmn:task>/.exec(xml) || [ '' ])[0];
      const antes = evaluar((await window.modeler.saveXML()).xml);
      const registro = window.modeler.get('elementRegistry');
      const modeling = window.modeler.get('modeling');
      const comision = registro.get('Pool_Comision');
      const fuera = (elemento, nombre) => {
        const ext = elemento.businessObject.extensionElements;
        modeling.updateModdleProperties(elemento, ext, { values: ext.values.filter(v => !nombre(v.$body)) });
      };
      fuera(comision, persona => persona === 'Hugo');
      fuera(registro.get('Evaluar'), persona => persona !== 'Ana');
      modeling.updateLabel(comision, 'Otra comision');
      const { xml } = await window.modeler.saveXML();
      return { hugo: xml.includes('>Hugo<'), beaAntes: antes.includes('>Bea<'), bea: evaluar(xml).includes('>Bea<'),
        ana: evaluar(xml).includes('>Ana<'), nombre: xml.includes('Otra comision') };
    });
    if (cambio.hugo || !cambio.beaAntes || cambio.bea || !cambio.ana || !cambio.nombre) {
      problemas.push(`el diagrama no ha cambiado: ${comoTexto(cambio)}`);
    }
    const despues = await mira(40);
    const resumen = v => v.plantillas.map(p => [ p.pool, p.texto, p.gente, p.cola ]);
    if (comoTexto(resumen(despues)) !== comoTexto(resumen(antes))) problemas.push('la plantilla ha cambiado con las reglas');
    problemas.push(...revisaDibujo(despues, leidos39, 40));
    if (!/Comision/.test(despues.plantillas.find(p => p.pool === 'Pool_Comision').texto)) problemas.push('el nombre del pool no es el del registro');

    // Y como al volver a abrirlo: el diagrama cambiado, guardado y abierto, y
    // los registros cargados despues.
    const guardado = await page.evaluate(async () => (await window.modeler.saveXML()).xml);
    await page.evaluate(([ xml, registros ]) => window.monta(xml, registros), [ guardado, registrosDe(MODELO) ]);
    const reabierto = await mira(40);
    if (comoTexto(resumen(reabierto)) !== comoTexto(resumen(antes))) problemas.push('reabierto con las reglas cambiadas, otra plantilla');
    problemas.push(...revisaDibujo(reabierto, leidos39, 40));

    // fit() no cuenta las marcas ocultas: sin Evaluar, su insignia no esta en
    // ningun sitio.
    const encaje = await page.evaluate(() => {
      const vista = window.modeler.get('sceneView');
      const canvas = window.modeler.get('canvas');
      window.modeler.get('modeling').removeElements([ window.modeler.get('elementRegistry').get('Evaluar') ]);
      vista.show(60);
      const ocultas = [ ...document.querySelectorAll('.layer-simulation-drawing > g[visibility="hidden"]') ].length;
      vista.fit();
      const diagrama = canvas.getActiveLayer().getBBox();
      return { ocultas, x: canvas.viewbox().x, y: canvas.viewbox().y, diagrama: { x: diagrama.x, y: diagrama.y } };
    });
    if (!encaje.ocultas || encaje.x < encaje.diagrama.x - 11 || encaje.y < encaje.diagrama.y - 41) {
      problemas.push(`fit() con marcas ocultas: ${comoTexto(encaje)}`);
    }

    // En el 08, borrar el carril de Diana.
    await monta('08-carriles-y-subcarriles');
    const t08 = 30;
    const antes08 = await mira(t08);
    const sinDiana = await page.evaluate(async () => {
      window.modeler.get('modeling').removeElements([ window.modeler.get('elementRegistry').get('Carril_Reserva') ]);
      return (await window.modeler.saveXML()).xml.includes('Diana');
    });
    const despues08 = await mira(t08);
    if (sinDiana) problemas.push('el 08 sigue con Diana');
    if (comoTexto(resumen(despues08)) !== comoTexto(resumen(antes08))) problemas.push('el 08 ha cambiado con las reglas');
    const diana = despues08.plantillas.find(p => p.pool === 'Pool_Banco')?.gente.find(p => p.person === 'Diana');
    if (!diana || diana.state !== 'free' || diana.lanes !== 'Reserva') problemas.push(`Diana: ${comoTexto(diana)}`);
    problemas.push(...revisaDibujo(despues08, leidosDe.get('08-carriles-y-subcarriles'), t08));
    informa('aunque cambien las reglas', problemas, 'sin Hugo, Evaluar solo para Ana y otro nombre, tambien reabierto; ' +
      'el 08 sin el carril de Diana');
  }

  // Un Process: a la derecha del diagrama.
  {
    const problemas = [];
    await monta('01-simple');
    const linea = lineas.get('01-simple');
    const t = linea.changes()[2];
    const visto = await mira(t);
    const formas = await page.evaluate(() => [ ...document.querySelectorAll('.djs-element.djs-shape > .djs-visual') ]
      .map(n => n.firstElementChild.getBoundingClientRect()).map(r => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom })));
    const [ plantilla ] = visto.plantillas;
    if (visto.plantillas.length !== 1 || formas.some(f => solapan(f, plantilla.caja)) ||
      !(plantilla.caja.left >= Math.max(...formas.map(f => f.right)))) problemas.push('la plantilla no esta a la derecha del diagrama');
    problemas.push(...revisaDibujo(visto, leidosDe.get('01-simple'), t));
    informa('en un Process', problemas, `01, a los ${t} s: a la derecha de todo, sin tapar nada`);
  }

  informa('sin errores ni ventanas', incidencias, 'ninguno');
} finally {
  await navegador.close();
  servidor.cierra();
}

console.log(fallos ? `\nPlantilla en rojo: ${fallos} problema(s).` : `\nPlantilla en verde: ${carpetas.length} modelos.`);
process.exit(fallos ? 1 : 0);
