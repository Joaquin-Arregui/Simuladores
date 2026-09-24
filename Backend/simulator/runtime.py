"""Runtime embedded in generated scripts; configuration comes from generateScript.

Tokens are registered before SimPy runs their processes, so gateway decisions
do not depend on which sibling SimPy executes first at a given instant. Token
bookkeeping is kept per instance, so each step only revisits its own joins.
One unit of simulated time is one second.
"""

from collections import Counter, defaultdict, deque
from datetime import datetime, timedelta, timezone
from html import escape
from xml.etree import ElementTree as ET


class SimulationError(RuntimeError):
    """A model cannot complete with the configured tokens, messages or data."""


def xml_value(value):
    return escape(str(value), quote=True)


def resolve_task_time(task_name, max_time, min_time, user):
    counts = user_task_count.setdefault(user, {})
    previous = counts.get(task_name, 0)
    duration = max(min_time, min(random.gauss((min_time + max_time) / 2,
                                             (max_time - min_time) / 6), max_time))
    counts[task_name] = previous + 1
    # Learning must not turn a positive-duration task into a zero-time loop.
    return max(1 if min_time > 0 else 0,
               round(duration * (1 - min(0.05 * previous, 0.5))))


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


def publish_message(origin, target, execution, name):
    key = (origin, target, execution, name)
    if message_waiters[key]:
        message_waiters[key].popleft().succeed()
    else:
        messages[key] += 1


def wait_for_message(env, origin, target, execution, name):
    key = (origin, target, execution, name)
    if messages[key]:
        messages[key] -= 1
        return
    event = env.event()
    message_waiters[key].append(event)
    yield event


def publish_data(data_object, name):
    data.add((data_object, name))
    changed = data_changed.pop(name, None)
    if changed is not None:
        changed.succeed()


def wait_for_data(env, objects, name):
    # Data objects belong to one instance; only its waiters are woken.
    while not all((item, name) in data for item in objects):
        if name not in data_changed:
            data_changed[name] = env.event()
        yield data_changed[name]


def _append_event(name, values):
    event = ET.Element('event')
    for kind, key, value in values:
        ET.SubElement(event, kind, key=key, value=str(value))
    simulationResults[name].append(ET.tostring(event, encoding='unicode'))


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


def _join_ready(node, name, counts):
    inputs = incomingFlows[node]
    if joinTypes[node] == 'parallel':
        return all(counts[edge] > 0 for edge in inputs)
    if not any(counts.values()):
        return False
    missing = [edge for edge in inputs if not counts[edge]]
    occupied = [edge for edge in inputs if counts[edge]]
    live_nodes = [active_node for active_node, count in active_tokens[name].items() if count > 0]
    live_nodes.extend(other for other, waiting in pending_joins[name].items()
                      if other != node and any(waiting.values()))
    # BPMN 2.0.2 table 13.3: a token that could reach an empty input blocks
    # only if it cannot also reach an already occupied input, without passing
    # through this join. The second condition matters for cyclic models.
    # https://www.omg.org/spec/BPMN/2.0.2/PDF
    return not any(any(_reachable(live, edge, node) for edge in missing)
                   and not any(_reachable(live, edge, node) for edge in occupied)
                   for live in live_nodes)


def _register(node, name, incoming_flow=None):
    if node in joinTypes:
        if incoming_flow not in incomingFlows[node]:
            raise SimulationError(f'Entrada desconocida en la unión {node} ({name}).')
        pending_joins[name].setdefault(node, Counter())[incoming_flow] += 1
    else:
        active_tokens[name][node] += 1
        env.process(_run_node(node, name))


def _release_token(name, node):
    tokens = active_tokens[name]
    tokens[node] -= 1
    if tokens[node] <= 0:
        del tokens[node]


def _flush_joins(name):
    # Only this instance's tokens can enable its joins. A firing may unblock
    # another inclusive join; revisit until stable.
    joins = pending_joins[name]
    changed = True
    while changed:
        changed = False
        for node, counts in list(joins.items()):
            if _join_ready(node, name, counts):
                for edge in incomingFlows[node]:
                    if counts[edge]:
                        counts[edge] -= 1
                if not any(counts.values()):
                    del joins[node]
                active_tokens[name][node] += 1
                env.process(_run_node(node, name))
                changed = True


