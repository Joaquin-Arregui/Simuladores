// La pelota del caso y el sobre (6.3), con los registros de referencia.
//
//     node pruebas/escena.mjs
//
// Construye con Modeler/lib/scene la escena de cada modelo que tiene registros
// congelados en esperado/, con los flujos de sus reglas (modelos/), y comprueba
// sin navegador:
//
// 1. Los sobres: cada envio tiene la recepcion que lo recoge y cada recepcion,
//    un solo envio; nadie recoge un sobre antes de que salga; cada sobre tiene
//    su ID y su flujo de mensaje, y su solicitud es la de su remitente o la de
//    su destinatario, con los numeros de esos casos.
// 2. En cada instante en que cambia algo y a mitad de cada dos: una pelota por
//    cada pieza activa de la linea de tiempo, con su ID y el numero de su caso
//    dentro de su pool; los casos se cuentan una vez, tengan las pelotas que
//    tengan; y un sobre se ve entre que sale y que lo recogen. Lo que hay en
//    cada buzon tiene que cuadrar tambien por cuentas, sin emparejar nada: los
//    sobres que han salido hacia el, menos los que su caso ha recogido, que son
//    sus recepciones empezadas y sus esperas a una persona en curso.
// 3. Que el transito es cosmetico: con el, las mismas pelotas, en los mismos
//    elementos y estados, y los mismos casos; solo se anaden donde dibujarlas
//    -en un flujo que llega a su elemento, o en el de mensaje del sobre-, y los
//    sobres que acaban de salir. Y que el instante no depende de como se llega
//    a el: recorrer los instantes hacia delante y hacia atras da lo mismo.
// 4. Lo que pide la tarea: el 1:1 muestra la espera durante el intercambio, y
//    un paralelo, varias pelotas del mismo caso sin contarlas como casos
//    nuevos. Tambien los sobres de un mismo caso: los de una convocatoria a la
//    vez en el buzon, los de una misma pareja uno detras de otro, y los de dos
//    activaciones de la misma recepcion con el mismo remitente (37), donde la
//    espera de mensaje de una se tomaba por la de la otra.
//
// Despues, en un Chromium de verdad, la vista (lib/scene/view.js) sobre el
// bpmn-js de las dependencias del Modeler: pelotas, sobres y reloj donde
// tienen que estar en la pantalla, que se reutilizan de un instante a otro y
// siguen a su elemento al ampliar, y que al abrir otro diagrama no queda nada,
// ni la simulacion: show pide cargar la del nuevo.
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
const { formatInstant } = await import(pathToFileURL(join(lib, 'scene', 'view.js')).href);

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

// Los flujos de un modelo, de sus reglas: lo mismo que graphFromRegistry saca
// del diagrama abierto, para los modelos que no tienen .bpmn.
function grafoDeReglas(texto) {
  const grafo = { sequenceFlows: [], messageFlows: [] };
  const valor = (linea, clave) => (new RegExp(`\\b${clave}='([^']*)'`).exec(linea) || [])[1];
  for (const linea of texto.split('\n')) {
    const tipo = /type=bpmn:(SequenceFlow|MessageFlow)\b/.exec(linea);
    if (!tipo) continue;
    const flujo = { id: valor(linea, 'id_bpmn'), source: valor(linea, 'superElement'), target: valor(linea, 'subElement'),
      name: valor(linea, 'name') || '' };
    (tipo[1] === 'SequenceFlow' ? grafo.sequenceFlows : grafo.messageFlows).push(flujo);
  }
  return grafo;
}
const reglasDe = carpeta => [ join(aqui, 'modelos', `${nombre(carpeta)}.txt`), join(aqui, 'modelos-con-avisos', `${nombre(carpeta)}.txt`) ]
  .find(existsSync);

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

// --- 1 a 3: todos los modelos --------------------------------------------------

// Lo que se compara de una pelota para ver que el transito no la cambia.
const esencia = pelota => [ pelota.id, pelota.case, pelota.pool, pelota.number, pelota.element, pelota.state,
  pelota.execution, pelota.request, pelota.user, pelota.cancelled, pelota.since ];
const comoTexto = valor => JSON.stringify(valor);

