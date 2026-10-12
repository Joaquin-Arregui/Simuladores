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
import functools
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
from simulator.registros import Registro, metadatos, reune_registros  # noqa: E402


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


def carpeta_de_referencia(ruta, admite_avisos):
    """Donde se congelan los registros de un modelo: uno por pool, <pool>.xes (D10)."""
    return carpeta(admite_avisos) / ruta.stem


def lee_referencia(ruta, admite_avisos):
    """Los registros congelados de un modelo, en el orden de sus pools esperados;
    None si no hay ninguno."""
    ficheros = sorted(carpeta_de_referencia(ruta, admite_avisos).glob("*.xes"))
    if not ficheros:
        return None
    registros = []
    for fichero in ficheros:
        texto = fichero.read_text(encoding="utf-8")
        datos = metadatos(texto)
        registros.append(Registro(datos.get("pool:id") or fichero.stem, datos.get("pool:name"), texto))
    esperados = [pool.strip() for pool in (metadatos(registros[0].xes).get("simulation:participants") or "").split(",")]
    orden = {pool: posicion for posicion, pool in enumerate(esperados)}
    return sorted(registros, key=lambda registro: (orden.get(registro.pool, len(orden)), registro.pool))


def escribe_referencia(ruta, admite_avisos, registros):
    """Sustituye los registros congelados de un modelo por estos: escribe los de
    ahora y retira los de pools que ya no salen, por ejemplo porque se les ha
    cambiado el ID. Si se quedaran, la referencia tendria registros de dos
    versiones del modelo. Devuelve los ficheros retirados."""
    carpeta_ = carpeta_de_referencia(ruta, admite_avisos)
    carpeta_.mkdir(parents=True, exist_ok=True)
    vigentes = {registro.pool + ".xes" for registro in registros}
    for registro in registros:
        (carpeta_ / (registro.pool + ".xes")).write_text(registro.xes, encoding="utf-8")
    retirados = []
    for fichero in sorted(carpeta_.glob("*.xes")):
        if fichero.name not in vigentes:
            fichero.unlink()
            retirados.append(fichero)
    return retirados


@functools.lru_cache(maxsize=None)
def referencia_reunida(ruta, admite_avisos):
    """La ejecucion completa congelada de un modelo, en un solo XES; None si no
    hay, o si sus registros no se pueden reunir: eso lo dice la regresion."""
    registros = lee_referencia(ruta, admite_avisos)
    if registros is None:
        return None
    try:
        return reune_registros(registros)
    except ValueError:
        return None


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
    """Referencias congeladas cuyo modelo ya no existe, y registros sueltos del
    tiempo en que habia uno solo por modelo. Un pool que sobra dentro de la
    carpeta de un modelo lo dice la regresion, que sabe que pools salen."""
    esperadas = {carpeta_de_referencia(r, a) for r, a in modelos()}
    esperadas |= {ruta_avisos(r) for r, a in modelos() if a}
    esperadas |= {ruta_error(r) for r in modelos_con_error()}
    especiales = {ESPERADO_CON_AVISOS, ESPERADO_CON_ERROR, ESPERADO / "integracion"}
    sueltas = set()
    for carpeta_ in (ESPERADO, ESPERADO_CON_AVISOS, ESPERADO_CON_ERROR):
        if carpeta_.is_dir():
            sueltas |= {p for p in carpeta_.iterdir() if p.is_dir() and p not in especiales}
            sueltas |= {p for p in carpeta_.glob("*.xes")}
            sueltas |= {p for p in carpeta_.glob("*.avisos.txt")}
            sueltas |= {p for p in carpeta_.glob("*.error.txt")}
    return sorted(p.relative_to(ESPERADO) for p in sueltas - esperadas)


# El criterio de la tarea 3.2: el MISMO modelo evalua 4 veces si reclaman 4 y 6
# si reclaman 6, sin tocar sus parametros. Con una sola semilla eso no se ve, asi
# que el modelo de las reclamaciones se ejecuta con varias, y en cada una tiene
# que recogerse, reevaluarse y responderse exactamente lo que se reclamo. Que
# entre ellas salgan el 4 y el 6 es lo que pide el criterio; con diez casos al
# 50 % y treinta semillas salen los dos de sobra, y la cuenta es determinista.
CRITERIO_DEL_LOTE = {
    "modelo": "20-reclamaciones",
    "semillas": range(1, 31),
    "cuenta": ("Reclamar", "bpmn:SendTask"),
    "iguales": (("Recoger_Reclamaciones", "bpmn:ReceiveTask"), ("Reevaluar", "bpmn:Task"),
                ("Responder", "bpmn:SendTask")),
    "tienen_que_salir": (4, 6),
}


