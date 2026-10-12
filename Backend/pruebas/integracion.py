#!/usr/bin/env python3
"""Banco de integracion: los modelos de referencia, por la API y con su diagrama.

    python3 pruebas/integracion.py
    python3 pruebas/integracion.py --congela

Dos grupos de diagramas:

- `integracion/<modelo>.bpmn` -- se manda por POST /simulate el content de
  referencia (las reglas del modelo) y el diagramXML. Tiene que responder 200
  con un registro por pool (D10) que este completo y sea coherente, con las
  MISMAS trazas y metadatos que ejecutando esas reglas directamente, y con los
  mismos avisos. Solo cambia la referencia del modelo, que por la API incluye
  el diagrama: tiene que ser la huella de lo que se ha mandado. Aqui no se
  congela nada: la referencia es la ejecucion directa.
  Si el modelo tiene tareas multiinstancia, se manda ademas con las reglas SIN
  ningun multiInstanceType: la marca tiene que llegar del dibujo (3.1) y el XES
  tiene que ser el mismo.
- `integracion-con-error/<modelo>--<variante>.bpmn` -- el diagrama esta roto o
  no cuenta lo mismo que las reglas de <modelo>, y la API tiene que rechazarlo
  con un 400 o un 422 y el mensaje congelado en esperado/integracion/. Un 500 no
  se congela nunca: es un fallo del Backend, no un diagnostico.

La API se ejerce con el cliente de pruebas de Flask: pasa por server.py entero
-JSON de entrada, codigos HTTP, manejo de errores- sin abrir ningun puerto.

Ademas, con la primera respuesta que trae varios registros se comprueba que la
revision de un conjunto de registros detecta los que estan rotos: uno que
falta, uno duplicado, uno mal formado, uno de otra simulacion...

Con --congela escribe las respuestas de error esperadas, y como congelar.py,
solo si TODOS los diagramas pasan.
"""
import argparse
import re
from pathlib import Path
from xml.etree import ElementTree as ET

import banco
import server
from simulator.registros import (XES, FORMATO_DEL_REGISTRO, Registro, huella_de_las_reglas,
                                 huella_del_diagrama, id_de_simulacion, metadatos, reune_registros,
                                 revisa_registros)

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


# Lo unico que puede cambiar entre la API y la ejecucion directa: la referencia
# del modelo -por la API incluye el diagrama, y sin marcas las reglas son otras-
# y la identificacion de la simulacion, que sale de ella.
REFERENCIA_DEL_ENVIO = ("simulation:id", "model:rulesSha256", "model:diagramSha256")


def trazas(xes):
    return [ET.tostring(traza, encoding="unicode") for traza in ET.fromstring(xes).iter("{%s}trace" % XES)]


def registros_de(datos):
    """Los registros de una respuesta, o None si no trae una lista de ellos."""
    logs = datos.get("logs")
    if not isinstance(logs, list) or any(not isinstance(log, dict) for log in logs):
        return None
    return [Registro(log.get("pool"), log.get("name"), log.get("xes") if isinstance(log.get("xes"), str) else "")
            for log in logs]