function revisa(carpeta, estropea = escena => escena) {
  const problemas = [];
  const linea = timelineFromLogs(registrosDe(carpeta));
  const reglas = reglasDe(carpeta);
  if (!reglas) return { problemas: [ 'no tiene reglas en modelos/ ni en modelos-con-avisos/' ] };
  const grafo = grafoDeReglas(readFileSync(reglas, 'utf8'));
  const escena = estropea(createScene(linea, grafo));
  const casos = new Map(linea.cases.map(caso => [ caso.id, caso ]));
  const piezas = new Map(linea.items.map(pieza => [ pieza.id, pieza ]));
  const llegan = new Map(grafo.sequenceFlows.map(flujo => [ flujo.id, flujo.target ]));

  // (1) Los sobres.
  const sobres = escena.messages;
  const envios = linea.items.filter(p => p.destination && p.target);
  const recepciones = linea.items.filter(p => p.origin && p.sender);
  if (sobres.length !== envios.length) problemas.push(`${envios.length} envios y ${sobres.length} sobres`);
  const recogidas = sobres.map(s => s.reception).filter(Boolean);
  if (recogidas.length !== recepciones.length || new Set(recogidas).size !== recogidas.length) {
    problemas.push(`${recepciones.length} recepciones y ${new Set(recogidas).size} recogen un sobre`);
  }
  if (new Set(sobres.map(s => s.id)).size !== sobres.length) problemas.push('dos sobres con el mismo ID');
  const flujosDeMensaje = new Map(grafo.messageFlows.map(f => [ f.id, f ]));
  for (const sobre of sobres) {
    const recepcion = piezas.get(sobre.reception);
    if (!recepcion) {
      problemas.push(`${sobre.id}: nadie lo recoge`);
      continue;
    }
    if (recepcion.case !== sobre.target || recepcion.sender !== sobre.sender || recepcion.element !== sobre.to ||
      recepcion.origin !== sobre.from) {
      problemas.push(`${sobre.id}: lo recoge ${recepcion.id}, que no es de su pareja`);
    }
    if (!(sobre.pickup >= sobre.sent)) problemas.push(`${sobre.id}: lo recogen en t=${sobre.pickup}, antes de salir en t=${sobre.sent}`);
    if (sobre.pickup > recepcion.start) problemas.push(`${sobre.id}: lo recogen despues de que empiece su recepcion`);
    const flujo = flujosDeMensaje.get(sobre.flow);
    if (!flujo || flujo.source !== sobre.from || flujo.target !== sobre.to) problemas.push(`${sobre.id}: sin su flujo de mensaje`);
    if (sobre.request !== sobre.sender && sobre.request !== sobre.target) {
      problemas.push(`${sobre.id}: de ${sobre.sender} a ${sobre.target}, con la solicitud de ${sobre.request}`);
    }
    const numeros = [ sobre.sender, sobre.target, sobre.request ].map(id => casos.get(id)?.instance ?? null);
    if (comoTexto(numeros) !== comoTexto([ sobre.numbers.sender, sobre.numbers.target, sobre.numbers.request ])) {
      problemas.push(`${sobre.id}: lleva los numeros ${comoTexto(sobre.numbers)}`);
    }
  }

  // El buzon por cuentas, sin emparejar nada: en el instante t, los sobres que
  // han salido de un elemento hacia el de un caso, menos los que ese caso ha
  // recogido ya por ese elemento. Una ejecucion de una recepcion recoge su
  // sobre al acabar de esperarlo -o al activarse, si ya estaba- y enseguida
  // espera a una persona o trabaja: los recogidos son sus recepciones empezadas
  // y sus esperas a una persona en curso, sean de la activacion que sean.
  const origenes = new Map(recepciones.map(p => [ p.element, p.origin ]));
  const esperasDePersona = linea.items.filter(p => p.state === 'waiting-user' && origenes.has(p.element));
  const buzonPorCuentas = t => {
    const cuenta = new Map();
    const suma = (clave, n) => cuenta.set(clave, (cuenta.get(clave) || 0) + n);
    for (const p of envios) if ((p.interval ? p.end : p.start) <= t) suma(comoTexto([ p.element, p.destination, p.case, p.target ]), 1);
    for (const p of recepciones) if (p.start <= t) suma(comoTexto([ p.origin, p.element, p.sender, p.case ]), -1);
    for (const p of esperasDePersona) {
      if (p.start <= t && t < p.end) suma(comoTexto([ origenes.get(p.element), p.element, p.request, p.case ]), -1);
    }
    return [ ...cuenta ].filter(([ , n ]) => n).sort();
  };
  const buzonDeLaEscena = sobres => {
    const cuenta = new Map();
    for (const s of sobres) {
      const clave = comoTexto([ s.from, s.to, s.sender, s.target ]);
      cuenta.set(clave, (cuenta.get(clave) || 0) + 1);
    }
    return [ ...cuenta ].sort();
  };

  // (2) y (3) Cada instante, con y sin transito.
  const cambios = linea.changes();
  const instantes = [ ...new Set([ ...cambios, ...cambios.slice(1).map((t, i) => (t + cambios[i]) / 2) ]) ].sort((a, b) => a - b);
  const TRANSITO = 4;
  let maximo = { pelotas: 0 };
  let enElBuzon = 0;
  const hacia = new Map();
  for (const t of instantes) {
    const escenaEn = escena.at(t);
    hacia.set(t, comoTexto(escenaEn));
    const ids = escenaEn.balls.map(p => p.id);
    if (new Set(ids).size !== ids.length) problemas.push(`t=${t}: dos pelotas con el mismo ID`);
    const activas = [ ...linea.at(t).values() ].flat().map(p => p.id).sort();
    if (comoTexto([ ...ids ].sort()) !== comoTexto(activas)) problemas.push(`t=${t}: las pelotas no son las piezas activas`);
    const porCaso = new Map();
    for (const pelota of escenaEn.balls) {
      const caso = casos.get(pelota.case);
      if (!caso || pelota.pool !== caso.pool || pelota.number !== caso.instance) {
        problemas.push(`t=${t}: ${pelota.id} lleva el numero ${pelota.number} en ${pelota.pool}`);
      }
      porCaso.set(pelota.case, (porCaso.get(pelota.case) || 0) + 1);
    }
    const contados = Object.entries(escenaEn.cases).flatMap(([ pool, lista ]) => lista.map(id => `${pool}|${id}`)).sort();
    const conPelota = [ ...porCaso.keys() ].map(id => `${casos.get(id).pool}|${id}`).sort();
    if (comoTexto(contados) !== comoTexto(conPelota)) problemas.push(`t=${t}: los casos contados no son los que tienen pelota`);
    for (const [ caso, n ] of porCaso) if (n > maximo.pelotas) maximo = { pelotas: n, caso, t };
    for (const sobre of escenaEn.envelopes) {
      if (!(sobre.sent <= t && t < sobre.pickup) || sobre.transit) problemas.push(`t=${t}: ${sobre.id} se ve fuera de su buzon`);
      if (sobre.sent < t) enElBuzon += 1;
    }
    const porCuentas = buzonPorCuentas(t);
    if (comoTexto(buzonDeLaEscena(escenaEn.envelopes)) !== comoTexto(porCuentas)) {
      problemas.push(`t=${t}: en el buzon hay ${comoTexto(buzonDeLaEscena(escenaEn.envelopes))}, y por cuentas ${comoTexto(porCuentas)}`);
    }

    const conTransito = escena.at(t, { transit: TRANSITO });
    if (comoTexto(conTransito.balls.map(esencia)) !== comoTexto(escenaEn.balls.map(esencia)) ||
      comoTexto(conTransito.cases) !== comoTexto(escenaEn.cases) || conTransito.t !== t) {
      problemas.push(`t=${t}: con transito, otras pelotas u otros casos`);
    }
    for (const pelota of conTransito.balls.filter(p => p.transit)) {
      const { flow, fraction } = pelota.transit;
      const pieza = piezas.get(pelota.id);
      const viaje = Math.min(TRANSITO, (pieza.end - pieza.start) / 2);
      if (llegan.get(flow) !== pelota.element || !(fraction >= 0 && fraction < 1) ||
        Math.abs(fraction - (t - pieza.start) / viaje) > 1e-9) {
        problemas.push(`t=${t}: ${pelota.id} en transito por ${flow} a ${fraction}, hacia ${pelota.element}`);
      }
    }
    const visibles = new Set(escenaEn.envelopes.map(s => s.id));
    const conTransitoIds = new Set(conTransito.envelopes.map(s => s.id));
    if ([ ...visibles ].some(id => !conTransitoIds.has(id))) problemas.push(`t=${t}: con transito, desaparece un sobre del buzon`);
    for (const sobre of conTransito.envelopes) {
      const viaja = t - sobre.sent < TRANSITO;
      if (sobre.transit ? !viaja || sobre.transit.flow !== sobre.flow || sobre.transit.fraction !== (t - sobre.sent) / TRANSITO
        : !visibles.has(sobre.id)) {
        problemas.push(`t=${t}: ${sobre.id} con transito ${comoTexto(sobre.transit)}, salio en t=${sobre.sent}`);
      }
    }
  }
  // Hacia atras, lo mismo: el instante no depende de como se llega a el.
  for (const t of [ ...instantes ].reverse()) {
    if (comoTexto(escena.at(t)) !== hacia.get(t)) problemas.push(`t=${t}: hacia atras da otra escena`);
  }
  return { linea, escena, problemas, maximo, enElBuzon, instantes: instantes.length };
}

