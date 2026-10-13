// La vista de la escena (6.3): dibuja sobre el diagrama, con la capa de dibujo
// (lib/drawing), las pelotas y los sobres de un instante, y el reloj de la
// simulacion.
//
// Es un modulo de diagram-js -el servicio `sceneView`-, sin mas dependencias
// que la capa de dibujo. `load(timeline)` le da la linea de tiempo de una
// simulacion del diagrama abierto, y `show(t, { transit })` dibuja ese
// instante y devuelve la escena que ha dibujado (lib/scene/scene.js). Al abrir
// otro diagrama, o con clear(), la simulacion se descarga, y show exige otro
// load. Cada pelota y cada sobre es una marca con su ID, que se reutiliza de un
// instante a otro: entre dos instantes solo se mueve lo que cambia.
//
// - La pelota lleva el numero de su caso dentro de su pool. Trabajando, el
//   borde es continuo; esperando, discontinuo. Las pelotas de un mismo elemento
//   se reparten en filas alrededor de su centro, en el orden de sus casos.
// - El sobre lleva debajo los numeros de sus casos remitente y destinatario,
//   «1→2», con el del caso cuya solicitud es en negrita: en una convocatoria,
//   los sobres que el orquestador 1 manda a cada orquestado se distinguen por
//   su destinatario. El mensaje es el de su flujo. En el buzon, encima de la
//   recepcion, en fila desde su esquina izquierda por orden de llegada, y en
//   filas hacia arriba si no caben; en transito, recorre su flujo de mensaje.
// - El reloj, encima del lienzo, marca siempre el instante simulado t, tambien
//   durante el transito, que es cosmetico.
//
// Cuantas caben en una tarea -las zonas y las insignias- es de la 6.4: aqui
// cada pelota y cada sobre tiene su marca, aunque desborde el elemento. Los
// colores de la resolucion -aceptada, rechazada- son de la 6.5: aqui todas las
// pelotas son blancas. Las marcas no capturan el raton, como todas
// las de la capa de dibujo: su <title> lo leen las pruebas y los lectores de
// pantalla, no aparece al pasar por encima.

import drawingModule from '../drawing/drawing.js';
import { createScene, graphFromRegistry } from './scene.js';

const SVG = 'http://www.w3.org/2000/svg';
const STEP = 18; // la distancia entre dos pelotas del mismo elemento
const ENVELOPE_STEP = 24; // y entre dos sobres del mismo buzon,
const ENVELOPE_ROW = 22; // que se apilan hacia arriba en filas

function svg(name, attributes = {}, parent) {
  const node = document.createElementNS(SVG, name);
  for (const [ key, value ] of Object.entries(attributes)) node.setAttribute(key, String(value));
  if (parent) parent.appendChild(node);
  return node;
}

const STATE_NAMES = {
  working: 'trabajando',
  'waiting-user': 'esperando a una persona',
  'waiting-message': 'esperando un mensaje',
  'waiting-data': 'esperando unos datos',
  'waiting-join': 'esperando a la otra rama',
  timer: 'esperando su temporizador',
  waiting: 'esperando'
};

function drawBall(ball) {
  return group => {
    group.setAttribute('class', 'drawing-mark scene-ball');
    for (const [ key, value ] of Object.entries({ kind: 'ball', case: ball.case, pool: ball.pool, number: ball.number,
      element: ball.element, state: ball.state, execution: ball.execution ?? '', cancelled: ball.cancelled })) {
      group.setAttribute(`data-${key}`, String(value));
    }
    svg('title', {}, group).textContent = `${ball.case}${ball.execution ? `, ejecucion ${ball.execution}` : ''}: ` +
      `${STATE_NAMES[ball.state] || ball.state}${ball.request ? `, para ${ball.request}` : ''}`;
    svg('circle', {
      r: 8, fill: '#ffffff', stroke: '#22242a', 'stroke-width': 1.5,
      'stroke-dasharray': ball.state === 'working' ? 'none' : '2.5 1.5'
    }, group);
    svg('text', {
      'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': 9,
      'font-family': 'Arial, sans-serif', fill: '#22242a'
    }, group).textContent = String(ball.number ?? '');
  };
}

