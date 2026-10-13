// Lo que el Modeler manda a la API al simular cada diagrama del banco (5.4).
//
//     node pruebas/exporta_reglas.mjs             compara con exportadas/
//     node pruebas/exporta_reglas.mjs --congela   las vuelve a escribir
//
// Para cada integracion/<modelo>.bpmn, y para cada ejemplo del Modeler
// -Modeler/ejemplos/<ejemplo>.bpmn, dibujados en el (5.6)-, hace lo mismo que
// el Modeler al abrir el diagrama y pulsar Simular, con su mismo codigo:
//
// 1. Lo abre con bpmn-moddle y los descriptores del Modeler, y pasa a
//    extensionElements las listas de personas del formato anterior
//    (Modeler/lib/people, lo que hace el Modeler al abrir un fichero).
// 2. Recorre los elementos con el BpmnTreeWalker de bpmn-js, que es el que
//    decide el orden en que el Modeler los pinta y los guarda en su
//    elementRegistry. Las reglas salen en ese orden, y el motor depende de el.
// 3. Exporta las reglas con Modeler/lib/rules, el exportador del Modeler, y
//    guarda el diagrama como lo guarda el Modeler (moddle.toXML). Al pintar una
//    compuerta exclusiva, bpmn-js le pone isMarkerVisible en el DI
//    (ElementFactory); se hace igual aqui, para que lo guardado sea lo mismo.
//
// Escribe -o compara- exportadas/<modelo>.txt y exportadas/<modelo>.bpmn. De
// los ejemplos, solo las reglas, en exportadas/ejemplos/: un ejemplo es lo que
// guarda el Modeler, y abierto y guardado otra vez tiene que salir igual, byte
// a byte; lo que el Modeler manda al simularlo es el propio fichero.
// integracion.py los manda juntos a la API y exige el mismo XES que las reglas
// de referencia con la misma semilla. Aqui se comprueba que siguen siendo lo
// que exporta el Modeler de hoy: si cambia el exportador o un diagrama, sale
// la diferencia, y si es la esperada se congela otra vez.
//
// Necesita las dependencias del Modeler (npm install en Modeler/).
import { createRequire, register } from 'module';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const aqui = dirname(fileURLToPath(import.meta.url));
const modeler = join(aqui, '..', '..', 'Modeler');
const require = createRequire(join(modeler, 'package.json'));
const url = ruta => pathToFileURL(ruta).href;

