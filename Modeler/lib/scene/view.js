// La vista de la escena (6.3 a 6.7): dibuja sobre el diagrama, con la capa de
// dibujo (lib/drawing), las pelotas y los sobres de un instante, las tres zonas
// de cada tarea con sus insignias, la plantilla de cada pool y el reloj de la
// simulacion.
//
// Es un modulo de diagram-js -el servicio `sceneView`-, sin mas dependencias
// que la capa de dibujo. `load(timeline)` le da la linea de tiempo de una
// simulacion del diagrama abierto, y `show(t, { transit, threshold, cases })`
// dibuja ese instante y devuelve la escena que ha dibujado
// (lib/scene/scene.js), entera aunque no se dibuje entera. Al
// abrir otro diagrama, o con clear(), la simulacion se descarga, y show exige
// otro load. Cada pelota, cada sobre y cada insignia es una marca con su ID,
// que se reutiliza de un instante a otro: entre dos instantes solo se mueve, o
// se vuelve a dibujar, lo que cambia.
//
// - La pelota lleva el numero de su caso dentro de su pool. Trabajando, el
//   borde es continuo; esperando -tambien terminada, a la salida-, discontinuo.
// - Una tarea con algo se parte en tres franjas (lib/scene/zones.js): la cola a
//   la entrada, a la izquierda; lo que esta en proceso, en el centro; y lo
//   bloqueado a la salida, a la derecha. Las pelotas de cada zona se reparten
//   en filas en su franja, en el orden de sus casos. Si son mas de las que
//   caben -o del umbral, `threshold`-, una insignia las sustituye con sus
//   recuentos: cuantas ejecuciones son, de cuantos casos y de cuantos casos son
//   las solicitudes que tienen en la mano. En las compuertas y los eventos, que
//   no tienen zonas, las pelotas van alrededor de su centro, y pasado el umbral
//   -cuatro, si no se dice otro-, tambien una insignia.
// - El sobre lleva debajo los numeros de sus casos remitente y destinatario,
//   «1→2», con el del caso cuya solicitud es en negrita: en una convocatoria,
//   los sobres que el orquestador 1 manda a cada orquestado se distinguen por
//   su destinatario. El mensaje es el de su flujo. En el buzon, encima de la
//   recepcion, en fila desde su esquina izquierda por orden de llegada; si no
//   caben en una fila -o pasan del umbral-, un sobre con cuantos hay. En
//   transito, recorre su flujo de mensaje.
// - El reloj, encima del lienzo, marca siempre el instante simulado t, tambien
//   durante el transito, que es cosmetico.
// - Con `cases` (6.7), solo se dibujan las pelotas de esos casos y los sobres
//   entre dos de ellos. Lo que cuenta sigue contando todo: una zona con mas
//   ejecuciones de las que caben es una insignia con todas, aunque el filtro
//   deje pocas; un buzon lleno, igual; y las plantillas, con todas las
//   personas ocupadas.
// - Cada pelota y cada sobre dice en data-transit si se dibuja en transito,
//   por su flujo. Un sobre que acaba de salir se ve llegar aunque ya este
//   recogido (data-pickup) o cuente ya en un buzon lleno, el de su recepcion
//   (data-to): eso es el transito, cosmetico.
//
// Las zonas se miden con el tamano que tiene la tarea al dibujar el instante:
// si se agranda, se reparten de nuevo en el siguiente. Los recuentos son los de
// la escena, no los de lo que se ve: una pelota en transito ya cuenta en su
// zona, y si la zona es una insignia va en ella, sin dibujarse en su flujo; un
// sobre en transito cuenta en su buzon, pero se sigue dibujando en su flujo de
// mensaje, que es lo que viaja. El umbral es un numero, tambien escrito como
// texto; uno mayor que lo que cabe deja que las pelotas se salgan de la
// franja.
//
// Cada caso tiene su color (6.5, lib/scene/colors.js), constante de principio a
// fin y distinto del de los demas casos de su pool: lo llevan todas sus
// pelotas, y los sobres de los que es la solicitud, el numero en negrita. Una
// insignia de un solo caso lleva de fondo su color aclarado, y un buzon lleno
// de una sola solicitud, que es un sobre, su color; de varios, son blancos. El
// numero de la pelota va en la tinta que mejor se lee sobre su color.
//
// Los recursos, por nombre (6.6, lib/scene/staff.js):
//
// - Junto a cada pool, su plantilla: la de su registro, con
//   quien no llego a trabajar, y no la de las reglas, que pueden haber
//   cambiado. Cada persona, libre u ocupada: con que tarea, para que solicitud
//   -o, si no la hay, que caso- y en que ejecucion, con un punto del color de
//   esa solicitud. Debajo, la cola del pool (D4): lo que espera a una persona,
//   de cualquier tarea, por orden de llegada. Con recursos infinitos no hay
//   cola, y cada persona dice cuanto atiende a la vez. Va a la derecha del
//   pool si cabe sin tapar nada del diagrama -otro pool, un elemento, un
//   rotulo- ni otra plantilla; si no, deslizandose por ese lado, a su
//   izquierda, debajo o encima, pegada al pool; y si no queda sitio, a la
//   derecha, por debajo de lo que la tape. Se coloca con el tamano mayor que
//   llega a tener en la simulacion, asi que no cambia de sitio de un instante
//   a otro. En un Process, junto a todo el diagrama.
// - En las tareas de un pool con recursos finitos, cada pelota que trabaja
//   lleva debajo a la persona que la atiende y, en negrita, el numero de la
//   solicitud, en el color de esa solicitud: el de sus sobres. Las filas de su
//   franja se separan para que quepa, y caben menos. Al acabar, la ejecucion
//   suelta a la persona y la pelota pierde su nombre.
//
// Encajar el diagrama -zoom('fit-viewport')- no tiene en cuenta las marcas;
// fit() encaja tambien las plantillas y los nombres de las tareas.
//
// Las marcas no capturan el raton, como todas las de la capa de dibujo: su
// <title> lo leen las pruebas y los lectores de pantalla, no aparece al pasar
// por encima.

import drawingModule from '../drawing/drawing.js';
import { createScene, graphFromRegistry } from './scene.js';
import { ZONES, countBalls } from './zones.js';
import { NEUTRAL, caseColor, inkOn, tint } from './colors.js';

