#!/usr/bin/env python3
"""Reejecuta los modelos de referencia y los compara con lo congelado.

    python3 pruebas/regresion.py
    python3 pruebas/regresion.py --acepta-reorganizacion
    python3 pruebas/regresion.py --acepta-reorganizacion --correspondencia pruebas/correspondencia.json

Compara tres cosas, y conviene no confundirlas:

- COMPORTAMIENTO: que le ocurre a CADA CASO. Que eventos tiene, cuando, con que
  recurso y que rama elige cada compuerta. Cualquier diferencia es un fallo.
- ORGANIZACION: en cuantas trazas se reparten los eventos de un caso y como se
  llaman. Las tareas 1.5 y 1.6 las separaron por participante, y eso es
  legitimo: se informa aparte y se acepta con --acepta-reorganizacion.
- AVISOS: los de `modelos/` tienen que correr limpios; los de
  `modelos-con-avisos/` tienen que emitir exactamente los congelados. Un aviso
  que aparece, que desaparece o que cambia de texto es un fallo.
- ERRORES: los de `modelos-con-error/` tienen que fallar con el tipo y el
  mensaje congelados. Que dejen de fallar, que cambie el texto o que un error
  interno sustituya al diagnostico son fallos los tres.

La linea entre comportamiento y organizacion esta en el CASO, no en la traza.
Los eventos se agrupan por caso ANTES de comparar, asi que si la respuesta del
cliente 1 acabara en el cliente 2 seguiria siendo un fallo aunque las trazas se
hayan reorganizado.

Si la reorganizacion ademas renumera los casos, la correspondencia explicita
(--correspondencia, un JSON {"caso nuevo": "caso de referencia"}) dice como se
leen los nuevos identificadores. Sin ella se asume que no cambian.
"""
import argparse
import json
from pathlib import Path
from xml.etree import ElementTree as ET

import banco

# Atributos que dicen a que caso pertenece un evento.
IDENTIDAD = ("bpmn:participant", "bpmn:instance")


def _etiqueta(nodo):
    return nodo.tag.split("}")[-1]


def lee_xes(texto):
    """[{nombre, eventos: [{clave: valor}]}] a partir del XES."""
    trazas = []
    for hijo in ET.fromstring(texto):
        if _etiqueta(hijo) != "trace":
            continue
        nombre, eventos = None, []
        for nodo in hijo:
            if _etiqueta(nodo) == "event":
                eventos.append({a.get("key"): a.get("value") for a in nodo})
            elif nodo.get("key") == "concept:name":
                nombre = nodo.get("value")
        trazas.append({"nombre": nombre, "eventos": eventos})
    return trazas


def clave_caso(evento, traza, correspondencia):
    """A que caso pertenece un evento, ya normalizado."""
    partes = tuple(evento[c] for c in IDENTIDAD if evento.get(c) is not None)
    bruta = " / ".join(partes) if partes else (traza["nombre"] or "sin nombre")
    return correspondencia.get(bruta, bruta)


def firma(evento):
    """Lo que define el comportamiento de un evento dentro de su caso."""
    return tuple(sorted((c, v) for c, v in evento.items() if c not in IDENTIDAD))


def describe(evento):
    return "%s (%s) en %s" % (evento.get("bpmn:id", "?"),
                              evento.get("bpmn:type", "?"),
                              evento.get("time:timestamp", "sin marca de tiempo"))


def agrupa_por_caso(trazas, correspondencia):
    casos = {}
    for traza in trazas:
        for posicion, evento in enumerate(traza["eventos"], 1):
            clave = clave_caso(evento, traza, correspondencia)
            casos.setdefault(clave, []).append((traza["nombre"], posicion, evento))
    return casos


def _atributos_distintos(ref, obt):
    return ["%s esperaba %r y ha dado %r" % (c, ref.get(c), obt.get(c))
            for c in sorted(set(ref) | set(obt)) if ref.get(c) != obt.get(c)]


