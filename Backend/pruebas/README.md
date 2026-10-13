# Banco de pruebas

Modelos de referencia congelados. Son el punto de comparación del refactor:
mientras el comportamiento no deba cambiar, sus XES no deben cambiar.

## Qué hay aquí

- `modelos/` — modelos que tienen que correr **limpios**, sin un solo aviso.
- `modelos-con-avisos/` — modelos que tienen que correr **bien pero avisando**,
  con exactamente los avisos congelados.
- `modelos-con-error/` — modelos que tienen que **fallar**, con el tipo y el
  mensaje de error congelados.
- `esperado/` — los registros congelados de cada modelo, uno por pool en
  `esperado/<modelo>/<pool>.xes`, como los escribe el motor desde la 4.4 (D10);
  en `esperado/con-avisos/` también la lista de avisos esperados, y en
  `esperado/con-error/` el error esperado. **No se editan a mano.**
- `banco.py` — lo que comparten los dos scripts: dónde están los modelos y cómo
  se ejecutan. Si cada uno los descubriera por su cuenta, acabarían discrepando.
- `congelar.py` — reejecuta los modelos y reescribe `esperado/`.
- `regresion.py` — reejecuta los modelos y **compara** con `esperado/`.
- `integracion/` y `integracion-con-error/` — diagramas BPMN reales de varios
  modelos de referencia, para el banco de integración (ver más abajo).
- `integracion.py` — manda reglas y diagrama por la API y compara.
- `bpmn_desde_reglas.py` — genera el diagrama de un modelo; `valida_bpmn.mjs`
  lo comprueba con bpmn-moddle, y `valida_esquema.py` contra el esquema de
  BPMN 2.0, que está en `esquema-bpmn/`.
- `formato-anterior/` — diagramas guardados por el Modeler de antes de la 5.2,
  con las listas de personas fuera de `extensionElements`: prueban que se
  siguen abriendo.
- `exporta_reglas.mjs` y `exportadas/` — lo que el Modeler manda a la API al
  simular cada diagrama de `integracion/`: el BPMN guardado y sus reglas
  exportadas, con el código del Modeler (ver más abajo).
