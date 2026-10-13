// Los registros de una simulacion, uno por pool (D10, 5.5): que trae la
// respuesta del Backend y con que nombre se descarga cada uno.
//
// El Backend devuelve en logs un XES por pool, con el ID y el nombre del pool.
// Cada uno se ofrece por separado y se descarga con el nombre de su pool. Un
// nombre puede estar vacio -el parser lo admite- o repetirse en dos pools, y
// puede llevar caracteres que un sistema de ficheros no acepta: entonces se
// usa el ID del pool, que es unico.
//
// Sin dependencias del navegador a proposito: lo usa el Modeler
// (example/src/modeler.js) y, desde Node, Backend/pruebas/valida_bpmn.mjs.

// Lo que Windows no admite en un nombre de fichero -tambien los caracteres de
// control-, ni al final de el.
const NO_VALE = '\\/:*?"<>|';

// Los nombres de dispositivo de Windows. Lo son tambien con cualquier
// extension: Windows mira lo que hay antes del primer punto, asi que
// «Aux. mantenimiento.xes» o «CON.txt.xes» no se pueden crear.
const RESERVADO = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])$/i;

// El nombre de fichero, sin extension, que corresponde a un texto: lo que no
// vale pasa a guion bajo, y a un nombre reservado se le antepone uno; vacio si
// no queda nada.
function asFileName(text) {
  const name = Array.from(String(text || '').trim(), c => (NO_VALE.includes(c) || c.charCodeAt(0) < 32 ? '_' : c))
    .join('').replace(/[. ]+$/, '');
  return RESERVADO.test(name.split('.')[0].trimEnd()) ? `_${name}` : name;
}

export function countTraces(xes) {
  return (xes.match(/<trace[\s>/]/g) || []).length;
}

// Los registros de una respuesta correcta del Backend, en su orden, con el
// fichero de cada uno; si la respuesta no los trae bien, un Error que lo dice.
export function logsFromResponse(data) {
  const logs = data && data.logs;
  const bad = (why) => new Error(`El Backend devolvió una respuesta sin registros válidos: ${why}.`);
  if (!Array.isArray(logs) || !logs.length) {
    throw bad('no trae ninguno');
  }
  const seen = new Set();
  for (const log of logs) {
    if (!log || typeof log.pool !== 'string' || !log.pool || typeof log.name !== 'string'
        || typeof log.xes !== 'string' || !log.xes.trim()) {
      throw bad('uno no tiene el ID del pool, su nombre o su XES');
    }
    if (seen.has(log.pool)) {
      throw bad(`el pool ${log.pool} viene dos veces`);
    }
    seen.add(log.pool);
  }

  // El nombre del pool si es suyo; si no hay, o lo comparte con otro pool, el ID.
  const byName = new Map();
  for (const log of logs) {
    const key = asFileName(log.name).toLowerCase();
    byName.set(key, (byName.get(key) || 0) + 1);
  }
  const used = new Set();
  return logs.map(log => {
    const own = asFileName(log.name);
    let base = own && byName.get(own.toLowerCase()) === 1 ? own : (own ? `${own} (${asFileName(log.pool)})` : asFileName(log.pool));

    // Un nombre de pool que coincide con el ID de otro: se distingue con un numero.
    for (let n = 2; used.has(base.toLowerCase()); n++) {
      base = `${own || asFileName(log.pool)} (${n})`;
    }
    used.add(base.toLowerCase());

    // Como se nombra en pantalla: con el ID si no tiene nombre o lo comparte.
    const name = log.name.trim();
    const label = !name ? log.pool : (byName.get(own.toLowerCase()) === 1 ? name : `${name} (${log.pool})`);
    return {
      pool: log.pool,
      name: log.name,
      label,
      xes: log.xes,
      fileName: `${base}.xes`,
      cases: countTraces(log.xes),
      bytes: new TextEncoder().encode(log.xes).length
    };
  });
}

// Lo que se ensena de un XES en pantalla: entero si es corto; si no, el
// principio, para no bloquear la pagina con varios megas de texto.
export function preview(xes, limit = 200000) {
  return xes.length <= limit ? { text: xes, truncated: false } : { text: xes.slice(0, limit), truncated: true };
}
