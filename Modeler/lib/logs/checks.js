// Comprobar un conjunto de registros antes de reproducirlo (6.8): que son todos
// los de una misma simulacion, completos y coherentes, y que son del diagrama
// abierto. Viene del Backend -al simular- o de disco -los XES guardados, y el
// BPMN que se simulo-, y en los dos casos se comprueba lo mismo que comprueba el
// Backend al reunirlos (Backend/simulator/registros.py):
//
// - Que cada uno es un XES -un documento entero (lib/timeline/xml.js), cuya
//   unica raiz es <log>, del espacio de nombres de XES- con su cabecera: la
//   identificacion de la simulacion, el modelo y su huella, la base temporal,
//   los pools esperados y la plantilla del suyo.
// - Que todos comparten la misma cabecera comun: si difiere algo, se mezclan
//   simulaciones, ejecuciones o modelos distintos.
// - Que estan los de todos los pools esperados, una sola vez, y ninguno mas;
//   un solo XES basta unicamente para un modelo de un participante.
// - Que cada traza es de su pool -su bpmn:participant- y ningun caso -el pool
//   y su numero, bpmn:instance- se repite.
//
// Y, aparte, con un diagrama:
//
// - Que es el del modelo: su raiz es la de los registros y tiene dibujados
//   todos sus pools y todos los elementos por los que pasan sus casos. Si
//   ademas no es el que se simulo -su huella no es la de model:diagramSha256-,
//   es un aviso: se reproduce sobre el, pero lo que se ve sale de los
//   registros, no de el.
//
// checkLogs lee los registros, una sola vez; checkDiagram los compara con un
// diagrama sin volver a leerlos: con el que viene, antes de abrirlo
// (diagramOfDefinitions), y con el abierto (diagramOf). checkSimulation hace
// las dos cosas. `problems` impide reproducir; `warnings`, no. Sin
// dependencias del navegador: lo usan el Modeler (example/src/modeler.js) y,
// desde Node, Backend/pruebas/carga.mjs.

import { parseXml } from '../timeline/xml.js';
import { sha256 } from './sha256.js';

export const XES = 'http://www.xes-standard.org/';

// Los formatos que el visualizador lee: el 1, de antes de bpmn:activation (la
// escena reconstruye las activaciones), y el 2.
export const FORMATS = [ '1', '2' ];

// Lo que todos los registros de una simulacion comparten.
export const COMMON = [ 'simulation:id', 'simulation:formatVersion', 'simulation:seed', 'simulation:startDate',
  'simulation:participants', 'simulation:convocatorias', 'model:id', 'model:name', 'model:rulesSha256',
  'model:diagramSha256' ];
const NOT_EMPTY = [ 'simulation:id', 'simulation:formatVersion', 'simulation:seed', 'simulation:startDate',
  'simulation:participants', 'simulation:convocatorias', 'model:id', 'model:rulesSha256', 'pool:id', 'pool:resources' ];
const PRESENT = [ 'model:name', 'pool:name' ];
const INTEGERS = [ 'simulation:seed', 'simulation:convocatorias' ];

const NAMES = {
  'simulation:id': 'la identificación de la simulación',
  'simulation:formatVersion': 'la versión del formato',
  'simulation:seed': 'la semilla',
  'simulation:startDate': 'la base temporal',
  'simulation:participants': 'los pools esperados',
  'simulation:convocatorias': 'las convocatorias',
  'model:id': 'el modelo',
  'model:name': 'el nombre del modelo',
  'model:rulesSha256': 'la huella de las reglas',
  'model:diagramSha256': 'la huella del diagrama'
};

// Cuantos elementos que faltan se nombran, como mucho.
const LISTED = 5;

const childrenNamed = (element, name) => element.children.filter(child => child.name === name);

