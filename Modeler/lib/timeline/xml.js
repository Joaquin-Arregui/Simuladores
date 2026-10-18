// Un lector de XML minimo para los registros XES (6.1): elementos, atributos y
// nada mas. Un XES no lleva texto con significado -todo va en los atributos
// key y value-, asi que el texto entre etiquetas se descarta.
//
// Sin dependencias a proposito: en el navegador habria DOMParser, pero
// Backend/pruebas/linea_de_tiempo.mjs lo usa desde Node, y los dos tienen que
// leer el mismo registro de la misma manera. Los nombres de las etiquetas se
// quedan sin prefijo -`xes:event` es `event`-, porque un XES valido puede
// llevar el espacio de nombres declarado con prefijo o sin el. El prefijo se
// guarda aparte (`prefix`), para quien quiera saber en que espacio esta.
//
// Lo que si comprueba es que es un documento entero (6.8): un solo elemento
// raiz, y fuera de el nada mas que espacios, comentarios, la declaracion y el
// DOCTYPE. Dos XES pegados en un fichero no son un registro: quedarse con el
// primero descartaba el segundo sin decir nada, y el Backend lo rechaza como
// XML mal formado.

const ENTIDADES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: '\'' };

function decodifica(texto) {
  return texto.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-z]+);/g, (entera, nombre) => {
    if (nombre[0] === '#') {
      const codigo = nombre[1] === 'x' ? parseInt(nombre.slice(2), 16) : parseInt(nombre.slice(1), 10);
      return String.fromCodePoint(codigo);
    }
    if (!(nombre in ENTIDADES)) throw new Error(`XML mal formado: entidad desconocida ${entera}.`);
    return ENTIDADES[nombre];
  });
}

const sinPrefijo = nombre => nombre.slice(nombre.indexOf(':') + 1);

// El > que cierra la etiqueta que empieza en `desde`, sin contar los que vayan
// dentro de un valor entre comillas.
function finDeEtiqueta(texto, desde) {
  let comilla = null;
  for (let i = desde + 1; i < texto.length; i++) {
    const c = texto[i];
    if (comilla) {
      if (c === comilla) comilla = null;
    } else if (c === '"' || c === '\'') {
      comilla = c;
    } else if (c === '>') {
      return i;
    }
  }
  throw new Error('XML mal formado: una etiqueta no se cierra.');
}

// Hasta donde llega lo que empieza en `desde` y termina en `fin`.
function salta(texto, desde, fin) {
  const hasta = texto.indexOf(fin, desde);
  if (hasta < 0) throw new Error(`XML mal formado: falta ${fin}.`);
  return hasta + fin.length;
}

const ATRIBUTO = /([^\s=/]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

// Lo que hay entre dos etiquetas fuera del elemento raiz: solo espacios.
function fueraDeLaRaiz(texto) {
  if (texto.trim()) throw new Error(`XML mal formado: hay texto fuera del elemento raiz: «${texto.trim().slice(0, 40)}».`);
}

// El documento como arbol de { name, prefix, attrs, children }: un nodo
// '#document' con su unico elemento raiz. Un Error si no es un documento XML.
export function parseXml(texto) {
  const raiz = { name: '#document', attrs: {}, children: [] };
  const pila = [ raiz ];
  let i = 0;
  while (i < texto.length) {
    const abre = texto.indexOf('<', i);
    if (pila.length === 1) fueraDeLaRaiz(texto.slice(i, abre < 0 ? texto.length : abre));
    if (abre < 0) break;
    if (texto.startsWith('<!--', abre)) {
      i = salta(texto, abre + 4, '-->');
      continue;
    }
    if (texto.startsWith('<?', abre)) {
      i = salta(texto, abre + 2, '?>');
      continue;
    }
    if (texto.startsWith('<![CDATA[', abre)) {
      i = salta(texto, abre + 9, ']]>');
      continue;
    }
    const cierra = finDeEtiqueta(texto, abre);
    const dentro = texto.slice(abre + 1, cierra);
    i = cierra + 1;
    if (dentro.startsWith('!')) continue; // <!DOCTYPE ...>
    if (dentro.startsWith('/')) {
      const nombre = sinPrefijo(dentro.slice(1).trim());
      const abierto = pila.pop();
      if (pila.length === 0 || abierto.name !== nombre) {
        throw new Error(`XML mal formado: </${nombre}> no cierra lo que esta abierto.`);
      }
      continue;
    }
    const solo = dentro.endsWith('/');
    const cuerpo = solo ? dentro.slice(0, -1) : dentro;
    const nombre = (/^[^\s/>]+/.exec(cuerpo) || [])[0];
    if (!nombre) throw new Error('XML mal formado: una etiqueta sin nombre.');
    const attrs = {};
    for (const [ , clave, doble, simple ] of cuerpo.slice(nombre.length).matchAll(ATRIBUTO)) {
      attrs[clave] = decodifica(doble ?? simple);
    }
    const prefijo = nombre.includes(':') ? nombre.slice(0, nombre.indexOf(':')) : null;
    const elemento = { name: sinPrefijo(nombre), prefix: prefijo, attrs, children: [] };
    if (pila.length === 1 && raiz.children.length) {
      throw new Error(`XML mal formado: hay mas de un elemento raiz: <${elemento.name}> despues de <${raiz.children[0].name}>.`);
    }
    pila[pila.length - 1].children.push(elemento);
    if (!solo) pila.push(elemento);
  }
  if (pila.length !== 1) throw new Error(`XML mal formado: <${pila[pila.length - 1].name}> no se cierra.`);
  if (!raiz.children.length) throw new Error('XML mal formado: no tiene ningun elemento.');
  return raiz;
}
