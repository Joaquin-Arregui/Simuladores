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
  exportadas, con el código del Modeler (ver más abajo). En
  `exportadas/ejemplos/`, las reglas de los ejemplos del Modeler.
- `../../Modeler/ejemplos/` — no son del banco, pero el banco los comprueba: los
  ejemplos del Modeler, dibujados y guardados en él (5.6). Hoy, el proceso
  base, que cuenta el modelo `35`.
- `linea_de_tiempo.mjs` — la línea de tiempo del visualizador
  (`Modeler/lib/timeline`) con todos los registros congelados (ver
  [La línea de tiempo](#la-línea-de-tiempo)).
- `capa_de_dibujo.mjs` — la capa de dibujo del visualizador
  (`Modeler/lib/drawing`) en un Chromium de verdad: las marcas siguen a su
  elemento (ver [La capa de dibujo](#la-capa-de-dibujo)).
- `escena.mjs` — las pelotas de los casos y los sobres del visualizador
  (`Modeler/lib/scene`), con todos los registros congelados y en un Chromium
  de verdad (ver [La pelota del caso y el sobre](#la-pelota-del-caso-y-el-sobre)).
- `zonas.mjs` — las tres zonas de cada tarea del visualizador, con sus
  recuentos contados también sobre el XES, y sus insignias en un Chromium de
  verdad (ver [Las tres zonas de cada tarea](#las-tres-zonas-de-cada-tarea)).
- `colores.mjs` — el color de cada caso, constante y distinto en su pool, en
  sus pelotas y en sus sobres, en un Chromium de verdad (ver
  [El color de cada caso](#el-color-de-cada-caso)).
- `plantilla.mjs` — la plantilla de cada pool, la de su registro, con quién
  está libre u ocupado, con qué ejecución y para qué solicitud, y la cola del
  pool, contrastadas con el XES y en un Chromium de verdad (ver
  [El orquestador y sus recursos](#el-orquestador-y-sus-recursos)).
- `reproduccion.mjs` — la reproducción del visualizador: convocatoria,
  filtro de casos e instante, con el reproductor sin navegador y con el
  Modeler compilado en un Chromium de verdad (ver
  [La reproducción](#la-reproducción)).
- `carga.mjs` — cargar de disco los registros de una simulación y su
  diagrama: lo que se comprueba antes de reproducirlos, la fluidez con 100
  casos y que guardada y cargada otra vez se ve igual (ver
  [La carga de los registros](#la-carga-de-los-registros)).
- `navegador.mjs` — lo que comparten las pruebas en navegador: servir los
  ficheros y abrir Chromium.
- `interfaz.mjs` — la interfaz del Modeler en un Chromium de verdad: abrir,
  los paneles, el menú de reemplazo, Ctrl+S, Simular y los registros (ver
  [La interfaz](#la-interfaz)).
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
| `36-tareas-instantaneas` | Dos casos, en t=0 y t=30, con dos tareas de duracion cero seguidas de una que dura diez segundos | Que las tareas instantaneas desaparezcan de las consultas de la linea de tiempo, pierdan su identidad u orden, ocupen tiempo inventado o se repitan entre ventanas consecutivas |
| `37-recogida-antes-de-la-otra-espera` | Dos ramas del orquestador llegan a la misma recepcion y el orquestado le manda dos solicitudes por el mismo flujo. La rama A recoge la primera a los 7 s y espera a Ana hasta los 20; la B espera la segunda de 8 a 10. Las dos activaciones tienen la ejecucion 1 y el mismo remitente | Que el visualizador tome la espera de mensaje de una activacion por la de otra: daba la primera solicitud por recogida a los 10 s y la mostraba en el buzon a los 8 (6.3) |
| `38-lotes-simultaneos` | Dos ramas activan a la vez el mismo envío multiinstancia a dos destinatarios; los lotes salen en t=11 y t=16 | Que la escena mezcle sus ejecuciones por el orden de fin y vacíe una salida en t=10. Se comprueba contra los eventos de fin, sin reconstruir activaciones |
| `39-evaluar-con-cinco-personas` | La comisión evalúa siete solicitudes con cinco personas. Ana prepara el acta en otra rama hasta los 37 s: de 23 a 37 evalúan cuatro y esperan tres en la cola del pool, y de 37 a 60, cinco a la vez: a los 49 Dani pasa a la 6 y a los 52 Carlos a la 7. Gema convoca, recoge y responde; Hugo no tiene ninguna tarea. La recogida cancela su espera de más a los 22 s | Que el visualizador saque la plantilla de las reglas y no del registro, pierda a quien no trabaja, no vea a Ana ocupada en otra tarea, cuente en la cola la espera cancelada o atribuya una evaluación a quien no la hace (6.6) |
| `40-proceso-base-con-100` | El `35` con 100 residentes: una convocatoria de 101 casos que acaba a los 1825 s; quedan aceptados 59, se rechazan sin reclamar 19 y reclaman 22, y a los 900 s los 100 esperan su resultado a la vez | Que el visualizador no reproduzca con fluidez una convocatoria de 100 casos cargada de disco, dibuje cientos de pelotas en vez de una insignia, saque los resultados o la plantilla de un diagrama cambiado en vez del registro, o no se vea igual guardada y cargada otra vez (6.8) |
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
node pruebas/interfaz.mjs
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
  `formatVersion` tienen que ser los de sus registros. Y no puede traer más
  campos que esos, los registros y los avisos: `simulation`, el XES reunido que
  el Modeler mostraba hasta la 5.5, se retiró en la 5.6. Aquí no hay nada
  congelado: la referencia es la ejecución
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
- Los **ejemplos del Modeler**, `Modeler/ejemplos/<ejemplo>.bpmn` (5.6), se
  mandan como los manda el Modeler: el fichero tal cual y las reglas que el
  Modeler exporta de él, `exportadas/ejemplos/<ejemplo>.txt`, **sin semilla en
  la petición**. Cada uno cuenta un modelo de referencia
  (`MODELO_DE_CADA_EJEMPLO` en `integracion.py`; `proceso-base`, el `35`) y
  tiene que dar el XES de sus reglas con la semilla del banco, que es la que
  lleva guardada, y sus mismos avisos; y sus reglas solas, con esa semilla,
  también. Así se comprueba que el proceso base se dibuja y se simula sin
  escribir un fichero de reglas. Un ejemplo sin modelo, o un modelo sin su
  ejemplo, es un fallo.
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

Los ejemplos del Modeler son la excepción, a propósito: el proceso base
(`Modeler/ejemplos/proceso-base.bpmn`) está dibujado en el Modeler, con todo lo
de la simulación escrito en sus paneles y puesto con su menú de reemplazo,
porque lo que prueba es que se puede dibujar y simular sin escribir reglas
(5.6). `valida_bpmn.mjs`, sin argumentos, y `valida_esquema.py` lo comprueban
como a los generados.

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
las instancias, la ventana de llegada, los tiempos de una tarea y el porcentaje
de una rama se guarda con los descriptores, se abre otra vez y, escrito como lo muestra el panel, el panel lo tiene que volver a
aceptar con el mismo valor; y lo que no vale —negativos, `1e400`, enteros con
decimales o mayores que 9007199254740991— se tiene que rechazar. JavaScript
guarda 0.0000001 como `1e-7`, y un panel que solo admitiera decimales sin
exponente marcaba como inválido lo que acababa de guardar. Y hasta la 5.6 el
descriptor leía los tiempos de una tarea y los porcentajes como enteros: 2.5
se guardaba bien, pero al volver a abrir el fichero era 2. Lo que se perdía era
el parámetro del
modelo: la duración simulada la redondea el motor al segundo en cualquier caso
(ver `Backend/README.md`), pero entre los extremos que dice el modelo.

Y comprueba **los registros que ofrece el Modeler** (`Modeler/lib/logs/`, 5.5):
con los registros congelados de cada modelo en `esperado/`, puestos como los
devuelve la API, el Modeler tiene que ofrecer uno por pool, en su orden, con un
fichero distinto que lleve el nombre de su pool y con tantos casos como trazas.
Y con nombres que no sirven tal cual —vacíos, repetidos aunque sea con otras
mayúsculas, con caracteres que Windows no admite, reservados como `CON` —también
con extensión, como «Aux. mantenimiento» o «CON.txt», porque Windows mira lo
que hay antes del primer punto—, o iguales al ID de otro pool— los ficheros
tienen que seguir siendo distintos y ser los esperados; y lo que solo se parece
a un reservado, como «Auxiliar», se queda como está.

### Lo que manda el Modeler

`exporta_reglas.mjs` hace con cada diagrama de `integracion/` lo mismo que el
Modeler al abrirlo y pulsar **Simular**, con su mismo código: lo abre con
bpmn-moddle y los descriptores, migra las listas del formato anterior
(`Modeler/lib/people`), recorre los elementos con el `BpmnTreeWalker` de
bpmn-js —que decide el orden en que el Modeler los pinta y los exporta, y el
motor depende de ese orden: barajar las líneas de las reglas cambia el XES de
32 modelos— y exporta las reglas con `Modeler/lib/rules`, el exportador del
Modeler. Guarda el diagrama como el Modeler, con `moddle.toXML` y con formato
—un elemento por línea, desde la 5.6—, y con lo único que bpmn-js cambia al
pintarlo: `isMarkerVisible` en las compuertas exclusivas. El resultado,
`exportadas/<modelo>.txt` y `exportadas/<modelo>.bpmn`, es byte a byte lo que
manda el Modeler de verdad: así se comprobó en un navegador con los 22
diagramas, y con el ejemplo lo comprueba cada vez `interfaz.mjs`.

Hace lo mismo con los ejemplos del Modeler, `Modeler/ejemplos/`, pero de ellos
solo congela las reglas, en `exportadas/ejemplos/`: un ejemplo ya es lo que
guarda el Modeler, así que abierto y guardado otra vez tiene que salir igual,
byte a byte, y lo que se manda al simularlo es el propio fichero. Si se vuelve
a dibujar o se cambia en el Modeler, se congela otra vez con `--congela`.

Sin argumentos compara lo exportado hoy con lo congelado y dice desde qué línea
cambia; con `--congela` lo vuelve a escribir, y solo si todos los diagramas se
abren sin avisos. `integracion.py` usa lo congelado —desde Python no se puede
ejecutar el Modeler—, así que si cambia el exportador o un diagrama hay que
pasar los dos: primero este, que muestra lo que cambia, y luego la integración,
que dice si sigue simulando lo mismo. Necesita `npm install` hecho en
`Modeler/`. `valida_esquema.py` comprueba también que lo guardado cumple el
esquema de BPMN 2.0.

### La interfaz

`interfaz.mjs` prueba lo que solo existe en la página, con el Modeler compilado
en un Chromium de verdad y el proceso base de `Modeler/ejemplos/`:

- Se abre con **Open Existing Model** y se pinta entero, y **Ctrl+S** lo guarda
  igual, byte a byte. Con acentos en un nombre, también, y en UTF-8.
- **Simular** manda exactamente lo que `integracion.py` manda a la API —las
  reglas de `exportadas/ejemplos/` y el propio fichero, sin semilla—. Con la
  respuesta de la API, los registros congelados del `35`, la ventana ofrece
  uno por pool con su nombre, sus casos y su fichero, y cada descarga es el
  registro tal cual, en UTF-8, también con acentos en el nombre del pool.
- Los paneles validan como el Backend, y lo que no vale se marca y no se
  guarda: los tiempos de una tarea —iguales valen; un máximo menor que el
  mínimo, no; 2.5 sobrevive a guardar y abrir—, el porcentaje de una rama —la
  suma se explica y no se exige; más de 100, o todas las ramas a 0, no se
  guardan—, las instancias del pool, la semilla y el nombre de la raíz.
- El menú de reemplazo pone y quita la marca de multiinstancia de una tarea y
  la de multiplicidad de un pool, y las dos llegan al fichero y a las reglas.
- Las personas de una tarea se añaden en el panel y llegan a
  `extensionElements` y a las reglas.

En ninguna puede salir una ventana emergente ni un error en la consola. No
hace falta el Backend: **Simular** se responde con la respuesta de la API, que
es la que `integracion.py` comprueba, así que entre los dos cubren el camino
entero, del clic al XES. Compila el Modeler como `npm run bundle`, pero en una
carpeta temporal: prueba siempre las fuentes de hoy y no toca `example/dist`.
Necesita `npm install` en `Modeler/` —trae Playwright— y, una vez,
`npx playwright install chromium`; con un Chromium ya instalado, se le puede
indicar con `CHROMIUM_PATH`. Tarda en torno a un minuto. Que detecta lo que
tiene que detectar se comprobó volviendo a poner, a la vez, el campo de
porcentajes anterior a la 5.6, un mínimo igual al máximo como error, el
guardado en una sola línea y la descarga de `downloadjs` sin codificar: falla
en las cuatro pruebas que los cubren.

Si cambia un modelo que tiene diagrama, se regenera con
`python3 pruebas/bpmn_desde_reglas.py pruebas/modelos/<modelo>.txt`, se vuelve
a pasar `valida_bpmn.mjs` y se congela otra vez lo exportado con
`node pruebas/exporta_reglas.mjs --congela`. El generador escribe desde la 5.4
el nombre de la colaboración: es el `model:name` de los registros, y sin él el
Modeler exporta `"Unnamed"`.

## La línea de tiempo

```
node pruebas/linea_de_tiempo.mjs
```

El visualizador saca lo que ocurrió solo de los registros (D15), con
`Modeler/lib/timeline`. Este script le pasa los de todos los modelos de
`esperado/` y comprueba:

- Que cada evento es una pieza de la línea, con un ID que no se repite y un
  intervalo que no acaba antes de empezar, en el orden de su traza; y que el
  mismo registro escrito en una sola línea o con las etiquetas en `xes:` da la
  misma línea.
- Que **ningún caso desaparece mientras vive**: en cada instante entre su
  primer evento y el último tiene algo activo. Es lo que faltaba antes de la
  6.1: una recepción multiinstancia que cerraba vacía dejaba al caso en
  ninguna parte —el orquestador del `21`, entre 56 y 57—, porque la ejecución
  que esperaba un sobre más se iba sin registrar su espera. Desde la 6.1 queda
  como un `StandByMessage` cancelado, y el script repite la comprobación con el
  `21` sin esas esperas para ver que entonces sí encuentra el hueco.
- Que las solicitudes cuadran: la de una recepción es quien mandó el sobre, y
  la de una respuesta, a quien va.
- Lo que tiene que haber en instantes concretos, comprobado a mano con los
  registros: dos ramas paralelas y una que espera a la otra en la unión (`03`);
  las tres vueltas de un bucle, cada una con su ID (`03`); las diez
  ejecuciones de «Evaluar una propuesta», tres trabajando y siete esperando a
  una persona, cada una con su solicitud (`35`); las esperas canceladas de una
  recepción con sobres y de una vacía (`35`, `21`); dos activaciones a la vez
  de la misma recepción, las dos con la ejecución 1 y cada una con su ID, y la
  respuesta que vuelve a quien escribió (`12`); y cuándo llega y cuándo
  termina un residente (`35`).
- Que las tareas de duración cero (`36`, XES generado por el motor) aparecen
  en `passedBetween` con su identidad, estado, persona y orden originales.
  Las ventanas excluyen el inicio e incluyen el fin, sin repetir las tareas
  al avanzar; solo la tarea de diez segundos aparece activa en `at`.
- Que un registro roto —sin cerrar, que no es XML, con una fecha que no se
  entiende, dos registros pegados en un fichero o uno con algo detrás— no da
  una línea de tiempo a medias. De dos pegados se quedaba con el primero, sin
  decir nada (6.8): ahora el lector de XML exige un documento entero, con un
  solo elemento raíz y nada más que espacios fuera de él.

Las esperas canceladas y `bpmn:request` cambiaron los registros congelados de
los modelos con mensajes: se volvieron a congelar después de comprobar que lo
único distinto eran las esperas canceladas —40, en los modelos con recepciones
multiinstancia—, `bpmn:request` y, por las esperas nuevas, la numeración de
`bpmn:occurrence`.

## La capa de dibujo

```
node pruebas/capa_de_dibujo.mjs
```

El visualizador dibuja sus marcas en una capa del lienzo de bpmn-js
(`Modeler/lib/drawing`, 6.2). Este script abre el proceso base en el bpmn-js de
las dependencias del Modeler, con esa capa, y le pone seis marcas: en el centro
de una tarea, de un evento y de una compuerta, en la esquina de otra tarea, a
mitad de un flujo y a un cuarto de un flujo de mensaje. Cada vez comprueba que
cada marca está en la pantalla donde bpmn-js pinta su elemento —en el ancla de
su forma, y la de un flujo sobre el trazo y en el punto que da el navegador
con `getPointAtLength`—, con una tolerancia de 0,05 píxeles:

- al abrir, al arrastrar el diagrama con el ratón y al desplazarlo con la
  rueda;
- al ampliarlo y al reducirlo con Ctrl y la rueda, y al encajarlo en la
  ventana;
- al mover una tarea con el ratón, desde debajo de su marca: la marca la sigue
  y la del flujo que sale de ella va a su nuevo trazo;
- con un clic sobre una marca, que tiene que seleccionar el elemento de debajo;
- al borrar un elemento con Supr, cuando su marca se tiene que ocultar, y al
  deshacer con Ctrl+Z, cuando tiene que volver a su sitio;
- al cambiar el ID de una tarea, con el mismo comando que el campo ID del
  panel General: su marca se tiene que ocultar, porque las marcas van por ID y
  ese ya no existe, y seguir oculta al mover la tarea con el ratón, al borrarla
  y al deshacer el borrado y el movimiento; al deshacer el cambio de ID tiene
  que volver a su sitio, y al rehacerlo, ocultarse otra vez. Hasta que se
  corrigió, la marca se quedaba visible donde estaba, porque el cambio llega
  con el ID nuevo;
- y al abrir otro diagrama, cuando no puede quedar ninguna.

bpmn-js redondea los codos de los flujos y eso acorta su trazo: con codos, el
punto de la capa puede alejarse del del navegador hasta 5 unidades del diagrama
por codo, pero siempre tiene que quedar sobre el trazo. Para ver que la
comprobación distingue, se saca la capa del grupo que bpmn-js transforma y se
amplía: las seis marcas tienen que dejar de estar en su sitio. Antes, sin
navegador, prueba la geometría: las anclas de una caja y el punto a una
fracción de un recorrido, con codos, tramos de longitud cero y fracciones fuera
de rango. Necesita lo mismo que `interfaz.mjs`: `npm install` en `Modeler/` y,
una vez, `npx playwright install chromium`, o `CHROMIUM_PATH`.

## La pelota del caso y el sobre

```
node pruebas/escena.mjs
```

Con la línea de tiempo y la capa de dibujo, el visualizador dibuja en cada
instante una pelota por cada ejecución o espera activa de un caso y un sobre
por cada mensaje (`Modeler/lib/scene`, 6.3). Primero, sin navegador, el script
construye la escena de cada modelo de `esperado/`, con los flujos de sus
reglas, y comprueba:

- Que cada envío tiene la recepción que recoge su sobre, y cada recepción un
  solo envío, de su pareja de casos y por su flujo de mensaje; que nadie recoge
  un sobre antes de que salga, ni después de empezar la recepción; que cada
  sobre tiene su ID; y que su solicitud es la de su remitente o la de su
  destinatario, con los números de esos casos.
- Que lo que hay en cada buzón cuadra por cuentas, sin emparejar nada: en cada
  instante, los sobres que han salido hacia él menos los que su caso ha
  recogido, que son sus recepciones empezadas y sus esperas a una persona en
  curso —una ejecución de una recepción recoge su sobre y enseguida espera a
  una persona o trabaja—. Es lo que no cuadraba en el `37`: con dos
  activaciones de la misma recepción, las dos con la ejecución 1 y el mismo
  remitente, la escena tomaba la espera de mensaje de la segunda por la de la
  primera, que ya tenía su sobre y esperaba a Ana, y lo enseñaba en el buzón
  de 7 a 10 s.
- En cada instante en que cambia algo y a mitad de cada dos: una pelota por
  cada pieza activa de la línea de tiempo, con el número de su caso dentro de
  su pool; los casos de cada pool contados una vez, tengan las pelotas que
  tengan; y cada sobre visible solo entre que sale y que lo recogen.
- Que el tránsito es cosmético: con él están las mismas pelotas, en los mismos
  elementos y estados, y los mismos casos; solo cambia dónde se dibujan —sobre
  un flujo que llega a su elemento, o el sobre sobre su flujo de mensaje— y se
  ven además los sobres que acaban de salir. Y que el instante no depende de
  cómo se llega a él: recorrer los instantes hacia delante y hacia atrás da lo
  mismo.
- Lo que pide la tarea: en el 1:1 (`02`), el cliente 1 espera la respuesta en
  su tarea de 16 a 120 s mientras el servicio 1 recibe, atiende y responde, y
  con tránsito la petición va a mitad de su flujo a los 18 s sin que el cliente
  deje de esperar; en un paralelo, varias pelotas del mismo caso que cuentan
  como un caso: dos ramas (`03`), una recepción y una tarea a la vez (`12`) y
  las diez ejecuciones del lote del SACU (`35`); y los sobres de un mismo caso:
  los tres que el orquestador 1 tiene a la vez en el buzón de la convocatoria
  (`10`), cada uno para su orquestado; los de una misma pareja, uno detrás de
  otro, en orden (`25`, `26`, `27`); y los dos del `37`, que se recogen a los
  7 y a los 10 s: a los 8 el buzón está vacío.

Para ver que las comprobaciones distinguen, se repiten con tres escenas
estropeadas a propósito, que tienen que fallar: una que cuenta las pelotas como
casos (`35`), una que reparte al revés los dos sobres de un mismo buzón (`25`)
y una cuyo tránsito retrasa el instante (`02`).

Después, en el bpmn-js de las dependencias del Modeler con `lib/scene`, abre
los diagramas de `integracion/` del `02`, el `10` y el `35` con sus registros y
comprueba en la pantalla: la pelota del cliente 1 dentro de su tarea, con su
número y el borde discontinuo de esperar, y el reloj en «t = 60 s»; a los 18 s
con tránsito, el sobre sobre el trazo de su flujo de mensaje, «1→1» con el
número de la solicitud en negrita, y la pelota del cliente, que es la misma
marca que a los 60 s; las pelotas dentro de sus elementos al ampliar; los tres
sobres de la convocatoria, encima de su recepción y en orden de llegada; las
diez pelotas del SACU 1, cada una en su sitio; y que al abrir otro diagrama —el
del `01`— no queda ni una marca ni el reloj, ni la simulación anterior: `show`
tiene que dar error sin dibujar nada hasta que se carguen los registros del
nuevo, y con ellos dibuja los suyos; `clear()` también la descarga. Antes se
quedaba con la simulación, y `show(60)` volvía a dibujar las marcas y el reloj
de la anterior sobre el diagrama nuevo. Necesita lo mismo que
`capa_de_dibujo.mjs`.

## Las tres zonas de cada tarea

```
node pruebas/zonas.mjs
```

Cada tarea del visualizador tiene tres zonas (`Modeler/lib/scene/zones.js`,
6.4): la cola a la entrada, lo que está dentro y lo bloqueado a la salida —las
ejecuciones ya terminadas de una activación que aún no ha salido: las de un
lote que esperan a las demás, o las vueltas ya hechas de un bucle—, y cada una
cuenta sus ejecuciones, de cuántos casos son, de cuántos casos son las
solicitudes que tienen en la mano y, en la cola de una recepción, los sobres de
su buzón. Sin navegador, el script comprueba con cada modelo de `esperado/`,
con los flujos de sus reglas:

- Que esos recuentos **cuadran con el XES**, en cada instante en que empieza o
  acaba algo y a mitad de cada dos. Aquí se cuentan sobre los eventos del XES,
  leídos con expresiones regulares, sin la línea de tiempo ni la escena: a la
  entrada, las esperas (`StandBy…`) en curso; dentro, el resto de eventos con
  fin en curso; a la salida, las ejecuciones terminadas cuya activación
  (`bpmn:activation`) aún tiene alguna pieza sin terminar; y en el buzón, los
  sobres enviados menos los recogidos. Todas las tareas deben llevar identidad
  de activación, también sus esperas. No se excluyen los lotes repetidos.
- Que dos lotes simultáneos en la misma tarea (`38`) conservan sus propias
  salidas: se cuentan los envíos terminados menos dos por cada evento de fin,
  sin usar el identificador ni reconstruir los tiempos del lote. Al quitar
  la identidad de un registro ambiguo, la escena pide volver a simular.
- Que el tránsito no cambia ni los recuentos ni lo bloqueado, y que lo hay: sin
  los flujos no habría ninguna pelota ni ningún sobre en tránsito, y la
  comprobación pasaría sin mirar nada.
- Que **con N = 50** (`14`) se ve acumularse el lote: Recoger se activa a los
  100 s, cuando el orquestador acaba de convocar a los 50; su salida crece sin
  bajar nunca hasta 49 a los 745 s, con la última solicitud dentro, y a los
  746 se vacía, cuando Responder empieza con 49 en la cola y una dentro; su
  cola baja y su salida crece igual. Siempre un solo caso, el orquestador, con
  una solicitud de cada orquestado.
- **Con paralelismo**: dos ramas del mismo caso en la cola de Recoger cuentan
  un caso (`37`, a los 8 s), y la que ya salió no se queda a la salida aunque la
  otra siga dentro (`37`, a los 21,5 s); dos ramas en dos tareas (`03`) y una
  recepción y una tarea a la vez (`12`); y las vueltas de un bucle a la salida
  (`03`).

Para ver que las comprobaciones distinguen, se repiten con tres escenas
estropeadas a propósito, que tienen que fallar: una que cuenta cada ejecución
como un caso (`14`), una sin salida (`35`) y una que agrupa la salida por caso y
elemento, sin activaciones, que en el `37` dejaría a la salida la recepción de
la rama A cuando ya ha salido.

Después, en el bpmn-js de las dependencias del Modeler con `lib/scene`,
comprueba en la pantalla: las tres franjas de Evaluar_Propuestas del `35` a los
200 s, con sus dos líneas y sus nombres, y cada pelota en la suya —cuatro en la
cola, tres dentro y tres a la salida—; que una evaluación que termina pasa a la
salida en la misma marca; que con el umbral en 2 las tres zonas son insignias
rotuladas con sus recuentos —también con el umbral escrito como texto, «2»— y
sin él vuelven las pelotas; que con N = 50 la
salida de Recoger crece en la pantalla —10, 20, 30, 40 y 49— y a los 745 s es
una insignia de 49 ejecuciones de un caso, con la última pelota dentro, y la
cola de Esperar_Resultado, una de 50 casos; que con tránsito, a los 746,5 s,
las 49 respuestas que acaban de llegar a la cola de Responder van en su
insignia sin dibujarse en el flujo, y a los 18 s el buzón lleno cuenta también
los sobres que aún van de camino; que a los 200 s el buzón de
Esperar_Convocatoria, con 36 sobres para orquestados que aún no han llegado, es
un sobre «× 36»; y que al ampliar todo sigue en su franja.

También comprueba que pelotas, insignias y buzones no tapan el nombre de la
tarea, que este no se recorta al encajar el diagrama, que sigue legible con
zoom y al editar, y que se restaura al salir o ejecutar `clear()`. Dibujar y
limpiar no cambian el XML. `SCENE_SCREENSHOT` permite guardar una captura del
modelo 35 con las tres insignias.

Los registros se han actualizado al formato 2, que añade `bpmn:activation`
y cambia la versión y el ID de simulación. Antes de congelarlos se compararon
los 45 modelos anteriores excluyendo solo esos tres atributos: no cambió
ningún evento, tiempo, persona, mensaje ni otro metadato.

El `14` no tenía diagrama: se generó para esto con `bpmn_desde_reglas.py`, y con
él entra también en el banco de integración y en `exportadas/`. Necesita lo
mismo que `capa_de_dibujo.mjs`.

## El color de cada caso

```
node pruebas/colores.mjs
```

Cada caso tiene su color, constante de principio a fin y distinto del de los
demás casos de su pool, y sus sobres —los de los que es la solicitud— llevan el
mismo (`Modeler/lib/scene/colors.js`, 6.5). Sin navegador, el script comprueba
la paleta:

- Que los ocho primeros son la paleta categórica de referencia de la guía de
  visualización, en su orden, y que hasta el caso 1000 no se repite ninguno;
  sin número, el neutro.
- Que no depende del orden en que se pidan: otra copia del módulo, pidiendo
  primero el 700, da los mismos.
- Que dos casos seguidos se distinguen: al menos 15 de distancia con visión
  normal y 8 con daltonismo rojo o verde (OKLab × 100), y que el número de cada
  pelota se lee sobre su color, a 3,9:1 o más.
- Que en cada pool de cada modelo de `esperado/` los números de los casos no se
  repiten: con eso, dos casos del mismo pool nunca comparten color.

Después, en el bpmn-js de las dependencias del Modeler con `lib/scene`, recorre
todos los instantes del `02`, el `35` y el `10`, y a mitad de cada dos, sin
tránsito y con él, y mira lo que de verdad pinta: que cada caso lleva siempre
el mismo color, el de su número, en todas sus pelotas y en cualquier zona; que
dos casos del mismo pool nunca lo comparten; que cada sobre lleva el color del
caso de su solicitud; y que el número va en la tinta que mejor se lee. Con el
umbral en 1, que las insignias de un solo caso —el lote del SACU 1— se tiñen
con su color aclarado y las de varios —los diez residentes que esperan el
resultado— quedan blancas, y que el buzón lleno de la convocatoria del `10`, de
un solo orquestador, lleva su color, y el del `27` a los 2 s, con avisos de dos
servicios, es blanco. Para ver que las comprobaciones distinguen, se repiten
con lo dibujado estropeado a propósito —el color cambiando con la zona, ocho
colores repartidos en ciclo y el sobre del color de su remitente— y cada una
tiene que fallar. Necesita lo mismo que `capa_de_dibujo.mjs`.

## El orquestador y sus recursos

```
node pruebas/plantilla.mjs
```

La plantilla de cada pool sale de la cabecera de su registro, no de las reglas
(`Modeler/lib/scene/staff.js`, 6.6). Sin navegador, con todos los modelos de
`esperado/` y contrastado con el XES leído con unas expresiones regulares, sin
la línea de tiempo ni la escena, el script comprueba:

- Que la plantilla de cada pool es la de `pool:staff`, en su orden y con el
  carril de cada persona, también con quien no trabaja nunca: Carla en el `32`,
  Diana —de Reserva— en el `08` y Hugo en el `39`, libres de principio a fin.
- Que en cada instante en que empieza o acaba algo, y a mitad de cada dos, cada
  persona está ocupada justo con los eventos en curso que la nombran
  (`bpmn:userTask`), con su ID de ejecución, su tarea, su número de ejecución,
  su solicitud y su intervalo; con recursos finitos, nunca con dos a la vez.
- Que la cola de cada pool son sus esperas a una persona en curso, de cualquier
  tarea, por orden de llegada; que con recursos infinitos no hay nunca nadie
  en ella; y que una espera cancelada no está nunca en la cola ni en manos de
  nadie.
- Lo que pide la tarea, con el `39`: a los 30 s evalúan cuatro y Ana, que
  también evalúa, sigue en otra tarea —prepara el acta— mientras su cola
  espera las solicitudes 5, 6 y 7; a los 40 s, las cinco asignaciones, cada
  una con su solicitud y el intervalo del XES; la espera de más de la recogida,
  cancelada a los 22 s, no la tiene nadie, y Gema queda libre al recoger la
  última; y a los 49 s Dani suelta la 3 y toma la 6 en el mismo instante.

Para ver que las comprobaciones distinguen, se repiten con plantillas
estropeadas a propósito —la de las reglas de ahora, sin Hugo; una sin quien no
trabaja; una que alarga cada evaluación hasta su duración máxima; y una cola
con la espera cancelada— y cada una tiene que fallar.

También comprueba dónde va la plantilla (`placeRoster`), con un pool y
obstáculos puestos a mano: a la derecha si cabe; si no, deslizándose por ese
lado, a la izquierda, debajo o encima; y sin sitio, por debajo de lo que la
taparía. En 2000 disposiciones al azar no tapa nunca nada.

Después, en un Chromium de verdad, con el `39`: lo que dicen las dos
plantillas dibujadas en todos sus instantes, igual que el XES; que cada una
está a la derecha de su pool, sin solaparse, y que `fit()` las encaja en el
lienzo; que con los solicitantes a 50 a la derecha de la comisión —donde su
plantilla tapaba `Ini_S`— la de la comisión pasa a su izquierda, y con ellos a
50 a su izquierda, la suya pasa a la izquierda de ellos, en todos los
instantes, pegadas a su pool, siempre en el mismo sitio y sin tapar ninguna
forma, nada de lo demás dibujado ni la otra plantilla; que a los 40 s las cinco pelotas de Evaluar dicen «Ana 5», «Bea 1»,
«Carlos 2», «Dani 3» y «Eva 4», dentro de su franja, sin taparse ni tapar el
marcador de multiinstancia; y que, cambiadas después las reglas en el
diagrama —sin Hugo, Evaluar solo para Ana y otro nombre para la comisión—,
también guardado, abierto otra vez y con los registros cargados después, y en
el `08` borrado el carril de Diana, la plantilla sigue siendo la del registro,
comprobado también que el XML guardado ya no los tiene; y que `fit()` no cuenta
las marcas ocultas de un elemento borrado. Con el `01`, un Process, la
plantilla va a la derecha de todo el diagrama. Lo dibujado
estropeado —sin Hugo, o con Ana en la ejecución de Bea— tiene que fallar.
Necesita lo mismo que `capa_de_dibujo.mjs`.

## La reproducción

```
node pruebas/reproduccion.mjs
```

La barra de reproducción del Modeler (6.7) con el reproductor
(`Modeler/lib/player`). Sin navegador, con todos los modelos de `esperado/`:

- Las convocatorias: cada caso en una, cada una con la ventana de sus casos, y
  una detrás de otra; en el `31`, de 0 a 88, de 88 a 151 y de 151 a 217 s.
- El filtro, «1-3, 7», y once que no se entienden —también números enormes,
  que antes colgaban la página—; y que el resumen de cada
  pool —en curso, por llegar y terminados— no cambia con el filtro en ninguno
  de los 1151 instantes, salvo cuántos se ven.
- El reloj: avanza desde su último punto de partida sin acumular errores —a
  × 3, 16 s en fotogramas de 16 ms son exactamente 48 s—, se para al final, en
  pausa se queda donde se paró o se saltó, y al cambiar de velocidad sigue
  desde donde estaba.
- La convocatoria como alcance: la escena de cada convocatoria de cada modelo
  con más de una, hecha con solo sus casos (`timeline.only`), tiene en cada
  instante las pelotas, los recuentos de las zonas, la plantilla y la cola de
  la escena de toda la simulación quedándose con lo de sus casos; en el `31`,
  al acabar la primera, a los 88 s, nadie está ocupado y la cola está vacía, y
  en la segunda, a los 88, Ana está ocupada y hay dos en la cola; igual a los
  151 s con la segunda y la tercera.

Después, el Modeler compilado como con `npm run bundle`, en una carpeta
temporal, y en un Chromium de verdad con el reloj de la página en la mano
(`page.clock`): avanza solo cuando la prueba lo dice, en fotogramas de 16 ms.
Simular se responde con los registros congelados, y se reproduce sobre el
diagrama de integración de su modelo:

- **Reproducir y saltar dibujan lo mismo**: el `39` entero a × 5, y en cada
  uno de sus 108 fotogramas, las mismas pelotas —caso, elemento, estado, zona,
  ejecución y persona—, sobres, insignias, buzones, plantillas y reloj que
  saltando a ese instante exacto. Mientras se reproduce, el tránsito mueve las
  marcas, y un sobre que se recoge en el acto se ve llegar aunque ya esté
  recogido: eso es cosmético y no cuenta. Al pausar, el dibujo es idéntico,
  también dónde está cada marca, al de saltar ahí y al de salir, volver a
  entrar y saltar ahí. Saltar mientras se reproduce —con el instante exacto,
  «cambio siguiente» o la barra de tiempo— y cambiar de velocidad siguen
  exactamente desde ahí, e **Ir** sin haber escrito nada no mueve el instante,
  aunque el campo lo muestre redondeado. En el `14`, con el buzón lleno y las
  insignias, lo mismo en 50 fotogramas.
- **Con eventos simultáneos y cancelaciones**: reproduciendo a × 1
  exactamente hasta los 22 s del `39` —la recogida cancela su espera de más—,
  los 23 —cuatro evaluaciones empiezan y tres esperan a la vez—, los 37 y los
  49, lo dibujado es lo de saltar ahí y lo de llegar con «cambio siguiente».
- **El filtro no cambia ningún recuento**: en el `39`, con los solicitantes
  «3, 5-6», se ven sus pelotas y las de la comisión, y solo los sobres entre
  casos que se ven; las insignias, los buzones, las plantillas y el resumen son
  los de antes, salvo cuántos se ven, también reproduciendo. En el `14`, con 50
  orquestados y «1-3», las insignias y el buzón «× 36» siguen como estaban. Un
  filtro que no se entiende se marca, se explica y no filtra.
- **La convocatoria**, con el `31`: se elige una de las tres o todas, la barra
  de tiempo va de su principio a su fin, solo se ven sus casos y el resumen
  cuenta los suyos. Es el alcance también de la plantilla y de la cola: en los
  bordes, a los 88 y a los 151 s, cada convocatoria solo tiene lo suyo
  —contrastado con la plantilla de toda la simulación quedándose con sus
  casos—, y con todas, a los 88 s Ana ya trabaja para el orquestador 2. El
  filtro, dentro de la segunda, conserva sus recuentos.
- El salto exacto, sin redondear —22,123456789 s—, y fuera de la ventana, a su
  borde; **Salir** no deja nada dibujado y devuelve los botones de simular y
  el foco a **Reproducir**; abrir otro diagrama cierra la reproducción, y
  **Reproducir** no se activa hasta simularlo; mientras se simula, tampoco; y
  la barra no tapa la paleta ni el logotipo de bpmn.io, tampoco a 1366 × 768.
- **Otro diagrama mientras se simula**: con el `39` simulándose se abre el
  `01`; al llegar la respuesta, del `39`, **Reproducir** sigue desactivado, no
  se dibuja nada y el estado lo explica. Simulando el `01`, se activa.

Ninguna puede sacar una ventana emergente ni un error en la consola. Se ha
comprobado que las comprobaciones distinguen con diez versiones estropeadas:
un reloj que suma pasos, insignias que cuentan solo lo que se ve, marcas que
no se borran de un fotograma a otro, un resumen que cuenta solo lo que se ve,
un salto que no reinicia el reloj mientras se reproduce, una barra que tapa la
paleta, un Ir que salta a lo redondeado, un Reproducir que sigue activo con
otro diagrama, uno que se activa con la respuesta de un diagrama que ya no
está abierto y una convocatoria que solo filtra lo que se dibuja; todas
fallan. Necesita lo mismo que `interfaz.mjs`.

## La carga de los registros

```
node pruebas/carga.mjs
```

Cargar de disco el conjunto de XES de una simulación y su BPMN (6.8). Sin
navegador:

- **La huella del diagrama** (`Modeler/lib/logs/sha256.js`) es la de Node —la
  misma `sha256` en UTF-8 que calcula el Backend—, con acentos, emojis, los
  bordes de bloque de 55, 56 y 64 bytes, 200.000 caracteres y todos los
  diagramas de `integracion/`.
- **Los conjuntos buenos pasan** (`Modeler/lib/logs/checks.js`): los
  registros de todos los modelos de `esperado/`, solos y con su diagrama de
  integración, leído como lo lee el Modeler antes de abrirlo —con bpmn-moddle y
  sus descriptores—; así se comprueba también que el diagrama tiene dibujados
  todos los elementos por los que pasan sus casos. Como se congelaron sin
  diagrama, avisa de que no se puede comprobar que sea el simulado; con la
  huella de su diagrama puesta en la cabecera, como la escribe el Backend
  cuando el Modeler se lo manda, no avisa, tampoco con el diagrama guardado con
  `\r\n`; y con el diagrama cambiado, avisa de que no es el que se simuló.
- **Los conjuntos rotos se rechazan**, cada uno diciendo por qué; los rompe a
  partir del `39`, que tiene dos pools: ninguno, falta uno, duplicado, mal
  formado, no es XES, dos simulaciones pegadas en un fichero —con distinta
  `simulation:id`—, con texto detrás del registro, de otra simulación, de otro
  modelo, con otra base temporal, con registros de dos simulaciones —uno del
  `39` y otro del `40`—,
  con una traza de otro pool, dado como de otro pool, sin identificación, sin
  plantilla, de otro formato, uno que sobra, uno solo de un modelo de dos, una
  traza sin `bpmn:participant`, un caso repetido con otro `concept:name` y un
  `<log>` de otro espacio de nombres. Uno solo de un modelo de un participante
  —el `01`— sí vale. Con un diagrama que no es el suyo: los del `39` con el del
  `40` —la misma raíz, sin `Pool_Comision`— y con el del `01`, los del `39` con
  el suyo sin la forma de `Pool_Solicitante`, los del `20` con el del `14` —la
  misma raíz y los mismos pools, pero sin la mayoría de sus elementos— y los del
  `40` con el suyo sin la forma de `Esperar_Resultado`, también si esa forma
  solo está en un segundo diagrama que bpmn-js no dibuja —de lo mismo, o de
  otro proceso—; con dos diagramas enteros, vale. Y lo que el Modeler lee
  de un `.bpmn` sin abrirlo —su raíz, sus pools y lo dibujado— es lo que se lee
  aquí por otro camino en los 50 diagramas de `integracion/` y `exportadas/`;
  un XES, un texto, un XML mal formado y un BPMN sin diagrama que dibujar no se
  leen como diagrama.
- **El Backend dice lo mismo**: `simulator/registros.py`, desde `python3`,
  acepta el `39` y el `40` y rechaza los rotos que comprueba él —todos menos
  ninguno y el formato, que el visualizador también lee en el 1—, igual que el
  Modeler. Y la huella que calcula el Modeler de cada diagrama de
  `integracion/`, y de uno con acentos y emojis, es la que les pone el Backend
  (`huella_del_diagrama`). `python3` se llama con `-X utf8`, para que lea los
  registros y los diagramas en UTF-8 sea cual sea la configuración regional:
  en Windows los leía como CP1252 y la huella del que lleva acentos y emojis no
  coincidía.

Después, el Modeler compilado, en un Chromium de verdad y con su reloj, con el
`40`: el proceso base con 100 residentes, 101 casos en una convocatoria de
1825 s.

- **Cargado de disco, con fluidez**: con **Cargar registros**, los dos XES y
  su diagrama; reproduciendo a × 50 durante 4 s, cada instante se dibuja con
  una mediana de 8 ms como mucho y un p95 de 16 ms —lo mide la propia página
  con User Timing—, y el navegador sigue a 60 fotogramas por segundo —mediana
  de 20 ms entre fotogramas y p95 de 34 ms como mucho—. A los 900 s los 100
  residentes esperan su resultado: una insignia de 100, sin pelotas.
- **Recursos y resultados del registro**: con el diagrama cambiado —sin
  Carlos, y aceptando el 10 % en vez del 60 %—, avisa de que no es el que se
  simuló, pero la plantilla sigue con Ana, Bea y Carlos, y al final el
  resumen dice «fin: Aceptada 59, Rechazada sin reclamar 19, Reevaluada 22»,
  lo que dice el registro.
- **Guardada y cargada otra vez**: simulada —el Backend se responde con los
  registros del `40` y la huella del diagrama que se le manda—, se guarda con
  **Descargar el diagrama** y **Descargar todos**, y se carga en una página
  nueva: a los 0, 150, 450, 900, 1500 y 1825 s, lo dibujado y el resumen son
  los mismos, y no avisa de nada, porque el diagrama es el simulado. Guardada
  otra vez desde esa página, son los mismos ficheros, byte a byte.
- **Lo que no vale no se carga**: uno solo de un modelo de dos, uno de otra
  simulación, uno repetido, dos simulaciones pegadas en un fichero, los del
  `39` con el diagrama del `40`, un fichero
  que no es ni XES ni BPMN, un `.bpmn` que no es un diagrama, uno sin nada que
  dibujar, el diagrama sin una tarea por la que pasan los casos, unos
  registros que pasan las comprobaciones pero no se pueden reproducir —un
  evento sin `time:timestamp`—, un `.bpmn` con dos diagramas cuyo primero —el
  que dibuja bpmn-js— no tiene esa tarea, uno con una entidad que bpmn-moddle
  acepta y el visualizador no lee (`&nbsp;`), y uno con Scheduler; dice por
  qué, en un solo mensaje y sin ventanas emergentes, sigue abierto el diagrama
  de antes y no se activan **Reproducir** ni **Última simulación**. Arrastrados
  al lienzo, se cargan igual. Sin su diagrama, sobre el abierto, no se ofrece
  descargar el abierto como el simulado. Mientras se simula no se cargan, y se
  dice por qué. Una respuesta del Backend que no es del diagrama abierto no se
  puede reproducir, y el estado dice por qué. Y cargada, si se borra del
  diagrama una tarea por la que pasan sus casos, **Reproducir** ya no la
  reproduce y dice qué falta.

Ninguna puede sacar una ventana emergente ni un error en la consola. Se ha
comprobado que las comprobaciones distinguen con veinticinco versiones
estropeadas: sin mirar si falta algún pool, sin comparar la cabecera común,
un lector de XML que admite varias raíces o texto fuera de la raíz,
una huella que siempre coincide, una que no pasa `\r\n` a `\n`, un sha256
con la longitud mal, sin mirar los elementos del diagrama, contando pools sin
forma, contando lo que hay en todos los diagramas de un `.bpmn` y no solo en
los que dibuja bpmn-js, leyendo un BPMN sin diagrama que dibujar, aceptando
trazas sin
participante, sin mirar el espacio de nombres, un Modeler que carga aunque no
valgan, uno que abre el diagrama antes de compararlo, uno que no prepara la
reproducción antes de abrirlo, uno que carga mientras se simula, uno que
ofrece el diagrama abierto como el simulado, uno que no vuelve a comparar al
reproducir, uno que no explica un error al leer el diagrama, uno que avisa del
Scheduler en una ventana, los registros en otro orden, un
resumen sin resultados, sin insignias y un dibujo que tarda 20 ms; todas
fallan. Necesita lo mismo que `interfaz.mjs`, y `python3` con lo del Backend.

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
en el `08` Diana está en un subcarril de reserva sin ninguna tarea, y en el `39`
Hugo está en la plantilla de la comisión sin ninguna: las tres tienen que salir
libres de principio a fin. Los metadatos que tienen partes
—la plantilla, los carriles, los roles— son listas XES anidadas y no
contenedores, porque PM4Py lee las listas y se salta los contenedores.

## Un banco vacío no es un banco en verde

Los comandos se niegan a comparar o congelar si falta un grupo de casos o
está vacío: `modelos/`, `modelos-con-avisos/` y `modelos-con-error/` en el banco
del motor, `integracion/`, `integracion-con-error/`, `exportadas/` y
`Modeler/ejemplos/` en el de integración, la carpeta de diagramas,
`Modeler/ejemplos/` y `formato-anterior/` en `valida_bpmn.mjs`, `integracion/` y
`Modeler/ejemplos/` en `exporta_reglas.mjs`, las cinco carpetas de diagramas
en `valida_esquema.py`, y el ejemplo, sus reglas exportadas y los registros
congelados del `35` en `interfaz.mjs`, los registros de `esperado/` en
`linea_de_tiempo.mjs`, el ejemplo en `capa_de_dibujo.mjs`, y los registros de
`esperado/`, las reglas de cada uno y los diagramas del `01`, el `02`, el `10` y
el `35` en `escena.mjs`, los registros de `esperado/` y los diagramas del
`14` y el `35` en `zonas.mjs`, y los registros de `esperado/` y los diagramas
del `02`, el `10`, el `27` y el `35` en `colores.mjs`, y los registros de
`esperado/` —con el `39`— y los diagramas del `39`, el `08` y el `01` en
`plantilla.mjs`, y los registros de `esperado/` —con el `39`, el `31` y el
`14`— y sus diagramas en `reproduccion.mjs`, y los registros de `esperado/`
—con el `40`, el `39` y el `01`— y sus diagramas en `carga.mjs`. Sin esa
comprobación, perder una
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
