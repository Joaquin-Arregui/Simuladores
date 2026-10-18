"""Los registros de una simulacion: un XES por pool (D10), y como se revisan y se reunen.

El runtime escribe un fichero por pool con sus trazas y sus metadatos. Todos
comparten los mismos metadatos comunes -la identificacion de la simulacion, la
huella del modelo, la version del formato, la semilla, la base temporal, los
pools esperados y el numero de convocatorias-, que es lo que permite reunirlos
despues sin consultar nada mas, ni siquiera unas reglas que hayan cambiado. Y
cada uno lleva lo suyo: el nombre y el rol del pool, si sus recursos son
finitos o infinitos, y su plantilla completa, con quien no llego a trabajar,
sus carriles y, en un Process, sus roles.

Aqui se calculan las huellas y la identificacion, se revisa que un conjunto de
registros este completo y sea coherente, y se reunen en un solo XES con la
ejecucion entera. La API ya no lo devuelve (5.6): el Modeler ofrece los
registros por separado desde la 5.5. Lo usa el banco de pruebas, que compara
ejecuciones completas, y sirve para minarlas de una vez.

Las listas son listas XES anidadas y no contenedores, porque PM4Py lee las
listas y se salta los contenedores.
"""
import copy
import hashlib
from typing import NamedTuple
from xml.etree import ElementTree as ET
from xml.parsers import expat
from xml.sax.saxutils import quoteattr

# Sube cuando cambia lo que un registro contiene o como se escribe.
FORMATO_DEL_REGISTRO = "2"
XES = "http://www.xes-standard.org/"
ET.register_namespace("", XES)

# Los metadatos que tienen que ser identicos en todos los registros de una misma
# simulacion. model:diagramSha256 solo esta si se simulo con diagrama.
COMUNES = ("simulation:id", "simulation:formatVersion", "simulation:seed", "simulation:startDate",
           "simulation:participants", "simulation:convocatorias",
           "model:id", "model:name", "model:rulesSha256", "model:diagramSha256")
# Lo que todo registro tiene que traer. Comparar los comunes entre registros no
# basta: si a todos les falta el mismo, coinciden igual. Sin esto no se sabe de
# que simulacion es un registro, ni se puede reunir, ni entender su pool sin las
# reglas. Los identificadores y los valores, ademas, no pueden estar vacios; los
# nombres si, porque el parser admite name='' y un nombre vacio es un nombre.
NO_VACIOS = ("simulation:id", "simulation:formatVersion", "simulation:seed", "simulation:startDate",
             "simulation:participants", "simulation:convocatorias", "model:id", "model:rulesSha256",
             "pool:id", "pool:resources")
PRESENTES = ("model:name", "pool:name", "pool:staff")
ENTEROS = ("simulation:seed", "simulation:convocatorias")


class Registro(NamedTuple):
    """El XES de un pool, con el ID y el nombre del pool."""
    pool: str
    nombre: str
    xes: str


def huella_de_las_reglas(reglas):
    """sha256 de las reglas tal como las lee el parser.

    Sin comentarios, sin lineas en blanco y sin espacios a los lados: lo que
    no cambia el modelo no cambia su huella, y dos copias del mismo modelo,
    una comentada y otra no, son la misma simulacion.
    """
    lineas = (linea.strip() for linea in reglas.splitlines())
    canonicas = "\n".join(linea for linea in lineas if linea and not linea.startswith("#"))
    return hashlib.sha256(canonicas.encode("utf-8")).hexdigest()


def huella_del_diagrama(xml):
    """sha256 del diagrama tal cual: desde la 3.1 la marca de multiinstancia sale
    de el, asi que es parte del modelo simulado."""
    return hashlib.sha256(xml.encode("utf-8")).hexdigest()


