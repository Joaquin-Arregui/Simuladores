#!/usr/bin/env python3
"""Piezas comunes del banco: donde estan los modelos y como se ejecutan.

Lo comparten `congelar.py` y `regresion.py`. Si cada uno descubriera los
modelos por su cuenta, acabarian discrepando el dia que se anada una categoria.

Hay dos categorias de modelo:

- `modelos/` — tienen que correr LIMPIOS. Cualquier aviso es un fallo, para que
  un aviso nuevo se note en vez de perderse entre otros diez.
- `modelos-con-avisos/` — tienen que correr BIEN pero emitiendo exactamente los
  avisos declarados. Vigilan el camino "esto avisa pero no es un error", que es
  donde se colo el fallo del pool vacio: el motor le creaba casos y convertia un
  aviso en una simulacion bloqueada.
"""
import os
import sys
from pathlib import Path

AQUI = Path(__file__).resolve().parent
sys.path.insert(0, str(AQUI.parent))

SEMILLA = 20260101
FECHA_INICIO = "2026-01-01T00:00:00+00:00"
os.environ["SIMULATION_START_DATE"] = FECHA_INICIO

MODELOS = AQUI / "modelos"
MODELOS_CON_AVISOS = AQUI / "modelos-con-avisos"
ESPERADO = AQUI / "esperado"
ESPERADO_CON_AVISOS = ESPERADO / "con-avisos"

from simulator.main import processSimulation  # noqa: E402


def modelos():
    """[(ruta, admite_avisos)] en orden estable, limpios primero."""
    encontrados = [(ruta, False) for ruta in sorted(MODELOS.glob("*.txt"))]
    if MODELOS_CON_AVISOS.is_dir():
        encontrados += [(ruta, True) for ruta in sorted(MODELOS_CON_AVISOS.glob("*.txt"))]
    return encontrados


def etiqueta(ruta, admite_avisos):
    return ("con-avisos/" if admite_avisos else "") + ruta.name


def carpeta(admite_avisos):
    return ESPERADO_CON_AVISOS if admite_avisos else ESPERADO


def ruta_xes(ruta, admite_avisos):
    return carpeta(admite_avisos) / (ruta.stem + ".xes")


def ruta_avisos(ruta):
    return ESPERADO_CON_AVISOS / (ruta.stem + ".avisos.txt")


def ejecuta(ruta):
    return processSimulation(ruta.read_text(encoding="utf-8"), seed=SEMILLA)


def lee_avisos(ruta):
    fichero = ruta_avisos(ruta)
    if not fichero.exists():
        return None
    return [linea for linea in fichero.read_text(encoding="utf-8").splitlines() if linea.strip()]


def escribe_avisos(ruta, avisos):
    ruta_avisos(ruta).write_text("\n".join(avisos) + "\n", encoding="utf-8")


def referencias_huerfanas():
    """Ficheros congelados cuyo modelo ya no existe."""
    esperadas = {ruta_xes(r, a) for r, a in modelos()}
    esperadas |= {ruta_avisos(r) for r, a in modelos() if a}
    sueltas = set()
    for carpeta_ in (ESPERADO, ESPERADO_CON_AVISOS):
        if carpeta_.is_dir():
            sueltas |= {p for p in carpeta_.glob("*.xes")}
            sueltas |= {p for p in carpeta_.glob("*.avisos.txt")}
    return sorted(p.relative_to(ESPERADO) for p in sueltas - esperadas)
