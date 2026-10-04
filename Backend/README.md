# Backend de simulación BPMN

Servicio Python que recibe las reglas exportadas por el Modeler y devuelve el
registro de simulación en formato XES. Conserva el motor BPMN, usuarios, roles,
recursos, mensajes y parámetros de simulación.

## Inicio

Con Python 3.10 o superior, desde `Backend`:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe server.py
```

En Linux/macOS, el ejecutable del entorno es `.venv/bin/python`.
El servicio escucha en `http://localhost:3000` y permite las peticiones del
modelador. Las dependencias directas son SimPy, Flask y Flask-CORS.

## API

`GET /simulation-config` devuelve `timeoutSeconds`, el límite de ejecución que
utiliza también el Modeler.

`POST /simulate` recibe un objeto JSON con `content`: el texto de reglas que
exporta el Modeler. El cliente envía además `diagramXML`, que se valida para
detectar elementos y comportamientos BPMN que las reglas no representan. La
ejecución utiliza las reglas. Los clientes que envíen solo reglas reciben la
validación de ese formato, sin la comprobación adicional del XML original.

El campo opcional `seed` fija la semilla de la simulación; ver [Semilla](#semilla).

Una simulación correcta devuelve el XES, los avisos y la semilla usada:

```json
{ "simulation": "<?xml version=\"1.0\" encoding=\"UTF-8\"?>...", "warnings": [], "seed": 2841937403 }
```

`warnings` enumera lo que el simulador ha ignorado para poder ejecutar el modelo,
por ejemplo un flujo por defecto o un pool externo. El Modeler los muestra junto
al resultado.

Los errores devuelven un objeto con el campo `error`:

- **400**: entrada inválida o una función BPMN no soportada, indicando el elemento.
- **422**: la ejecución queda incompleta, por ejemplo por una unión pendiente o
  una espera por un mensaje que nunca llega.
- **504**: se supera el tiempo máximo; el proceso de simulación se detiene.
- **500**: configuración inválida o fallo interno; los detalles internos quedan
  en la consola del servidor.

El motor genera y ejecuta un script en una carpeta temporal independiente para
cada petición, usando el mismo intérprete Python que el servidor. Devuelve el
XES como texto y elimina sus archivos temporales al terminar, también si falla.
No depende del directorio de arranque.
Una tarea sin usuarios elegibles falla con un error en lugar de esperar
indefinidamente por un recurso que no existe.

Se han retirado chatbot, mapa de calor, Scheduler/CSV y `server2.py`. Ya no hay
llamadas a servicios de lenguaje o planificación externa ni se necesitan sus
credenciales. Las reglas antiguas que contienen Scheduler se rechazan.

## Tiempo máximo

El límite predeterminado es de **300 segundos (5 minutos de tiempo real)** por
ejecución del proceso de simulación. No es tiempo simulado. Para cambiarlo, por
ejemplo en experimentos largos, define un entero positivo antes de arrancar el
Backend. Para una hora, en PowerShell:

```powershell
$env:SIMULATION_TIMEOUT_SECONDS = "3600"
.\.venv\Scripts\python.exe server.py
```

Un valor inválido impide simular y devuelve un error de configuración. El
Modeler consulta este límite antes de enviar la simulación. Su espera de red
añade un margen de 15 segundos; una desconexión del navegador no confirma que
el servidor haya cancelado la ejecución.

## Semilla

Toda la aleatoriedad de una simulación sale de una sola semilla: la duración de
cada tarea, la rama de cada compuerta y las repeticiones de los bucles. Con las
mismas reglas, la misma semilla y la misma fecha de inicio
(`SIMULATION_START_DATE`), dos ejecuciones dan exactamente el mismo XES.

La semilla llega en el campo opcional `seed` de `POST /simulate`: un entero entre
0 y 9007199254740991 (el mayor que JavaScript conserva exacto), como número o
como texto. Si falta o llega vacío, el motor genera una entre 0 y 4294967295. En
los dos casos la respuesta la devuelve en `seed` y el XES la guarda como atributo
del log:

```xml
<int key="simulation:seed" value="2841937403"/>
```

Para repetir una simulación basta con volver a enviar esa semilla. El proceso de
simulación se lanza además con `PYTHONHASHSEED=0`, así que tampoco el orden
interno de los conjuntos de Python cambia de una ejecución a otra.

## Ejecución y soporte

Las uniones paralelas esperan una llegada por cada flujo de entrada y consumen
esas llegadas en cada activación, también al repetirse en un ciclo. Las uniones
inclusivas tienen en cuenta las ramas todavía activas. Los mensajes se consumen
una vez y se distinguen por origen, destino, ejecución de la tarea e instancia.
Esperar un inicio por mensaje no detiene el lanzamiento de los demás inicios.
Los usuarios se asignan por orden de llegada: cada usuario que queda libre pasa a
la petición más antigua que puede atender y, si hay varios libres, se elige el que
menos tareas lleva.

El motor comprueba que no queden tokens ni uniones pendientes antes de devolver
un XES. Un registro parcial no se presenta como una simulación correcta.

No es un motor de ejecución completo de BPMN 2.0. Las tareas de servicio, script
y regla de negocio se simulan como actividades con duración y recursos; no
ejecutan servicios, scripts ni reglas externos. Las bifurcaciones usan los
porcentajes configurados en el modelador, no evalúan expresiones BPMN.

| Elementos | Alcance |
| --- | --- |
| Process / Collaboration | Instancias, frecuencia, usuarios y roles; participantes, carriles y subcarriles. |
| Tareas | Duración, recursos, repeticiones y multiinstancia; envío y recepción de mensajes. CallActivity se simula como una tarea más. |
| Inicios | Sin definición o por mensaje de un emisor del modelo; sin mensajes externos. |
| Finales | Evento de fin sin definición adicional. |
| Eventos intermedios | Lanzamiento simple, envío/recepción de mensaje y espera por duración numérica. |
| Compuertas | Exclusiva, inclusiva y paralela, con uniones y ciclos. |
| Datos | Disponibilidad de objetos referenciados mediante entradas/salidas de tareas. |

En una bifurcación exclusiva se elige una salida; si los porcentajes no suman 100,
se reparten en proporción y se avisa. En una inclusiva se decide cada salida de
forma independiente; si no se selecciona ninguna, se elige una según sus pesos.
Los porcentajes sin configurar reparten el resto hasta 100. Una paralela activa
todas sus salidas.

Cada tarea usa los usuarios de su carril más interno que tenga usuarios, de modo
que un subcarril sin usuarios hereda los del carril que lo contiene. Si la tarea
tiene usuarios o roles asignados, solo se eligen los que pertenecen a ese carril.
En un Process, si ningún carril de la tarea tiene usuarios, se usan los usuarios y
roles del proceso. En una colaboración, una tarea fuera de carriles usa los del
participante.

Lo que el simulador sustituye por sus propios parámetros se acepta con un aviso:
flujos por defecto y condiciones (se usan los porcentajes), testBefore y
loopMaximum (se usan los parámetros de bucle), colecciones y almacenes de datos,
pools externos, mensajes enviados a ellos y parámetros desconocidos de reglas
antiguas, como `security`.

Lo que cambiaría la ejecución se rechaza antes de simular: mensajes que llegan
desde un pool externo, subprocesos, transacciones, eventos de borde, compensación,
compuertas complejas o basadas en eventos, eventos de señal, error, escalado,
condicionales o de terminación, fin por mensaje, inicio por temporizador y
multiinstancia que no espera a todas las ejecuciones. El editor permite trabajar
con esos diagramas, pero no simularlos. Los temporizadores usan segundos de tiempo
simulado: no interpretan fechas, ciclos ni duraciones ISO 8601. Tampoco se ejecutan
expresiones estándar de bucles o multiinstancia; se usan los parámetros propios de
simulación.

## Registro XES

Una unidad de tiempo simulado equivale a un segundo. Las fechas del registro
(`time:timestamp`, `time:endTime` y `time:generationTime`) se calculan sumando esos
segundos a una fecha de inicio, por defecto `2026-01-01T00:00:00+00:00`. Para
cambiarla, define `SIMULATION_START_DATE` antes de arrancar el Backend:

```powershell
$env:SIMULATION_START_DATE = "2026-03-02T08:00:00+01:00"
```

Cada evento lleva en `concept:name` el ID BPMN de su elemento. Las esperas añaden
su tipo delante, por ejemplo `StandBy · Activity_0xkea5f`, y su `time:duration` es
un número de segundos. Con este formato, herramientas de minería de procesos como
PM4Py leen las fechas y las actividades sin conversiones.

## Diferencias con el motor original

Respecto al motor anterior a la limpieza:

- Las uniones paralelas e inclusivas se completan. El motor original no llegaba a
  activarlas, así que las trazas con uniones terminaban sin evento de fin.
- Las esperas por mensajes y datos terminan en el instante exacto, sin esperar al
  segundo siguiente, y generan eventos `StandByMessage` y `StandByData`.
- Cada mensaje se consume una sola vez.
- Los usuarios se asignan por orden de llegada. Antes, con varias instancias
  esperando, se atendía primero a la última en llegar.
- La duración de una tarea sale de una normal truncada entre su mínimo y su
  máximo, y no depende de cuántas veces la haya hecho ese usuario: se ha
  retirado el aprendizaje por repetición del motor original, que la acortaba un
  5 % por repetición hasta un 50 %.
- Una tarea con tiempo mayor que cero dura al menos un segundo: el redondeo
  nunca la convierte en un bucle de duración cero.
- Las trazas se ordenan por número de instancia (1, 2, 3…).
- Una simulación bloqueada o incompleta devuelve un error en lugar de un XES
  parcial.
- Las fechas del XES y `concept:name` siguen el formato descrito arriba.

Con el ejemplo de la Ludoteca, en 30 ejecuciones con las mismas semillas, los
resultados eran equivalentes: la duración media de una instancia pasaba de
454,1 s a 454,4 s y se ejecutaban las mismas tareas. Las diferencias aparecen en
modelos con uniones, esperas por datos o eventos intermedios de mensaje.

Esa comparación se midió **antes de retirar el aprendizaje por repetición**. Sin
él, una tarea que un mismo usuario repite ya no se acorta, así que las duraciones
de este motor son ahora mayores que las del original a propósito, y la cifra de
arriba ya no vale como equivalencia. Se volverá a medir con los modelos de
referencia.