console.log('Escena de cada modelo:');
const escenas = {};
for (const carpeta of carpetas) {
  let resultado;
  try {
    resultado = revisa(carpeta);
  } catch (error) {
    resultado = { problemas: [ `no se puede construir: ${error.message}` ] };
  }
  const { escena, problemas, maximo, enElBuzon, instantes } = resultado;
  if (escena) escenas[nombre(carpeta)] = escena;
  informa(nombre(carpeta), [ ...new Set(problemas) ], problemas.length ? '' : `${instantes} instantes, ${escena.messages.length} sobres` +
    `${enElBuzon ? ', con esperas en el buzon' : ''}; hasta ${maximo.pelotas} pelota(s) de un caso`, 40);
}

// Para ver que las comprobaciones distinguen, se repiten con tres escenas
// estropeadas a proposito, y cada una tiene que fallar en lo suyo: una que
// cuenta las pelotas como casos, una que reparte los sobres de un buzon al
// reves -el primero que sale, para la ultima recepcion; en el 25, el servicio
// manda dos respuestas por el mismo flujo al mismo cliente- y una cuyo transito
// retrasa el instante, como si la pelota tardara de verdad en llegar.
const CONTROLES = [
  [ 'pelotas contadas como casos', '35-proceso-base', /los casos contados no son/, escena => ({
    ...escena,
    at(t, opciones) {
      const instante = escena.at(t, opciones);
      const cases = {};
      for (const pelota of instante.balls) (cases[pelota.pool] ||= []).push(pelota.case);
      return { ...instante, cases };
    }
  }) ],
  [ 'buzon al reves', '25-parejas-con-varias-respuestas', /antes de salir/, escena => {
    const grupos = new Map();
    for (const sobre of escena.messages) {
      const clave = comoTexto([ sobre.from, sobre.to, sobre.sender, sobre.target ]);
      if (!grupos.has(clave)) grupos.set(clave, []);
      grupos.get(clave).push(sobre);
    }
    const messages = escena.messages.map(sobre => {
      const grupo = grupos.get(comoTexto([ sobre.from, sobre.to, sobre.sender, sobre.target ]));
      const otro = grupo[grupo.length - 1 - grupo.indexOf(sobre)];
      return { ...sobre, reception: otro.reception, pickup: otro.pickup };
    });
    return { ...escena, messages };
  } ],
  [ 'transito que retrasa el instante', '02-colaboracion', /con transito, otras pelotas/, escena => ({
    ...escena,
    at: (t, opciones = {}) => (opciones.transit ? { ...escena.at(t - opciones.transit), t } : escena.at(t))
  }) ]
];
console.log('\nCon escenas estropeadas:');
for (const [ que, carpeta, previsto, estropea ] of CONTROLES) {
  const { problemas } = revisa(carpeta, estropea);
  informa(que, problemas.some(p => previsto.test(p)) ? [] : [ `no se nota: ${comoTexto(problemas.slice(0, 3))}` ],
    `${carpeta}: la comprobacion lo distingue`, 40);
}

