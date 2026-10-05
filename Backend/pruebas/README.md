# Banco de pruebas

Modelos de referencia congelados. Son el punto de comparación del refactor:
mientras el comportamiento no deba cambiar, su XES no debe cambiar.

## Qué hay aquí

- `modelos/` — modelos que tienen que correr **limpios**, sin un solo aviso.
- `modelos-con-avisos/` — modelos que tienen que correr **bien pero avisando**,
  con exactamente los avisos congelados.
- `modelos-con-error/` — modelos que tienen que **fallar**, con el tipo y el
  mensaje de error congelados.
- `esperado/` — el XES congelado de cada modelo; en `esperado/con-avisos/`
  también la lista de avisos esperados, y en `esperado/con-error/` el error
  esperado. **No se editan a mano.**
- `banco.py` — lo que comparten los dos scripts: dónde están los modelos y cómo
  se ejecutan. Si cada uno los descubriera por su cuenta, acabarían discrepando.
- `congelar.py` — reejecuta los modelos y reescribe `esperado/`.
- `regresion.py` — reejecuta los modelos y **compara** con `esperado/`.
- `integracion/` y `integracion-con-error/` — diagramas BPMN reales de varios
  modelos de referencia, para el banco de integración (ver más abajo).
- `integracion.py` — manda reglas y diagrama por la API y compara.
- `bpmn_desde_reglas.py` — genera el diagrama de un modelo; `valida_bpmn.mjs`
  lo comprueba con bpmn-moddle.

## Los modelos

