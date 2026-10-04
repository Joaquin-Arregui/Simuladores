#!/usr/bin/env python3
"""Genera el diagrama BPMN 2.0 de un modelo de referencia a partir de sus reglas.

    python3 pruebas/bpmn_desde_reglas.py pruebas/modelos/10-convocatoria-1-a-n.txt ...

Escribe pruebas/integracion/<modelo>.bpmn. Se usa una vez, al crear un diagrama
de integracion o al cambiar su modelo, y el resultado se congela como fichero:
el banco de integracion lee el .bpmn, no lo regenera, para que un fallo de este
generador no pueda taparse con uno igual en la validacion.

Por que generado y no dibujado: el Modeler aun no sabe escribir los atributos
del hito 2 (instances, orchestrationRole, infiniteResources), que son el hito 5.
Lo que si escribe el dibujo es lo que el Modeler escribiria hoy: la estructura
BPMN, los atributos de sus descriptores y los dos marcadores estandar,
participantMultiplicity y multiInstanceLoopCharacteristics. La comprobacion
independiente de que el XML es BPMN valido la hace valida_bpmn.mjs con
bpmn-moddle, la misma libreria con la que bpmn-js lo abre.
"""
import sys
from collections import defaultdict
from pathlib import Path
from xml.etree import ElementTree as ET

import banco  # noqa: F401  fija la fecha de inicio y el sys.path
from simulator.parser import parse_bpmn_elements
from simulator.validation import NODE_TYPES, TASK_TYPES, lane_chain

NS = {
    "bpmn": "http://www.omg.org/spec/BPMN/20100524/MODEL",
    "bpmndi": "http://www.omg.org/spec/BPMN/20100524/DI",
    "dc": "http://www.omg.org/spec/DD/20100524/DC",
    "di": "http://www.omg.org/spec/DD/20100524/DI",
    # Los descriptores del Modeler (Modeler/descriptors/*.json).
    "user": "http://user",
    "sequenceFlow": "http://sequenceFlow",
    "model": "http://model",
    "collab": "http://collaboration",
    "lane": "http://lane",
    "participantWithoutLane": "http://participantWithoutLane",
}
for _prefijo, _uri in NS.items():
    ET.register_namespace(_prefijo, _uri)

# Lo inverso de _xml_kind en validation.py: el tipo de las reglas es el de
# bpmn-js, y en los eventos lleva dentro su definicion.
EVENTOS = {
    "MessageStartEvent": ("startEvent", "messageEventDefinition"),
    "MessageIntermediateCatchEvent": ("intermediateCatchEvent", "messageEventDefinition"),
    "TimerIntermediateCatchEvent": ("intermediateCatchEvent", "timerEventDefinition"),
    "MessageIntermediateThrowEvent": ("intermediateThrowEvent", "messageEventDefinition"),
}

ANCHO_TAREA, ALTO_TAREA = 100, 80
LADO_EVENTO, LADO_GATEWAY = 36, 50
PASO_X, PASO_Y = 170, 130
CABECERA = 30


def q(prefijo, nombre):
    return f"{{{NS[prefijo]}}}{nombre}"


def kind(element):
    return element.bpmn_type.removeprefix("bpmn:")


def etiqueta(element):
    k = kind(element)
    if k in EVENTOS:
        return EVENTOS[k]
    return k[:1].lower() + k[1:], None


def tamano(element):
    k = kind(element)
    if k in TASK_TYPES:
        return ANCHO_TAREA, ALTO_TAREA
    if k.endswith("Gateway"):
        return LADO_GATEWAY, LADO_GATEWAY
    return LADO_EVENTO, LADO_EVENTO


def usuarios(padre, prefijo, propiedad, valores):
    """Un elemento hijo por usuario, que es como los guarda el Modeler.

    En los descriptores UserTask y userWithoutRole son listas (isMany) que no
    son atributos: escribirlas como un atributo con comas parece funcionar, pero
    al abrir el diagrama bpmn-moddle lee una cadena donde espera una lista, y al
    guardarlo la recorre letra a letra: Ana se convierte en A, n y a.
    """
    for valor in valores:
        ET.SubElement(padre, q(prefijo, propiedad)).text = str(valor)


def capas(nodos, flujos, inicios):
    """Capa de cada nodo: el camino mas largo desde un inicio, sin contar los
    flujos que cierran un ciclo, para que el dibujo vaya de izquierda a derecha."""
    salientes = defaultdict(list)
    for origen, destino in flujos:
        salientes[origen].append(destino)
    atras, estado = set(), {}

    def recorre(nodo):
        estado[nodo] = 1
        for siguiente in salientes[nodo]:
            if estado.get(siguiente) == 1:
                atras.add((nodo, siguiente))
            elif siguiente not in estado:
                recorre(siguiente)
        estado[nodo] = 2

    for nodo in inicios + nodos:
        if nodo not in estado:
            recorre(nodo)
    capa = {nodo: 0 for nodo in nodos}
    cambiado = True
    while cambiado:
        cambiado = False
        for origen, destino in flujos:
            if (origen, destino) not in atras and capa[destino] < capa[origen] + 1:
                capa[destino] = capa[origen] + 1
                cambiado = True
    return capa