- `lee_con_pm4py.py` — lee con PM4Py los registros congelados, los reúne y
  saca de ellos quién está libre (ver más abajo).

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
| `08-carriles-y-subcarriles` | Un pool sin usuarios propios: un carril con los suyos, un subcarril con otro, un subcarril que los hereda y uno de reserva sin nodos | Que la cola del pool se quede sin los usuarios de sus carriles; o que un subcarril sin nodos -la reserva, con Diana- pierda su pool y Diana desaparezca de la plantilla del registro |
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
| `27-parejas-con-cadena-de-respuestas` | Tres parejas: el servicio avisa, el cliente pide en respuesta al aviso y el servicio responde; el cliente recoge con una recepcion multiinstancia | Que quien puede escribir a una recepcion se deje sin acotar cuando le escribe otra respuesta: el cliente 1 esperaria hasta t=206 a que el servicio 3 reciba la peticion de su cliente, en vez de cerrar en t=43 |
| `28-pedir-y-esperar-a-la-vez` | El 02 con la peticion y una recepcion multiinstancia en ramas paralelas del cliente, y respuesta multiinstancia del servicio. La peticion del cliente 1 espera en el buzon; las de los clientes 2 y 3 ya se entregaron y aun no se anotan | Que entre el envio y la anotacion parezca que nadie escribira al servicio y la recepcion del cliente cierre vacia: las tres respuestas se quedaban sin recoger. Cuentan como escritores los sobres ya enviados sin anotar, en el buzon y entregados |
| `29-rama-al-cero-por-ciento` | Una union inclusiva cuya otra entrada solo se podria alcanzar por una rama al 0 % | Que una rama que el motor no toma nunca haga que la union deje de esperar a la recepcion y se evalue sin lote, en el motor o en la validacion |
| `30-entrada-al-cero-por-ciento` | La rama de Recoger termina por su cuenta; su unica entrada a la union esta al 0 %, y Tribunal llega en t=1 | Que se compruebe el camino hasta el origen de la entrada pero no el peso de la entrada misma: la union debe disparar en t=1, sin esperar hasta t=11 a una rama que nunca la alcanzara |
| `31-tres-convocatorias` | Las reclamaciones del 20 con un orquestador de 3 instancias: tres rondas en serie, cada una con su orquestador y tres solicitantes nuevos | Que las convocatorias se solapen, que la siguiente no empiece justo al acabar la anterior, que una ronda reutilice casos o que un mensaje, un lote o una anotacion pase de una ronda a otra |
| `32-convocatorias-que-empiezan-de-cero` | Tres rondas de un orquestador con dos personas, y una tarea que la cola da a quien menos ha trabajado y que lee un dato por defecto | Que los contadores de la cola pasen de una ronda a otra (Preparar iria a Carla en la segunda), o que los casos de las rondas 2 y 3 se queden sin sus datos por defecto |
| `33-tres-modos-de-llegada` | Dos convocatorias con tres pools de orquestados: uno escalonado cada 3 s, uno simultaneo y uno uniforme entre 0 y 20 | Que un modo se aplique como otro, que las llegadas cuenten desde el principio de la simulacion y no desde la apertura de su ronda, o que una llegada uniforme caiga fuera de su ventana o entre dos segundos |
| `34-llegadas-con-decimales` | Escalonados cada 0,1 s en dos rondas, y uniformes en la segunda, que se abre en t=5,3 | Que la comprobacion de las llegadas compare con la precision de la coma flotante y no con la del XES: el cuarto escalonado llega a los 0,3 s y 3 * 0,1 es 0.30000000000000004, asi que daba un falso error en las dos rondas |
| `35-proceso-base` | La convocatoria entera del plan con 10 residentes: la SACU publica, recibe hasta que no puede llegar nada, evalua una por solicitud, publica los aceptados y responde a cada uno; los residentes llegan al azar en 120 s, deciden con dos gateways de porcentajes (60 % aceptados, la mitad del resto reclama) y la SACU recibe, evalua y responde las reclamaciones | Cualquier pieza del proceso que el plan llama base: el lote de las dos recepciones, las evaluaciones y los envios multiinstancia, la cola de tres personas y los gateways |
| `con-avisos/envio-a-pool-externo` | Un mensaje dirigido al pool y no a un receptor | Que un envio que sale de la simulacion acabe en un error interno en vez de en un aviso |
| `con-avisos/mismo-usuario-en-dos-pools` | El mismo nombre declarado en dos pools | Que dos pools vuelvan a competir por el mismo recurso |
| `con-avisos/multiinstancia-con-numero-escrito` | Una convocatoria multiinstancia con numberOfExecutions=4 a dos casos | Que un numero que ya no se usa se ignore en silencio; N son los dos casos vivos |
| `con-avisos/carril-sin-pool` | El 08 con un carril sin nodos, sin carril padre ni subcarriles | Que sus personas se pierdan sin avisar: no hay de donde saber de que pool es |
| `con-avisos/llegadas-que-no-se-usan` | El 33 con frequency, modo y ventana en el orquestador, una ventana en el escalonado y una frequency en el simultaneo | Que lo que no se usa se ignore en silencio, o que se use: el orquestador llega al abrirse y todo se simula igual que en el 33 |
| `con-error/sin-destino` | Tres agencias escribiendo a cinco oficinas: ni 1 a N, ni N a 1, ni mismo numero | Que el motor se invente un emparejamiento en vez de decir que no hay ninguno |
| `con-error/respuesta-ambigua` | Dos recepciones del mismo pool unidas antes de una sola respuesta | Que el motor elija por su cuenta a cual de las dos responde |
| `con-error/respuesta-ambigua-desigual` | Lo mismo, con las dos recepciones a distinta distancia de la respuesta | Que la busqueda corte en la primera distancia y elija una rama en silencio |
| `con-error/multiinstancia-sin-cardinalidad` | Una tarea marcada que ni envia, ni recibe, ni tiene un lote antes | Que una marca sin fuente se simule con un numero inventado |
| `con-error/multiinstancia-hacia-pool-externo` | Un envio multiinstancia a un pool sin casos | Que se manden N copias a nadie |
| `con-error/evaluacion-de-dos-lotes` | Una evaluacion con dos recepciones multiinstancia antes | Que el motor elija en silencio cual de los dos lotes cuenta |
| `con-error/evaluacion-sin-lote-en-otra-rama` | Una bifurcacion paralela que manda un token a Recoger y otro directamente a Evaluar | Que se acepte la evaluacion porque hay una recepcion en alguno de sus caminos, y la otra rama evalue en t=0 sin lote |
| `con-error/evaluacion-sin-lote-por-union-inclusiva` | Recoger y Preparar abiertas por una bifurcacion inclusiva y juntadas en una union inclusiva antes de evaluar | Que una union que puede disparar solo con la rama de Preparar cuente como si garantizara el lote |
| `con-error/evaluacion-sin-lote-si-la-recepcion-se-desvia` | Bifurcacion paralela y union inclusiva, pero despues de Recoger una exclusiva puede cerrar por su cuenta | Que baste con que la bifurcacion sea paralela: si el token de Recoger se va al fin, la union deja de esperarlo y dispara sin lote |
| `con-error/evaluacion-sin-lote-segun-quien-llegue-antes` | Bifurcacion paralela y union inclusiva; la rama de Recoger siempre llega, pero despues de recoger puede volver a rehacer el tribunal, que es el origen de la otra entrada | Que se decida mirando una sola ordenacion de los tokens: el fallo solo aparece si Tribunal termina antes que la rama de Recoger |
| `con-error/evaluacion-sin-lote-con-entrada-al-cero-por-ciento` | El 30 con una evaluacion multiinstancia despues de la union, y el token de Recoger atascado para siempre en una union paralela, antes de su entrada al 0 % | Que la validacion compruebe el camino hasta el origen de la entrada pero no el peso de la entrada misma: la union esperaria al token atascado y no dispararia nunca, el modelo pasaria y el fallo llegaria al ejecutar |
| `con-error/evaluacion-con-demasiadas-combinaciones` | Union inclusiva tras una bifurcacion inclusiva de 20 salidas, con Recoger al 100 %: valido, pero con 2^19 combinaciones | Que se pongan a enumerar en vez de contarlas y rechazar al momento diciendo que no se ha podido comprobar |
| `con-error/evaluacion-con-demasiados-estados` | El 18 a lo ancho: Recoger y doce comprobaciones en paralelo hacia una union inclusiva. Valido, pero con demasiados ordenes posibles | Que la partida de tokens no tenga presupuesto y crezca sin limite; con presupuesto se rechaza diciendo que no se ha podido comprobar |
| `con-error/evaluacion-sin-lote-en-la-primera-vuelta` | Un bucle Evaluar, Recoger y otra vez Evaluar | Que la recepcion del camino de vuelta tape que la primera vuelta llega sin lote |
| `con-error/mensaje-sin-recoger` | Tres solicitudes y una sola recepcion declarada | Que dos mensajes enviados se queden sin recoger y la simulacion termine con buena cara |
| `con-error/mensaje-sin-recoger-en-la-primera-convocatoria` | Lo mismo con tres convocatorias | Que el estado de una ronda se tire sin mirar antes si se ha perdido algun sobre: la perdida desapareceria con el buzon. Se para al cerrar la primera |
| `con-error/mensaje-al-propio-pool` | Un mensaje dirigido directamente al participante que contiene al emisor | Que un envio al propio pool se acepte como externo en vez de rechazarse con un 400 |
| `con-error/usuario-ajeno-al-carril` | Una tarea asignada a alguien de otro carril | Que un modelo imposible se simule a medias en vez de rechazarse con un 400 |
| `con-error/ciclo-de-espera` | El solicitante espera un aviso que solo sale cuando cierra la recepcion a la que tiene que escribir | Que un ciclo de espera real se quede en «simulacion bloqueada» sin decir por que: el mensaje nombra la recepcion que no cierra, quien la mantiene abierta y que espera cada uno (3.4) |
| `con-error/ciclo-entre-dos-recepciones` | El comite recoge informes antes de publicar criterios, y cada evaluador recoge criterios antes de enviar su informe | Que dos recepciones multiinstancia que se esperan entre si no se reconozcan como ciclo |
| `con-error/ciclo-de-mensajes` | Dos casos que se esperan el mensaje el uno del otro, sin ninguna recepcion multiinstancia | Que el diagnostico solo sepa de lotes y no del ciclo de espera de siempre |
| `con-error/respuesta-que-no-llega` | Cuatro parejas; con la semilla del banco el servicio 4 archiva sin responder | Que una espera sin salida se confunda con un ciclo: nadie espera al cliente 4, es su mensaje el que ya no puede llegar |
| `con-error/union-que-no-dispara` | Una exclusiva que abre una rama y una paralela que espera las dos | Que el diagnostico se invente un ciclo donde solo hay una rama que ya no puede llegar |
| `con-error/llegada-uniforme-sin-ventana` | Un pool con llegada uniforme y sin arrivalWindow | Que el motor se invente una ventana |
| `con-error/modo-de-llegada-desconocido` | arrivalMode='poisson' | Que un modo que no existe se simule como escalonado |
| `con-error/ventana-de-llegada-con-decimales` | arrivalWindow=2.5 | Que las llegadas dejen de caer en segundos enteros |

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