| Modelo | Qué cubre | Qué rompe si se rompe |
| --- | --- | --- |
| `01-simple` | Un proceso, dos instancias, dos tareas en serie | Lo básico: duraciones, cola de usuarios, formato del XES |
| `02-colaboracion` | Colaboración 1:1 con tres parejas y mensajes en ambos sentidos | El emparejamiento: que el cliente 2 hable con el servicio 2 |
| `03-uniones-y-bucle` | Unión paralela e inclusiva, bucle y temporizador | Tokens, uniones que esperan solo a las ramas abiertas, y esperas con fin propio |
| `04-datos-y-mensajes` | Objetos de datos y evento de inicio por mensaje | Que cada caso espere **su** dato, y que un pool arranque al recibir |
| `05-multiplicidad-por-pool` | Orquestador con 1 instancia y orquestado con 3 | Que cada pool use su propio número y no el de la colaboración |
| `06-mensaje-antes-de-arrancar` | Un mensaje dirigido a un caso que aún no ha arrancado | Que un mensaje se pierda porque su destinatario todavía no existía |
| `07-recursos-infinitos` | Un pool finito y otro infinito, los dos con un usuario y tres casos | Que la casilla de recursos infinitos deje de hacer efecto |
| `08-carriles-y-subcarriles` | Un pool sin usuarios propios: un carril con los suyos, un subcarril con otro y un subcarril que los hereda | Que la cola del pool se quede sin los usuarios de sus carriles |
| `09-eventos-de-mensaje` | Aviso y confirmacion por eventos intermedios de mensaje, con dos parejas desfasadas | Que el otro camino de los mensajes, el que no pasa por tareas, se cruce o pierda el remitente |
| `con-avisos/pool-vacio` | Un pool sin proceso que simular | Que un aviso se convierta en una simulación bloqueada |
| `con-avisos/parametro-desconocido` | Un parámetro que el simulador no conoce | Que un modelo de una versión más nueva del Modeler deje de cargarse |
| `con-avisos/instances-sin-marcador` | Un pool con número de instancias pero sin marcador | Que se simule un número distinto del dibujado, en silencio |
| `10-convocatoria-1-a-n` | Un orquestador y cuatro orquestados: un envio multiinstancia que escribe a un caso por ejecucion, cuatro solicitudes al caso unico y cuatro respuestas | Que una ejecucion escriba al caso equivocado, que las solicitudes se pisen, o que una respuesta vuelva a otro solicitante |
| `11-dos-conversaciones` | Dos ventanillas en paralelo hablando con el mismo pool, con las solicitudes llegando en orden distinto | Que el contexto de una recepcion pise el de la otra y una ventanilla responda a quien no le escribio |
| `12-dos-activaciones` | Dos tokens paralelos activando la misma ReceiveTask, con la respuesta retrasada | Que dos activaciones de una recepcion compartan contexto y una respuesta vuelva a quien no escribio |
| `13-ciclo-de-flujos` | Un ciclo real de flujos de secuencia, con un gateway que reintenta o cierra | Que el generador no reconozca una funcion ya escrita y se vaya a la recursion infinita |
| `14-convocatoria-de-50` | La convocatoria del 10 con 50 orquestados: 51 casos, 50 sobres, 50 respuestas | Que la cifra que nombran los criterios del hito 2 deje de salir |
| `15-contexto-heredado` | La recepcion antes del corte y las dos respuestas despues | Que una respuesta no sepa subir por los contextos del token hasta su recepcion |
| `16-evaluar-el-lote` | Enviar a N, recoger de N y evaluar N: la evaluacion es una tarea normal con la marca, entre recoger y responder | Que una evaluacion multiinstancia pierda la fuente de su cardinalidad, o que el cuello de botella del orquestador deje de verse |
| `17-union-que-garantiza-el-lote` | La convocatoria del 16 con una rama paralela que no recoge nada y se junta con la de Recoger en una union paralela antes de evaluar, y un bucle que vuelve a Evaluar | Que la validacion rechace un lote que si esta garantizado: por una union paralela que espera a la rama de la recepcion, o por un bucle que solo empieza despues de recoger |
| `18-union-inclusiva-que-espera-al-lote` | El 17 con Une_O inclusiva: la bifurcacion sigue siendo paralela, asi que la union espera al token vivo de Recoger | Que la validacion trate toda union inclusiva como si pudiera disparar sin la rama de la recepcion, cuando eso depende de que tokens hay a la vez |
| `19-bifurcacion-inclusiva-ancha` | Un proceso sin multiinstancia con una bifurcacion inclusiva de 20 salidas: mas de un millon de combinaciones posibles | Que la validacion enumere combinaciones que no necesita y gaste memoria sin limite antes de que empiece el plazo de la simulacion |
| `20-reclamaciones` | La convocatoria del plan con diez solicitantes: convocar, recoger, evaluar, resolver, recoger reclamaciones, reevaluar y responder, sin ningun numero de ejecuciones escrito. Con la semilla del banco reclaman 5 | Que N deje de ser lo que llega: una convocatoria que no va a los casos vivos, una recepcion que cierra antes o despues de tiempo, o una evaluacion o una respuesta que no cuenten su lote. Ademas, el criterio de la 3.2 sobre treinta semillas (ver abajo) |
| `21-nadie-reclama` | El 20 con cuatro solicitantes y un 20 % de reclamar: con la semilla del banco no reclama nadie | Que una recepcion que se queda en cero se bloquee, o que la reevaluacion ocupe a alguien sin nada que evaluar |
| `22-dos-ventanillas-a-eleccion` | Dos recepciones abiertas a la vez, y cada solicitante elige UNA | Que la recepcion cierre por quien ha escrito o ha terminado en vez de por quien todavia puede escribir: la A esperaria a los de la B y la B a los de la A |
| `23-reconvocar-a-los-vivos` | Una segunda convocatoria cuando la mitad, de media, se ha retirado | Que un envio que abre la conversacion cuente casos terminados y les deje sobres que nadie recoge |
| `24-reclamaciones-en-secuencia` | El 20 con seis solicitantes y la marca secuencial en todas las tareas | Que la recepcion secuencial, que espera un sobre cada vez, no cierre o se coma el lote |
| `25-parejas-con-varias-respuestas` | Cuatro parejas 1:1; cada servicio responde una o mas veces a SU cliente, que las recoge con una recepcion multiinstancia | Que una recepcion espere respuestas destinadas a otros casos: el cliente 1 terminaba cuando acababa el ultimo servicio, no el suyo. Se mira a quien puede ir la respuesta de cada token, por lo que anoto su recepcion o por quien le escribiria |
| `26-respuesta-en-bucle` | Un servicio responde con un bucle de dos vueltas (Units=2, numberOfExecutions=1): la primera al cliente que anoto, la segunda al 2 por las reglas fijas | Que el cierre cuente las ejecuciones de un envio por numberOfExecutions y no por su bucle, y la recepcion del cliente 2 cierre antes de la segunda respuesta; o, al reves, que la del cliente 1 espere al final del bucle (t=25) cuando la unica vuelta pendiente ya no va a el, en vez de cerrar al recibir (t=17) |
| `con-avisos/envio-a-pool-externo` | Un mensaje dirigido al pool y no a un receptor | Que un envio que sale de la simulacion acabe en un error interno en vez de en un aviso |
| `con-avisos/mismo-usuario-en-dos-pools` | El mismo nombre declarado en dos pools | Que dos pools vuelvan a competir por el mismo recurso |
| `con-avisos/multiinstancia-con-numero-escrito` | Una convocatoria multiinstancia con numberOfExecutions=4 a dos casos | Que un numero que ya no se usa se ignore en silencio; N son los dos casos vivos |
| `con-error/sin-destino` | Tres agencias escribiendo a cinco oficinas: ni 1 a N, ni N a 1, ni mismo numero | Que el motor se invente un emparejamiento en vez de decir que no hay ninguno |
| `con-error/respuesta-ambigua` | Dos recepciones del mismo pool unidas antes de una sola respuesta | Que el motor elija por su cuenta a cual de las dos responde |
| `con-error/respuesta-ambigua-desigual` | Lo mismo, con las dos recepciones a distinta distancia de la respuesta | Que la busqueda corte en la primera distancia y elija una rama en silencio |
| `con-error/multiinstancia-sin-cardinalidad` | Una tarea marcada que ni envia, ni recibe, ni tiene un lote antes | Que una marca sin fuente se simule con un numero inventado |
| `con-error/multiinstancia-hacia-pool-externo` | Un envio multiinstancia a un pool sin casos | Que se manden N copias a nadie |
| `con-error/evaluacion-de-dos-lotes` | Una evaluacion con dos recepciones multiinstancia antes | Que el motor elija en silencio cual de los dos lotes cuenta |
| `con-error/evaluacion-sin-lote-en-otra-rama` | Una bifurcacion paralela que manda un token a Recoger y otro directamente a Evaluar | Que se acepte la evaluacion porque hay una recepcion en alguno de sus caminos, y la otra rama evalue en t=0 sin lote |
| `con-error/evaluacion-sin-lote-por-union-inclusiva` | Recoger y Preparar abiertas por una bifurcacion inclusiva y juntadas en una union inclusiva antes de evaluar | Que una union que puede disparar solo con la rama de Preparar cuente como si garantizara el lote |
| `con-error/evaluacion-sin-lote-si-la-recepcion-se-desvia` | Bifurcacion paralela y union inclusiva, pero despues de Recoger una exclusiva puede cerrar por su cuenta | Que baste con que la bifurcacion sea paralela: si el token de Recoger se va al fin, la union deja de esperarlo y dispara sin lote |
| `con-error/evaluacion-sin-lote-segun-quien-llegue-antes` | Bifurcacion paralela y union inclusiva con la rama de Recoger llegando siempre, y una rama al 0 % que la union cuenta igual | Que se decida mirando una sola ordenacion de los tokens: el fallo solo aparece si Tribunal termina antes que Revisar |
| `con-error/evaluacion-con-demasiadas-combinaciones` | Union inclusiva tras una bifurcacion inclusiva de 20 salidas, con Recoger al 100 %: valido, pero con 2^19 combinaciones | Que se pongan a enumerar en vez de contarlas y rechazar al momento diciendo que no se ha podido comprobar |
| `con-error/evaluacion-con-demasiados-estados` | El 18 a lo ancho: Recoger y doce comprobaciones en paralelo hacia una union inclusiva. Valido, pero con demasiados ordenes posibles | Que la partida de tokens no tenga presupuesto y crezca sin limite; con presupuesto se rechaza diciendo que no se ha podido comprobar |
| `con-error/evaluacion-sin-lote-en-la-primera-vuelta` | Un bucle Evaluar, Recoger y otra vez Evaluar | Que la recepcion del camino de vuelta tape que la primera vuelta llega sin lote |
| `con-error/mensaje-sin-recoger` | Tres solicitudes y una sola recepcion declarada | Que dos mensajes enviados se queden sin recoger y la simulacion termine con buena cara |
| `con-error/mensaje-al-propio-pool` | Un mensaje dirigido directamente al participante que contiene al emisor | Que un envio al propio pool se acepte como externo en vez de rechazarse con un 400 |
| `con-error/usuario-ajeno-al-carril` | Una tarea asignada a alguien de otro carril | Que un modelo imposible se simule a medias en vez de rechazarse con un 400 |
| `con-error/ciclo-de-espera` | El solicitante espera un aviso que solo sale cuando cierra la recepcion a la que tiene que escribir | Que un ciclo de espera real se cuelgue en vez de denunciarse; el mensaje lo afinara la 3.4 |