def cuenta_eventos(xes, ident, tipo, convocatoria=None):
    """Cuantos eventos de ese elemento y ese tipo hay en un XES: uno por ejecucion.

    Con `convocatoria`, solo los de esa ronda.
    """
    import xml.etree.ElementTree as ET
    total = 0
    for evento in ET.fromstring(xes.encode("utf-8")).iter("{http://www.xes-standard.org/}event"):
        valores = {hijo.get("key"): hijo.get("value") for hijo in evento}
        if (valores.get("bpmn:id") == ident and valores.get("bpmn:type") == tipo
                and (convocatoria is None or valores.get("bpmn:convocatoria") == str(convocatoria))):
            total += 1
    return total


def revisa_criterio_del_lote():
    """(lineas, fallos) del criterio de la 3.2 sobre varias semillas."""
    criterio = CRITERIO_DEL_LOTE
    ruta = MODELOS / (criterio["modelo"] + ".txt")
    if not ruta.exists():
        return ["falta el modelo %s" % ruta.name], 1
    texto = ruta.read_text(encoding="utf-8")
    lineas, fallos, vistos = [], 0, {}
    for semilla in criterio["semillas"]:
        try:
            xes = processSimulation(texto, seed=semilla).simulation
        except Exception as error:
            lineas.append("semilla %d: %s: %s" % (semilla, type(error).__name__, error))
            fallos += 1
            continue
        reclamadas = cuenta_eventos(xes, *criterio["cuenta"])
        vistos[reclamadas] = vistos.get(reclamadas, 0) + 1
        for ident, tipo in criterio["iguales"]:
            hechas = cuenta_eventos(xes, ident, tipo)
            if hechas != reclamadas:
                lineas.append("semilla %d: %d %s y %d %s" % (semilla, reclamadas, criterio["cuenta"][0], hechas, ident))
                fallos += 1
    faltan = [n for n in criterio["tienen_que_salir"] if n not in vistos]
    if faltan:
        lineas.append("ninguna semilla da %s reclamaciones" % " ni ".join(map(str, faltan)))
        fallos += 1
    reparto = ", ".join("%d: %d" % par for par in sorted(vistos.items()))
    lineas.insert(0, "%d semillas; reclamaciones (cuantas: semillas) %s" % (len(criterio["semillas"]), reparto))
    return lineas, fallos


# Que ningun modelo correcto se quede bloqueado con otras semillas (3.4: ningun
# falso positivo). El diagnostico del bloqueo solo se calcula cuando el motor ya
# se ha parado, asi que lo que hay que vigilar es que no se pare donde no debe:
# una recepcion que no cierra porque el motor no sabe descartar a un remitente
# daria un "ciclo de espera" en un modelo bueno. Con una semilla no se ve; aqui
# cada modelo limpio y con avisos corre con tres mas. Se probo con veinticinco
# al hacer la 3.4 y ninguno se bloqueo.
SEMILLAS_SIN_BLOQUEO = range(1, 4)


def revisa_sin_bloqueos():
    """(lineas, fallos): los modelos que tienen que terminar, con otras semillas."""
    lineas, fallos, ejecuciones = [], 0, 0
    todos = modelos()
    for ruta, _ in todos:
        texto = ruta.read_text(encoding="utf-8")
        for semilla in SEMILLAS_SIN_BLOQUEO:
            ejecuciones += 1
            try:
                processSimulation(texto, seed=semilla)
            except Exception as error:
                lineas.append("%s, semilla %d: %s: %s" % (ruta.stem, semilla, type(error).__name__, error))
                fallos += 1
    lineas.insert(0, "%d modelos con las semillas %d a %d: %d ejecuciones" % (
        len(todos), SEMILLAS_SIN_BLOQUEO[0], SEMILLAS_SIN_BLOQUEO[-1], ejecuciones))
    return lineas, fallos


