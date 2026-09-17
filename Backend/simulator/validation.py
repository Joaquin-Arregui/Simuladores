"""The executable BPMN subset and preflight checks for simulation inputs."""

from collections import defaultdict
import math
import re
import xml.etree.ElementTree as ET


TASK_TYPES = frozenset({
    "Task", "UserTask", "ManualTask", "ServiceTask", "ScriptTask",
    "BusinessRuleTask", "SendTask", "ReceiveTask",
})
GATEWAY_TYPES = frozenset({"ExclusiveGateway", "InclusiveGateway", "ParallelGateway"})
START_TYPES = frozenset({"StartEvent", "MessageStartEvent"})
EVENT_TYPES = START_TYPES | {
    "EndEvent", "IntermediateThrowEvent", "MessageIntermediateCatchEvent",
    "MessageIntermediateThrowEvent", "TimerIntermediateCatchEvent",
}
NODE_TYPES = TASK_TYPES | GATEWAY_TYPES | EVENT_TYPES
FLOW_TYPES = frozenset({"SequenceFlow", "MessageFlow", "DataInputAssociation", "DataOutputAssociation"})
SUPPORTED_TYPES = NODE_TYPES | FLOW_TYPES | {
    "Process", "Collaboration", "Participant", "Lane", "DataObjectReference",
}
SEND_TYPES = frozenset({"SendTask", "MessageIntermediateThrowEvent"})
RECEIVE_TYPES = frozenset({"ReceiveTask", "MessageIntermediateCatchEvent", "MessageStartEvent"})
METADATA_KEYS = frozenset({
    "lanes", "users", "generatedData", "requiredData", "defaultData", "dataInfo",
    "participants", "elementsContainer", "startsParticipant", "gatewayConnections",
})


def _kind(element):
    return element.bpmn_type.removeprefix("bpmn:")


def _fail(element, message):
    raise ValueError(f"{element.id_bpmn} ({element.bpmn_type}): {message}")


def _number(element, field, minimum=0, integer=False, maximum=None):
    value = getattr(element, field)
    expected = (int,) if integer else (int, float)
    if type(value) not in expected or (type(value) is float and not math.isfinite(value)) or value < minimum:
        description = "entero" if integer else "número finito"
        _fail(element, f"{field} debe ser un {description} mayor o igual que {minimum}.")
    if maximum is not None and value > maximum:
        _fail(element, f"{field} no puede superar {maximum}.")
    return value


def validate_references(elements):
    """Check references before the parser derives message and container maps."""
    nodes = {key: value for key, value in elements.items() if hasattr(value, "bpmn_type")}
    senders, receivers = set(), set()
    for element_id, element in nodes.items():
        if element_id in METADATA_KEYS:
            _fail(element, "el ID está reservado para metadatos; utiliza otro ID BPMN.")
        if re.search(r"[\s,\x00-\x1f]", element_id):
            _fail(element, "el ID BPMN no puede contener espacios, comas o caracteres de control.")
        kind = _kind(element)
        if kind not in SUPPORTED_TYPES:
            _fail(element, "este tipo de elemento no está soportado.")
        if kind in FLOW_TYPES:
            for field in ("superElement", "subElement"):
                target = getattr(element, field)
                if target not in nodes:
                    _fail(element, f"{field} hace referencia a un elemento inexistente: {target}.")
            source = nodes[element.superElement]
            target = nodes[element.subElement]
            if kind == "SequenceFlow":
                if _kind(source) not in NODE_TYPES or _kind(target) not in NODE_TYPES:
                    _fail(element, "el flujo de secuencia debe conectar dos nodos ejecutables.")
            elif kind == "MessageFlow":
                if _kind(source) not in SEND_TYPES or _kind(target) not in RECEIVE_TYPES:
                    _fail(element, "los mensajes deben conectar SendTask/MessageIntermediateThrowEvent con ReceiveTask/MessageIntermediateCatchEvent/MessageStartEvent.")
                if source.id_bpmn in senders or target.id_bpmn in receivers:
                    _fail(element, "solo se admite un flujo de mensaje por emisor y por receptor.")
                senders.add(source.id_bpmn)
                receivers.add(target.id_bpmn)
            elif kind == "DataInputAssociation":
                if _kind(source) != "DataObjectReference" or _kind(target) not in TASK_TYPES:
                    _fail(element, "la entrada de datos debe conectar DataObjectReference con una tarea.")
            elif _kind(source) not in TASK_TYPES or _kind(target) != "DataObjectReference":
                _fail(element, "la salida de datos debe conectar una tarea con DataObjectReference.")
        elif kind in {"Participant", "Lane"}:
            for child in element.contained_elements:
                if child not in nodes:
                    _fail(element, f"containedElements incluye un elemento inexistente: {child}.")


