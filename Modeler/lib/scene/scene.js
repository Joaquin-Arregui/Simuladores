// La escena del visualizador (6.3): las pelotas de los casos y los sobres de
// los mensajes en cada instante, sacadas de la linea de tiempo (6.1).
//
// - Una pelota por cada pieza activa de un caso: cada ejecucion y cada espera.
//   Un caso con dos ramas paralelas, o con las diez ejecuciones de una tarea
//   multiinstancia, tiene varias pelotas a la vez, todas con el numero de su
//   caso dentro de su pool; los casos se cuentan aparte, sin multiplicarse por
//   las pelotas. La pelota se queda en su pool (D15).
// - Un sobre por cada mensaje: sale del envio cuando este acaba y lo recoge la
//   recepcion de su caso destino. Lleva el mensaje -su flujo de mensaje-, la
//   solicitud que lo origina y sus casos remitente y destinatario, y su ID es el
//   de la ejecucion que lo envia: dos sobres entre los mismos casos no se
//   confunden. Entre que sale y que lo recogen esta en el buzon de su recepcion;
//   si la recepcion ya lo esperaba, lo recoge en el acto.
// - Las zonas de cada elemento (6.4, lib/scene/zones.js): cada pelota tiene la
//   suya -la cola, dentro o la salida-, y cada instante trae tambien las
//   ejecuciones bloqueadas a la salida (`blocked`), pelotas de las que ya
//   terminaron en una activacion que aun no ha salido, y los recuentos de cada
//   zona (`zones`).
// - La plantilla de cada pool (6.6, lib/scene/staff.js), la de su registro: en
//   cada instante, quien esta libre y quien ocupado, con que ejecucion y para
//   que solicitud, y la cola del pool (`staff`). Cada pelota que trabaja lleva
//   su persona y el numero de la solicitud que atiende.
//
// El transito es cosmetico (D15). Con `transit` > 0, una pelota que acaba de
// llegar a un elemento se dibuja recorriendo el flujo por el que llego, y un
// sobre que acaba de salir, el flujo de mensaje, durante esos segundos. Una
// pelota que va a estar menos del doble en su elemento lo recorre en la mitad
// de su estancia, para que se la vea llegar. Solo cambia donde se dibujan: en
// el instante t, cada pelota esta ya en su elemento, con su estado, y el reloj
// marca t; el transito no retrasa ni adelanta nada, y con transit = 0 no hay
// transito. Como depende solo de t, saltar a un instante da el mismo dibujo que
// llegar a el reproduciendo.
//
// Sin dependencias del navegador: lo usa la vista (lib/scene/view.js) y, desde
// Node, Backend/pruebas/escena.mjs, zonas.mjs y plantilla.mjs.

import { parseXml } from '../timeline/xml.js';
import { activationsOf, blockedAt, countZones, zoneOf } from './zones.js';
import { createStaff } from './staff.js';

// El grafo que necesita la escena, de un diagrama abierto en bpmn-js: sus
// flujos de secuencia y de mensaje, con sus extremos.
export function graphFromRegistry(elementRegistry) {
  const graph = { sequenceFlows: [], messageFlows: [] };
  for (const element of elementRegistry.getAll()) {
    if (!element.waypoints || !element.source || !element.target) continue;
    const flow = { id: element.id, source: element.source.id, target: element.target.id,
      name: (element.businessObject && element.businessObject.name) || '' };
    if (element.type === 'bpmn:SequenceFlow') graph.sequenceFlows.push(flow);
    if (element.type === 'bpmn:MessageFlow') graph.messageFlows.push(flow);
  }
  return graph;
}

// El mismo grafo, del texto de un .bpmn.
export function graphFromBpmn(xml) {
  const graph = { sequenceFlows: [], messageFlows: [] };
  const visit = element => {
    const { id, sourceRef, targetRef, name = '' } = element.attrs;
    if (element.name === 'sequenceFlow' && id) graph.sequenceFlows.push({ id, source: sourceRef, target: targetRef, name });
    if (element.name === 'messageFlow' && id) graph.messageFlows.push({ id, source: sourceRef, target: targetRef, name });
    element.children.forEach(visit);
  };
  visit(parseXml(xml));
  return graph;
}

