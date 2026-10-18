// El reproductor del visualizador (6.7): que se ve de una simulacion y en que
// instante, sin dibujar nada. Lo usa la barra de reproduccion del Modeler
// (example/src/replay.js), que dibuja cada instante con la vista
// (lib/scene/view.js), y, desde Node, Backend/pruebas/reproduccion.mjs.
//
// - Una convocatoria es una ronda del orquestador con sus orquestados
//   (bpmn:convocatoria): se reproduce entre el primer instante de sus casos y
//   el ultimo. Las rondas van una detras de otra, y la siguiente empieza justo
//   cuando acaba la anterior. Es el alcance de la reproduccion: la escena se
//   hace con la linea de tiempo de solo sus casos (timeline.only), asi que en
//   su ultimo instante la siguiente, que ya ha empezado, no esta ni en lo que
//   se dibuja ni en lo que se cuenta.
// - El filtro elige, dentro de la convocatoria, que casos se dibujan, por pool
//   y por su numero en el pool: «1-3, 7»; vacio, todos. Solo elige lo que se
//   dibuja: los recuentos -las insignias, los buzones, las plantillas y su
//   cola, y el resumen de cada pool- son los de todos los casos de la
//   convocatoria.
// - El reloj da el instante simulado en cada momento real: avanza `speed`
//   segundos simulados por segundo real y se para al final. Se calcula desde
//   el ultimo punto de partida -al reproducir, al saltar o al cambiar de
//   velocidad- y no sumando pasos, asi que no acumula errores; y en pausa, el
//   instante es exactamente el que se le dio o en el que se paro. Lo que se ve
//   en un instante depende solo de ese instante (la escena es una funcion de
//   t): reproducir hasta t y saltar a t dibujan lo mismo.

export const SPEEDS = [ 1, 2, 5, 10, 20, 50, 100 ];

// Lo que se tarda, mas o menos, en reproducir una convocatoria a la velocidad
// que se elige de entrada.
const DEFAULT_SECONDS = 40;

// Las convocatorias de una simulacion, en orden: [{ call, start, end, cases }],
// con los IDs de sus casos.
export function convocatoriasOf(timeline) {
  const calls = new Map();
  for (const entry of timeline.cases) {
    const call = entry.call ?? 1;
    if (!calls.has(call)) calls.set(call, { call, start: Infinity, end: -Infinity, cases: [] });
    const group = calls.get(call);
    group.cases.push(entry.id);
    if (entry.start !== null) {
      group.start = Math.min(group.start, entry.start);
      group.end = Math.max(group.end, entry.end);
    }
  }
  return [ ...calls.values() ].map(group => (Number.isFinite(group.start) ? group : { ...group, start: 0, end: 0 }))
    .sort((a, b) => a.call - b.call);
}

// Lo que se reproduce de una convocatoria -o de todas, con `call` null-: su
// ventana de tiempo y sus casos.
export function windowOf(timeline, call = null) {
  const all = convocatoriasOf(timeline);
  const chosen = call === null ? all : all.filter(group => group.call === call);
  if (!chosen.length) throw new Error(`La simulacion no tiene la convocatoria ${call}.`);
  return {
    call,
    start: Math.min(...chosen.map(group => group.start)),
    end: Math.max(...chosen.map(group => group.end)),
    cases: new Set(chosen.flatMap(group => group.cases))
  };
}

// Los numeros de un filtro: «1-3, 7» -comas o espacios, y rangos con guion-.
// { numbers, error }: numbers es null si esta vacio -todos- y error dice por
// que no se entiende. Un numero mas alto que MAX_CASE, o un rango de mas de
// MAX_RANGE, no se entiende: ningun pool tiene tantos casos, y se tardaria en
// recorrerlo.
export const MAX_CASE = 1000000;
export const MAX_RANGE = 10000;
export function parseNumbers(text) {
  const parts = String(text ?? '').split(/[\s,;]+/).filter(Boolean);
  if (!parts.length) return { numbers: null, error: null };
  const numbers = new Set();
  for (const part of parts) {
    const range = /^(\d+)(?:-(\d+))?$/.exec(part);
    if (!range) return { numbers: null, error: `«${part}» no es un numero ni un rango como 1-3` };
    const from = Number(range[1]);
    const to = range[2] === undefined ? from : Number(range[2]);
    if (from > MAX_CASE || to > MAX_CASE) return { numbers: null, error: `«${part}» es un numero demasiado alto` };
    if (from < 1 || to < from) return { numbers: null, error: `«${part}» no es un rango valido` };
    if (to - from >= MAX_RANGE) return { numbers: null, error: `«${part}» es un rango demasiado largo` };
    for (let n = from; n <= to; n++) numbers.add(n);
  }
  return { numbers, error: null };
}

// Los casos que se dibujan: los de la ventana que pasan el filtro de su pool,
// { pool: texto }. { cases, errors }: con un filtro que no se entiende, su
// pool no se filtra y `errors` dice por que.
export function visibleCases(timeline, window, filters = {}) {
  const errors = {};
  const numbersOf = {};
  for (const [ pool, text ] of Object.entries(filters)) {
    const { numbers, error } = parseNumbers(text);
    if (error) errors[pool] = error;
    numbersOf[pool] = numbers;
  }
  const cases = new Set(timeline.cases.filter(entry => window.cases.has(entry.id) &&
    (!numbersOf[entry.pool] || numbersOf[entry.pool].has(entry.instance))).map(entry => entry.id));
  return { cases, errors };
}