// La cabecera de un registro -sus atributos simples y cuales de sus claves son
// listas-, el caso de cada traza -su pool y su numero, de la propia traza, como
// los lee el Backend- y los elementos por los que pasan sus eventos. null si
// no es un XES.
function read(xes) {
  const root = childrenNamed(parseXml(xes), 'log')[0];
  if (!root || root.attrs[root.prefix ? `xmlns:${root.prefix}` : 'xmlns'] !== XES) return null;
  const attrs = {};
  const lists = new Set();
  for (const child of root.children) {
    const key = child.attrs.key;
    if (key === undefined) continue;
    if (child.name === 'list') lists.add(key);
    else if (child.name !== 'trace') attrs[key] = child.attrs.value;
  }
  const elements = new Set();
  const traces = childrenNamed(root, 'trace').map(trace => {
    const own = {};
    for (const child of trace.children) {
      if (child.name === 'event') {
        const id = child.children.find(attribute => attribute.attrs.key === 'bpmn:id');
        if (id && id.attrs.value) elements.add(id.attrs.value);
      } else if (child.attrs.key !== undefined) {
        own[child.attrs.key] = child.attrs.value;
      }
    }
    return { participant: own['bpmn:participant'] ?? null, instance: own['bpmn:instance'] ?? null };
  });
  return { attrs, lists, traces, elements };
}

const list = text => String(text || '').split(',').map(pool => pool.trim()).filter(Boolean);

// Lo que dice un registro de lo que le falta o no vale.
function missing(attrs, lists) {
  const wrong = NOT_EMPTY.filter(key => attrs[key] === undefined || attrs[key] === '');
  wrong.push(...PRESENT.filter(key => attrs[key] === undefined));
  if (!lists.has('pool:staff')) wrong.push(attrs['pool:staff'] === undefined ? 'pool:staff' : 'pool:staff no es una lista');
  wrong.push(...INTEGERS.filter(key => attrs[key] !== undefined && attrs[key] !== '' && !/^-?\d+$/.test(attrs[key]))
    .map(key => `${key} no es un entero`));
  if (![ undefined, '', 'finite', 'infinite' ].includes(attrs['pool:resources'])) wrong.push('pool:resources no es finite ni infinite');
  if (attrs['simulation:startDate'] && Number.isNaN(Date.parse(attrs['simulation:startDate']))) {
    wrong.push('simulation:startDate no es una fecha');
  }
  return wrong;
}

// Lo que se sabe del diagrama abierto para compararlo con los registros: su
// raiz, los pools y los elementos dibujados y, para la huella, su texto tal
// como se guarda.
export function diagramOf(elementRegistry, rootElement, xml = null) {
  const drawn = elementRegistry.filter(element => element.type !== 'label' && element !== rootElement);
  return {
    id: rootElement && rootElement.id,
    process: !!rootElement && rootElement.type === 'bpmn:Process',
    participants: drawn.filter(element => element.type === 'bpmn:Participant').map(element => element.id),
    elements: drawn.map(element => element.id),
    xml
  };
}

// Los diagramas de unas definiciones que dibuja bpmn-js al abrirlas, como los
// elige (bpmn-js/lib/import/Importer.js, getDiagramsToImport): el primero y los
// de los procesos y subprocesos de su misma jerarquia -los de su colaboracion,
// si la tiene-; si dos dibujan lo mismo, el primero. Los demas no se dibujan.
function importedDiagrams(definitions, first, root) {
  let top = root;
  while (top && top.$type !== 'bpmn:Process' && top.$type !== 'bpmn:Collaboration') top = top.$parent;
  const collaboration = top && top.$type === 'bpmn:Collaboration' ? top
    : (definitions.rootElements || []).find(element => element.$type === 'bpmn:Collaboration' &&
      (element.participants || []).some(participant => participant.processRef === top));
  const tops = collaboration ? [ ...(collaboration.participants || []).map(participant => participant.processRef), collaboration ] : [ top ];
  const hierarchy = new Set();
  const walk = element => {
    if (!element) return;
    hierarchy.add(element);
    (element.flowElements || []).forEach(walk);
  };
  tops.forEach(walk);
  const imported = [ first ];
  const handled = new Set([ root ]);
  for (const diagram of definitions.diagrams) {
    const element = diagram.plane && diagram.plane.bpmnElement;
    if (element && hierarchy.has(element) && !handled.has(element)) {
      imported.push(diagram);
      handled.add(element);
    }
  }
  return imported;
}

