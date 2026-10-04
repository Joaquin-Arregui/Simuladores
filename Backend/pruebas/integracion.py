#!/usr/bin/env python3
"""Banco de integracion: los modelos de referencia, por la API y con su diagrama.

    python3 pruebas/integracion.py
    python3 pruebas/integracion.py --congela

Dos grupos de diagramas:

- `integracion/<modelo>.bpmn` -- se manda por POST /simulate el content de
  referencia (las reglas del modelo) y el diagramXML. Tiene que responder 200
  con el MISMO XES que ejecutando esas reglas directamente, y con los mismos
  avisos. Aqui no se congela nada: la referencia es la ejecucion directa.
  Si el modelo tiene tareas multiinstancia, se manda ademas con las reglas SIN
  ningun multiInstanceType: la marca tiene que llegar del dibujo (3.1) y el XES
  tiene que ser el mismo.
- `integracion-con-error/<modelo>--<variante>.bpmn` -- el diagrama esta roto o
  no cuenta lo mismo que las reglas de <modelo>, y la API tiene que rechazarlo
  con un 400 o un 422 y el mensaje congelado en esperado/integracion/. Un 500 no
  se congela nunca: es un fallo del Backend, no un diagnostico.

La API se ejerce con el cliente de pruebas de Flask: pasa por server.py entero
-JSON de entrada, codigos HTTP, manejo de errores- sin abrir ningun puerto.

Con --congela escribe las respuestas de error esperadas, y como congelar.py,
solo si TODOS los diagramas pasan.
"""
import argparse
import re
from pathlib import Path

import banco
import server

AQUI = Path(__file__).resolve().parent
DIAGRAMAS = AQUI / "integracion"
DIAGRAMAS_CON_ERROR = AQUI / "integracion-con-error"
ESPERADO = banco.ESPERADO / "integracion"
CODIGOS_PREVISTOS = (400, 422)


def reglas_de(nombre):
    """El modelo de referencia que corresponde a un diagrama, por su nombre."""
    for ruta, _ in banco.modelos():
        if ruta.stem == nombre:
            return ruta
    raise SystemExit(f"No hay modelo de referencia para el diagrama {nombre}.")


def manda(cliente, reglas, diagrama, content=None):
    respuesta = cliente.post("/simulate", json={
        "content": content if content is not None else reglas.read_text(encoding="utf-8"),
        "diagramXML": diagrama.read_text(encoding="utf-8"),
        "seed": banco.SEMILLA,
    })
    return respuesta.status_code, respuesta.get_json(silent=True) or {}


def sin_marcas(reglas):
    """Las reglas sin ningun multiInstanceType, como las escribiria quien solo
    ha dibujado la marca; None si no tenian ninguno."""
    texto = reglas.read_text(encoding="utf-8")
    limpio = re.sub(r""",\s*multiInstanceType=['"](?:true|false)['"]""", "", texto)
    return limpio if limpio != texto else None


def ruta_respuesta(diagrama):
    return ESPERADO / (diagrama.stem + ".respuesta.txt")


def revisa_correctos(cliente):
    fallos = 0
    for diagrama in sorted(DIAGRAMAS.glob("*.bpmn")):
        reglas = reglas_de(diagrama.stem)
        codigo, datos = manda(cliente, reglas, diagrama)
        nombre = diagrama.name
        if codigo != 200:
            print("%-38s HTTP %d   %s" % (nombre, codigo, datos.get("error", "")))
            fallos += 1
            continue
        directo = banco.ejecuta(reglas)
        problemas = []
        if datos.get("simulation") != directo.simulation:
            problemas.append("el XES no es el de la ejecucion directa")
        if sorted(datos.get("warnings", [])) != sorted(directo.warnings):
            problemas.append("avisos distintos: por la API %s, directos %s"
                             % (datos.get("warnings"), directo.warnings))
        if problemas:
            print("%-38s DISTINTO" % nombre)
            for linea in problemas:
                print("         %s" % linea)
            fallos += 1
        else:
            print("%-38s ok      HTTP 200, mismo XES y mismos avisos" % nombre)
        # 3.1: la marca dibujada basta, sin escribir nada a mano en las reglas.
        limpio = sin_marcas(reglas)
        if limpio is None:
            continue
        codigo, datos = manda(cliente, reglas, diagrama, content=limpio)
        etiqueta = "  ...sin multiInstanceType"
        if codigo != 200:
            print("%-38s HTTP %d   %s" % (etiqueta, codigo, datos.get("error", "")))
            fallos += 1
        elif datos.get("simulation") != directo.simulation:
            print("%-38s DISTINTO  la marca del dibujo no ha llegado al motor" % etiqueta)
            fallos += 1
        else:
            print("%-38s ok      la marca llega del dibujo: mismo XES" % etiqueta)
    return fallos


