// Las tres zonas de cada tarea (6.4): la cola a la entrada, lo que esta en
// proceso dentro y lo que esta bloqueado a la salida, con sus recuentos, sacados
// de los intervalos de la linea de tiempo.
//
// - La entrada son las piezas que esperan para hacer la tarea: a una persona,
//   su sobre o unos datos -en una union, a la otra rama-, y los sobres que
//   esperan en su buzon a que una recepcion los recoja.
// - Dentro estan las ejecuciones que trabajan -en un evento, la espera de su
//   temporizador-.
// - A la salida, las ejecuciones ya terminadas de una activacion que todavia no
//   ha salido de la tarea: en un lote paralelo, las que acabaron y esperan a
//   las demas; en uno en secuencia, y en las vueltas de un bucle, las que ya se
//   hicieron mientras se hace la siguiente. El registro no distingue un bucle
//   de un lote en secuencia -los dos son ejecuciones seguidas con el numero
//   creciente-, asi que se cuentan igual.
//
// El motor registra bpmn:activation, la identidad del token que activo la
// tarea, en todas sus piezas, incluidas las esperas canceladas. Junto con el
// caso y el elemento separa lotes simultaneos aunque empiecen a la vez y
// numeren sus ejecuciones desde 1. La activacion termina con su ultima pieza.
// Para registros antiguos se conserva la reconstruccion por tiempos solo si
// no hay varias cadenas o activaciones candidatas; si las hay, hay que volver
// a simular para obtener el identificador, no inventar un recuento.
//
// Los recuentos de cada zona: las ejecuciones -las piezas que hay en ella-, de
// cuantos casos distintos son -dos ramas del mismo caso no lo cuentan dos
// veces-, de cuantos casos distintos son las solicitudes que tienen ya en la
// mano -esperando a una persona, trabajando o terminadas; no las que esperan
// un sobre, que aun no ha llegado- y, a la entrada de una recepcion, cuantos
// sobres hay en su buzon.

export const ZONES = [ 'entry', 'inside', 'exit' ];

const ZONE_OF_STATE = {
  'waiting-user': 'entry',
  'waiting-message': 'entry',
  'waiting-data': 'entry',
  'waiting-join': 'entry',
  working: 'inside',
  timer: 'inside',
  blocked: 'exit'
};

// La zona de una pieza por su estado. Una espera que la linea de tiempo aun no
// conoce ('waiting') sigue siendo una espera: a la entrada.
export function zoneOf(state) {
  return ZONE_OF_STATE[state] || (String(state).startsWith('waiting') ? 'entry' : 'inside');
}

const IN_HAND = new Set([ 'waiting-user', 'working', 'blocked' ]);

// El orden de las piezas de una ejecucion: primero espera su sobre, luego a una
// persona y luego trabaja.
const RANK = { 'waiting-message': 0, 'waiting-user': 1, working: 2 };
const rankOf = state => RANK[state] ?? (String(state).startsWith('waiting') ? 1 : 2);

// Las cadenas de las ejecuciones de un elemento en un caso: cada pieza sigue a
// la de su misma ejecucion que acaba justo cuando ella empieza, si la cadena no
// ha terminado ya -con su trabajo o con una espera cancelada-, si va despues en
// ese orden y, si las dos dicen su solicitud, si es la misma. Lo ultimo separa
// dos activaciones a la vez de la misma tarea cuando una pieza de una empieza
// justo cuando acaba otra de la otra: la solicitud de una ejecucion no cambia
// de una pieza a la siguiente.
function chainsOf(items) {
  const chains = [];
  const sorted = [ ...items ].sort((a, b) => a.start - b.start || a.order - b.order);
  for (const item of sorted) {
    const candidates = chains.filter(c => !c.closed && c.execution === item.execution && c.end === item.start &&
      rankOf(c.pieces[c.pieces.length - 1].state) < rankOf(item.state) &&
      !(c.request && item.request && c.request !== item.request));
    if (candidates.length > 1) throw ambiguousActivation(item.element);
    let chain = candidates[0];
    if (chain) {
      chain.pieces.push(item);
      chain.end = item.end;
      chain.request = chain.request || item.request;
    } else {
      chain = { execution: item.execution, pieces: [ item ], start: item.start, end: item.end, closed: false,
        request: item.request };
      chains.push(chain);
    }
    if (item.state === 'working' || item.cancelled) chain.closed = true;
  }
  return chains;
}

function ambiguousActivation(element) {
  return new Error(`El registro de ${element} no distingue sus activaciones simultaneas. Vuelve a simular para obtener bpmn:activation.`);
}