class Lienzo:
    """Las cajas del DI: se calculan aqui y se escriben al final."""

    def __init__(self):
        self.cajas = {}       # id -> (x, y, ancho, alto)
        self.horizontales = set()

    def centro(self, element_id):
        x, y, w, h = self.cajas[element_id]
        return x + w / 2, y + h / 2


def dibuja_pool(elements, nodos, flujos, carriles, x0, y0, lienzo, profundidad_max):
    """Coloca los nodos de un pool (o del proceso raiz) en bandas por carril y
    columnas por capa. Devuelve (ancho, alto) del area usada."""
    inicios = [n for n in nodos if kind(elements[n]) in ("StartEvent", "MessageStartEvent")]
    capa = capas(nodos, flujos, inicios)
    hijos = defaultdict(list)
    for carril in carriles:
        hijos[elements[carril].parent_lane if elements[carril].parent_lane in carriles else None].append(carril)
    mas_dentro = {}
    for nodo in nodos:
        cadena = [lane for lane in (lane_chain(elements, nodo) or []) if lane.id_bpmn in carriles]
        mas_dentro[nodo] = cadena[0].id_bpmn if cadena else None

    # Bandas: en profundidad, la banda propia de un carril antes que las de sus hijos.
    bandas, profundidad = [], {}

    def recorre(carril, nivel):
        profundidad[carril] = nivel
        propios = [n for n in nodos if mas_dentro[n] == carril]
        if propios or not hijos[carril]:
            bandas.append(carril)
        for hijo in hijos[carril]:
            recorre(hijo, nivel + 1)

    if carriles:
        for raiz in hijos[None]:
            recorre(raiz, 0)
    else:
        bandas.append(None)

    x_nodos = x0 + CABECERA * (profundidad_max + 1) + 50
    alto_banda, y = {}, y0
    filas_usadas = defaultdict(int)
    for banda in bandas:
        propios = [n for n in nodos if mas_dentro[n] == banda]
        por_capa = defaultdict(list)
        for nodo in propios:
            por_capa[capa[nodo]].append(nodo)
        filas = max((len(v) for v in por_capa.values()), default=1)
        alto_banda[banda] = max(150, filas * PASO_Y + 20)
        for c, grupo in por_capa.items():
            for fila, nodo in enumerate(grupo):
                w, h = tamano(elements[nodo])
                cx = x_nodos + c * PASO_X + ANCHO_TAREA / 2
                cy = y + 20 + fila * PASO_Y + ALTO_TAREA / 2
                lienzo.cajas[nodo] = (round(cx - w / 2), round(cy - h / 2), w, h)
                filas_usadas[banda] += 1
        y += alto_banda[banda]
    ancho = (x_nodos - x0) + (max(capa.values(), default=0) + 1) * PASO_X + 40
    alto = y - y0

    # Las cajas de los carriles: su banda y las de todos sus descendientes.
    def caja_carril(carril):
        propias = [b for b in bandas if b == carril]
        y_ini = None
        y_cursor = y0
        for banda in bandas:
            if banda == carril or _desciende(banda, carril):
                y_ini = y_cursor if y_ini is None else y_ini
                y_fin = y_cursor + alto_banda[banda]
            y_cursor += alto_banda[banda]
        x = x0 + CABECERA * (profundidad[carril] + 1)
        lienzo.cajas[carril] = (x, y_ini, ancho - (x - x0), y_fin - y_ini)
        lienzo.horizontales.add(carril)
        del propias

    def _desciende(banda, carril):
        actual = banda
        while actual is not None:
            if actual == carril:
                return True
            actual = elements[actual].parent_lane if elements[actual].parent_lane in carriles else None
        return False

    for carril in carriles:
        caja_carril(carril)
    return ancho, alto


