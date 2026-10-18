// Lo que comparten las pruebas en navegador del banco (interfaz.mjs,
// capa_de_dibujo.mjs, escena.mjs, zonas.mjs, colores.mjs, plantilla.mjs,
// reproduccion.mjs, carga.mjs): servir unos ficheros como los serviria cualquier
// servidor, y abrir el Chromium de Playwright.
import { createServer } from 'http';
import { existsSync, readFileSync, statSync } from 'fs';
import { extname, join, sep } from 'path';

const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.eot': 'application/vnd.ms-fontobject', '.map': 'application/json', '.json': 'application/json'
};

// Un servidor de ficheros en un puerto libre de 127.0.0.1. `carpetas` es
// [[prefijo de la URL, carpeta]]: gana el prefijo mas largo, y no se sale de
// la carpeta. `paginas`, { ruta: texto }, se sirve tal cual. Devuelve la URL
// base y como cerrarlo.
export async function sirve(carpetas, paginas = {}) {
  const ordenadas = [ ...carpetas ].sort((a, b) => b[0].length - a[0].length);
  const servidor = createServer((peticion, respuesta) => {
    const camino = decodeURIComponent(new URL(peticion.url, 'http://x').pathname);
    if (camino in paginas) {
      respuesta.writeHead(200, { 'Content-Type': TIPOS[extname(camino)] || 'text/html; charset=utf-8' });
      respuesta.end(paginas[camino]);
      return;
    }
    const encontrada = ordenadas.find(([ prefijo ]) => camino.startsWith(prefijo));
    const ruta = encontrada && join(encontrada[1], camino.slice(encontrada[0].length));
    if (!ruta || !ruta.startsWith(encontrada[1] + sep) || !existsSync(ruta) || statSync(ruta).isDirectory()) {
      respuesta.writeHead(404).end();
      return;
    }
    respuesta.writeHead(200, { 'Content-Type': TIPOS[extname(ruta)] || 'application/octet-stream' });
    respuesta.end(readFileSync(ruta));
  });
  await new Promise(listo => servidor.listen(0, '127.0.0.1', listo));
  return { base: `http://127.0.0.1:${servidor.address().port}`, cierra: () => servidor.close() };
}

// El Chromium de Playwright, o el de CHROMIUM_PATH. Si no se puede abrir, un
// Error que dice que hacer.
export async function abreChromium(chromium) {
  // Sin un locale UTF-8, Chromium en Linux llama «download» a cualquier
  // descarga con un acento en el nombre: el Modeler no tiene nada que ver.
  const entorno = { ...process.env };
  if (process.platform !== 'win32' && !/utf-?8/i.test(entorno.LC_ALL || entorno.LANG || '')) {
    entorno.LANG = entorno.LC_ALL = 'C.UTF-8';
  }
  try {
    return await chromium.launch({ env: entorno,
      ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  } catch (error) {
    throw new Error(`No se puede abrir Chromium (${error.message.split('\n')[0]}): npx playwright install ` +
      'chromium en Modeler/, o CHROMIUM_PATH=<ejecutable>.');
  }
}
