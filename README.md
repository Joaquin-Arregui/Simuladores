# SimBPMN

Modelador BPMN web y simulador Python.

## Inicio

Instala Node.js 18.12 o superior con npm y Python 3.10 o superior. En Windows, ejecuta `start.bat` desde la raíz para instalar dependencias y arrancar ambos servicios; el Backend usa el entorno virtual `Backend\.venv`, que se crea si no existe.

También puedes iniciarlos por separado en dos terminales:

```sh
cd Modeler
npm install
npm start
```

```sh
cd Backend
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt
.venv/Scripts/python server.py
```

En Linux o macOS, el ejecutable del entorno es `.venv/bin/python`.

El modelador se sirve en `http://localhost:9000` y el Backend en `http://localhost:3000`. Consulta [la documentación del modelador](Modeler/README.md) y [la del Backend](Backend/README.md) para instalarlos y conocer las funciones disponibles.

Para empezar hay un ejemplo listo para abrir en el modelador y simular, el proceso base de la convocatoria: `Modeler/ejemplos/proceso-base.bpmn` ([cómo se dibuja y qué da](Modeler/README.md#el-proceso-base)).

Una vez simulado, **Reproducir** muestra la convocatoria moviéndose sobre el diagrama: las pelotas de los casos, los sobres de los mensajes, las colas de cada tarea y la plantilla de cada pool, con una barra para reproducir, pausar, cambiar la velocidad, elegir la convocatoria, filtrar casos y saltar a un instante exacto ([la reproducción](Modeler/README.md#la-reproducción)). Todo lo que se ve sale de los registros XES de la simulación, no de las reglas actuales. **Descargar todos** y **Descargar el diagrama** guardan una simulación, y **Cargar registros** la vuelve a abrir más tarde, sin Backend, comprobando antes que los registros son todos de la misma simulación y del diagrama ([cargar una simulación guardada](Modeler/README.md#cargar-una-simulación-guardada)).

La aplicación conserva edición BPMN, parámetros, usuarios/roles y simulación. Se han retirado chatbot, mapa de calor y Scheduler tanto del Modeler como del Backend, además de las demos de animación de tokens y el ejecutor de experimentos `server2.py`.

Cada simulación dispone de 5 minutos de tiempo real, configurables en el Backend
con `SIMULATION_TIMEOUT_SECONDS`. El tiempo simulado se mide en segundos y el
registro XES usa fechas ISO 8601. El modelador muestra los errores, los avisos y
las funciones BPMN no soportadas. El proyecto incluye un
[banco de pruebas de regresión](Backend/pruebas/README.md) con modelos y
resultados de referencia. Desde la raíz, ejecútalo con:

```sh
Backend/.venv/Scripts/python -B Backend/pruebas/regresion.py
```

En Linux o macOS, usa `Backend/.venv/bin/python`.

El banco incluye también pruebas del Modeler y del visualizador, varias en un Chromium de verdad (`Backend/pruebas/*.mjs`). Necesitan `npm install` en `Modeler/` y, una vez, `npx playwright install chromium` (o un Chromium ya instalado, con `CHROMIUM_PATH`). Se ejecutan una a una, por ejemplo:

```sh
node Backend/pruebas/reproduccion.mjs
node Backend/pruebas/carga.mjs
```

En [el README del banco](Backend/pruebas/README.md#qué-hay-aquí) está qué comprueba cada una.
