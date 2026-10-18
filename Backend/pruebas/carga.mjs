// La carga de los registros y el rendimiento del visualizador (6.8).
//
//     node pruebas/carga.mjs
//
// Sin navegador:
//
// 1. La huella del diagrama (Modeler/lib/logs/sha256.js) es la de Node -la
//    misma que calcula el Backend-, con acentos, textos largos y todos los
//    diagramas de integracion.
// 2. La comprobacion del conjunto (Modeler/lib/logs/checks.js): los registros
//    de todos los modelos de esperado/ pasan, solos y con su diagrama de
//    integracion, leido como lo lee el Modeler antes de abrirlo -con
//    bpmn-moddle-; y cada conjunto roto se rechaza diciendo por que: ninguno,
//    falta uno, duplicado, mal formado, no es XES, dos simulaciones pegadas en
//    un fichero, con texto detras del registro, de otra simulacion, de otro
//    modelo, con otra base temporal, con una traza de otro pool, con otro
//    nombre, sin identificacion, sin plantilla, de otro formato, uno que sobra,
//    uno solo de un modelo de dos -uno solo de un modelo de un participante si
//    vale-, una traza sin participante, un caso repetido con otro nombre y un
//    <log> de otro espacio de nombres. Con el diagrama: el de otro modelo, uno
//    sin la forma de un pool, uno sin los elementos por los que pasan sus
//    casos -tambien si solo estan en un diagrama que bpmn-js no dibuja-, y el
//    aviso si no es el que se simulo -tambien con \r\n-. Y lo que
//    se lee de un .bpmn sin abrirlo -su raiz, sus pools y lo dibujado- es lo
//    que se lee aqui por otro camino, en todos los diagramas del banco; lo que
//    bpmn-js no abriria no se lee como diagrama.
// 3. Que el Backend (Backend/simulator/registros.py) dice lo mismo: acepta los
//    conjuntos buenos y rechaza los rotos que comprueba; y la huella de cada
//    diagrama es la suya.
//
// Despues, el Modeler compilado, en un Chromium de verdad, con el 40 -el
// proceso base con 100 residentes, 101 casos-:
//
// 4. Cargado de disco -los dos XES y su diagrama- con «Cargar registros», se
//    reproduce con fluidez: a x50, cada instante se dibuja en pocos
//    milisegundos y el navegador sigue a 60 fotogramas por segundo. Por encima
//    del umbral, insignias: a los 900 s los 100 residentes que esperan su
//    resultado son una insignia de 100.
// 5. Con recursos y resultados historicos, sin consultar las reglas de ahora:
//    con el diagrama cambiado -sin Carlos y aceptando el 10 % en vez del 60 %-
//    avisa de que no es el que se simulo, pero la plantilla sigue teniendo a
//    Carlos y al final hay 59 aceptadas, 19 rechazadas y 22 reevaluadas, como
//    dice el registro.
// 6. Simulado por el Backend, guardado -«Descargar todos» y «Descargar el
//    diagrama»- y cargado otra vez en una pagina nueva, se reproduce con el
//    mismo estado: lo dibujado y el resumen en varios instantes son los
//    mismos, y el diagrama es el que se simulo, sin avisos. Guardado otra vez
//    desde ahi, son los mismos ficheros.
// 7. Lo que no vale no se carga y se dice por que: un solo registro de un
//    modelo de dos, uno de otra simulacion, uno repetido, dos pegados en un
//    fichero, los registros de
//    otro modelo con este diagrama, un fichero que no es ni XES ni BPMN, un
//    .bpmn que no es un diagrama, uno sin nada que dibujar, uno sin una tarea
//    -tambien en el primero de dos diagramas-, unos registros que no se pueden
//    reproducir, uno con una entidad que no se lee y uno con Scheduler; y
//    siguen el diagrama de antes y Reproducir desactivado, con un solo
//    mensaje. Arrastrarlos al lienzo los carga igual;
//    sin su diagrama no se ofrece descargar el abierto; y mientras se simula no
//    se cargan. Una respuesta del Backend que no es del diagrama abierto no
//    se puede reproducir. Y si despues de cargarla se borra una tarea por la
//    que pasan sus casos, Reproducir dice que falta y no la reproduce.
// En ninguna puede salir una ventana emergente ni un error en la consola.
//
// Necesita, en Modeler/, `npm install` y `npx playwright install chromium`;
// con un Chromium ya instalado se puede usar ese: CHROMIUM_PATH=<ejecutable>.
// Y python3 con las dependencias del Backend, para el punto 3.
import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import { createRequire } from 'module';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

import { abreChromium, sirve } from './navegador.mjs';

const aqui = dirname(fileURLToPath(import.meta.url));
const backend = join(aqui, '..');
const modeler = join(aqui, '..', '..', 'Modeler');
const require = createRequire(join(modeler, 'package.json'));
const lib = join(modeler, 'lib');
const { sha256 } = await import(pathToFileURL(join(lib, 'logs', 'sha256.js')).href);
const { checkSimulation, diagramOfDefinitions } = await import(pathToFileURL(join(lib, 'logs', 'checks.js')).href);
const { parseXml } = await import(pathToFileURL(join(lib, 'timeline', 'xml.js')).href);

function sale(mensaje) {
  console.log(mensaje);
  process.exit(1);
}

// El moddle con el que el Modeler lee un .bpmn antes de abrirlo: el de bpmn-js,
// con sus descriptores. En Windows require.resolve devuelve C:\..., que
// import() leeria como un protocolo "c:"; hay que pasarlo a URL de fichero.
let moddle;
try {
  const BpmnModdle = (await import(pathToFileURL(require.resolve('bpmn-moddle')).href)).default;
  const descriptor = nombre => JSON.parse(readFileSync(join(modeler, 'descriptors', `${nombre}.json`), 'utf8'));
  moddle = new BpmnModdle(Object.fromEntries([ 'user', 'sequenceFlow', 'model', 'collaboration', 'lane', 'participantWithoutLane' ]
    .map(nombre => [ nombre, descriptor(nombre) ])));
} catch {
  sale('Faltan las dependencias del Modeler: npm install en Modeler/.');
}
const leeDiagrama = async xml => diagramOfDefinitions((await moddle.fromXML(xml, 'bpmn:Definitions')).rootElement, xml);

