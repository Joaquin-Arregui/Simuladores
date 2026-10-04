"""Runtime embedded in generated scripts; configuration comes from generateScript.

Tokens are registered before SimPy runs their processes, so gateway decisions
do not depend on which sibling SimPy executes first at a given instant. Token
bookkeeping is kept per instance, so each step only revisits its own joins.
One unit of simulated time is one second.
"""

from collections import Counter, defaultdict, deque
from typing import NamedTuple
from datetime import datetime, timedelta, timezone
from html import escape
from xml.etree import ElementTree as ET


class SimulationError(RuntimeError):
    """A model cannot complete with the configured tokens, messages or data."""


class Caso(NamedTuple):
    """Quien ejecuta: participante, indice dentro de ese participante, convocatoria.

    Sustituye a la cadena 'Instance N', que hacia de clave de mensajes, datos,
    tokens, uniones y traza a la vez. El indice se guarda aparte porque el
    emparejamiento de mensajes sigue siendo 1:1 por indice hasta la tarea 2.4.
    """
    participante: str
    indice: int
    convocatoria: int = 1

    def __str__(self):
        return f'{self.participante} - {self.indice}'


def caso_de(node, indice, convocatoria=1):
    """El caso al que pertenece un elemento en una instancia dada."""
    return Caso(elementParticipant[node], indice, convocatoria)


def casos_de(participante):
    """Todos los casos de un pool, hayan arrancado o no.

    La difusion necesita esta lista completa: un mensaje dirigido a un caso que
    todavia no ha arrancado tiene que quedarse esperandole, no perderse. Por eso
    la tabla se construye entera antes de lanzar ningun evento.
    """
    return casosPorParticipante[participante]


def caso_arrancado(caso):
    """Si su evento de inicio ya ha pasado su retardo de llegada."""
    return caso in casosArrancados


def etiqueta_de_traza(caso):
    # El nombre definitivo de la traza lo fija la tarea 1.6. Hasta entonces, un
    # modelo de un solo participante conserva el nombre de siempre.
    if len(participantesOrden) == 1:
        return f'Instance {caso.indice}'
    return f'{caso.participante} - {caso.indice}'


def xml_value(value):
    return escape(str(value), quote=True)


def resolve_task_time(max_time, min_time):
    duration = max(min_time, min(random.gauss((min_time + max_time) / 2,
                                             (max_time - min_time) / 6), max_time))
    # Rounding must not turn a positive-duration task into a zero-time loop.
    return max(1 if min_time > 0 else 0, round(duration))


def resolve_possible_users(possibleUsers, taskName):
    # taskUsers holds the users of the task's innermost lane with users (or of
    # its participant); without an entry, a Process uses its own users.
    base = taskUsers.get(taskName)
    if possibleUsers is None:
        users = list(base) if base is not None else list(processUsers)
    elif isProcess:
        users = []
        for item in possibleUsers:
            users.extend(rolePool.get(item, [item]))
        if base is not None:
            users = [user for user in users if user in base]
    else:
        users = [user for user in possibleUsers if user in (base or ())]
    if not users:
        raise SimulationError(f'No hay usuarios disponibles para la tarea {taskName}.')
    return list(dict.fromkeys(users))


class UserQueue:
    """Hand out users in order of arrival.

    A request takes a free eligible user at once, preferring the one with fewer
    assignments. Otherwise it waits, and each released user goes to the oldest
    waiting request that can use it.
    """

    def __init__(self, users):
        self.free = set(users)
        self.waiting = deque()

    def acquire(self, eligible):
        request = env.event()
        candidates = [user for user in eligible if user in self.free]
        if candidates:
            self._assign(request, min(candidates, key=lambda user: user_assignments[user]))
        else:
            self.waiting.append((request, eligible))
        return request

    def release(self, user):
        self.free.add(user)
        for index, (request, eligible) in enumerate(self.waiting):
            if user in eligible:
                del self.waiting[index]
                self._assign(request, user)
                return

    def _assign(self, request, user):
        self.free.discard(user)
        user_assignments[user] += 1
        request.succeed(user)


def publish_message(origin, target, execution, caso):
    # La clave usa el indice, no el caso entero: el emparejamiento sigue siendo
    # 1:1 entre pools hasta que la 2.4 lo cambie por caso destino.
    key = (origin, target, execution, caso.indice)
    if message_waiters[key]:
        message_waiters[key].popleft().succeed()
    else:
        messages[key] += 1


def wait_for_message(env, origin, target, execution, caso):
    key = (origin, target, execution, caso.indice)
    if messages[key]:
        messages[key] -= 1
        return
    event = env.event()
    message_waiters[key].append(event)
    yield event


