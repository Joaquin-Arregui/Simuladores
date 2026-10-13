// La capa de dibujo del visualizador (6.2): marcas en SVG sobre el lienzo de
// bpmn-js, colocadas por el ID BPMN de su elemento.
//
// Las marcas van en una capa propia del lienzo, dentro del mismo grupo
// `viewport` que los elementos, y se colocan en coordenadas del diagrama. Por
// eso, al ampliar, reducir o arrastrar el diagrama no hay nada que recalcular:
// el lienzo transforma a la vez elementos y marcas, y cada marca sigue pegada
// al suyo. Lo que si hay que seguir es al elemento: si se mueve, si su flujo
// cambia de recorrido, si se borra o vuelve con deshacer. Para eso la capa
// escucha `elements.changed` y vuelve a colocar las marcas de esos elementos;
// una marca cuyo elemento no esta se oculta y reaparece si vuelve.
//
// Las marcas van por ID, y un elemento puede cambiar de ID -el campo ID del
// panel General-: entonces el cambio llega con el ID nuevo, y la marca, que
// tiene el anterior, se quedaria donde estaba. Por eso cada marca recuerda el
// elemento en el que esta, y se vuelve a colocar tambien si su ID ya no da ese
// elemento: se oculta, porque ya no hay ninguno con su ID, y vuelve si se
// deshace el cambio.
//
// Para el transito (6.3), una marca se puede poner en un punto de una conexion:
// la fraccion de su recorrido, medida por longitud sobre sus puntos de paso,
// con el angulo del tramo para orientarla. El transito es cosmetico: aqui solo
// se dice donde dibujar, nunca cuanto tiempo pasa.
//
// Las marcas no capturan el raton (pointer-events="none"): el diagrama se
// sigue seleccionando y editando a traves de ellas.
//
// Es un modulo de diagram-js, sin dependencias: se anade en additionalModules y
// se usa como el servicio `drawingLayer`. La geometria -anchorOf, pointAlong-
// se exporta aparte para probarla sin navegador.

const SVG = 'http://www.w3.org/2000/svg';
const LAYER = 'simulation-drawing';

// Por encima de los elementos (0) y de lo que dibuja el propio lienzo (1).
const LAYER_INDEX = 2;

// El punto de una caja que corresponde a cada nombre.
const ANCHORS = {
  center: [ 0.5, 0.5 ], top: [ 0.5, 0 ], bottom: [ 0.5, 1 ], left: [ 0, 0.5 ], right: [ 1, 0.5 ],
  'top-left': [ 0, 0 ], 'top-right': [ 1, 0 ], 'bottom-left': [ 0, 1 ], 'bottom-right': [ 1, 1 ]
};

export function anchorOf(bounds, anchor = 'center') {
  const factors = ANCHORS[anchor];
  if (!factors) throw new Error(`Ancla desconocida: ${anchor}.`);
  return { x: bounds.x + bounds.width * factors[0], y: bounds.y + bounds.height * factors[1] };
}

// El punto a una fraccion del recorrido de una linea de puntos de paso, por
// longitud, y el angulo en grados de su tramo. La fraccion se recorta a [0, 1];
// los tramos de longitud cero no cuentan ni para el punto ni para el angulo.
export function pointAlong(waypoints, fraction) {
  if (!Array.isArray(waypoints) || !waypoints.length) return null;
  const f = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
  const tramos = [];
  for (let i = 1; i < waypoints.length; i++) {
    const a = waypoints[i - 1], b = waypoints[i];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length > 0) tramos.push({ a, b, length });
  }
  if (!tramos.length) return { x: waypoints[0].x, y: waypoints[0].y, angle: 0 };
  const total = tramos.reduce((suma, tramo) => suma + tramo.length, 0);
  let falta = f * total;
  for (const [ i, { a, b, length } ] of tramos.entries()) {
    if (falta <= length || i === tramos.length - 1) {
      const t = Math.min(1, falta / length);
      return {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        angle: Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI
      };
    }
    falta -= length;
  }
}

// La marca por defecto: un circulo. Las del visualizador (6.3) dibujan lo suyo.
function defaultDrawing(group) {
  const circle = document.createElementNS(SVG, 'circle');
  circle.setAttribute('r', '6');
  circle.setAttribute('class', 'drawing-mark-default');
  circle.setAttribute('fill', '#ffffff');
  circle.setAttribute('stroke', '#22242a');
  circle.setAttribute('stroke-width', '2');
  group.appendChild(circle);
}