def id_de_simulacion(huella_reglas, huella_diagrama, semilla, inicio, formato=FORMATO_DEL_REGISTRO):
    """Identificacion reproducible: el mismo modelo, con la misma semilla y la
    misma base temporal, da siempre la misma, y cualquier cambio en una de esas
    cosas da otra."""
    texto = "\n".join([formato, huella_reglas, huella_diagrama or "", str(semilla), inicio])
    return hashlib.sha256(texto.encode("utf-8")).hexdigest()[:16]


def _etiqueta(nodo):
    return nodo.tag.split("}")[-1]


def valor_xes(nodo):
    """El valor de un atributo XES; una lista, como [(clave, valor)]."""
    if _etiqueta(nodo) == "list":
        valores = nodo.find("{%s}values" % XES)
        return [(hijo.get("key"), valor_xes(hijo)) for hijo in (valores if valores is not None else [])]
    return nodo.get("value")


def _atributos_del_log(raiz):
    return [hijo for hijo in raiz if _etiqueta(hijo) not in {"extension", "global", "classifier", "trace"}]


def metadatos(xes):
    """{clave: valor} de los atributos de un registro. Falla si no es un XES."""
    raiz = ET.fromstring(xes)
    if raiz.tag != "{%s}log" % XES:
        raise ValueError("no es un registro XES")
    return {nodo.get("key"): valor_xes(nodo) for nodo in _atributos_del_log(raiz)}


def _atributos_de(nodo):
    return {hijo.get("key"): hijo.get("value") for hijo in nodo if _etiqueta(hijo) != "event"}


def revisa_registros(registros):
    """Lo que falla en un conjunto de registros de una simulacion; [] si nada.

    Uno por pool esperado, ni mas ni menos; cada uno un XES bien formado que
    dice ser de su pool; todos de la misma simulacion; y cada traza en el
    registro de su pool, sin casos repetidos.
    """
    return _lee_y_revisa(registros)[0]


class _Leido(NamedTuple):
    """Lo que la revision guarda de un registro para reunirlo: la raiz sin las
    trazas, para la cabecera; el texto en bytes, y de cada traza donde empieza,
    donde acaba su nombre, donde acaba ella y que espacios de nombres hay que
    declararle para copiarla tal cual (_declaraciones)."""
    raiz: ET.Element
    datos: bytes
    trazas: list


def _declaraciones(raiz, propias):
    """Lo que hay que anadir a la etiqueta de una traza para que, copiada dentro
    del XES reunido, sus nombres sigan en los mismos espacios de nombres.

    En el reunido la raiz solo declara el de XES por defecto. Una traza que
    venia de una raiz con otras declaraciones -<xes:trace> con xmlns:xes, o
    sin espacio por defecto- las necesita en su propia etiqueta, salvo las que
    ya declare ella. Con lo que escribe el motor no hace falta ninguna.
    """
    extra = []
    if None not in propias and raiz.get(None, "") != XES:
        extra.append(" xmlns=%s" % quoteattr(raiz.get(None, "")))
    for prefijo, uri in sorted((p, u) for p, u in raiz.items() if p is not None):
        if prefijo not in propias:
            extra.append(" xmlns:%s=%s" % (prefijo, quoteattr(uri)))
    return "".join(extra).encode("utf-8")


