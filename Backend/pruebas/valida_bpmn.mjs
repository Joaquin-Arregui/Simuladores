// Comprobacion independiente de los diagramas de integracion.
//
//     node pruebas/valida_bpmn.mjs [carpeta]
//
// Sin argumento revisa pruebas/integracion/. Abre cada diagrama con
// bpmn-moddle -la libreria con la que bpmn-js importa un diagrama- y con los
// descriptores del Modeler, y comprueba:
//
// 1. Que bpmn-moddle lo entiende entero: nada desconocido, nada sin resolver.
// 2. Que cada elemento dibujable tiene su forma en el DI, o el Modeler no
//    podria pintarlo.
// 3. Que abrirlo y guardarlo no cambia nada. Es lo que hace el Modeler cada vez
//    que alguien abre un diagrama y lo vuelve a guardar, y es donde se ve que
//    una propiedad esta mal escrita: una lista de usuarios escrita como
//    atributo se abre como una cadena y se guarda letra a letra.
// 4. Que abre en otra herramienta sin avisos (3.1, 5.2): con bpmn-moddle SIN
//    los descriptores del Modeler, que es como lo ve cualquier otra
//    herramienta, y con los de Camunda 7 y Camunda 8 -camunda-bpmn-moddle y
//    zeebe-bpmn-moddle, los que carga Camunda Modeler-. Ningun aviso: hasta la
//    5.1 las listas de personas eran hijos directos de cada elemento, y otra
//    herramienta avisaba y las descartaba; ahora van en bpmn:extensionElements.
//    Tienen que seguir ahi todos los elementos BPMN y todas las marcas
//    -multiinstancia y multiplicidad-, que son las que el motor lee del dibujo.
//    Y guardarlo desde esa herramienta no pierde nada del Modeler: al abrir lo
//    que ella guarda, con los descriptores, sale lo mismo.
// 5. Que los atributos propios de cada pool (5.1) -frequency, instances,
//    orchestrationRole, infiniteResources, arrivalMode y arrivalWindow- salen
//    de abrir y guardar escritos igual que estaban en el fichero, y que los
//    descriptores los leen con su tipo. Lo de (3) no basta: compara lo abierto
//    con lo reabierto, y si el descriptor lee mal un valor -frequency=0.1 como
//    entero se queda en 0- la primera lectura ya lo ha perdido y la segunda
//    coincide con ella. Aqui se compara el texto, leido sin descriptores.
// 6. Que los diagramas del formato anterior a la 5.2 se siguen abriendo
//    (formato-anterior/, guardados por el Modeler de entonces): con la
//    migracion del propio Modeler -Modeler/lib/people/people.js, la que hace
//    al abrir un fichero- cada lista pasa entera a extensionElements, no queda
//    nada en el sitio antiguo, lo que sale abre sin avisos en las otras
//    herramientas, y si hay un diagrama del mismo nombre en integracion/ sale
//    igual que el.
// 7. Que un numero que el panel acepta vuelve al panel como valido (5.3): se
//    guarda en el campo con los descriptores, se abre otra vez, y lo leido,
//    escrito como lo muestra el panel -Modeler/lib/numbers/numbers.js-, el
//    panel lo vuelve a aceptar con el mismo valor. JavaScript guarda 0.0000001
//    como 1e-7, y un panel que solo admitiera decimales sin exponente marcaria
//    como invalido lo que acaba de guardar. Lo que no vale se tiene que rechazar.
//
// Es independiente de validation.py a proposito: si el generador y la
// validacion del Backend compartieran un malentendido sobre el BPMN, aqui
// saldria. Necesita las dependencias del Modeler (npm install en Modeler/).
import { createRequire } from 'module';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const aqui = dirname(fileURLToPath(import.meta.url));
const modeler = join(aqui, '..', '..', 'Modeler');
const require = createRequire(join(modeler, 'package.json'));
// En Windows require.resolve devuelve C:\..., que import() leeria como un
// protocolo "c:"; hay que pasarlo a URL de fichero.
const BpmnModdle = (await import(pathToFileURL(require.resolve('bpmn-moddle')).href)).default;
const descriptor = nombre => JSON.parse(readFileSync(join(modeler, 'descriptors', `${nombre}.json`), 'utf8'));
const moddle = new BpmnModdle({
  user: descriptor('user'), sequenceFlow: descriptor('sequenceFlow'), model: descriptor('model'),
  collaboration: descriptor('collaboration'), lane: descriptor('lane'),
  participantWithoutLane: descriptor('participantWithoutLane')
});