## Por qué existe `modelos-con-avisos/`

Porque los modelos limpios no pueden cubrir el camino «esto avisa pero debe
terminar bien», y ahí es justo donde se coló un fallo: el motor creaba casos
para los pools vacíos, que no tienen evento de inicio ni de fin, y convertía un
aviso en un error 422. Con la categoría nueva, revertir ese arreglo pone el
banco en rojo al instante.

Un aviso que aparece, que desaparece o que cambia de texto es un fallo en las
dos categorías. En `modelos/` porque no debería haber ninguno; en
`modelos-con-avisos/` porque los avisos son parte de lo congelado.

## Por qué existe `modelos-con-error/`

Porque un diagnóstico es parte del contrato igual que el XES. Si el motor deja
de denunciar un modelo imposible, o lo denuncia con otras palabras, nadie se
entera: el modelo ya no está en `modelos/` —no termina— ni en
`modelos-con-avisos/` —no avisa, falla—, así que sin esta categoría ninguna
prueba lo mira. El caso que la motivó: un mensaje sin caso destino se perdía en
silencio y la simulación terminaba con buena cara.

El otro caso que la categoría ya ha pagado: al llegar el encaminamiento N a 1,
el modelo de «sin destino» dejó de fallar —porque ahora sí sabe a dónde ir— y la
regresión lo dijo en el acto en vez de dejar el modelo ahí como adorno.