def _recorre(xes):
    """_Leido de un registro, y [(participante, instancia)] de sus trazas.

    Se lee de una pasada con expat, que dice en que byte empieza y acaba cada
    traza, este el XML indentado o en una sola linea. De las trazas solo se
    guarda eso y su caso: con miles de casos un registro son decenas de megas,
    y tenerlo entero en memoria costaba mas que simularlo. Lo demas -la raiz y
    sus atributos- se construye como siempre.
    """
    datos = xes.encode("utf-8")
    constructor = ET.TreeBuilder()
    lector = expat.ParserCreate(namespace_separator="}")
    estado = {"profundidad": 0, "traza": None, "raiz": {}}
    trazas, casos, pendientes = [], [], []

    def declara(prefijo, uri):
        # Llega antes que el elemento que la declara.
        pendientes.append((prefijo, uri or ""))

    def etiqueta(nombre):
        return "{" + nombre if "}" in nombre else nombre

    def empieza(nombre, atributos):
        estado["profundidad"] += 1
        propias = dict(pendientes)
        pendientes.clear()
        if estado["profundidad"] == 1:
            estado["raiz"] = propias
        traza = estado["traza"]
        if traza is not None:
            if estado["profundidad"] == 3 and atributos.get("key") in traza["caso"]:
                traza["caso"][atributos["key"]] = atributos.get("value")
            return
        if estado["profundidad"] == 2 and nombre == XES + "}trace":
            inicio = lector.CurrentByteIndex
            corte = inicio + 1
            while datos[corte:corte + 1] not in (b" ", b"\t", b"\r", b"\n", b"/", b">", b""):
                corte += 1
            estado["traza"] = {"inicio": inicio, "corte": corte,
                               "extra": _declaraciones(estado["raiz"], propias),
                               "caso": {"bpmn:participant": None, "bpmn:instance": None}}
            return
        constructor.start(etiqueta(nombre), atributos)

    def acaba(nombre):
        traza = estado["traza"]
        if traza is not None and estado["profundidad"] == 2:
            # El final de </trace>, o de <trace/> si no tiene nada dentro.
            trazas.append((traza["inicio"], traza["corte"], datos.index(b">", lector.CurrentByteIndex) + 1,
                           traza["extra"]))
            casos.append((traza["caso"]["bpmn:participant"], traza["caso"]["bpmn:instance"]))
            estado["traza"] = None
        elif traza is None:
            constructor.end(etiqueta(nombre))
        estado["profundidad"] -= 1

    lector.StartNamespaceDeclHandler = declara
    lector.StartElementHandler = empieza
    lector.EndElementHandler = acaba
    lector.Parse(datos, True)
    return _Leido(constructor.close(), datos, trazas), casos


def _faltan(datos):
    """Los obligatorios que faltan o no valen, de los atributos de un registro."""
    problemas = [clave for clave in NO_VACIOS if datos.get(clave) in (None, "")]
    problemas += [clave for clave in PRESENTES if datos.get(clave) is None]
    problemas += ["%s no es un entero" % clave for clave in ENTEROS
                  if datos.get(clave) not in (None, "") and not str(datos.get(clave)).lstrip("-").isdigit()]
    if datos.get("pool:staff") is not None and not isinstance(datos.get("pool:staff"), list):
        problemas.append("pool:staff no es una lista")
    if datos.get("pool:resources") not in (None, "", "finite", "infinite"):
        problemas.append("pool:resources no es finite ni infinite")
    return problemas