def compara_respuesta(datos, directo, content, diagrama_xml):
    """Lo que no cuadra entre una respuesta 200 y la ejecucion directa."""
    registros = registros_de(datos)
    if registros is None:
        return ["la respuesta no trae la lista de registros, logs"]
    problemas = ["registros: %s" % problema for problema in revisa_registros(registros)]
    if problemas:
        return problemas
    if [r.pool for r in registros] != [r.pool for r in directo.registros]:
        return ["trae registros de %s y la ejecucion directa de %s"
                % ([r.pool for r in registros], [r.pool for r in directo.registros])]
    for api, directa in zip(registros, directo.registros):
        if api.nombre != directa.nombre:
            problemas.append("el registro de %s se llama %r y en la ejecucion directa %r"
                             % (api.pool, api.nombre, directa.nombre))
        if trazas(api.xes) != trazas(directa.xes):
            problemas.append("las trazas de %s no son las de la ejecucion directa" % api.pool)
        por_api, directos = metadatos(api.xes), metadatos(directa.xes)
        distintos = sorted(clave for clave in set(por_api) | set(directos)
                           if clave not in REFERENCIA_DEL_ENVIO and por_api.get(clave) != directos.get(clave))
        if distintos:
            problemas.append("los metadatos de %s no son los de la ejecucion directa: %s"
                             % (api.pool, ", ".join(distintos)))
    comunes = metadatos(registros[0].xes)
    huellas = {"rulesSha256": huella_de_las_reglas(content), "diagramSha256": huella_del_diagrama(diagrama_xml)}
    esperado = {
        "simulationId": id_de_simulacion(huellas["rulesSha256"], huellas["diagramSha256"], banco.SEMILLA,
                                         comunes.get("simulation:startDate")),
        "formatVersion": FORMATO_DEL_REGISTRO, "seed": banco.SEMILLA,
    }
    for clave, valor in esperado.items():
        if datos.get(clave) != valor:
            problemas.append("%s es %r y tenia que ser %r" % (clave, datos.get(clave), valor))
    if comunes.get("simulation:id") != esperado["simulationId"]:
        problemas.append("los registros dicen ser de la simulacion %s y no de la %s"
                         % (comunes.get("simulation:id"), esperado["simulationId"]))
    modelo = datos.get("model") if isinstance(datos.get("model"), dict) else {}
    referencia = {"id": comunes.get("model:id"), "name": comunes.get("model:name"), **huellas}
    for clave, valor in referencia.items():
        if modelo.get(clave) != valor:
            problemas.append("model.%s es %r y tenia que ser %r" % (clave, modelo.get(clave), valor))
        if clave in huellas and comunes.get("model:" + clave) != valor:
            problemas.append("los registros dicen model:%s %r y lo mandado es %r"
                             % (clave, comunes.get("model:" + clave), valor))
    if datos.get("simulation") != reune_registros(registros):
        problemas.append("simulation no es la reunion de sus registros")
    return problemas