// Con identidad registrada no se empareja por tiempos ni por orden de cierre.
function recordedActivation(entry, element, id, items) {
  const byExecution = new Map();
  for (const item of items) {
    if (!byExecution.has(item.execution)) byExecution.set(item.execution, []);
    byExecution.get(item.execution).push(item);
  }
  const chains = [ ...byExecution ].map(([ execution, pieces ]) => ({
    execution, pieces: pieces.sort((a, b) => a.start - b.start || a.order - b.order),
    start: Math.min(...pieces.map(p => p.start)), end: Math.max(...pieces.map(p => p.end))
  }));
  return { id, case: entry.id, element, start: Math.min(...items.map(p => p.start)),
    end: Math.max(...items.map(p => p.end)), chains };
}

// Las activaciones de cada elemento en cada caso, con sus cadenas: { case,
// element, start, end, chains }.
export function activationsOf(timeline) {
  const activations = [];
  for (const entry of timeline.cases) {
    const byElement = new Map();
    for (const item of entry.items) {
      if (!item.interval || item.execution === null || item.execution === undefined) continue;
      if (!byElement.has(item.element)) byElement.set(item.element, []);
      byElement.get(item.element).push(item);
    }
    for (const [ element, items ] of byElement) {
      const recorded = new Map();
      for (const item of items.filter(p => p.activation !== null && p.activation !== undefined)) {
        if (!recorded.has(item.activation)) recorded.set(item.activation, []);
        recorded.get(item.activation).push(item);
      }
      for (const [ id, pieces ] of recorded) activations.push(recordedActivation(entry, element, id, pieces));
      const chains = chainsOf(items.filter(p => p.activation === null || p.activation === undefined))
        .sort((a, b) => a.start - b.start || a.execution - b.execution || a.pieces[0].order - b.pieces[0].order);
      const own = [];
      for (const chain of chains) {

        // Antes la que empezo a la vez -en paralelo- que la que acaba de
        // terminar su anterior: si un lote acaba justo cuando vuelve a
        // empezar, las ejecuciones nuevas son de la nueva activacion.
        const open = a => chain.execution > 1 && !a.byExecution.has(chain.execution) && a.byExecution.has(chain.execution - 1);
        const parallel = own.filter(a => open(a) && a.start === chain.start);
        const candidates = parallel.length ? parallel :
          own.filter(a => open(a) && a.byExecution.get(chain.execution - 1).end === chain.start);
        if (candidates.length > 1) throw ambiguousActivation(element);
        const activation = candidates[0];
        if (activation) {
          activation.chains.push(chain);
          activation.byExecution.set(chain.execution, chain);
          activation.end = Math.max(activation.end, chain.end);
        } else {
          own.push({ case: entry.id, element, start: chain.start, end: chain.end, chains: [ chain ],
            byExecution: new Map([ [ chain.execution, chain ] ]) });
        }
      }
      for (const activation of own) {
        delete activation.byExecution;
        activations.push(activation);
      }
    }
  }
  return activations;
}

// Las ejecuciones bloqueadas a la salida en el instante t: las que terminaron
// -su cadena acaba en su trabajo- en una activacion que aun no ha salido.
export function blockedAt(activations, t) {
  const blocked = [];
  for (const activation of activations) {
    if (!(activation.start <= t && t < activation.end)) continue;
    for (const chain of activation.chains) {
      const last = chain.pieces[chain.pieces.length - 1];
      if (last.state === 'working' && last.end <= t) blocked.push(last);
    }
  }
  return blocked;
}

// Los recuentos de unas pelotas: cuantas son, de cuantos casos y de cuantos
// casos son las solicitudes que tienen en la mano.
export function countBalls(balls) {
  return {
    executions: balls.length,
    cases: new Set(balls.map(ball => ball.case)).size,
    requests: new Set(balls.filter(ball => IN_HAND.has(ball.state) && ball.request).map(ball => ball.request)).size
  };
}

// Los recuentos de las zonas de cada elemento con algo: { elemento: { entry,
// inside, exit } }, a partir de las pelotas -cada una con su zona- y de los
// sobres que estan en un buzon.
export function countZones(balls, mailbox) {
  const groups = new Map();
  const group = (element, zone) => {
    if (!groups.has(element)) groups.set(element, Object.fromEntries(ZONES.map(z => [ z, { balls: [], messages: 0 } ])));
    return groups.get(element)[zone];
  };
  for (const ball of balls) group(ball.element, ball.zone).balls.push(ball);
  for (const envelope of mailbox) group(envelope.to, 'entry').messages += 1;
  const result = {};
  for (const [ element, zones ] of groups) {
    result[element] = {};
    for (const zone of ZONES) {
      const { balls: inZone, messages } = zones[zone];
      result[element][zone] = { ...countBalls(inZone), messages };
    }
  }
  return result;
}