const esperado = join(aqui, 'esperado');
const integracion = join(aqui, 'integracion');
const esCarpeta = ruta => existsSync(ruta) && statSync(ruta).isDirectory();
const carpetas = esCarpeta(esperado)
  ? readdirSync(esperado).flatMap(d => (d === 'con-avisos' ? readdirSync(join(esperado, d)).map(e => join(d, e)) : [ d ]))
    .filter(d => esCarpeta(join(esperado, d)) && readdirSync(join(esperado, d)).some(f => f.endsWith('.xes'))).sort()
  : [];
// Sin registros no hay nada que comprobar, y eso no es un banco en verde.
if (!carpetas.length) sale(`No hay registros congelados en ${esperado}.`);
const CIEN = '40-proceso-base-con-100';
for (const modelo of [ CIEN, '39-evaluar-con-cinco-personas', '01-simple' ]) {
  if (!carpetas.includes(modelo)) sale(`Falta el modelo ${modelo} en ${esperado}.`);
  if (!existsSync(join(integracion, `${modelo}.bpmn`))) sale(`Falta integracion/${modelo}.bpmn.`);
}
const nombre = carpeta => carpeta.replace(/^con-avisos[\\/]/, '');
const atributo = (xes, clave) => (xes.match(new RegExp(`key="${clave}" value="([^"]*)"`)) || [])[1];
const registrosDe = carpeta => readdirSync(join(esperado, carpeta)).filter(f => f.endsWith('.xes')).sort()
  .map(f => ({ fileName: f, xes: readFileSync(join(esperado, carpeta, f), 'utf8') }));
const diagramaDe = modelo => readFileSync(join(integracion, `${modelo}.bpmn`), 'utf8');
const comoTexto = valor => JSON.stringify(valor);

let fallos = 0;
function informa(que, problemas, detalle, ancho = 46) {
  if (problemas.length) {
    fallos += 1;
    console.log(`${que.padEnd(ancho)} FALLA`);
    for (const p of problemas.slice(0, 8)) console.log(`         ${p}`);
  } else {
    console.log(`${que.padEnd(ancho)} ok      ${detalle}`);
  }
}

// Lo que el Modeler sabe de un diagrama, sacado aqui del .bpmn por otro camino,
// sin bpmn-moddle: su raiz -la colaboracion, o el proceso si no la hay-, los
// pools y los elementos que tienen forma o linea en el diagrama, y su texto.
function diagrama(xml) {
  const definiciones = parseXml(xml).children.find(c => c.name === 'definitions');
  const colaboracion = definiciones.children.find(c => c.name === 'collaboration');
  const raiz = colaboracion || definiciones.children.find(c => c.name === 'process');
  const dibujados = [];
  const recorre = nodo => {
    if ([ 'BPMNShape', 'BPMNEdge' ].includes(nodo.name) && nodo.attrs.bpmnElement) dibujados.push(nodo.attrs.bpmnElement);
    nodo.children.forEach(recorre);
  };
  definiciones.children.filter(c => c.name === 'BPMNDiagram').forEach(recorre);
  return { id: raiz.attrs.id, process: !colaboracion,
    participants: colaboracion ? colaboracion.children.filter(c => c.name === 'participant').map(c => c.attrs.id).filter(id => dibujados.includes(id)) : [],
    elements: dibujados.sort(), xml };
}
const ordenado = d => ({ ...d, elements: [ ...d.elements ].sort(), xml: null });

// Un diagrama sin la forma de un elemento: como si se hubiera borrado.
const sinForma = (xml, id) => {
  const quitado = xml.replace(new RegExp(`\\n *<bpmndi:BPMNShape [^>]*bpmnElement="${id}"[^>]*>[\\s\\S]*?</bpmndi:BPMNShape>`), '');
  if (quitado === xml) sale(`No se encuentra la forma de ${id}.`);
  return quitado;
};