def genera(ruta_reglas):
    texto = Path(ruta_reglas).read_text(encoding="utf-8")
    elements, raiz_id, _, _ = parse_bpmn_elements(texto, [])
    raiz = elements[raiz_id]
    es_colaboracion = kind(raiz) == "Collaboration"
    modelo = {k: v for k, v in elements.items() if hasattr(v, "bpmn_type")}
    nodos_todos = [k for k, v in modelo.items() if kind(v) in NODE_TYPES]
    secuencia = [v for v in modelo.values() if kind(v) == "SequenceFlow"]
    mensajes = [v for v in modelo.values() if kind(v) == "MessageFlow"]
    carriles_todos = [k for k, v in modelo.items() if kind(v) == "Lane"]

    definiciones = ET.Element(q("bpmn", "definitions"), {
        "id": f"Definitions_{Path(ruta_reglas).stem.replace('-', '_')}",
        "targetNamespace": "http://bpmn.io/schema/bpmn",
        "exporter": "my-bpmn-exporter", "exporterVersion": "1.0.0"})

    # Que nodos van en cada proceso.
    if es_colaboracion:
        participantes = [k for k, v in modelo.items() if kind(v) == "Participant"]
        nodos_de = {p: [n for n in nodos_todos if n in elements[p].contained_elements] for p in participantes}
        procesos = {p: f"Process_{p}" for p in participantes if nodos_de[p]}
    else:
        if carriles_todos:
            raise SystemExit("Un Process con carriles no esta soportado por este generador.")
        participantes, nodos_de, procesos = [], {raiz_id: nodos_todos}, {raiz_id: raiz_id}

    entrantes, salientes = defaultdict(list), defaultdict(list)
    for flujo in secuencia:
        salientes[flujo.superElement].append(flujo.id_bpmn)
        entrantes[flujo.subElement].append(flujo.id_bpmn)

    if es_colaboracion:
        colaboracion = ET.SubElement(definiciones, q("bpmn", "collaboration"), {"id": raiz_id})
        if raiz.instances is not None:
            colaboracion.set(q("collab", "instance"), str(raiz.instances))
        for p in participantes:
            part = elements[p]
            atributos = {"id": p, "name": part.name or ""}
            if p in procesos:
                atributos["processRef"] = procesos[p]
            if part.frequency is not None:
                atributos[q("participantWithoutLane", "frequency")] = str(part.frequency)
            nodo_part = ET.SubElement(colaboracion, q("bpmn", "participant"), atributos)
            usuarios(nodo_part, "participantWithoutLane", "userWithoutRole", part.users)
            if part.multiplicity:
                ET.SubElement(nodo_part, q("bpmn", "participantMultiplicity"))
        for mensaje in mensajes:
            ET.SubElement(colaboracion, q("bpmn", "messageFlow"), {
                "id": mensaje.id_bpmn, "name": mensaje.name or "",
                "sourceRef": mensaje.superElement, "targetRef": mensaje.subElement})

    for dueno, proceso_id in procesos.items():
        atributos = {"id": proceso_id, "isExecutable": "false"}
        if not es_colaboracion:
            atributos["name"] = raiz.name or ""
            atributos[q("model", "instance")] = str(raiz.instances)
            atributos[q("model", "frequency")] = str(raiz.frequency)
        proceso = ET.SubElement(definiciones, q("bpmn", "process"), atributos)
        if not es_colaboracion:
            usuarios(proceso, "model", "userWithoutRole", raiz.userWithoutRole)
            for rol, miembros in raiz.userWithRole.items():
                par = ET.SubElement(proceso, q("model", "keyValuePair"))
                ET.SubElement(par, q("model", "key")).text = rol
                ET.SubElement(par, q("model", "value")).text = ",".join(miembros)
        nodos = nodos_de[dueno]
        carriles = [c for c in carriles_todos if set(elements[c].contained_elements) & set(nodos)]
        if carriles:
            def escribe_carriles(padre, nivel_carriles):
                conjunto = ET.SubElement(padre, q("bpmn", "laneSet" if padre is proceso else "childLaneSet"),
                                         {"id": f"LaneSet_{nivel_carriles[0]}"})
                for carril in nivel_carriles:
                    lane = elements[carril]
                    nodo_lane = ET.SubElement(conjunto, q("bpmn", "lane"), {"id": carril, "name": lane.name or ""})
                    usuarios(nodo_lane, "lane", "userWithoutRole", lane.users)
                    for n in lane.contained_elements:
                        ET.SubElement(nodo_lane, q("bpmn", "flowNodeRef")).text = n
                    hijos = [c for c in carriles if elements[c].parent_lane == carril]
                    if hijos:
                        escribe_carriles(nodo_lane, hijos)
            escribe_carriles(proceso, [c for c in carriles if elements[c].parent_lane not in carriles])
        for n in nodos:
            element = elements[n]
            tag, definicion = etiqueta(element)
            nodo = ET.SubElement(proceso, q("bpmn", tag), {"id": n, "name": element.name or ""})
            k = kind(element)
            if k in TASK_TYPES:
                nodo.set(q("user", "NumberOfExecutions"), str(element.numberOfExecutions))
                nodo.set(q("user", "minimumTime"), str(element.minimumTime))
                nodo.set(q("user", "maximumTime"), str(element.maximumTime))
                usuarios(nodo, "user", "UserTask", element.userTask or [])
            for flujo in entrantes[n]:
                ET.SubElement(nodo, q("bpmn", "incoming")).text = flujo
            for flujo in salientes[n]:
                ET.SubElement(nodo, q("bpmn", "outgoing")).text = flujo
            if k in TASK_TYPES and element.multiInstanceType is not None:
                marca = ET.SubElement(nodo, q("bpmn", "multiInstanceLoopCharacteristics"))
                if element.multiInstanceType:
                    marca.set("isSequential", "true")
            if k in TASK_TYPES and element.loopParameter is not None:
                raise SystemExit(f"{n}: loopParameter no esta soportado por este generador.")
            if definicion == "timerEventDefinition":
                timer = ET.SubElement(nodo, q("bpmn", definicion), {"id": f"TimerEventDefinition_{n}"})
                ET.SubElement(timer, q("bpmn", "timeDuration")).text = str(element.time)
            elif definicion:
                ET.SubElement(nodo, q("bpmn", definicion), {"id": f"MessageEventDefinition_{n}"})
        for flujo in secuencia:
            if flujo.superElement in nodos:
                atributos = {"id": flujo.id_bpmn, "sourceRef": flujo.superElement, "targetRef": flujo.subElement}
                if flujo.name:
                    atributos["name"] = flujo.name
                if flujo.percentageOfBranches is not None:
                    atributos[q("sequenceFlow", "percentageOfBranches")] = str(flujo.percentageOfBranches)
                ET.SubElement(proceso, q("bpmn", "sequenceFlow"), atributos)

    # --- DI: pools apilados, carriles en bandas, nodos por capas ----------
    lienzo = Lienzo()
    profundidad_max = 0
    for c in carriles_todos:
        d, actual = 0, elements[c].parent_lane
        while actual in carriles_todos:
            d, actual = d + 1, elements[actual].parent_lane
        profundidad_max = max(profundidad_max, d + 1)
    y, ancho_max, alturas = 80, 0, {}
    duenos = participantes if es_colaboracion else [raiz_id]
    for dueno in duenos:
        nodos = nodos_de.get(dueno, [])
        flujos = [(f.superElement, f.subElement) for f in secuencia if f.superElement in nodos]
        carriles = [c for c in carriles_todos if set(elements[c].contained_elements) & set(nodos)]
        if nodos:
            ancho, alto = dibuja_pool(elements, nodos, flujos, carriles, 160, y, lienzo,
                                      profundidad_max if carriles else 0)
        else:
            ancho, alto = 600, 100
        alturas[dueno] = (y, alto)
        ancho_max = max(ancho_max, ancho)
        y += alto + 60
    if es_colaboracion:
        for dueno in duenos:
            y0, alto = alturas[dueno]
            lienzo.cajas[dueno] = (160, y0, ancho_max, alto)
            lienzo.horizontales.add(dueno)
        for c in carriles_todos:
            x, yc, w, h = lienzo.cajas[c]
            lienzo.cajas[c] = (x, yc, ancho_max - (x - 160), h)

    diagrama = ET.SubElement(definiciones, q("bpmndi", "BPMNDiagram"), {"id": "BPMNDiagram_1"})
    plano = ET.SubElement(diagrama, q("bpmndi", "BPMNPlane"), {"id": "BPMNPlane_1", "bpmnElement": raiz_id})
    orden = (duenos if es_colaboracion else []) + carriles_todos + nodos_todos
    for element_id in orden:
        x, yc, w, h = lienzo.cajas[element_id]
        atributos = {"id": f"{element_id}_di", "bpmnElement": element_id}
        if element_id in lienzo.horizontales:
            atributos["isHorizontal"] = "true"
        forma = ET.SubElement(plano, q("bpmndi", "BPMNShape"), atributos)
        ET.SubElement(forma, q("dc", "Bounds"), {"x": str(x), "y": str(yc), "width": str(w), "height": str(h)})
    for flujo in secuencia + mensajes:
        borde = ET.SubElement(plano, q("bpmndi", "BPMNEdge"), {"id": f"{flujo.id_bpmn}_di", "bpmnElement": flujo.id_bpmn})
        for extremo in (flujo.superElement, flujo.subElement):
            cx, cy = lienzo.centro(extremo)
            ET.SubElement(borde, q("di", "waypoint"), {"x": str(round(cx)), "y": str(round(cy))})

    ET.indent(definiciones, space="  ")
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(definiciones, encoding="unicode") + "\n"


def main(rutas):
    destino = Path(__file__).resolve().parent / "integracion"
    destino.mkdir(exist_ok=True)
    for ruta in rutas:
        salida = destino / (Path(ruta).stem + ".bpmn")
        salida.write_text(genera(ruta), encoding="utf-8", newline="\n")
        print(f"{salida.relative_to(destino.parent.parent)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