Se congelan el **tipo** y el **mensaje**, y solo de los errores previstos: el
`ValueError` de validación, que la API traduce a 400, y el
`SimulationExecutionError` de una simulación que no puede terminar, que es un
422. Cualquier otro tipo —un `KeyError`, un fallo del proceso hijo— es un error
interno, acaba en un 500 y **pone el banco en rojo aunque el mensaje coincida**,
porque es un fallo del motor y no un mensaje para quien dibuja. No se congela el
504 por tiempo, que depende del reloj real y no sería reproducible.

## Congelar

```
python3 pruebas/congelar.py
```

Dos fases: primero ejecuta **todos** los modelos en memoria y solo escribe si
**todos** pasan. Si alguno falla, no se toca ni un fichero y sale con código 1.
Un congelado a medias es peor que ninguno, porque la regresión compararía contra
una mezcla de referencias viejas y nuevas sin que nadie se entere.

## La regresión

```
python3 pruebas/regresion.py
python3 pruebas/regresion.py --acepta-reorganizacion
```

Compara cuatro cosas que no conviene confundir, y vigila dos más:

- **Comportamiento** — qué le ocurre a **cada caso**: qué eventos tiene, cuándo,
  con qué recurso y qué rama elige cada compuerta. Cualquier diferencia es un
  fallo, y el mensaje dice el caso, el evento, el atributo y los dos valores.