def publish_data(data_object, caso):
    data.add((data_object, caso))
    changed = data_changed.pop(caso, None)
    if changed is not None:
        changed.succeed()


def wait_for_data(env, objects, caso):
    # Data objects belong to one caso; only its waiters are woken.
    while not all((item, caso) in data for item in objects):
        if caso not in data_changed:
            data_changed[caso] = env.event()
        yield data_changed[caso]


def _append_event(caso, values):
    event = ET.Element('event')
    for kind, key, value in values:
        ET.SubElement(event, kind, key=key, value=str(value))
    simulationResults[caso].append(ET.tostring(event, encoding='unicode'))


def _reachable(node, incoming_flow, blocked_join):
    """Reach an input without first passing this same join (including cycles)."""
    cache_key = (node, incoming_flow, blocked_join)
    if cache_key in reachability:
        return reachability[cache_key]
    source = sequenceFlows[incoming_flow][0]
    visited, pending = {blocked_join}, [node]
    while pending:
        current = pending.pop()
        if current in visited:
            continue
        if current == source:
            reachability[cache_key] = True
            return True
        visited.add(current)
        pending.extend(sequenceFlows[edge][1] for edge in outgoingFlows.get(current, []))
    reachability[cache_key] = False
    return False


def _join_ready(node, caso, counts):
    inputs = incomingFlows[node]
    if joinTypes[node] == 'parallel':
        return all(counts[edge] > 0 for edge in inputs)
    if not any(counts.values()):
        return False
    missing = [edge for edge in inputs if not counts[edge]]
    occupied = [edge for edge in inputs if counts[edge]]
    live_nodes = [active_node for active_node, count in active_tokens[caso].items() if count > 0]
    live_nodes.extend(other for other, waiting in pending_joins[caso].items()
                      if other != node and any(waiting.values()))
    # BPMN 2.0.2 table 13.3: a token that could reach an empty input blocks
    # only if it cannot also reach an already occupied input, without passing
    # through this join. The second condition matters for cyclic models.
    # https://www.omg.org/spec/BPMN/2.0.2/PDF
    return not any(any(_reachable(live, edge, node) for edge in missing)
                   and not any(_reachable(live, edge, node) for edge in occupied)
                   for live in live_nodes)


def _register(node, caso, incoming_flow=None):
    if node in joinTypes:
        if incoming_flow not in incomingFlows[node]:
            raise SimulationError(f'Entrada desconocida en la unión {node} ({caso}).')
        pending_joins[caso].setdefault(node, Counter())[incoming_flow] += 1
        # Cuando llego el token, para poder medir despues lo que espero aqui.
        join_waits[caso].setdefault(node, {}).setdefault(incoming_flow, deque()).append(env.now)
    else:
        active_tokens[caso][node] += 1
        env.process(_run_node(node, caso))


def _release_token(caso, node):
    tokens = active_tokens[caso]
    tokens[node] -= 1
    if tokens[node] <= 0:
        del tokens[node]


def _registra_espera_union(caso, node, edge):
    """La espera de un token en una union, de su llegada al disparo.

    Una rama que termina pronto se queda esperando a su hermana, y sin esto
    esos segundos no aparecen en ninguna parte del registro: solo se veia el
    disparo de la union. Como el resto de esperas del motor, solo se registra
    cuando de verdad hubo espera; el ultimo token en llegar no espera nada.
    """
    llegadas = join_waits[caso].get(node, {}).get(edge)
    inicio = llegadas.popleft() if llegadas else env.now
    if env.now <= inicio:
        return
    _append_event(caso, [('string', 'bpmn:type', 'StandByJoin'),
                         ('string', 'bpmn:id', node),
                         ('string', 'bpmn:incomingFlow', edge),
                         ('date', 'time:timestamp', inicio),
                         ('date', 'time:endTime', env.now),
                         ('date', 'time:duration', env.now - inicio),
                         ('int', 'bpmn:instance', caso.indice)])


def _flush_joins(caso):
    # Only this caso's tokens can enable its joins. A firing may unblock
    # another inclusive join; revisit until stable.
    joins = pending_joins[caso]
    changed = True
    while changed:
        changed = False
        for node, counts in list(joins.items()):
            if _join_ready(node, caso, counts):
                for edge in incomingFlows[node]:
                    if counts[edge]:
                        counts[edge] -= 1
                        _registra_espera_union(caso, node, edge)
                if not any(counts.values()):
                    del joins[node]
                active_tokens[caso][node] += 1
                env.process(_run_node(node, caso))
                changed = True