def _reachable(seeds, adjacency):
    pending, found = list(seeds), set()
    while pending:
        current = pending.pop()
        if current not in found:
            found.add(current)
            pending.extend(adjacency.get(current, []))
    return found


def validate_simulation(elements, process, starts, message_starts):
    """Reject invalid rules before generating or executing Python code."""
    validate_references(elements)
    model = {key: value for key, value in elements.items() if hasattr(value, "bpmn_type")}
    roots = [element for element in model.values() if _kind(element) in {"Process", "Collaboration"}]
    if len(roots) != 1 or roots[0].id_bpmn != process:
        raise ValueError("Las reglas deben contener exactamente un Process o Collaboration raíz.")
    root = roots[0]
    _number(root, "instances", minimum=1, integer=True)
    if not starts and not message_starts:
        _fail(root, "el modelo necesita al menos un evento de inicio.")
    if not starts:
        _fail(root, "se necesita un inicio sin mensaje para activar los emisores; no se admiten mensajes externos.")
    nodes = {key: value for key, value in model.items() if _kind(value) in NODE_TYPES}
    outgoing, incoming = defaultdict(list), defaultdict(list)
    adjacency, reverse = defaultdict(list), defaultdict(list)
    for element in model.values():
        if _kind(element) == "SequenceFlow":
            outgoing[element.superElement].append(element)
            incoming[element.subElement].append(element)
            adjacency[element.superElement].append(element.subElement)
            reverse[element.subElement].append(element.superElement)
            if element.percentageOfBranches is not None:
                _number(element, "percentageOfBranches", maximum=100)

    ends = []
    for element_id, element in nodes.items():
        kind = _kind(element)
        flows = outgoing[element_id]
        targets = [flow.subElement for flow in flows]
        if kind in START_TYPES:
            if incoming[element_id]:
                _fail(element, "un evento de inicio no puede recibir flujos de secuencia.")
        elif not incoming[element_id]:
            _fail(element, "falta un flujo de secuencia de entrada.")
        if kind == "EndEvent":
            ends.append(element_id)
            if flows or element.subTask:
                _fail(element, "un evento de fin no puede tener una salida.")
            continue
        if not flows:
            _fail(element, "falta un flujo de secuencia de salida hacia otro nodo.")
        if kind not in GATEWAY_TYPES and len(flows) != 1:
            _fail(element, "solo se admite una salida; utiliza una compuerta para dividir las ramas.")
        declared = element.subTask if isinstance(element.subTask, list) else [element.subTask]
        if set(declared) != set(targets):
            _fail(element, "subTask no coincide con los destinos de sus flujos de secuencia.")
        if kind in {"ExclusiveGateway", "InclusiveGateway"}:
            assigned = [flow.percentageOfBranches for flow in flows if flow.percentageOfBranches is not None]
            missing = len(flows) - len(assigned)
            total = sum(assigned)
            if (kind == "ExclusiveGateway" or missing) and total > 100 + 1e-8:
                _fail(element, "la suma de porcentajes de las ramas supera el 100 %.")
            if not missing and (total <= 0 or (kind == "ExclusiveGateway" and not math.isclose(total, 100, abs_tol=1e-8))):
                _fail(element, "los porcentajes deben sumar 100 % en una compuerta exclusiva y tener alguna rama positiva en una inclusiva.")
        if kind in SEND_TYPES and not getattr(element, "messageDestiny", None):
            _fail(element, "falta un flujo de mensaje hacia un receptor compatible.")
        if kind in RECEIVE_TYPES and not getattr(element, "messageOrigin", None):
            _fail(element, "falta un flujo de mensaje desde un emisor compatible.")
        if kind == "TimerIntermediateCatchEvent":
            _number(element, "time")

    reachable = _reachable(starts + message_starts, adjacency)
    unreachable = sorted(set(nodes) - reachable)
    if unreachable:
        raise ValueError(f"Hay nodos desconectados de los eventos de inicio: {', '.join(unreachable)}.")
    without_end = sorted(set(nodes) - _reachable(ends, reverse))
    if without_end:
        raise ValueError(f"Estos nodos no tienen ningún camino hacia un evento de fin: {', '.join(without_end)}.")

    participants = [element for element in model.values() if _kind(element) == "Participant"]
    lanes = [element for element in model.values() if _kind(element) == "Lane"]
    if _kind(root) == "Process":
        _number(root, "frequency")
        if participants:
            _fail(root, "los participantes necesitan una raíz Collaboration.")
        for lane in lanes:
            if lane.users:
                _fail(lane, "en un Process simple los recursos se asignan en el proceso y en sus tareas; usa una Collaboration para asignar usuarios por carril.")
        if not isinstance(root.userWithRole, dict):
            _fail(root, "userWithRole debe ser un diccionario de roles y listas de usuarios.")
        for role, users in root.userWithRole.items():
            if not isinstance(role, str) or not role.strip() or not isinstance(users, list) or any(not isinstance(user, str) or not user.strip() for user in users):
                _fail(root, "cada rol debe tener un nombre y una lista válida de usuarios.")
        pool = set(root.userWithoutRole) | {user for users in root.userWithRole.values() for user in users}
    else:
        if not participants:
            _fail(root, "una colaboración necesita participantes con procesos visibles.")
        ownership, lane_ownership = {}, {}
        for participant in participants:
            _number(participant, "frequency")
            contained_nodes = set(participant.contained_elements) & set(nodes)
            if not contained_nodes or not (contained_nodes & set(starts + message_starts)):
                _fail(participant, "necesita un proceso visible con al menos un evento de inicio.")
            for child in contained_nodes:
                if child in ownership:
                    _fail(participant, f"el nodo {child} pertenece a varios participantes.")
                ownership[child] = participant.id_bpmn
        for lane in lanes:
            owners = set()
            for child in lane.contained_elements:
                if child not in nodes:
                    _fail(lane, f"el carril contiene un elemento que no es un nodo: {child}.")
                if child in lane_ownership:
                    _fail(lane, f"el nodo {child} pertenece a varios carriles.")
                lane_ownership[child] = lane.id_bpmn
                owners.add(ownership.get(child))
            if len(owners) > 1:
                _fail(lane, "un carril no puede contener nodos de varios participantes.")
        for node in nodes:
            if node not in ownership:
                _fail(nodes[node], "el nodo no pertenece a ningún participante.")
        for source, targets in adjacency.items():
            for target in targets:
                if ownership[source] != ownership[target]:
                    _fail(nodes[source], f"el flujo de secuencia hacia {target} cruza participantes; utiliza mensajes.")
        pool = {user for element in participants + lanes for user in element.users}

    for element in nodes.values():
        if _kind(element) not in TASK_TYPES:
            continue
        _number(element, "numberOfExecutions", minimum=1, integer=True)
        minimum = _number(element, "minimumTime")
        maximum = _number(element, "maximumTime")
        if minimum > maximum:
            _fail(element, "minimumTime no puede ser mayor que maximumTime.")
        loop = element.loopParameter
        if loop is not None:
            if not isinstance(loop, dict) or len(loop) != 1 or next(iter(loop)) not in {"Time", "Units", "Percentage"}:
                _fail(element, "loopParameter debe contener una opción: Time, Units o Percentage.")
            key, value = next(iter(loop.items()))
            if type(value) not in (int, float) or (type(value) is float and not math.isfinite(value)) or value <= 0:
                _fail(element, "el parámetro del bucle debe ser positivo para que pueda terminar.")
            if key == "Units" and type(value) is not int:
                _fail(element, "Units debe ser un entero positivo.")
            if key == "Percentage" and value > 100:
                _fail(element, "Percentage debe estar entre 0 (excluido) y 100.")
            if key == "Time" and minimum < 1:
                _fail(element, "un bucle por tiempo necesita minimumTime de al menos 1 para avanzar el reloj.")
            if element.multiInstanceType is not None:
                _fail(element, "configura un bucle o multiinstancia, pero no ambos a la vez.")
        assignment = element.userTask
        if _kind(root) == "Process":
            eligible = set(pool) if assignment is None else set()
            for item in assignment or []:
                if item in root.userWithRole:
                    eligible.update(root.userWithRole[item])
                elif item in pool:
                    eligible.add(item)
                else:
                    _fail(element, f"el usuario o rol {item!r} no está definido en el proceso.")
        else:
            container = elements["elementsContainer"].get(element.id_bpmn)
            available = set(elements["users"].get(container, []))
            eligible = available if assignment is None else available & set(assignment)
            unknown = set(assignment or []) - available
            if unknown:
                _fail(element, f"usuarios ajenos a su carril o participante: {', '.join(sorted(unknown))}.")
        if not eligible:
            _fail(element, "no tiene usuarios elegibles; asigna usuarios al proceso, participante o carril.")