// Lo mismo de un .bpmn sin abrirlo, leido con el moddle de bpmn-js
// (moddle.fromXML(xml, 'bpmn:Definitions')): para comprobar unos registros con
// su diagrama antes de abrirlo, y no cerrar el abierto si no valen. Como lo
// abre bpmn-js: la raiz es la del plano del primer diagrama -o, si no la dice,
// la primera colaboracion o proceso-, y solo se dibuja lo que tiene su forma o
// su linea en los diagramas que dibujaria (importedDiagrams). Un Error si
// bpmn-js no lo podria abrir.
export function diagramOfDefinitions(definitions, xml = null) {
  const diagrams = (definitions && definitions.diagrams) || [];
  if (!diagrams.length || !diagrams[0].plane) throw new Error('no tiene ningún diagrama que dibujar');
  const roots = (definitions.rootElements || []).filter(element => [ 'bpmn:Collaboration', 'bpmn:Process' ].includes(element.$type));
  const root = diagrams[0].plane.bpmnElement || roots[0];
  if (!root) throw new Error('no tiene ni colaboración ni proceso');
  if (![ 'bpmn:Collaboration', 'bpmn:Process' ].includes(root.$type)) throw new Error(`su diagrama es de un ${root.$type}`);
  const drawn = new Set();
  for (const diagram of importedDiagrams(definitions, diagrams[0], root)) {
    for (const di of (diagram.plane && diagram.plane.planeElement) || []) {
      if (di.bpmnElement && di.bpmnElement.id) drawn.add(di.bpmnElement.id);
    }
  }
  const participants = root.$type === 'bpmn:Collaboration'
    ? (root.participants || []).map(participant => participant.id).filter(id => drawn.has(id)) : [];
  return { id: root.id, process: root.$type === 'bpmn:Process', participants, elements: [ ...drawn ], xml };
}

// { problems, logs, common, elements }. `logs` son los registros en el orden de
// los pools esperados, cada uno con su pool y su nombre de la cabecera; cada
// registro de entrada es { xes, pool?, name?, fileName? }: el pool, si se da,
// tiene que ser el de su cabecera. `elements`, los elementos por los que pasan
// sus casos.
export function checkLogs(input) {
  const problems = [];
  const logs = Array.isArray(input) ? input : [];
  const elements = new Set();
  if (!logs.length) return { problems: [ 'No hay ningún registro.' ], logs: [], common: null, elements };
  const accepted = [];
  const seen = new Map();
  let common = null;
  let first = null;
  for (const [ index, log ] of logs.entries()) {
    const label = log.fileName ? `el registro «${log.fileName}»` : log.pool ? `el registro de ${log.pool}` : `el registro ${index + 1}`;
    const Label = label[0].toUpperCase() + label.slice(1);
    let parsed;
    try {
      parsed = typeof log.xes === 'string' ? read(log.xes) : null;
    } catch (error) {
      problems.push(`${Label} está mal formado: ${error.message}`);
      continue;
    }
    if (!parsed) {
      problems.push(`${Label} no es un registro XES.`);
      continue;
    }
    const { attrs, lists, traces } = parsed;
    const pool = attrs['pool:id'];
    const wrong = missing(attrs, lists);
    if (wrong.length) problems.push(`Al ${label.slice(3)} le falta o no vale: ${wrong.join(', ')}.`);
    if (attrs['simulation:formatVersion'] && !FORMATS.includes(attrs['simulation:formatVersion'])) {
      problems.push(`${Label} es del formato ${attrs['simulation:formatVersion']}, y este Modeler lee el ${FORMATS.join(' y el ')}.`);
    }
    if (log.pool && pool && log.pool !== pool) problems.push(`El registro de ${log.pool} dice ser de ${pool}.`);
    if (log.name !== undefined && attrs['pool:name'] !== undefined && log.name !== attrs['pool:name']) {
      problems.push(`El registro de ${pool || label} dice llamarse «${attrs['pool:name']}» y no «${log.name}».`);
    }
    if (pool) {
      if (seen.has(pool)) {
        problems.push(`El registro de ${pool} está duplicado: ${seen.get(pool)} y ${label}.`);
        continue;
      }
      seen.set(pool, label);
    }
    const own = Object.fromEntries(COMMON.map(key => [ key, attrs[key] ?? null ]));
    if (common === null) {
      common = own;
      first = pool || label;
    } else {
      const different = COMMON.filter(key => own[key] !== common[key]);
      if (different.length) {
        problems.push(`El registro de ${pool || label} no es de la misma simulación que el de ${first}: ` +
          `difieren ${different.map(key => NAMES[key]).join(', ')}.`);
      }
    }
    const owner = pool || log.pool;
    const cases = new Set();
    for (const trace of traces) {
      const id = `${trace.participant} - ${trace.instance}`;
      if (owner && trace.participant !== owner) {
        problems.push(`El registro de ${owner} trae una traza de ${trace.participant ?? 'ningún pool (sin bpmn:participant)'}.`);
      } else if (cases.has(id)) {
        problems.push(`El registro de ${owner || label} repite el caso ${id}.`);
      }
      cases.add(id);
    }
    for (const element of parsed.elements) elements.add(element);
    accepted.push({ ...log, pool: pool ?? log.pool ?? null, name: attrs['pool:name'] ?? log.name ?? null, label });
  }

  const expected = common ? list(common['simulation:participants']) : [];
  if (common && expected.length) {
    if (logs.length === 1 && expected.length > 1) {
      problems.push(`Un solo registro basta únicamente para un modelo de un participante, y este espera ${expected.length}: ` +
        `${expected.join(', ')}.`);
    }
    problems.push(...expected.filter(pool => !seen.has(pool)).map(pool => `Falta el registro de ${pool}.`));
    problems.push(...[ ...seen.keys() ].filter(pool => !expected.includes(pool)).sort()
      .map(pool => `Sobra el registro de ${pool}, que no es de ningún pool esperado.`));
  }
  const order = pool => (expected.includes(pool) ? expected.indexOf(pool) : expected.length);
  return { problems, logs: accepted.sort((a, b) => order(a.pool) - order(b.pool)), common, elements };
}

