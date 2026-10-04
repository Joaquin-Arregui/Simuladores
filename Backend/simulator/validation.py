"""The executable BPMN subset and preflight checks for simulation inputs."""

from collections import Counter, defaultdict, deque
import itertools
import math
import re
import xml.etree.ElementTree as ET


TASK_TYPES = frozenset({
    "Task", "UserTask", "ManualTask", "ServiceTask", "ScriptTask",
    "BusinessRuleTask", "SendTask", "ReceiveTask", "CallActivity",
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
# Cuanto trabajo se gasta, como mucho, en decidir si una union inclusiva
# garantiza el lote de una evaluacion, contado en tokens tocados
# (_juega_el_caso). Acota tiempo y memoria antes de que empiece el plazo de la
# simulacion, que solo cubre la ejecucion.
PASOS_MAXIMOS = 500_000
# Lo que cuesta guardar un estado ademas de sus tokens: la entrada del
# diccionario y la tupla vacia ocupan lo que unos ocho tokens.
COSTE_DE_GUARDAR = 8
METADATA_KEYS = frozenset({
    "lanes", "users", "generatedData", "requiredData", "defaultData", "dataInfo",
    "participants", "elementsContainer", "startsParticipant", "gatewayConnections",
})


def add_warning(warnings, message):
    """Collect a non-blocking notice once, keeping the order in which it appears."""
    if warnings is not None and message not in warnings:
        warnings.append(message)


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


def lane_chain(elements, node_id):
    """Lanes that contain a node, innermost first.

    bpmn-js lists a node in its lane and in every lane that contains that lane.
    The exported parentLane gives the hierarchy; older rules fall back to the
    size of each lane. Returns None when the lanes are not nested.
    """
    containing = [elements[lane_id] for lane_id in elements.get("lanes", [])
                  if node_id in elements[lane_id].contained_elements]
    if len(containing) <= 1:
        return containing
    ids = {lane.id_bpmn for lane in containing}
    parents = {lane.parent_lane for lane in containing if lane.parent_lane in ids}
    leaves = [lane for lane in containing if lane.id_bpmn not in parents]
    if parents and len(leaves) == 1:
        chain, current = [], leaves[0]
        while current is not None and current not in chain:
            chain.append(current)
            current = elements[current.parent_lane] if current.parent_lane in ids else None
        if len(chain) == len(containing):
            return chain
    ordered = sorted(containing, key=lambda lane: len(set(lane.contained_elements)))
    for inner, outer in zip(ordered, ordered[1:]):
        if not set(inner.contained_elements) <= set(outer.contained_elements):
            return None
    return ordered


def task_base_users(elements, node_id, is_process):
    """Users a node may use before applying its own assignment.

    The innermost lane with users wins, so a nested lane without users inherits
    from the lane that contains it. In a Process, None means that the process
    users apply. In a collaboration, a node outside lanes uses its participant.
    """
    chain = lane_chain(elements, node_id) or []
    for lane in chain:
        if lane.users:
            return list(lane.users)
    if is_process:
        return None
    if chain:
        return []
    for _, participant_id in elements.get("participants", []):
        participant = elements[participant_id]
        if node_id in participant.contained_elements:
            return list(participant.users)
    return []


def resolve_reply_contexts(elements, element_participant):
    """Para cada envio, la recepcion a la que responde.

    El remitente de un sobre se anota en la recepcion que lo recoge, y la
    respuesta tiene que leer la anotacion de SU recepcion: dos recepciones del
    mismo caso numeran sus ejecuciones desde 1, asi que compartir contexto hace
    que una sobrescriba el de la otra y que una respuesta vuelva a quien no
    escribio. Ese cruce no bloquea nada, solo deja el registro mal.

    Que recepcion le toca a un envio no lo dice BPMN, y aqui no se inventa
    vocabulario: se deduce del dibujo. Es la recepcion mas cercana aguas arriba
    por flujos de secuencia cuyo mensaje venga del mismo pool al que este envio
    escribe. Si no hay ninguna, el envio abre la conversacion y su destino sale
    de las cardinalidades.

    Se recorre CADA camino hasta su primera recepcion, y se juntan todas las que
    aparezcan: cortar en la primera distancia con candidatos dejaba fuera la
    recepcion de otra rama solo por tener un paso intermedio mas, y el motor
    elegia en silencio. Si sale mas de una, el modelo es ambiguo y se rechaza.
    """
    nodes = {key: value for key, value in elements.items() if hasattr(value, "bpmn_type")}
    incoming = defaultdict(list)
    for element in nodes.values():
        if _kind(element) == "SequenceFlow":
            incoming[element.subElement].append(element.superElement)
    contextos = {}
    for element_id, element in nodes.items():
        if _kind(element) not in SEND_TYPES:
            continue
        destino = getattr(element, "messageDestiny", None)
        if destino is None:
            continue
        pool = element_participant.get(destino)
        frontera, vistos, candidatos = [element_id], {element_id}, []
        while frontera:
            siguiente = []
            for node in frontera:
                for previo in incoming[node]:
                    if previo in vistos:
                        continue
                    vistos.add(previo)
                    origen = getattr(nodes[previo], "messageOrigin", None)
                    if (_kind(nodes[previo]) in RECEIVE_TYPES and origen is not None
                            and element_participant.get(origen) == pool):
                        # Camino agotado: lo que haya mas arriba ya responde a esta.
                        candidatos.append(previo)
                    else:
                        siguiente.append(previo)
            frontera = siguiente
        if len(candidatos) > 1:
            _fail(element, "responde a varias recepciones a la vez (%s); el motor no puede "
                           "saber a cual, separa las conversaciones en ramas distintas."
                  % ", ".join(sorted(candidatos)))
        if candidatos:
            contextos[element_id] = candidatos[0]
    return contextos


def validate_references(elements, warnings=None):
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
                if _kind(source) == "Participant":
                    _fail(element, f"el mensaje sale del pool {source.id_bpmn}, que no se simula; conéctalo desde una tarea o evento de envío.")
                if _kind(source) not in SEND_TYPES:
                    _fail(element, "los mensajes deben salir de una SendTask o de un MessageIntermediateThrowEvent.")
                if source.id_bpmn in senders:
                    _fail(element, "solo se admite un flujo de mensaje por emisor.")
                senders.add(source.id_bpmn)
                if _kind(target) == "Participant":
                    add_warning(warnings, f"{element.id_bpmn} (bpmn:MessageFlow): el mensaje de {source.id_bpmn} al pool {target.id_bpmn} se envía, pero nadie lo recibe en la simulación.")
                    continue
                if _kind(target) not in RECEIVE_TYPES:
                    _fail(element, "los mensajes deben llegar a una ReceiveTask, un MessageIntermediateCatchEvent o un MessageStartEvent.")
                if target.id_bpmn in receivers:
                    _fail(element, "solo se admite un flujo de mensaje por receptor.")
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
            parent = getattr(element, "parent_lane", None)
            if parent is not None and (parent not in nodes or _kind(nodes[parent]) != "Lane"):
                _fail(element, f"parentLane hace referencia a un carril inexistente: {parent}.")


def _reachable(seeds, adjacency):
    pending, found = list(seeds), set()
    while pending:
        current = pending.pop()
        if current not in found:
            found.add(current)
            pending.extend(adjacency.get(current, []))
    return found


def _check_participant_multiplicity(participant, warnings, any_marked):
    """Reglas del numero de instancias de un pool.

    El marcador es lo que habilita el campo: marcarlo sin decir cuantas es un
    modelo incompleto. Y un numero sin marcador no hace nada, porque mientras
    ningun pool este marcado manda el numero de la colaboracion; se avisa en
    vez de simular en silencio algo distinto de lo dibujado.
    """
    marcado = getattr(participant, "multiplicity", False)
    instancias = getattr(participant, "instances", None)
    etiqueta = f"{participant.id_bpmn} (bpmn:Participant)"
    # El tipo se comprueba siempre que haya valor, lleve marcador o no: un pool
    # sin marcador ignora el numero, pero aceptar ahi una lista en silencio
    # esconde un modelo mal exportado hasta que alguien le ponga el marcador.
    if instancias is not None and (isinstance(instancias, bool) or not isinstance(instancias, int)):
        _fail(participant, f"instances debe ser un entero positivo, no {type(instancias).__name__}.")
    if marcado:
        if instancias is None:
            _fail(participant, "lleva el marcador de multiplicidad pero no dice cuántas instancias.")
        if instancias < 1:
            _fail(participant, "instances debe ser un entero positivo.")
    elif instancias is not None:
        if any_marked:
            add_warning(warnings, f"{etiqueta}: tiene instances pero no el marcador de multiplicidad; se simula con una sola instancia.")
        else:
            add_warning(warnings, f"{etiqueta}: se ignora instances porque ningún pool lleva el marcador; se usa el número de la colaboración.")


def resolve_participant_instances(elements, root):
    """Cuantas instancias simula cada pool.

    Sin ningun marcador se conserva la colaboracion 1:1 heredada: todos los
    pools toman el numero de la colaboracion, igual que antes de la tarea 2.1.
    En cuanto un pool lleva marcador, manda el numero de cada uno y el que no
    lo lleva vale 1.

    Las instancias del orquestador son convocatorias sucesivas y las del
    orquestado, casos por convocatoria; esa diferencia la aplica la tarea 4.1,
    aqui solo se cuenta cuantos casos hay.
    """
    participants = [elements[pid] for _, pid in elements.get("participants", [])]
    if not participants:
        return {root: elements[root].instances}
    if not any(getattr(p, "multiplicity", False) for p in participants):
        heredado = elements[root].instances
        return {p.id_bpmn: heredado for p in participants}
    return {p.id_bpmn: (p.instances if getattr(p, "multiplicity", False) else 1)
            for p in participants}


def _pesos_de_las_ramas(flows):
    """El peso de cada flujo de salida, calculado como gateways.getPercentOfBranches."""
    asignados = [flow.percentageOfBranches / 100 for flow in flows if flow.percentageOfBranches is not None]
    sin_porcentaje = [flow for flow in flows if flow.percentageOfBranches is None]
    reparto = max(1 - sum(asignados), 0) / len(sin_porcentaje) if sin_porcentaje else 0
    return [flow.percentageOfBranches / 100 if flow.percentageOfBranches is not None else reparto
            for flow in flows]


def _reparto_de_salidas(element, flows):
    """Que flujos de salida toma el motor siempre y cuales solo a veces.

    Como las plantillas de gateways.py: la exclusiva elige uno de los que
    tienen peso positivo; la inclusiva sortea cada uno con su probabilidad y,
    si no sale ninguno, elige uno por peso, asi que toma cualquier grupo no
    vacio de los que tienen peso, siempre con los del 100 % dentro. La paralela
    y cualquier otro nodo los toman todos. Es lineal en el numero de flujos: las
    combinaciones no se enumeran aqui.
    """
    ids = [flow.id_bpmn for flow in flows]
    kind = _kind(element)
    if kind not in {"ExclusiveGateway", "InclusiveGateway"}:
        return tuple(ids), ()
    pesos = _pesos_de_las_ramas(flows)
    con_peso = [flujo for flujo, peso in zip(ids, pesos) if peso > 0]
    if kind == "ExclusiveGateway":
        return (), tuple(con_peso)
    siempre = tuple(flujo for flujo, peso in zip(ids, pesos) if peso >= 1)
    return siempre, tuple(flujo for flujo in con_peso if flujo not in siempre)


def _cuantas_salidas(element, flows):
    """Cuantas combinaciones de salida tiene un nodo, sin enumerarlas."""
    siempre, a_veces = _reparto_de_salidas(element, flows)
    kind = _kind(element)
    if kind == "ExclusiveGateway":
        return len(a_veces)
    if kind == "InclusiveGateway":
        return 2 ** len(a_veces) - (0 if siempre else 1)
    return 1


def _salidas_posibles(element, flows):
    """Cada combinacion de flujos que el motor puede tomar de una vez, una a una.

    Es un generador: en una inclusiva ancha hay 2^n combinaciones, y quien lo
    recorre tiene que ir descontandolas de un presupuesto (_juega_el_caso).
    """
    siempre, a_veces = _reparto_de_salidas(element, flows)
    kind = _kind(element)
    if kind == "ExclusiveGateway":
        for flujo in a_veces:
            yield (flujo,)
    elif kind == "InclusiveGateway":
        for cuantos in range(len(a_veces) + 1):
            for extra in itertools.combinations(a_veces, cuantos):
                if siempre or extra:
                    yield siempre + extra
    else:
        # Todos sus flujos; en un evento de fin, ninguno: el token se consume.
        yield siempre


def _trae_lote(element):
    return _kind(element) == "ReceiveTask" and element.multiInstanceType is not None


def _llegadas_sin_lote(nodes, adjacency, reverse):
    """Los nodos a los que un token puede llegar sin haber pasado por una
    recepcion multiinstancia, cada uno con el nodo desde el que llega (D8).

    Se parte de los eventos de inicio, que no traen lote, y se avanza por los
    flujos de secuencia que el motor puede tomar. Una recepcion multiinstancia
    corta el avance: lo que sale de ella lleva su lote. Una union paralela
    espera un token de cada entrada, asi que solo llega sin lote si ninguna de
    sus entradas lo trae; con que una pase por la recepcion, el lote esta
    garantizado. Cualquier otro nodo se activa con cada token que le llega -una
    union exclusiva, un nodo con varias entradas sin compuerta- y basta una
    entrada sin lote para que alguna activacion no lo tenga.

    La union inclusiva se cuenta aqui como la exclusiva, que es lo prudente: a
    que espera depende de que tokens estan vivos cuando le llega uno, y eso no
    se ve recorriendo el grafo. Si el veredicto depende de ella, lo decide
    _juega_el_caso.

    Es un punto fijo minimo, y por eso los ciclos no confunden: un nodo de un
    bucle solo queda sin lote si se llega a el desde un inicio sin pasar por la
    recepcion, no por el mero hecho de estar en un ciclo. Recorre cada flujo una
    vez: no depende de cuantas combinaciones de salida tenga una compuerta.
    """
    def espera_a_todas(nodo):
        return _kind(nodes[nodo]) == "ParallelGateway" and len(reverse.get(nodo, ())) > 1

    desde = {nodo: None for nodo, elemento in nodes.items() if _kind(elemento) in START_TYPES}
    pendientes = deque(desde)
    while pendientes:
        nodo = pendientes.popleft()
        for siguiente in adjacency.get(nodo, ()):
            if siguiente in desde or _trae_lote(nodes[siguiente]):
                continue
            if espera_a_todas(siguiente) and not all(previo in desde for previo in reverse[siguiente]):
                continue
            desde[siguiente] = nodo
            pendientes.append(siguiente)
    return desde


class _SinPresupuesto(Exception):
    """La partida de _juega_el_caso ha gastado PASOS_MAXIMOS."""


def _juega_el_caso(componente, nodes, outgoing, flujos, todas, entradas, evaluaciones):
    """Juega con los tokens de un caso todas las intercalaciones posibles, con
    las mismas reglas que el motor, y dice que evaluaciones se activan sin lote.

    Hace falta para la union inclusiva. Dispara cuando ningun token vivo del
    caso puede llegar a una entrada vacia sin poder llegar tambien a una ocupada
    (runtime._join_ready, tabla 13.3 de BPMN 2.0.2): despues de una bifurcacion
    paralela espera a la rama de la recepcion, porque su token sigue vivo, y
    despues de una inclusiva que no la abrio, no. Eso depende de que tokens hay
    a la vez, asi que se recorren los estados de un caso: que tokens hay en cada
    nodo y en cada entrada de union, y si traen lote.

    Cada paso termina un token cualquiera -las duraciones y las esperas de
    mensajes pueden ordenarlos de cualquier manera-, lo encamina por cada
    combinacion de salidas que el motor puede elegir y dispara las uniones
    listas hasta que no quede ninguna, en cualquier orden, como _flush_joins.
    Un token que sale de una recepcion multiinstancia lleva lote, y una union
    lo lleva si lo trae alguno de los que junta.

    Una cadena de tareas o eventos con una sola entrada y una sola salida se
    recorre de un paso: un token en cualquiera de sus nodos llega a los mismos
    sitios, asi que ninguna union lo ve distinto, y contar cada posicion solo
    multiplicaria los estados. No entran en una cadena las recepciones
    multiinstancia, que cambian el lote, ni las evaluaciones, cuya activacion es
    lo que se busca.

    Todo lo que crece con el modelo se paga de un presupuesto, PASOS_MAXIMOS,
    en tokens tocados: cada combinacion de salidas que se prueba y cada manera
    de disparar una union cuestan tantos pasos como tokens tiene el estado del
    que salen, porque los copian, y guardar un estado nuevo cuesta tantos como
    tokens guarda mas COSTE_DE_GUARDAR, lo que ocupa guardarlo aunque tenga un
    solo token. Asi el presupuesto acota a la vez el tiempo y la memoria, sean
    los estados grandes o pequeños. Las combinaciones se generan de una
    en una, y antes de empezar se cuentan sin enumerarlas: si una sola compuerta
    ya tiene mas que el presupuesto, no se juega.

    Devuelve, por evaluacion, el camino de una activacion sin lote, y si se ha
    terminado la partida; si se acaba el presupuesto, lo que no se haya visto
    queda sin comprobar.
    """
    if any(_cuantas_salidas(nodes[nodo], outgoing[nodo]) > PASOS_MAXIMOS for nodo in componente):
        return {}, False
    uniones = {nodo: _kind(nodes[nodo]) for nodo in componente
               if _kind(nodes[nodo]) in {"ParallelGateway", "InclusiveGateway"} and len(entradas[nodo]) > 1}

    def encadenable(nodo):
        kind = _kind(nodes[nodo])
        return (kind not in GATEWAY_TYPES | START_TYPES | {"EndEvent"}
                and len(entradas[nodo]) == 1 and len(todas[nodo]) == 1
                and not _trae_lote(nodes[nodo]) and nodo not in evaluaciones)

    # Los nodos que recorre un token de un paso, desde cada nodo en el que
    # puede entrar; el ultimo es el que lo encamina.
    cadena = {}
    for nodo in componente:
        tramo = [nodo]
        while encadenable(tramo[-1]):
            siguiente = flujos[todas[tramo[-1]][0]][1]
            if not encadenable(siguiente) or siguiente in tramo:
                break
            tramo.append(siguiente)
        cadena[nodo] = tuple(tramo)
    alcance = {}
    pasos = 0
    # Cada token distinto -un nodo activo, o una entrada de union, con o sin
    # lote- tiene un numero, y un estado es una tupla de numeros: ocupa poco y
    # se compara rapido, que es lo que pagan los estados guardados.
    ids, fichas = {}, []

    def ficha(*token):
        numero = ids.get(token)
        if numero is None:
            numero = ids[token] = len(fichas)
            fichas.append(token)
        return numero

    def cuantos(cuenta, *token):
        numero = ids.get(token)
        return cuenta.get(numero, 0) if numero is not None else 0

    def gasta(cuenta_pasos, cantidad):
        nonlocal pasos
        if cuenta_pasos:
            pasos += cantidad
            if pasos > PASOS_MAXIMOS:
                raise _SinPresupuesto

    def alcanza(vivo, flujo, union):
        # Lo mismo que runtime._reachable: llegar al origen de la entrada sin
        # pasar antes por esta union.
        clave = (vivo, flujo, union)
        if clave not in alcance:
            origen, encontrado = flujos[flujo][0], False
            vistos, pendientes = {union}, [vivo]
            while pendientes:
                actual = pendientes.pop()
                if actual in vistos:
                    continue
                if actual == origen:
                    encontrado = True
                    break
                vistos.add(actual)
                pendientes.extend(flujos[salida][1] for salida in todas[actual])
            alcance[clave] = encontrado
        return alcance[clave]

    def lista(union, cuenta):
        ocupadas = [flujo for flujo in entradas[union]
                    if cuantos(cuenta, "espera", union, flujo, False) or cuantos(cuenta, "espera", union, flujo, True)]
        if uniones[union] == "ParallelGateway":
            return len(ocupadas) == len(entradas[union])
        if not ocupadas:
            return False
        vacias = [flujo for flujo in entradas[union] if flujo not in ocupadas]
        vivos = set()
        for numero, veces in cuenta.items():
            token = fichas[numero]
            if veces > 0 and (token[0] == "activo" or token[1] != union):
                vivos.add(token[1])
        return not any(any(alcanza(vivo, flujo, union) for flujo in vacias)
                       and not any(alcanza(vivo, flujo, union) for flujo in ocupadas)
                       for vivo in sorted(vivos))

    def dispara_listas(cuenta, eventos, cuenta_pasos):
        listas = [union for union in sorted(uniones) if lista(union, cuenta)]
        if not listas:
            yield cuenta, eventos
            return
        for union in listas:
            opciones = [[(flujo, lote) for lote in (False, True) if cuantos(cuenta, "espera", union, flujo, lote)]
                        for flujo in entradas[union]]
            for consumo in itertools.product(*[opcion for opcion in opciones if opcion]):
                gasta(cuenta_pasos, len(cuenta))
                nueva = Counter(cuenta)
                for flujo, lote in consumo:
                    nueva[ids[("espera", union, flujo, lote)]] -= 1
                lote = any(lote for _, lote in consumo)
                nueva[ficha("activo", union, lote)] += 1
                yield from dispara_listas(nueva, eventos + (("dispara", union, consumo, lote),), cuenta_pasos)

    def congela(cuenta):
        return tuple(numero for par in sorted(cuenta.items()) if par[1] > 0 for numero in par)

    def sucesores(estado, cuenta_pasos=True):
        """Cada estado al que se pasa terminando un token, con lo que ha pasado."""
        cuenta = Counter(dict(zip(estado[::2], estado[1::2])))
        for numero in estado[::2]:
            tipo, nodo, *resto = fichas[numero]
            if tipo != "activo":
                continue
            lote_entrada = resto[0]
            lote = lote_entrada or _trae_lote(nodes[nodo])
            ultimo = cadena[nodo][-1]
            for combinacion in _salidas_posibles(nodes[ultimo], outgoing[ultimo]):
                gasta(cuenta_pasos, len(cuenta))
                nueva = Counter(cuenta)
                nueva[numero] -= 1
                producidos = []
                for flujo in combinacion:
                    destino = flujos[flujo][1]
                    token = (("espera", destino, flujo, lote) if destino in uniones
                             else ("activo", destino, lote))
                    nueva[ficha(*token)] += 1
                    producidos.append(token)
                paso = ("completa", cadena[nodo], lote_entrada, tuple(producidos))
                for final, eventos in dispara_listas(nueva, (paso,), cuenta_pasos):
                    yield congela(final), eventos

    def camino_del_token(estado, ultimos, evaluacion):
        """El camino que siguio el token sin lote que activo la evaluacion.

        Los estados guardan solo de donde vienen; lo que paso en cada paso se
        vuelve a jugar aqui, sin gastar presupuesto, solo para los estados del
        camino. Luego se rehace hacia atras: quien produjo el token que llego a
        la evaluacion, quien produjo el que ese nodo termino, y asi hasta un
        inicio. Los tokens no tienen nombre, y se toma el ultimo que encaja;
        cualquiera que encaje es un camino por el que se llega sin lote.
        """
        cadena_de_estados = [estado]
        while padre[cadena_de_estados[-1]] is not None:
            cadena_de_estados.append(padre[cadena_de_estados[-1]])
        cadena_de_estados.reverse()
        eventos = []
        for anterior, siguiente in zip(cadena_de_estados, cadena_de_estados[1:]):
            eventos.extend(next(pasado for alcanzado, pasado in sucesores(anterior, False)
                                if alcanzado == siguiente))
        eventos.extend(ultimos)
        recorrido, buscado, indice = [evaluacion], ("activo", evaluacion, False), len(eventos)
        while True:
            indice -= 1
            while indice >= 0:
                evento = eventos[indice]
                if evento[0] == "completa" and buscado in evento[3]:
                    break
                if evento[0] == "dispara" and buscado == ("activo", evento[1], evento[3]):
                    break
                indice -= 1
            if indice < 0:
                break
            if evento[0] == "completa":
                recorrido.extend(reversed(evento[1]))
                buscado = ("activo", evento[1][0], evento[2])
            else:
                flujo, lote = next(par for par in evento[2] if not par[1])
                buscado = ("espera", evento[1], flujo, lote)
        return recorrido[::-1]

    def caminos():
        return {evaluacion: camino_del_token(estado, ultimos, evaluacion)
                for evaluacion, (estado, ultimos) in sin_lote.items()}

    inicio = congela(Counter({ficha("activo", nodo, False): 1 for nodo in sorted(componente)
                              if _kind(nodes[nodo]) in START_TYPES}))
    padre, cola, sin_lote = {inicio: None}, deque([inicio]), {}
    try:
        while cola and len(sin_lote) < len(evaluaciones):
            estado = cola.popleft()
            for siguiente, eventos in sucesores(estado):
                for token in eventos[0][3]:
                    if token[0] == "activo" and token[1] in evaluaciones and not token[2]:
                        sin_lote.setdefault(token[1], (estado, eventos[:1]))
                if siguiente not in padre:
                    gasta(True, COSTE_DE_GUARDAR + len(siguiente) // 2)
                    padre[siguiente] = estado
                    cola.append(siguiente)
    except _SinPresupuesto:
        return caminos(), False
    return caminos(), True


class _SinComprobar(tuple):
    """Las uniones inclusivas que no se han podido descartar."""


def _caminos_sin_lote(nodes, outgoing, incoming, reverse):
    """Para cada evaluacion, el camino de una activacion que llega sin lote.

    Primero el recorrido del grafo, que es rapido y no se equivoca hacia el lado
    bueno: si dice que el lote esta garantizado, lo esta. Si dice que no y en el
    proceso hay una union inclusiva, el recorrido puede estar siendo prudente de
    mas, y decide _juega_el_caso. Devuelve una funcion: None si toda activacion
    trae lote, el camino si alguna no, o _SinComprobar con las uniones si la
    partida no cabe en el presupuesto.

    No se prepara nada hasta la primera pregunta: un modelo sin evaluaciones
    multiinstancia no paga ni el recorrido.
    """
    preparado, partidas = {}, {}

    def prepara():
        flujos = {flow.id_bpmn: (flow.superElement, flow.subElement)
                  for flows in outgoing.values() for flow in flows}
        posibles = {}
        for nodo in nodes:
            siempre, a_veces = _reparto_de_salidas(nodes[nodo], outgoing[nodo])
            tomados = set(siempre) | set(a_veces)
            posibles[nodo] = [flow.subElement for flow in outgoing[nodo] if flow.id_bpmn in tomados]
        todas = {nodo: [flow.id_bpmn for flow in outgoing[nodo]] for nodo in nodes}
        entradas = {nodo: [flow.id_bpmn for flow in incoming[nodo]] for nodo in nodes}
        # Los nodos de un mismo proceso: solo sus tokens pueden hacer esperar a
        # una union, porque el motor lleva las uniones por caso.
        componente_de = {}
        for nodo in nodes:
            if nodo in componente_de:
                continue
            componente, pendientes = set(), [nodo]
            while pendientes:
                actual = pendientes.pop()
                if actual in componente:
                    continue
                componente.add(actual)
                pendientes.extend(flujos[flujo][1] for flujo in todas[actual])
                pendientes.extend(flujos[flujo][0] for flujo in entradas[actual])
            componente = frozenset(componente)
            for miembro in componente:
                componente_de[miembro] = componente
        preparado.update(desde=_llegadas_sin_lote(nodes, posibles, reverse), flujos=flujos,
                         todas=todas, entradas=entradas, componente_de=componente_de)

    def camino(evaluacion):
        if not preparado:
            prepara()
        desde, entradas = preparado["desde"], preparado["entradas"]
        if evaluacion not in desde:
            return None
        componente = preparado["componente_de"][evaluacion]
        inclusivas = tuple(sorted(nodo for nodo in componente
                                  if _kind(nodes[nodo]) == "InclusiveGateway" and len(entradas[nodo]) > 1))
        if not inclusivas:
            recorrido, nodo = [], evaluacion
            while nodo is not None:
                recorrido.append(nodo)
                nodo = desde[nodo]
            return recorrido[::-1]
        if componente not in partidas:
            evaluaciones = {nodo for nodo in componente if nodo in desde
                            and _kind(nodes[nodo]) in TASK_TYPES - {"SendTask", "ReceiveTask"}
                            and nodes[nodo].multiInstanceType is not None}
            partidas[componente] = _juega_el_caso(componente, nodes, outgoing, preparado["flujos"],
                                                  preparado["todas"], entradas, evaluaciones)
        caminos, completo = partidas[componente]
        if evaluacion in caminos:
            return caminos[evaluacion]
        return None if completo else _SinComprobar(inclusivas)

    return camino


def _origen_de_la_cardinalidad(element, nodes, model, reverse, caminos_sin_lote):
    """De donde sale cuantas ejecuciones lanza una tarea multiinstancia (D8).

    Enviar a N, recoger de N y evaluar N. En un envio, N son los casos del pool
    al que escribe; en una recepcion, los mensajes que llegan; y en cualquier
    otra tarea -una evaluacion- los que llegaron a la recepcion multiinstancia
    que tiene antes en su camino. Hoy el motor aun usa numberOfExecutions; la
    3.2 calcula N de estas fuentes, y una marca que no tenga ninguna no tendria
    cardinalidad: se rechaza ya, en vez de inventarse un numero.

    La recepcion de una evaluacion se busca en TODOS los caminos hacia atras,
    hasta la primera recepcion multiinstancia de cada uno: si aparecen dos, el
    lote es ambiguo, igual que en resolve_reply_contexts. Y no basta con que
    aparezca en alguno: cada activacion de la evaluacion tiene que traer el
    lote, y eso lo dice _caminos_sin_lote.
    """
    kind = _kind(element)
    if kind == "SendTask":
        destino = model.get(element.messageDestiny)
        if destino is not None and _kind(destino) == "Participant":
            _fail(element, f"es multiinstancia y escribe al pool {destino.id_bpmn}, que no tiene casos: "
                           "no hay de dónde sacar cuántas ejecuciones lanzar.")
        return
    if kind == "ReceiveTask":
        return
    candidatos, vistos, frontera = [], {element.id_bpmn}, [element.id_bpmn]
    while frontera:
        siguiente = []
        for nodo in frontera:
            for previo in reverse[nodo]:
                if previo in vistos:
                    continue
                vistos.add(previo)
                anterior = nodes[previo]
                if _kind(anterior) == "ReceiveTask" and anterior.multiInstanceType is not None:
                    candidatos.append(previo)
                else:
                    siguiente.append(previo)
        frontera = siguiente
    if not candidatos:
        _fail(element, "es multiinstancia y no tiene de dónde sacar cuántas ejecuciones lanzar: "
                       "tiene que enviar o recibir un mensaje, o tener antes en su camino una "
                       "recepción multiinstancia cuyo lote evaluar.")
    if len(candidatos) > 1:
        _fail(element, "es multiinstancia y le llegan los lotes de varias recepciones (%s); no se "
                       "sabe cuántas ejecuciones lanzar." % ", ".join(sorted(candidatos)))
    camino = caminos_sin_lote(element.id_bpmn)
    if isinstance(camino, _SinComprobar):
        _fail(element, "es multiinstancia y no se ha podido comprobar que todas sus activaciones "
                       "traigan el lote de %s: depende de a qué esperan las uniones inclusivas %s, "
                       "y comprobarlo en un caso de su proceso pasa de %d pasos. Si tienen que "
                       "esperar a la recepción, usa una unión paralela."
                       % (candidatos[0], ", ".join(camino), PASOS_MAXIMOS))
    if camino is not None:
        recepcion = candidatos[0]
        # Si el camino cruza una union inclusiva, decirlo: quien dibuja suele
        # pensar que esa union espera a la recepcion, y es justo lo que falla.
        # El porque cambia de un modelo a otro -la rama no se abrio, se fue por
        # otro lado, o la union no la cuenta- y lo cuentan los modelos del banco.
        inclusivas = [nodo for nodo in camino
                      if _kind(nodes[nodo]) == "InclusiveGateway" and len(reverse[nodo]) > 1]
        porque = ("" if not inclusivas else
                  " La unión inclusiva %s puede disparar sin la rama de %s."
                  % (", ".join(inclusivas), recepcion))
        _fail(element, "es multiinstancia y se puede llegar a ella sin lote: el camino %s no pasa "
                       "por la recepción multiinstancia %s, y esa activación no tiene de dónde "
                       "sacar cuántas ejecuciones lanzar.%s Todos los caminos tienen que pasar por "
                       "la recepción, o esperarla en una unión paralela."
                       % (" -> ".join(camino), recepcion, porque))


def validate_simulation(elements, process, starts, message_starts, warnings=None):
    """Reject invalid rules before generating or executing Python code."""
    validate_references(elements, warnings)
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
            remainder = max(100 - total, 0) if missing else 0
            label = f"{element.id_bpmn} ({element.bpmn_type})"
            if total + remainder <= 0:
                _fail(element, "ninguna rama tiene un porcentaje positivo, así que no se puede elegir ninguna.")
            if missing and total >= 100 - 1e-8:
                detail = " y se reparten en proporción" if kind == "ExclusiveGateway" and total > 100 + 1e-8 else ""
                add_warning(warnings, f"{label}: los porcentajes asignados suman {total:g} %{detail}; las ramas sin porcentaje nunca se eligen.")
            elif not missing and kind == "ExclusiveGateway" and not math.isclose(total, 100, abs_tol=1e-8):
                add_warning(warnings, f"{label}: los porcentajes suman {total:g} % y se reparten en proporción.")
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
    for lane in lanes:
        for child in lane.contained_elements:
            if child not in nodes:
                _fail(lane, f"el carril contiene un elemento que no es un nodo: {child}.")
            if lane_chain(elements, child) is None:
                _fail(lane, f"el nodo {child} pertenece a varios carriles que no están anidados.")
    is_process = _kind(root) == "Process"
    if is_process:
        _number(root, "frequency")
        if participants:
            _fail(root, "los participantes necesitan una raíz Collaboration.")
        if not isinstance(root.userWithRole, dict):
            _fail(root, "userWithRole debe ser un diccionario de roles y listas de usuarios.")
        for role, users in root.userWithRole.items():
            if not isinstance(role, str) or not role.strip() or not isinstance(users, list) or any(not isinstance(user, str) or not user.strip() for user in users):
                _fail(root, "cada rol debe tener un nombre y una lista válida de usuarios.")
        process_users = set(root.userWithoutRole) | {user for users in root.userWithRole.values() for user in users}
        known_users = process_users | {user for lane in lanes for user in lane.users}
        # Sin pools no hay a quien mandarle un mensaje: en un Process todo nodo
        # es del mismo participante implicito.
        for element in model.values():
            if _kind(element) == "MessageFlow":
                _fail(element, "un Process no tiene con quien intercambiar mensajes; los mensajes "
                               "necesitan dos participantes de una colaboración.")
    else:
        any_marked = any(getattr(p, "multiplicity", False) for p in participants)
        orchestrators = [p for p in participants if getattr(p, "role", None) == "orchestrator"]
        if len(orchestrators) > 1:
            _fail(orchestrators[1], "solo puede haber un pool orquestador en la colaboración.")
        # Dos pools pueden declarar el mismo nombre: desde la tarea 2.3 son
        # personas distintas, cada una en la cola de su pool. Se avisa porque
        # tambien puede ser un descuido al dibujar.
        por_nombre = {}
        for participant in participants:
            for usuario in participant.users:
                por_nombre.setdefault(usuario, []).append(participant.id_bpmn)
        for usuario, pools in sorted(por_nombre.items()):
            if len(pools) > 1:
                add_warning(warnings, f"{usuario}: el mismo nombre de usuario está en varios pools ({', '.join(pools)}); cada pool tiene el suyo y no comparten recurso.")
        ownership, simulated = {}, 0
        for participant in participants:
            contained_nodes = set(participant.contained_elements) & set(nodes)
            if not contained_nodes:
                add_warning(warnings, f"{participant.id_bpmn} (bpmn:Participant): el pool no tiene un proceso que simular y se ignora.")
                continue
            simulated += 1
            _number(participant, "frequency")
            _check_participant_multiplicity(participant, warnings, any_marked)
            if not (contained_nodes & set(starts + message_starts)):
                _fail(participant, "necesita un proceso visible con al menos un evento de inicio.")
            for child in contained_nodes:
                if child in ownership:
                    _fail(participant, f"el nodo {child} pertenece a varios participantes.")
                ownership[child] = participant.id_bpmn
        if not simulated:
            _fail(root, "una colaboración necesita al menos un participante con un proceso que simular.")
        for lane in lanes:
            owners = {ownership.get(child) for child in lane.contained_elements}
            if len(owners) > 1:
                _fail(lane, "un carril no puede contener nodos de varios participantes.")
        for node in nodes:
            if node not in ownership:
                _fail(nodes[node], "el nodo no pertenece a ningún participante.")
        for source, targets in adjacency.items():
            for target in targets:
                if ownership[source] != ownership[target]:
                    _fail(nodes[source], f"el flujo de secuencia hacia {target} cruza participantes; utiliza mensajes.")
        # Lo contrario tambien: un mensaje tiene que salir del pool. Dentro de un
        # participante se usan flujos de secuencia, y un mensaje de un caso a si
        # mismo no significa nada. Un mensaje dirigido al pool de enfrente, en
        # cambio, ya lo admite validate_references con un aviso.
        for element in model.values():
            if _kind(element) != "MessageFlow":
                continue
            emisor = ownership.get(element.superElement)
            destino = model[element.subElement]
            # Un Participant es el propio pool; ownership solo contiene sus nodos.
            receptor = (destino.id_bpmn if _kind(destino) == "Participant"
                        else ownership.get(element.subElement))
            if emisor is not None and emisor == receptor:
                _fail(element, f"el mensaje no sale del pool {emisor}; dentro de un participante se "
                               "usan flujos de secuencia, no mensajes.")

    caminos_sin_lote = _caminos_sin_lote(nodes, outgoing, incoming, reverse)
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
        if element.multiInstanceType is not None:
            _origen_de_la_cardinalidad(element, nodes, model, reverse, caminos_sin_lote)
        assignment = element.userTask
        base = task_base_users(elements, element.id_bpmn, is_process)
        if is_process:
            roles = root.userWithRole
            if assignment is None:
                eligible = set(base) if base is not None else set(process_users)
            else:
                eligible = set()
                for item in assignment:
                    if item in roles:
                        eligible.update(roles[item])
                    elif item in known_users:
                        eligible.add(item)
                    else:
                        _fail(element, f"el usuario o rol {item!r} no está definido en el proceso ni en sus carriles.")
                if base is not None:
                    outside = sorted(item for item in assignment if item not in roles and item not in base)
                    if outside:
                        _fail(element, f"usuarios ajenos a su carril: {', '.join(outside)}.")
                    eligible &= set(base)
        else:
            available = set(base or [])
            eligible = available if assignment is None else available & set(assignment)
            unknown = set(assignment or []) - available
            if unknown:
                _fail(element, f"usuarios ajenos a su carril o participante: {', '.join(sorted(unknown))}.")
        if not eligible:
            _fail(element, "no tiene usuarios elegibles; asigna usuarios al proceso, participante o carril.")


BPMN_NAMESPACE = "http://www.omg.org/spec/BPMN/20100524/MODEL"
XML_NODE_TYPES = {
    "task", "userTask", "manualTask", "serviceTask", "scriptTask", "businessRuleTask", "callActivity",
    "sendTask", "receiveTask", "startEvent", "endEvent", "intermediateCatchEvent",
    "intermediateThrowEvent", "exclusiveGateway", "inclusiveGateway", "parallelGateway",
}
XML_ALLOWED = XML_NODE_TYPES | {
    "definitions", "documentation", "extensionElements", "import", "process", "collaboration",
    "participant", "laneSet", "lane", "childLaneSet", "flowNodeRef", "sequenceFlow", "messageFlow",
    "incoming", "outgoing", "message", "messageEventDefinition", "timerEventDefinition",
    "timeDuration", "dataObject", "dataObjectReference", "dataStore", "dataStoreReference",
    "dataInput", "dataOutput",
    "dataInputAssociation", "dataOutputAssociation", "sourceRef", "targetRef", "ioSpecification",
    "inputSet", "outputSet", "dataInputRefs", "dataOutputRefs", "property", "itemDefinition",
    "textAnnotation", "text", "association", "group", "category", "categoryValue",
    "standardLoopCharacteristics", "multiInstanceLoopCharacteristics",
    "participantMultiplicity",
}


def validate_diagram_xml(xml, warnings=None):
    """Inspect semantics the text exporter could otherwise silently discard.

    What the simulator replaces with its own parameters is reported in warnings;
    what would change the execution is rejected. Devuelve la raiz ya analizada,
    para que validate_diagram_correspondence no vuelva a leer el XML.
    """
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

    def check(element, owner, parent_kind=None):
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
        if kind == "conditionExpression" and parent_kind == "sequenceFlow":
            add_warning(warnings, f"{owner} (bpmn:sequenceFlow): la condición no se evalúa; se usan los porcentajes de las ramas.")
            return
        if kind not in XML_ALLOWED:
            raise ValueError(f"{label}: este elemento o expresión BPMN no está soportado por el simulador.")
        if kind == "dataStoreReference":
            add_warning(warnings, f"{label}: los almacenes de datos no se simulan y se ignoran.")
        if kind == "extensionElements":
            return
        if kind in XML_NODE_TYPES:
            if element.get("isForCompensation") in {"true", "1"}:
                raise ValueError(f"{label}: las tareas de compensación no están soportadas.")
            if element.get("default"):
                add_warning(warnings, f"{label}: el flujo por defecto se ignora; se usan los porcentajes de las ramas.")
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
            add_warning(warnings, f"{label}: la colección se trata como un único objeto de datos.")
        if kind == "standardLoopCharacteristics":
            if element.get("testBefore") in {"true", "1"} or element.get("loopMaximum"):
                add_warning(warnings, f"{label}: testBefore y loopMaximum no se evalúan; se usan los parámetros de bucle del simulador.")
        if kind == "multiInstanceLoopCharacteristics" and element.get("behavior", "All") != "All":
            raise ValueError(f"{label}: solo se admite multiinstancia con espera de todas las ejecuciones (All).")
        for child in element:
            check(child, owner, kind)

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
                if not reference:
                    add_warning(warnings, f"{participant.get('id', 'Participant')} (bpmn:Participant): el pool no tiene un proceso que simular y se ignora.")
                    continue
                if reference not in process_ids:
                    raise ValueError(f"{participant.get('id', 'Participant')}: el participante hace referencia a un proceso inexistente: {reference}.")
                if reference in referenced:
                    raise ValueError(f"{participant.get('id', 'Participant')}: varios participantes no pueden compartir el mismo proceso.")
                referenced.add(reference)
        if process_ids != referenced:
            raise ValueError("El XML contiene procesos que no pertenecen a la colaboración visible.")
    return root


# Los tipos que se cruzan entre reglas y diagrama. Las asociaciones de datos se
# quedan fuera: en el XML cuelgan de la tarea con referencias a su
# ioSpecification y el exportador las aplana, asi que no hay un ID que cruzar.
CORRESPONDENCE_KINDS = NODE_TYPES | {"SequenceFlow", "MessageFlow", "Participant", "Lane",
                                     "DataObjectReference"}


def _xml_kind(element, prefix):
    """El tipo que el exportador del Modeler escribe en las reglas para un
    elemento del XML: el de bpmn-js, salvo en los eventos, que lo enriquece con
    su definicion (un startEvent con mensaje es un MessageStartEvent)."""
    tag = element.tag[len(prefix):]
    definiciones = {child.tag[len(prefix):] for child in element
                    if isinstance(child.tag, str) and child.tag.startswith(prefix)
                    and child.tag.endswith("EventDefinition")}
    if tag == "startEvent" and "messageEventDefinition" in definiciones:
        return "MessageStartEvent"
    if tag == "intermediateCatchEvent":
        if "messageEventDefinition" in definiciones:
            return "MessageIntermediateCatchEvent"
        if "timerEventDefinition" in definiciones:
            return "TimerIntermediateCatchEvent"
    if tag == "intermediateThrowEvent" and "messageEventDefinition" in definiciones:
        return "MessageIntermediateThrowEvent"
    return tag[:1].upper() + tag[1:]


def validate_diagram_correspondence(elements, root, process):
    """Que las reglas describan el mismo modelo que el diagrama.

    El Modeler manda las dos cosas, pero el motor simula las reglas. Si el
    exportador descarta o cambia algo, o si reglas y diagrama vienen de
    versiones distintas, se simularia un modelo que nadie ha dibujado y la
    simulacion terminaria bien. Aqui se cruzan, en este orden: las referencias
    dentro del propio XML, la raiz, cada elemento por ID, tipo y extremos, y el
    pool de cada nodo.

    Lo que NO se cruza: las asociaciones de datos (ver CORRESPONDENCE_KINDS) y
    que nodos contiene cada carril, que el exportador deduce de la geometria
    con tolerancia y daria falsos positivos contra flowNodeRef.
    """
    prefix = "{" + BPMN_NAMESPACE + "}"
    con_id = {element.get("id") for element in root.iter()
              if isinstance(element.tag, str) and element.get("id")}

    # 1. Referencias rotas dentro del diagrama: un flujo o un carril que
    #    apunta a algo que no existe.
    en_xml = {}
    for element in root.iter():
        if not isinstance(element.tag, str) or not element.tag.startswith(prefix):
            continue
        element_id = element.get("id")
        kind = _xml_kind(element, prefix)
        if element_id and kind in CORRESPONDENCE_KINDS:
            en_xml[element_id] = (kind, element)
        if kind in ("SequenceFlow", "MessageFlow"):
            for campo in ("sourceRef", "targetRef"):
                referencia = element.get(campo)
                if referencia not in con_id:
                    raise ValueError(f"{element_id} (bpmn:{kind}): {campo} hace referencia a un "
                                     f"elemento que no existe en el diagrama: {referencia}.")
        if kind == "Lane":
            for nodo in element.findall(prefix + "flowNodeRef"):
                referencia = (nodo.text or "").strip()
                if referencia not in con_id:
                    raise ValueError(f"{element_id} (bpmn:Lane): flowNodeRef hace referencia a un "
                                     f"elemento que no existe en el diagrama: {referencia}.")

    # 2. La raiz: colaboracion contra colaboracion, proceso contra proceso.
    raiz = elements[process]
    colaboraciones = [element for element in root if element.tag == prefix + "collaboration"]
    procesos = [element for element in root if element.tag == prefix + "process"]
    if _kind(raiz) == "Collaboration":
        if not colaboraciones or colaboraciones[0].get("id") != process:
            raise ValueError(f"{process} (bpmn:Collaboration): las reglas son de esta colaboración "
                             "y el diagrama no la contiene.")
    elif colaboraciones or len(procesos) != 1 or procesos[0].get("id") != process:
        raise ValueError(f"{process} (bpmn:Process): las reglas son de este proceso y el diagrama "
                         "no es ese proceso.")

    # 3. Elemento a elemento, en el orden del diagrama.
    en_reglas = {key: value for key, value in elements.items()
                 if hasattr(value, "bpmn_type") and _kind(value) in CORRESPONDENCE_KINDS}
    for element_id, (kind, element) in en_xml.items():
        regla = en_reglas.get(element_id)
        if regla is None:
            raise ValueError(f"{element_id} (bpmn:{kind}): está en el diagrama pero no en las "
                             "reglas; se simularía un modelo distinto del dibujado.")
        if _kind(regla) != kind:
            raise ValueError(f"{element_id}: en el diagrama es bpmn:{kind} y en las reglas "
                             f"{regla.bpmn_type}.")
        if kind in ("SequenceFlow", "MessageFlow"):
            dibujado = (element.get("sourceRef"), element.get("targetRef"))
            simulado = (regla.superElement, regla.subElement)
            if dibujado != simulado:
                raise ValueError(f"{element_id} (bpmn:{kind}): en el diagrama va de {dibujado[0]} "
                                 f"a {dibujado[1]} y en las reglas de {simulado[0]} a {simulado[1]}.")
        # El marcador del pool decide cuantos casos hay: si el dibujo y las
        # reglas no coinciden, se simularia otra cardinalidad que la dibujada.
        # El de la tarea ya no se cruza aqui: lo lee aplica_marcas_del_diagrama.
        if kind == "Participant":
            dibujado = element.find(prefix + "participantMultiplicity") is not None
            simulado = bool(getattr(regla, "multiplicity", False))
            if dibujado != simulado:
                raise ValueError(f"{element_id} (bpmn:Participant): "
                                 + ("el diagrama tiene el marcador de multiplicidad y las reglas no."
                                    if dibujado else
                                    "las reglas tienen el marcador de multiplicidad y el diagrama no."))
    for element_id, regla in en_reglas.items():
        if element_id not in en_xml:
            raise ValueError(f"{element_id} ({regla.bpmn_type}): está en las reglas pero no en el diagrama.")

    # 4. El pool de cada nodo. En el XML es estructural -el proceso al que
    #    apunta cada participante-, y en las reglas decide en que casos corre el
    #    nodo: un nodo en otro pool mezclaria casos de dos participantes.
    if colaboraciones:
        pool_de_proceso = {participante.get("processRef"): participante.get("id")
                           for participante in colaboraciones[0].findall(prefix + "participant")
                           if participante.get("processRef")}
        pool_en_reglas = {}
        for _, participant_id in elements.get("participants", []):
            for hijo in elements[participant_id].contained_elements:
                pool_en_reglas.setdefault(hijo, participant_id)
        for proceso in procesos:
            pool = pool_de_proceso.get(proceso.get("id"))
            for element in proceso.iter():
                element_id = element.get("id") if isinstance(element.tag, str) else None
                if element_id in en_xml and en_xml[element_id][0] in NODE_TYPES:
                    if pool_en_reglas.get(element_id) != pool:
                        raise ValueError(f"{element_id}: en el diagrama está en el pool {pool} y en "
                                         f"las reglas en {pool_en_reglas.get(element_id)}.")
