"""Read the Modeler's line-oriented rules without executing their contents."""

import ast
import math
import re

from simulator.models.baseModels import (
    BPMNProcess, BPMNCollaboration, BPMNParticipant, BPMNLane,
    BPMNSequenceFlow, BPMNDataInputAssociation, BPMNDataOutputAssociation,
    BPMNMessageFlow, BPMNDataObjectReference,
)
from simulator.models.startEventModels import BPMNStartEvent, BPMNMessageStartEvent
from simulator.models.gatewayModels import (
    BPMNExclusiveGateway, BPMNInclusiveGateway, BPMNParallelGateway,
)
from simulator.models.taskModels import (
    BPMNTask, BPMNUserTask, BPMNSendTask, BPMNReceiveTask, BPMNManualTask,
    BPMNBusinessRuleTask, BPMNScriptTask, BPMNServiceTask, BPMNCallActivity,
)
from simulator.models.endEventModels import BPMNEndEvent
from simulator.models.intermediateEventModels import (
    BPMNIntermediateThrowEvent, BPMNMessageIntermediateCatchEvent,
    BPMNMessageIntermediateThrowEvent, BPMNTimerIntermediateCatchEvent,
)
from simulator.validation import BPMN_NAMESPACE, SUPPORTED_TYPES, add_warning, validate_references


TASK_CLASSES = {
    "Task": BPMNTask, "UserTask": BPMNUserTask, "ManualTask": BPMNManualTask,
    "BusinessRuleTask": BPMNBusinessRuleTask, "ScriptTask": BPMNScriptTask,
    "ServiceTask": BPMNServiceTask, "SendTask": BPMNSendTask,
    "ReceiveTask": BPMNReceiveTask, "CallActivity": BPMNCallActivity,
}
GATEWAY_CLASSES = {
    "ExclusiveGateway": BPMNExclusiveGateway,
    "InclusiveGateway": BPMNInclusiveGateway,
    "ParallelGateway": BPMNParallelGateway,
}
FLOW_CLASSES = {
    "SequenceFlow": BPMNSequenceFlow, "MessageFlow": BPMNMessageFlow,
    "DataInputAssociation": BPMNDataInputAssociation,
    "DataOutputAssociation": BPMNDataOutputAssociation,
}
COMMON_FIELDS = {"type", "id_bpmn", "name"}
# Los modos de llegada de los casos de un pool (D13): uno cada frequency, todos
# al abrirse la convocatoria, o cada uno al azar entre 0 y arrivalWindow.
ARRIVAL_MODES = ("staggered", "simultaneous", "uniform")
# Los parametros del pool que el Modeler guarda en el diagrama, con el prefijo
# participantWithoutLane, y el atributo del modelo en el que acaban. Si las
# reglas no los dicen, los aporta el diagrama (5.3).
PARAMETROS_DEL_POOL = {
    "frequency": "frequency", "instances": "instances", "participantMultiplicity": "multiplicity",
    "orchestrationRole": "role", "infiniteResources": "infinite_resources",
    "arrivalMode": "arrival_mode", "arrivalWindow": "arrival_window",
}
# Los espacios de nombres de los descriptores del Modeler que se leen del diagrama.
NS_DEL_POOL = "http://participantWithoutLane"
NS_COLABORACION = "http://collaboration"
NS_PROCESO = "http://model"
TASK_FIELDS = {"userTask", "numberOfExecutions", "minimumTime", "maximumTime", "loopParameter", "multiInstanceType", "subTask"}
FIELDS_BY_TYPE = {
    "Process": {"instances", "frequency", "userWithoutRole", "userWithRole"},
    "Collaboration": {"instances"},
    "Participant": {"frequency", "userWithoutRole", "containedElements",
                    "instances", "participantMultiplicity", "orchestrationRole",
                    "infiniteResources", "arrivalMode", "arrivalWindow"},
    "Lane": {"userWithoutRole", "containedElements", "parentLane"},
    "SequenceFlow": {"superElement", "subElement", "percentageOfBranches"},
    "MessageFlow": {"superElement", "subElement"},
    "DataInputAssociation": {"superElement", "subElement"},
    "DataOutputAssociation": {"superElement", "subElement"},
    # The web exporter includes these descriptive endpoints for data references.
    "DataObjectReference": {"superElement", "subElement"},
    "TimerIntermediateCatchEvent": {"time", "subTask"},
}