// La migracion del Modeler, la misma que hace al abrir un fichero.
const { migrateLegacyPeople, entriesOf, PEOPLE_TYPES } =
  await import(pathToFileURL(join(modeler, 'lib', 'people', 'people.js')).href);

// Como valida, lee y muestra los numeros el panel.
const { checkNumber, parseNumber, formatNumber } =
  await import(pathToFileURL(join(modeler, 'lib', 'numbers', 'numbers.js')).href);

const json = ruta => JSON.parse(readFileSync(require.resolve(ruta), 'utf8'));
const otraHerramienta = new BpmnModdle();
// Como abre un fichero Camunda Modeler: bpmn-moddle con sus descriptores. Vienen
// con las dependencias del Modeler (las pide bpmn-js-properties-panel).
const OTRAS_HERRAMIENTAS = [
  ['bpmn-moddle', otraHerramienta],
  ['Camunda 7', new BpmnModdle({ camunda: json('camunda-bpmn-moddle/resources/camunda.json') })],
  ['Camunda 8', new BpmnModdle({ zeebe: json('zeebe-bpmn-moddle/resources/zeebe.json') })]
];
const DIBUJABLES = new Set(['bpmn:Participant', 'bpmn:Lane', 'bpmn:SequenceFlow', 'bpmn:MessageFlow']);

function recorre(e, visita, vistos = new Set()) {
  if (!e || typeof e !== 'object' || vistos.has(e)) return;
  vistos.add(e);
  if (e.$type) visita(e);
  for (const [clave, valor] of Object.entries(e)) {
    if (clave.startsWith('$') || clave === 'di') continue;
    for (const hijo of Array.isArray(valor) ? valor : [valor]) {
      if (hijo && typeof hijo === 'object' && hijo.$type && hijo.$parent === e) recorre(hijo, visita, vistos);
    }
  }
}

// Cada elemento, por su ID, con sus propiedades explicitas: las referencias a
// otros elementos como #id y los elementos propios sin ID por su ruta.
function instantanea(raiz) {
  const porClave = {};
  const valorDe = (v, dueno, ruta) => {
    if (Array.isArray(v)) return v.map((x, i) => valorDe(x, dueno, `${ruta}[${i}]`));
    if (v && typeof v === 'object' && v.$type) {
      if (v.$parent === dueno) { visita(v, ruta); return `<${v.id ?? ruta}>`; }
      return `#${v.id}`;
    }
    return v;
  };
  const visita = (e, ruta) => {
    const clave = e.id ?? ruta;
    const props = {};
    for (const k of Object.keys(e).sort()) {
      if (!k.startsWith('$')) props[k] = valorDe(e[k], e, `${clave}.${k}`);
    }
    const attrs = Object.entries(e.$attrs || {}).filter(([k]) => !k.startsWith('xmlns')).sort();
    if (attrs.length) props.$attrs = Object.fromEntries(attrs);
    porClave[clave] = { tipo: e.$type, props };
  };
  visita(raiz, raiz.$type);
  return porClave;
}

// El tipo con el que el Modeler tiene que leer cada atributo propio del pool.
const ATRIBUTOS_DEL_POOL = {
  frequency: 'numero', instances: 'entero', orchestrationRole: 'texto',
  infiniteResources: 'booleano', arrivalMode: 'texto', arrivalWindow: 'entero'
};
const ES_DEL_TIPO = {
  numero: v => typeof v === 'number' && Number.isFinite(v),
  entero: v => Number.isInteger(v),
  texto: v => typeof v === 'string',
  booleano: v => typeof v === 'boolean'
};

// Los atributos propios de cada pool tal como estan escritos en el XML: leidos
// sin descriptores, bpmn-moddle los deja en $attrs con su texto.
async function atributosEscritos(xml) {
  const { rootElement } = await otraHerramienta.fromXML(xml);
  const escritos = {};
  recorre(rootElement, e => {
    if (e.$type !== 'bpmn:Participant') return;
    escritos[e.id] = Object.fromEntries(Object.entries(e.$attrs || {})
      .filter(([k]) => k.startsWith('participantWithoutLane:')).sort());
  });
  return escritos;
}

