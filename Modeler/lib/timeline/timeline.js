// La linea de tiempo de una simulacion (6.1): lo que hace cada caso en cada
// instante, sacado solo de sus registros XES (D15).
//
// Cada evento del registro es una pieza de la linea:
//
// - Los que tienen inicio y fin -time:timestamp y time:endTime- son
//   intervalos: una ejecucion de una tarea, la espera de un temporizador, o una
//   espera del motor -por una persona libre, un mensaje, unos datos o la otra
//   rama de una union-. El inicio y el fin son los que escribio el motor, nunca
//   el inicio mas la duracion nominal.
// - Los que solo tienen inicio -eventos de inicio y de fin, compuertas,
//   lanzamientos- son instantes: el caso pasa por ahi sin quedarse.
// `passedBetween` devuelve tambien los intervalos con inicio y fin iguales:
// ocurren sin ocupar tiempo, conservando sus datos y su estado del registro.
//
// Con eso, `at(t)` da en cualquier instante el CONJUNTO de lo que cada caso
// tiene activo: varias piezas a la vez si hay ramas paralelas o ejecuciones de
// una tarea multiinstancia, y la misma tarea varias veces seguidas si se repite
// en un bucle, cada una con su ID. Una espera cancelada -la ejecucion de una
// recepcion multiinstancia que esperaba un sobre mas cuando la recepcion cerro-
// es un intervalo como los demas, marcado `cancelled`. El transito por los
// flujos es cosmetico y no esta aqui (6.3): entre el fin de una pieza y el
// inicio de la siguiente no pasa tiempo.
//
// No hay esperas por un tope de concurrencia: con la simplificacion del
// 4/10/2026 el motor no tiene topes, y lo que espera una ejecucion
// multiinstancia es a una persona libre del pool (D4), que es `waiting-user`.
//
// Sin dependencias, como lib/numbers y lib/logs: lo usa el visualizador y,
// desde Node, Backend/pruebas/linea_de_tiempo.mjs.

import { parseXml } from './xml.js';

// Lo que hace un caso en cada pieza, segun el tipo de evento del motor.
export const STATES = {
  StandBy: 'waiting-user',
  StandByMessage: 'waiting-message',
  StandByData: 'waiting-data',
  StandByJoin: 'waiting-join',
  'bpmn:TimerIntermediateCatchEvent': 'timer'
};

function stateOf(type, interval) {
  if (STATES[type]) return STATES[type];
  if (!interval) return 'instant';

  // Una espera de un tipo que este modulo aun no conoce sigue siendo una espera.
  return type && type.startsWith('StandBy') ? 'waiting' : 'working';
}

// Los atributos de un elemento XES -los hijos con key-, con su tipo.
function attributesOf(element) {
  const values = {};
  for (const child of element.children) {
    const { key, value } = child.attrs;
    if (key === undefined) continue;
    switch (child.name) {
    case 'int':
    case 'float':
      values[key] = Number(value);
      break;
    case 'boolean':
      values[key] = value === 'true';
      break;
    case 'string':
    case 'date':
    case 'id':
      values[key] = value;
      break;
    default:
      break; // listas y contenedores: no son de la linea de tiempo
    }
  }
  return values;
}

const childrenNamed = (element, name) => element.children.filter(child => child.name === name);

function seconds(iso, origin) {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new Error(`Una fecha del registro no se entiende: ${JSON.stringify(iso)}.`);
  return (ms - origin) / 1000;
}

const integerOrNull = value => {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
};

function byRank(a, b) {
  for (let i = 0; i < a.rank.length; i++) {
    if (a.rank[i] !== b.rank[i]) return a.rank[i] - b.rank[i];
  }
  return 0;
}

// Un registro: lo que dice su cabecera y sus trazas, sin convertir aun las
// fechas, que necesitan la fecha de inicio comun.
function readLog(log, index) {
  const xes = typeof log === 'string' ? log : log && log.xes;
  if (typeof xes !== 'string') throw new Error(`El registro ${index + 1} no trae XES.`);
  const root = childrenNamed(parseXml(xes), 'log')[0];
  if (!root) throw new Error(`El registro ${index + 1} no es un XES: no tiene <log>.`);
  const header = attributesOf(root);
  const given = typeof log === 'string' ? {} : log;
  return {
    pool: given.pool || header['pool:id'] || null,
    name: given.name ?? header['pool:name'] ?? null,
    header,
    traces: childrenNamed(root, 'trace').map(trace => ({
      attributes: attributesOf(trace),
      events: childrenNamed(trace, 'event').map(attributesOf)
    }))
  };
}

