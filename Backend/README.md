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

Del diagrama sale además lo que se configura en el Modeler y las reglas pueden
no decir: la marca de multiinstancia de cada tarea (3.1) y los parámetros de
cada pool (5.3) —el marcador de multiplicidad y, con el prefijo
`participantWithoutLane`, `instances`, `orchestrationRole`, `infiniteResources`,
`arrivalMode`, `arrivalWindow` y `frequency`—. Lo que las reglas no dicen lo
aporta el diagrama, y se valida igual que si viniera en ellas; si los dos lo
dicen y no coincide, la petición se rechaza con un 400 que nombra el elemento,
el parámetro y los dos valores, porque reglas y diagrama cuentan modelos
distintos.

El campo opcional `seed` fija la semilla de la simulación; ver [Semilla](#semilla).

Una simulación correcta devuelve un registro XES por pool, lo que comparten, los
avisos y la semilla usada:

```json
{
  "simulationId": "d271c85ff2dff9fb",
  "formatVersion": "2",
  "model": { "id": "Colaboracion", "name": "Cliente y servicio",
             "rulesSha256": "85df…", "diagramSha256": "3a07…" },
  "seed": 2841937403,
  "logs": [ { "pool": "Pool_Cliente", "name": "Cliente", "xes": "<?xml …" },
            { "pool": "Pool_Servicio", "name": "Servicio", "xes": "<?xml …" } ],
  "warnings": []
}
```

Cada registro de `logs` lleva las trazas de los casos de su pool, de todas las
convocatorias, y en su cabecera lo que hace falta para entenderlo sin las
reglas: los metadatos comunes —`simulation:id`, `simulation:formatVersion`,
`simulation:seed`, `simulation:startDate`, los pools esperados en
`simulation:participants`, `simulation:convocatorias` y la referencia del modelo
en `model:*`— y los de su pool: `pool:id`, `pool:name`, `pool:role`,
`pool:resources` (`finite` o `infinite`) y la plantilla completa en
`pool:staff`, también quien no llega a trabajar, con sus carriles en
`pool:lanes` y, en un Process, sus roles en `pool:roles`. Con los metadatos
comunes se comprueba que un conjunto de registros está completo y es de una sola
simulación, y se reúne la ejecución entera (`simulator/registros.py`).

`simulationId` es reproducible: sale de la huella de las reglas —sin
comentarios ni líneas en blanco—, la del diagrama si se envía, la semilla, la
fecha de inicio y la versión del formato. Hasta la 5.6 la respuesta traía
además `simulation`, el XES reunido con todas las trazas en un solo fichero;
el Modeler dejó de usarlo en la 5.5, cuando empezó a ofrecer los registros por
separado, y se ha retirado. Para tener la ejecución entera de una vez se
reúnen los registros con `reune_registros` de `simulator/registros.py`, que
antes revisa que el conjunto esté completo y sea de una sola simulación.

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
cada petición, usando el mismo intérprete Python que el servidor. Devuelve los
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

La semilla llega en el campo opcional `seed` de `POST /simulate`, o guardada en
el diagrama: el Modeler la pone en el panel de la raíz, como `collab:seed` en la
colaboración o `model:seed` en el proceso si es uno solo. Es un entero entre
0 y 9007199254740991 (el mayor que JavaScript conserva exacto), como número o
como texto. Si llegan las dos y no coinciden, la petición se rechaza con un 400.
Si no llega ninguna, el motor genera una entre 0 y 4294967295. En todos los
casos la respuesta la devuelve en `seed` y cada registro la guarda como
atributo del log:

```xml
<int key="simulation:seed" value="2841937403"/>
```

Para repetir una simulación basta con volver a enviar esa semilla. El proceso de
simulación se lanza además con `PYTHONHASHSEED=0`, así que tampoco el orden
interno de los conjuntos de Python cambia de una ejecución a otra.

## El proceso base

La convocatoria del plan, el modelo del que parte el proyecto, está dibujada en
el Modeler, `Modeler/ejemplos/proceso-base.bpmn` (cómo se dibuja, en
[la guía del Modeler](../Modeler/README.md#el-proceso-base)), y escrita como
reglas en el modelo de referencia `pruebas/modelos/35-proceso-base.txt`. Son el
mismo modelo:

- La colaboración «Proceso base», con una convocatoria y la semilla `20260101`
  guardada (`collab:seed`).
- **SACU**, el orquestador, con tres personas —Ana, Bea y Carlos— que se
  reparten sus tareas: publica la convocatoria, recibe las solicitudes, evalúa
  una por solicitud, publica la lista de aceptados y envía a cada solicitante
  su resultado; después recibe, evalúa y responde las reclamaciones. Las
  recepciones, las evaluaciones y los envíos son multiinstancia paralela: el
  lote es lo que llega, y una recepción cierra cuando ya no puede llegar nada.
- **Residente**, orquestado: diez casos por convocatoria, con recursos
  infinitos y llegada uniforme en 120 s. Rellena el formulario, envía la
  solicitud y espera el resultado; queda aceptado el 60 %, y de los demás
  reclama la mitad, que espera su reevaluación.

Desde el Modeler basta con abrir el ejemplo y pulsar **Simular**. Lo que llega
aquí es lo de cualquier simulación: en `content`, las reglas que el Modeler
exporta del dibujo, y en `diagramXML`, el dibujo; sin `seed`, porque la
semilla la lee el Backend del diagrama. Con la fecha de inicio predeterminada
responde 200 sin avisos, con la semilla 20260101 y dos registros, `Pool_SACU`
(un caso) y `Pool_Residente` (diez). Quedan aceptados ocho residentes, el
séptimo se rechaza sin reclamar y el segundo reclama; la convocatoria acaba a
las 00:05:57 (t=357 s). Los aceptados terminan entre las 00:05:13 y las
00:05:17, todos casi a la vez, porque la SACU no publica los resultados hasta
haber evaluado el lote entero.

El banco comprueba que el dibujo y las reglas que el Modeler exporta de él,
mandados así, sin semilla, dan exactamente el XES de las reglas del `35`
(`pruebas/integracion.py`); la regresión ejecuta además el `35` con 100
residentes ([pruebas/README.md](pruebas/README.md)).

## Ejecución y soporte

Las uniones paralelas esperan una llegada por cada flujo de entrada y consumen
esas llegadas en cada activación, también al repetirse en un ciclo. Las uniones
inclusivas tienen en cuenta las ramas todavía activas. Los mensajes se consumen
una vez y se guardan por elemento emisor, elemento receptor y caso destinatario.
Cada mensaje conserva el caso remitente; la recepción lo vincula a su contexto
de token y a su ejecución para que la respuesta vuelva al caso correcto.
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

Cada ejecución de una tarea dura un número entero de segundos (1.2). La
duración sale de una normal centrada entre su mínimo y su máximo, con una
desviación típica de la sexta parte de esa distancia, y **recortada**, no
truncada: un valor que cae fuera no se vuelve a sortear, sino que se queda en
el extremo más próximo. Como los extremos están a tres desviaciones del
centro, fuera cae el 0,27 % de las veces, la mitad por cada lado, así que cada
extremo sale en torno al 0,13 % de las ejecuciones; en una normal truncada no
tendrían más peso que sus vecinos. Con mínimo y máximo iguales, la duración es
siempre ese valor.

Después se redondea al segundo más próximo; en un empate, al par, como `round`
de Python: con mínimo y máximo de 2.5 la tarea dura 2 s, y con 3.5, 4 s. Con
2.5 y 3.5 casi todas las ejecuciones duran 3 s, y las que caen en un extremo,
2 s o 4 s, en torno al 0,13 % cada una. Si el mínimo es mayor que cero, nunca
dura menos de un segundo, aunque el redondeo diera cero: con 0.4 dura 1 s. Los
tiempos admiten decimales —el Modeler los guarda y las reglas los llevan tal
cual—, y cambian cómo se reparten las duraciones entre los dos extremos, pero
no la precisión del resultado.

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

Hay un registro por pool, con sus metadatos (ver [API](#api)). Una unidad de tiempo simulado equivale a un segundo. Las fechas del registro
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

Es también lo único de lo que se alimenta el visualizador (D15), así que cada
evento dice lo que hace falta para saber dónde está cada caso en cada instante:

- Una ejecución de una tarea, la espera de un temporizador y las esperas del
  motor tienen inicio y fin reales, `time:timestamp` y `time:endTime`. Las
  esperas son `StandBy` (por una persona libre), `StandByMessage` (por un
  sobre), `StandByData` (por unos datos) y `StandByJoin` (por la otra rama de
  una unión, con `bpmn:incomingFlow`), y solo se registran si duran algo.
- Los inicios, los fines, las compuertas y los lanzamientos son instantes: solo
  `time:timestamp`. Una compuerta dice en `bpmn:selectedFlow` qué salidas tomó.
- `bpmn:activation` (6.4, formato 2) identifica el token que activó una tarea.
  Está en todas sus ejecuciones y esperas, también en la espera cancelada al
  cerrar una recepción. Junto con el caso y el elemento distingue lotes
  simultáneos aunque empiecen a la vez y ambos numeren desde 1. Se registra el
  contexto ya existente en el motor; no altera los tiempos ni el encaminamiento.
- `bpmn:execution` numera las ejecuciones de una tarea en una activación, y
  `bpmn:occurrence` identifica cada evento dentro de su caso: no se repite ni
  en un bucle ni en dos ramas que pasen a la vez por la misma tarea.
- `bpmn:request` (6.1) es la solicitud que atiende la ejecución: en una
  recepción, el caso que mandó el sobre, también en su espera; en una tarea
  que trabaja un lote o en un envío que responde, el caso que escribió a esa
  recepción en esa misma ejecución. Así la evaluación *i*, la respuesta *i* y
  la recepción *i* dicen la misma solicitud.
- Cuando una recepción multiinstancia cierra (D7), la ejecución que esperaba un
  sobre más se va, y su espera queda como un `StandByMessage` con
  `bpmn:cancelled` a `true` (6.1). Cuenta desde donde cuentan las de su lote:
  en paralelo, desde que se activó la recepción. Sin ella, una recepción que
  cierra vacía dejaba al caso en ninguna parte mientras esperaba.

## Diferencias con el motor original

Respecto al motor anterior a la limpieza:

- Las uniones paralelas e inclusivas se completan. El motor original no llegaba a
  activarlas, así que las trazas con uniones terminaban sin evento de fin.
- Las esperas por mensajes y datos terminan en el instante exacto, sin esperar al
  segundo siguiente, y generan eventos `StandByMessage` y `StandByData`.
- Cada mensaje se consume una sola vez.
- Los usuarios se asignan por orden de llegada. Antes, con varias instancias
  esperando, se atendía primero a la última en llegar.
- La duración de una tarea sale de una normal recortada a su mínimo y su
  máximo (ver [Ejecución y soporte](#ejecución-y-soporte)), y no depende de
  cuántas veces la haya hecho ese usuario: se ha
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