// { problems, warnings } de unos registros ya comprobados (checkLogs) con un
// diagrama: el del modelo, con todos sus pools y sus elementos; y, si no es el
// simulado, un aviso. La huella se compara tambien con los saltos de linea de
// Windows pasados a \n: el Modeler guarda con \n, y un .bpmn que ha pasado por
// git en Windows puede volver con \r\n.
export function checkDiagram(checked, diagram) {
  const problems = [];
  const warnings = [];
  const { common } = checked;
  if (!common || !diagram) return { problems, warnings };
  const expected = list(common['simulation:participants']);
  if (diagram.id !== common['model:id']) {
    problems.push(`El diagrama («${diagram.id}») no es el del modelo de los registros («${common['model:id']}»).`);
    return { problems, warnings };
  }
  const has = pool => (diagram.process ? pool === diagram.id : diagram.participants.includes(pool));
  problems.push(...expected.filter(pool => !has(pool)).map(pool => `El diagrama no tiene el pool ${pool} de los registros.`));
  if (diagram.elements) {
    const drawn = new Set(diagram.elements);
    const absent = [ ...checked.elements ].filter(element => !drawn.has(element) && !expected.includes(element)).sort();
    if (absent.length) {
      problems.push(`El diagrama no tiene ${absent.length === 1 ? 'un elemento' : `${absent.length} elementos`} ` +
        `por los que pasan los casos de los registros: ${absent.slice(0, LISTED).join(', ')}${absent.length > LISTED ? '…' : ''}.`);
    }
  }
  if (!problems.length && diagram.xml !== null && diagram.xml !== undefined) {
    const simulated = common['model:diagramSha256'];
    if (!simulated) {
      warnings.push('Los registros se simularon sin diagrama: no se puede comprobar que el diagrama sea el que se simuló.');
    } else if (![ diagram.xml, diagram.xml.replace(/\r\n?/g, '\n') ].some(text => sha256(text) === simulated)) {
      warnings.push('El diagrama no es el que se simuló: ha cambiado desde entonces. Se reproduce sobre él, ' +
        'pero lo que se ve —casos, plantillas, recursos y resultados— sale de los registros.');
    }
  }
  return { problems, warnings };
}

// { problems, warnings, logs, common, elements }: checkLogs y, con un diagrama,
// checkDiagram. Los avisos solo cuentan si no hay problemas.
export function checkSimulation(input, { diagram = null } = {}) {
  const checked = checkLogs(input);
  const compared = diagram ? checkDiagram(checked, diagram) : { problems: [], warnings: [] };
  const problems = [ ...checked.problems, ...compared.problems ];
  return { ...checked, problems, warnings: problems.length ? [] : compared.warnings };
}
