# Banco de pruebas

Modelos de referencia congelados. Son el punto de comparación del refactor:
mientras el comportamiento no deba cambiar, su XES no debe cambiar.

## Qué hay aquí

- `modelos/` — las reglas de cada modelo, en el formato que exporta el Modeler.
- `esperado/` — el XES congelado de cada modelo. **No se edita a mano.**
- `congelar.py` — reejecuta los modelos y reescribe `esperado/`.

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

## Qué viene después

La tarea **1.4** añade `regresion.py`, que reejecuta estos modelos y compara
contra `esperado/` en vez de sobrescribirlo, señalando qué traza y qué evento no
cuadran.