- **Organización** — en cuántas trazas se reparten los eventos de un caso y cómo
  se llaman. Eso cambió en las tareas 1.5 y 1.6 a propósito: se informa aparte y
  se acepta con `--acepta-reorganizacion`.
- **Avisos** — como se explica arriba.
- **Errores** — los modelos de `modelos-con-error/` tienen que seguir fallando
  con el mismo tipo y el mismo mensaje. Que dejen de fallar, que cambie el
  texto, o que un error interno sustituya al diagnóstico son fallos los tres.
- **Memoria** — `banco.ejecuta` mide con `tracemalloc` lo que cada modelo hace
  gastar al proceso principal (leer, validar, generar el script y recoger el
  XES) y falla con `MemoriaExcesiva` si pasa de `banco.MEMORIA_MAXIMA`, 32 MiB.
  La validación corre antes del plazo de la simulación, así que nada más la
  para: enumerar las combinaciones de una bifurcación inclusiva de 20 salidas
  gastaba 128 MiB, y cada salida más lo doblaba. Hoy el que más gasta es el 14,
  con unos 7 MiB. Es un error interno, no un diagnóstico, y no se congela.
- **El criterio de la 3.2** — el modelo `20-reclamaciones` se ejecuta además
  con treinta semillas (`banco.CRITERIO_DEL_LOTE`). En cada una se tiene que
  recoger, reevaluar y responder exactamente lo que se reclamó, y entre todas
  tienen que salir una con 4 reclamaciones y otra con 6: es la tarea, «el mismo
  modelo evalúa 4 veces si reclaman 4 y 6 si reclaman 6». Una sola semilla no lo
  ve: un motor que se quedara corto a partir de 6 pasaría el XES congelado, que
  tiene 5, y fallaría aquí. Tarda unos cinco segundos.

En las tareas multiinstancia del banco `numberOfExecutions` vale 1, que es lo
que escribe el Modeler: desde la 3.2 N se calcula en ejecución y ese campo no se
usa, y si vale otra cosa la validación avisa. Los XES congelados no cambiaron al
pasar de los números escritos a 1, que es la prueba de que el motor ya no los
leía.

**La línea entre comportamiento y organización está en el caso, no en la traza.**
Los eventos se agrupan por caso *antes* de comparar. Aceptar la reorganización no
es ignorar a quién pertenece cada evento: si la respuesta del cliente 1 acabara
en el cliente 2, sigue siendo un fallo. Comparar un conjunto global de eventos no
lo vería, porque ese conjunto no cambia al intercambiar dos respuestas.

Si la reorganización además renumera los casos, hay que declararlo con
`--correspondencia pruebas/correspondencia.json`, un JSON
`{"caso nuevo": "caso de referencia"}`. Sin él se asume que no cambian, y un caso
que aparece o desaparece es un fallo.

También avisa de una referencia huérfana —un fichero congelado cuyo modelo ya no
existe— para que `esperado/` no acumule restos.

## El banco de integración

```
python3 pruebas/integracion.py
python3 pruebas/integracion.py --congela
node pruebas/valida_bpmn.mjs
```

El resto del banco ejecuta las reglas directamente. Este manda lo mismo que el
Modeler —`content` **y** `diagramXML`— por `POST /simulate`, con el cliente de
pruebas de Flask: pasa por `server.py` entero, JSON y códigos HTTP incluidos,
sin abrir ningún puerto.

- `integracion/<modelo>.bpmn` tiene que responder **200 con el mismo XES** que
  ejecutando directamente las reglas de `<modelo>`, y con los mismos avisos.
  Aquí no hay nada congelado: la referencia es la ejecución directa. Si el
  modelo tiene tareas multiinstancia, se manda **otra vez sin ningún
  `multiInstanceType` en las reglas**: la marca tiene que llegar del dibujo
  (3.1) y el XES tiene que ser el mismo.