# Las convocatorias en serie (4.1 y 4.2). Las instancias del orquestador son
# rondas que van una detras de otra, cada una con casos nuevos. Lo que el XES
# congelado de una sola semilla no garantiza se mira aqui con varias:
# - que una ronda empieza justo cuando acaba la anterior. Antes, se solaparian;
#   despues, algo -una recepcion ya cerrada, por ejemplo- la habria alargado
#   sin hacer nada. El fin de una ronda es su ultimo instante con actividad: la
#   marca o el fin de cualquiera de sus eventos.
# - que cada ronda trae casos nuevos: los mismos por pool en todas, y con
#   indices que siguen a los de la anterior (D3), asi que N trazas nuevas.
# - que ningun mensaje sale de su ronda: el remitente y el destinatario de cada
#   sobre son de la misma.
# Y con el modelo de las tres convocatorias, que cada ronda reevalua y responde
# lo que se reclamo en ella, ni mas ni menos: un lote o una anotacion que
# pasara de una ronda a otra lo descuadraria. Entre todas las rondas tiene que
# haber alguna en la que nadie reclama, para que la recepcion que cierra vacia
# este cubierta.
CRITERIO_DE_LAS_CONVOCATORIAS = {
    "modelo": "31-tres-convocatorias",
    "semillas": range(1, 11),
    "cuenta": ("Reclamar", "bpmn:SendTask"),
    "iguales": (("Recoger_Reclamaciones", "bpmn:ReceiveTask"), ("Reevaluar", "bpmn:Task"),
                ("Responder", "bpmn:SendTask")),
    "tienen_que_salir": (0,),
}


def lee_convocatorias(xes):
    """{convocatoria: {"casos": {participante: [indices]}, "eventos": [atributos]}}."""
    import xml.etree.ElementTree as ET
    ns = "{http://www.xes-standard.org/}"
    rondas = {}
    for traza in ET.fromstring(xes.encode("utf-8")).iter(ns + "trace"):
        atributos = {hijo.get("key"): hijo.get("value") for hijo in traza if hijo.tag != ns + "event"}
        ronda = rondas.setdefault(int(atributos["bpmn:convocatoria"]), {"casos": {}, "eventos": []})
        ronda["casos"].setdefault(atributos["bpmn:participant"], []).append(int(atributos["bpmn:instance"]))
        for evento in traza.iter(ns + "event"):
            ronda["eventos"].append({hijo.get("key"): hijo.get("value") for hijo in evento})
    return rondas


def problemas_de_las_convocatorias(xes):
    """Lo que esta mal en el reparto en rondas de un XES; nada si solo hay una."""
    from datetime import datetime
    rondas = lee_convocatorias(xes)
    if len(rondas) < 2:
        return []
    problemas = []
    if sorted(rondas) != list(range(1, len(rondas) + 1)):
        problemas.append("las rondas no son 1 a %d sino %s" % (len(rondas), sorted(rondas)))
    # Cada caso es de una sola ronda; si se repite, sus mensajes no se pueden
    # atribuir, y lo primero es decir que se repite.
    rondas_del_caso = {}
    for numero, ronda in sorted(rondas.items()):
        for participante, indices in ronda["casos"].items():
            for indice in indices:
                rondas_del_caso.setdefault("%s - %d" % (participante, indice), []).append(numero)
    for caso, suyas in sorted(rondas_del_caso.items()):
        if len(suyas) > 1:
            problemas.append("el caso %s esta en las rondas %s" % (caso, suyas))
    de_la_ronda = {caso: suyas[0] for caso, suyas in rondas_del_caso.items() if len(suyas) == 1}
    ultimo, fin_anterior = {}, None
    pools = set(rondas[min(rondas)]["casos"])
    for numero in sorted(rondas):
        ronda = rondas[numero]
        if set(ronda["casos"]) != pools:
            problemas.append("ronda %d: tiene casos de %s y la primera de %s"
                             % (numero, sorted(ronda["casos"]), sorted(pools)))
        for participante, indices in sorted(ronda["casos"].items()):
            previo = ultimo.get(participante, 0)
            cuantos = len(rondas[min(rondas)]["casos"].get(participante, []))
            if sorted(indices) != list(range(previo + 1, previo + cuantos + 1)):
                problemas.append("ronda %d: %s trae los casos %s, y tocaban %d nuevos desde el %d"
                                 % (numero, participante, sorted(indices), cuantos, previo + 1))
            ultimo[participante] = max(indices + [previo])
        for evento in ronda["eventos"]:
            if evento.get("bpmn:convocatoria") != str(numero):
                problemas.append("ronda %d: el evento %s de %s dice ser de la %s"
                                 % (numero, evento.get("bpmn:id"), evento.get("time:timestamp"),
                                    evento.get("bpmn:convocatoria")))
            for clave in ("bpmn:messageTarget", "bpmn:messageSender"):
                otro = evento.get(clave)
                if otro and otro not in rondas_del_caso:
                    problemas.append("ronda %d: %s en %s tiene %s %s, que no tiene traza"
                                     % (numero, evento.get("bpmn:id"), evento.get("time:timestamp"), clave, otro))
                elif otro and otro in de_la_ronda and de_la_ronda[otro] != numero:
                    problemas.append("ronda %d: %s en %s tiene %s %s, de la ronda %s"
                                     % (numero, evento.get("bpmn:id"), evento.get("time:timestamp"),
                                        clave, otro, de_la_ronda.get(otro)))
        instantes = [datetime.fromisoformat(evento[clave]) for evento in ronda["eventos"]
                     for clave in ("time:timestamp", "time:endTime") if evento.get(clave)]
        if not instantes:
            problemas.append("ronda %d sin eventos" % numero)
            continue
        inicio, fin = min(instantes), max(instantes)
        if fin_anterior is not None and inicio != fin_anterior:
            como = "antes" if inicio < fin_anterior else "despues"
            problemas.append("la ronda %d empieza en %s, %s de que acabe la %d en %s"
                             % (numero, inicio.isoformat(), como, numero - 1, fin_anterior.isoformat()))
        fin_anterior = fin
    return problemas


