"""Runtime embedded in generated scripts; configuration comes from generateScript.

Tokens are registered before SimPy runs their processes, so gateway decisions
do not depend on which sibling SimPy executes first at a given instant.
"""

from collections import Counter, defaultdict, deque
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
    if isProcess:
        users = []
        for item in possibleUsers:
            users.extend(rolePool.get(item, [item] if item in userPool else []))
    else:
        allowed = usersPerLane.get(elementsContainer.get(taskName), [])
        users = [user for user in possibleUsers if user in allowed]
    if not users:
        raise SimulationError(f'No hay usuarios disponibles para la tarea {taskName}.')
    return list(dict.fromkeys(users))


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
    global data_changed
    data.add((data_object, name))
    data_changed.succeed()
    data_changed = env.event()


def wait_for_data(env, objects, name):
    while not all((item, name) in data for item in objects):
        yield data_changed


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
    live_nodes = [active_node for (active_node, instance), count in active_tokens.items()
                  if instance == name and count > 0]
    live_nodes.extend(other for (other, instance), waiting in pending_joins.items()
                      if instance == name and other != node and any(waiting.values()))
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
        pending_joins[(node, name)][incoming_flow] += 1
    else:
        active_tokens[(node, name)] += 1
        env.process(_run_node(node, name))


def _flush_joins():
    # A firing may unblock another inclusive join; revisit until stable.
    changed = True
    while changed:
        changed = False
        for (node, name), counts in list(pending_joins.items()):
            if _join_ready(node, name, counts):
                for edge in incomingFlows[node]:
                    if counts[edge]:
                        counts[edge] -= 1
                active_tokens[(node, name)] += 1
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
    active_tokens[(node, name)] -= 1
    _route(node, name, result)
    if node in endEvents:
        completed[name] += 1
    _flush_joins()


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
    active_tokens[(node, name)] -= 1
    _route(node, name, item['next'])
    _flush_joins()


def _assert_complete():
    pending = [f'{node} ({name})' for (node, name), counts in pending_joins.items()
               if any(counts.values())]
    active = [f'{node} ({name})' for (node, name), count in active_tokens.items() if count]
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


def _run_simulation():
    global env, simulationResults, userPool, user_resources, user_assignments, user_task_count
    global messages, message_waiters, data, data_changed, active_tokens, pending_joins
    global reachability, completed
    env = simpy.Environment()
    simulationResults = {f'Instance {i + 1}': [] for i in range(nInstances)}
    if isProcess:
        userPool = list(dict.fromkeys(userWithoutRole + [u for members in rolePool.values() for u in members]))
    else:
        userPool = list(dict.fromkeys(u for members in usersPerLane.values() for u in members))
    user_resources = {user: simpy.Resource(env, capacity=1) for user in userPool}
    user_assignments = dict.fromkeys(userPool, 0)
    user_task_count = {}
    messages, message_waiters = Counter(), defaultdict(deque)
    data = {(item, name) for item in defaultData for name in simulationResults}
    data_changed = env.event()
    active_tokens, pending_joins = Counter(), defaultdict(Counter)
    reachability, completed = {}, Counter()
    # Waiting for messages never suspends other starts or later instances.
    for i, name in enumerate(simulationResults):
        for node, item in startEvents.items():
            active_tokens[(node, name)] += 1
            env.process(_start_event(node, name, i + 1, i * item['frequency']))
    env.run()
    _assert_complete()
    parts = ['<?xml version="1.0" encoding="UTF-8"?>',
             '<log xes.version="1.0" xes.features="nested-attributes" openxes.version="1.0RC7" '
             'xmlns="http://www.xes-standard.org/">',
             '<classifier name="Activity (by BPMN ID)" keys="bpmn:id" scope="event"/>', logMetadata]
    for name, events in simulationResults.items():
        trace = ET.Element('trace')
        ET.SubElement(trace, 'string', key='concept:name', value=name)
        for event in events:
            trace.append(ET.fromstring(event))
        parts.append(ET.tostring(trace, encoding='unicode'))
    parts.append('</log>')
    with open('resultSimulation.xes', 'w', encoding='utf-8') as output:
        output.write('\n'.join(parts))