BPMN_NAMESPACE = "http://www.omg.org/spec/BPMN/20100524/MODEL"
XML_NODE_TYPES = {
    "task", "userTask", "manualTask", "serviceTask", "scriptTask", "businessRuleTask",
    "sendTask", "receiveTask", "startEvent", "endEvent", "intermediateCatchEvent",
    "intermediateThrowEvent", "exclusiveGateway", "inclusiveGateway", "parallelGateway",
}
XML_ALLOWED = XML_NODE_TYPES | {
    "definitions", "documentation", "extensionElements", "import", "process", "collaboration",
    "participant", "laneSet", "lane", "flowNodeRef", "sequenceFlow", "messageFlow",
    "incoming", "outgoing", "message", "messageEventDefinition", "timerEventDefinition",
    "timeDuration", "dataObject", "dataObjectReference", "dataInput", "dataOutput",
    "dataInputAssociation", "dataOutputAssociation", "sourceRef", "targetRef", "ioSpecification",
    "inputSet", "outputSet", "dataInputRefs", "dataOutputRefs", "property", "itemDefinition",
    "textAnnotation", "text", "association", "group", "category", "categoryValue",
    "standardLoopCharacteristics", "multiInstanceLoopCharacteristics",
}


def validate_diagram_xml(xml):
    """Inspect semantics the text exporter could otherwise silently discard."""
    if not isinstance(xml, str) or not xml.strip():
        raise ValueError("diagramXML debe contener un diagrama BPMN válido.")
    if re.search(r"<!\s*(?:DOCTYPE|ENTITY)\b", xml, re.IGNORECASE):
        raise ValueError("El XML BPMN no puede contener declaraciones DOCTYPE o ENTITY.")
    try:
        root = ET.fromstring(xml)
    except ET.ParseError as exc:
        raise ValueError(f"El XML BPMN no es válido: {exc}.") from exc
    prefix = "{" + BPMN_NAMESPACE + "}"
    if root.tag != prefix + "definitions":
        raise ValueError("El XML debe tener una raíz bpmn:definitions con el espacio de nombres BPMN 2.0.")
    known_ids = set()

    def check(element, owner):
        if not isinstance(element.tag, str) or not element.tag.startswith(prefix):
            return
        kind = element.tag[len(prefix):]
        element_id = element.get("id")
        if element_id:
            if element_id in known_ids:
                raise ValueError(f"El XML contiene un ID BPMN duplicado: {element_id}.")
            known_ids.add(element_id)
        owner = element_id or owner
        label = f"{owner or 'Diagrama'} (bpmn:{kind})"
        if kind not in XML_ALLOWED:
            raise ValueError(f"{label}: este elemento o expresión BPMN no está soportado por el simulador.")
        if kind == "extensionElements":
            return
        if kind in XML_NODE_TYPES:
            if element.get("isForCompensation") in {"true", "1"}:
                raise ValueError(f"{label}: las tareas de compensación no están soportadas.")
            if element.get("default"):
                raise ValueError(f"{label}: las salidas por defecto no se evalúan; configura porcentajes de ramas.")
            if element.get("instantiate") in {"true", "1"}:
                raise ValueError(f"{label}: no se admite crear instancias desde una tarea de recepción; utiliza un inicio por mensaje.")
            definitions = [child.tag[len(prefix):] for child in element if child.tag.startswith(prefix) and child.tag.endswith("EventDefinition")]
            permitted = {
                "startEvent": [[], ["messageEventDefinition"]],
                "endEvent": [[]],
                "intermediateCatchEvent": [["messageEventDefinition"], ["timerEventDefinition"]],
                "intermediateThrowEvent": [[], ["messageEventDefinition"]],
            }
            if kind in permitted and definitions not in permitted[kind]:
                description = ", ".join(definitions) or "evento sin definición"
                raise ValueError(f"{label}: no se admite {description} en este evento.")
        if kind == "timerEventDefinition":
            durations = [child for child in element if child.tag == prefix + "timeDuration"]
            if len(durations) != 1 or not re.fullmatch(r"\d+(?:\.\d+)?", (durations[0].text or "").strip()):
                raise ValueError(f"{label}: usa una duración numérica no negativa; no se admiten fechas, ciclos ni duraciones ISO 8601.")
        if kind == "dataObject" and element.get("isCollection") in {"true", "1"}:
            raise ValueError(f"{label}: no se admiten colecciones de objetos de datos.")
        if kind == "standardLoopCharacteristics":
            if element.get("testBefore") in {"true", "1"} or element.get("loopMaximum"):
                raise ValueError(f"{label}: testBefore y loopMaximum no se evalúan; configura los parámetros de bucle del simulador.")
        if kind == "multiInstanceLoopCharacteristics" and element.get("behavior", "All") != "All":
            raise ValueError(f"{label}: solo se admite multiinstancia con espera de todas las ejecuciones (All).")
        for child in element:
            check(child, owner)

    try:
        check(root, root.get("id"))
    except RecursionError as exc:
        raise ValueError("El XML BPMN contiene demasiados niveles anidados.") from exc
    processes = [element for element in root if element.tag == prefix + "process"]
    collaborations = [element for element in root if element.tag == prefix + "collaboration"]
    if len(collaborations) > 1 or (not collaborations and len(processes) != 1):
        raise ValueError("El XML debe contener un proceso o una colaboración raíz para simular.")
    if collaborations:
        process_ids = {element.get("id") for element in processes}
        referenced = set()
        for participant in collaborations[0]:
            if participant.tag == prefix + "participant":
                reference = participant.get("processRef")
                if not reference or reference not in process_ids:
                    raise ValueError(f"{participant.get('id', 'Participant')}: los participantes deben tener un proceso visible; no se admiten pools vacíos.")
                if reference in referenced:
                    raise ValueError(f"{participant.get('id', 'Participant')}: varios participantes no pueden compartir el mismo proceso.")
                referenced.add(reference)
        if process_ids != referenced:
            raise ValueError("El XML contiene procesos que no pertenecen a la colaboración visible.")