// Como esta cada pool en el instante t, con todos los casos de la ventana:
// [{ pool, name, total, pending, active, finished, shown, results }]. `shown`
// cuenta los que se dibujan; los demas numeros no dependen del filtro.
// `results` son los resultados historicos (6.8): cuantas veces se ha llegado
// hasta t a cada evento de fin del pool -[{ element, name, count }], en el
// orden en que aparecen en el registro-, si los casos de la ventana llegan a
// mas de uno; si no, []. Salen del registro, no del diagrama: aunque se
// cambien sus porcentajes.
export function summaryAt(timeline, t, window, shown = window.cases) {
  return timeline.pools.map(pool => {
    const counts = { pool: pool.id, name: pool.name, total: 0, pending: 0, active: 0, finished: 0, shown: 0, results: [] };
    const ends = new Map();
    for (const entry of timeline.cases) {
      if (entry.pool !== pool.id || !window.cases.has(entry.id)) continue;
      counts.total += 1;
      counts[timeline.statusOf(entry.id, t) || 'pending'] += 1;
      if (shown.has(entry.id)) counts.shown += 1;
      for (const item of entry.items) {
        if (item.type !== 'bpmn:EndEvent') continue;
        if (!ends.has(item.element)) ends.set(item.element, { element: item.element, name: item.name || item.element, count: 0, order: item.order });
        if (item.start <= t) ends.get(item.element).count += 1;
      }
    }
    if (ends.size > 1) {
      counts.results = [ ...ends.values() ].sort((a, b) => a.order - b.order).map(({ order, ...result }) => result);
    }
    return counts;
  });
}

// Como se dice una fila del resumen: «Residente: 3 en curso · 0 por llegar ·
// 97 terminados · fin: Aceptada 57, Rechazada sin reclamar 19, Reevaluada 21 ·
// se ven 5 de 100».
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
export function summaryText(row) {
  const results = row.results.length ? ` · fin: ${row.results.map(r => `${r.name} ${r.count}`).join(', ')}` : '';
  const shown = row.shown < row.total ? ` · se ${row.shown === 1 ? 've' : 'ven'} ${row.shown} de ${row.total}` : '';
  return `${row.name || row.pool}: ${row.active} en curso · ${row.pending} por llegar · ` +
    `${plural(row.finished, 'terminado', 'terminados')}${results}${shown}`;
}

// La velocidad de entrada: la menor que reproduce la ventana en unos 40 s.
export function defaultSpeed(duration) {
  return SPEEDS.find(speed => duration / speed <= DEFAULT_SECONDS) ?? SPEEDS[SPEEDS.length - 1];
}

// Los instantes en que cambia algo dentro de la ventana, con su principio y su
// fin, ordenados: a los que se salta con «cambio anterior» y «siguiente».
export function changesIn(timeline, window) {
  const inside = timeline.changes().filter(t => t >= window.start && t <= window.end);
  return [ ...new Set([ window.start, ...inside, window.end ]) ].sort((a, b) => a - b);
}

export const nextChange = (changes, t) => changes.find(c => c > t) ?? changes[changes.length - 1];

export function previousChange(changes, t) {
  for (let i = changes.length - 1; i >= 0; i--) {
    if (changes[i] < t) return changes[i];
  }
  return changes[0];
}

// El reloj de la reproduccion. `now` es el momento real en milisegundos
// -performance.now() en el navegador-; el reloj no lo lee por su cuenta, asi
// que se puede probar sin esperar.
export function createClock({ start, end, speed = 1 }) {
  if (!(end >= start)) throw new Error('La ventana de la reproduccion acaba antes de empezar.');
  const clamp = t => Math.min(end, Math.max(start, t));
  let t = start;
  let playing = false;
  let anchorNow = 0;
  let current = speed;

  const at = now => (playing ? clamp(t + current * (now - anchorNow) / 1000) : t);
  return {
    get start() {
      return start;
    },
    get end() {
      return end;
    },
    get speed() {
      return current;
    },
    get playing() {
      return playing;
    },

    // El instante en `now`; si ha llegado al final, se para ahi.
    at(now) {
      const value = at(now);
      if (playing && value >= end) {
        playing = false;
        t = end;
      }
      return value;
    },

    // Reproducir desde donde esta; desde el final, vuelve a empezar.
    play(now) {
      if (playing) return t;
      if (t >= end) t = start;
      playing = true;
      anchorNow = now;
      return t;
    },
    pause(now) {
      t = at(now);
      playing = false;
      return t;
    },

    // Saltar a un instante exacto, sin redondearlo; sigue reproduciendo si lo
    // estaba, desde ahi.
    seek(value, now) {
      if (!Number.isFinite(value)) throw new Error(`No es un instante: ${value}.`);
      t = clamp(value);
      anchorNow = now;
      return t;
    },
    setSpeed(value, now) {
      if (!(value > 0)) throw new Error(`No es una velocidad: ${value}.`);
      t = at(now);
      anchorNow = now;
      current = value;
      return t;
    }
  };
}
