#!/usr/bin/env python3
"""Lee con PM4Py los registros congelados del banco (4.4).

    python3 pruebas/lee_con_pm4py.py

Necesita pm4py, que no es una dependencia del Backend (pip install pm4py). Como
valida_bpmn.mjs con bpmn-moddle, mira con una herramienta ajena que lo que
escribe el motor se puede leer, y que con lo leido basta para tres cosas:

- Leer cada registro: tantas trazas y eventos como tiene el fichero, con las
  fechas convertidas en fechas.
- Reunir la ejecucion completa de un modelo: todos sus registros son de la
  misma simulacion, estan los de todos los pools esperados y ninguno repetido,
  y juntos tienen todos los casos.
- Saber quien esta libre sin consultar las reglas, que pueden haber cambiado
  despues: la plantilla de cada pool esta en su registro, tambien quien no
  llega a trabajar, y lo ocupado sale de los eventos. En el 32 Carla no trabaja
  en ninguna ronda, y tiene que salir como libre de principio a fin.
"""
import logging
import sys
import warnings
from xml.etree import ElementTree as ET

import banco

# Quien tiene que salir sin ninguna asignacion: si no sale, la plantilla del
# registro no esta completa.
SIN_ASIGNACIONES = {("32-convocatorias-que-empiezan-de-cero", "Pool_Orquestador"): ["Carla"]}


def plantilla(log):
    """Las personas de la plantilla del pool, tal como las guarda el registro."""
    lista = log.attributes.get("pool:staff") or {}
    return [valor for _, valor in lista.get("children", [])]


def ocupados(log):
    """(persona, desde, hasta) de cada evento con recurso."""
    tramos = []
    for traza in log:
        for evento in traza:
            persona = evento.get("bpmn:userTask")
            if persona and "time:endTime" in evento:
                tramos.append((persona, evento["time:timestamp"], evento["time:endTime"]))
    return tramos


def libres_en(log, instante):
    """Quien de la plantilla no esta trabajando en ese instante."""
    trabajando = {persona for persona, desde, hasta in ocupados(log) if desde <= instante < hasta}
    return [persona for persona in plantilla(log) if persona not in trabajando]


def main():
    try:
        import pm4py
    except ImportError:
        print("Falta pm4py: instalalo con pip install pm4py. No se comprueba nada.")
        return 1
    warnings.filterwarnings("ignore")
    logging.disable(logging.WARNING)
    fallos, ficheros = 0, 0
    for ruta, admite in banco.modelos():
        carpeta = banco.carpeta_de_referencia(ruta, admite)
        rutas = sorted(carpeta.glob("*.xes"))
        nombre = banco.etiqueta(ruta, admite)
        if not rutas:
            print("%-40s SIN REGISTROS" % nombre)
            fallos += 1
            continue
        problemas, logs = [], {}
        for fichero in rutas:
            ficheros += 1
            raiz = ET.parse(fichero).getroot()
            ns = "{http://www.xes-standard.org/}"
            trazas = len(raiz.findall(ns + "trace"))
            eventos = len(raiz.findall("%strace/%sevent" % (ns, ns)))
            log = pm4py.read_xes(str(fichero), return_legacy_log_object=True, show_progress_bar=False)
            leidos = sum(len(traza) for traza in log)
            if len(log) != trazas or leidos != eventos:
                problemas.append("%s: PM4Py lee %d trazas y %d eventos de %d y %d"
                                 % (fichero.name, len(log), leidos, trazas, eventos))
            if any(not hasattr(evento.get("time:timestamp"), "isoformat") for traza in log for evento in traza):
                problemas.append("%s: hay fechas que PM4Py no lee como fechas" % fichero.name)
            pool = log.attributes.get("pool:id")
            if pool in logs:
                problemas.append("%s: el pool %s ya tenia registro" % (fichero.name, pool))
            logs[pool] = log
        identificaciones = {log.attributes.get("simulation:id") for log in logs.values()}
        if len(identificaciones) != 1:
            problemas.append("los registros son de varias simulaciones: %s" % sorted(map(str, identificaciones)))
        cualquiera = next(iter(logs.values()))
        esperados = [pool.strip() for pool in str(cualquiera.attributes.get("simulation:participants", "")).split(",")]
        if sorted(logs) != sorted(esperados):
            problemas.append("hay registros de %s y se esperaban %s" % (sorted(logs), esperados))
        completa = pm4py.convert_to_dataframe(pm4py.objects.log.obj.EventLog(
            [traza for log in logs.values() for traza in log]))
        casos = completa["case:concept:name"].nunique()
        if casos != sum(len(log) for log in logs.values()):
            problemas.append("al reunir los registros salen %d casos de %d" % (casos, sum(len(log) for log in logs.values())))
        libres = {}
        for pool, log in logs.items():
            if not plantilla(log):
                problemas.append("el registro de %s no trae su plantilla" % pool)
            sin_trabajo = [persona for persona in plantilla(log)
                           if persona not in {p for p, _, _ in ocupados(log)}]
            if sin_trabajo:
                instantes = sorted({desde for _, desde, _ in ocupados(log)})
                if any(set(sin_trabajo) - set(libres_en(log, instante)) for instante in instantes):
                    problemas.append("en %s, quien no trabaja nunca sale ocupado en algun instante" % pool)
                libres[pool] = sin_trabajo
            esperado = SIN_ASIGNACIONES.get((ruta.stem, pool))
            if esperado is not None and sin_trabajo != esperado:
                problemas.append("en %s tenian que salir sin asignaciones %s y salen %s" % (pool, esperado, sin_trabajo))
        if problemas:
            print("%-40s FALLA" % nombre)
            for problema in problemas:
                print("         %s" % problema)
            fallos += 1
        else:
            extra = "; sin asignaciones: %s" % libres if libres else ""
            print("%-40s ok      %d registros, %d casos, simulacion %s%s"
                  % (nombre, len(logs), casos, identificaciones.pop(), extra))
    faltan = [clave for clave in SIN_ASIGNACIONES if not banco.carpeta_de_referencia(
        banco.MODELOS / (clave[0] + ".txt"), False).is_dir()]
    if faltan:
        print("Faltan los modelos de %s" % faltan)
        fallos += 1
    print()
    if fallos:
        print("PM4Py en rojo: %d problema(s)." % fallos)
        return 1
    print("PM4Py lee los %d registros de %d modelos y los reune." % (ficheros, len(banco.modelos())))
    return 0


if __name__ == "__main__":
    sys.exit(main())