def _route(node, caso, result):
    selected = result if isinstance(result, list) else [result]
    edges = []
    for target in selected:
        if not target:
            continue
        if target in sequenceFlows and sequenceFlows[target][0] == node:
            edges.append(target)
        else:
            edges.extend(edge for edge in outgoingFlows.get(node, [])
                         if sequenceFlows[edge][1] == target)
    if not edges and node not in endEvents:
        raise SimulationError(f'El elemento {node} no tiene una salida ejecutable ({caso}).')
    # Register a complete split atomically, including tokens at join inputs.
    for edge in edges:
        _register(sequenceFlows[edge][1], caso, edge)


def _run_node(node, caso):
    function_name = 'node_' + node.encode('utf-8').hex()
    result = yield env.process(globals()[function_name](env, caso))
    _release_token(caso, node)
    _route(node, caso, result)
    if node in endEvents:
        completed[caso] += 1
    _flush_joins(caso)


def _start_event(node, caso, delay):
    item = startEvents[node]
    yield env.timeout(delay)
    casosArrancados.add(caso)
    if item['origin'] is not None:
        start_wait = env.now
        yield env.process(wait_for_message(env, item['origin'], node, 1, caso))
        if env.now > start_wait:
            _append_event(caso, [('string', 'bpmn:type', 'StandByMessage'),
                                ('string', 'bpmn:id', node),
                                ('date', 'time:timestamp', start_wait),
                                ('date', 'time:endTime', env.now),
                                ('date', 'time:duration', env.now - start_wait),
                                ('int', 'bpmn:instance', caso.indice)])
    values = [('string', 'bpmn:type', item['type']), ('string', 'bpmn:name', item['name']),
              ('string', 'bpmn:id', node), ('string', 'bpmn:subTask', item['next']),
              ('date', 'time:timestamp', env.now), ('int', 'bpmn:instance', caso.indice)]
    if item['origin'] is not None:
        values.append(('string', 'bpmn:messageOrigin', item['origin']))
    _append_event(caso, values)
    _release_token(caso, node)
    _route(node, caso, item['next'])
    _flush_joins(caso)


def _assert_complete():
    pending = [f'{node} ({caso})' for caso, joins in pending_joins.items()
               for node, counts in joins.items() if any(counts.values())]
    active = [f'{node} ({caso})' for caso, tokens in active_tokens.items()
              for node, count in tokens.items() if count]
    sin_arrancar = [str(caso) for caso in simulationResults if caso not in casosArrancados]
    missing = [str(caso) for caso in simulationResults if not completed[caso]]
    if pending or active or missing or sin_arrancar:
        details = []
        if pending:
            details.append('uniones pendientes: ' + ', '.join(pending[:10]))
        if active:
            details.append('elementos esperando mensaje o datos: ' + ', '.join(active[:10]))
        if sin_arrancar:
            details.append('casos preparados que nunca arrancaron: ' + ', '.join(sin_arrancar[:10]))
        if missing:
            details.append('casos sin evento de fin: ' + ', '.join(missing[:10]))
        raise SimulationError('Simulación bloqueada o incompleta; ' + '; '.join(details) + '.')


def xes_time(seconds):
    """ISO 8601 timestamp for a simulated time in seconds from the start date."""
    return (startDate + timedelta(seconds=float(seconds))).isoformat(timespec='milliseconds')


def _instante(item):
    for child in item:
        if child.get('key') == 'time:timestamp':
            return float(child.get('value'))
    return 0.0


def _ordena_eventos(events):
    """Orden temporal, con el orden de registro como desempate.

    Dos eventos del mismo instante salen siempre en el mismo orden, que es lo
    que pide el contrato de registro. Ademas deja la traza ordenada en el
    tiempo, que es como PM4Py espera leerla.
    """
    items = [ET.fromstring(event) for event in events]
    ordenados = sorted(enumerate(items), key=lambda par: (_instante(par[1]), par[0]))
    return [item for _, item in ordenados]


def _identifica(item, caso, ocurrencia):
    """Marca cada evento con su caso y con un numero de ocurrencia unico.

    La ocurrencia no se reutiliza en bucles ni en ramas paralelas, asi que dos
    ejecuciones simultaneas del mismo elemento en el mismo caso se distinguen.
    Se anade aqui y no en cada plantilla: hay un solo sitio donde se conoce el
    caso completo y por donde pasan todos los eventos.
    """
    item.append(ET.Element('int', key='bpmn:occurrence', value=str(ocurrencia)))
    item.append(ET.Element('string', key='bpmn:participant', value=str(caso.participante)))
    item.append(ET.Element('int', key='bpmn:convocatoria', value=str(caso.convocatoria)))