def revisa_convocatorias():
    """(lineas, fallos) de las convocatorias en serie, con la semilla del banco y otras."""
    lineas, fallos, ejecuciones = [], 0, 0
    reunidas = {(ruta, admite): referencia_reunida(ruta, admite) for ruta, admite in modelos()}
    con_rondas = [(ruta, admite) for (ruta, admite), xes in reunidas.items()
                  if xes is not None and len(lee_convocatorias(xes)) > 1]
    criterio = CRITERIO_DE_LAS_CONVOCATORIAS
    if criterio["modelo"] not in {ruta.stem for ruta, _ in con_rondas}:
        lineas.append("el modelo %s no existe o no tiene varias rondas" % criterio["modelo"])
        fallos += 1
    vistos = {}
    for ruta, admite in con_rondas:
        texto = ruta.read_text(encoding="utf-8")
        resultados = [("la referencia", reunidas[(ruta, admite)])]
        semillas = sorted(set(SEMILLAS_SIN_BLOQUEO)
                          | (set(criterio["semillas"]) if ruta.stem == criterio["modelo"] else set()))
        for semilla in semillas:
            ejecuciones += 1
            try:
                resultados.append(("semilla %d" % semilla, processSimulation(texto, seed=semilla).simulation))
            except Exception as error:
                lineas.append("%s, semilla %d: %s: %s" % (ruta.stem, semilla, type(error).__name__, error))
                fallos += 1
        for cual, xes in resultados:
            for problema in problemas_de_las_convocatorias(xes)[:6]:
                lineas.append("%s, %s: %s" % (ruta.stem, cual, problema))
                fallos += 1
            if ruta.stem != criterio["modelo"] or cual == "la referencia":
                continue
            for ronda in sorted(lee_convocatorias(xes)):
                reclamadas = cuenta_eventos(xes, *criterio["cuenta"], convocatoria=ronda)
                vistos[reclamadas] = vistos.get(reclamadas, 0) + 1
                for ident, tipo in criterio["iguales"]:
                    hechas = cuenta_eventos(xes, ident, tipo, convocatoria=ronda)
                    if hechas != reclamadas:
                        lineas.append("%s, %s, ronda %d: %d %s y %d %s"
                                      % (ruta.stem, cual, ronda, reclamadas, criterio["cuenta"][0], hechas, ident))
                        fallos += 1
    faltan = [n for n in criterio["tienen_que_salir"] if n not in vistos]
    if faltan:
        lineas.append("ninguna ronda de %s da %s reclamaciones" % (criterio["modelo"], " ni ".join(map(str, faltan))))
        fallos += 1
    reparto = ", ".join("%d: %d" % par for par in sorted(vistos.items()))
    lineas.insert(0, "%d modelos con varias rondas: %d ejecuciones; en %s, rondas por reclamaciones "
                  "(cuantas: rondas) %s" % (len(con_rondas), ejecuciones, criterio["modelo"], reparto))
    return lineas, fallos