// La linea de tiempo de un conjunto de registros: los de todos los pools de
// una simulacion, como los devuelve el Backend ([{ pool, name, xes }]) o solo
// sus textos. Los instantes se cuentan en segundos desde simulation:startDate,
// o desde el primer evento si ningun registro lo dice.
export function timelineFromLogs(logs) {
  if (!Array.isArray(logs) || !logs.length) throw new Error('No hay ningun registro.');
  const read = logs.map(readLog);
  const startDate = read.map(log => log.header['simulation:startDate']).find(Boolean);
  const stamps = read.flatMap(log => log.traces.flatMap(trace => trace.events.map(e => e['time:timestamp'])))
    .filter(Boolean);
  if (!stamps.length && !startDate) throw new Error('Los registros no tienen ningun evento.');
  const origin = startDate ? Date.parse(startDate) : Math.min(...stamps.map(Date.parse));
  if (Number.isNaN(origin)) throw new Error(`La fecha de inicio no se entiende: ${JSON.stringify(startDate)}.`);

  const cases = [];
  const items = [];
  const seen = new Set();
  read.forEach((log, poolIndex) => {
    log.traces.forEach((trace, traceIndex) => {
      const id = trace.attributes['concept:name'];
      if (!id) throw new Error(`Una traza del registro de ${log.pool || poolIndex + 1} no tiene concept:name.`);
      if (seen.has(id)) throw new Error(`El caso ${id} aparece dos veces.`);
      seen.add(id);
      const first = trace.events[0] || {};
      const pool = first['bpmn:participant'] || log.pool;
      const caseItems = trace.events.map((event, position) => {
        if (!event['time:timestamp']) throw new Error(`El evento ${position + 1} de ${id} no tiene time:timestamp.`);
        const interval = event['time:endTime'] !== undefined;
        const start = seconds(event['time:timestamp'], origin);
        const end = interval ? seconds(event['time:endTime'], origin) : start;
        if (end < start) throw new Error(`El evento ${position + 1} de ${id} acaba antes de empezar.`);
        const occurrence = integerOrNull(event['bpmn:occurrence']) ?? position + 1;
        const flows = event['bpmn:selectedFlow'] ?? event['bpmn:incomingFlow'];
        return {
          id: `${id}#${occurrence}`,
          case: id,
          pool,
          instance: integerOrNull(event['bpmn:instance']),
          call: integerOrNull(event['bpmn:convocatoria']),
          element: event['bpmn:id'] ?? null,
          name: event['bpmn:name'] ?? null,
          type: event['bpmn:type'] ?? null,
          state: stateOf(event['bpmn:type'], interval),
          interval,
          execution: integerOrNull(event['bpmn:execution']),
          occurrence,
          request: event['bpmn:request'] ?? null,
          sender: event['bpmn:messageSender'] ?? null,
          target: event['bpmn:messageTarget'] ?? null,
          user: event['bpmn:userTask'] ?? null,
          flows: flows ? String(flows).split(',').map(flow => flow.trim()).filter(Boolean) : [],
          cancelled: event['bpmn:cancelled'] === true,
          start,
          end,

          // El orden estable: el del registro, que el motor escribe ordenado por
          // instante y, a igual instante, por orden de registro.
          rank: [ start, poolIndex, traceIndex, position ]
        };
      });
      const ids = new Set(caseItems.map(item => item.id));
      if (ids.size !== caseItems.length) throw new Error(`En ${id} hay dos eventos con la misma bpmn:occurrence.`);
      cases.push({
        id,
        pool,
        instance: integerOrNull(first['bpmn:instance']),
        call: integerOrNull(first['bpmn:convocatoria']),
        start: caseItems.length ? Math.min(...caseItems.map(item => item.start)) : null,
        end: caseItems.length ? Math.max(...caseItems.map(item => item.end)) : null,
        items: caseItems
      });
      items.push(...caseItems);
    });
  });
  items.sort(byRank);
  items.forEach((item, order) => {
    item.order = order;
    delete item.rank;
    Object.freeze(item.flows);
    Object.freeze(item);
  });
  for (const entry of cases) entry.items.sort((a, b) => a.order - b.order);
  return new Timeline(read, cases, items, startDate || null);
}

class Timeline {
  constructor(read, cases, items, startDate) {
    const header = (read.find(log => log.header['simulation:id']) || read[0]).header;
    this.simulationId = header['simulation:id'] ?? null;
    this.seed = header['simulation:seed'] ?? null;
    this.startDate = startDate;
    this.pools = read.map(log => ({ id: log.pool, name: log.name }));
    this.cases = cases;
    this.items = items;
    this.start = items.length ? Math.min(...items.map(item => item.start)) : 0;
    this.end = items.length ? Math.max(...items.map(item => item.end)) : 0;
    this._byCase = new Map(cases.map(entry => [ entry.id, entry ]));
    this._intervals = items.filter(item => item.interval && item.end > item.start);
  }

  case(id) {
    return this._byCase.get(id) || null;
  }

  // Lo que cada caso tiene activo en el instante t: los intervalos con
  // inicio <= t < fin, en el orden estable. Un caso que no tiene nada activo
  // no aparece: aun no ha llegado, ya ha terminado, o en t solo pasa por
  // instantes. Al acabar una pieza y empezar la siguiente en el mismo t, esta
  // la siguiente: la que acaba ya no.
  at(t) {
    const positions = new Map();
    for (const item of this._intervals) {
      if (item.start > t) break;
      if (t < item.end) {
        if (!positions.has(item.case)) positions.set(item.case, []);
        positions.get(item.case).push(item);
      }
    }
    return positions;
  }

  // Lo activo en t de un caso, [] si no tiene nada.
  positionsOf(caseId, t) {
    return this.at(t).get(caseId) || [];
  }

  // En que punto de su vida esta un caso en t: 'pending' si aun no ha
  // empezado, 'active' hasta que acaba su ultima pieza y 'finished' desde
  // entonces; null si el caso no existe.
  statusOf(caseId, t) {
    const entry = this.case(caseId);
    if (!entry || entry.start === null) return null;
    if (t < entry.start) return 'pending';
    return t < entry.end ? 'active' : 'finished';
  }

  // Los instantes por los que pasa el caso entre `from` (excluido) y `to`
  // (incluido): inicios, fines, compuertas y ejecuciones o esperas de duracion
  // cero, en el orden estable. Es lo que ocurre sin ocupar tiempo.
  passedBetween(from, to) {
    return this.items.filter(item => item.start === item.end && item.start > from && item.start <= to);
  }

  // Los instantes en los que cambia algo, ordenados y sin repetir: entre dos
  // seguidos, at(t) es el mismo.
  changes() {
    const instants = new Set();
    for (const item of this.items) {
      instants.add(item.start);
      instants.add(item.end);
    }
    return [ ...instants ].sort((a, b) => a - b);
  }
}