- `integracion-con-error/<modelo>--<variante>.bpmn` es un diagrama roto, o uno
  que no cuenta lo mismo que las reglas de `<modelo>`. Tiene que fallar con un
  400 o un 422 y el mensaje congelado en `esperado/integracion/`. Un 200 o un
  500 no se congelan nunca.

Por qué hace falta: el motor simula las **reglas**, no el diagrama. Si el
exportador del Modeler descarta o cambia algo, o si reglas y diagrama vienen de
versiones distintas, la API simulaba otro modelo y respondía 200. Sin el cruce
de `validate_diagram_correspondence`, los cinco diagramas de correlación rota de
`integracion-con-error/` daban **200**.

Los diagramas están **generados** con `bpmn_desde_reglas.py` y congelados como
ficheros, no dibujados: el Modeler aún no sabe escribir los atributos del hito 2
(`instances`, `orchestrationRole`, `infiniteResources`), que son el hito 5. Lo
que sí llevan es lo que el Modeler escribiría hoy: la estructura BPMN, los
atributos de sus descriptores y los dos marcadores estándar,
`participantMultiplicity` y `multiInstanceLoopCharacteristics`. Que el XML es
BPMN de verdad no lo dice el Backend sino `valida_bpmn.mjs`, con bpmn-moddle
—la librería con la que bpmn-js abre un diagrama— y los descriptores del
Modeler; necesita `npm install` hecho en `Modeler/`. Se abren en el Modeler.

`valida_bpmn.mjs` comprueba además que **abrir y guardar no cambia nada**, que
es lo que pasa cada vez que alguien abre un diagrama en el Modeler y lo vuelve a
guardar. Ahí es donde se vio que las listas de usuarios estaban mal escritas: en
los descriptores `UserTask` y `userWithoutRole` son listas de elementos hijos, y
escritas como un atributo con comas bpmn-moddle las abre como una cadena y las
guarda letra a letra —Ana se convertía en A, n y a—. El generador escribe ahora
un elemento por usuario en tareas, procesos, pools y carriles.

`valida_bpmn.mjs` abre cada diagrama, por último, **como otra herramienta**:
con bpmn-moddle sin los descriptores del Modeler. Tienen que seguir ahí todos los
elementos BPMN y todas las marcas, que son lo que el motor lee del dibujo; lo
único que se tolera que no entienda son los elementos propios del Modeler, y los
cuenta. Hoy son las listas de usuarios: el Modeler las escribe como elementos
hijos sin `extensionElements`, y otra herramienta las descarta. Abrir sin avisos
en Camunda o Bizagi es la 5.2.

Si cambia un modelo que tiene diagrama, se regenera con
`python3 pruebas/bpmn_desde_reglas.py pruebas/modelos/<modelo>.txt` y se vuelve
a pasar `valida_bpmn.mjs`.

## Un banco vacío no es un banco en verde

Los tres comandos se niegan a comparar o congelar si falta un grupo de casos o
está vacío: `modelos/`, `modelos-con-avisos/` y `modelos-con-error/` en el banco
del motor, `integracion/` e `integracion-con-error/` en el de integración, y la
carpeta de diagramas en `valida_bpmn.mjs`. Sin esa comprobación, perder una
carpeta entera —modelos y referencias a la vez, en un merge— daba verde con
menos casos, o con ninguno, sin decir nada.

## Reproducibilidad

La semilla (`20260101`) y la fecha de inicio (`2026-01-01T00:00:00+00:00`) están
fijas en `banco.py`. Sin las dos, el XES no es reproducible y estos ficheros no
valdrían como referencia. Hace falta `simpy==4.1.1`, la versión del
`requirements.txt`: con otra, las referencias podrían no reproducirse.

## Cuando el cambio es intencionado

Revisar lo que dice la regresión, comprobar que el cambio es el que se buscaba, y
entonces `congelar.py`. Nunca al revés: si se congela primero, nadie llega a ver
qué cambió.