Compara cinco cosas que no conviene confundir, y vigila seis más:

- **Comportamiento** — qué le ocurre a **cada caso**: qué eventos tiene, cuándo,
  con qué recurso y qué rama elige cada compuerta. Cualquier diferencia es un
  fallo, y el mensaje dice el caso, el evento, el atributo y los dos valores.
- **Organización** — en cuántas trazas se reparten los eventos de un caso y cómo
  se llaman. Eso cambió en las tareas 1.5 y 1.6 a propósito: se informa aparte y
  se acepta con `--acepta-reorganizacion`.
- **Metadatos** — desde la 4.4 cada modelo tiene un registro por pool, y cada
  uno se compara con el suyo: que falte o sobre uno es un cambio de
  comportamiento. Antes de comparar, los registros congelados de un modelo
  tienen que formar un conjunto: si se ha quedado el de un pool que ya no
  existe, la referencia es incoherente. `congelar.py` sustituye el conjunto
  entero, y retira los registros de pools que ya no salen. Su cabecera —la
  simulación, la referencia del modelo, el pool y su plantilla— tiene que ser la
  congelada. La huella de las reglas no cuenta los comentarios, así que comentar
  un modelo no cambia su referencia.
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
- **Sin bloqueos con otras semillas** — los modelos de `modelos/` y
  `modelos-con-avisos/` se ejecutan además con las semillas 1 a 3, y ninguno
  puede acabar con un error (`banco.SEMILLAS_SIN_BLOQUEO`). Es el «ningún falso
  positivo» de la 3.4: el diagnóstico solo se calcula cuando el motor ya se ha
  parado, así que lo que hay que vigilar es que un modelo correcto no se pare,
  por ejemplo porque una recepción no sepa descartar a un remitente. Al hacer
  la 3.4 se probaron veinticinco semillas sin ningún bloqueo.