# Los modos de llegada (4.3, D13). Los casos de cada pool llegan, contando desde
# que se abre su convocatoria, de una de tres maneras: escalonados, el i-esimo
# (i - 1) * frequency despues; simultaneos, todos al abrirse; uniformes, cada
# uno en un segundo entero al azar entre 0 y arrivalWindow. El orquestador, con
# un caso por ronda, llega al abrirse. Lo que se espera sale de las reglas, no
# del motor, y lo que ha pasado, del XES: un caso llega en el primer instante
# de su traza. La primera ronda se abre en FECHA_INICIO y cada una de las
# siguientes cuando acaba la anterior. Se miran las referencias de todos los
# modelos, porque todos llegan de alguna manera, y el modelo de los tres modos
# con varias semillas: ninguna llegada uniforme puede salir de su ventana, y
# entre todas tienen que llenarla -alguna en su primer cuarto y alguna en el
# ultimo- con una media cerca del centro.
CRITERIO_DE_LAS_LLEGADAS = {
    "modelo": "33-tres-modos-de-llegada",
    "semillas": range(1, 11),
}

# El XES guarda los instantes en milisegundos: al escribirse, cada uno se
# redondea al microsegundo y se corta al milisegundo, asi que pierde menos de
# uno, y la distancia entre dos instantes leidos se aparta de la real menos de
# uno tambien. Lo que se espera se compara con esa precision y no con la de la
# coma flotante: con frequency=0.1 el cuarto caso tiene que llegar a los
# 3 * 0.1 = 0.30000000000000004 segundos, el motor llega a los 0.3, el XES dice
# 00.300, y eso es llegar a tiempo.
PRECISION_DEL_XES = 0.001


def mismo_instante(segundos, esperados):
    """Si dos tiempos en segundos coinciden a la precision del XES."""
    return abs(segundos - esperados) < PRECISION_DEL_XES


def modos_de_llegada(texto):
    """{participante: (modo, valor)} segun las reglas: la frequency de la escalonada
    o la ventana de la uniforme."""
    from simulator.parser import parse_bpmn_elements
    elementos, raiz, _, _ = parse_bpmn_elements(texto, [])
    participantes = [elementos[pid] for _, pid in elementos.get("participants", [])]
    if not participantes:
        return {raiz: ("staggered", elementos[raiz].frequency)}
    modos = {}
    for pool in participantes:
        if pool.role == "orchestrator" and pool.multiplicity:
            modos[pool.id_bpmn] = ("simultaneous", 0)
            continue
        modo = pool.arrival_mode or "staggered"
        modos[pool.id_bpmn] = (modo, {"staggered": pool.frequency, "uniform": pool.arrival_window}.get(modo, 0))
    return modos


def problemas_de_las_llegadas(texto, xes):
    """(problemas, {participante: [segundos tras abrirse su ronda]}) de los uniformes."""
    import xml.etree.ElementTree as ET
    from datetime import datetime, timedelta
    ns = "{http://www.xes-standard.org/}"
    modos = modos_de_llegada(texto)
    rondas = {}
    for traza in ET.fromstring(xes.encode("utf-8")).iter(ns + "trace"):
        atributos = {hijo.get("key"): hijo.get("value") for hijo in traza if hijo.tag != ns + "event"}
        eventos = list(traza.iter(ns + "event"))
        instantes = [datetime.fromisoformat(hijo.get("value")) for evento in eventos
                     for hijo in evento if hijo.get("key") == "time:timestamp"]
        finales = [datetime.fromisoformat(hijo.get("value")) for evento in eventos
                   for hijo in evento if hijo.get("key") in ("time:timestamp", "time:endTime")]
        if not instantes:
            continue
        ronda = rondas.setdefault(int(atributos["bpmn:convocatoria"]), {"llegadas": {}, "fin": None})
        ronda["llegadas"].setdefault(atributos["bpmn:participant"], []).append(
            (int(atributos["bpmn:instance"]), min(instantes)))
        ronda["fin"] = max(finales + ([ronda["fin"]] if ronda["fin"] else []))
    problemas, uniformes = [], {}
    apertura = datetime.fromisoformat(FECHA_INICIO)
    for numero in sorted(rondas):
        ronda = rondas[numero]
        for participante, casos in sorted(ronda["llegadas"].items()):
            if participante not in modos:
                problemas.append("ronda %d: %s no esta en las reglas" % (numero, participante))
                continue
            modo, valor = modos[participante]
            for posicion, (indice, llegada) in enumerate(sorted(casos), 1):
                tras = (llegada - apertura).total_seconds()
                if modo == "staggered":
                    esperado = (posicion - 1) * valor
                    if not mismo_instante(tras, esperado):
                        problemas.append("ronda %d: %s - %d llega %gs despues de abrirse y, escalonado cada %g, "
                                         "tocaba a los %g" % (numero, participante, indice, tras, valor, esperado))
                elif modo == "simultaneous":
                    if not mismo_instante(tras, 0):
                        problemas.append("ronda %d: %s - %d llega %gs despues de abrirse y tenia que llegar al "
                                         "abrirse" % (numero, participante, indice, tras))
                else:
                    uniformes.setdefault(participante, []).append(tras)
                    if not (-PRECISION_DEL_XES < tras < valor + PRECISION_DEL_XES
                            and mismo_instante(tras, round(tras))):
                        problemas.append("ronda %d: %s - %d llega %gs despues de abrirse, fuera de su ventana "
                                         "de 0 a %d en segundos enteros" % (numero, participante, indice, tras, valor))
        apertura = ronda["fin"]
    return problemas, uniformes