async function atributosDelPool(xml, guardado, rootElement) {
  const antes = await atributosEscritos(xml), despues = await atributosEscritos(guardado);
  const problemas = [];
  let cuantos = 0;
  for (const pool of new Set([...Object.keys(antes), ...Object.keys(despues)])) {
    const a = antes[pool] || {}, d = despues[pool] || {};
    for (const clave of new Set([...Object.keys(a), ...Object.keys(d)])) {
      cuantos += 1;
      if (a[clave] !== d[clave]) {
        problemas.push(`${pool}: ${clave}=${JSON.stringify(a[clave])} sale como ${JSON.stringify(d[clave])} al abrir y guardar`);
      }
    }
  }
  recorre(rootElement, e => {
    if (e.$type !== 'bpmn:Participant') return;
    for (const [nombre, tipo] of Object.entries(ATRIBUTOS_DEL_POOL)) {
      if (!(`participantWithoutLane:${nombre}` in (antes[e.id] || {}))) continue;
      if (!ES_DEL_TIPO[tipo](e.get(nombre))) {
        problemas.push(`${e.id}: el Modeler lee ${nombre} como ${JSON.stringify(e.get(nombre))}, y tenia que ser ${tipo}`);
      }
    }
  });
  return { problemas, cuantos };
}

// (4) Lo que no cuadra al abrir el diagrama en cada otra herramienta, y
// cuantas marcas ve.
async function enOtrasHerramientas(xml, conModeler) {
  const problemas = [];
  let marcas = 0;
  for (const [nombre, herramienta] of OTRAS_HERRAMIENTAS) {
    const ajeno = await herramienta.fromXML(xml);
    for (const w of ajeno.warnings) problemas.push(`${nombre}: ${w.message.split('\n')[0]}`);
    const sinModeler = instantanea(ajeno.rootElement);
    marcas = 0;
    for (const [clave, { tipo, props }] of Object.entries(conModeler)) {
      if (!tipo.startsWith('bpmn:')) continue;
      const visto = sinModeler[clave];
      const esMarca = tipo === 'bpmn:MultiInstanceLoopCharacteristics' || tipo === 'bpmn:ParticipantMultiplicity';
      if (esMarca) marcas += 1;
      if (!visto || visto.tipo !== tipo) {
        problemas.push(`${nombre}: no ve ${clave} (${tipo})`);
      } else if (esMarca && JSON.stringify(visto.props.isSequential) !== JSON.stringify(props.isSequential)) {
        problemas.push(`${nombre}: lee ${clave} con otro isSequential`);
      }
    }
    const { xml: suyo } = await herramienta.toXML(ajeno.rootElement);
    const { rootElement: devuelto } = await moddle.fromXML(suyo);
    for (const cambio of cambiosAlGuardar(conModeler, instantanea(devuelto))) {
      problemas.push(`${nombre}, al guardar: ${cambio}`);
    }
  }
  return { problemas, marcas };
}

function cambiosAlGuardar(antes, despues) {
  const cambios = [];
  for (const clave of new Set([...Object.keys(antes), ...Object.keys(despues)])) {
    const a = antes[clave], d = despues[clave];
    if (!a || !d) { cambios.push(`${clave}: ${a ? 'desaparece' : 'aparece'} al guardar`); continue; }
    for (const prop of new Set([...Object.keys(a.props), ...Object.keys(d.props)])) {
      const va = JSON.stringify(a.props[prop]), vd = JSON.stringify(d.props[prop]);
      if (va !== vd) cambios.push(`${clave} (${a.tipo}).${prop}: ${va} -> ${vd} al abrir y guardar`);
    }
  }
  return cambios;
}

const carpeta = process.argv[2] || join(aqui, 'integracion');
if (!existsSync(carpeta)) {
  console.log(`No existe la carpeta de diagramas: ${carpeta}`);
  process.exit(1);
}
const ficheros = readdirSync(carpeta).filter(f => f.endsWith('.bpmn')).sort();
if (!ficheros.length) {
  // Una carpeta vacia no es una validacion correcta: es haber perdido los diagramas.
  console.log(`No hay ningun diagrama .bpmn en ${carpeta}.`);
  process.exit(1);
}