def compara_caso(caso, eventos_ref, eventos_obt):
    """Compara los eventos de UN caso, sin depender de como se repartan."""
    pendientes = {}
    for nombre, posicion, evento in eventos_ref:
        pendientes.setdefault(firma(evento), []).append((nombre, posicion, evento))

    sobran = []
    for nombre, posicion, evento in eventos_obt:
        cola = pendientes.get(firma(evento))
        if cola:
            cola.pop()
        else:
            sobran.append((nombre, posicion, evento))

    faltan = [dato for cola in pendientes.values() for dato in cola]
    por_elemento = {}
    for dato in sobran:
        por_elemento.setdefault((dato[2].get("bpmn:id"), dato[2].get("bpmn:type")), []).append(dato)

    fallos, emparejados = [], set()
    for nombre, posicion, evento in faltan:
        cola = por_elemento.get((evento.get("bpmn:id"), evento.get("bpmn:type")))
        if cola:
            _, _, otro = cola.pop(0)
            emparejados.add(id(otro))
            for linea in _atributos_distintos(evento, otro):
                fallos.append("caso %s, evento %d (%s): %s"
                              % (caso, posicion, describe(evento), linea))
        else:
            fallos.append("caso %s: falta el evento %s (posicion %d de la traza %s)"
                          % (caso, describe(evento), posicion, nombre))
    for nombre, posicion, evento in sobran:
        if id(evento) not in emparejados:
            fallos.append("caso %s: sobra el evento %s (posicion %d de la traza %s)"
                          % (caso, describe(evento), posicion, nombre))
    return fallos


def revisa(texto_ref, texto_obt, correspondencia):
    """Devuelve (fallos_de_comportamiento, notas_de_organizacion)."""
    ref, obt = lee_xes(texto_ref), lee_xes(texto_obt)

    organizacion = []
    estructura_ref = [(t["nombre"], len(t["eventos"])) for t in ref]
    estructura_obt = [(t["nombre"], len(t["eventos"])) for t in obt]
    if estructura_ref != estructura_obt:
        organizacion.append("la estructura de trazas ha cambiado: antes %s, ahora %s"
                            % (estructura_ref, estructura_obt))

    casos_ref = agrupa_por_caso(ref, {})
    casos_obt = agrupa_por_caso(obt, correspondencia)

    comportamiento = []
    faltan_casos = sorted(set(casos_ref) - set(casos_obt))
    sobran_casos = sorted(set(casos_obt) - set(casos_ref))
    for caso in faltan_casos:
        comportamiento.append("falta el caso %s, que tenia %d eventos"
                              % (caso, len(casos_ref[caso])))
    for caso in sobran_casos:
        comportamiento.append("aparece un caso nuevo, %s, con %d eventos"
                              % (caso, len(casos_obt[caso])))
    if faltan_casos or sobran_casos:
        comportamiento.append("si la reorganizacion renumera los casos, declara la "
                              "correspondencia con --correspondencia")

    for caso in sorted(set(casos_ref) & set(casos_obt)):
        comportamiento.extend(compara_caso(caso, casos_ref[caso], casos_obt[caso]))

    return comportamiento, organizacion


def carga_correspondencia(ruta):
    if ruta is None:
        return {}
    datos = json.loads(Path(ruta).read_text(encoding="utf-8"))
    if not isinstance(datos, dict) or any(not isinstance(v, str) for v in datos.values()):
        raise ValueError("La correspondencia debe ser un objeto {\"caso nuevo\": \"caso de referencia\"}.")
    return datos


def compara_avisos(esperados, obtenidos):
    """Diferencias entre los avisos congelados y los de ahora."""
    if esperados is None:
        return ["no hay avisos congelados; ejecuta congelar.py"]
    faltan = [a for a in esperados if a not in obtenidos]
    sobran = [a for a in obtenidos if a not in esperados]
    return (["ya no se emite este aviso: %s" % a for a in faltan] +
            ["aviso nuevo: %s" % a for a in sobran])