// Los modulos de bpmn-js se importan sin extension, como los resuelve webpack;
// Node no, y este gancho le anade el .js que falta.
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND' && /^\\.{1,2}\\//.test(specifier) && !specifier.endsWith('.js')) {
      return next(specifier + '.js', context);
    }
    throw error;
  }
}`));

const BpmnModdle = (await import(url(require.resolve('bpmn-moddle')))).default;
const BpmnTreeWalker = (await import(url(join(dirname(require.resolve('bpmn-js/package.json')), 'lib', 'import', 'BpmnTreeWalker.js')))).default;
const { migrateLegacyPeople } = await import(url(join(modeler, 'lib', 'people', 'people.js')));
const { exportRules } = await import(url(join(modeler, 'lib', 'rules', 'rules.js')));

const descriptor = nombre => JSON.parse(readFileSync(join(modeler, 'descriptors', `${nombre}.json`), 'utf8'));
// Los mismos, con los mismos prefijos, que carga example/src/modeler.js.
const moddle = new BpmnModdle({
  user: descriptor('user'), sequenceFlow: descriptor('sequenceFlow'), model: descriptor('model'),
  collaboration: descriptor('collaboration'), lane: descriptor('lane'),
  participantWithoutLane: descriptor('participantWithoutLane')
});

// Los elementos que bpmn-js pinta, en su orden: la raiz y luego cada elemento
// con forma en el DI. Como en el elementRegistry, cada uno con su tipo y su
// objeto de negocio; las etiquetas no, que el exportador las descarta.
function elementosDelRegistro(definiciones) {
  const elementos = [];
  const anota = (elemento, di) => {
    // Lo mismo que hace ElementFactory de bpmn-js al crear la forma.
    if (di && elemento.$instanceOf('bpmn:ExclusiveGateway')) {
      if (Object.prototype.hasOwnProperty.call(di, 'isMarkerVisible')) {
        if (di.isMarkerVisible === undefined) di.isMarkerVisible = false;
      } else {
        di.isMarkerVisible = true;
      }
    }
    const forma = { id: elemento.id, type: elemento.$type, businessObject: elemento };
    elementos.push(forma);
    return forma;
  };
  const errores = [];
  const recorrido = new BpmnTreeWalker({
    root: anota,
    element: anota,
    error: (mensaje) => errores.push(mensaje)
  }, texto => texto);
  recorrido.handleDefinitions(definiciones);
  return { elementos, errores };
}

async function exporta(xml) {
  const { rootElement: definiciones, warnings } = await moddle.fromXML(xml);
  migrateLegacyPeople(moddle, definiciones);
  const { elementos, errores } = elementosDelRegistro(definiciones);
  const reglas = exportRules(elementos, definiciones);
  const { xml: guardado } = await moddle.toXML(definiciones);
  return { reglas, guardado, avisos: [...warnings.map(w => w.message.split('\n')[0]), ...errores] };
}

const congela = process.argv.includes('--congela');
// Lo que se exporta y adonde: los diagramas del banco, generados desde las
// reglas, y los ejemplos del Modeler (5.6), dibujados y guardados en el.
const GRUPOS = [
  { origen: join(aqui, 'integracion'), destino: join(aqui, 'exportadas'), prefijo: '', esLoGuardado: false },
  { origen: join(modeler, 'ejemplos'), destino: join(aqui, 'exportadas', 'ejemplos'), prefijo: 'ejemplos/', esLoGuardado: true }
];
const bpmnDe = carpeta => (existsSync(carpeta) ? readdirSync(carpeta).filter(f => f.endsWith('.bpmn')).sort() : []);
const vacios = GRUPOS.filter(g => !bpmnDe(g.origen).length);
if (vacios.length) {
  // Una carpeta vacia no es una exportacion correcta: es haber perdido los diagramas.
  for (const { origen } of vacios) console.log(`No hay ningun diagrama .bpmn en ${origen}.`);
  process.exit(1);
}

let fallos = 0, total = 0;
const nuevos = [];
const restos = [];
for (const { origen, destino, prefijo, esLoGuardado } of GRUPOS) {
  const diagramas = bpmnDe(origen);
  const vigentes = new Set();
  for (const fichero of diagramas) {
    total += 1;
    const modelo = fichero.replace(/\.bpmn$/, '');
    const original = readFileSync(join(origen, fichero), 'utf8');
    const { reglas, guardado, avisos } = await exporta(original);
    nuevos.push({ destino, modelo, reglas, guardado: esLoGuardado ? null : guardado });
    vigentes.add(`${modelo}.txt`);
    if (!esLoGuardado) vigentes.add(`${modelo}.bpmn`);
    const problemas = avisos.map(a => `al abrirlo: ${a}`);
    if (esLoGuardado && guardado !== original) {
      const desde = [...guardado].findIndex((c, i) => c !== original[i]);
      problemas.push(`abierto y guardado con el Modeler no sale igual; cambia en el caracter ${desde + 1}: ` +
        JSON.stringify(guardado.slice(Math.max(0, desde - 40), desde + 80)));
    }
    if (!congela) {
      const congelados = [['txt', reglas, 'las reglas'], ...(esLoGuardado ? [] : [['bpmn', guardado, 'el BPMN guardado']])];
      for (const [extension, texto, que] of congelados) {
        const ruta = join(destino, `${modelo}.${extension}`);
        if (!existsSync(ruta)) {
          problemas.push(`no esta exportadas/${prefijo}${modelo}.${extension}: ejecuta con --congela`);
        } else if (readFileSync(ruta, 'utf8') !== texto) {
          const viejas = readFileSync(ruta, 'utf8').split('\n'), nuevas = texto.split('\n');
          const linea = nuevas.findIndex((l, i) => l !== viejas[i]);
          problemas.push(`${que} cambian desde la linea ${linea + 1}: ${JSON.stringify((nuevas[linea] || '').slice(0, 160))}`);
        }
      }
    }
    if (problemas.length) {
      fallos += 1;
      console.log(`${(prefijo + fichero).padEnd(40)} PROBLEMAS`);
      for (const p of problemas) console.log(`         ${p}`);
    } else {
      const lineas = reglas.split('\n').filter(l => l.startsWith('Element:')).length;
      console.log(`${(prefijo + fichero).padEnd(40)} ok      ${lineas} elementos en las reglas${congela ? '' : ', igual que lo congelado'}`);
    }
  }
  // Lo congelado de un diagrama que ya no existe es un resto. Las carpetas no:
  // la de los ejemplos esta dentro de exportadas/.
  if (existsSync(destino)) {
    for (const f of readdirSync(destino).sort()) {
      if (!vigentes.has(f) && statSync(join(destino, f)).isFile()) restos.push({ ruta: `${prefijo}${f}`, origen });
    }
  }
}

const deDonde = origen => (origen.startsWith(modeler) ? 'Modeler/ejemplos/' : 'integracion/');
if (congela) {
  if (fallos) {
    console.log(`\nNo se ha escrito nada: ${fallos} diagrama(s) con problemas.`);
    process.exit(1);
  }
  for (const { destino, modelo, reglas, guardado } of nuevos) {
    mkdirSync(destino, { recursive: true });
    writeFileSync(join(destino, `${modelo}.txt`), reglas);
    if (guardado !== null) writeFileSync(join(destino, `${modelo}.bpmn`), guardado);
  }
  for (const { ruta, origen } of restos) console.log(`Sobra exportadas/${ruta}: su diagrama ya no esta en ${deDonde(origen)}; borralo.`);
  console.log(`\nCongelados ${total} diagramas en exportadas/.`);
  process.exit(restos.length ? 1 : 0);
}
for (const { ruta, origen } of restos) {
  console.log(`${ruta.padEnd(40)} SOBRA   su diagrama ya no esta en ${deDonde(origen)}`);
  fallos += 1;
}
console.log(fallos ? `\n${fallos} problema(s).` : `\n${total} diagramas: lo exportado es lo que exporta hoy el Modeler.`);
process.exit(fallos ? 1 : 0);
