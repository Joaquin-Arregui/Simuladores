// La vista de la escena (6.3, 6.4): dibuja sobre el diagrama, con la capa de
// dibujo (lib/drawing), las pelotas y los sobres de un instante, las tres zonas
// de cada tarea con sus insignias, y el reloj de la simulacion.
//
// Es un modulo de diagram-js -el servicio `sceneView`-, sin mas dependencias
// que la capa de dibujo. `load(timeline)` le da la linea de tiempo de una
// simulacion del diagrama abierto, y `show(t, { transit, threshold })` dibuja
// ese instante y devuelve la escena que ha dibujado (lib/scene/scene.js). Al
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
//
// Las zonas se miden con el tamano que tiene la tarea al dibujar el instante:
// si se agranda, se reparten de nuevo en el siguiente. Los recuentos son los de
// la escena, no los de lo que se ve: una pelota en transito ya cuenta en su
// zona, y si la zona es una insignia va en ella, sin dibujarse en su flujo; un
// sobre en transito cuenta en su buzon, pero se sigue dibujando en su flujo de
// mensaje, que es lo que viaja. El umbral es un numero, tambien escrito como
// texto; uno mayor que lo que cabe deja que las pelotas se salgan de la
// franja. Los colores de la resolucion
// -aceptada, rechazada- son de la 6.5: aqui todas las pelotas son blancas. Las
// marcas no capturan el raton, como todas las de la capa de dibujo: su <title>
// lo leen las pruebas y los lectores de pantalla, no aparece al pasar por
// encima.

import drawingModule from '../drawing/drawing.js';
import { createScene, graphFromRegistry } from './scene.js';
import { ZONES, countBalls } from './zones.js';

const SVG = 'http://www.w3.org/2000/svg';
const RADIUS = 6; // el de una pelota
const STEP = 15; // la distancia entre dos pelotas de la misma zona
const CAPTION = 14; // lo que se reserva debajo de las pelotas, para el nombre de la zona
const CENTER_THRESHOLD = 4; // las pelotas de una compuerta o un evento antes de la insignia
const ENVELOPE_STEP = 24; // la distancia entre dos sobres del mismo buzon
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

function drawBall(ball) {
  return group => {
    group.setAttribute('class', 'drawing-mark scene-ball');
    setData(group, { kind: 'ball', case: ball.case, pool: ball.pool, number: ball.number, element: ball.element,
      state: ball.state, zone: ball.zone, execution: ball.execution, cancelled: ball.cancelled });
    svg('title', {}, group).textContent = `${ball.case}${ball.execution ? `, ejecucion ${ball.execution}` : ''}: ` +
      `${STATE_NAMES[ball.state] || ball.state}${ball.request ? `, para ${ball.request}` : ''}`;
    svg('circle', {
      r: RADIUS, fill: '#ffffff', stroke: INK, 'stroke-width': 1.3,
      'stroke-dasharray': ball.state === 'working' ? 'none' : '2.2 1.4'
    }, group);
    const label = String(ball.number ?? '');
    text(group, label, { 'dominant-baseline': 'central', 'font-size': label.length > 2 ? 5.5 : 7 });
  };
}