const SVG = 'http://www.w3.org/2000/svg';
const RADIUS = 6; // el de una pelota
const STEP = 15; // la distancia entre dos pelotas de la misma zona
const CAPTION = 14; // lo que se reserva debajo de las pelotas, para el nombre de la zona
const CENTER_THRESHOLD = 4; // las pelotas de una compuerta o un evento antes de la insignia
const ENVELOPE_STEP = 24; // la distancia entre dos sobres del mismo buzon
const TAGGED_STEP = 19; // la distancia entre dos filas de pelotas con su persona debajo
const TAGGED_ROW = 19; // lo que ocupa una de esas filas, de arriba de la pelota a abajo de su etiqueta
const MARKER = 20; // lo que ocupa abajo el marcador de multiinstancia o de bucle de una tarea
const TAG_WIDTH = 14.5; // el ancho de la etiqueta de la persona
const TAG_FONT = 4.6;
const ROSTER_GAP = 12; // entre el pool y su plantilla
const ROSTER_MARGIN = 4; // lo que se deja libre entre una plantilla y lo que tiene alrededor
const ROSTER_SLIDE = 10; // de cuanto en cuanto se desliza una plantilla por su lado del pool
const ROSTER_ROW = 10; // la altura de una fila de la plantilla
const ROSTER_PAD = 6;
const QUEUE_ROWS = 5; // las piezas de la cola que se nombran; de las demas, cuantas son
const INK = '#22242a';
const PALE = '#8a9099';

const ZONE_NAMES = { entry: 'cola', inside: 'dentro', exit: 'salida' };

function svg(name, attributes = {}, parent) {
  const node = document.createElementNS(SVG, name);
  for (const [ key, value ] of Object.entries(attributes)) node.setAttribute(key, String(value));
  if (parent) parent.appendChild(node);
  return node;
}

function text(parent, content, attributes = {}) {
  const node = svg('text', { 'text-anchor': 'middle', 'font-family': 'Arial, sans-serif', fill: INK, ...attributes }, parent);
  node.textContent = content;
  return node;
}

function setData(group, data) {
  for (const [ key, value ] of Object.entries(data)) group.setAttribute(`data-${key}`, String(value ?? ''));
}

const STATE_NAMES = {
  working: 'trabajando',
  'waiting-user': 'esperando a una persona',
  'waiting-message': 'esperando un mensaje',
  'waiting-data': 'esperando unos datos',
  'waiting-join': 'esperando a la otra rama',
  timer: 'esperando su temporizador',
  blocked: 'terminada, esperando a que salga su activacion',
  waiting: 'esperando'
};

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// Una tarea tiene zonas; una compuerta o un evento, no.
const hasZones = shape => !!shape && !shape.waypoints && /Task$/.test(shape.type || '');

// El ancho aproximado de un texto en Arial: lo justo para repartir una
// plantilla o encoger una etiqueta sin medir en el navegador, que tambien
// tiene que dar lo mismo en las pruebas.
const NARROW = new Set('iljtfrI.,:;!|\' ·()'.split(''));
export function textWidth(content, size) {
  let em = 0;
  for (const c of String(content)) {
    if (NARROW.has(c)) em += 0.3;
    else if ('mwMW'.includes(c)) em += 0.84;
    else if (/[0-9]/.test(c)) em += 0.556;
    else if (c === '→' || c === '×') em += 0.75;
    else if (c !== c.toLowerCase()) em += 0.68;
    else em += 0.53;
  }
  return em * size;
}

// Lleva su persona debajo la pelota que trabaja en un pool con recursos
// finitos: en uno con infinitos la persona atiende a la vez todo lo que la
// nombra, nunca deja de estar disponible, y su nombre no dice nada.
const tagged = (ball, finite) => ball.state === 'working' && !!ball.user && finite.has(ball.pool);

// La persona que atiende una ejecucion, debajo de su pelota, con el numero de
// la solicitud en negrita y el color de esa solicitud, el de sus sobres.
function drawTag(group, ball) {
  const color = ball.requestNumber === null ? null : caseColor(ball.requestNumber);
  const tag = svg('g', { class: 'scene-ball-person' }, group);
  setData(tag, { person: ball.user, request: ball.request, 'request-number': ball.requestNumber });
  svg('rect', { x: -TAG_WIDTH / 2, y: RADIUS + 0.5, width: TAG_WIDTH, height: 6.5, rx: 1.5,
    fill: color ? tint(color, 0.6) : NEUTRAL, stroke: color || PALE, 'stroke-width': 0.6 }, tag);
  const label = text(tag, '', { y: RADIUS + 3.85, 'dominant-baseline': 'central', 'font-size': TAG_FONT });
  svg('tspan', {}, label).textContent = ball.requestNumber === null ? ball.user : `${ball.user} `;
  if (ball.requestNumber !== null) svg('tspan', { 'font-weight': 'bold' }, label).textContent = String(ball.requestNumber);
  const room = TAG_WIDTH - 1.5;
  if (textWidth(`${ball.user} ${ball.requestNumber ?? ''}`.trim(), TAG_FONT) > room) {
    label.setAttribute('textLength', room);
    label.setAttribute('lengthAdjust', 'spacingAndGlyphs');
  }
}

function drawBall(ball, withTag = false) {
  return group => {
    group.setAttribute('class', 'drawing-mark scene-ball');
    setData(group, { kind: 'ball', case: ball.case, pool: ball.pool, number: ball.number, element: ball.element,
      state: ball.state, zone: ball.zone, execution: ball.execution, cancelled: ball.cancelled,
      user: ball.state === 'working' ? ball.user : null, request: ball.request, 'request-number': ball.requestNumber });
    svg('title', {}, group).textContent = `${ball.case}${ball.execution ? `, ejecucion ${ball.execution}` : ''}: ` +
      `${STATE_NAMES[ball.state] || ball.state}${ball.request ? `, para ${ball.request}` : ''}` +
      `${ball.state === 'working' && ball.user ? `, la atiende ${ball.user}` : ''}`;
    const color = caseColor(ball.number);
    group.setAttribute('data-color', color);
    svg('circle', {
      r: RADIUS, fill: color, stroke: INK, 'stroke-width': 1.3,
      'stroke-dasharray': ball.state === 'working' ? 'none' : '2.2 1.4'
    }, group);
    const label = String(ball.number ?? '');
    text(group, label, { 'dominant-baseline': 'central', 'font-size': label.length > 2 ? 5.5 : 7, 'font-weight': 'bold',
      fill: inkOn(color) });
    if (withTag) drawTag(group, ball);
  };
}