def _route(node, name, result):
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
        raise SimulationError(f'El elemento {node} no tiene una salida ejecutable ({name}).')
    # Register a complete split atomically, including tokens at join inputs.
    for edge in edges:
        _register(sequenceFlows[edge][1], name, edge)


def _run_node(node, name):
    function_name = 'node_' + node.encode('utf-8').hex()
    result = yield env.process(globals()[function_name](env, name))
    _release_token(name, node)
    _route(node, name, result)
    if node in endEvents:
        completed[name] += 1
    _flush_joins(name)


def _start_event(node, name, instance, delay):
    item = startEvents[node]
    yield env.timeout(delay)
    if item['origin'] is not None:
        start_wait = env.now
        yield env.process(wait_for_message(env, item['origin'], node, 1, name))
        if env.now > start_wait:
            _append_event(name, [('string', 'bpmn:type', 'StandByMessage'),
                                ('string', 'bpmn:id', node),
                                ('date', 'time:timestamp', start_wait),
                                ('date', 'time:endTime', env.now),
                                ('date', 'time:duration', env.now - start_wait),
                                ('int', 'bpmn:instance', instance)])
    values = [('string', 'bpmn:type', item['type']), ('string', 'bpmn:name', item['name']),
              ('string', 'bpmn:id', node), ('string', 'bpmn:subTask', item['next']),
              ('date', 'time:timestamp', env.now), ('int', 'bpmn:instance', instance)]
    if item['origin'] is not None:
        values.append(('string', 'bpmn:messageOrigin', item['origin']))
    _append_event(name, values)
    _release_token(name, node)
    _route(node, name, item['next'])
    _flush_joins(name)


def _assert_complete():
    pending = [f'{node} ({name})' for name, joins in pending_joins.items()
               for node, counts in joins.items() if any(counts.values())]
    active = [f'{node} ({name})' for name, tokens in active_tokens.items()
              for node, count in tokens.items() if count]
    missing = [name for name in simulationResults if not completed[name]]
    if pending or active or missing:
        details = []
        if pending:
            details.append('uniones pendientes: ' + ', '.join(pending[:10]))
        if active:
            details.append('elementos esperando mensaje o datos: ' + ', '.join(active[:10]))
        if missing:
            details.append('instancias sin evento de fin: ' + ', '.join(missing[:10]))
        raise SimulationError('Simulación bloqueada o incompleta; ' + '; '.join(details) + '.')


def xes_time(seconds):
    """ISO 8601 timestamp for a simulated time in seconds from the start date."""
    return (startDate + timedelta(seconds=float(seconds))).isoformat(timespec='milliseconds')


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
    global env, simulationResults, user_queue, user_assignments, user_task_count
    global messages, message_waiters, data, data_changed, active_tokens, pending_joins
    global reachability, completed, startDate
    env = simpy.Environment()
    startDate = datetime.fromisoformat(simulationStartDate)
    simulationResults = {f'Instance {i + 1}': [] for i in range(nInstances)}
    user_assignments = dict.fromkeys(userPool, 0)
    user_queue = UserQueue(userPool)
    user_task_count = {}
    messages, message_waiters = Counter(), defaultdict(deque)
    data = {(item, name) for item in defaultData for name in simulationResults}
    data_changed = {}
    active_tokens, pending_joins = defaultdict(Counter), defaultdict(dict)
    reachability, completed = {}, Counter()
    # Waiting for messages never suspends other starts or later instances.
    for i, name in enumerate(simulationResults):
        for node, item in startEvents.items():
            active_tokens[name][node] += 1
            env.process(_start_event(node, name, i + 1, i * item['frequency']))
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
             '  ' + ET.tostring(metadata, encoding='unicode')]
    for name, events in simulationResults.items():
        trace = ET.Element('trace')
        ET.SubElement(trace, 'string', key='concept:name', value=name)
        for event in events:
            trace.append(_finalize_item(ET.fromstring(event)))
        ET.indent(trace, space='  ', level=1)
        parts.append('  ' + ET.tostring(trace, encoding='unicode'))
    parts.append('</log>')
    with open('resultSimulation.xes', 'w', encoding='utf-8') as output:
        output.write('\n'.join(parts))
