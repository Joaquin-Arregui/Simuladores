#!/usr/bin/env python3
"""Ejecuta los modelos de referencia y congela su XES en pruebas/esperado/.

    python3 pruebas/congelar.py

La semilla y la fecha de inicio van fijas aqui: sin las dos, el XES no es
reproducible y los ficheros congelados no valdrian como referencia. La
regresion de la tarea 1.4 compara contra lo que deja este script.

Funciona en dos fases, y el orden importa: primero ejecuta TODOS los modelos
en memoria, y solo escribe si todos han terminado sin errores y sin avisos. Un
congelado a medias es peor que ninguno, porque la regresion compararia contra
una mezcla de referencias viejas y nuevas sin que nadie se entere. Un aviso del
validador cuenta como fallo: los modelos de referencia tienen que correr
limpios, para que un aviso nuevo se note en vez de pasar inadvertido.
"""
import os
import sys
from pathlib import Path

AQUI = Path(__file__).resolve().parent
sys.path.insert(0, str(AQUI.parent))
os.environ["SIMULATION_START_DATE"] = "2026-01-01T00:00:00+00:00"

from simulator.main import processSimulation  # noqa: E402

SEMILLA = 20260101
MODELOS = AQUI / "modelos"
ESPERADO = AQUI / "esperado"


def ejecuta_todos():
    """Ejecuta cada modelo sin tocar el disco.

    Devuelve (resultados, problemas): los XES listos para escribir y los
    nombres de los modelos que han fallado o han avisado.
    """
    resultados, problemas = [], []
    for ruta in sorted(MODELOS.glob("*.txt")):
        try:
            resultado = processSimulation(ruta.read_text(encoding="utf-8"), seed=SEMILLA)
        except Exception as error:
            print("%-24s ERROR   %s: %s" % (ruta.name, type(error).__name__, error))
            problemas.append(ruta.name)
            continue
        if resultado.warnings:
            print("%-24s AVISOS" % ruta.name)
            for aviso in resultado.warnings:
                print("         %s" % aviso)
            problemas.append(ruta.name)
            continue
        print("%-24s ok      %d trazas, %d eventos" %
              (ruta.name,
               resultado.simulation.count("<trace>"),
               resultado.simulation.count("<event>")))
        resultados.append((ruta.stem, resultado.simulation))
    return resultados, problemas


def main():
    if not MODELOS.is_dir():
        print("No existe la carpeta de modelos: %s" % MODELOS)
        return 1

    resultados, problemas = ejecuta_todos()

    if not resultados and not problemas:
        print("No hay ningun modelo que congelar en %s." % MODELOS)
        return 1

    if problemas:
        print()
        print("No se ha escrito nada. Han fallado: %s." % ", ".join(problemas))
        print("Las referencias de %s se quedan como estaban." % ESPERADO.name)
        return 1

    ESPERADO.mkdir(exist_ok=True)
    for nombre, xes in resultados:
        (ESPERADO / (nombre + ".xes")).write_text(xes, encoding="utf-8")
    print()
    print("Congeladas %d referencias en %s/." % (len(resultados), ESPERADO.name))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