const EMPTY_GRAPH = { sequenceFlows: [], messageFlows: [] };

// Cuando recoge su sobre una recepcion. Cada ejecucion de una recepcion espera
// su sobre, si no estaba ya, y en cuanto lo tiene espera a una persona, si no
// hay ninguna libre, y trabaja: sus piezas van seguidas, cada una empieza
// cuando acaba la anterior. Asi que recoge el sobre cuando empieza a esperar a
// la persona, si espero, o cuando empieza a trabajar: la espera de mensaje, si
// la hubo, acaba justo entonces. Su espera de persona es la que acaba cuando
// empieza la recepcion, en el mismo elemento, con la misma ejecucion y el mismo
// remitente; cada una sirve a una sola recepcion.
//
// No basta con buscar la ultima espera de mensaje anterior: dos activaciones
// de la misma recepcion -dos ramas que llegan a ella- numeran las dos su
// ejecucion desde 1 y pueden esperar al mismo remitente, y la espera de la
// segunda puede acabar antes de que empiece la recepcion de la primera, que ya
// tenia su sobre y esperaba a una persona (37).
function pickups(timeline) {
  const result = new Map();
  for (const entry of timeline.cases) {
    const used = new Set();
    const waits = entry.items.filter(item => item.state === 'waiting-user' && item.interval);
    for (const reception of entry.items.filter(item => item.origin && item.sender)) {
      const wait = waits.find(item => !used.has(item.id) && item.element === reception.element &&
        item.activation === reception.activation &&
        item.execution === reception.execution && item.request === reception.sender && item.end === reception.start);
      if (wait) used.add(wait.id);
      result.set(reception.id, wait ? wait.start : reception.start);
    }
  }
  return result;
}

const keyOf = (from, to, sender, target) => JSON.stringify([ from, to, sender, target ]);

// Los sobres de una simulacion: cada envio con la recepcion que lo recoge. Se
// emparejan por elemento que envia, elemento que recibe, caso remitente y caso
// destino, en orden: el buzon de un caso es una cola (D5, D6).
export function messagesOf(timeline, graph = EMPTY_GRAPH) {
  const when = pickups(timeline);
  const numbers = new Map(timeline.cases.map(entry => [ entry.id, entry.instance ]));
  const receptions = new Map();
  for (const item of timeline.items) {
    if (!item.origin || !item.sender) continue;
    const key = keyOf(item.origin, item.element, item.sender, item.case);
    if (!receptions.has(key)) receptions.set(key, []);
    receptions.get(key).push(item);
  }
  for (const list of receptions.values()) list.sort((a, b) => when.get(a.id) - when.get(b.id) || a.order - b.order);
  const flows = new Map(graph.messageFlows.map(flow => [ `${flow.source} ${flow.target}`, flow ]));
  const sends = timeline.items.filter(item => item.destination && item.target)
    .map(item => ({ item, sent: item.interval ? item.end : item.start }))
    .sort((a, b) => a.sent - b.sent || a.item.order - b.item.order);
  const taken = new Map();
  return sends.map(({ item, sent }) => {
    const key = keyOf(item.element, item.destination, item.case, item.target);
    const index = taken.get(key) || 0;
    taken.set(key, index + 1);
    const reception = (receptions.get(key) || [])[index] || null;
    const flow = flows.get(`${item.element} ${item.destination}`) || null;
    const request = item.request || item.case;
    return {
      id: item.id,
      flow: flow ? flow.id : null,
      message: flow ? flow.name : null,
      from: item.element,
      to: item.destination,
      sender: item.case,
      target: item.target,
      request,

      // Los numeros de esos casos dentro de su pool: los que lleva el sobre.
      numbers: {
        sender: numbers.get(item.case) ?? null,
        target: numbers.get(item.target) ?? null,
        request: numbers.get(request) ?? null
      },
      sent,
      pickup: reception ? when.get(reception.id) : Infinity,
      reception: reception ? reception.id : null
    };
  });
}

