#!/usr/bin/env python3
"""Piezas comunes del banco: donde estan los modelos y como se ejecutan.

Lo comparten `congelar.py` y `regresion.py`. Si cada uno descubriera los
modelos por su cuenta, acabarian discrepando el dia que se anada una categoria.

Hay tres categorias de modelo:

- `modelos/` — tienen que correr LIMPIOS. Cualquier aviso es un fallo, para que
  un aviso nuevo se note en vez de perderse entre otros diez.
- `modelos-con-avisos/` — tienen que correr BIEN pero emitiendo exactamente los
  avisos declarados. Vigilan el camino "esto avisa pero no es un error", que es
  donde se colo el fallo del pool vacio: el motor le creaba casos y convertia un
  aviso en una simulacion bloqueada.
- `modelos-con-error/` — tienen que FALLAR con el tipo y el mensaje congelados.
  Un diagnostico es parte del contrato: si deja de salir, si cambia de texto o
  si lo sustituye un error interno, el banco se pone en rojo. Solo se congelan
  los errores previstos (ver ERRORES_PREVISTOS); un error interno es un fallo
  del motor y no se congela nunca.
"""
import os
import sys
import tracemalloc
from pathlib import Path

AQUI = Path(__file__).resolve().parent
sys.path.insert(0, str(AQUI.parent))

SEMILLA = 20260101
FECHA_INICIO = "2026-01-01T00:00:00+00:00"
os.environ["SIMULATION_START_DATE"] = FECHA_INICIO

MODELOS = AQUI / "modelos"
MODELOS_CON_AVISOS = AQUI / "modelos-con-avisos"
MODELOS_CON_ERROR = AQUI / "modelos-con-error"
ESPERADO = AQUI / "esperado"
ESPERADO_CON_AVISOS = ESPERADO / "con-avisos"
ESPERADO_CON_ERROR = ESPERADO / "con-error"

# Los errores que la API traduce a una respuesta con sentido para quien dibuja:
# ValueError es el 400 de validacion y SimulationExecutionError el 422 de una
# simulacion que no puede terminar. Cualquier otro tipo (KeyError, un error de
# configuracion, un fallo del proceso hijo) es un fallo del motor, acaba en un
# 500 y no se congela: el banco tiene que ponerse en rojo aunque el mensaje
# coincida. No se incluye el 504 por tiempo porque depende del reloj real y no
# seria reproducible.
ERRORES_PREVISTOS = ("ValueError", "SimulationExecutionError")

# Lo que un modelo puede hacer gastar al proceso principal: leer, validar,
# generar el script y recoger el XES. La validacion corre antes del plazo de la
# simulacion, asi que nada mas la frena si crece sin limite; una bifurcacion
# inclusiva de 18 salidas llego a gastar 30 MiB solo en enumerar combinaciones,
# y cada salida mas lo doblaba. Hoy el que mas gasta es el 14, con unos 7 MiB.
# La ejecucion en si va en un proceso hijo y no cuenta aqui.
MEMORIA_MAXIMA = 32 * 2**20


class MemoriaExcesiva(Exception):
    """Un modelo ha hecho gastar al proceso principal mas de MEMORIA_MAXIMA."""

from simulator.main import processSimulation  # noqa: E402


def faltan_grupos(*grupos):
    """Los grupos de casos que no estan o estan vacios, para no dar verde sin probar.

    Sin esta comprobacion, perder una carpeta entera -los modelos y sus
    referencias, en un merge por ejemplo- hace que el glob devuelva una lista
    vacia y la regresion salga en verde con menos modelos sin decir nada.
    """
    problemas = []
    for carpeta, patron in grupos:
        if not carpeta.is_dir():
            problemas.append("no existe la carpeta %s" % carpeta)
        elif not any(carpeta.glob(patron)):
            problemas.append("la carpeta %s no tiene ningun caso (%s)" % (carpeta, patron))
    return problemas


GRUPOS_DEL_BANCO = ((MODELOS, "*.txt"), (MODELOS_CON_AVISOS, "*.txt"), (MODELOS_CON_ERROR, "*.txt"))