export function DrawingLayer(canvas, elementRegistry, eventBus) {
  this._canvas = canvas;
  this._elementRegistry = elementRegistry;
  this._marks = new Map();
  this._next = 1;

  eventBus.on('elements.changed', ({ elements }) => {
    const changed = new Set(elements.map(element => element.id));
    for (const mark of this._marks.values()) {
      if (changed.has(mark.placement.element) || elementRegistry.get(mark.placement.element) !== mark.target) {
        this._place(mark);
      }
    }
  });

  // Otro diagrama: las marcas del anterior no tienen sentido en el.
  eventBus.on('diagram.clear', () => this.clear());
}

DrawingLayer.$inject = [ 'canvas', 'elementRegistry', 'eventBus' ];

DrawingLayer.prototype._layer = function() {
  const layer = this._canvas.getLayer(LAYER, LAYER_INDEX);
  layer.setAttribute('pointer-events', 'none');
  return layer;
};

// Donde va una colocacion en su elemento, en coordenadas del diagrama, o null
// si el elemento no esta en el diagrama.
function pointOn(element, placement) {
  if (!element) return null;
  let point;
  if (element.waypoints) {
    const fraction = placement.fraction === undefined ? 0.5 : placement.fraction;
    point = pointAlong(element.waypoints, fraction);
  } else {
    point = { ...anchorOf(element, placement.anchor), angle: 0 };
  }
  return point && { x: point.x + placement.dx, y: point.y + placement.dy, angle: point.angle };
}

DrawingLayer.prototype._place = function(mark) {
  mark.target = this._elementRegistry.get(mark.placement.element) || null;
  const point = pointOn(mark.target, mark.placement);
  mark.point = point;
  if (!point) {
    mark.node.setAttribute('visibility', 'hidden');
    return;
  }
  mark.node.removeAttribute('visibility');
  const rotate = mark.placement.rotate && point.angle ? ` rotate(${point.angle})` : '';
  mark.node.setAttribute('transform', `translate(${point.x} ${point.y})${rotate}`);
};

function placementFrom(element, options = {}) {
  if (typeof element !== 'string' || !element) throw new Error('Una marca necesita el ID de su elemento.');
  const { anchor = 'center', dx = 0, dy = 0, fraction, rotate = false } = options;
  if (!ANCHORS[anchor]) throw new Error(`Ancla desconocida: ${anchor}.`);
  return { element, anchor, dx, dy, fraction, rotate };
}

// Una marca nueva en un elemento: en un ancla de su caja (center, top,
// bottom-left...), o, si es una conexion, a una fraccion de su recorrido
// (`fraction`, 0.5 si no se dice), girada como su tramo con `rotate`. `dx` y
// `dy` la desplazan en coordenadas del diagrama, y `draw(group)` dibuja su
// contenido alrededor del origen; sin el, un circulo.
DrawingLayer.prototype.addMark = function(element, options = {}) {
  const node = document.createElementNS(SVG, 'g');
  node.setAttribute('class', 'drawing-mark');
  const id = this._next++;
  node.setAttribute('data-mark-id', String(id));
  (options.draw || defaultDrawing)(node);
  const mark = { id, node, placement: placementFrom(element, options), target: null, point: null };
  this._marks.set(id, mark);
  this._layer().appendChild(node);
  this._place(mark);
  return this._handle(mark);
};

DrawingLayer.prototype._handle = function(mark) {
  const layer = this;
  return {
    id: mark.id,
    node: mark.node,
    get element() {
      return mark.placement.element;
    },

    // Donde esta, en coordenadas del diagrama, o null si su elemento no esta.
    get point() {
      return mark.point && { ...mark.point };
    },
    moveTo(element, options) {
      mark.placement = placementFrom(element, options);
      layer._place(mark);
      return this;
    },
    remove() {
      mark.node.remove();
      layer._marks.delete(mark.id);
    }
  };
};

DrawingLayer.prototype.marks = function() {
  return [ ...this._marks.values() ].map(mark => this._handle(mark));
};

// El punto de un elemento en coordenadas del diagrama: un ancla de su caja, o
// el punto medio del recorrido si es una conexion. null si no esta.
DrawingLayer.prototype.positionOf = function(element, anchor = 'center') {
  const point = pointOn(this._elementRegistry.get(element), placementFrom(element, { anchor }));
  return point && { x: point.x, y: point.y };
};

// El punto a una fraccion del recorrido de una conexion, con el angulo de su
// tramo; null si no esta o no es una conexion.
DrawingLayer.prototype.pointAlong = function(connection, fraction) {
  const element = this._elementRegistry.get(connection);
  return element && element.waypoints ? pointAlong(element.waypoints, fraction) : null;
};

DrawingLayer.prototype.clear = function() {
  for (const mark of this._marks.values()) mark.node.remove();
  this._marks.clear();
};

export default {
  __init__: [ 'drawingLayer' ],
  drawingLayer: [ 'type', DrawingLayer ]
};