- **Convocatorias en serie** — los modelos con varias rondas se miran en su
  referencia y con las semillas 1 a 3 (`banco.revisa_convocatorias`): cada
  ronda empieza justo cuando acaba la anterior —antes se solaparían, después
  algo, una recepción ya cerrada por ejemplo, la habría alargado sin hacer
  nada—; trae los mismos casos por pool que la primera, con índices que siguen
  a los de la anterior, y ningún mensaje sale de ella. El `31` corre además con
  las semillas 1 a 10, y en cada ronda se tiene que reevaluar y responder
  exactamente lo que se reclamó en ella; entre todas tiene que haber alguna en
  la que no reclama nadie, para que la recepción que cierra vacía esté
  cubierta (`banco.CRITERIO_DE_LAS_CONVOCATORIAS`).
- **Modos de llegada** — cada caso llega, contando desde que se abre su
  convocatoria, cuando dice el modo de su pool: escalonado, el i-ésimo
  (i - 1) · `frequency` después; simultáneo, al abrirse; uniforme, en un segundo
  entero entre 0 y `arrivalWindow`. El orquestador llega siempre al abrirse.
  Lo esperado sale de las reglas y lo ocurrido del XES: un caso llega en el
  primer instante de su traza. Se miran las referencias de todos los modelos,
  porque todos llegan de alguna manera, y el `33` con las semillas 1 a 10:
  ninguna llegada uniforme sale de su ventana y entre todas la llenan, con
  alguna en el primer cuarto, alguna en el último y la media cerca del centro
  (`banco.revisa_llegadas`). Los instantes se comparan con la precisión del
  XES, un milisegundo (`banco.PRECISION_DEL_XES`), y no con la de la coma
  flotante: el `34` llega cada 0,1 s.
