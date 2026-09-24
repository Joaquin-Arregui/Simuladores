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

La aplicación conserva edición BPMN, parámetros, usuarios/roles y simulación. Se han retirado chatbot, mapa de calor y Scheduler tanto del Modeler como del Backend, además de las demos de animación de tokens y el ejecutor de experimentos `server2.py`.

Cada simulación dispone de 5 minutos de tiempo real, configurables en el Backend
con `SIMULATION_TIMEOUT_SECONDS`. El tiempo simulado se mide en segundos y el
registro XES usa fechas ISO 8601. El modelador muestra los errores, los avisos y
las funciones BPMN no soportadas. Por ahora el proyecto no incluye pruebas
automáticas.
