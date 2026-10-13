// Comprobacion independiente de los diagramas de integracion.
//
//     node pruebas/valida_bpmn.mjs [carpeta]
//
// Sin argumento revisa pruebas/integracion/. Abre cada diagrama con
// bpmn-moddle -la libreria con la que bpmn-js importa un diagrama- y con los
// descriptores del Modeler, y comprueba tres cosas:
//
// 1. Que bpmn-moddle lo entiende entero: nada desconocido, nada sin resolver.
// 2. Que cada elemento dibujable tiene su forma en el DI, o el Modeler no
//    podria pintarlo.
// 3. Que abrirlo y guardarlo no cambia nada. Es lo que hace el Modeler cada vez
//    que alguien abre un diagrama y lo vuelve a guardar, y es donde se ve que
//    una propiedad esta mal escrita: una lista de usuarios escrita como
//    atributo se abre como una cadena y se guarda letra a letra.
// 4. Que abre en otra herramienta (3.1): con bpmn-moddle SIN los descriptores
//    del Modeler, que es como lo ve cualquier otra herramienta, tienen que
//    seguir ahi todos los elementos BPMN y todas las marcas -multiinstancia y
//    multiplicidad-, que son las que el motor lee del dibujo. Lo unico que se
//    tolera que no entienda son los elementos propios del Modeler, y se cuentan:
//    que otra herramienta los abra sin avisos es la 5.2.
// 5. Que los atributos propios de cada pool (5.1) -frequency, instances,
//    orchestrationRole, infiniteResources, arrivalMode y arrivalWindow- salen
//    de abrir y guardar escritos igual que estaban en el fichero, y que los
//    descriptores los leen con su tipo. Lo de (3) no basta: compara lo abierto
//    con lo reabierto, y si el descriptor lee mal un valor -frequency=0.1 como
//    entero se queda en 0- la primera lectura ya lo ha perdido y la segunda
//    coincide con ella. Aqui se compara el texto, leido sin descriptores.
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

const otraHerramienta = new BpmnModdle();
const PREFIJOS_DEL_MODELER = ['user', 'participantWithoutLane', 'lane', 'model', 'collab', 'sequenceFlow'];
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

  const ajeno = await otraHerramienta.fromXML(xml);
  const propios = ajeno.warnings.filter(w => PREFIJOS_DEL_MODELER.some(p => w.message.includes(`<${p}:`)));
  for (const w of ajeno.warnings.filter(w => !propios.includes(w))) {
    problemas.push(`otra herramienta: ${w.message.split('\n')[0]}`);
  }
  const conModeler = instantanea(rootElement), sinModeler = instantanea(ajeno.rootElement);
  let marcas = 0;
  for (const [clave, { tipo, props }] of Object.entries(conModeler)) {
    if (!tipo.startsWith('bpmn:')) continue;
    const visto = sinModeler[clave];
    const esMarca = tipo === 'bpmn:MultiInstanceLoopCharacteristics' || tipo === 'bpmn:ParticipantMultiplicity';
    if (esMarca) marcas += 1;
    if (!visto || visto.tipo !== tipo) {
      problemas.push(`otra herramienta: no ve ${clave} (${tipo})`);
    } else if (esMarca && JSON.stringify(visto.props.isSequential) !== JSON.stringify(props.isSequential)) {
      problemas.push(`otra herramienta: lee ${clave} con otro isSequential`);
    }
  }

  if (problemas.length) {
    fallos += 1;
    console.log(`${fichero.padEnd(34)} PROBLEMAS`);
    for (const p of problemas.slice(0, 12)) console.log(`         ${p}`);
    if (problemas.length > 12) console.log(`         ... y ${problemas.length - 12} mas`);
  } else {
    console.log(`${fichero.padEnd(34)} ok      ${elementos} elementos con forma, igual tras abrir y guardar; ${delPool.cuantos} atributos de pool, escritos igual`);
    console.log(`${''.padEnd(34)}         otra herramienta: ve las ${marcas} marcas; no entiende ${propios.length} elementos propios del Modeler (5.2)`);
  }
}
console.log(fallos ? `\n${fallos} diagrama(s) con problemas.` : `\n${ficheros.length} diagramas validos para bpmn-moddle.`);
process.exit(fallos ? 1 : 0);