// --- 4: lo que pide la tarea -----------------------------------------------------

console.log('\nLo que pide la tarea:');
const describe = pelotas => pelotas.map(p => `${p.element}:${p.state}#${p.number}`).sort();
const de = (escena, t, caso, opciones) => escena.at(t, opciones).balls.filter(p => p.case === caso);

// El 1:1: el cliente 1 manda su peticion a los 16 s y espera la respuesta,
// que el servicio 1 le manda a los 120 s.
{
  const escena = escenas['02-colaboracion'];
  const problemas = [];
  if (!escena) problemas.push('falta el 02-colaboracion');
  else {
    const instantes = escena.timeline.changes().filter(t => t > 16 && t < 120);
    const mitades = instantes.slice(1).map((t, i) => (t + instantes[i]) / 2);
    const recorre = new Set();
    for (const t of [ 16, ...instantes, ...mitades ]) {
      const cliente = describe(de(escena, t, 'Pool_Cliente - 1'));
      if (comoTexto(cliente) !== comoTexto([ 'Esperar_Respuesta:waiting-message#1' ])) {
        problemas.push(`t=${t}: el cliente 1 esta en ${comoTexto(cliente)}`);
      }
      de(escena, t, 'Pool_Servicio - 1').forEach(p => recorre.add(`${p.element}:${p.state}`));
    }
    const previsto = [ 'Atender:working', 'Enviar_Respuesta:working', 'Recibir_Peticion:working' ];
    if (comoTexto([ ...recorre ].sort()) !== comoTexto(previsto)) {
      problemas.push(`mientras, el servicio 1 pasa por ${comoTexto([ ...recorre ].sort())}`);
    }
    const sobres = escena.messages.filter(s => s.request === 'Pool_Cliente - 1')
      .map(s => [ s.message, s.sender, s.target, s.sent, s.pickup, `${s.numbers.sender}→${s.numbers.target}` ]);
    const sobresPrevistos = [
      [ 'Peticion', 'Pool_Cliente - 1', 'Pool_Servicio - 1', 16, 16, '1→1' ],
      [ 'Respuesta', 'Pool_Servicio - 1', 'Pool_Cliente - 1', 120, 120, '1→1' ]
    ];
    if (comoTexto(sobres) !== comoTexto(sobresPrevistos)) problemas.push(`sus sobres son ${comoTexto(sobres)}`);
    const despues = describe(de(escena, 120, 'Pool_Cliente - 1'));
    if (comoTexto(despues) !== comoTexto([ 'Esperar_Respuesta:working#1' ])) problemas.push(`a los 120 s, el cliente 1 esta en ${despues}`);
  }
  informa('el 1:1 muestra la espera', problemas,
    'el cliente 1 espera en Esperar_Respuesta de 16 a 120 s, mientras el servicio 1 recibe, atiende y responde');
}
{
  // Con transito, el sobre recorre su flujo, y el cliente sigue esperando.
  const escena = escenas['02-colaboracion'];
  const problemas = [];
  const en18 = escena && escena.at(18, { transit: 4 });
  const peticion = en18 && en18.envelopes.find(s => s.message === 'Peticion' && s.sender === 'Pool_Cliente - 1');
  if (!peticion || comoTexto(peticion.transit) !== comoTexto({ flow: 'Mensaje_Peticion', fraction: 0.5 })) {
    problemas.push(`a los 18 s, la peticion del cliente 1 va ${comoTexto(peticion && peticion.transit)}`);
  }
  if (escena && escena.at(18).envelopes.length) problemas.push('sin transito, a los 18 s hay sobres: ya la han recogido');
  if (escena && comoTexto(describe(de(escena, 18, 'Pool_Cliente - 1', { transit: 4 }))) !==
    comoTexto([ 'Esperar_Respuesta:waiting-message#1' ])) {
    problemas.push('con transito, el cliente 1 ya no espera');
  }
  const reloj = formatInstant('2026-01-05T09:00:00+01:00', 18);
  if (reloj !== 't = 18 s · 2026-01-05 09:00:18') problemas.push(`el reloj dice «${reloj}»`);
  informa('el transito no cambia el instante', problemas, 'a los 18 s, la peticion va por la mitad de su flujo; el reloj, en 18 s');
}