def revisa_llegadas():
    """(lineas, fallos) de los modos de llegada: las referencias de todos los
    modelos, y el de los tres modos con varias semillas."""
    lineas, fallos, ejecuciones = [], 0, 0
    criterio = CRITERIO_DE_LAS_LLEGADAS
    todos = modelos()
    for ruta, admite in todos:
        referencia = referencia_reunida(ruta, admite)
        if referencia is None:
            continue
        problemas, _ = problemas_de_las_llegadas(ruta.read_text(encoding="utf-8"), referencia)
        for problema in problemas[:6]:
            lineas.append("%s, la referencia: %s" % (ruta.stem, problema))
            fallos += 1
    ruta = MODELOS / (criterio["modelo"] + ".txt")
    if not ruta.exists():
        lineas.append("falta el modelo %s" % ruta.name)
        return lineas, fallos + 1
    texto = ruta.read_text(encoding="utf-8")
    ventanas = {participante: valor for participante, (modo, valor) in modos_de_llegada(texto).items()
                if modo == "uniform"}
    if not ventanas:
        lineas.append("%s no tiene ningun pool con llegada uniforme" % criterio["modelo"])
        fallos += 1
    sorteos = {}
    for semilla in criterio["semillas"]:
        ejecuciones += 1
        try:
            xes = processSimulation(texto, seed=semilla).simulation
        except Exception as error:
            lineas.append("%s, semilla %d: %s: %s" % (ruta.stem, semilla, type(error).__name__, error))
            fallos += 1
            continue
        problemas, uniformes = problemas_de_las_llegadas(texto, xes)
        for problema in problemas[:6]:
            lineas.append("%s, semilla %d: %s" % (ruta.stem, semilla, problema))
            fallos += 1
        for participante, tras in uniformes.items():
            sorteos.setdefault(participante, []).extend(tras)
    resumen = []
    for participante, ventana in sorted(ventanas.items()):
        tras = sorteos.get(participante, [])
        if not tras:
            lineas.append("%s: ningun caso de %s ha llegado" % (criterio["modelo"], participante))
            fallos += 1
            continue
        media = sum(tras) / len(tras)
        resumen.append("%s: %d llegadas entre %g y %g, media %.1f de 0 a %d"
                       % (participante, len(tras), min(tras), max(tras), media, ventana))
        if min(tras) > ventana / 4 or max(tras) < 3 * ventana / 4:
            lineas.append("%s: las llegadas de %s no llenan la ventana de 0 a %d: van de %g a %g"
                          % (criterio["modelo"], participante, ventana, min(tras), max(tras)))
            fallos += 1
        if abs(media - ventana / 2) > ventana / 8:
            lineas.append("%s: la media de las llegadas de %s es %.1f, lejos del centro de la ventana, %g"
                          % (criterio["modelo"], participante, media, ventana / 2))
            fallos += 1
    lineas.insert(0, "%d referencias y %d ejecuciones de %s; %s" % (
        len(todos), ejecuciones, criterio["modelo"], "; ".join(resumen)))
    return lineas, fallos