def _read_fields(line, line_number):
    if not line.startswith("Element: [") or not line.endswith("]"):
        raise ValueError(f"Línea {line_number}: formato de reglas inválido.")
    body = line[len("Element: ["):-1]
    # Compatibility with the old exporter's representation of no assigned user.
    body = re.sub(r'\buserTask=""""(?=\s*,|$)', 'userTask=""', body)
    parts, start, depth, quote, escaped = [], 0, 0, None, False
    for index, char in enumerate(body):
        if quote:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == quote:
                quote = None
        elif char in "\"'":
            quote = char
        elif char in "[{(":
            depth += 1
        elif char in "]})":
            depth -= 1
        elif char == "," and depth == 0:
            parts.append(body[start:index].strip())
            start = index + 1
        if depth < 0:
            raise ValueError(f"Línea {line_number}: delimitadores inválidos.")
    if quote or depth:
        raise ValueError(f"Línea {line_number}: comillas o delimitadores sin cerrar.")
    parts.append(body[start:].strip())
    fields = {}
    for part in parts:
        key, separator, value = part.partition("=")
        key, value = key.strip(), value.strip()
        if not separator or not key or key in fields:
            raise ValueError(f"Línea {line_number}: campo inválido o duplicado: {key!r}.")
        fields[key] = value
    return fields


def _evaluate(raw_fields, line_number):
    """Turn raw field text into Python literals; the type keeps its raw form."""
    values = {}
    for key, value in raw_fields.items():
        if key == "type":
            values[key] = value
            continue
        try:
            values[key] = ast.literal_eval(value)
        except (ValueError, SyntaxError, RecursionError) as exc:
            raise ValueError(f"Línea {line_number}: valor inválido para {key}.") from exc
    return values


def _required(fields, field, element_id, value_type=None):
    if field not in fields:
        raise ValueError(f"{element_id}: falta el parámetro {field}.")
    value = fields[field]
    if value_type and not isinstance(value, value_type):
        raise ValueError(f"{element_id}: el parámetro {field} tiene un formato inválido.")
    return value


def _strings(value, element_id, field):
    if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
        raise ValueError(f"{element_id}: {field} debe ser una lista de nombres.")
    return list(dict.fromkeys(item.strip() for item in value if item.strip()))