- **El proceso base** — el `35` se ejecuta además con 100 residentes y las
  semillas 1 a 10 (`banco.CRITERIO_DEL_PROCESO_BASE`). Todos los que llegan
  presentan su solicitud, y se recibe, se evalúa y se responde exactamente eso;
  lo mismo con las reclamaciones. Los aceptados tienen que quedar alrededor del
  porcentaje declarado en las reglas, y los que reclaman alrededor del suyo:
  dentro de tres desviaciones típicas de la binomial, unos 4,6 puntos con mil
  residentes. Y la duración de una evaluación no puede depender de cuántas
  lleve ya quien la hace (D14): la segunda mitad de las de cada persona no puede
  durar más de un 10 % menos que la primera; con el aprendizaje por repetición
  del motor original durarían la mitad. Dice también cuánto tarda cada
  simulación.

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
python3 pruebas/valida_esquema.py
node pruebas/exporta_reglas.mjs
node pruebas/exporta_reglas.mjs --congela
```

El resto del banco ejecuta las reglas directamente. Este manda lo mismo que el
Modeler —`content` **y** `diagramXML`— por `POST /simulate`, con el cliente de
pruebas de Flask: pasa por `server.py` entero, JSON y códigos HTTP incluidos,
sin abrir ningún puerto.

- `integracion/<modelo>.bpmn` tiene que responder **200 con un registro por
  pool** (`logs`, cada uno con el ID y el nombre de su pool) que esté completo
  y sea coherente, con las **mismas trazas y metadatos** que ejecutando
  directamente las reglas de `<modelo>`, y con los mismos avisos. Solo cambia
  la referencia del modelo: por la API incluye la huella del diagrama, y tiene
  que ser la de lo mandado, igual que `simulationId`, `model` y
  `formatVersion` tienen que ser los de sus registros. `simulation`, el XES
  reunido que el Modeler muestra hasta la 5.5, tiene que ser la reunión de los
  registros. Aquí no hay nada congelado: la referencia es la ejecución
  directa. Si el modelo tiene tareas multiinstancia, se manda **otra vez sin
  ningún `multiInstanceType` en las reglas**: la marca tiene que llegar del
  dibujo (3.1) y las trazas tienen que ser las mismas. Y si sus pools tienen
  parámetros, **otra vez sin ellos** —`instances`, `participantMultiplicity`,
  `orchestrationRole`, `infiniteResources`, `arrivalMode` y `arrivalWindow`,
  como los exportaba el Modeler hasta la 5.4—: los aporta el diagrama (5.3),
  con las mismas trazas.
- Y por último, **como lo manda el Modeler** (5.4): el BPMN guardado y las
  reglas exportadas de `exportadas/<modelo>`, juntos, tienen que dar el mismo
  XES —trazas y metadatos, salvo la referencia de lo mandado— y los mismos
  avisos que las reglas de referencia con la misma semilla. Y **las reglas
  exportadas solas**, sin el diagrama, también: con el diagrama no se vería un
  parámetro que el exportador se dejara, porque desde la 5.3 el Backend lo
  tomaría del dibujo; sin él, las reglas tienen que llevarlo todo.
- Con la primera respuesta que trae varios registros se comprueba que la
  revisión de un conjunto (`simulator.registros.revisa_registros`) detecta los
  rotos —que no haya ninguno, que falte uno, que esté duplicado o mal formado,
  que no sea un XES, que sea de otra simulación, que traiga una traza de otro
  pool, que diga ser de otro, que a todos les falte la identificación, que a
  uno le falte la plantilla o que sean de otro formato— y que con ellos no se
  puede reunir la ejecución. Los metadatos obligatorios se exigen uno a uno:
  compararlos entre registros no basta, porque si faltan en todos coinciden.
  Los identificadores no pueden estar vacíos; los nombres sí, porque el parser
  admite `name=''`: la colaboración y un pool del 02 sin nombre se simulan por
  la API. Y que los mismos registros escritos de otra manera válida —en una
  sola línea, o con las etiquetas en `xes:`— se reúnen en un XES legible con
  las mismas trazas: las trazas se localizan por su posición en el XML, no por
  las líneas, y se copian con los espacios de nombres que necesitan.
- La identificación de la simulación se puede reproducir: el mismo modelo con
  la misma semilla da la misma, y con otra semilla, o sin el diagrama, otra.
- Lo que aporta el diagrama se valida como si viniera en las reglas (5.3): con
  las reglas del `33` sin parámetros de pool, un diagrama con la llegada
  uniforme sin `arrivalWindow`, o con `instances="0"`, se rechaza con el mismo
  mensaje que daría en las reglas. Una frecuencia escrita con exponente, como
  la escribe JavaScript —`1e-7`, que es 0.0000001—, se lee y coincide con la
  de las reglas. Y la semilla guardada en el diagrama
  —`collab:seed` en la colaboración del `33`, `model:seed` en el proceso del
  `01`— manda cuando la petición no trae ninguna: con la del banco da las
  mismas trazas que la ejecución directa, y con otra, otra simulación.
- `integracion-con-error/<modelo>--<variante>.bpmn` es un diagrama roto, o uno
  que no cuenta lo mismo que las reglas de `<modelo>`. Tiene que fallar con un
  400 o un 422 y el mensaje congelado en `esperado/integracion/`. Un 200 o un
  500 no se congelan nunca. Desde la 5.3 están también los parámetros del pool
  y la semilla guardados en el diagrama: un `instances` que no coincide con el
  de las reglas, un modo de llegada que no existe, una semilla que no es un
  entero y una que no coincide con la de la petición.

Por qué hace falta: el motor simula las **reglas**, no el diagrama. Si el
exportador del Modeler descarta o cambia algo, o si reglas y diagrama vienen de
versiones distintas, la API simulaba otro modelo y respondía 200. Sin el cruce
de `validate_diagram_correspondence`, los cinco diagramas de correlación rota de
`integracion-con-error/` daban **200**.

Los diagramas están **generados** con `bpmn_desde_reglas.py` y congelados como
ficheros, no dibujados: así cada diagrama cuenta exactamente lo mismo que las
reglas de su modelo. Lo que el Modeler hace con ellos —abrirlos, guardarlos y
exportar sus reglas— lo comprueba `exporta_reglas.mjs` con el código del
Modeler (ver [Lo que manda el Modeler](#lo-que-manda-el-modeler)). Lo que sí llevan es lo
que el Modeler guarda hoy: la estructura BPMN, los atributos de sus
descriptores —desde la 5.1 también los del pool: `instances`,
`orchestrationRole`, `infiniteResources`, `arrivalMode` y `arrivalWindow`, con
los mismos nombres que en las reglas—, las listas de personas dentro de
`bpmn:extensionElements` —desde la 5.2— y los dos marcadores estándar,
`participantMultiplicity` y `multiInstanceLoopCharacteristics`. Que el XML es
BPMN de verdad no lo dice el Backend sino `valida_bpmn.mjs`, con bpmn-moddle
—la librería con la que bpmn-js abre un diagrama— y los descriptores del
Modeler; necesita `npm install` hecho en `Modeler/`. Se abren en el Modeler.

`valida_bpmn.mjs` comprueba además que **abrir y guardar no cambia nada**, que
es lo que pasa cada vez que alguien abre un diagrama en el Modeler y lo vuelve a
guardar. Ahí es donde se vio que las listas de usuarios estaban mal escritas:
son listas de elementos, y escritas como un atributo con comas bpmn-moddle las
abre como una cadena y las guarda letra a letra —Ana se convertía en A, n y a—.
El generador escribe un elemento por usuario en tareas, procesos, pools y
carriles, dentro de `bpmn:extensionElements` desde la 5.2 (ver más abajo).

`valida_bpmn.mjs` comprueba también que **los atributos propios de cada pool
sobreviven a abrir y guardar** (5.1): leídos sin descriptores, tal como están
escritos en el fichero, tienen que salir escritos igual, y con los descriptores
del Modeler se tienen que leer con su tipo —`instances` y `arrivalWindow`
enteros, `frequency` número, `infiniteResources` booleano—. Comparar lo abierto
con lo reabierto no basta: con `frequency` declarada como entero, `0.1` se leía
como `0` al abrir, y lo reabierto coincidía con ese `0`. Por eso el `34`, que
llega cada 0,1 s, tiene diagrama.

`valida_bpmn.mjs` abre cada diagrama, además, **como otras herramientas**: con
bpmn-moddle sin los descriptores del Modeler, que es como lo ve cualquiera, y
con los de Camunda 7 y Camunda 8 —`camunda-bpmn-moddle` y `zeebe-bpmn-moddle`,
los que carga Camunda Modeler, y que vienen con las dependencias del Modeler—.
Ninguna puede avisar de nada, tienen que ver todos los elementos BPMN y todas
las marcas —lo que el motor lee del dibujo—, y lo que guardan, abierto otra vez
con los descriptores del Modeler, tiene que ser lo mismo: guardar desde otra
herramienta no pierde nada del simulador.

Hasta la 5.1 no era así. Las listas de personas —quién hace cada tarea y la
plantilla de cada carril, pool y proceso— se guardaban como elementos hijos
directos, `<user:UserTask>Ana</user:UserTask>` dentro de la tarea, y el esquema
de BPMN 2.0 solo admite elementos de otros espacios de nombres dentro de
`bpmn:extensionElements`. Otra herramienta avisaba al abrir el fichero
(*unparsable content*) y las descartaba. Desde la 5.2 van ahí, con las mismas
etiquetas:

```xml
<bpmn:task id="Preparar" user:minimumTime="30" user:maximumTime="60">
  <bpmn:extensionElements>
    <user:userTask>Ana</user:userTask>
  </bpmn:extensionElements>
  ...