// Un paralelo: varias pelotas del mismo caso, que cuenta como uno.
for (const [ que, modelo, t, caso, previsto ] of [
  [ 'ramas paralelas', '03-uniones-y-bucle', 20, 'Instance 1', [ 'Tarea_A:working#1', 'Tarea_B:working#1' ] ],
  [ 'la recepcion y la tarea, a la vez', '12-dos-activaciones', 7.5, 'Pool_Orquestador - 1',
    [ 'Recoger:waiting-message#1', 'Valorar:working#1' ] ],
  [ 'diez ejecuciones del lote', '35-proceso-base', 150, 'Pool_SACU - 1', [
    ...Array(3).fill('Evaluar_Propuestas:working#1'), ...Array(7).fill('Evaluar_Propuestas:waiting-user#1') ] ]
]) {
  const escena = escenas[modelo];
  const problemas = [];
  const instante = escena && escena.at(t);
  const pelotas = instante ? describe(instante.balls.filter(p => p.case === caso)) : [];
  if (comoTexto(pelotas) !== comoTexto([ ...previsto ].sort())) problemas.push(`${caso} tiene ${comoTexto(pelotas)}`);
  const pool = instante && instante.balls.find(p => p.case === caso)?.pool;
  const contados = instante && pool ? instante.cases[pool] : [];
  if (!contados || contados.filter(id => id === caso).length !== 1) problemas.push(`${caso} se cuenta ${comoTexto(contados)}`);
  const ids = instante ? instante.balls.filter(p => p.case === caso).map(p => p.id) : [];
  if (new Set(ids).size !== ids.length) problemas.push('dos pelotas con el mismo ID');
  informa(que, problemas, `${modelo}, t=${t}: ${previsto.length} pelotas de ${caso}, un solo caso en ${pool}` +
    ` de ${contados ? contados.length : 0}`);
}

// Los sobres del mismo caso no se confunden: los que el orquestador 1 manda a
// cada orquestado estan a la vez en el buzon, cada uno con su destinatario; y
// los de una misma pareja, uno detras de otro, cada uno con su recepcion.
{
  const escena = escenas['10-convocatoria-1-a-n'];
  const problemas = [];
  const buzon = escena ? escena.at(10).envelopes : [];
  const vistos = buzon.map(s => [ s.sender, s.target, s.to, `${s.numbers.sender}→${s.numbers.target}` ]);
  const previstos = [ 2, 3, 4 ].map(n => [ 'Pool_Orquestador - 1', `Pool_Orquestado - ${n}`, 'Esperar_Convocatoria', `1→${n}` ]);
  if (comoTexto(vistos) !== comoTexto(previstos)) problemas.push(`a los 10 s, en el buzon: ${comoTexto(vistos)}`);
  if (new Set(buzon.map(s => s.id)).size !== buzon.length || new Set(buzon.map(s => s.reception)).size !== buzon.length) {
    problemas.push('dos sobres con el mismo ID o la misma recepcion');
  }
  informa('sobres del mismo caso, a la vez', problemas, '10-convocatoria-1-a-n, t=10: tres sobres del orquestador 1, uno a cada orquestado');
}
{
  // Una pareja son dos casos, en un sentido; un buzon, ademas, el par de
  // elementos que envia y recibe, y en el los sobres se recogen en el orden en
  // que salieron.
  const problemas = [];
  let parejas = 0;
  let sobres = 0;
  for (const modelo of [ '25-parejas-con-varias-respuestas', '26-respuesta-en-bucle', '27-parejas-con-cadena-de-respuestas' ]) {
    const escena = escenas[modelo];
    if (!escena) {
      problemas.push(`falta el ${modelo}`);
      continue;
    }
    const agrupa = clave => {
      const grupos = new Map();
      for (const sobre of escena.messages) {
        if (!grupos.has(clave(sobre))) grupos.set(clave(sobre), []);
        grupos.get(clave(sobre)).push(sobre);
      }
      return [ ...grupos.values() ].filter(lista => lista.length > 1);
    };
    for (const lista of agrupa(s => comoTexto([ s.sender, s.target ]))) {
      parejas += 1;
      sobres += lista.length;
      if (new Set(lista.map(s => s.id)).size !== lista.length || new Set(lista.map(s => s.reception)).size !== lista.length) {
        problemas.push(`${modelo}: los sobres de ${lista[0].sender} a ${lista[0].target} se confunden`);
      }
    }
    for (const lista of agrupa(s => comoTexto([ s.from, s.to, s.sender, s.target ]))) {
      if (lista.some((s, i) => i && (s.sent < lista[i - 1].sent || s.pickup < lista[i - 1].pickup))) {
        problemas.push(`${modelo}: en el buzon de ${lista[0].to}, un sobre se recoge antes que el que salio primero`);
      }
    }
  }
  if (!parejas) problemas.push('ninguna pareja se manda dos sobres');
  informa('sobres de una misma pareja, uno tras otro', problemas,
    `${parejas} parejas con ${sobres} sobres en 25, 26 y 27: cada uno con su ID y su recepcion, en orden`);
}
{
  // Dos activaciones de Recoger en el orquestador 1, las dos con la ejecucion 1
  // y el mismo remitente (37). La primera solicitud sale a los 6 s; la rama A
  // la recoge a los 7 y espera a Ana hasta los 20, y la rama B espera la
  // segunda de 8 a 10. La espera de la B no es de la A: el primer sobre se
  // recoge a los 7, y a los 8 el buzon esta vacio.
  const escena = escenas['37-recogida-antes-de-la-otra-espera'];
  const problemas = [];
  if (!escena) problemas.push('falta el 37-recogida-antes-de-la-otra-espera');
  else {
    const piezas = new Map(escena.timeline.items.map(p => [ p.id, p ]));
    const solicitudes = escena.messages.filter(s => s.from === 'Solicitar')
      .map(s => [ s.sent, s.pickup, piezas.get(s.reception)?.start ]);
    if (comoTexto(solicitudes) !== comoTexto([ [ 6, 7, 20 ], [ 10, 10, 21 ] ])) {
      problemas.push(`las solicitudes [sale, se recoge, empieza su recepcion]: ${comoTexto(solicitudes)}`);
    }
    for (const [ t, previstos ] of [ [ 6, 1 ], [ 6.5, 1 ], [ 7, 0 ], [ 8, 0 ], [ 9, 0 ], [ 9.5, 0 ], [ 10, 0 ] ]) {
      const vistos = escena.at(t).envelopes.filter(s => s.from === 'Solicitar').length;
      if (vistos !== previstos) problemas.push(`a los ${t} s hay ${vistos} solicitud(es) en el buzon, y son ${previstos}`);
    }
  }
  informa('dos activaciones del mismo remitente', problemas,
    '37: el primer sobre se recoge a los 7 s, no al acabar la espera de la otra activacion (10 s)');
}