function drawEnvelope(envelope) {
  return group => {
    group.setAttribute('class', 'drawing-mark scene-envelope');
    setData(group, { kind: 'envelope', id: envelope.id, sender: envelope.sender, target: envelope.target,
      request: envelope.request, flow: envelope.flow, message: envelope.message, pickup: envelope.pickup, to: envelope.to });
    svg('title', {}, group).textContent = `${envelope.message || 'Mensaje'} de ${envelope.sender} a ${envelope.target}, ` +
      `solicitud de ${envelope.request}`;

    // El color del caso de la solicitud: una conversacion, ida y vuelta, va
    // en el mismo color.
    const color = caseColor(envelope.numbers.request);
    group.setAttribute('data-color', color);
    svg('rect', { x: -7, y: -5, width: 14, height: 10, rx: 1, fill: color, stroke: INK, 'stroke-width': 1.2 }, group);
    svg('path', { d: 'M -7 -5 L 0 1 L 7 -5', fill: 'none', stroke: inkOn(color), 'stroke-width': 1 }, group);
    const label = text(group, '', { x: 0, y: 11, 'dominant-baseline': 'hanging', 'font-size': 7 });
    const { sender, target } = envelope.numbers;
    const part = (content, bold) => {
      svg('tspan', bold ? { 'font-weight': 'bold' } : {}, label).textContent = String(content ?? '?');
    };
    part(sender, envelope.request === envelope.sender);
    part('→');
    part(target, envelope.request !== envelope.sender && envelope.request === envelope.target);
  };
}

// El color de un grupo de pelotas o de sobres: el de su caso si son todos del
// mismo; si no, ninguno.
function colorOfAll(numbers) {
  const distinct = new Set(numbers);
  return distinct.size === 1 ? caseColor([ ...distinct ][0]) : null;
}

// La insignia de una zona: cuantas ejecuciones, de cuantos casos y de cuantos
// casos son sus solicitudes. `width` es la de su franja, o null en el centro de
// una compuerta o un evento. `color` es el de su caso, si todas son del mismo:
// el fondo, aclarado.
function drawBadge(element, zone, counts, width, color) {
  return group => {
    group.setAttribute('class', 'drawing-mark scene-badge');
    setData(group, { kind: 'badge', element, zone, executions: counts.executions, cases: counts.cases,
      requests: counts.requests, color: color || NEUTRAL });
    const lines = [ plural(counts.cases, 'caso', 'casos') ];
    if (counts.requests) lines.push(`${counts.requests} sol.`);
    svg('title', {}, group).textContent = `${element}${width ? `, ${ZONE_NAMES[zone]}` : ''}: ` +
      `${plural(counts.executions, 'ejecucion', 'ejecuciones')} de ${plural(counts.cases, 'caso', 'casos')}` +
      `${counts.requests ? `, con solicitudes de ${plural(counts.requests, 'caso', 'casos')}` : ''}`;
    const w = width ? Math.max(20, width - 4) : 30;
    const h = 24 + 8 * lines.length;
    svg('rect', { x: -w / 2, y: -h / 2, width: w, height: h, rx: 3, fill: color ? tint(color) : NEUTRAL, stroke: INK,
      'stroke-width': 1, 'stroke-dasharray': zone === 'inside' ? 'none' : '2.2 1.4' }, group);
    let y = -h / 2 + 9;
    text(group, String(counts.executions), { y, 'font-size': 11, 'font-weight': 'bold', 'dominant-baseline': 'central' });
    y += 9;
    text(group, 'ejec.', { y, 'font-size': 5.5, fill: PALE, 'dominant-baseline': 'central' });
    for (const line of lines) {
      y += 8;
      text(group, line, { y, 'font-size': 6, 'dominant-baseline': 'central' });
    }
  };
}

// El buzon lleno: un sobre con cuantos hay, del color de su solicitud si son
// todos de la misma.
function drawMailbox(element, count, color) {
  return group => {
    const fill = color || NEUTRAL;
    group.setAttribute('class', 'drawing-mark scene-mailbox');
    setData(group, { kind: 'mailbox', element, messages: count, color: fill });
    svg('title', {}, group).textContent = `${element}: ${plural(count, 'sobre', 'sobres')} en el buzon`;
    svg('rect', { x: -7, y: -5, width: 14, height: 10, rx: 1, fill, stroke: INK, 'stroke-width': 1.2 }, group);
    svg('path', { d: 'M -7 -5 L 0 1 L 7 -5', fill: 'none', stroke: inkOn(fill), 'stroke-width': 1 }, group);
    text(group, `× ${count}`, { x: 10, y: 0, 'text-anchor': 'start', 'dominant-baseline': 'central', 'font-size': 8,
      'font-weight': 'bold' });
  };
}

// Las lineas que separan las tres franjas de una tarea, y sus nombres debajo.
function drawZones(element, width, height) {
  return group => {
    group.setAttribute('class', 'drawing-mark scene-zones');
    setData(group, { kind: 'zones', element });
    for (const x of [ width / 3, 2 * width / 3 ]) {
      svg('line', { x1: x, y1: 4, x2: x, y2: height - 4, stroke: PALE, 'stroke-width': 0.8, 'stroke-dasharray': '2 2' }, group);
    }
    ZONES.forEach((zone, i) => text(group, ZONE_NAMES[zone], { x: (i + 0.5) * width / 3, y: height - 4, 'font-size': 5.5,
      fill: PALE }));
  };
}

// -- La plantilla de cada pool (6.6) ---------------------------------------------

const secondsText = t => `${Number.isInteger(t) ? t : Number(t.toFixed(3))} s`;

// Lo que se dice de una asignacion: su tarea, su solicitud -o su caso, si no
// la tiene- y su ejecucion.
function workParts(work) {
  const number = work.request ? work.requestNumber : work.number;
  return [
    { text: work.name || work.element },
    { text: work.request ? ' · sol. ' : ' · caso ' },
    { text: String(number ?? '?'), bold: true },
    ...(work.execution === null ? [] : [ { text: ` · ejec. ${work.execution}`, pale: true } ])
  ];
}