function drawEnvelope(envelope) {
  return group => {
    group.setAttribute('class', 'drawing-mark scene-envelope');
    setData(group, { kind: 'envelope', id: envelope.id, sender: envelope.sender, target: envelope.target,
      request: envelope.request, flow: envelope.flow, message: envelope.message });
    svg('title', {}, group).textContent = `${envelope.message || 'Mensaje'} de ${envelope.sender} a ${envelope.target}, ` +
      `solicitud de ${envelope.request}`;
    svg('rect', { x: -7, y: -5, width: 14, height: 10, rx: 1, fill: '#fffbea', stroke: INK, 'stroke-width': 1.2 }, group);
    svg('path', { d: 'M -7 -5 L 0 1 L 7 -5', fill: 'none', stroke: INK, 'stroke-width': 1 }, group);
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

// La insignia de una zona: cuantas ejecuciones, de cuantos casos y de cuantos
// casos son sus solicitudes. `width` es la de su franja, o null en el centro de
// una compuerta o un evento.
function drawBadge(element, zone, counts, width) {
  return group => {
    group.setAttribute('class', 'drawing-mark scene-badge');
    setData(group, { kind: 'badge', element, zone, executions: counts.executions, cases: counts.cases,
      requests: counts.requests });
    const lines = [ plural(counts.cases, 'caso', 'casos') ];
    if (counts.requests) lines.push(`${counts.requests} sol.`);
    svg('title', {}, group).textContent = `${element}${width ? `, ${ZONE_NAMES[zone]}` : ''}: ` +
      `${plural(counts.executions, 'ejecucion', 'ejecuciones')} de ${plural(counts.cases, 'caso', 'casos')}` +
      `${counts.requests ? `, con solicitudes de ${plural(counts.requests, 'caso', 'casos')}` : ''}`;
    const w = width ? Math.max(20, width - 4) : 30;
    const h = 24 + 8 * lines.length;
    svg('rect', { x: -w / 2, y: -h / 2, width: w, height: h, rx: 3, fill: '#ffffff', stroke: INK, 'stroke-width': 1,
      'stroke-dasharray': zone === 'inside' ? 'none' : '2.2 1.4' }, group);
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

// El buzon lleno: un sobre con cuantos hay.
function drawMailbox(element, count) {
  return group => {
    group.setAttribute('class', 'drawing-mark scene-mailbox');
    setData(group, { kind: 'mailbox', element, messages: count });
    svg('title', {}, group).textContent = `${element}: ${plural(count, 'sobre', 'sobres')} en el buzon`;
    svg('rect', { x: -7, y: -5, width: 14, height: 10, rx: 1, fill: '#fffbea', stroke: INK, 'stroke-width': 1.2 }, group);
    svg('path', { d: 'M -7 -5 L 0 1 L 7 -5', fill: 'none', stroke: INK, 'stroke-width': 1 }, group);
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

// Las franjas de una tarea: donde empieza cada una, su ancho y cuantas pelotas
// caben en ella, en columnas y filas.
export function zoneGeometry(shape, zone) {
  const width = shape.width / 3;
  const cols = Math.max(1, Math.floor((width - 3) / STEP));
  const rows = Math.max(1, Math.floor((shape.height - CAPTION) / STEP));
  return { x: ZONES.indexOf(zone) * width, width, cols, rows, capacity: cols * rows };
}

// Donde va cada una de `count` pelotas en una rejilla de `cols` columnas
// alrededor de (cx, cy), en filas centradas.
function grid(count, cols, cx, cy) {
  const rows = Math.ceil(count / cols);
  return Array.from({ length: count }, (_, i) => {
    const row = Math.floor(i / cols);
    const inRow = row === rows - 1 ? count - row * cols : cols;
    return { dx: cx + (i % cols - (inRow - 1) / 2) * STEP, dy: cy + (row - (rows - 1) / 2) * STEP };
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

const ballSignature = ball => `${ball.state} ${ball.zone}`;

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

SceneView.prototype.show = function(t, options = {}) {
  if (!this._scene) throw new Error('No hay ninguna simulacion cargada: sceneView.load(timeline).');
  const threshold = thresholdOf(options.threshold);
  const state = this._scene.at(t, options);
  this._shown = { t, options: { ...options } };
  const seen = new Set();
  const labelHeights = new Map();
  for (const element of Object.keys(state.zones)) {
    const shape = this._elementRegistry.get(element);
    if (hasZones(shape)) labelHeights.set(element, this._taskLabel(element, shape, seen));
  }
  const limit = capacity => (threshold === null ? capacity : threshold);
  const travel = ball => this._mark(`ball ${ball.id}`, drawBall(ball), ball.transit.flow,
    { fraction: ball.transit.fraction }, ballSignature(ball), seen);

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
        const geometry = zoneGeometry(shape, zone);
        const cx = geometry.x + geometry.width / 2;
        const cy = (shape.height - CAPTION) / 2 + 2;
        if (counts[zone].executions > limit(geometry.capacity)) {
          this._mark(`badge ${element} ${zone}`, drawBadge(element, zone, counts[zone], geometry.width), element,
            { anchor: 'top-left', dx: cx, dy: cy }, JSON.stringify([ counts[zone], geometry.width ]), seen);
          continue;
        }
        inZone.filter(ball => ball.transit).forEach(travel);
        const still = inZone.filter(ball => !ball.transit);
        grid(still.length, geometry.cols, cx, cy).forEach((place, i) => this._mark(`ball ${still[i].id}`,
          drawBall(still[i]), element, { anchor: 'top-left', ...place }, ballSignature(still[i]), seen));
      }
      continue;
    }

    // Una compuerta, un evento o un elemento que ya no esta en el diagrama.
    const all = countBalls(balls);
    if (all.executions > limit(CENTER_THRESHOLD)) {
      this._mark(`badge ${element} center`, drawBadge(element, 'center', all, null), element, {},
        JSON.stringify(all), seen);
      continue;
    }
    balls.filter(ball => ball.transit).forEach(travel);
    const still = balls.filter(ball => !ball.transit).sort(byCase);
    const cols = Math.max(1, Math.floor(((shape ? shape.width : STEP) - 4) / STEP));
    grid(still.length, cols, 0, 0).forEach((place, i) => this._mark(`ball ${still[i].id}`, drawBall(still[i]), element,
      place, ballSignature(still[i]), seen));
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
      this._mark(`envelope ${envelope.id}`, drawEnvelope(envelope), envelope.transit.flow,
        { fraction: envelope.transit.fraction }, 'envelope', seen);
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
      this._mark(`mailbox ${element}`, drawMailbox(element, count), element,
        { anchor: 'top-left', dx: 12, dy: -14 - labelHeight }, String(count), seen);
      continue;
    }
    envelopes.forEach((envelope, index) => this._mark(`envelope ${envelope.id}`, drawEnvelope(envelope), element,
      { anchor: 'top-left', dx: 12 + index * ENVELOPE_STEP, dy: -22 - labelHeight }, 'envelope', seen));
  }

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
  this._shown = null;
};

export default {
  __depends__: [ drawingModule ],
  __init__: [ 'sceneView' ],
  sceneView: [ 'type', SceneView ]
};
