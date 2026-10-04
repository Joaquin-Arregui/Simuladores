# Banco de pruebas

Modelos de referencia congelados. Son el punto de comparación del refactor:
mientras el comportamiento no deba cambiar, su XES no debe cambiar.

## Qué hay aquí

- `modelos/` — las reglas de cada modelo, en el formato que exporta el Modeler.
- `esperado/` — el XES congelado de cada modelo. **No se edita a mano.**
- `congelar.py` — reejecuta los modelos y reescribe `esperado/`.
- `regresion.py` — reejecuta los modelos y **compara** con `esperado/`.

## Los tres modelos

| Modelo | Qué cubre | Qué rompe si se rompe |
| --- | --- | --- |
| `01-simple.txt` | Un proceso, dos instancias, dos tareas en serie, dos usuarios | Lo básico: duraciones, cola de usuarios, formato del XES |
| `02-colaboracion.txt` | Colaboración 1:1 con tres parejas de instancias y mensajes en los dos sentidos | El emparejamiento de mensajes: que el cliente 2 hable con el servicio 2 y no con otro |
| `03-uniones-y-bucle.txt` | Unión paralela, bifurcación y unión inclusivas, y una tarea que se repite | Tokens y uniones: que la unión inclusiva espere solo a las ramas que de verdad se abrieron |

## Cómo se regenera

```
python3 pruebas/congelar.py
```

Funciona en dos fases: primero ejecuta **todos** los modelos en memoria y solo
escribe `esperado/` si **todos** han terminado sin errores y sin avisos. Si
alguno falla, no se toca ni un fichero y sale con código 1.

Ese todo-o-nada es a propósito. Un congelado a medias es peor que ninguno: la
regresión compararía contra una mezcla de referencias viejas y nuevas sin que
nadie se entere. Y un aviso del validador cuenta como fallo, para que los
modelos de referencia corran limpios y un aviso nuevo se note en vez de pasar
inadvertido entre otros diez.

## Por qué está congelado así

La semilla (`20260101`) y la fecha de inicio (`2026-01-01T00:00:00+00:00`) van
fijas dentro de `congelar.py`. Sin las dos, el XES no es reproducible y estos
ficheros no valdrían como referencia.

Se congeló **después** de fijar la semilla (tarea 1.1) y de retirar el
aprendizaje por repetición (tarea 1.2), que es lo que ese orden perseguía: si se
hubieran congelado antes, el cambio de duraciones habría invalidado la referencia
el mismo día.

## La regresión

```
python3 pruebas/regresion.py
python3 pruebas/regresion.py --acepta-reorganizacion
```

Separa dos cosas que no conviene confundir:

- **Comportamiento** — qué le ocurre a **cada caso**: qué eventos tiene, cuándo,
  con qué recurso y qué rama elige cada compuerta. Mientras no se cambie el
  motor a propósito, esto no puede cambiar: cualquier diferencia es un fallo, y
  el mensaje dice el caso, el evento, el atributo y los dos valores.
- **Organización** — en cuántas trazas se reparten los eventos de un caso y cómo
  se llaman. Las tareas 1.5 y 1.6 van a separarlas por participante, y eso es
  legítimo: se informa aparte y se acepta con `--acepta-reorganizacion`.

**La línea entre las dos está en el caso, no en la traza.** Los eventos se
agrupan por caso *antes* de comparar, y la comparación ocurre dentro de cada
caso. Aceptar la reorganización no es ignorar a quién pertenece cada evento: si
la respuesta del cliente 1 acabara en el cliente 2, sigue siendo un fallo aunque
las trazas se hayan reorganizado. Esa es justo la rotura que vigila el modelo 02,
y comparar un conjunto global de eventos no la vería, porque el conjunto global
no cambia al intercambiar dos respuestas.

Si la reorganización además renumera los casos, hay que declararlo:

```
python3 pruebas/regresion.py --acepta-reorganizacion --correspondencia pruebas/correspondencia.json
```

con un JSON `{"caso nuevo": "caso de referencia"}`. Sin él se asume que los
identificadores no cambian, y un caso que aparece o desaparece es un fallo — no
un detalle de formato.

Por eso la comparación no es un diff del XES. Un diff fallaría entero el día que
se separen las trazas, y la tentación entonces sería relajarlo hasta que dejara
de avisar de nada.

También avisa de una referencia huérfana —un `.xes` cuyo modelo ya no existe—
para que `esperado/` no acumule restos.

## Cuando el cambio es intencionado

Revisar lo que dice la regresión, comprobar que el cambio es el que se buscaba,
y entonces `congelar.py` para fijar la nueva referencia. Nunca al revés: si se
congela primero, nadie llega a ver qué cambió.