// --- En el navegador -------------------------------------------------------------

console.log('\nEn el navegador:');
const BPMN_JS = join(dirname(require.resolve('bpmn-js/package.json')), 'dist');
const integracion = join(aqui, 'integracion');
for (const ruta of [ join(BPMN_JS, 'bpmn-modeler.development.js'), ...[ '01-simple', '02-colaboracion', '10-convocatoria-1-a-n', '35-proceso-base' ]
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
    if (registros) window.carga(registros);
  };
  window.carga = registros => { window.modeler.get('sceneView').load(timelineFromLogs(registros)); };
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
  const muestra = (t, opciones) => page.evaluate(([ t, opciones ]) => {
    const estado = window.modeler.get('sceneView').show(t, opciones);
    return { pelotas: estado.balls.length, sobres: estado.envelopes.length, casos: estado.cases };
  }, [ t, opciones ]);

  // Lo que hay dibujado: cada marca de la escena con sus datos, su texto y
  // donde esta en la pantalla, y la caja en la pantalla de su elemento -la
  // forma que pinta bpmn-js- o, si va en transito, lo lejos que queda del trazo
  // de su flujo.
  const dibujo = () => page.evaluate(() => {
    const centro = nodo => {
      const r = nodo.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    };
    const forma = id => {
      const gfx = document.querySelector(`.djs-element[data-element-id="${id}"] > .djs-visual`);
      if (!gfx) return null;
      const r = gfx.firstElementChild.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    };
    const alTrazo = (id, punto) => {
      const trazo = document.querySelector(`.djs-element[data-element-id="${id}"] > .djs-visual > path`);
      if (!trazo) return Infinity;
      const largo = trazo.getTotalLength();
      let minimo = Infinity;
      for (let i = 0; i <= 4000; i++) {
        const q = trazo.getPointAtLength(largo * i / 4000).matrixTransform(trazo.getScreenCTM());
        minimo = Math.min(minimo, Math.hypot(q.x - punto.x, q.y - punto.y));
      }
      return minimo;
    };
    const capa = window.modeler.get('drawingLayer');
    const marcas = [ ...document.querySelectorAll('.layer-simulation-drawing > g') ].map(nodo => {
      const datos = { ...nodo.dataset };
      const visible = nodo.getAttribute('visibility') !== 'hidden';
      // El centro del dibujo -circulo o rectangulo-, sin su numero de debajo.
      const punto = visible ? centro(nodo.querySelector('circle, rect')) : null;
      const marca = capa.marks().find(m => m.node === nodo);
      const enFlujo = marca && window.modeler.get('elementRegistry').get(marca.element)?.waypoints;
      return {
        ...datos, visible, punto, texto: nodo.querySelector('text').textContent,
        negrita: [ ...nodo.querySelectorAll('tspan[font-weight="bold"]') ].map(t => t.textContent),
        discontinua: nodo.querySelector('circle')?.getAttribute('stroke-dasharray') !== 'none',
        en: marca && marca.element, caja: marca && !enFlujo ? forma(marca.element) : null,
        alTrazo: marca && enFlujo && punto ? alTrazo(marca.element, punto) : null
      };
    });
    const reloj = document.querySelector('.scene-clock');
    const lienzo = document.querySelector('#lienzo').getBoundingClientRect();
    const r = reloj && reloj.getBoundingClientRect();
    return {
      marcas,
      reloj: reloj && {
        texto: reloj.textContent,
        visible: r.width > 0 && r.height > 0 && r.left >= lienzo.left && r.right <= lienzo.right && r.top >= lienzo.top &&
          r.bottom <= lienzo.bottom && getComputedStyle(reloj).visibility !== 'hidden'
      }
    };
  });
  const dentro = (punto, caja) => punto && caja && punto.x >= caja.left && punto.x <= caja.right && punto.y >= caja.top &&
    punto.y <= caja.bottom;

  // El 1:1 a los 60 s: el cliente 1 espera la respuesta mientras el servicio 1 atiende.
  await monta('02-colaboracion');
  let estado = await muestra(60);
  let visto = await dibujo();
  {
    const problemas = [];
    const pelotas = visto.marcas.filter(m => m.kind === 'ball');
    if (pelotas.length !== estado.pelotas) problemas.push(`${pelotas.length} pelotas dibujadas y ${estado.pelotas} en la escena`);
    const cliente = pelotas.filter(m => m.case === 'Pool_Cliente - 1');
    const [ c ] = cliente;
    if (cliente.length !== 1 || c.element !== 'Esperar_Respuesta' || c.state !== 'waiting-message' || c.texto !== '1' ||
      !c.discontinua || !dentro(c.punto, c.caja)) {
      problemas.push(`el cliente 1: ${comoTexto(cliente.map(m => [ m.element, m.state, m.texto, m.discontinua, dentro(m.punto, m.caja) ]))}`);
    }
    const servicio = pelotas.filter(m => m.case === 'Pool_Servicio - 1');
    if (servicio.length !== 1 || servicio[0].element !== 'Atender' || servicio[0].discontinua || !dentro(servicio[0].punto, servicio[0].caja)) {
      problemas.push(`el servicio 1: ${comoTexto(servicio.map(m => [ m.element, m.state, m.discontinua ]))}`);
    }
    const fuera = pelotas.filter(m => !dentro(m.punto, m.caja));
    if (fuera.length) problemas.push(`fuera de su elemento: ${fuera.map(m => m.case).join(', ')}`);
    if (!visto.reloj || !visto.reloj.visible || !visto.reloj.texto.startsWith('t = 60 s · ')) {
      problemas.push(`el reloj: ${comoTexto(visto.reloj)}`);
    }
    informa('el 1:1, a los 60 s', problemas, `el cliente 1 espera en Esperar_Respuesta, el servicio 1 atiende; «${visto.reloj?.texto}»`);
  }

  // A los 18 s con transito, la peticion va por su flujo de mensaje; sin el, ya
  // no se ve: la recogieron a los 16 s.
  {
    const problemas = [];
    await page.evaluate(() => {
      window.nodoDelCliente = document.querySelector('.scene-ball[data-case="Pool_Cliente - 1"]');
    });
    estado = await muestra(18, { transit: 4 });
    visto = await dibujo();
    const sobres = visto.marcas.filter(m => m.kind === 'envelope');
    const [ s ] = sobres;
    if (sobres.length !== 1 || s.flow !== 'Mensaje_Peticion' || s.en !== 'Mensaje_Peticion' || s.message !== 'Peticion' ||
      s.sender !== 'Pool_Cliente - 1' || s.target !== 'Pool_Servicio - 1' || s.request !== 'Pool_Cliente - 1' ||
      s.texto !== '1→1' || comoTexto(s.negrita) !== comoTexto([ '1' ]) || !(s.alTrazo <= 0.5)) {
      problemas.push(`los sobres: ${comoTexto(sobres.map(m => [ m.id, m.en, m.texto, m.negrita, m.alTrazo ]))}`);
    }
    const cliente = visto.marcas.find(m => m.case === 'Pool_Cliente - 1');
    if (!cliente || cliente.state !== 'waiting-message' || cliente.en !== 'Flujo_C2' || !(cliente.alTrazo <= 0.5)) {
      problemas.push(`el cliente 1, con transito: ${comoTexto(cliente && [ cliente.state, cliente.en, cliente.alTrazo ])}`);
    }
    if (!visto.reloj.texto.startsWith('t = 18 s · ')) problemas.push(`el reloj, con transito: «${visto.reloj.texto}»`);
    const mismoNodo = await page.evaluate(() => window.nodoDelCliente === document.querySelector('.scene-ball[data-case="Pool_Cliente - 1"]'));
    if (!mismoNodo) problemas.push('la pelota del cliente 1 no es la misma marca que a los 60 s');
    await muestra(18);
    visto = await dibujo();
    if (visto.marcas.some(m => m.kind === 'envelope')) problemas.push('sin transito, a los 18 s se ve un sobre ya recogido');
    const quieto = visto.marcas.find(m => m.case === 'Pool_Cliente - 1');
    if (!quieto || quieto.en !== 'Esperar_Respuesta' || !dentro(quieto.punto, quieto.caja)) problemas.push('sin transito, el cliente 1 no esta en su tarea');
    informa('el transito, a los 18 s', problemas, 'el sobre y la pelota sobre sus flujos, la misma marca que a los 60 s; el reloj en 18 s');
  }

  // Al ampliar, las pelotas siguen en sus elementos.
  {
    const problemas = [];
    await muestra(60);
    await page.evaluate(() => window.modeler.get('canvas').zoom(1.7, { x: 600, y: 300 }));
    visto = await dibujo();
    const fuera = visto.marcas.filter(m => m.kind === 'ball' && m.visible && !dentro(m.punto, m.caja));
    if (fuera.length) problemas.push(`fuera de su elemento: ${fuera.map(m => `${m.case} en ${m.element}`).join(', ')}`);
    if (!visto.reloj.visible || !visto.reloj.texto.startsWith('t = 60 s · ')) problemas.push(`el reloj: ${comoTexto(visto.reloj)}`);
    informa('al ampliar', problemas, `${visto.marcas.filter(m => m.visible).length} marcas visibles, cada una en su elemento; el reloj, en su sitio`);
  }

  // La convocatoria a los 10 s: tres sobres del orquestador 1 en el buzon, uno
  // para cada orquestado.
  {
    const problemas = [];
    await monta('10-convocatoria-1-a-n');
    estado = await muestra(10);
    visto = await dibujo();
    const sobres = visto.marcas.filter(m => m.kind === 'envelope');
    // De izquierda a derecha, por orden de llegada: salieron a los 4, 6 y 8 s.
    const textos = [ ...sobres ].sort((a, b) => a.punto.x - b.punto.x).map(m => m.texto);
    if (comoTexto(textos) !== comoTexto([ '1→2', '1→3', '1→4' ])) problemas.push(`los sobres dicen ${comoTexto(textos)}`);
    if (sobres.some(m => m.en !== 'Esperar_Convocatoria' || comoTexto(m.negrita) !== comoTexto([ '1' ]))) {
      problemas.push(`no estan todos en el buzon de Esperar_Convocatoria: ${comoTexto(sobres.map(m => m.en))}`);
    }
    const sitios = new Set(sobres.map(m => `${Math.round(m.punto.x)},${Math.round(m.punto.y)}`));
    if (sitios.size !== sobres.length) problemas.push('dos sobres en el mismo sitio');
    const caja = sobres[0]?.caja;
    const encima = sobres.every(m => caja && m.punto.y < caja.top && m.punto.x > caja.left && m.punto.x < caja.right);
    if (!encima) problemas.push('no estan encima de la recepcion');
    informa('el buzon de la convocatoria', problemas, '10-convocatoria-1-a-n, t=10: «1→2», «1→3» y «1→4», encima de la recepcion y en orden');
  }

  // El lote del proceso base a los 150 s: diez pelotas del SACU 1, un solo caso.
  {
    const problemas = [];
    await monta('35-proceso-base');
    estado = await muestra(150);
    visto = await dibujo();
    const sacu = visto.marcas.filter(m => m.kind === 'ball' && m.case === 'Pool_SACU - 1');
    if (sacu.length !== 10 || sacu.some(m => m.element !== 'Evaluar_Propuestas' || m.texto !== '1')) {
      problemas.push(`el SACU 1: ${comoTexto(sacu.map(m => [ m.element, m.texto ]))}`);
    }
    const ejecuciones = new Set(sacu.map(m => m.execution));
    if (ejecuciones.size !== 10) problemas.push(`${ejecuciones.size} ejecuciones distintas`);
    const sitios = new Set(sacu.map(m => `${Math.round(m.punto.x)},${Math.round(m.punto.y)}`));
    if (sitios.size !== sacu.length) problemas.push('dos pelotas en el mismo sitio');
    const discontinuas = sacu.filter(m => m.discontinua).length;
    if (discontinuas !== 7) problemas.push(`${discontinuas} pelotas esperando, y son 7`);
    if (comoTexto(estado.casos.Pool_SACU) !== comoTexto([ 'Pool_SACU - 1' ])) problemas.push(`casos del SACU: ${comoTexto(estado.casos.Pool_SACU)}`);
    informa('el lote, a los 150 s', problemas, '10 pelotas «1» del SACU 1 en Evaluar_Propuestas, 3 trabajando y 7 esperando; un caso');
  }

  // Al abrir otro diagrama no queda nada de la escena, ni su simulacion: show
  // tiene que pedir que se cargue la del nuevo, sin volver a dibujar la del
  // anterior. Con la suya, dibuja. Y clear() tambien la descarga.
  {
    const problemas = [];
    const quedan = () => page.evaluate(() => [ document.querySelectorAll('.layer-simulation-drawing > *').length,
      document.querySelectorAll('.scene-clock').length ]);
    const sinCargar = async (que, t) => {
      const error = await page.evaluate(t => {
        try {
          window.modeler.get('sceneView').show(t);
          return null;
        } catch (error) {
          return error.message;
        }
      }, t);
      const [ marcas, relojes ] = await quedan();
      if (!error || !/load/.test(error)) problemas.push(`${que}, show(${t}) ${error ? `dice «${error}»` : 'no da error'}`);
      if (marcas || relojes) problemas.push(`${que}, show(${t}) dibuja ${marcas} marcas y ${relojes} relojes`);
    };
    await page.evaluate(xml => window.modeler.importXML(xml), readFileSync(join(integracion, '01-simple.bpmn'), 'utf8'));
    const [ marcas, relojes ] = await quedan();
    if (marcas || relojes) problemas.push(`al abrirlo quedan ${marcas} marcas y ${relojes} relojes`);
    await sinCargar('sin cargar su simulacion', 60);
    const simple = escenas['01-simple'];
    const t = simple ? simple.timeline.changes().find(c => simple.at(c).balls.length) : 0;
    await page.evaluate(registros => window.carga(registros), registrosDe('01-simple'));
    estado = await muestra(t);
    visto = await dibujo();
    const pelotas = visto.marcas.filter(m => m.kind === 'ball');
    if (!estado.pelotas || pelotas.length !== estado.pelotas || pelotas.some(m => !dentro(m.punto, m.caja))) {
      problemas.push(`con la suya, a los ${t} s: ${pelotas.length} pelotas dibujadas y ${estado.pelotas} en la escena`);
    }
    if (!visto.reloj || !visto.reloj.texto.startsWith(`t = ${t} s · `)) problemas.push(`con la suya, el reloj: ${comoTexto(visto.reloj)}`);
    await page.evaluate(() => window.modeler.get('sceneView').clear());
    await sinCargar('despues de clear()', t);
    informa('al abrir otro diagrama', problemas,
      `ni marcas ni reloj, y show pide cargar su simulacion; con la del 01, ${estado.pelotas} pelota(s) a los ${t} s; clear() la descarga`);
  }

  informa('sin errores ni ventanas', incidencias, 'ninguno');
} finally {
  await navegador.close();
  servidor.cierra();
}

console.log(fallos ? `\nEscena en rojo: ${fallos} problema(s).` : `\nEscena en verde: ${carpetas.length} modelos.`);
process.exit(fallos ? 1 : 0);