// El diagrama con otro BPMNDiagram detras: una copia del suyo, entera y con
// otros IDs de dibujo, cuyo plano es de `de` -de su misma raiz, si no se dice;
// si se dice, de un proceso vacio que se anade-. El primero queda como lo deje
// `primero`. bpmn-js solo dibuja el primero y los de su misma jerarquia, y de lo
// mismo, el primero.
function conOtroDiagrama(xml, { primero = dibujo => dibujo, de = null } = {}) {
  const inicio = xml.indexOf('  <bpmndi:BPMNDiagram');
  const fin = xml.indexOf('</bpmndi:BPMNDiagram>') + '</bpmndi:BPMNDiagram>'.length;
  if (inicio < 0 || fin < inicio) sale('No se encuentra el dibujo del diagrama.');
  const dibujo = xml.slice(inicio, fin);
  let copia = dibujo.replace(/ id="([^"]*)"/g, ' id="$1_copia"');
  if (de) copia = copia.replace(/(<bpmndi:BPMNPlane [^>]*bpmnElement=")[^"]*"/, `$1${de}"`);
  return `${xml.slice(0, inicio)}${de ? `  <bpmn:process id="${de}" />\n` : ''}${primero(dibujo)}\n${copia}${xml.slice(fin)}`;
}

// Los registros con la huella de un diagrama, como si se hubieran simulado con
// el: es lo que escribe el Backend cuando el Modeler le manda el diagrama.
const conHuella = (registros, huella) => registros.map(r => ({ ...r, xes: r.xes.replace(
  /(\n *<string key="model:rulesSha256" value="[^"]*" \/>)/, `$1\n  <string key="model:diagramSha256" value="${huella}" />`) }));

// --- 1 a 3: sin navegador ------------------------------------------------------------

console.log('Los registros, sin navegador:');
{
  const problemas = [];
  const textos = [ '', 'abc', 'Evaluación, ñandú, ü y 🎉', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'x'.repeat(200000),
    ...readdirSync(integracion).filter(f => f.endsWith('.bpmn')).map(f => readFileSync(join(integracion, f), 'utf8')) ];
  for (const texto of textos) {
    const previsto = createHash('sha256').update(texto, 'utf8').digest('hex');
    if (sha256(texto) !== previsto) problemas.push(`«${texto.slice(0, 20)}»: ${sha256(texto)} y ${previsto}`);
  }
  informa('la huella del diagrama', problemas, `${textos.length} textos, la de Node`);
}

let buenos = 0;
{
  const problemas = [];
  let conDiagrama = 0;
  for (const carpeta of carpetas) {
    const registros = registrosDe(carpeta);
    const solo = checkSimulation(registros);
    if (solo.problems.length || solo.warnings.length) problemas.push(`${nombre(carpeta)}: ${comoTexto([ ...solo.problems, ...solo.warnings ])}`);
    buenos += 1;
    const bpmn = join(integracion, `${nombre(carpeta)}.bpmn`);
    if (!existsSync(bpmn)) continue;
    conDiagrama += 1;
    const xml = readFileSync(bpmn, 'utf8');
    const con = checkSimulation(registros, { diagram: await leeDiagrama(xml) });
    if (con.problems.length) problemas.push(`${nombre(carpeta)} con su diagrama: ${comoTexto(con.problems)}`);
    if (comoTexto(con.warnings) !== comoTexto([ 'Los registros se simularon sin diagrama: no se puede comprobar que el diagrama sea el que se simuló.' ])) {
      problemas.push(`${nombre(carpeta)}: avisos ${comoTexto(con.warnings)}`);
    }
    const simulado = checkSimulation(conHuella(registros, sha256(xml)), { diagram: await leeDiagrama(xml) });
    const enWindows = checkSimulation(conHuella(registros, sha256(xml)), { diagram: await leeDiagrama(xml.replace(/\n/g, '\r\n')) });
    if (enWindows.problems.length || enWindows.warnings.length) problemas.push(`${nombre(carpeta)}, con \\r\\n: ${comoTexto(enWindows)}`);
    if (simulado.problems.length || simulado.warnings.length) problemas.push(`${nombre(carpeta)}, simulado con su diagrama: ${comoTexto(simulado)}`);
    const cambiado = checkSimulation(conHuella(registros, sha256(xml)), { diagram: await leeDiagrama(xml.replace('</bpmn:definitions>', '<!-- otro -->\n</bpmn:definitions>')) });
    if (cambiado.problems.length || !/no es el que se simuló/.test(cambiado.warnings.join(' '))) problemas.push(`${nombre(carpeta)}, cambiado: ${comoTexto(cambiado.warnings)}`);
  }
  informa('los conjuntos buenos pasan', problemas, `${buenos} modelos, ${conDiagrama} con su diagrama: sin avisos simulados con el, ` +
    'tambien con \\r\\n, y con aviso si ha cambiado o se simularon sin el');
}

// Los conjuntos rotos, a partir del 39, que tiene dos pools, y lo que tiene
// que decir cada uno. Los mismos que comprueba integracion.py, y algunos mas.
const de39 = registrosDe('39-evaluar-con-cinco-personas').map(r => ({ ...r, pool: atributo(r.xes, 'pool:id'), name: atributo(r.xes, 'pool:name') }));
const de40 = registrosDe(CIEN).map(r => ({ ...r, pool: atributo(r.xes, 'pool:id'), name: atributo(r.xes, 'pool:name') }));
const [ a, b ] = de39;
const cambia = (registro, de, a_) => ({ ...registro, xes: registro.xes.replace(de, a_) });
const sin = (registro, clave) => ({ ...registro, xes: registro.xes.replace(new RegExp(`\\n *<(string|int) key="${clave}"[^>]*/>|\\n *<list key="${clave}">[\\s\\S]*?\\n  </list>`), '') });
const traza = b.xes.slice(b.xes.indexOf('  <trace>'), b.xes.indexOf('</trace>') + '</trace>'.length);
const identificacion = atributo(a.xes, 'simulation:id');
const ROTOS = [
  [ 'ninguno', [], /No hay ningún registro/, true ],
  [ 'falta uno', [ b ], /Falta el registro de Pool_Comision/, true ],
  [ 'duplicado', [ a, b, a ], /Pool_Comision está duplicado/, true ],
  [ 'mal formado', [ { ...a, xes: a.xes.slice(0, a.xes.length / 2) }, b ], /está mal formado/, true ],
  [ 'no es XES', [ { ...a, xes: '<?xml version="1.0"?><otra/>' }, b ], /no es un registro XES/, true ],
  [ 'dos simulaciones en un fichero', [ { ...a, xes: a.xes + cambia(a, `value="${identificacion}"`, `value="${[ ...identificacion ].reverse().join('')}"`).xes }, b ],
    /está mal formado: .*mas de un elemento raiz/, true ],
  [ 'texto detras del registro', [ { ...a, xes: `${a.xes}basura\n` }, b ], /está mal formado: .*texto fuera del elemento raiz/, true ],
  [ 'de otra simulacion', [ cambia(a, `value="${identificacion}"`, `value="${[ ...identificacion ].reverse().join('')}"`), b ],
    /no es de la misma simulación .*identificación/, true ],
  [ 'de otro modelo', [ cambia(a, /key="model:rulesSha256" value="[^"]*"/, 'key="model:rulesSha256" value="otra"'), b ], /huella de las reglas/, true ],
  [ 'con otra base temporal', [ cambia(a, /key="simulation:startDate" value="[^"]*"/, 'key="simulation:startDate" value="2026-02-01T00:00:00+00:00"'), b ],
    /base temporal/, true ],
  [ 'con registros de dos simulaciones', [ a, de40[1] ], /no es de la misma simulación/, true ],
  [ 'traza de otro pool', [ cambia(a, '</log>', `${traza}\n</log>`), b ], /trae una traza de Pool_Solicitante/, true ],
  [ 'con otro nombre', [ { ...a, pool: 'Pool_Inventado' }, b ], /dice ser de Pool_Comision/, true ],
  [ 'traza sin participante', [ cambia(a, '    <string key="bpmn:participant" value="Pool_Comision" />\n    <int key="bpmn:instance"', '    <int key="bpmn:instance"'), b ],
    /trae una traza de ningún pool/, true ],
  [ 'caso repetido con otro nombre', [ a, cambia(b, '</log>', `${traza.replace(/key="concept:name" value="[^"]*"/, 'key="concept:name" value="Otro"')}\n</log>`) ],
    /repite el caso Pool_Solicitante - 1/, true ],
  [ 'en otro espacio de nombres', [ cambia(a, 'xmlns="http://www.xes-standard.org/"', 'xmlns="http://otro.example/"'), b ], /no es un registro XES/, true ],
  [ 'sin identificacion', [ sin(a, 'simulation:id'), sin(b, 'simulation:id') ], /le falta o no vale: simulation:id/, true ],
  [ 'sin plantilla', [ sin(a, 'pool:staff'), b ], /le falta o no vale: pool:staff/, true ],
  [ 'de otro formato', [ a, b ].map(r => cambia(r, 'key="simulation:formatVersion" value="2"', 'key="simulation:formatVersion" value="99"')),
    /es del formato 99/, false ],
  [ 'uno que sobra', [ a, b, cambia(cambia(b, /key="pool:id" value="[^"]*"/, 'key="pool:id" value="Pool_Otro"'), /value="Pool_Solicitante/g, 'value="Pool_Otro') ],
    /Sobra el registro de Pool_Otro/, true ],
  [ 'uno solo de un modelo de dos', [ a ], /Un solo registro basta únicamente para un modelo de un participante/, true ]
];

