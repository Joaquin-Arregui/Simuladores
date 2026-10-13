#!/usr/bin/env python3
"""Mide lo que cuesta simular el proceso base (4.6) con 10, 50 y 100 residentes.

    python3 pruebas/mide_proceso_base.py
    python3 pruebas/mide_proceso_base.py --casos 10 50 100 500 1000 --semillas 5

Ejecuta el modelo 35 cambiando solo el numero de residentes, con varias
semillas por cada N, y reparte el tiempo de cada simulacion en tres partes:
simular -el proceso hijo que corre SimPy-, registros -revisar y reunir los XES
de cada pool- y el resto -leer y validar las reglas, generar el script y leer
los ficheros que deja el proceso hijo-.
Los tiempos dependen de la maquina; lo que se compara es como crecen con N. No
forma parte de la regresion por eso mismo, pero la regresion si ejecuta el
proceso base con 100 residentes y dice cuanto tarda.
"""
import argparse
from datetime import datetime
import platform
import subprocess
import sys
import time

import banco
import simulator.main as main


def cronometra(funcion, cuenta, clave):
    def medida(*args, **kwargs):
        inicio = time.perf_counter()
        try:
            return funcion(*args, **kwargs)
        finally:
            cuenta[clave] += time.perf_counter() - inicio
    return medida


def main_():
    opciones = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    opciones.add_argument("--casos", type=int, nargs="+", default=[10, 50, 100])
    opciones.add_argument("--semillas", type=int, default=5)
    argumentos = opciones.parse_args()
    criterio = banco.CRITERIO_DEL_PROCESO_BASE
    base = (banco.MODELOS / (criterio["modelo"] + ".txt")).read_text(encoding="utf-8")
    cuenta = {"simular": 0.0, "registros": 0.0}
    subprocess.run = cronometra(subprocess.run, cuenta, "simular")
    main.reune_registros = cronometra(main.reune_registros, cuenta, "registros")
    print("Proceso base (%s), %d semillas por N; Python %s en %s."
          % (criterio["modelo"], argumentos.semillas, platform.python_version(), platform.platform()))
    print()
    print("%6s %11s %10s %10s %10s %11s %9s %8s %15s %10s"
          % ("N", "total medio", "total max", "resto", "simular", "registros", "eventos", "XES", "dura (simulado)",
             "aceptados"))
    for casos in argumentos.casos:
        texto = banco.con_casos(base, criterio["pool"], casos)
        totales, partes, eventos, tamano, duracion, aceptados = [], [], 0, 0, 0.0, 0
        for semilla in range(1, argumentos.semillas + 1):
            cuenta["simular"] = cuenta["registros"] = 0.0
            inicio = time.perf_counter()
            resultado = main.processSimulation(texto, seed=semilla)
            total = time.perf_counter() - inicio
            totales.append(total)
            partes.append((total - cuenta["simular"] - cuenta["registros"], cuenta["simular"], cuenta["registros"]))
            xes = resultado.simulation
            eventos += xes.count("<event>")
            tamano += len(xes)
            aceptados += banco.cuenta_eventos(xes, criterio["aceptada"][1], "bpmn:EndEvent")
            rondas = banco.lee_convocatorias(xes)
            instantes = [evento[clave] for ronda in rondas.values() for evento in ronda["eventos"]
                         for clave in ("time:timestamp", "time:endTime") if evento.get(clave)]
            duracion += (max(map(datetime.fromisoformat, instantes))
                         - datetime.fromisoformat(banco.FECHA_INICIO)).total_seconds()
        n = len(totales)
        media = lambda indice: sum(parte[indice] for parte in partes) / n
        print("%6d %9.2f s %8.2f s %8.2f s %8.2f s %9.2f s %9d %5.0f KB %13.0f s %9.1f %%"
              % (casos, sum(totales) / n, max(totales), media(0), media(1), media(2), eventos / n,
                 tamano / n / 1024, duracion / n, 100 * aceptados / (casos * n)))
    return 0


if __name__ == "__main__":
    sys.exit(main_())