def respuestas_de_error(cliente):
    """[(diagrama, texto, previsto)] sin tocar el disco."""
    resultado = []
    for diagrama in sorted(DIAGRAMAS_CON_ERROR.glob("*.bpmn")):
        reglas = reglas_de(diagrama.stem.split("--")[0])
        codigo, datos = manda(cliente, reglas, diagrama)
        detalle = datos.get("error") or ("simulacion correcta" if codigo == 200 else datos)
        texto = "HTTP %d: %s" % (codigo, detalle)
        resultado.append((diagrama, texto, codigo in CODIGOS_PREVISTOS))
    return resultado


def main():
    opciones = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    opciones.add_argument("--congela", action="store_true",
                          help="escribe las respuestas de error esperadas, solo si todo pasa")
    argumentos = opciones.parse_args()
    # Sin diagramas no hay validacion: perder las carpetas no puede dar verde.
    problemas = banco.faltan_grupos((DIAGRAMAS, "*.bpmn"), (DIAGRAMAS_CON_ERROR, "*.bpmn"))
    if problemas:
        for problema in problemas:
            print("Falta un grupo de diagramas: %s." % problema)
        print("No se %s nada." % ("congela" if argumentos.congela else "compara"))
        return 1
    cliente = server.app.test_client()

    fallos = revisa_correctos(cliente)
    errores = respuestas_de_error(cliente)
    for diagrama, texto, previsto in errores:
        nombre = "con-error/" + diagrama.name
        esperado = ruta_respuesta(diagrama)
        if not previsto:
            print("%-38s NO PREVISTO  %s" % (nombre, texto))
            print("         solo valen los codigos %s; un 200 o un 500 no se congela"
                  % ", ".join(map(str, CODIGOS_PREVISTOS)))
            fallos += 1
        elif argumentos.congela:
            print("%-38s ok      %s" % (nombre, texto))
        elif not esperado.exists():
            print("%-38s SIN REFERENCIA  ejecuta con --congela" % nombre)
            fallos += 1
        elif esperado.read_text(encoding="utf-8").strip() != texto:
            print("%-38s CAMBIA LA RESPUESTA" % nombre)
            print("         esperaba %s" % esperado.read_text(encoding="utf-8").strip())
            print("         ha dado  %s" % texto)
            fallos += 1
        else:
            print("%-38s ok" % nombre)

    vigentes = {ruta_respuesta(diagrama) for diagrama, _, _ in errores}
    huerfanas = sorted(p for p in ESPERADO.glob("*.respuesta.txt") if p not in vigentes) \
        if ESPERADO.is_dir() else []
    for huerfana in huerfanas:
        print("%-38s REFERENCIA HUERFANA  no existe su diagrama" % huerfana.name)
        fallos += 1

    total = len(list(DIAGRAMAS.glob("*.bpmn"))) + len(errores)
    print()
    if argumentos.congela:
        if fallos:
            print("No se ha escrito nada: %d problema(s)." % fallos)
            return 1
        ESPERADO.mkdir(parents=True, exist_ok=True)
        for diagrama, texto, _ in errores:
            ruta_respuesta(diagrama).write_text(texto + "\n", encoding="utf-8")
        print("Congeladas %d respuestas de error." % len(errores))
        return 0
    if fallos:
        print("Integracion en rojo: %d problema(s)." % fallos)
        return 1
    print("Integracion en verde: %d diagramas por la API." % total)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
