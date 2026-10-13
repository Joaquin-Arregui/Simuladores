// Los numeros de los paneles (5.3): que texto vale, como se lee y como se
// muestra lo guardado.
//
// Lo que se guarda en el .bpmn lo escribe JavaScript, y JavaScript escribe con
// exponente los numeros menores que 1e-6 y los de 1e21 en adelante: una
// frecuencia de 0.0000001 se guarda como 1e-7. Por eso un numero con decimales
// se acepta tambien con exponente -si no, lo que el propio panel acaba de
// guardar volveria marcado como invalido-, y al mostrarlo se escribe sin
// exponente cuando se puede sin perder nada.
//
// Sin dependencias a proposito: lo usan los paneles y, desde Node,
// Backend/pruebas/valida_bpmn.mjs.

const INTEGER = /^\d+$/;
const DECIMAL = /^\d+(\.\d+)?([eE][+-]?\d+)?$/;

// null si el texto vale; si no, por que: 'format', 'minimum' o 'maximum' (un
// entero que JavaScript no guarda exacto, o un numero que no es finito).
export function checkNumber(text, { integer = false, minimum = 0 } = {}) {
  if (!(integer ? INTEGER : DECIMAL).test(text)) {
    return 'format';
  }
  const value = Number(text);
  if (integer ? !Number.isSafeInteger(value) : !Number.isFinite(value)) {
    return 'maximum';
  }
  return value < minimum ? 'minimum' : null;
}

export function parseNumber(text, { integer = false } = {}) {
  return integer ? parseInt(text, 10) : parseFloat(text);
}

// Un numero como texto, sin exponente si se puede escribir exacto: 1e-7 se
// muestra 0.0000001. toFixed admite hasta 100 decimales y desde 1e21 vuelve a
// usar exponente; en esos casos se deja como lo escribe JavaScript, que
// checkNumber tambien acepta.
export function formatNumber(value) {
  const text = String(value);
  if (!/e/i.test(text) || !Number.isFinite(value) || Math.abs(value) >= 1e21) {
    return text;
  }
  for (let digits = 1; digits <= 100; digits++) {
    const fixed = value.toFixed(digits);
    if (Number(fixed) === value) {
      return fixed;
    }
  }
  return text;
}