{
  const problemas = [];
  for (const [ que, registros, previsto ] of ROTOS) {
    const { problems } = checkSimulation(registros);
    if (!problems.some(p => previsto.test(p))) problemas.push(`${que}: ${comoTexto(problems)}`);
  }
  const uno = checkSimulation(registrosDe('01-simple'), { diagram: await leeDiagrama(diagramaDe('01-simple')) });
  if (uno.problems.length) problemas.push(`uno solo de un modelo de un participante: ${comoTexto(uno.problems)}`);

  // Con el diagrama: de otro modelo con la misma raiz, de otro modelo, sin un
  // pool o sin un elemento por el que pasan sus casos.
  const conDiagrama = [
    [ 'el 39 con el diagrama del 40', de39, diagramaDe(CIEN), /no tiene el pool Pool_Comision/ ],
    [ 'el 39 con el del 01', de39, diagramaDe('01-simple'), /no es el del modelo de los registros/ ],
    [ 'el 39 sin la forma de un pool', de39, sinForma(diagramaDe('39-evaluar-con-cinco-personas'), 'Pool_Solicitante'),
      /no tiene el pool Pool_Solicitante/ ],
    [ 'el 20 con el del 14', registrosDe('20-reclamaciones'), diagramaDe('14-convocatoria-de-50'), /no tiene \d+ elementos por los que pasan/ ],
    [ 'el 40 sin la forma de una tarea', de40, sinForma(diagramaDe(CIEN), 'Esperar_Resultado'), /no tiene un elemento por los que pasan .*: Esperar_Resultado\./ ],
    [ 'el 40 con dos diagramas, el primero sin una tarea', de40,
      conOtroDiagrama(diagramaDe(CIEN), { primero: dibujo => sinForma(dibujo, 'Esperar_Resultado') }),
      /no tiene un elemento por los que pasan .*: Esperar_Resultado\./ ],
    [ 'el 40 con la tarea solo en el diagrama de otro proceso', de40,
      conOtroDiagrama(diagramaDe(CIEN), { primero: dibujo => sinForma(dibujo, 'Esperar_Resultado'), de: 'Proceso_ajeno' }),
      /no tiene un elemento por los que pasan .*: Esperar_Resultado\./ ]
  ];
  for (const [ que, registros, xml, previsto ] of conDiagrama) {
    const { problems } = checkSimulation(registros, { diagram: await leeDiagrama(xml) });
    if (!problems.some(p => previsto.test(p))) problemas.push(`${que}: ${comoTexto(problems)}`);
  }
  const dos = checkSimulation(de40, { diagram: await leeDiagrama(conOtroDiagrama(diagramaDe(CIEN))) });
  if (dos.problems.length) problemas.push(`el 40 con dos diagramas enteros: ${comoTexto(dos.problems)}`);

  // Lo que el Modeler lee de un .bpmn antes de abrirlo es lo que se lee aqui por
  // otro camino; y lo que bpmn-js no abriria no se lee como diagrama.
  const bpmns = [ integracion, join(aqui, 'exportadas') ].flatMap(carpeta => (esCarpeta(carpeta) ? readdirSync(carpeta) : [])
    .filter(f => f.endsWith('.bpmn')).map(f => readFileSync(join(carpeta, f), 'utf8')));
  for (const xml of bpmns) {
    const leido = ordenado(await leeDiagrama(xml));
    if (comoTexto(leido) !== comoTexto(ordenado(diagrama(xml)))) problemas.push(`sin abrirlo: ${comoTexto(leido).slice(0, 200)}`);
  }
  const sinDibujo = diagramaDe(CIEN).replace(/\n *<bpmndi:BPMNDiagram[\s\S]*<\/bpmndi:BPMNDiagram>/, '');
  for (const [ que, texto ] of [ [ 'un XES', a.xes ], [ 'un texto', 'hola' ], [ 'XML mal formado', '<bpmn:definitions>' ],
    [ 'un BPMN sin diagrama', sinDibujo ] ]) {
    let lee = null;
    try {
      lee = await leeDiagrama(texto);
    } catch {
      continue;
    }
    problemas.push(`${que} se lee como diagrama: ${comoTexto({ ...lee, xml: null }).slice(0, 200)}`);
  }
  informa('los conjuntos rotos se rechazan', problemas, `${ROTOS.length} rotos, cada uno diciendo por que; uno solo vale para el 01; ` +
    `y ${conDiagrama.length} con un diagrama que no es el suyo, y con dos diagramas el que dibuja bpmn-js; ` +
    `${bpmns.length} diagramas leidos sin abrirlos, y 4 que no lo son`);
}