// Con recursos infinitos una persona atiende a la vez todo lo que la nombra:
// cuantas ejecuciones, y de que tareas.
function manyParts(work) {
  const byTask = new Map();
  for (const w of work) byTask.set(w.name || w.element, (byTask.get(w.name || w.element) || 0) + 1);
  const tasks = [ ...byTask ].map(([ name, n ]) => `${name} ×${n}`);
  return [
    { text: `${work.length} a la vez: `, bold: true },
    { text: tasks.slice(0, 2).join(', ') + (tasks.length > 2 ? ` y ${plural(tasks.length - 2, 'tarea', 'tareas')} mas` : '') }
  ];
}

const widthOf = (parts, size) => parts.reduce((sum, part) => sum + textWidth(part.text, size), 0);

// Donde va cada cosa de la plantilla de un pool en un instante, sin dibujarla:
// { width, height, rows }. Cada fila, con su altura `y` desde arriba, sus
// trozos de texto y lo que dice de ella.
export function rosterLayout(pool) {
  const finite = pool.resources !== 'infinite';
  const rows = [];
  let y = ROSTER_PAD + 6;
  const line = (row, height) => {
    rows.push({ ...row, y });
    y += height;
  };
  line({ kind: 'title', x: ROSTER_PAD, size: 8, parts: [ { text: pool.name || pool.pool, bold: true } ] }, 9);
  const people = plural(pool.people.length, 'persona', 'personas');
  const counts = finite ? `${people}, ${plural(pool.busy, 'ocupada', 'ocupadas')} · recursos finitos`
    : `${people} · recursos infinitos`;
  line({ kind: 'subtitle', x: ROSTER_PAD, size: 5.5,
    parts: [ { text: `Plantilla del registro · ${counts}${pool.complete ? '' : ' · incompleta'}`, pale: true } ] }, 6 + 4);

  const nameParts = person => [ { text: person.name + (person.listed ? '' : ' *') },
    ...(person.lanes.length ? [ { text: ` (${person.lanes.join(', ')})`, pale: true } ] : []) ];
  const nameWidth = Math.max(0, ...pool.people.map(person => widthOf(nameParts(person), 6.5)));
  const statusX = ROSTER_PAD + 7 + nameWidth + 5;
  for (const person of pool.people) {
    const work = person.work;
    const one = work.length === 1 ? work[0] : null;
    const status = !work.length ? [ { text: 'libre', pale: true } ] : one ? workParts(one) : manyParts(work);
    const numbers = work.map(w => (w.request ? w.requestNumber : w.number));
    const fill = !work.length ? NEUTRAL : (colorOfAll(numbers) || PALE);
    const title = !work.length ? `${person.name}: libre`
      : one ? `${person.name}: ${one.name || one.element}, ejecucion ${one.execution} (${one.id}) de ${one.case}` +
        `${one.request ? `, para ${one.request}` : ''}, de ${secondsText(one.start)} a ${secondsText(one.end)}`
        : `${person.name}: ${plural(work.length, 'ejecucion', 'ejecuciones')} a la vez`;
    line({ kind: 'person', x: ROSTER_PAD + 7, statusX, size: 6.5, statusSize: 6, parts: nameParts(person), status, title,
      dot: { fill, stroke: work.length ? INK : PALE },
      data: { person: person.name, state: person.state, lanes: person.lanes.join('|'), listed: person.listed,
        works: work.length, executions: work.map(w => w.id).join('|'),
        ...(one ? { element: one.element, execution: one.id, 'execution-number': one.execution, activation: one.activation,
          case: one.case, request: one.request, 'request-number': one.requestNumber, start: one.start, end: one.end } : {}) } },
    ROSTER_ROW);
  }

  // La cola del pool, que es de todas sus tareas (D4).
  y += 2;
  const queue = pool.queue;
  line({ kind: 'queue-title', x: ROSTER_PAD, size: 5.5, parts: [ { text: !finite ? 'Sin cola: recursos infinitos'
    : queue.length ? `Cola del pool: ${queue.length}, por orden de llegada` : 'Cola del pool: vacia', pale: true } ] }, 8);
  queue.slice(0, QUEUE_ROWS).forEach((entry, i) => line({ kind: 'queue', x: ROSTER_PAD + 3, size: 5.5,
    parts: [ { text: `${i + 1}. `, pale: true }, ...workParts(entry), { text: ` · desde ${secondsText(entry.since)}`, pale: true } ],
    title: `${entry.name || entry.element}, ejecucion ${entry.execution} (${entry.id}) de ${entry.case}` +
      `${entry.request ? `, para ${entry.request}` : ''}: espera a una persona desde ${secondsText(entry.since)}`,
    data: { id: entry.id, case: entry.case, element: entry.element, execution: entry.execution, activation: entry.activation,
      request: entry.request, 'request-number': entry.requestNumber, since: entry.since, until: entry.until } }, 8));
  if (queue.length > QUEUE_ROWS) {
    line({ kind: 'queue-more', x: ROSTER_PAD + 3, size: 5.5, parts: [ { text: `y ${queue.length - QUEUE_ROWS} mas`, pale: true } ] }, 8);
  }

  const width = Math.max(110, ...rows.map(row => (row.kind === 'person'
    ? row.statusX + widthOf(row.status, row.statusSize) : row.x + widthOf(row.parts, row.size)) + ROSTER_PAD));
  return { width, height: y - 6 + ROSTER_PAD, rows };
}

function drawParts(parent, parts, attributes) {
  const node = text(parent, '', { 'text-anchor': 'start', 'dominant-baseline': 'central', ...attributes });
  for (const part of parts) {
    svg('tspan', { ...(part.bold ? { 'font-weight': 'bold' } : {}), ...(part.pale ? { fill: PALE } : {}) }, node)
      .textContent = part.text;
  }
  return node;
}