def registros_rotos(registros):
    """[(caso, registros, lo que tiene que decir la revision)] a partir de un
    conjunto bueno de al menos dos registros."""
    a, b = registros[0], registros[1]
    identificacion = metadatos(a.xes)["simulation:id"]
    otra = a.xes.replace('value="%s"' % identificacion, 'value="%s"' % identificacion[::-1], 1)
    inicio = b.xes.index("  <trace>")
    ajena = b.xes[inicio:b.xes.index("</trace>", inicio) + len("</trace>")]
    con_ajena = a.xes.replace("</log>", ajena + "\n</log>")
    resto = list(registros[1:])

    def sin(clave, registro):
        # Quita un atributo del log, sea simple o una lista.
        return re.sub(r'\n *<(string|int) key="%s"[^>]*/>|\n *<list key="%s">.*?\n  </list>'
                      % (re.escape(clave), re.escape(clave)), "", registro.xes, count=1, flags=re.S)

    sin_identificacion = [registro._replace(xes=sin("simulation:id", registro)) for registro in registros]
    otro_formato = [registro._replace(xes=registro.xes.replace(
        'key="simulation:formatVersion" value="%s"' % FORMATO_DEL_REGISTRO,
        'key="simulation:formatVersion" value="99"')) for registro in registros]
    return [
        ("ninguno", [], "no hay ningun registro"),
        ("falta uno", resto, "falta el registro de %s" % a.pool),
        ("duplicado", list(registros) + [a], "el registro de %s esta duplicado" % a.pool),
        ("mal formado", [a._replace(xes=a.xes[:len(a.xes) // 2])] + resto, "el registro de %s esta mal formado" % a.pool),
        ("no es XES", [a._replace(xes='<?xml version="1.0"?><otra/>')] + resto, "no es un registro XES"),
        ("de otra simulacion", [a._replace(xes=otra)] + resto, "no es de la misma simulacion"),
        ("traza de otro pool", [a._replace(xes=con_ajena)] + resto, "trae una traza de %s" % b.pool),
        ("con otro nombre", [a._replace(pool="Pool_Inventado")] + resto, "dice ser de %s" % a.pool),
        ("sin identificacion en ninguno", sin_identificacion, "le falta o no vale: simulation:id"),
        ("sin plantilla", [a._replace(xes=sin("pool:staff", a))] + resto, "le falta o no vale: pool:staff"),
        ("de otro formato", otro_formato, "es del formato 99"),
    ]


def compactos(xes):
    """El mismo XES en una sola linea, sin espacios entre etiquetas."""
    return re.sub(r">\s+<", "><", xes)


def con_prefijo(xes):
    """El mismo XES con las etiquetas en xes:, declarado en la raiz y sin
    espacio de nombres por defecto."""
    xes = xes.replace('xmlns="%s"' % XES, 'xmlns:xes="%s"' % XES, 1)
    return re.sub(r"<(/?)(?![?!])([A-Za-z][\w.-]*)", r"<\1xes:\2", xes)


def trazas_canonicas(xes):
    """Las trazas como las entiende un lector de XML: con los nombres resueltos
    a su espacio de nombres y sin los espacios entre etiquetas."""
    return [compactos(ET.tostring(traza, encoding="unicode"))
            for traza in ET.fromstring(xes).iter("{%s}trace" % XES)]


def revisa_otras_escrituras(registros):
    """Que los mismos registros escritos de otra manera valida -en una sola
    linea, o con las etiquetas en xes:- siguen siendo un conjunto y se reunen en
    un XES que se puede leer, con las mismas trazas. Cuantos fallos."""
    fallos, referencia = 0, trazas_canonicas(reune_registros(registros))
    for nombre, escribe in (("en una sola linea", compactos), ("con prefijo xes", con_prefijo)):
        otros = [registro._replace(xes=escribe(registro.xes)) for registro in registros]
        problemas = revisa_registros(otros)
        if not problemas:
            try:
                if trazas_canonicas(reune_registros(otros)) != referencia:
                    problemas.append("reunidos no traen las mismas trazas")
            except (ValueError, ET.ParseError) as error:
                problemas.append("no se reunen en un XES legible: %s" % error)
        etiqueta = "registros %s: se reunen" % nombre
        if problemas:
            print("%-38s FALLA" % etiqueta)
            for linea in problemas:
                print("         %s" % linea)
            fallos += 1
        else:
            print("%-38s ok      %d registros, mismas trazas" % (etiqueta, len(otros)))
    return fallos


def revisa_nombres_vacios(cliente):
    """Que un nombre vacio, que el parser admite, no es un nombre que falta: la
    colaboracion y un pool sin nombre se simulan, y sus registros dicen ''.
    Cuantos fallos."""
    reglas = banco.MODELOS / "02-colaboracion.txt"
    content = reglas.read_text(encoding="utf-8")
    for viejo, nuevo in (("name='Cliente y servicio'", "name=''"),
                         ("id_bpmn='Pool_Cliente', name='Cliente'", "id_bpmn='Pool_Cliente', name=''")):
        if content.count(viejo) != 1:
            print("%-38s FALTA  el 02 ya no tiene %s" % ("nombres vacios", viejo))
            return 1
        content = content.replace(viejo, nuevo)
    respuesta = cliente.post("/simulate", json={"content": content, "seed": banco.SEMILLA})
    datos = respuesta.get_json(silent=True) or {}
    registros = registros_de(datos) or []
    problemas = [] if respuesta.status_code == 200 else ["HTTP %d: %s" % (respuesta.status_code, datos.get("error"))]
    if not problemas:
        problemas += revisa_registros(registros)
        if (datos.get("model") or {}).get("name") != "":
            problemas.append("model.name es %r" % (datos.get("model") or {}).get("name"))
        if [r.nombre for r in registros if r.pool == "Pool_Cliente"] != [""]:
            problemas.append("el registro de Pool_Cliente no se llama ''")
    if problemas:
        print("%-38s FALLA" % "nombres vacios")
        for linea in problemas:
            print("         %s" % linea)
        return 1
    print("%-38s ok      HTTP 200, la colaboracion y Pool_Cliente sin nombre" % "nombres vacios")
    return 0


def revisa_registros_rotos(registros):
    """Cuantos casos de registros rotos no se han detectado."""
    fallos = 0
    for caso, rotos, esperado in registros_rotos(registros):
        problemas = revisa_registros(rotos)
        try:
            reune_registros(rotos)
            reunidos = True
        except ValueError:
            reunidos = False
        if not any(esperado in problema for problema in problemas) or reunidos:
            print("%-38s NO SE DETECTA  esperaba %r; la revision dice %s%s"
                  % ("registros rotos: " + caso, esperado, problemas,
                     "; y se han podido reunir" if reunidos else ""))
            fallos += 1
        else:
            print("%-38s ok      %s" % ("registros rotos: " + caso, esperado))
    return fallos


def revisa_identificacion(cliente):
    """Que la identificacion de la simulacion se puede reproducir y distingue lo
    que tiene que distinguir: el mismo modelo, con la misma semilla, da la
    misma; con otra semilla, otra; y con el diagrama, que es parte del modelo
    simulado, otra que sin el. Cuantos fallos."""
    diagrama = sorted(DIAGRAMAS.glob("*.bpmn"))[0]
    reglas = reglas_de(diagrama.stem)
    content = reglas.read_text(encoding="utf-8")

    def identificacion(semilla, con_diagrama=True):
        cuerpo = {"content": content, "seed": semilla}
        if con_diagrama:
            cuerpo["diagramXML"] = diagrama.read_text(encoding="utf-8")
        return cliente.post("/simulate", json=cuerpo).get_json(silent=True).get("simulationId")

    primera = identificacion(banco.SEMILLA)
    casos = [("la misma con la misma semilla", identificacion(banco.SEMILLA) == primera),
             ("otra con otra semilla", identificacion(banco.SEMILLA + 1) != primera),
             ("otra sin el diagrama", identificacion(banco.SEMILLA, con_diagrama=False) != primera)]
    fallos = 0
    for caso, bien in casos:
        print("%-38s %s" % ("identificacion: " + caso, "ok" if bien else "FALLA"))
        fallos += not bien
    return fallos


def ruta_respuesta(diagrama):
    return ESPERADO / (diagrama.stem + ".respuesta.txt")


def revisa_correctos(cliente):
    """(fallos, registros de la primera respuesta con varios)."""
    fallos, varios = 0, None
    for diagrama in sorted(DIAGRAMAS.glob("*.bpmn")):
        reglas = reglas_de(diagrama.stem)
        codigo, datos = manda(cliente, reglas, diagrama)
        nombre = diagrama.name
        if codigo != 200:
            print("%-38s HTTP %d   %s" % (nombre, codigo, datos.get("error", "")))
            fallos += 1
            continue
        directo = banco.ejecuta(reglas)
        problemas = compara_respuesta(datos, directo, reglas.read_text(encoding="utf-8"),
                                      diagrama.read_text(encoding="utf-8"))
        registros = registros_de(datos)
        if varios is None and not problemas and registros and len(registros) > 1:
            varios = registros
        if sorted(datos.get("warnings", [])) != sorted(directo.warnings):
            problemas.append("avisos distintos: por la API %s, directos %s"
                             % (datos.get("warnings"), directo.warnings))
        if problemas:
            print("%-38s DISTINTO" % nombre)
            for linea in problemas:
                print("         %s" % linea)
            fallos += 1
        else:
            print("%-38s ok      HTTP 200, %d registros, mismas trazas y mismos avisos"
                  % (nombre, len(registros)))
        # 3.1: la marca dibujada basta, sin escribir nada a mano en las reglas.
        limpio = sin_marcas(reglas)
        if limpio is None:
            continue
        codigo, datos = manda(cliente, reglas, diagrama, content=limpio)
        etiqueta = "  ...sin multiInstanceType"
        if codigo != 200:
            print("%-38s HTTP %d   %s" % (etiqueta, codigo, datos.get("error", "")))
            fallos += 1
        else:
            problemas = compara_respuesta(datos, directo, limpio, diagrama.read_text(encoding="utf-8"))
            if problemas:
                print("%-38s DISTINTO  la marca del dibujo no ha llegado al motor" % etiqueta)
                for linea in problemas:
                    print("         %s" % linea)
                fallos += 1
            else:
                print("%-38s ok      la marca llega del dibujo: mismas trazas" % etiqueta)
    return fallos, varios


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

    fallos, varios = revisa_correctos(cliente)
    if varios is None:
        print("%-38s FALTA  ningun diagrama correcto ha dado varios registros" % "registros rotos")
        fallos += 1
    else:
        fallos += revisa_registros_rotos(varios)
        fallos += revisa_otras_escrituras(varios)
    fallos += revisa_nombres_vacios(cliente)
    fallos += revisa_identificacion(cliente)
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