function drawEnvelope(envelope) {
  return group => {
    group.setAttribute('class', 'drawing-mark scene-envelope');
    for (const [ key, value ] of Object.entries({ kind: 'envelope', id: envelope.id, sender: envelope.sender,
      target: envelope.target, request: envelope.request, flow: envelope.flow ?? '', message: envelope.message ?? '' })) {
      group.setAttribute(`data-${key}`, String(value));
    }
    svg('title', {}, group).textContent = `${envelope.message || 'Mensaje'} de ${envelope.sender} a ${envelope.target}, ` +
      `solicitud de ${envelope.request}`;
    svg('rect', { x: -7, y: -5, width: 14, height: 10, rx: 1, fill: '#fffbea', stroke: '#22242a', 'stroke-width': 1.2 }, group);
    svg('path', { d: 'M -7 -5 L 0 1 L 7 -5', fill: 'none', stroke: '#22242a', 'stroke-width': 1 }, group);
    const label = svg('text', {
      x: 0, y: 11, 'text-anchor': 'middle', 'dominant-baseline': 'hanging', 'font-size': 7,
      'font-family': 'Arial, sans-serif', fill: '#22242a'
    }, group);
    const { sender, target } = envelope.numbers;
    const part = (text, bold) => {
      svg('tspan', bold ? { 'font-weight': 'bold' } : {}, label).textContent = String(text ?? '?');
    };
    part(sender, envelope.request === envelope.sender);
    part('→');
    part(target, envelope.request !== envelope.sender && envelope.request === envelope.target);
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

export function SceneView(canvas, drawingLayer, elementRegistry, eventBus) {
  this._canvas = canvas;
  this._drawingLayer = drawingLayer;
  this._elementRegistry = elementRegistry;
  this._scene = null;
  this._marks = new Map();
  this._clock = null;

  // Otro diagrama: la escena era del anterior, y su simulacion tambien.
  eventBus.on('diagram.clear', () => this.clear());
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
      background: '#ffffff', border: '1px solid #22242a', borderRadius: '4px', font: '13px Arial, sans-serif',
      pointerEvents: 'none', zIndex: 10
    });
    this._canvas.getContainer().appendChild(node);
    this._clock = node;
  }
  return this._clock;
};

// Pone, mueve o crea la marca de un ID.
SceneView.prototype._mark = function(key, draw, element, options, seen) {
  seen.add(key);
  const existing = this._marks.get(key);
  if (existing) return existing.moveTo(element, options);
  const mark = this._drawingLayer.addMark(element, { ...options, draw });
  this._marks.set(key, mark);
  return mark;
};

// Donde va cada pelota de un elemento: en filas alrededor de su centro.
function grid(count, width) {
  const perRow = Math.max(1, Math.floor((width - 4) / STEP));
  const rows = Math.ceil(count / perRow);
  return Array.from({ length: count }, (_, i) => {
    const row = Math.floor(i / perRow);
    const inRow = row === rows - 1 ? count - row * perRow : perRow;
    const col = i % perRow;
    return { dx: (col - (inRow - 1) / 2) * STEP, dy: (row - (rows - 1) / 2) * STEP };
  });
}

SceneView.prototype.show = function(t, options = {}) {
  if (!this._scene) throw new Error('No hay ninguna simulacion cargada: sceneView.load(timeline).');
  const state = this._scene.at(t, options);
  const seen = new Set();

  const byElement = new Map();
  for (const ball of state.balls) {
    if (ball.transit) {
      this._mark(`ball ${ball.id}`, drawBall(ball), ball.transit.flow, { fraction: ball.transit.fraction }, seen);
    } else {
      if (!byElement.has(ball.element)) byElement.set(ball.element, []);
      byElement.get(ball.element).push(ball);
    }
  }
  for (const [ element, balls ] of byElement) {
    const shape = this._elementRegistry.get(element);
    balls.sort((a, b) => a.pool.localeCompare(b.pool) || (a.number ?? 0) - (b.number ?? 0) ||
      (a.execution ?? 0) - (b.execution ?? 0) || a.since - b.since || a.id.localeCompare(b.id));
    const places = grid(balls.length, shape ? shape.width : STEP);
    balls.forEach((ball, i) => this._mark(`ball ${ball.id}`, drawBall(ball), element, places[i], seen));
  }

  const mailboxes = new Map();
  for (const envelope of state.envelopes) {
    const draw = drawEnvelope(envelope);
    if (envelope.transit) {
      this._mark(`envelope ${envelope.id}`, draw, envelope.transit.flow, { fraction: envelope.transit.fraction }, seen);
      continue;
    }
    const index = mailboxes.get(envelope.to) || 0;
    mailboxes.set(envelope.to, index + 1);
    const shape = this._elementRegistry.get(envelope.to);
    const perRow = Math.max(1, Math.floor(((shape ? shape.width : ENVELOPE_STEP) - 4) / ENVELOPE_STEP));
    this._mark(`envelope ${envelope.id}`, draw, envelope.to, {
      anchor: 'top-left',
      dx: 12 + (index % perRow) * ENVELOPE_STEP,
      dy: -22 - Math.floor(index / perRow) * ENVELOPE_ROW
    }, seen);
  }

  for (const [ key, mark ] of this._marks) {
    if (!seen.has(key)) {
      mark.remove();
      this._marks.delete(key);
    }
  }
  this._clockNode().textContent = formatInstant(this._scene.timeline.startDate, t);
  return state;
};

// Quita las marcas y el reloj, y descarga la simulacion: hasta otro load, show
// no dibuja nada. Al abrir otro diagrama se limpia sola, porque una simulacion
// es de su diagrama y sus registros no dicen nada del nuevo.
SceneView.prototype.clear = function() {
  for (const mark of this._marks.values()) mark.remove();
  this._marks.clear();
  if (this._clock) this._clock.remove();
  this._clock = null;
  this._scene = null;
};

export default {
  __depends__: [ drawingModule ],
  __init__: [ 'sceneView' ],
  sceneView: [ 'type', SceneView ]
};
