// La plantilla de cada pool y lo que hace cada persona en cada instante (6.6),
// sacadas solo de los registros (D15).
//
// - La plantilla es la que guarda la cabecera del registro de cada pool
//   (pool:staff, con sus carriles): la de cuando se simulo, tambien quien no
//   llego a trabajar, y no la de las reglas de ahora, que pueden haber
//   cambiado. Si un registro no la trae, o alguien trabaja sin estar en ella,
//   se completa con quien aparece en sus eventos, y se dice: `complete` en el
//   pool y `listed` en la persona.
// - Una asignacion es una ejecucion con su persona (bpmn:userTask): la toma al
//   empezar a trabajar y la suelta al acabar, en los instantes que escribio el
//   motor. Lleva el ID de la ejecucion -el de su pieza en la linea de tiempo-,
//   su numero de ejecucion y de activacion, la solicitud que atiende y su
//   intervalo.
// - En el instante t, cada persona esta libre u ocupada con lo que tiene entre
//   manos: lo que empezo en t o antes y acaba despues de t, como las piezas de
//   la linea de tiempo. Al soltar una ejecucion y tomar otra en el mismo t, esta
//   con la nueva. Con recursos finitos es una cosa como mucho. Con infinitos
//   la persona nunca deja de estar disponible -el pool no tiene cola (D4)-: sale
//   ocupada con todo lo que la nombra, a la vez.
// - La cola es del pool (D4): las piezas que esperan a una persona
//   ('waiting-user'), de cualquier tarea, en el orden en que la pidieron. Una
//   espera cancelada -la de un sobre que no llega, al cerrar un lote- nunca ha
//   tenido a nadie ni esta en la cola: lo que espera es un mensaje.
//
// Sin dependencias del navegador: lo usan la escena (lib/scene/scene.js), la
// vista y, desde Node, Backend/pruebas/plantilla.mjs.

const byStart = (a, b) => a.start - b.start || a.order - b.order;

// El nombre de cada elemento, el que escribio el motor en sus eventos: las
// esperas no lo llevan.
function namesOf(timeline) {
  const names = new Map();
  for (const item of timeline.items) {
    if (item.element && item.name && !names.has(item.element)) names.set(item.element, item.name);
  }
  return element => names.get(element) ?? null;
}

// Las asignaciones de una simulacion, por orden de inicio.
export function assignmentsOf(timeline) {
  const numberOf = id => (timeline.case(id) || {}).instance ?? null;
  const nameOf = namesOf(timeline);
  return timeline.items.filter(item => item.user && item.interval).sort(byStart).map(item => Object.freeze({
    id: item.id,
    person: item.user,
    pool: item.pool,
    case: item.case,
    number: item.instance ?? numberOf(item.case),
    element: item.element,
    name: item.name ?? nameOf(item.element),
    execution: item.execution,
    activation: item.activation,
    request: item.request,
    requestNumber: item.request ? numberOf(item.request) : null,
    start: item.start,
    end: item.end,
    order: item.order
  }));
}

// La plantilla de cada pool: [{ pool, name, role, resources, complete, people:
// [{ name, lanes, listed }] }], en el orden de los registros. `lanes` son los
// nombres de los carriles en los que esta declarada la persona.
export function rosterOf(timeline, assignments = assignmentsOf(timeline)) {
  return timeline.pools.map(pool => {
    const listed = pool.staff || [];
    const extra = [ ...new Set(assignments.filter(a => a.pool === pool.id).map(a => a.person)) ]
      .filter(person => !listed.includes(person));
    const people = [ ...listed.map(name => ({ name, listed: true })), ...extra.map(name => ({ name, listed: false })) ]
      .map(person => Object.freeze({ ...person,
        lanes: Object.freeze(pool.lanes.filter(lane => lane.people.includes(person.name)).map(lane => lane.name ?? lane.id)) }));
    return Object.freeze({
      pool: pool.id,
      name: pool.name,
      role: pool.role,
      resources: pool.resources,
      complete: pool.staff !== null && !extra.length,
      people: Object.freeze(people)
    });
  });
}

const active = (piece, t) => piece.start <= t && t < piece.end;

export function createStaff(timeline) {
  const assignments = assignmentsOf(timeline);
  const roster = rosterOf(timeline, assignments);
  const numberOf = id => (timeline.case(id) || {}).instance ?? null;
  const nameOf = namesOf(timeline);
  const waits = timeline.items.filter(item => item.state === 'waiting-user' && item.interval && item.end > item.start)
    .sort(byStart);
  return {
    roster,
    assignments,

    // Lo de cada pool en el instante t: { pool: { pool, name, resources,
    // complete, people: [{ name, lanes, listed, state, work }], busy, free,
    // queue } }. `state` es 'busy' o 'free', y `work`, las asignaciones que
    // tiene entre manos.
    at(t) {
      const working = assignments.filter(a => active(a, t));
      const result = {};
      for (const pool of roster) {
        const mine = working.filter(a => a.pool === pool.pool);
        const people = pool.people.map(person => {
          const work = mine.filter(a => a.person === person.name);
          return { ...person, state: work.length ? 'busy' : 'free', work };
        });
        const queue = waits.filter(item => item.pool === pool.pool && active(item, t)).map(item => ({
          id: item.id,
          case: item.case,
          number: item.instance ?? numberOf(item.case),
          element: item.element,
          name: item.name ?? nameOf(item.element),
          execution: item.execution,
          activation: item.activation,
          request: item.request,
          requestNumber: item.request ? numberOf(item.request) : null,
          since: item.start,
          until: item.end
        }));
        result[pool.pool] = { pool: pool.pool, name: pool.name, resources: pool.resources, complete: pool.complete,
          people, busy: people.filter(p => p.state === 'busy').length,
          free: people.filter(p => p.state === 'free').length, queue };
      }
      return result;
    }
  };
}