let fallos = 0;
for (const fichero of ficheros) {
  const xml = readFileSync(join(carpeta, fichero), 'utf8');
  const { rootElement, warnings } = await moddle.fromXML(xml);
  const problemas = warnings.map(w => `bpmn-moddle: ${w.message.split('\n')[0]}`);

  const conForma = new Set();
  for (const diagrama of rootElement.diagrams || []) {
    for (const forma of diagrama.plane?.planeElement || []) {
      if (forma.bpmnElement?.id) conForma.add(forma.bpmnElement.id);
    }
  }
  let elementos = 0;
  recorre(rootElement, e => {
    if (e.$instanceOf?.('bpmn:FlowNode') || DIBUJABLES.has(e.$type)) {
      elementos += 1;
      if (!conForma.has(e.id)) problemas.push(`${e.id} (${e.$type}) no tiene forma en el DI`);
    }
  });

  const { xml: guardado } = await moddle.toXML(rootElement);
  const { rootElement: reabierto } = await moddle.fromXML(guardado);
  problemas.push(...cambiosAlGuardar(instantanea(rootElement), instantanea(reabierto)));
  const delPool = await atributosDelPool(xml, guardado, rootElement);
  problemas.push(...delPool.problemas);

  const otras = await enOtrasHerramientas(xml, instantanea(rootElement));
  problemas.push(...otras.problemas);

  if (problemas.length) {
    fallos += 1;
    console.log(`${fichero.padEnd(34)} PROBLEMAS`);
    for (const p of problemas.slice(0, 12)) console.log(`         ${p}`);
    if (problemas.length > 12) console.log(`         ... y ${problemas.length - 12} mas`);
  } else {
    console.log(`${fichero.padEnd(34)} ok      ${elementos} elementos con forma, igual tras abrir y guardar; ${delPool.cuantos} atributos de pool, escritos igual`);
    console.log(`${''.padEnd(34)}         bpmn-moddle, Camunda 7 y Camunda 8: sin avisos, ven las ${otras.marcas} marcas y guardan sin perder nada`);
  }
}

// (6) El formato anterior a la 5.2, con la migracion del Modeler.
const LISTAS_ANTIGUAS = [
  ['user:UserTask', PEOPLE_TYPES.task], ['lane:userWithoutRole', PEOPLE_TYPES.lane],
  ['participantWithoutLane:userWithoutRole', PEOPLE_TYPES.participant],
  ['model:userWithoutRole', PEOPLE_TYPES.process], ['model:userWithRole', PEOPLE_TYPES.roles]
];
const comoTexto = v => (v && typeof v === 'object' ? [v.key ?? '', v.value ?? ''] : v);

// Las listas escritas en el sitio antiguo, por elemento; sin get(), que las crearia.
function listasAntiguas(raiz) {
  const listas = [];
  recorre(raiz, e => {
    for (const [nombre, tipo] of LISTAS_ANTIGUAS) {
      const propiedad = e.$descriptor?.propertiesByName?.[nombre];
      const valores = propiedad && e[propiedad.name];
      if (Array.isArray(valores) && valores.length) listas.push({ e, nombre, tipo, valores: valores.map(comoTexto) });
    }
  });
  return listas;
}

const carpetaAnterior = join(aqui, 'formato-anterior');
const anteriores = existsSync(carpetaAnterior) ? readdirSync(carpetaAnterior).filter(f => f.endsWith('.bpmn')).sort() : [];
console.log('\nFormato anterior a la 5.2 (formato-anterior/), con la migracion del Modeler:');
if (!anteriores.length) {
  // Sin ellos no se prueba que los ficheros antiguos se siguen abriendo.
  console.log(`No hay ningun diagrama .bpmn en ${carpetaAnterior}.`);
  fallos += 1;
}
for (const fichero of anteriores) {
  const { rootElement, warnings } = await moddle.fromXML(readFileSync(join(carpetaAnterior, fichero), 'utf8'));
  const problemas = warnings.map(w => `bpmn-moddle: ${w.message.split('\n')[0]}`);
  const antes = listasAntiguas(rootElement);
  if (!antes.length) problemas.push('no tiene ninguna lista en el sitio antiguo: no prueba la migracion');
  const movidas = migrateLegacyPeople(moddle, rootElement);
  for (const { e, nombre, tipo, valores } of antes) {
    const ahora = entriesOf(e, tipo).map(x => (tipo === PEOPLE_TYPES.roles ? comoTexto(x) : x.value ?? ''));
    if (JSON.stringify(ahora) !== JSON.stringify(valores)) {
      problemas.push(`${e.id}: ${nombre} era ${JSON.stringify(valores)} y en extensionElements queda ${JSON.stringify(ahora)}`);
    }
  }
  for (const { e, nombre } of listasAntiguas(rootElement)) problemas.push(`${e.id}: ${nombre} sigue en el sitio antiguo`);
  const { xml: migrado } = await moddle.toXML(rootElement);
  const otras = await enOtrasHerramientas(migrado, instantanea((await moddle.fromXML(migrado)).rootElement));
  problemas.push(...otras.problemas);
  const nuevo = join(aqui, 'integracion', fichero);
  if (existsSync(nuevo)) {
    const a = instantanea((await moddle.fromXML(migrado)).rootElement);
    const b = instantanea((await moddle.fromXML(readFileSync(nuevo, 'utf8'))).rootElement);
    for (const cambio of cambiosAlGuardar(a, b)) problemas.push(`frente a integracion/${fichero}: ${cambio}`);
  }
  if (problemas.length) {
    fallos += 1;
    console.log(`${fichero.padEnd(34)} PROBLEMAS`);
    for (const p of problemas.slice(0, 12)) console.log(`         ${p}`);
    if (problemas.length > 12) console.log(`         ... y ${problemas.length - 12} mas`);
  } else {
    const igual = existsSync(nuevo) ? `; igual que integracion/${fichero}` : '';
    console.log(`${fichero.padEnd(34)} ok      ${movidas} entradas de ${antes.length} listas pasan a extensionElements; sin avisos en las otras herramientas${igual}`);
  }
}
// (7) Los numeros del panel: lo que acepta, guardado y vuelto a abrir, lo acepta igual.
const CAMPOS_NUMERICOS = [
  // [elemento, propiedad, entero, minimo]
  ['P', 'frequency', false, 0], ['P', 'instances', true, 1], ['P', 'arrivalWindow', true, 0],
  ['Proc', 'frequency', false, 0], ['Proc', 'instance', true, 1], ['C', 'instance', true, 1]
];
const VALEN = {
  decimal: ['0.0000001', '1e-7', '0.000000123', '2.5e-3', '0.1', '3', '0', '123456789.125',
    '1000000000000000000000', '1e+21', '5e-324'],
  entero: ['1', '20', '9007199254740991']
};
const NO_VALEN = { decimal: ['1e400', '-1', '.5', '1,5', 'abc'], entero: ['9007199254740992', '1e3', '2.5', '-3'] };
const PLANTILLA = '<?xml version="1.0" encoding="UTF-8"?><bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" ' +
  'id="D" targetNamespace="x"><bpmn:collaboration id="C"><bpmn:participant id="P" processRef="Proc"/></bpmn:collaboration>' +
  '<bpmn:process id="Proc"/></bpmn:definitions>';