def parse_bpmn_elements(file_content: str, warnings=None):
    if not isinstance(file_content, str) or not file_content.strip():
        raise ValueError("Las reglas de simulación están vacías.")
    entries, seen_ids, data_stores = [], set(), set()
    for number, raw_line in enumerate(file_content.splitlines(), 1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        raw = _read_fields(line, number)
        bpmn_type = _required(raw, "type", f"Línea {number}", str)
        identity = _evaluate({"id_bpmn": raw["id_bpmn"]} if "id_bpmn" in raw else {}, number)
        element_id = _required(identity, "id_bpmn", f"Línea {number}", str)
        if not element_id or element_id in seen_ids:
            raise ValueError(f"Línea {number}: ID vacío o duplicado: {element_id!r}.")
        seen_ids.add(element_id)
        if bpmn_type == "bpmn:DataStoreReference":
            data_stores.add(element_id)
            add_warning(warnings, f"{element_id} (bpmn:DataStoreReference): los almacenes de datos no se simulan; se ignoran junto con sus asociaciones.")
            continue
        entries.append((number, raw, bpmn_type, element_id))

    elements = {}
    for number, raw, bpmn_type, element_id in entries:
        kind = bpmn_type.removeprefix("bpmn:")
        if kind in {"Association", "TextAnnotation", "Group"}:
            continue
        if bpmn_type != f"bpmn:{kind}" or kind not in SUPPORTED_TYPES:
            raise ValueError(f"{element_id}: el elemento {bpmn_type} no está soportado por el simulador.")
        allowed = TASK_FIELDS if kind in TASK_CLASSES else FIELDS_BY_TYPE.get(kind, {"subTask"})
        unknown = set(raw) - COMMON_FIELDS - allowed
        if unknown:
            add_warning(warnings, f"{element_id} ({bpmn_type}): se ignoran parámetros desconocidos: {', '.join(sorted(unknown))}.")
        fields = _evaluate({key: value for key, value in raw.items() if key not in unknown}, number)
        if kind in {"DataInputAssociation", "DataOutputAssociation"} and \
                {fields.get("superElement"), fields.get("subElement")} & data_stores:
            continue
        name = _required(fields, "name", element_id, str)
        args = (name, element_id, bpmn_type)
        get = lambda key, value_type=None: _required(fields, key, element_id, value_type)
        users = lambda: _strings(fields.get("userWithoutRole", []), element_id, "userWithoutRole")
        if kind == "Process":
            element = BPMNProcess(*args, get("instances"), get("frequency"), users(), fields.get("userWithRole", {}))
        elif kind == "Collaboration":
            element = BPMNCollaboration(*args, get("instances"))
        elif kind in {"Participant", "Lane"}:
            contained = _strings(get("containedElements"), element_id, "containedElements")
            parent = fields.get("parentLane") or None
            if parent is not None and not isinstance(parent, str):
                raise ValueError(f"{element_id}: parentLane debe ser el ID de un carril.")
            if kind == "Lane":
                element = BPMNLane(*args, users(), contained, parent)
            else:
                marcador = fields.get("participantMultiplicity")
                if marcador not in (None, "true", "false"):
                    raise ValueError(f"{element_id}: participantMultiplicity debe ser 'true' o 'false'.")
                # El tipo primero: comprobar la pertenencia a un conjunto con un
                # valor no hashable (una lista, un diccionario) revienta con
                # TypeError, que la API devolveria como un 500 sin explicar nada.
                rol = fields.get("orchestrationRole")
                if rol is not None and not isinstance(rol, str):
                    raise ValueError(f"{element_id}: orchestrationRole debe ser texto, no {type(rol).__name__}.")
                # Vacio significa "sin rol"; un `or None` a secas tambien habria
                # aceptado en silencio 0, False y las colecciones vacias.
                rol = (rol or "").strip() or None
                if rol is not None and rol not in {"orchestrator", "orchestrated"}:
                    raise ValueError(f"{element_id}: orchestrationRole debe ser 'orchestrator' u 'orchestrated'.")
                infinitos = fields.get("infiniteResources")
                if infinitos not in (None, "true", "false"):
                    raise ValueError(f"{element_id}: infiniteResources debe ser 'true' o 'false'.")
                # Como llegan sus casos en cada convocatoria (D13). Vacio es la
                # escalonada de siempre; arrivalWindow lo comprueba la validacion.
                llegada = fields.get("arrivalMode")
                if llegada is not None and not isinstance(llegada, str):
                    raise ValueError(f"{element_id}: arrivalMode debe ser texto, no {type(llegada).__name__}.")
                llegada = (llegada or "").strip() or None
                if llegada is not None and llegada not in ARRIVAL_MODES:
                    raise ValueError(f"{element_id}: arrivalMode debe ser 'staggered', 'simultaneous' o 'uniform'.")
                element = BPMNParticipant(*args, get("frequency"), users(), contained,
                                          fields.get("instances"), marcador == "true", rol,
                                          infinitos == "true", llegada, fields.get("arrivalWindow"))
                # Lo que las reglas dicen de verdad: lo que no dicen lo puede
                # aportar el diagrama (aplica_parametros_del_diagrama). Vacio
                # es no decir nada, como en el rol y el modo de llegada.
                element.dichos = frozenset(
                    campo for campo in PARAMETROS_DEL_POOL
                    if fields.get(campo) is not None and not (isinstance(fields[campo], str) and not fields[campo].strip()))
        elif kind in FLOW_CLASSES:
            endpoints = (get("superElement", str), get("subElement", str))
            element = (BPMNSequenceFlow(*args, *endpoints, fields.get("percentageOfBranches"))
                       if kind == "SequenceFlow" else FLOW_CLASSES[kind](*args, *endpoints))
        elif kind == "DataObjectReference":
            element = BPMNDataObjectReference(*args)
        elif kind in TASK_CLASSES:
            assignment = fields.get("userTask", "")
            if not isinstance(assignment, str):
                raise ValueError(f"{element_id}: userTask debe ser texto con usuarios o roles separados por comas.")
            assignment = [item.strip() for item in assignment.split(",") if item.strip()] or None
            loop = fields.get("loopParameter")
            if isinstance(loop, dict) and set(loop) == {"<none>"}:
                loop = None
            multi = fields.get("multiInstanceType")
            if multi not in (None, "true", "false"):
                raise ValueError(f"{element_id}: multiInstanceType debe ser 'true' o 'false'.")
            multi = None if multi is None else multi == "true"
            task_args = (*args, assignment, get("numberOfExecutions"), get("minimumTime"), get("maximumTime"))
            if kind in {"SendTask", "ReceiveTask"}:
                task_args = (*task_args, None)
            element = TASK_CLASSES[kind](*task_args, loop, multi, get("subTask", str))
        elif kind in GATEWAY_CLASSES:
            next_nodes = [item.strip() for item in get("subTask", str).split(",") if item.strip()]
            element = GATEWAY_CLASSES[kind](*args, next_nodes)
        elif kind == "StartEvent":
            element = BPMNStartEvent(*args, get("subTask", str))
        elif kind == "MessageStartEvent":
            element = BPMNMessageStartEvent(*args, None, get("subTask", str))
        elif kind == "EndEvent":
            element = BPMNEndEvent(*args, get("subTask", str) or None)
        elif kind == "IntermediateThrowEvent":
            element = BPMNIntermediateThrowEvent(*args, get("subTask", str))
        elif kind == "TimerIntermediateCatchEvent":
            element = BPMNTimerIntermediateCatchEvent(*args, get("time"), get("subTask", str))
        else:
            event_class = (BPMNMessageIntermediateCatchEvent if kind == "MessageIntermediateCatchEvent"
                           else BPMNMessageIntermediateThrowEvent)
            element = event_class(*args, None, get("subTask", str))
        elements[element_id] = element

    validate_references(elements, warnings)
    roots = [e.id_bpmn for e in elements.values() if e.bpmn_type in {"bpmn:Process", "bpmn:Collaboration"}]
    if len(roots) != 1:
        raise ValueError("Las reglas deben contener exactamente un Process o Collaboration raíz.")
    process = roots[0]
    starts = [e.id_bpmn for e in elements.values() if e.bpmn_type == "bpmn:StartEvent"]
    message_starts = [e.id_bpmn for e in elements.values() if e.bpmn_type == "bpmn:MessageStartEvent"]
    users, contained, start_participants, connections = {}, {}, {}, {}
    participants, lanes, required, generated, data_info = [], [], {}, {}, {}
    for element in elements.values():
        kind = element.bpmn_type.removeprefix("bpmn:")
        if kind == "SequenceFlow":
            connections.setdefault(element.subElement, []).append(element.superElement)
        elif kind == "MessageFlow":
            elements[element.superElement].messageDestiny = element.subElement
            elements[element.subElement].messageOrigin = element.superElement
        elif kind == "DataInputAssociation":
            required.setdefault(element.subElement, []).append(element.superElement)
        elif kind == "DataOutputAssociation":
            generated.setdefault(element.superElement, []).append(element.subElement)
        elif kind == "DataObjectReference":
            data_info[element.id_bpmn] = element.name
        elif kind in {"Participant", "Lane"}:
            users[element.id_bpmn] = element.users
            if kind == "Lane":
                lanes.append(element.id_bpmn)
                contained.update({child: element.id_bpmn for child in element.contained_elements})
            else:
                participants.append([element.frequency, element.id_bpmn])
    for _, participant_id in participants:
        for child in elements[participant_id].contained_elements:
            contained.setdefault(child, participant_id)
            if child in starts or child in message_starts:
                start_participants[child] = participant_id
    produced = {data_id for values in generated.values() for data_id in values}
    default_data = sorted({data_id for values in required.values() for data_id in values} - produced)
    joins = {target: origins for target, origins in connections.items()
             if elements[target].bpmn_type in {"bpmn:ParallelGateway", "bpmn:InclusiveGateway"} and len(origins) > 1}
    elements.update({
        "lanes": lanes, "users": users, "generatedData": generated,
        "requiredData": required, "defaultData": default_data, "dataInfo": data_info,
        "participants": participants, "elementsContainer": contained,
        "startsParticipant": start_participants, "gatewayConnections": joins,
    })
    return elements, process, starts, message_starts


def aplica_marcas_del_diagrama(elements, diagram_root):
    """La marca de multiinstancia de cada tarea, leida del diagrama (3.1).

    El dibujo manda: una tarea marcada en el lienzo con la marca estandar
    -multiInstanceLoopCharacteristics- llega al motor como multiinstancia
    aunque las reglas no digan nada, paralela o secuencial segun su isSequential,
    y sin escribir nada a mano. Si las reglas SI lo dicen y no coincide con el
    dibujo, reglas y diagrama cuentan modelos distintos: se rechaza nombrando la
    tarea y los dos estados, en vez de quedarse con uno de los dos.

    Del dibujo solo sale la marca, no cuantas ejecuciones lanzar: loopCardinality
    y loopDataInputRef los rechaza validate_diagram_xml, y de donde sale la
    cardinalidad lo comprueba validate_simulation.
    """
    prefix = "{" + BPMN_NAMESPACE + "}"
    estado = {None: "no hay multiinstancia", False: "la multiinstancia es paralela",
              True: "la multiinstancia es secuencial"}
    for nodo in diagram_root.iter():
        if not isinstance(nodo.tag, str) or not nodo.tag.startswith(prefix):
            continue
        tarea = elements.get(nodo.get("id"))
        if not hasattr(tarea, "bpmn_type") or tarea.bpmn_type.removeprefix("bpmn:") not in TASK_CLASSES:
            continue
        marca = nodo.find(prefix + "multiInstanceLoopCharacteristics")
        dibujado = None if marca is None else marca.get("isSequential") in {"true", "1"}
        if tarea.multiInstanceType is None:
            tarea.multiInstanceType = dibujado
        elif tarea.multiInstanceType != dibujado:
            raise ValueError(f"{tarea.id_bpmn} ({tarea.bpmn_type}): en el diagrama {estado[dibujado]} "
                             f"y en las reglas {estado[tarea.multiInstanceType]}.")


def _muestra(valor):
    if isinstance(valor, bool):
        return "true" if valor else "false"
    return repr(valor) if isinstance(valor, str) else str(valor)


def _parametro_dibujado(pool_id, campo, texto):
    """Un parametro del pool tal como lo escribe el Modeler en el diagrama, o
    None si esta vacio. Lo que no se puede leer se rechaza nombrando el pool y
    que el valor viene del diagrama, no de las reglas."""
    texto = texto.strip()
    if not texto:
        return None
    etiqueta = f"{pool_id} (bpmn:Participant): en el diagrama {campo}={texto!r}"
    if campo in ("instances", "arrivalWindow"):
        if not (texto.isascii() and texto.isdigit()):
            raise ValueError(f"{etiqueta}, y tiene que ser un entero mayor o igual que 0.")
        return int(texto)
    if campo == "frequency":
        # Un Real del descriptor: lo escribe JavaScript, que usa exponente por
        # debajo de 1e-6 y desde 1e21 (una frecuencia de 0.0000001 es 1e-7).
        if not re.fullmatch(r"\d+(?:\.\d+)?(?:[eE][+-]?\d+)?", texto) or not math.isfinite(float(texto)):
            raise ValueError(f"{etiqueta}, y tiene que ser un número finito mayor o igual que 0.")
        return int(texto) if texto.isdigit() else float(texto)
    if campo == "infiniteResources":
        if texto not in ("true", "false"):
            raise ValueError(f"{etiqueta}, y tiene que ser true o false.")
        return texto == "true"
    if campo == "orchestrationRole":
        if texto not in ("orchestrator", "orchestrated"):
            raise ValueError(f"{etiqueta}, y tiene que ser orchestrator u orchestrated.")
        return texto
    if texto not in ARRIVAL_MODES:
        raise ValueError(f"{etiqueta}, y tiene que ser staggered, simultaneous o uniform.")
    return texto


def aplica_parametros_del_diagrama(elements, diagram_root):
    """Los parametros de cada pool que el Modeler guarda en el diagrama (5.3).

    Se configuran en el panel del pool y van en el .bpmn, con el prefijo
    participantWithoutLane: frequency, instances, orchestrationRole,
    infiniteResources, arrivalMode y arrivalWindow, mas el marcador estandar de
    multiplicidad. Como la marca de multiinstancia (3.1), el dibujo aporta lo
    que las reglas no dicen, y despues se valida igual que si viniera en ellas.
    Si los dos lo dicen y no coincide, reglas y diagrama cuentan modelos
    distintos: se rechaza nombrando el pool, el parametro y los dos valores, en
    vez de quedarse con uno.

    El marcador siempre esta o no esta en el dibujo, asi que solo se aporta
    cuando las reglas no dicen participantMultiplicity; si lo dicen y no
    coincide, lo rechaza validate_diagram_correspondence, como antes.
    """
    bpmn = "{" + BPMN_NAMESPACE + "}"
    for nodo in diagram_root.iter(bpmn + "participant"):
        pool_id = nodo.get("id")
        pool = elements.get(pool_id)
        if not isinstance(pool, BPMNParticipant):
            # Un pool del dibujo que no esta en las reglas lo nombra
            # validate_diagram_correspondence.
            continue
        dibujados = {"participantMultiplicity": nodo.find(bpmn + "participantMultiplicity") is not None}
        for campo in PARAMETROS_DEL_POOL:
            texto = nodo.get("{%s}%s" % (NS_DEL_POOL, campo))
            valor = None if texto is None or campo == "participantMultiplicity" \
                else _parametro_dibujado(pool_id, campo, texto)
            if valor is not None:
                dibujados[campo] = valor
        for campo, valor in dibujados.items():
            atributo = PARAMETROS_DEL_POOL[campo]
            if campo not in pool.dichos:
                setattr(pool, atributo, valor)
            elif campo != "participantMultiplicity" and getattr(pool, atributo) != valor:
                raise ValueError(f"{pool_id} (bpmn:Participant): en el diagrama {campo}={_muestra(valor)} "
                                 f"y en las reglas {_muestra(getattr(pool, atributo))}.")


def semilla_del_diagrama(diagram_root):
    """La semilla guardada en la raiz del diagrama (5.3), como (texto, donde), o
    None si no hay ninguna.

    El Modeler la guarda en la colaboracion, collab:seed, o en el proceso si el
    diagrama es uno solo, model:seed. Vacia es no decir nada. La comprueba y la
    cruza con la de la peticion elige_semilla, en main.py.
    """
    bpmn = "{" + BPMN_NAMESPACE + "}"
    colaboracion = diagram_root.find(bpmn + "collaboration")
    if colaboracion is not None:
        raiz, prefijo, ns = colaboracion, "collab", NS_COLABORACION
    else:
        procesos = diagram_root.findall(bpmn + "process")
        if len(procesos) != 1:
            return None
        raiz, prefijo, ns = procesos[0], "model", NS_PROCESO
    texto = (raiz.get("{%s}seed" % ns) or "").strip()
    if not texto:
        return None
    tipo = "Collaboration" if prefijo == "collab" else "Process"
    return texto, f"{raiz.get('id')} (bpmn:{tipo}, {prefijo}:seed)"
