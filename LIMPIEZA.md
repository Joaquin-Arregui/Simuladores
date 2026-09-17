# Alcance de la limpieza

## Funciones conservadas

Edición BPMN, parámetros de simulación, usuarios, roles y ejecución del motor
Python. El editor conserva sus proveedores y descriptores de simulación.

## Funciones retiradas

- Modeler: chatbot, mapa de calor, Scheduler/CSV, biblioteca antigua de tokens,
  demos compiladas y sus herramientas exclusivas. Dependencias directas de 57 a 22.
- Backend: chatbot, mapa de calor, Scheduler/CSV y `server2.py`. Dependencias
  directas: SimPy, Flask y Flask-CORS.

Webpack genera y limpia únicamente `Modeler/example/dist`. Cada simulación
Python se ejecuta con el intérprete del servidor en una carpeta temporal propia,
que se elimina al terminar. La respuesta contiene el XES en `simulation`.

## Correcciones del motor y la interfaz

- Las uniones llevan el control de las llegadas por flujo y por instancia, y
  pueden activarse varias veces. Una ejecución incompleta produce un error.
- Los mensajes utilizan un formato común, se consumen una vez y se esperan sin
  detener el lanzamiento de otros inicios o instancias.
- El proceso de simulación tiene un límite configurable de 300 segundos. El
  Modeler muestra los fallos y conserva el último resultado correcto.
- Se validan las reglas y el XML original antes de simular. Los elementos y
  comportamientos BPMN no implementados se rechazan con una explicación.

El alcance y la API se describen en [Backend/README.md](Backend/README.md).
La nueva suite de pruebas queda a cargo del usuario; esta corrección no crea ni
modifica suites. Los antiguos informes de pruebas no sustituyen la validación
de este estado del proyecto.

Comprobaciones puntuales realizadas sin crear suites: sintaxis Python, ESLint,
compilación del Modeler, uniones paralelas/inclusivas y ciclos, consumo de mensajes,
asignaciones de usuarios en los ocho tipos de tarea y respuestas HTTP de error.
También se comprobó el recorrido real en Chrome hasta Python, el bloqueo del
doble envío y la conservación del último resultado ante errores. La compilación
mantiene los avisos de Webpack sobre el tamaño del bundle.

## Respaldo

`.cleanup-backup/before-simulator-fixes.zip` contiene el estado anterior a estas
correcciones, sin dependencias instaladas, cachés, `.git` ni bundles compilados.
La carpeta está excluida de Git. Para recuperar código, extrae lo necesario a
otra carpeta y compáralo antes de reemplazarlo. No se han creado commits.