def _lee_y_revisa(registros):
    """(problemas, [_Leido]): cada registro se lee una sola vez, para revisarlo
    y para reunirlo."""
    if not registros:
        return ["no hay ningun registro"], []
    problemas, vistos, comunes, primero, leidos = [], set(), None, None, []
    for registro in registros:
        pool = registro.pool
        if pool in vistos:
            problemas.append("el registro de %s esta duplicado" % pool)
            continue
        vistos.add(pool)
        try:
            leido, trazas = _recorre(registro.xes)
        except (expat.ExpatError, ET.ParseError) as error:
            problemas.append("el registro de %s esta mal formado: %s" % (pool, error))
            continue
        if leido.raiz.tag != "{%s}log" % XES:
            problemas.append("el registro de %s esta mal formado: no es un registro XES" % pool)
            continue
        leidos.append(leido)
        datos = {nodo.get("key"): valor_xes(nodo) for nodo in _atributos_del_log(leido.raiz)}
        faltan = _faltan(datos)
        if faltan:
            problemas.append("al registro de %s le falta o no vale: %s" % (pool, ", ".join(faltan)))
        if datos.get("simulation:formatVersion") not in (None, "", FORMATO_DEL_REGISTRO):
            problemas.append("el registro de %s es del formato %s, y aqui se lee el %s"
                             % (pool, datos["simulation:formatVersion"], FORMATO_DEL_REGISTRO))
        if datos.get("pool:id") not in (None, "") and datos.get("pool:id") != pool:
            problemas.append("el registro de %s dice ser de %s" % (pool, datos.get("pool:id")))
        if datos.get("pool:name") is not None and datos.get("pool:name") != registro.nombre:
            problemas.append("el registro de %s dice llamarse %r y no %r"
                             % (pool, datos.get("pool:name"), registro.nombre))
        propios = {clave: datos.get(clave) for clave in COMUNES}
        if comunes is None:
            comunes, primero = propios, pool
        elif propios != comunes:
            distintos = [clave for clave in COMUNES if propios[clave] != comunes[clave]]
            problemas.append("el registro de %s no es de la misma simulacion que el de %s: difieren %s"
                             % (pool, primero, ", ".join(distintos)))
        casos = set()
        for caso in trazas:
            if caso[0] != pool:
                problemas.append("el registro de %s trae una traza de %s" % (pool, caso[0]))
            elif caso in casos:
                problemas.append("el registro de %s repite el caso %s - %s" % (pool, caso[0], caso[1]))
            casos.add(caso)
    if comunes is not None and comunes["simulation:participants"]:
        esperados = [pool.strip() for pool in comunes["simulation:participants"].split(",") if pool.strip()]
        problemas += ["falta el registro de %s" % pool for pool in esperados if pool not in vistos]
        problemas += ["sobra el registro de %s, que no es de ningun pool esperado" % pool
                      for pool in sorted(vistos - set(esperados))]
    return problemas, leidos


def reune_registros(registros):
    """Un solo XES con la ejecucion completa: los metadatos comunes, los de cada
    pool en una lista logs:<pool>, y todas las trazas, pool a pool.

    Solo si el conjunto esta completo y es coherente (revisa_registros): reunir
    registros de dos simulaciones, o a los que les falta uno, daria una
    ejecucion que nunca ocurrio. La cabecera se escribe de nuevo; las trazas se
    copian tal cual del texto de cada registro, sin volver a construirlas.
    """
    problemas, leidos = _lee_y_revisa(registros)
    if problemas:
        raise ValueError("No se pueden reunir los registros: " + "; ".join(problemas) + ".")
    primera = leidos[0].raiz
    reunido = ET.Element(primera.tag, dict(primera.attrib))
    for hijo in primera:
        if _etiqueta(hijo) in {"extension", "classifier"}:
            reunido.append(copy.deepcopy(hijo))
    for hijo in _atributos_del_log(primera):
        if hijo.get("key") in COMUNES:
            reunido.append(copy.deepcopy(hijo))
    for registro, leido in zip(registros, leidos):
        lista = ET.SubElement(reunido, "{%s}list" % XES, key="logs:%s" % registro.pool)
        valores = ET.SubElement(lista, "{%s}values" % XES)
        for hijo in _atributos_del_log(leido.raiz):
            if hijo.get("key") not in COMUNES:
                valores.append(copy.deepcopy(hijo))
    ET.indent(reunido, space="  ")
    cabecera = ET.tostring(reunido, encoding="unicode")
    cierre = "</%s>" % _etiqueta(reunido)
    abierta = cabecera[:-len(cierre)] if cabecera.endswith(cierre) else cabecera
    partes = ['<?xml version="1.0" encoding="UTF-8"?>\n', abierta.rstrip(" ")]
    if not partes[-1].endswith("\n"):
        partes.append("\n")
    for leido in leidos:
        for desde, corte, hasta, extra in leido.trazas:
            partes.append("  " + (leido.datos[desde:corte] + extra + leido.datos[corte:hasta]).decode("utf-8") + "\n")
    partes.append("</log>\n")
    return "".join(partes)
