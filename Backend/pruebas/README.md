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
| `con-avisos/envio-a-pool-externo` | Un mensaje dirigido al pool y no a un receptor | Que un envio que sale de la simulacion acabe en un error interno en vez de en un aviso |
| `con-avisos/mismo-usuario-en-dos-pools` | El mismo nombre declarado en dos pools | Que dos pools vuelvan a competir por el mismo recurso |
| `con-error/sin-destino` | Tres orquestados escribiendo a un orquestador de un caso | Que un mensaje sin caso destino se pierda en silencio en vez de denunciarse |
| `con-error/usuario-ajeno-al-carril` | Una tarea asignada a alguien de otro carril | Que un modelo imposible se simule a medias en vez de rechazarse con un 400 |

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

Compara cuatro cosas que no conviene confundir:

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

## Reproducibilidad

La semilla (`20260101`) y la fecha de inicio (`2026-01-01T00:00:00+00:00`) están
fijas en `banco.py`. Sin las dos, el XES no es reproducible y estos ficheros no
valdrían como referencia. Hace falta `simpy==4.1.1`, la versión del
`requirements.txt`: con otra, las referencias podrían no reproducirse.

## Cuando el cambio es intencionado

Revisar lo que dice la regresión, comprobar que el cambio es el que se buscaba, y
entonces `congelar.py`. Nunca al revés: si se congela primero, nadie llega a ver
qué cambió.