// Lo mismo, preguntado al Backend: los buenos los acepta y los rotos -salvo el
// formato, que el visualizador lee tambien en el 1- los rechaza. Y la huella de
// cada diagrama es la que le pone el Backend (huella_del_diagrama).
{
  const problemas = [];
  const casos = [ [ 'el 39', de39, false ], [ 'el 40', de40, false ], ...ROTOS.filter(r => r[3] && r[1].length).map(([ que, registros ]) => [ que, registros, true ]) ];
  const programa = `
import json, sys
sys.path.insert(0, ${JSON.stringify(backend)})
from simulator.registros import Registro, huella_del_diagrama, revisa_registros
datos = json.load(sys.stdin)
print(json.dumps({"revisiones": [revisa_registros([Registro(r["pool"], r["name"], r["xes"]) for r in registros]) for registros in datos["casos"]],
                  "huellas": [huella_del_diagrama(texto) for texto in datos["diagramas"]]}))
`;
  const diagramas = [ ...readdirSync(integracion).filter(f => f.endsWith('.bpmn')).map(f => readFileSync(join(integracion, f), 'utf8')),
    diagramaDe(CIEN).replace('Proceso base', 'Evaluación, ñandú 🎉') ];
  // Con -X utf8, python3 lee y escribe UTF-8 sea cual sea la configuracion
  // regional: en Windows leia la entrada como CP1252, y las huellas del texto con
  // acentos y emojis no coincidian. `encoding` solo dice como escribe y lee Node.
  const python = spawnSync('python3', [ '-X', 'utf8', '-c', programa ], { input: JSON.stringify({ casos: casos.map(c => c[1]), diagramas }),
    encoding: 'utf8', maxBuffer: 1 << 28 });
  if (python.status !== 0) problemas.push(`python3 no responde: ${(python.stderr || '').split('\n').slice(-3).join(' ')}`);
  else {
    const { revisiones: respuestas, huellas } = JSON.parse(python.stdout);
    diagramas.forEach((texto, i) => {
      if (sha256(texto) !== huellas[i]) problemas.push(`la huella del diagrama ${i + 1}: ${sha256(texto)}, y el Backend dice ${huellas[i]}`);
    });
    casos.forEach(([ que, , roto ], i) => {
      if (Boolean(respuestas[i].length) !== roto) problemas.push(`${que}: el Backend dice ${comoTexto(respuestas[i])}`);
      const js = checkSimulation(casos[i][1]).problems;
      if (Boolean(js.length) !== roto) problemas.push(`${que}: el Modeler dice ${comoTexto(js)}`);
    });
  }
  informa('el Backend dice lo mismo', problemas, `${casos.length} conjuntos: los mismos aceptados y rechazados en los dos; ` +
    `y la huella de ${diagramas.length} diagramas`);
}

// --- 4 a 7: en el navegador ----------------------------------------------------------

console.log('\nEn el navegador:');
let chromium, webpack;
try {
  ({ chromium } = require('playwright'));
  webpack = require.resolve('webpack/bin/webpack.js');
} catch {
  sale('Faltan las dependencias del Modeler: npm install en Modeler/.');
}
const dist = mkdtempSync(join(tmpdir(), 'modeler-dist-'));
const compilacion = spawnSync(process.execPath, [ webpack, '--mode', 'production', '--output-path', dist ],
  { cwd: modeler, encoding: 'utf8' });
if (compilacion.status !== 0) {
  rmSync(dist, { recursive: true, force: true });
  sale(`No compila el Modeler:\n${`${compilacion.stdout}${compilacion.stderr}`.slice(-3000)}`);
}
const servidor = await sirve([ [ '/', join(modeler, 'example') ], [ '/dist/', dist ] ]);
let navegador;
try {
  navegador = await abreChromium(chromium);
} catch (error) {
  servidor.cierra();
  rmSync(dist, { recursive: true, force: true });
  sale(error.message);
}

const FRAME = 'reproducción · fotograma';

// Lo que hay en la pagina: lo dibujado -sin el numero de marca de la capa de
// dibujo- y lo que dice la barra.
const MIRA = () => {
  const capa = [ ...document.querySelectorAll('.layer-simulation-drawing > g') ]
    .filter(n => n.getAttribute('visibility') !== 'hidden');
  const dibujo = capa.map(n => {
    const { markId, ...datos } = n.dataset;
    return `${n.getAttribute('class')} ${JSON.stringify(datos)} ${n.getAttribute('transform')} ${n.textContent}`;
  }).sort();
  const barra = document.getElementById('replay');
  return { t: barra.dataset.t, abierta: !barra.hidden, dibujo, resumen: document.getElementById('replay-summary').innerText,
    estado: document.getElementById('simulation-status').textContent,
    insignias: capa.filter(n => n.classList.contains('scene-badge')).map(n => ({ ...n.dataset })),
    plantillas: capa.filter(n => n.classList.contains('scene-roster')).map(n => ({ pool: n.dataset.pool,
      gente: [ ...n.querySelectorAll('.scene-person') ].map(p => p.dataset.person) })) };
};

async function pagina() {
  const page = await navegador.newPage({ acceptDownloads: true, viewport: { width: 1600, height: 1000 } });
  page.incidencias = [];
  page.on('dialog', async d => {
    page.incidencias.push(`ventana emergente: ${d.message()}`);
    await d.dismiss();
  });
  page.on('pageerror', e => page.incidencias.push(`error en la pagina: ${e.message.split('\n')[0]}`));
  page.on('console', m => { if (m.type() === 'error') page.incidencias.push(`error en la consola: ${m.text().split('\n')[0]}`); });
  await page.goto(`${servidor.base}/modeler.html`);
  await page.waitForSelector('.djs-container');
  page.mira = () => page.evaluate(MIRA);
  page.salta = async t => {
    await page.fill('#replay-instant', String(t));
    await page.click('#replay-go');
    return page.mira();
  };
  page.carga = async ficheros => {
    await page.setInputFiles('#js-load-input', ficheros.map(f => ({ name: f.name, mimeType: 'application/xml', buffer: Buffer.from(f.text) })));
    // Se abre la reproduccion o se dice por que no; si no pasa ninguna de las
    // dos, lo que haya lo comprueba quien carga.
    await page.waitForFunction(() => !document.getElementById('replay').hidden || document.querySelector('.modal-overlay').style.display !== 'none',
      null, { timeout: 15000 }).catch(() => {});
    return page.mira();
  };
  return page;
}
const fichero = (name, text) => ({ name, text });
const ficherosDe = (registros, bpmn) => [ ...registros.map(r => fichero(r.fileName, r.xes)), ...(bpmn ? [ fichero(`${CIEN}.bpmn`, bpmn) ] : []) ];

