# Modelador BPMN

Editor web para el simulador Python de `../Backend`. Permite crear y abrir diagramas BPMN/XML, editar propiedades de simulación, usuarios y roles, guardar el diagrama con **Ctrl+S** y consultar el resultado textual de una simulación.

## Uso

Desde esta carpeta, con Node.js 18.12 o superior y npm instalados:

```sh
npm install
npm start
```

La aplicación se abre en `http://localhost:9000`. **Open Existing Model** abre un archivo local; también se puede arrastrar un BPMN al lienzo. **Simular** envía las reglas y el XML a `http://localhost:3000/simulate`. El Backend debe estar ejecutándose para simular. **Última simulación** muestra el último resultado correcto de la sesión. Los tiempos de las tareas, la frecuencia y los temporizadores se expresan en segundos.

El resultado de una simulación es **un registro XES por pool** (ver abajo); **Ctrl+S** guarda el diagrama.

Durante una ejecución se desactiva el botón de simulación. Los errores de
validación, ejecución, conexión o tiempo máximo aparecen en la interfaz y no
reemplazan el último resultado correcto. El límite predeterminado del Backend
es de 5 minutos; el editor consulta su configuración antes de cada ejecución.
Si el Backend ignora algo para poder simular (por ejemplo, un flujo por defecto o
un pool externo), los avisos aparecen encima del resultado.

## Compilación

```sh
npm run lint
npm run bundle
```

La compilación genera exclusivamente `example/dist`; conserva los HTML y fuentes de `example`. Para servir la compilación, publica toda la carpeta `example`. `npm run all` revisa el código con ESLint y compila. Por ahora no hay pruebas automáticas.

## Estructura

- `example/src`: inicio y editor; al pulsar **Simular**, `taskHandlers.js`
  exporta las reglas con `lib/rules`.
- `provider` y `descriptors`: propiedades de simulación y su serialización BPMN.
  El pool guarda en el `.bpmn`, con el prefijo `participantWithoutLane`, los
  mismos atributos que lleva en las reglas: `frequency` (número, admite
  decimales), `instances` (entero; las del orquestador son convocatorias
  sucesivas y las de los demás pools, casos por convocatoria), `orchestrationRole`
  (`orchestrator` u `orchestrated`), `infiniteResources` (booleano), `arrivalMode`
  (`staggered`, `simultaneous` o `uniform`) y `arrivalWindow` (entero, la T de la
  llegada uniforme). El marcador de multiplicidad es el estándar,
  `bpmn:participantMultiplicity`. Se editan en el panel del pool (ver abajo) y
  se exportan a las reglas (ver más abajo).
- `lib/logs`: los registros de una simulación, uno por pool, y el nombre de
  fichero de cada uno.
- `lib/numbers`: cómo validan, leen y muestran los números los paneles.
- `lib/rules`: el exportador de las reglas que se mandan al simular.
- `lib/people`: dónde se guardan las listas de personas (ver abajo) y la
  migración de los ficheros anteriores a la 5.2.
- `lib/resize-all-rules`: regla de redimensionado del editor.

### Parámetros de simulación en el panel

Al seleccionar un **pool**, con carriles o sin ellos, el panel muestra:

| Campo | Qué es | Se guarda como |
| --- | --- | --- |
| Orchestration role | Orquestador, orquestado o sin rol | `orchestrationRole` |
| Instances | Con el orquestador, convocatorias sucesivas; con los demás, casos por convocatoria. Solo cuenta con el marcador de multiplicidad, que se pone desde el menú de reemplazo del pool (la llave inglesa, **Participant multiplicity**) | `instances` |
| Infinite resources | Sus tareas no compiten por una persona | `infiniteResources` |
| Arrival mode | Escalonada (una cada *frequency* segundos), simultánea (todas al abrirse la convocatoria) o uniforme (cada una en un segundo entero al azar entre 0 y T) | `arrivalMode` |
| Frequency (s) | Segundos entre llegadas de la escalonada; admite decimales | `frequency` |
| Arrival window T (s) | La T de la uniforme, en segundos enteros | `arrivalWindow` |