function drawRoster(pool, layout, side) {
  return group => {
    group.setAttribute('class', 'drawing-mark scene-roster');
    setData(group, { kind: 'roster', pool: pool.pool, resources: pool.resources, people: pool.people.length, busy: pool.busy,
      free: pool.free, queue: pool.queue.length, complete: pool.complete, side });
    svg('title', {}, group).textContent = `Plantilla de ${pool.name || pool.pool}, la de su registro: ` +
      `${plural(pool.people.length, 'persona', 'personas')}: ${plural(pool.busy, 'ocupada', 'ocupadas')} y ` +
      `${plural(pool.free, 'libre', 'libres')}` +
      (pool.resources === 'infinite' ? '; recursos infinitos' : `; ${pool.queue.length} en la cola del pool`);
    svg('rect', { x: 0, y: 0, width: layout.width, height: layout.height, rx: 3, fill: NEUTRAL, stroke: INK,
      'stroke-width': 0.8 }, group);
    for (const row of layout.rows) {
      if (row.kind === 'person') {
        const person = svg('g', { class: 'scene-person' }, group);
        setData(person, row.data);
        svg('title', {}, person).textContent = row.title;
        svg('circle', { cx: ROSTER_PAD + 2.5, cy: row.y, r: 2.6, fill: row.dot.fill, stroke: row.dot.stroke,
          'stroke-width': 0.8 }, person);
        drawParts(person, row.parts, { x: row.x, y: row.y, 'font-size': row.size });
        drawParts(person, row.status, { x: row.statusX, y: row.y, 'font-size': row.statusSize });
        continue;
      }
      if (row.kind === 'queue') {
        const entry = svg('g', { class: 'scene-queue-entry' }, group);
        setData(entry, row.data);
        svg('title', {}, entry).textContent = row.title;
        drawParts(entry, row.parts, { x: row.x, y: row.y, 'font-size': row.size });
        continue;
      }
      drawParts(group, row.parts, { x: row.x, y: row.y, 'font-size': row.size, class: `scene-roster-${row.kind}` });
    }
  };
}

