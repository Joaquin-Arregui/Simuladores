# SimBPMN

Modelador BPMN web y simulador Python.

## Inicio

Instala Node.js 18.12 o superior con npm y Python 3.10 o superior. En Windows, ejecuta `start.bat` desde la raíz para instalar dependencias y arrancar ambos servicios.

También puedes iniciarlos por separado en dos terminales:

```sh
cd Modeler
npm install
npm start
```

```sh
cd Backend
pip install -r requirements.txt
python server.py
```

El modelador se sirve en `http://localhost:9000` y el Backend en `http://localhost:3000`. Consulta [la documentación del modelador](Modeler/README.md) y [la del Backend](Backend/README.md) para instalarlos, probarlos y conocer las funciones disponibles.

La aplicación conserva edición BPMN, parámetros, usuarios/roles y simulación. Se han retirado chatbot, mapa de calor y Scheduler tanto del Modeler como del Backend, además de las demos de animación de tokens y el ejecutor de experimentos `server2.py`.

Cada simulación dispone de 5 minutos de tiempo real, configurables en el Backend
con `SIMULATION_TIMEOUT_SECONDS`. El modelador muestra los errores de ejecución
y las funciones BPMN no soportadas. La nueva suite de pruebas se creará por separado.