Frequency solo aparece con la llegada escalonada y T con la uniforme; en el
orquestador, que tiene un caso por convocatoria y llega al abrirse, no aparece
ninguno de los tres. Un valor puesto donde no cuenta se sigue mostrando, para
poder quitarlo. Los pools sin carriles tienen además su lista de personas.

En la **raíz** —la colaboración, o el proceso si el diagrama es uno solo— está
la **semilla** (`collab:seed` o `model:seed`), junto al número de instancias de
la colaboración, o al del proceso y su frecuencia. Vacía, el motor genera una y
la deja en los registros; con la misma semilla y el mismo modelo sale la misma
simulación. Se guarda como texto para que una semilla grande no pierda cifras.

Cada campo se valida como lo valida el Backend (enteros donde hacen falta,
nada negativo, T obligatoria con la llegada uniforme, instancias obligatorias
con el marcador, semilla entre 0 y 9007199254740991): lo que no vale se marca
en rojo y no se guarda. Los enteros llegan como mucho a 9007199254740991, el
mayor que JavaScript guarda exacto. Las frecuencias admiten también notación
científica, porque es como JavaScript las escribe en el `.bpmn` por debajo de
1e-6 y desde 1e21 —0.0000001 se guarda como `1e-7`—; al mostrarlas, el panel
las escribe sin exponente siempre que puede hacerlo sin perder nada.

Al simular, estos parámetros van en las reglas (ver abajo) y en el diagrama. El
Backend lee además del diagrama la semilla, y lo que unas reglas no digan; si
reglas y diagrama dicen cosas distintas, rechaza la simulación nombrando el
pool y los dos valores.

### Los registros de una simulación

Una simulación correcta devuelve **un registro XES por pool** (D10), y la
ventana de resultados los ofrece por separado: una fila por pool, con su
nombre, cuántos casos tiene y el fichero con el que se descarga, y los botones
**Ver** —enseña ese registro debajo de la tabla— y **Descargar**. **Descargar
todos** los descarga uno detrás de otro; el navegador puede pedir permiso para
descargar varios ficheros. Encima de la tabla están la identificación de la
simulación, la semilla —con ella se repite— y el modelo, y los avisos si los
hay. **Última simulación** vuelve a abrir esa ventana.

Cada fichero se llama como su pool, `Cliente.xes`. Si el pool no tiene nombre,
se usa su ID; si dos pools comparten nombre, los dos llevan además su ID,
`Cliente (Pool_Cliente).xes`. Lo que Windows no admite en un nombre —`/`,
`:`, `?`…, o un punto al final— pasa a `_`, y a un nombre de dispositivo
reservado —`CON`, `AUX`, `NUL`, `COM1`…— se le antepone `_`. Windows los
reserva también con extensión, porque mira lo que hay antes del primer punto:
un pool «Aux. mantenimiento» se descarga como `_Aux. mantenimiento.xes`, y
«CON.txt» como `_CON.txt.xes`. El registro dice
dentro de qué pool es (`pool:id`, `pool:name`) y de qué simulación
(`simulation:id`), así que un fichero renombrado se sigue pudiendo identificar.
Un registro muy grande se enseña solo por el principio, para no bloquear la
página; la descarga es siempre el registro entero.

Los ficheros se guardan en UTF-8. Hasta la 5.5 no era así con nada que
descargara el Modeler: `downloadjs` escribía un byte por carácter en cuanto
había uno entre `\x80` y `\xff`, así que una «ó» o una «ñ» en un nombre dejaban
el `.bpmn` guardado con **Ctrl+S** imposible de leer. Ahora se le pasa el texto
ya codificado.

### Las reglas que se mandan al simular

