// El color de cada caso (6.5): constante de principio a fin y distinto del de
// los demas casos de su pool. Va por el numero del caso dentro de su pool: el
// caso 1 de cada pool tiene el mismo color, y se distinguen por el pool en el
// que estan. Lo llevan sus pelotas, en todas sus piezas -tambien a la salida- y
// los sobres de los que es la solicitud.
//
// Los ocho primeros son la paleta categorica de referencia de la guia de
// visualizacion, en su orden, que esta validada contra el fondo blanco del
// lienzo: lo bastante separados, tambien con daltonismo, entre vecinos. A partir
// del noveno se generan: en OKLCH, con la luminosidad y el croma de esa paleta
// y el tono girando el angulo aureo, para que ninguno se repita. Son distintos,
// pero cada vez mas parecidos entre si; lo que identifica al caso sigue siendo
// su numero, en la pelota y debajo del sobre, y el color ayuda a seguirlo.
//
// Sin dependencias del navegador: lo usan la vista y las pruebas.

export const PALETTE = [
  '#2a78d6', // azul
  '#eb6834', // naranja
  '#1baf7a', // aguamarina
  '#eda100', // amarillo
  '#e87ba4', // magenta
  '#008300', // verde
  '#6250d6', // violeta
  '#e34948' // rojo
];

// El color sin caso: un sobre o una insignia de varios casos.
export const NEUTRAL = '#ffffff';

export const INK = '#22242a';

// -- La aritmetica del color: la de la guia de visualizacion -------------------

const s2lin = c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const lin2s = c => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const hex2 = n => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0');
const linOf = hex => [ 1, 3, 5 ].map(i => s2lin(parseInt(hex.slice(i, i + 2), 16) / 255));

function oklabFromLin([ r, g, b ]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
  ];
}

// Daltonismo rojo y verde, de Machado, Oliveira y Fernandes (2009), severidad 1.
const CVD = {
  protan: [ [ 0.152286, 1.052583, -0.204868 ], [ 0.114503, 0.786281, 0.099216 ], [ -0.003882, -0.048116, 1.051998 ] ],
  deutan: [ [ 0.367322, 0.860646, -0.227968 ], [ 0.280085, 0.672501, 0.047413 ], [ -0.011820, 0.042940, 0.968881 ] ]
};
const simulate = (rgb, m) => m.map(row => Math.max(0, Math.min(1, row[0] * rgb[0] + row[1] * rgb[1] + row[2] * rgb[2])));

// La distancia entre dos colores en OKLab, por 100: con vision normal o, con
// `kind`, como la ve una persona con ese daltonismo.
export function deltaE(a, b, kind) {
  const [ x, y ] = [ a, b ].map(hex => oklabFromLin(kind ? simulate(linOf(hex), CVD[kind]) : linOf(hex)));
  return 100 * Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}
const cvdDeltaE = (a, b) => Math.min(deltaE(a, b, 'protan'), deltaE(a, b, 'deutan'));

// OKLCH a hexadecimal, o null si se sale de sRGB.
function oklchToHex(l, c, h) {
  const a = c * Math.cos(h * Math.PI / 180);
  const b = c * Math.sin(h * Math.PI / 180);
  const l1 = Math.pow(l + 0.3963377774 * a + 0.2158037573 * b, 3);
  const m1 = Math.pow(l - 0.1055613458 * a - 0.0638541728 * b, 3);
  const s1 = Math.pow(l - 0.0894841775 * a - 1.2914855480 * b, 3);
  const rgb = [
    4.0767416621 * l1 - 3.3077115913 * m1 + 0.2309699292 * s1,
    -1.2684380046 * l1 + 2.6097574011 * m1 - 0.3413193965 * s1,
    -0.0041960863 * l1 - 0.7034186147 * m1 + 1.7076147010 * s1
  ];
  if (rgb.some(v => v < 0 || v > 1)) return null;
  return `#${rgb.map(v => hex2(lin2s(v) * 255)).join('')}`;
}

function luminance(hex) {
  const [ r, g, b ] = linOf(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const [ x, y ] = [ luminance(a), luminance(b) ].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

// La tinta que mejor se lee sobre un color: la oscura o la blanca.
export function inkOn(fill) {
  return contrast(fill, INK) >= contrast(fill, '#ffffff') ? INK : '#ffffff';
}

// -- Los colores a partir del noveno -------------------------------------------

// Los candidatos, en un orden fijo: el tono gira el angulo aureo y la
// luminosidad alterna tres niveles de la banda de la paleta.
const GOLDEN = 137.50776405003785;
const LIGHTNESS = [ 0.62, 0.52, 0.70 ];
const CHROMA = 0.14;
function candidate(k) {
  const h = (25 + k * GOLDEN) % 360;
  const l = LIGHTNESS[k % LIGHTNESS.length];
  for (let c = CHROMA; c >= 0.12 - 1e-9; c -= 0.005) {
    const hex = oklchToHex(l, c, h);
    if (hex) return hex;
  }
  return null;
}

// Lo que se le pide a un color nuevo frente a los dos casos anteriores, que son
// los que mas probablemente estan a la vez en pantalla: las cotas de la guia
// -15 con vision normal y 8 con daltonismo frente al anterior, con margen-, y
// que su numero se lea. Si ningun candidato las cumple, se relajan poco a poco:
// el color tiene que existir y no repetirse.
const DEMANDS = [
  { normal: 20, cvd: 8, before: 15, ink: 4 },
  { normal: 15, cvd: 6, before: 10, ink: 3.5 },
  { normal: 10, cvd: 4, before: 6, ink: 3 },
  { normal: 0, cvd: 0, before: 0, ink: 0 }
];
const TRIES = 400;

const colors = [ ...PALETTE ];
const used = new Set(colors);
let next = 0;

function grow() {
  const previous = colors[colors.length - 1];
  const earlier = colors[colors.length - 2];
  for (const demand of DEMANDS) {
    for (let k = next; k < next + TRIES; k++) {
      const hex = candidate(k);
      if (!hex || used.has(hex)) continue;
      if (deltaE(hex, previous) < demand.normal || cvdDeltaE(hex, previous) < demand.cvd) continue;
      if (deltaE(hex, earlier) < demand.before || contrast(hex, inkOn(hex)) < demand.ink) continue;
      next = k + 1;
      return hex;
    }
  }
  throw new Error('No queda ningun color nuevo.');
}

// El color del caso n de un pool (n >= 1); sin numero, el neutro. El mismo
// numero da siempre el mismo color, y dos numeros distintos, dos colores
// distintos: se construyen en orden, y cada uno se guarda.
export function caseColor(number) {
  if (!Number.isInteger(number) || number < 1) return NEUTRAL;
  while (colors.length < number) {
    const hex = grow();
    colors.push(hex);
    used.add(hex);
  }
  return colors[number - 1];
}

// Un color aclarado hacia el blanco, para el fondo de una insignia.
export function tint(hex, amount = 0.78) {
  const parts = [ 1, 3, 5 ].map(i => parseInt(hex.slice(i, i + 2), 16));
  return `#${parts.map(c => hex2(c + (255 - c) * amount)).join('')}`;
}