```

`valida_esquema.py` lo comprueba contra el **esquema oficial de BPMN 2.0**
(`esquema-bpmn/`, los XSD de OMG con el espacio de nombres `20100524`), que es
lo que mira una herramienta estricta antes de aceptar un fichero: todo
`integracion/` y todo `integracion-con-error/` lo tiene que cumplir —están rotos
para el simulador, no para BPMN—, salvo `--xml-mal-formado`, que sigue sin ser
XML. Y todo `formato-anterior/` lo tiene que **incumplir**, por una lista del
Modeler fuera de su sitio: si el esquema aceptara los ficheros de antes, no
estaría distinguiendo nada. Necesita `lxml`, que viene con PM4Py.

Los ficheros de antes se siguen abriendo: el Modeler los migra al abrirlos
(`Modeler/lib/people/`). `formato-anterior/` tiene cuatro, guardados por el
Modeler de la 5.1 —el `10` con las tres marcas puestas desde el menú de
reemplazo, y uno del `01` con un rol añadido desde el panel; al `08` y al `10`
se les ha añadido después el nombre de la colaboración, como lo habría guardado
aquel Modeler, cuando el generador empezó a escribirlo (5.4)—, y
`valida_bpmn.mjs` les pasa esa misma migración: cada lista tiene que pasar
entera a `extensionElements`, no quedar nada en el sitio antiguo, abrir sin
avisos en las otras herramientas y, si hay uno del mismo nombre en
`integracion/`, salir igual que él.

Por último, `valida_bpmn.mjs` comprueba los **números del panel**
(`Modeler/lib/numbers/`): cada valor que el panel acepta en las frecuencias,
las instancias y la ventana de llegada se guarda con los descriptores, se abre
otra vez y, escrito como lo muestra el panel, el panel lo tiene que volver a
aceptar con el mismo valor; y lo que no vale —negativos, `1e400`, enteros con
decimales o mayores que 9007199254740991— se tiene que rechazar. JavaScript
guarda 0.0000001 como `1e-7`, y un panel que solo admitiera decimales sin
exponente marcaba como inválido lo que acababa de guardar.

### Lo que manda el Modeler

`exporta_reglas.mjs` hace con cada diagrama de `integracion/` lo mismo que el
Modeler al abrirlo y pulsar **Simular**, con su mismo código: lo abre con
bpmn-moddle y los descriptores, migra las listas del formato anterior
(`Modeler/lib/people`), recorre los elementos con el `BpmnTreeWalker` de
bpmn-js —que decide el orden en que el Modeler los pinta y los exporta, y el
motor depende de ese orden: barajar las líneas de las reglas cambia el XES de
32 modelos— y exporta las reglas con `Modeler/lib/rules`, el exportador del
Modeler. Guarda el diagrama como el Modeler, con `moddle.toXML`, y con lo único
que bpmn-js cambia al pintarlo: `isMarkerVisible` en las compuertas
exclusivas. El resultado, `exportadas/<modelo>.txt` y `exportadas/<modelo>.bpmn`,
es byte a byte lo que manda el Modeler de verdad: así se comprobó en un
navegador con los 22 diagramas.

Sin argumentos compara lo exportado hoy con lo congelado y dice desde qué línea
cambia; con `--congela` lo vuelve a escribir, y solo si todos los diagramas se
abren sin avisos. `integracion.py` usa lo congelado —desde Python no se puede
ejecutar el Modeler—, así que si cambia el exportador o un diagrama hay que
pasar los dos: primero este, que muestra lo que cambia, y luego la integración,
que dice si sigue simulando lo mismo. Necesita `npm install` hecho en
`Modeler/`. `valida_esquema.py` comprueba también que lo guardado cumple el
esquema de BPMN 2.0.

Si cambia un modelo que tiene diagrama, se regenera con
`python3 pruebas/bpmn_desde_reglas.py pruebas/modelos/<modelo>.txt`, se vuelve
a pasar `valida_bpmn.mjs` y se congela otra vez lo exportado con
`node pruebas/exporta_reglas.mjs --congela`. El generador escribe desde la 5.4
el nombre de la colaboración: es el `model:name` de los registros, y sin él el
Modeler exporta `"Unnamed"`.

## El coste del proceso base

```
python3 pruebas/mide_proceso_base.py
python3 pruebas/mide_proceso_base.py --casos 10 50 100 500 1000 --semillas 5
```

Ejecuta el `35` cambiando solo el número de residentes, con cinco semillas por
cada N, y reparte el tiempo de una simulación entre simular —el proceso hijo
que corre SimPy—, los registros —revisar y reunir los XES de cada pool— y el
resto —leer y validar las reglas, generar el script y leer los ficheros—. Los
tiempos dependen de la máquina y no entran en la regresión; lo que importa es
cómo crecen con N. En la máquina en la que se escribió esto (Python 3.10, Linux):

| N | total medio | simular | registros | resto | eventos | XES | dura (simulado) |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 10 | 0,11 s | 0,09 s | 0,00 s | 0,01 s | 148 | 118 KB | 353 s |
| 50 | 0,19 s | 0,15 s | 0,02 s | 0,02 s | 748 | 583 KB | 981 s |
| 100 | 0,29 s | 0,23 s | 0,03 s | 0,03 s | 1.509 | 1.173 KB | 1.788 s |
| 1.000 | 2,65 s | 1,83 s | 0,37 s | 0,45 s | 16.124 | 12.375 KB | 16.321 s |

Con 10 residentes casi todo es arrancar el proceso hijo; de 100 en adelante el
coste crece en proporción a N, tanto el de simular como el de los registros, y
mil residentes caben de sobra en el plazo de 300 s. Lo que crece también es la
convocatoria simulada: con tres personas evaluando, la cola de la SACU es el
cuello de botella, y eso es justo lo que el experimento quiere medir (D4).

## Los registros con PM4Py

```
python3 pruebas/lee_con_pm4py.py
```

Necesita `pip install pm4py`, que no es una dependencia del Backend. Como
`valida_bpmn.mjs` con los diagramas, mira con una herramienta ajena que los
registros congelados se pueden usar sin el motor: PM4Py lee cada uno, con
tantas trazas y eventos como tiene el fichero y las fechas como fechas; los de
un mismo modelo son de la misma simulación, están todos los pools esperados y,
reunidos, tienen todos los casos; y la plantilla de cada pool sale de su
registro, así que se sabe quién está libre en cada instante sin consultar unas
reglas que pueden haber cambiado. En el `32` Carla no trabaja en ninguna ronda,
y en el `08` Diana está en un subcarril de reserva sin ninguna tarea: las dos
tienen que salir libres de principio a fin. Los metadatos que tienen partes
—la plantilla, los carriles, los roles— son listas XES anidadas y no
contenedores, porque PM4Py lee las listas y se salta los contenedores.

## Un banco vacío no es un banco en verde

Los comandos se niegan a comparar o congelar si falta un grupo de casos o
está vacío: `modelos/`, `modelos-con-avisos/` y `modelos-con-error/` en el banco
del motor, `integracion/`, `integracion-con-error/` y `exportadas/` en el de
integración, la carpeta de diagramas y `formato-anterior/` en `valida_bpmn.mjs`,
`integracion/` en `exporta_reglas.mjs`, y las cuatro carpetas de diagramas en
`valida_esquema.py`. Sin esa comprobación, perder una
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