def modelos():
    """[(ruta, admite_avisos)] en orden estable, limpios primero."""
    encontrados = [(ruta, False) for ruta in sorted(MODELOS.glob("*.txt"))]
    if MODELOS_CON_AVISOS.is_dir():
        encontrados += [(ruta, True) for ruta in sorted(MODELOS_CON_AVISOS.glob("*.txt"))]
    return encontrados


def modelos_con_error():
    """[ruta] de los modelos que TIENEN que fallar, en orden estable."""
    if not MODELOS_CON_ERROR.is_dir():
        return []
    return sorted(MODELOS_CON_ERROR.glob("*.txt"))


def etiqueta(ruta, admite_avisos):
    return ("con-avisos/" if admite_avisos else "") + ruta.name


def etiqueta_error(ruta):
    return "con-error/" + ruta.name


def carpeta(admite_avisos):
    return ESPERADO_CON_AVISOS if admite_avisos else ESPERADO


def ruta_xes(ruta, admite_avisos):
    return carpeta(admite_avisos) / (ruta.stem + ".xes")


def ruta_avisos(ruta):
    return ESPERADO_CON_AVISOS / (ruta.stem + ".avisos.txt")


def ejecuta(ruta):
    """Ejecuta un modelo midiendo lo que gasta el proceso principal.

    Si pasa de MEMORIA_MAXIMA, falla con MemoriaExcesiva aunque el resultado
    sea correcto, y tambien si el modelo tenia que fallar: no es un error
    previsto, asi que el banco lo trata como un fallo del motor.
    """
    tracemalloc.start()
    try:
        return processSimulation(ruta.read_text(encoding="utf-8"), seed=SEMILLA)
    finally:
        pico = tracemalloc.get_traced_memory()[1]
        tracemalloc.stop()
        if pico > MEMORIA_MAXIMA:
            raise MemoriaExcesiva("%s ha gastado %.1f MiB en el proceso principal; el banco admite %d MiB"
                                  % (ruta.name, pico / 2**20, MEMORIA_MAXIMA // 2**20))


def lee_avisos(ruta):
    fichero = ruta_avisos(ruta)
    if not fichero.exists():
        return None
    return [linea for linea in fichero.read_text(encoding="utf-8").splitlines() if linea.strip()]


def escribe_avisos(ruta, avisos):
    ruta_avisos(ruta).write_text("\n".join(avisos) + "\n", encoding="utf-8")


def ruta_error(ruta):
    return ESPERADO_CON_ERROR / (ruta.stem + ".error.txt")


def lee_error(ruta):
    fichero = ruta_error(ruta)
    if not fichero.exists():
        return None
    return fichero.read_text(encoding="utf-8").strip()


def escribe_error(ruta, texto):
    ruta_error(ruta).write_text(texto + "\n", encoding="utf-8")


def ejecuta_con_error(ruta):
    """(texto, previsto) de un modelo que tiene que fallar.

    `texto` es el "Tipo: mensaje" que se congela, o None si el modelo ha
    terminado bien, que ya es un fallo del banco. `previsto` dice si el tipo es
    uno de los diagnosticos del contrato: un error interno no se congela.
    """
    try:
        ejecuta(ruta)
    except Exception as error:
        tipo = type(error).__name__
        return "%s: %s" % (tipo, error), tipo in ERRORES_PREVISTOS
    return None, False


def referencias_huerfanas():
    """Ficheros congelados cuyo modelo ya no existe."""
    esperadas = {ruta_xes(r, a) for r, a in modelos()}
    esperadas |= {ruta_avisos(r) for r, a in modelos() if a}
    esperadas |= {ruta_error(r) for r in modelos_con_error()}
    sueltas = set()
    for carpeta_ in (ESPERADO, ESPERADO_CON_AVISOS, ESPERADO_CON_ERROR):
        if carpeta_.is_dir():
            sueltas |= {p for p in carpeta_.glob("*.xes")}
            sueltas |= {p for p in carpeta_.glob("*.avisos.txt")}
            sueltas |= {p for p in carpeta_.glob("*.error.txt")}
    return sorted(p.relative_to(ESPERADO) for p in sueltas - esperadas)