// El flujo por el que llega una pieza a su elemento, si acaba de llegar: el que
// viene de un elemento en el que el caso estaba justo hasta entonces -una pieza
// que acaba en ese instante o un instante por el que pasa-, o el unico que
// tenga. Una espera y la ejecucion que la sigue en el mismo elemento no se
// mueven: null.
function arrivals(timeline, graph) {
  const incoming = new Map();
  for (const flow of graph.sequenceFlows) {
    if (!incoming.has(flow.target)) incoming.set(flow.target, []);
    incoming.get(flow.target).push(flow);
  }
  const result = new Map();
  for (const entry of timeline.cases) {
    for (const item of entry.items) {
      if (!item.interval) continue;
      const before = entry.items.filter(other => other !== item && other.order < item.order &&
        (other.interval ? other.end === item.start : other.start === item.start));
      if (before.some(other => other.element === item.element && other.interval)) continue;
      const flows = incoming.get(item.element) || [];
      const fromBefore = flows.find(flow => before.some(other => other.element === flow.source));
      const flow = fromBefore || (flows.length === 1 ? flows[0] : null);
      if (flow) result.set(item.id, flow.id);
    }
  }
  return result;
}

export function createScene(timeline, graph = EMPTY_GRAPH) {
  const messages = messagesOf(timeline, graph);
  const arrival = arrivals(timeline, graph);
  const activations = activationsOf(timeline);
  const staff = createStaff(timeline);
  const cases = new Map(timeline.cases.map(entry => [ entry.id, entry ]));
  const numberOf = id => (cases.get(id) || {}).instance ?? null;
  const ballOf = (item, entry, state, since, transit) => ({
    id: item.id,
    case: entry.id,
    pool: entry.pool,
    number: item.instance ?? entry.instance,
    element: item.element,
    state,
    zone: zoneOf(state),
    execution: item.execution,
    request: item.request,
    requestNumber: item.request ? numberOf(item.request) : null,
    user: item.user,
    cancelled: item.cancelled,
    since,
    transit
  });
  return {
    timeline,
    messages,
    activations,
    staff,

    // Lo que hay en el instante t. `transit` son los segundos simulados que
    // dura en pantalla el transito cosmetico; 0, sin transito.
    at(t, { transit = 0 } = {}) {
      const balls = [];
      const active = new Map();
      for (const [ caseId, items ] of timeline.at(t)) {
        const entry = cases.get(caseId);
        if (!active.has(entry.pool)) active.set(entry.pool, new Set());
        active.get(entry.pool).add(caseId);
        for (const item of items) {
          const since = t - item.start;
          const travel = Math.min(transit, (item.end - item.start) / 2);
          const flow = travel > 0 && since < travel ? arrival.get(item.id) : null;
          balls.push(ballOf(item, entry, item.state, item.start, flow ? { flow, fraction: since / travel } : null));
        }
      }

      // Las ejecuciones terminadas que esperan a que salga su activacion:
      // pelotas en la salida, desde que acabaron.
      const blocked = blockedAt(activations, t).map(item => ballOf(item, cases.get(item.case), 'blocked', item.end, null));
      const envelopes = [];
      for (const message of messages) {
        const since = t - message.sent;
        if (since < 0) continue;
        const travelling = transit > 0 && since < transit && message.flow;
        if (!travelling && t >= message.pickup) continue;
        envelopes.push({ ...message, transit: travelling ? { flow: message.flow, fraction: since / transit } : null });
      }

      // Los recuentos van por lo que hay, no por donde se dibuja: un sobre en
      // transito ya esta en su buzon, y una pelota en transito, en su zona.
      const mailbox = messages.filter(message => message.sent <= t && t < message.pickup);
      return {
        t,
        balls,
        blocked,
        envelopes,
        zones: countZones([ ...balls, ...blocked ], mailbox),
        staff: staff.at(t),
        cases: Object.fromEntries([ ...active ].map(([ pool, ids ]) => [ pool, [ ...ids ] ]))
      };
    }
  };
}