**Simular** manda al Backend el diagrama tal como se guarda y sus reglas: una
línea por elemento dibujado, con sus parámetros de simulación. Las exporta
`lib/rules`, sin nada del navegador, para que el banco del Backend
(`Backend/pruebas/exporta_reglas.mjs`) pueda exportar con el mismo código. Las
líneas salen en el orden en que bpmn-js pinta los elementos, que es el que usa
el motor.

Cada tarea lleva quién la hace, sus tiempos y, si tiene la marca,
`multiInstanceType` (`"false"` la paralela, `"true"` la secuencial). Cada pool
lleva `frequency`, siempre `participantMultiplicity` —`"true"` o `"false"`,
según tenga el marcador—, y los parámetros del panel que estén puestos:
`instances`, `orchestrationRole`, `infiniteResources`, `arrivalMode` y
`arrivalWindow`. Con eso las reglas se bastan solas: el banco comprueba que,
con el diagrama y sin él, dan el mismo XES que las reglas de referencia de cada
modelo con la misma semilla. La semilla no va en las reglas: la lee el Backend
del diagrama.

### Multiinstancia

Una tarea multiinstancia lleva la marca estándar de BPMN, no un tipo propio: se
pone desde el menú de reemplazo de la tarea (la llave inglesa), con **Parallel
multi instance** o **Sequential multi instance**, y se quita volviendo a pulsar la
que está activa. Se guarda como `bpmn:multiInstanceLoopCharacteristics`
—`isSequential="true"` en la secuencial—, se exporta a las reglas como
`multiInstanceType="false"` o `"true"`, y el Backend también la lee del diagrama
(3.1). La paralela es la de los lotes de la convocatoria (D8): enviar a N,
recoger de N y evaluar N. **Loop** no es multiinstancia: es el bucle estándar
(`bpmn:standardLoopCharacteristics`) y se configura con sus parámetros de bucle.

### Las listas de personas en el `.bpmn`

Quién puede hacer cada tarea y la plantilla de cada carril, pool y proceso se
guardan dentro de `bpmn:extensionElements`, que es el sitio que BPMN 2.0 reserva
a las extensiones, un elemento por persona:

| Dónde | Elemento |
| --- | --- |
| Tarea | `<user:userTask>`: una persona o un rol |
| Carril | `<lane:userWithoutRole>` |
| Pool sin carriles | `<participantWithoutLane:userWithoutRole>` |
| Proceso | `<model:userWithoutRole>`, y cada rol en un `<model:keyValuePair>` con `<model:key>` (el rol) y `<model:value>` (sus personas, separadas por comas) |

Así el fichero cumple el esquema de BPMN 2.0, y otras herramientas lo abren sin
avisos y lo vuelven a guardar sin perder las listas; el banco lo comprueba con
las librerías con las que abre un fichero Camunda Modeler
(`Backend/pruebas/valida_bpmn.mjs`) y contra el esquema
(`Backend/pruebas/valida_esquema.py`). Hasta la 5.1 eran elementos hijos directos de la tarea, el carril, el
pool o el proceso; esos ficheros se siguen abriendo: al abrirlos, las listas
pasan a `extensionElements` (se ve en la consola del navegador) y se guardan ya
en su sitio. Los descriptores conservan las propiedades antiguas
(`UserTask`, `userWithoutRole`, `userWithRole`) solo para poder leer esos
ficheros; los paneles y la exportación de las reglas usan `lib/people`.

El modelador ya no incluye chatbot, mapa de calor, biblioteca de animación de tokens ni Scheduler/CSV. Los archivos con Scheduler se rechazan al importarlos para evitar interpretarlos como tareas ordinarias. Usuarios y roles se conservan.

El Backend recibe las reglas y devuelve un registro XES por pool en `logs` y
los avisos en `warnings`. Valida también el XML original para detectar funciones BPMN no soportadas;
el mensaje identifica el elemento que necesita revisión. Poder editar un
elemento no implica que el simulador lo implemente. Consulta el alcance en
[Backend/README.md](../Backend/README.md). Chatbot, mapa de calor y Scheduler ya
no se ejecutan en el servidor.