def main():
    opciones = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    opciones.add_argument("--acepta-reorganizacion", action="store_true",
                          help="el reparto de los eventos en trazas puede cambiar; su caso, no")
    opciones.add_argument("--correspondencia", default=None,
                          help="JSON {\"caso nuevo\": \"caso de referencia\"} cuando la reorganizacion renumera")
    argumentos = opciones.parse_args()

    try:
        correspondencia = carga_correspondencia(argumentos.correspondencia)
    except Exception as error:
        print("No se pudo leer la correspondencia: %s" % error)
        return 1

    problemas = banco.faltan_grupos(*banco.GRUPOS_DEL_BANCO)
    if problemas:
        for problema in problemas:
            print("Falta un grupo del banco: %s." % problema)
        print("No se compara nada: un banco incompleto no puede dar verde.")
        return 1
    modelos = banco.modelos()
    con_error = banco.modelos_con_error()

    fallos = 0
    for ruta, admite_avisos in modelos:
        nombre = banco.etiqueta(ruta, admite_avisos)
        referencia = banco.ruta_xes(ruta, admite_avisos)
        if not referencia.exists():
            print("%-34s SIN REFERENCIA  ejecuta congelar.py" % nombre)
            fallos += 1
            continue
        try:
            resultado = banco.ejecuta(ruta)
        except Exception as error:
            print("%-34s ERROR   %s: %s" % (nombre, type(error).__name__, error))
            fallos += 1
            continue

        problemas_aviso = []
        if admite_avisos:
            problemas_aviso = compara_avisos(banco.lee_avisos(ruta), resultado.warnings)
        elif resultado.warnings:
            problemas_aviso = ["aviso inesperado: %s" % a for a in resultado.warnings]

        comportamiento, organizacion = revisa(
            referencia.read_text(encoding="utf-8"), resultado.simulation, correspondencia)

        if problemas_aviso:
            print("%-34s CAMBIAN LOS AVISOS" % nombre)
            for linea in problemas_aviso:
                print("         %s" % linea)
            fallos += 1
        if comportamiento:
            print("%-34s CAMBIA EL COMPORTAMIENTO" % nombre)
            for linea in comportamiento[:12]:
                print("         %s" % linea)
            if len(comportamiento) > 12:
                print("         ... y %d diferencias mas" % (len(comportamiento) - 12))
            fallos += 1
        if organizacion:
            etiqueta = "reorganizacion aceptada" if argumentos.acepta_reorganizacion else "CAMBIA LA ORGANIZACION"
            print("%-34s %s" % (nombre, etiqueta))
            for linea in organizacion[:6]:
                print("         %s" % linea)
            if not argumentos.acepta_reorganizacion:
                fallos += 1
        if not (problemas_aviso or comportamiento or organizacion):
            print("%-34s ok" % nombre)

    for ruta in con_error:
        nombre = banco.etiqueta_error(ruta)
        esperado = banco.lee_error(ruta)
        texto, previsto = banco.ejecuta_con_error(ruta)
        if esperado is None:
            print("%-34s SIN REFERENCIA  ejecuta congelar.py" % nombre)
            fallos += 1
        elif texto is None:
            print("%-34s YA NO FALLA" % nombre)
            print("         esperaba %s" % esperado)
            fallos += 1
        elif not previsto:
            print("%-34s ERROR INTERNO  %s" % (nombre, texto))
            print("         esperaba %s" % esperado)
            fallos += 1
        elif texto != esperado:
            print("%-34s CAMBIA EL ERROR" % nombre)
            print("         esperaba %s" % esperado)
            print("         ha dado  %s" % texto)
            fallos += 1
        else:
            print("%-34s ok" % nombre)

    # El criterio de la 3.2, que una sola semilla no puede mostrar.
    lineas, fallos_criterio = banco.revisa_criterio_del_lote()
    nombre = "criterio 3.2 (%s)" % banco.CRITERIO_DEL_LOTE["modelo"]
    print("%-34s %s" % (nombre, "ok" if not fallos_criterio else "FALLA"))
    for linea in lineas:
        print("         %s" % linea)
    fallos += fallos_criterio

    # Las convocatorias en serie (4.1 y 4.2): rondas sin solapes ni huecos,
    # casos nuevos en cada una y nada que pase de una a otra.
    lineas, fallos_rondas = banco.revisa_convocatorias()
    print("%-34s %s" % ("convocatorias en serie", "ok" if not fallos_rondas else "FALLA"))
    for linea in lineas:
        print("         %s" % linea)
    fallos += fallos_rondas

    # Ningun modelo correcto se bloquea con otras semillas (3.4).
    lineas, fallos_bloqueo = banco.revisa_sin_bloqueos()
    print("%-34s %s" % ("sin bloqueos con otras semillas", "ok" if not fallos_bloqueo else "FALLA"))
    for linea in lineas:
        print("         %s" % linea)
    fallos += fallos_bloqueo

    for huerfana in banco.referencias_huerfanas():
        print("%-34s REFERENCIA HUERFANA  no existe su modelo" % str(huerfana))
        fallos += 1

    print()
    if fallos:
        print("Regresion en rojo: %d problema(s)." % fallos)
        print("Si el cambio es intencionado, revisa el diff y vuelve a congelar.")
        return 1
    print("Regresion en verde: %d modelos sin cambios." % (len(modelos) + len(con_error)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