// Lo que el XES dice al final: cuantas veces se llega a cada evento de fin.
const finales = registros => {
  const cuenta = {};
  for (const r of registros) {
    for (const [ , id ] of r.xes.matchAll(/<string key="bpmn:type" value="bpmn:EndEvent" \/>\s*<string key="bpmn:name" value="[^"]*" \/>\s*<string key="bpmn:id" value="([^"]*)"/g)) {
      cuenta[id] = (cuenta[id] || 0) + 1;
    }
  }
  return cuenta;
};

try {
  // 4. Cargado de disco, con fluidez y con insignias.
  {
    const problemas = [];
    const page = await pagina();
    const visto = await page.carga(ficherosDe(de40, diagramaDe(CIEN)));
    if (!visto.abierta) problemas.push(`no se abre: «${visto.estado}»`);
    if (!/Cargada de disco la simulación/.test(visto.estado)) problemas.push(`estado «${visto.estado}»`);
    await page.selectOption('#replay-speed', '50');
    await page.evaluate(() => {
      window.cuadros = [];
      const cuadro = () => {
        window.cuadros.push(performance.now());
        if (window.cuadros.length < 300) requestAnimationFrame(cuadro);
      };
      requestAnimationFrame(cuadro);
      performance.clearMeasures();
    });
    await page.click('#replay-play');
    await page.waitForTimeout(4000);
    await page.click('#replay-play');
    const medida = await page.evaluate(nombreDeLaMedida => {
      const dibujar = performance.getEntriesByName(nombreDeLaMedida).map(e => e.duration).sort((x, y) => x - y);
      const c = window.cuadros;
      const entre = c.slice(1).map((x, i) => x - c[i]).sort((x, y) => x - y);
      const en = (lista, q) => lista[Math.min(lista.length - 1, Math.floor(lista.length * q))];
      return { fotogramas: dibujar.length, mediana: en(dibujar, 0.5), p95: en(dibujar, 0.95), entre: en(entre, 0.5), entreP95: en(entre, 0.95),
        t: Number(document.getElementById('replay').dataset.t) };
    }, FRAME);
    if (medida.fotogramas < 100 || !(medida.t > 150)) problemas.push(`apenas ha reproducido: ${comoTexto(medida)}`);
    if (!(medida.mediana <= 8 && medida.p95 <= 16)) problemas.push(`dibujar un instante tarda demasiado: ${comoTexto(medida)}`);
    if (!(medida.entre <= 20 && medida.entreP95 <= 34)) problemas.push(`el navegador no va a 60 fotogramas: ${comoTexto(medida)}`);

    // A los 900 s, los 100 residentes esperan su resultado: una insignia.
    const a900 = await page.salta(900);
    const esperan = a900.insignias.find(i => i.element === 'Esperar_Resultado' && i.zone === 'entry');
    if (!esperan || esperan.executions !== '100' || esperan.cases !== '100') problemas.push(`a los 900 s: ${comoTexto(a900.insignias)}`);
    if (a900.dibujo.filter(d => d.includes('scene-ball') && d.includes('"element":"Esperar_Resultado"')).length) {
      problemas.push('a los 900 s se dibujan pelotas en Esperar_Resultado, ademas de la insignia');
    }
    informa('cargado de disco, con fluidez', [ ...problemas, ...page.incidencias ], `40, 101 casos: ${medida.fotogramas} fotogramas a x50, ` +
      `cada uno en ${medida.mediana.toFixed(1)} ms (p95 ${medida.p95.toFixed(1)}), uno cada ${medida.entre.toFixed(1)} ms; ` +
      `a los 900 s, una insignia de ${esperan?.executions}`);
    await page.close();
  }

  // 5. Recursos y resultados historicos, con el diagrama cambiado.
  {
    const problemas = [];
    const page = await pagina();
    const original = diagramaDe(CIEN);
    const simulados = conHuella(de40, sha256(original));
    const cambiado = original.replace(/<participantWithoutLane:userWithoutRole>Carlos<\/participantWithoutLane:userWithoutRole>\s*/g, '')
      .replace(/<user:userTask>Carlos<\/user:userTask>\s*/g, '').replace(/percentageOfBranches="60"/, 'percentageOfBranches="10"')
      .replace(/percentageOfBranches="40"/, 'percentageOfBranches="90"');
    if (cambiado === original || cambiado.includes('>Carlos<')) problemas.push('el diagrama no ha cambiado');
    const visto = await page.carga(ficherosDe(simulados, cambiado));
    if (!visto.abierta || !/no es el que se simuló/.test(visto.estado)) problemas.push(`al cargar: «${visto.estado}»`);
    const sacu = visto.plantillas.find(p => p.pool === 'Pool_SACU');
    if (!sacu || comoTexto(sacu.gente) !== comoTexto([ 'Ana', 'Bea', 'Carlos' ])) problemas.push(`la plantilla: ${comoTexto(sacu)}`);
    const fin = await page.salta(100000);
    const previsto = finales(de40);
    const texto = `fin: Aceptada ${previsto.Fin_Aceptada}, Rechazada sin reclamar ${previsto.Fin_Rechazada}, Reevaluada ${previsto.Fin_Reclamada}`;
    if (!fin.resumen.includes(texto)) problemas.push(`al final: «${fin.resumen}», y el registro dice «${texto}»`);
    informa('recursos y resultados del registro', [ ...problemas, ...page.incidencias ], `con el diagrama cambiado, avisa; Carlos sigue en la ` +
      `plantilla y «${texto}»`);
    await page.close();
  }

  // 6. Simulado, guardado y cargado otra vez: el mismo estado.
  {
    const problemas = [];
    const page = await pagina();
    await page.evaluate(texto => sessionStorage.setItem('importedDiagram', texto), diagramaDe(CIEN));
    await page.reload();
    await page.waitForSelector('.djs-element[data-element-id="Pool_SACU"]');
    const cabeceras = { 'Access-Control-Allow-Origin': '*' };
    await page.route('http://localhost:3000/simulation-config', r => r.fulfill({ json: { timeoutSeconds: 300 }, headers: cabeceras }));
    await page.route('http://localhost:3000/simulate', async r => {
      const { diagramXML } = JSON.parse(r.request().postData());
      const logs = conHuella(de40, sha256(diagramXML)).map(({ pool, name, xes }) => ({ pool, name, xes }));
      await r.fulfill({ json: { simulationId: atributo(logs[0].xes, 'simulation:id'), seed: 20260101, model: { name: atributo(logs[0].xes, 'model:name') },
        logs, warnings: [] }, headers: cabeceras });
    });
    await page.click('#js-simulate');
    await page.waitForSelector('.modal-overlay', { state: 'visible' });
    // Guardarla: el diagrama y todos los registros, como los descarga la ventana.
    const descargas = [];
    page.on('download', d => descargas.push(d));
    await page.click('#download-diagram');
    await page.click('#download-all-logs');
    for (let i = 0; i < 100 && descargas.length < 3; i++) await page.waitForTimeout(100);
    const guardados = [];
    for (const d of descargas) guardados.push(fichero(d.suggestedFilename(), readFileSync(await d.path(), 'utf8')));
    await page.click('#close-modal');
    if (guardados.length !== 3) problemas.push(`se han guardado ${guardados.length} ficheros`);
    await page.click('#js-replay');
    const instantes = [ 0, 150, 450, 900, 1500, 1825 ];
    const antes = [];
    for (const t of instantes) antes.push(await page.salta(t));
    if (!/Simulación completada/.test(antes[0].estado) || /no es el que|sin diagrama/.test(antes[0].estado)) problemas.push(`al simular: «${antes[0].estado}»`);

    const otra = await pagina();
    const cargada = await otra.carga(guardados);
    if (!cargada.abierta || /no es el que|sin diagrama/.test(cargada.estado)) problemas.push(`al cargarla otra vez: «${cargada.estado}»`);
    for (const [ i, t ] of instantes.entries()) {
      const despues = await otra.salta(t);
      const quita = v => ({ ...v, estado: null });
      if (comoTexto(quita(despues)) !== comoTexto(quita(antes[i]))) {
        const distinto = despues.dibujo.find(d => !antes[i].dibujo.includes(d)) || despues.resumen;
        problemas.push(`a los ${t} s, otro estado: ${String(distinto).slice(0, 160)}`);
      }
    }
    // Y guardada otra vez desde la pagina en la que se ha cargado, son los
    // mismos ficheros, byte a byte.
    await otra.click('#replay-exit');
    await otra.click('#js-continue');
    await otra.waitForSelector('.modal-overlay', { state: 'visible' });
    const otraVez = [];
    otra.on('download', d => otraVez.push(d));
    await otra.click('#download-diagram');
    await otra.click('#download-all-logs');
    for (let i = 0; i < 100 && otraVez.length < 3; i++) await otra.waitForTimeout(100);
    const regrabados = [];
    for (const d of otraVez) regrabados.push(fichero(d.suggestedFilename(), readFileSync(await d.path(), 'utf8')));
    const porNombre = lista => comoTexto([ ...lista ].sort((x, y) => x.name.localeCompare(y.name)));
    if (porNombre(regrabados) !== porNombre(guardados)) problemas.push(`guardada otra vez, otros ficheros: ${regrabados.map(f => f.name).join(', ')}`);
    await otra.click('#close-modal');
    const nombres = guardados.map(g => g.name).sort();
    informa('guardada y cargada otra vez', [ ...problemas, ...page.incidencias, ...otra.incidencias ], `${nombres.join(', ')}: ` +
      `el mismo estado a los ${instantes.join(', ')} s, el diagrama es el simulado, y guardada otra vez, los mismos ficheros`);
    await page.close();
    await otra.close();
  }

  // 7. Lo que no vale no se carga.
  {
    const problemas = [];
    const page = await pagina();
    const abierto = () => page.evaluate(() => [ ...document.querySelectorAll('.djs-element') ].map(e => e.dataset.elementId).sort().join());
    const antes = await abierto();
    const mezclado = [ fichero(de40[0].fileName, de40[0].xes), fichero(de39[1].fileName, de39[1].xes), fichero(`${CIEN}.bpmn`, diagramaDe(CIEN)) ];
    const casos = [
      [ 'uno solo de un modelo de dos', [ fichero(de40[0].fileName, de40[0].xes), fichero(`${CIEN}.bpmn`, diagramaDe(CIEN)) ], /Un solo registro basta/ ],
      [ 'uno de otra simulacion', mezclado, /no es de la misma simulación/ ],
      [ 'uno repetido', [ ...ficherosDe(de40), fichero('copia.xes', de40[0].xes) ], /está duplicado/ ],
      [ 'dos simulaciones pegadas en un fichero', [ fichero(de40[0].fileName, de40[0].xes + cambia(de40[0], /key="simulation:id" value="([^"]*)"/,
        'key="simulation:id" value="otra"').xes), fichero(de40[1].fileName, de40[1].xes), fichero(`${CIEN}.bpmn`, diagramaDe(CIEN)) ],
        /está mal formado: .*mas de un elemento raiz/ ],
      [ 'los de otro modelo', ficherosDe(de39, diagramaDe(CIEN)), /no tiene el pool Pool_Comision/ ],
      [ 'un fichero que no es ni XES ni BPMN', [ ...ficherosDe(de40), fichero('notas.txt', 'hola') ], /No se sabe qué es «notas.txt»/ ],
      [ 'un .bpmn que no es un diagrama', [ ...ficherosDe(de40), fichero('diagrama.bpmn', de40[0].xes) ], /No se puede leer el diagrama «diagrama.bpmn»/ ],
      [ 'un .bpmn sin nada que dibujar', [ ...ficherosDe(de40), fichero('diagrama.bpmn', diagramaDe(CIEN).replace(/\n *<bpmndi:BPMNDiagram[\s\S]*<\/bpmndi:BPMNDiagram>/, '')) ],
        /No se puede leer el diagrama «diagrama.bpmn»: no tiene ningún diagrama que dibujar/ ],
      [ 'un diagrama sin una tarea', ficherosDe(de40, sinForma(diagramaDe(CIEN), 'Esperar_Resultado')), /no tiene un elemento por los que pasan .*Esperar_Resultado/ ],
      [ 'unos que pasan pero no se pueden reproducir', ficherosDe([ cambia(de40[1], /\n *<date key="time:timestamp" value="[^"]*" \/>/, ''), de40[0] ], diagramaDe(CIEN)),
        /Los registros no se pueden reproducir: .*time:timestamp/ ],
      [ 'un .bpmn con dos diagramas, el primero sin una tarea',
        ficherosDe(de40, conOtroDiagrama(diagramaDe(CIEN), { primero: dibujo => sinForma(dibujo, 'Esperar_Resultado') })),
        /no tiene un elemento por los que pasan .*Esperar_Resultado/ ],
      [ 'un .bpmn con una entidad que no se lee', ficherosDe(de40, diagramaDe(CIEN).replace('name="Proceso base"', 'name="Proceso&nbsp;base"')),
        /No se puede leer el diagrama .*entidad desconocida/ ],
      [ 'un modelo con Scheduler', ficherosDe(de40, diagramaDe(CIEN).replace('<bpmn:task id="Rellenar_Formulario"',
        '<bpmn:task isScheduler="true" id="Rellenar_Formulario"')), /Scheduler, que ya no está disponible/ ]
    ];
    for (const [ que, ficheros, previsto ] of casos) {
      const visto = await page.carga(ficheros);
      const mensaje = await page.evaluate(() => document.getElementById('simulation-results').textContent);
      if (visto.abierta || !previsto.test(mensaje) || !/No se han cargado/.test(visto.estado)) problemas.push(`${que}: «${mensaje}» y «${visto.estado}»`);
      if (await page.isVisible('#close-modal')) await page.click('#close-modal');
      if (visto.abierta) await page.click('#replay-exit');
    }
    // Sin cerrar el diagrama que estaba abierto, aunque vinieran con otro, ni
    // dejar nada que reproducir.
    if (await abierto() !== antes) problemas.push('al no cargarlos, ha cambiado el diagrama abierto');
    const botones = await page.evaluate(() => [ 'js-replay', 'js-continue' ].filter(id => !document.getElementById(id).disabled));
    if (botones.length) problemas.push(`al no cargarlos, se han activado ${botones.join(', ')}`);

    // Arrastrados al lienzo, se cargan igual.
    await page.evaluate(ficheros => {
      const datos = new DataTransfer();
      for (const f of ficheros) datos.items.add(new File([ f.text ], f.name, { type: 'application/xml' }));
      document.getElementById('canvas').dispatchEvent(new DragEvent('drop', { dataTransfer: datos, bubbles: true, cancelable: true }));
    }, ficherosDe(de40, diagramaDe(CIEN)));
    await page.waitForFunction(() => !document.getElementById('replay').hidden);
    await page.click('#replay-exit');

    // Sin su diagrama, sobre el abierto: como no se sabe si es el simulado, no
    // se ofrece descargarlo como tal.
    const sinBpmn = await page.carga(ficherosDe(de40));
    if (!sinBpmn.abierta || !/se simularon sin diagrama/.test(sinBpmn.estado)) problemas.push(`sin su diagrama: «${sinBpmn.estado}»`);
    await page.click('#replay-exit');
    await page.click('#js-continue');
    await page.waitForSelector('.modal-overlay', { state: 'visible' });
    if (await page.isVisible('#download-diagram')) problemas.push('sin su diagrama, se ofrece descargar el abierto como el simulado');
    await page.click('#close-modal');

    // Una respuesta del Backend que no es del diagrama abierto -los registros
    // del 39 para el 40- no se puede reproducir, y se dice por que.
    const cabeceras = { 'Access-Control-Allow-Origin': '*' };
    await page.route('http://localhost:3000/simulation-config', r => r.fulfill({ json: { timeoutSeconds: 300 }, headers: cabeceras }));
    await page.route('http://localhost:3000/simulate', async r => {
      await new Promise(listo => setTimeout(listo, 1500));
      await r.fulfill({ json: { simulationId: 'x', seed: 1, model: { name: 'x' },
        logs: de39.map(({ pool, name, xes }) => ({ pool, name, xes })), warnings: [] }, headers: cabeceras });
    });
    await page.click('#js-simulate');

    // Mientras se simula no se cargan otros, y se dice por que.
    await page.waitForFunction(() => document.getElementById('simulation-status').dataset.state === 'running');
    const durante = await page.carga(ficherosDe(de40, diagramaDe(CIEN)));
    const porQue = await page.evaluate(() => document.getElementById('simulation-results').textContent);
    if (durante.abierta || !/Se está simulando/.test(porQue)) problemas.push(`cargados mientras se simula: «${porQue}»`);
    if (await page.isVisible('#close-modal')) await page.click('#close-modal');
    await page.waitForFunction(() => document.getElementById('simulation-status').dataset.state !== 'running', null, { timeout: 15000 })
      .catch(() => problemas.push('la simulacion no termina'));
    if (await page.isVisible('#close-modal')) await page.click('#close-modal');
    const tras = await page.evaluate(() => ({ reproducir: document.getElementById('js-replay').disabled,
      estado: document.getElementById('simulation-status').textContent }));
    if (!tras.reproducir || !/No se puede reproducir: .*no tiene el pool/.test(tras.estado)) problemas.push(`la respuesta de otro modelo: ${comoTexto(tras)}`);

    // Cargada, si se quita del diagrama una tarea por la que pasan sus casos, ya
    // no se reproduce sobre el, y se dice por que.
    const otraVez = await page.carga(ficherosDe(de40, diagramaDe(CIEN)));
    if (!otraVez.abierta) {
      problemas.push(`no se carga otra vez: «${otraVez.estado}»`);
    } else {
      await page.click('#replay-exit');
      // En una esquina: por el medio pasa un flujo de mensaje.
      await page.click('.djs-element[data-element-id="Esperar_Resultado"] .djs-hit', { position: { x: 6, y: 6 } });
      await page.click('.djs-context-pad .entry[data-action="delete"]');
      await page.waitForSelector('.djs-element[data-element-id="Esperar_Resultado"]', { state: 'detached' });
      await page.click('#js-replay');
      const quitada = await page.evaluate(() => ({ barra: !document.getElementById('replay').hidden,
        estado: document.getElementById('simulation-status').textContent }));
      if (quitada.barra || !/No se puede reproducir: .*Esperar_Resultado/.test(quitada.estado)) problemas.push(`sin una tarea: ${comoTexto(quitada)}`);
    }
    informa('lo que no vale no se carga', [ ...problemas, ...page.incidencias ], `${casos.length} conjuntos rechazados diciendo por que, ` +
      'sin cerrar el diagrama abierto ni activar Reproducir; arrastrados, se cargan; sin su diagrama, no se ofrece el abierto; ' +
      'mientras se simula, no se cargan; una respuesta de otro modelo no se reproduce; ' +
      'y quitada una tarea por la que pasan, tampoco');
    await page.close();
  }
} finally {
  await navegador.close();
  servidor.cierra();
  rmSync(dist, { recursive: true, force: true });
}

console.log(fallos ? `\nCarga en rojo: ${fallos} problema(s).` : `\nCarga en verde: ${carpetas.length} modelos.`);
process.exit(fallos ? 1 : 0);