// El instante simulado como fecha y hora, con el desfase de la fecha de inicio.
export function formatInstant(startDate, t) {
  const seconds = `t = ${Number.isInteger(t) ? t : t.toFixed(3).replace(/\.?0+$/, '')} s`;
  const origin = startDate ? Date.parse(startDate) : NaN;
  if (Number.isNaN(origin)) return seconds;
  const offset = /([+-])(\d\d):?(\d\d)$/.exec(startDate);
  const minutes = offset ? (offset[1] === '-' ? -1 : 1) * (Number(offset[2]) * 60 + Number(offset[3])) : 0;
  const shifted = new Date(origin + t * 1000 + minutes * 60000);
  const pad = (n, size = 2) => String(n).padStart(size, '0');
  const date = `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
  const time = `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}` +
    (shifted.getUTCMilliseconds() ? `.${pad(shifted.getUTCMilliseconds(), 3)}` : '');
  return `${seconds} · ${date} ${time}`;
}

// Las franjas de una tarea: donde empieza cada una, su ancho, cuantas pelotas
// caben en ella, en columnas y filas, la distancia entre dos filas y el centro
// de la rejilla, `cy`. Con `tagged`, las pelotas llevan debajo a su persona:
// las filas se separan y se quedan por encima del marcador de multiinstancia
// o de bucle, si la tarea lo tiene, para no taparlo.
export function zoneGeometry(shape, zone, tagged = false) {
  const width = shape.width / 3;
  const cols = Math.max(1, Math.floor((width - 3) / STEP));
  const base = { x: ZONES.indexOf(zone) * width, width, cols };
  if (!tagged) {
    const rows = Math.max(1, Math.floor((shape.height - CAPTION) / STEP));
    return { ...base, rows, rowStep: STEP, cy: (shape.height - CAPTION) / 2 + 2, capacity: cols * rows };
  }
  const marker = !!(shape.businessObject && shape.businessObject.loopCharacteristics);
  const bottom = shape.height - (marker ? MARKER : CAPTION);
  const rows = Math.max(1, Math.floor((bottom - 2 - TAGGED_ROW) / TAGGED_STEP) + 1);

  // Una fila va de 6 por encima del centro de su pelota a 13 por debajo: el
  // conjunto, centrado entre el borde y lo de abajo.
  return { ...base, rows, rowStep: TAGGED_STEP, cy: (2 + bottom) / 2 - 3.5, capacity: cols * rows };
}

// Donde va cada una de `count` pelotas en una rejilla de `cols` columnas
// alrededor de (cx, cy), en filas centradas a `rowStep` una de otra.
function grid(count, cols, cx, cy, rowStep = STEP) {
  const rows = Math.ceil(count / cols);
  return Array.from({ length: count }, (_, i) => {
    const row = Math.floor(i / cols);
    const inRow = row === rows - 1 ? count - row * cols : cols;
    return { dx: cx + (i % cols - (inRow - 1) / 2) * STEP, dy: cy + (row - (rows - 1) / 2) * rowStep };
  });
}

const byCase = (a, b) => a.pool.localeCompare(b.pool) || (a.number ?? 0) - (b.number ?? 0) ||
  (a.execution ?? 0) - (b.execution ?? 0) || a.since - b.since || a.id.localeCompare(b.id);

export function SceneView(canvas, drawingLayer, elementRegistry, eventBus) {
  this._canvas = canvas;
  this._drawingLayer = drawingLayer;
  this._elementRegistry = elementRegistry;
  this._scene = null;
  this._marks = new Map();
  this._labels = new Map();
  this._clock = null;

  // Otro diagrama: la escena era del anterior, y su simulacion tambien.
  eventBus.on('diagram.clear', () => this.clear());
  eventBus.on('elements.changed', () => {
    if (this._shown && this._scene) this.show(this._shown.t, this._shown.options);
  });
  eventBus.on('canvas.viewbox.changed', () => {
    if (this._shown && this._scene) this.show(this._shown.t, this._shown.options);
  });
}

SceneView.$inject = [ 'canvas', 'drawingLayer', 'elementRegistry', 'eventBus' ];

SceneView.prototype.load = function(timeline) {
  this.clear();
  this._scene = createScene(timeline, graphFromRegistry(this._elementRegistry));
  this._reserve = null;
  return this._scene;
};

SceneView.prototype._clockNode = function() {
  if (!this._clock) {
    const node = document.createElement('div');
    node.className = 'scene-clock';
    node.setAttribute('role', 'timer');
    Object.assign(node.style, {
      position: 'absolute', top: '10px', left: '50%', transform: 'translateX(-50%)', padding: '4px 10px',
      background: '#ffffff', border: `1px solid ${INK}`, borderRadius: '4px', font: '13px Arial, sans-serif',
      pointerEvents: 'none', zIndex: 10
    });
    this._canvas.getContainer().appendChild(node);
    this._clock = node;
  }
  return this._clock;
};

// Pone, mueve o crea la marca de un ID. `signature` resume lo que dibuja: si
// cambia -una pelota que termina y pasa a la salida, una insignia con otra
// cuenta-, se vuelve a dibujar en la misma marca.
SceneView.prototype._mark = function(key, draw, element, options, signature, seen) {
  seen.add(key);
  const existing = this._marks.get(key);
  if (existing) {
    if (existing.signature !== signature) {
      while (existing.handle.node.firstChild) existing.handle.node.firstChild.remove();
      draw(existing.handle.node);
      existing.signature = signature;
    }
    existing.handle.moveTo(element, options);
    return existing.handle;
  }
  const handle = this._drawingLayer.addMark(element, { ...options, draw });
  this._marks.set(key, { handle, signature });
  return handle;
};

const ballSignature = (ball, withTag) => `${ball.state} ${ball.zone} ${withTag}`;

// El nombre conserva la tipografia y los saltos de linea de BPMN. Solo cambia
// su presentacion mientras hay marcas: encima de la tarea, con fondo legible.
// El XML y la geometria del modelo no se modifican.
SceneView.prototype._taskLabel = function(element, shape, seen) {
  const gfx = this._elementRegistry.getGraphics(shape);
  const label = gfx && gfx.querySelector('.djs-visual .djs-label');
  if (!label || !label.textContent) return 0;
  const previous = this._labels.get(element);
  if (previous && previous.node !== label) previous.restore();
  if (!previous || previous.node !== label) {
    const visibility = label.style.getPropertyValue('visibility');
    const priority = label.style.getPropertyPriority('visibility');
    this._labels.set(element, { node: label, restore: () => {
      if (visibility) label.style.setProperty('visibility', visibility, priority);
      else label.style.removeProperty('visibility');
    } });
  }
  const box = label.getBBox();
  const copy = label.cloneNode(true);
  copy.style.removeProperty('visibility');
  copy.removeAttribute('transform');
  const width = Math.max(shape.width, box.width + 6);
  const height = box.height + 6;

  // Encajar el diagrama no incluye las marcas. Si el rotulo de arriba se
  // recortaria en el borde del lienzo, cabe debajo de la tarea.
  const below = shape.y - height - 4 < this._canvas.viewbox().y;
  this._mark(`label ${element}`, group => {
    group.setAttribute('class', 'drawing-mark scene-task-label');
    setData(group, { kind: 'label', element });
    svg('rect', { x: (shape.width - width) / 2, y: -height - 4, width, height, rx: 2, fill: '#ffffff' }, group);
    const shifted = svg('g', { transform: `translate(${shape.width / 2 - box.x - box.width / 2} ${-7 - box.y - box.height})` }, group);
    shifted.appendChild(copy);
  }, element, { anchor: 'top-left', dy: below ? shape.height + height + 8 : 0 }, `${shape.width} ${copy.outerHTML}`, seen);
  label.style.setProperty('visibility', 'hidden');
  return below ? 0 : height + 4;
};

// El umbral que se le da a show: un numero -tambien escrito como texto, como el
// de un campo de formulario- o nada, y entonces lo que quepa.
function thresholdOf(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : Math.max(0, n);
}

// Los casos que se dibujan (6.7): `cases` -un Set o cualquier lista de IDs-, o
// todos si no se da.
function casesOf(value) {
  if (value === undefined || value === null) return null;
  return value instanceof Set ? value : new Set(value);
}

SceneView.prototype.show = function(t, options = {}) {
  if (!this._scene) throw new Error('No hay ninguna simulacion cargada: sceneView.load(timeline).');
  const threshold = thresholdOf(options.threshold);
  const state = this._scene.at(t, options);
  const visible = casesOf(options.cases);
  const drawn = id => !visible || visible.has(id);
  const drawnEnvelope = envelope => drawn(envelope.sender) && drawn(envelope.target);
  this._shown = { t, options: { ...options } };
  const seen = new Set();
  const labelHeights = new Map();
  for (const element of Object.keys(state.zones)) {
    const shape = this._elementRegistry.get(element);
    if (hasZones(shape)) labelHeights.set(element, this._taskLabel(element, shape, seen));
  }
  const limit = capacity => (threshold === null ? capacity : threshold);
  const finite = new Set(Object.values(state.staff).filter(pool => pool.resources !== 'infinite').map(pool => pool.pool));
  const travel = ball => {
    const withTag = tagged(ball, finite);
    this._mark(`ball ${ball.id}`, drawBall(ball, withTag), ball.transit.flow, { fraction: ball.transit.fraction },
      ballSignature(ball, withTag), seen).node.dataset.transit = 'true';
  };

  // Las pelotas de cada elemento. Las que van en transito se dibujan en su
  // flujo, pero cuentan en su zona: si la zona es una insignia, van en ella.
  const groups = new Map();
  for (const ball of [ ...state.balls, ...state.blocked ]) {
    if (!groups.has(ball.element)) groups.set(ball.element, []);
    groups.get(ball.element).push(ball);
  }
  for (const [ element, balls ] of groups) {
    const shape = this._elementRegistry.get(element);
    if (hasZones(shape)) {
      const counts = state.zones[element];
      this._mark(`zones ${element}`, drawZones(element, shape.width, shape.height), element,
        { anchor: 'top-left' }, `${shape.width}x${shape.height}`, seen);
      for (const zone of ZONES) {
        const inZone = balls.filter(ball => ball.zone === zone).sort(byCase);
        const withTags = inZone.some(ball => tagged(ball, finite));
        const geometry = zoneGeometry(shape, zone, withTags);
        const cx = geometry.x + geometry.width / 2;
        if (counts[zone].executions > limit(geometry.capacity)) {

          // La insignia, donde siempre: sin pelotas no hay etiquetas.
          const color = colorOfAll(inZone.map(ball => ball.number));
          this._mark(`badge ${element} ${zone}`, drawBadge(element, zone, counts[zone], geometry.width, color), element,
            { anchor: 'top-left', dx: cx, dy: zoneGeometry(shape, zone).cy }, JSON.stringify([ counts[zone], geometry.width, color ]),
            seen);
          continue;
        }
        inZone.filter(ball => ball.transit && drawn(ball.case)).forEach(travel);
        const still = inZone.filter(ball => !ball.transit && drawn(ball.case));
        grid(still.length, geometry.cols, cx, geometry.cy, geometry.rowStep).forEach((place, i) => {
          const withTag = tagged(still[i], finite);
          this._mark(`ball ${still[i].id}`, drawBall(still[i], withTag), element, { anchor: 'top-left', ...place },
            ballSignature(still[i], withTag), seen).node.dataset.transit = 'false';
        });
      }
      continue;
    }

    // Una compuerta, un evento o un elemento que ya no esta en el diagrama.
    const all = countBalls(balls);
    if (all.executions > limit(CENTER_THRESHOLD)) {
      const color = colorOfAll(balls.map(ball => ball.number));
      this._mark(`badge ${element} center`, drawBadge(element, 'center', all, null, color), element, {},
        JSON.stringify([ all, color ]), seen);
      continue;
    }
    balls.filter(ball => ball.transit && drawn(ball.case)).forEach(travel);
    const still = balls.filter(ball => !ball.transit && drawn(ball.case)).sort(byCase);
    const cols = Math.max(1, Math.floor(((shape ? shape.width : STEP) - 4) / STEP));
    grid(still.length, cols, 0, 0).forEach((place, i) => {
      this._mark(`ball ${still[i].id}`, drawBall(still[i]), element, place, ballSignature(still[i], false), seen)
        .node.dataset.transit = 'false';
    });
  }

  // Los sobres: en transito, siempre por su flujo de mensaje, que es lo que
  // viaja; en el buzon, encima de la recepcion, en una fila, o uno solo con la
  // cuenta del buzon -la de la escena, con los que aun van de camino- si son
  // mas de los que caben.
  const mailboxes = new Map();
  for (const [ element, counts ] of Object.entries(state.zones)) {
    if (counts.entry.messages) mailboxes.set(element, []);
  }
  for (const envelope of state.envelopes) {
    if (envelope.transit) {
      if (drawnEnvelope(envelope)) {
        this._mark(`envelope ${envelope.id}`, drawEnvelope(envelope), envelope.transit.flow,
          { fraction: envelope.transit.fraction }, 'envelope', seen).node.dataset.transit = 'true';
      }
      continue;
    }
    if (!mailboxes.has(envelope.to)) mailboxes.set(envelope.to, []);
    mailboxes.get(envelope.to).push(envelope);
  }
  for (const [ element, envelopes ] of mailboxes) {
    const shape = this._elementRegistry.get(element);
    const perRow = Math.max(1, Math.floor(((shape ? shape.width : ENVELOPE_STEP) - 4) / ENVELOPE_STEP));
    const count = state.zones[element] ? state.zones[element].entry.messages : envelopes.length;
    const labelHeight = labelHeights.get(element) || 0;
    if (count > limit(perRow)) {

      // Los que estan en el buzon, tambien los que aun van de camino.
      const inBox = state.envelopes.filter(envelope => envelope.to === element && t < envelope.pickup);
      const color = colorOfAll(inBox.map(envelope => envelope.numbers.request));
      this._mark(`mailbox ${element}`, drawMailbox(element, count, color), element,
        { anchor: 'top-left', dx: 12, dy: -14 - labelHeight }, `${count} ${color}`, seen);
      continue;
    }
    envelopes.filter(drawnEnvelope).forEach((envelope, index) => {
      this._mark(`envelope ${envelope.id}`, drawEnvelope(envelope), element,
        { anchor: 'top-left', dx: 12 + index * ENVELOPE_STEP, dy: -22 - labelHeight }, 'envelope', seen).node.dataset.transit = 'false';
    });
  }

  this._rosters(state.staff, seen);

  for (const [ key, mark ] of this._marks) {
    if (!seen.has(key)) {
      mark.handle.remove();
      this._marks.delete(key);
    }
  }
  for (const [ element, label ] of this._labels) {
    if (!seen.has(`label ${element}`)) {
      label.restore();
      this._labels.delete(element);
    }
  }
  this._clockNode().textContent = formatInstant(this._scene.timeline.startDate, t);
  return state;
};

// -- Donde va cada plantilla -----------------------------------------------------

const intersects = (a, b, margin = 0) => a.x - margin < b.x + b.width && b.x < a.x + a.width + margin &&
  a.y - margin < b.y + b.height && b.y < a.y + a.height + margin;

// Los sitios en los que se prueba a poner una plantilla de tamano `size` junto
// a una caja, en orden: a su derecha, a su izquierda, debajo y encima; en cada
// lado, primero alineada con la esquina de arriba -o la de la izquierda- y
// despues deslizandose por ese lado, sin salirse de el.
export function rosterCandidates(box, size) {
  const steps = (from, to) => {
    const list = [ from ];
    for (let v = from + ROSTER_SLIDE; v < to; v += ROSTER_SLIDE) list.push(v);
    if (to > from) list.push(to);
    return list;
  };
  const ys = steps(box.y, box.y + box.height - size.height);
  const xs = steps(box.x, box.x + box.width - size.width);
  return [
    ...ys.map(y => ({ side: 'right', x: box.x + box.width + ROSTER_GAP, y })),
    ...ys.map(y => ({ side: 'left', x: box.x - ROSTER_GAP - size.width, y })),
    ...xs.map(x => ({ side: 'below', x, y: box.y + box.height + ROSTER_GAP })),
    ...xs.map(x => ({ side: 'above', x, y: box.y - ROSTER_GAP - size.height }))
  ];
}

// Donde va una plantilla junto a `box` sin tapar nada de `obstacles`, con un
// margen: el primero de sus sitios que este libre. Si no queda ninguno, a la
// derecha, bajando hasta debajo de lo que tape.
export function placeRoster(box, size, obstacles) {
  const hit = place => obstacles.find(other => intersects({ ...place, ...size }, other, ROSTER_MARGIN));
  const found = rosterCandidates(box, size).find(place => !hit(place));
  if (found) return found;
  const place = { side: 'right', x: box.x + box.width + ROSTER_GAP, y: box.y };
  for (let other = hit(place); other; other = hit(place)) place.y = other.y + other.height + ROSTER_MARGIN + 1;
  return place;
}

// Lo que una plantilla no puede tapar: las formas del diagrama -pools,
// carriles, elementos y rotulos-. Los grupos no: son un marco, y pueden
// abarcarlo todo.
SceneView.prototype._shapes = function() {
  const root = this._canvas.getRootElement();
  return this._elementRegistry.filter(element => element !== root && !element.waypoints && !element.hidden &&
    element.type !== 'bpmn:Group' && Number.isFinite(element.width) && Number.isFinite(element.height));
};

// Junto a que va la plantilla de un pool, y a que elemento se ancla para
// seguirlo si se mueve: la caja del pool o, en un Process, que no tiene forma,
// la de todo el diagrama, anclada a su elemento mas a la derecha. null si el
// pool ya no esta.
SceneView.prototype._rosterBox = function(poolId, shapes) {
  const pool = this._elementRegistry.get(poolId);
  if (pool && pool.type === 'bpmn:Participant' && pool.width) {
    return { element: poolId, own: pool, box: { x: pool.x, y: pool.y, width: pool.width, height: pool.height } };
  }
  if (!pool || pool !== this._canvas.getRootElement()) return null;
  const solid = shapes.filter(shape => shape.type !== 'label');
  if (!solid.length) return null;
  const right = solid.reduce((a, b) => (b.x + b.width > a.x + a.width ? b : a));
  const x = Math.min(...shapes.map(shape => shape.x));
  const y = Math.min(...shapes.map(shape => shape.y));
  return { element: right.id, own: null, box: { x, y, width: Math.max(...shapes.map(shape => shape.x + shape.width)) - x,
    height: Math.max(...shapes.map(shape => shape.y + shape.height)) - y } };
};

// Lo que llega a ocupar la plantilla de cada pool en toda la simulacion -con
// su cola mas larga y sus textos mas anchos-: se coloca con ese tamano, para
// que no cambie de sitio de un instante a otro. Entre dos cambios de la linea
// de tiempo la plantilla es la misma, asi que basta con mirar los cambios.
SceneView.prototype._rosterReserve = function() {
  if (!this._reserve) {
    const reserve = new Map();
    for (const t of this._scene.timeline.changes()) {
      for (const pool of Object.values(this._scene.staff.at(t))) {
        const { width, height } = rosterLayout(pool);
        const kept = reserve.get(pool.pool) || { width: 0, height: 0 };
        reserve.set(pool.pool, { width: Math.max(kept.width, width), height: Math.max(kept.height, height) });
      }
    }
    this._reserve = reserve;
  }
  return this._reserve;
};

// Las plantillas de todos los pools, de arriba abajo, cada una junto a su pool
// sin tapar ninguna forma del diagrama -tampoco los demas pools- ni otra
// plantilla ya colocada. A la izquierda o encima, pegada a su pool.
SceneView.prototype._rosters = function(staff, seen) {
  const shapes = this._shapes();
  const reserve = this._rosterReserve();
  const placed = [];
  const entries = Object.values(staff).map(pool => ({ pool, at: this._rosterBox(pool.pool, shapes) }))
    .filter(entry => entry.at).sort((a, b) => a.at.box.y - b.at.box.y || a.at.box.x - b.at.box.x);
  for (const { pool, at } of entries) {
    const layout = rosterLayout(pool);
    const kept = reserve.get(pool.pool) || { width: 0, height: 0 };
    const size = { width: Math.max(layout.width, kept.width), height: Math.max(layout.height, kept.height) };
    const place = placeRoster(at.box, size, [ ...shapes.filter(shape => shape !== at.own), ...placed ]);
    placed.push({ x: place.x, y: place.y, ...size });
    const x = place.side === 'left' ? place.x + size.width - layout.width : place.x;
    const y = place.side === 'above' ? place.y + size.height - layout.height : place.y;
    const anchor = this._elementRegistry.get(at.element);
    this._mark(`roster ${pool.pool}`, drawRoster(pool, layout, place.side), at.element,
      { anchor: 'top-left', dx: x - anchor.x, dy: y - anchor.y }, JSON.stringify([ layout, place.side ]), seen);
  }
};

// Encaja en el lienzo el diagrama y todo lo dibujado -las plantillas, junto a
// sus pools, y los nombres de las tareas, encima-, como
// zoom('fit-viewport'), que solo mira el diagrama: sin ampliar y con un
// margen de `padding`. Solo cuentan las marcas que se ven: una cuyo elemento
// ya no esta se oculta, y no se sabe donde estaria. `margins` son los pixeles
// de cada borde del lienzo que tapa algo -la paleta, una barra-: lo encajado
// queda en el resto.
SceneView.prototype.fit = function(padding = 10, margins = {}) {
  const edge = { left: 0, right: 0, top: 0, bottom: 0, ...margins };
  const marks = this._drawingLayer.marks().filter(mark => mark.point).map(mark => {
    const box = mark.node.getBBox();
    return { x: box.x + mark.point.x, y: box.y + mark.point.y, width: box.width, height: box.height };
  });
  const boxes = [ this._canvas.getActiveLayer().getBBox(), ...marks ].filter(box => box.width || box.height);
  if (!boxes.length) return this._canvas.zoom('fit-viewport');
  const left = Math.min(...boxes.map(box => box.x)) - padding;
  const top = Math.min(...boxes.map(box => box.y)) - padding;
  const width = Math.max(...boxes.map(box => box.x + box.width)) + padding - left;
  const height = Math.max(...boxes.map(box => box.y + box.height)) + padding - top;
  const outer = this._canvas.getSize();
  const free = { width: Math.max(1, outer.width - edge.left - edge.right), height: Math.max(1, outer.height - edge.top - edge.bottom) };
  const scale = Math.min(1, free.width / width, free.height / height);
  this._canvas.viewbox({ x: left - edge.left / scale, y: top - edge.top / scale, width: outer.width / scale,
    height: outer.height / scale });
  return scale;
};

// Quita las marcas y el reloj, y descarga la simulacion: hasta otro load, show
// no dibuja nada. Al abrir otro diagrama se limpia sola, porque una simulacion
// es de su diagrama y sus registros no dicen nada del nuevo.
SceneView.prototype.clear = function() {
  for (const label of this._labels.values()) label.restore();
  this._labels.clear();
  for (const mark of this._marks.values()) mark.handle.remove();
  this._marks.clear();
  if (this._clock) this._clock.remove();
  this._clock = null;
  this._scene = null;
  this._reserve = null;
  this._shown = null;
};

export default {
  __depends__: [ drawingModule ],
  __init__: [ 'sceneView' ],
  sceneView: [ 'type', SceneView ]
};