const porId = raiz => {
  const ids = {};
  recorre(raiz, e => { if (e.id) ids[e.id] = e; });
  return ids;
};
const problemasNumeros = [];
let probados = 0, rechazados = 0;
for (const [id, propiedad, integer, minimum] of CAMPOS_NUMERICOS) {
  const opciones = { integer, minimum };
  for (const texto of VALEN[integer ? 'entero' : 'decimal']) {
    const campo = `${id}.${propiedad}=${texto}`;
    if (checkNumber(texto, opciones) !== null) {
      problemasNumeros.push(`${campo}: el panel lo rechaza`);
      continue;
    }
    const valor = parseNumber(texto, opciones);
    const { rootElement } = await moddle.fromXML(PLANTILLA);
    porId(rootElement)[id].set(propiedad, valor);
    const { xml } = await moddle.toXML(rootElement);
    const leido = porId((await moddle.fromXML(xml)).rootElement)[id].get(propiedad);
    const mostrado = formatNumber(leido);
    probados += 1;
    if (checkNumber(mostrado, opciones) !== null) {
      problemasNumeros.push(`${campo}: se guarda, se abre y el panel muestra ${JSON.stringify(mostrado)}, que rechaza`);
    } else if (parseNumber(mostrado, opciones) !== valor || Number(leido) !== valor) {
      problemasNumeros.push(`${campo}: se guarda ${valor} y vuelve ${JSON.stringify(mostrado)}`);
    }
  }
  const malos = [...NO_VALEN[integer ? 'entero' : 'decimal'], ...(minimum > 0 ? ['0'] : [])];
  for (const texto of malos) {
    if (checkNumber(texto, opciones) === null) {
      problemasNumeros.push(`${id}.${propiedad}=${JSON.stringify(texto)}: el panel lo acepta`);
    } else {
      rechazados += 1;
    }
  }
}
console.log('\nNumeros del panel (Modeler/lib/numbers), guardados y vueltos a abrir:');
if (problemasNumeros.length) {
  fallos += 1;
  for (const p of problemasNumeros) console.log(`         ${p}`);
} else {
  console.log(`${CAMPOS_NUMERICOS.length} campos      ok      ${probados} valores vuelven al panel validos e iguales; ${rechazados} que no valen, rechazados`);
}

const total = ficheros.length + anteriores.length;
console.log(fallos ? `\n${fallos} diagrama(s) con problemas.` : `\n${total} diagramas validos para bpmn-moddle.`);
process.exit(fallos ? 1 : 0);