def _finalize_item(item):
    # Generated code logs simulated seconds; XES needs dates, and durations are
    # numbers rather than dates. Events are named by BPMN ID for process mining.
    for child in item.iter():
        if child.tag != 'date':
            continue
        if child.get('key') == 'time:duration':
            child.tag = 'float'
            child.set('value', str(float(child.get('value'))))
        else:
            child.set('value', xes_time(child.get('value')))
    if item.tag == 'event':
        values = {child.get('key'): child.get('value') for child in item}
        if 'concept:name' not in values and values.get('bpmn:id'):
            kind = values.get('bpmn:type') or ''
            label = values['bpmn:id'] if kind.startswith('bpmn:') else f"{kind} · {values['bpmn:id']}"
            item.insert(0, ET.Element('string', key='concept:name', value=label))
    return item


def _run_simulation():
    global env, simulationResults, user_queue, user_assignments
    global messages, message_waiters, data, data_changed, active_tokens, pending_joins
    global reachability, completed, startDate, join_waits
    global casosPorParticipante, casosArrancados
    # Every draw (durations, gateways, loops) comes from this generator, so the
    # seed alone fixes the run.
    random.seed(simulationSeed)
    env = simpy.Environment()
    startDate = datetime.fromisoformat(simulationStartDate)
    # La tabla de casos de la convocatoria, completa ANTES de lanzar nada. El
    # numero total se conoce desde el principio del experimento, asi que no hay
    # que esperar a que un caso arranque para poder dirigirle un mensaje.
    # Un caso por (participante, indice), con el numero de instancias de cada
    # pool; cuando todos tienen el mismo, el orden es el de siempre.
    casosPorParticipante = {participante: [Caso(participante, indice)
                                           for indice in range(1, instanciasPorParticipante[participante] + 1)]
                            for participante in participantesOrden}
    casosArrancados = set()
    maximo = max(instanciasPorParticipante.values())
    simulationResults = {Caso(participante, indice): []
                         for indice in range(1, maximo + 1)
                         for participante in participantesOrden
                         if indice <= instanciasPorParticipante[participante]}
    user_assignments = dict.fromkeys(userPool, 0)
    user_queue = UserQueue(userPool)
    messages, message_waiters = Counter(), defaultdict(deque)
    data = {(item, caso) for item in defaultData for caso in simulationResults}
    data_changed = {}
    active_tokens, pending_joins = defaultdict(Counter), defaultdict(dict)
    join_waits = defaultdict(dict)
    reachability, completed = {}, Counter()
    # Waiting for messages never suspends other starts or later instances.
    for indice in range(1, maximo + 1):
        for node, item in startEvents.items():
            if indice > instanciasPorParticipante[elementParticipant[node]]:
                continue
            caso = caso_de(node, indice)
            active_tokens[caso][node] += 1
            env.process(_start_event(node, caso, (indice - 1) * item['frequency']))
    env.run()
    _assert_complete()
    metadata = ET.fromstring(logMetadata)
    ET.indent(metadata, space='  ', level=1)
    parts = ['<?xml version="1.0" encoding="UTF-8"?>',
             '<log xes.version="1.0" xes.features="nested-attributes" openxes.version="1.0RC7" '
             'xmlns="http://www.xes-standard.org/">',
             '  <extension name="Concept" prefix="concept" uri="http://www.xes-standard.org/concept.xesext"/>',
             '  <extension name="Time" prefix="time" uri="http://www.xes-standard.org/time.xesext"/>',
             '  <classifier name="Activity (by BPMN ID)" keys="bpmn:id" scope="event"/>',
             '  <classifier name="Case (by participant and instance)" '
             'keys="bpmn:participant bpmn:instance" scope="event"/>',
             '  ' + ET.tostring(metadata, encoding='unicode'),
             f'  <int key="simulation:seed" value="{simulationSeed}"/>',
             f'  <string key="simulation:startDate" value="{xml_value(simulationStartDate)}"/>',
             f'  <string key="simulation:participants" '
             f'value="{xml_value(", ".join(participantesOrden))}"/>']
    for caso, events in simulationResults.items():
        trace = ET.Element('trace')
        ET.SubElement(trace, 'string', key='concept:name', value=etiqueta_de_traza(caso))
        ET.SubElement(trace, 'string', key='bpmn:participant', value=str(caso.participante))
        ET.SubElement(trace, 'int', key='bpmn:instance', value=str(caso.indice))
        ET.SubElement(trace, 'int', key='bpmn:convocatoria', value=str(caso.convocatoria))
        for ocurrencia, item in enumerate(_ordena_eventos(events), 1):
            _identifica(item, caso, ocurrencia)
            trace.append(_finalize_item(item))
        ET.indent(trace, space='  ', level=1)
        parts.append('  ' + ET.tostring(trace, encoding='unicode'))
    parts.append('</log>')
    with open('resultSimulation.xes', 'w', encoding='utf-8') as output:
        output.write('\n'.join(parts))
