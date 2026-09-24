"""Build a standalone SimPy script with one token runtime for all models."""

from pathlib import Path
from xml.etree import ElementTree as ET

from simulator.simulationFunctions.generateFunction import generateFunction
from simulator.validation import TASK_TYPES, task_base_users

DEFAULT_START_DATE = '2026-01-01T00:00:00+00:00'


def _metadata(element, elements):
    root = ET.Element('global')
    for key, value in [('type', element.bpmn_type), ('name', element.name),
                       ('id_bpmn', element.id_bpmn)]:
        ET.SubElement(root, 'string', key=key, value=str(value))
    ET.SubElement(root, 'int', key='instances', value=str(element.instances))
    if element.bpmn_type == 'bpmn:Process':
        ET.SubElement(root, 'int' if isinstance(element.frequency, int) else 'float',
                      key='frequency', value=str(element.frequency))
        users = ET.SubElement(ET.SubElement(root, 'list', key='userWithoutRole'), 'values')
        for user in element.userWithoutRole:
            ET.SubElement(users, 'string', value=str(user))
        roles = ET.SubElement(root, 'container', key='userWithRole')
        for role, members in element.userWithRole.items():
            values = ET.SubElement(ET.SubElement(roles, 'list', key=str(role)), 'values')
            for user in members:
                ET.SubElement(values, 'string', value=str(user))
    else:
        for lane_id in elements['lanes']:
            lane = elements[lane_id]
            container = ET.SubElement(root, 'container', key=lane.bpmn_type)
            for key, value in [('bpmn:name', lane.name), ('bpmn:id', lane.id_bpmn),
                               ('bpmn:users', lane.users), ('bpmn:elements', lane.contained_elements)]:
                ET.SubElement(container, 'string', key=key, value=str(value))
    return ET.tostring(root, encoding='unicode')


def generateScript(elements, process, starts, messageStarts, start_date=DEFAULT_START_DATE):
    element = elements[process]
    is_process = element.bpmn_type == 'bpmn:Process'
    flows = {item.id_bpmn: (item.superElement, item.subElement)
             for item in elements.values() if type(item).__name__ == 'BPMNSequenceFlow'}
    outgoing, incoming = {}, {}
    for flow_id, (source, target) in flows.items():
        outgoing.setdefault(source, []).append(flow_id)
        incoming.setdefault(target, []).append(flow_id)
    joins = {node: ('parallel' if elements[node].bpmn_type == 'bpmn:ParallelGateway' else 'inclusive')
             for node, edges in incoming.items() if len(edges) > 1 and
             elements[node].bpmn_type in ('bpmn:ParallelGateway', 'bpmn:InclusiveGateway')}
    start_events = {}
    for node in starts + messageStarts:
        item = elements[node]
        start_events[node] = {
            'type': item.bpmn_type, 'name': item.name, 'next': item.subTask,
            'origin': getattr(item, 'messageOrigin', None),
            'frequency': element.frequency if is_process else
                elements[elements['startsParticipant'][node]].frequency,
        }
    # Lane users are resolved here, so the runtime only looks up each task.
    task_users = {}
    for item in elements.values():
        if getattr(item, 'bpmn_type', '').removeprefix('bpmn:') in TASK_TYPES:
            base = task_base_users(elements, item.id_bpmn, is_process)
            if base is not None:
                task_users[item.id_bpmn] = base
    if is_process:
        process_users = list(dict.fromkeys(
            element.userWithoutRole + [user for users in element.userWithRole.values() for user in users]))
        user_pool = list(dict.fromkeys(process_users + [user for users in task_users.values() for user in users]))
    else:
        process_users = []
        user_pool = list(dict.fromkeys(user for users in elements['users'].values() for user in users))
    config = {
        'nInstances': element.instances,
        'rolePool': element.userWithRole if is_process else {},
        'processUsers': process_users,
        'userPool': user_pool,
        'taskUsers': task_users,
        'isProcess': is_process,
        'simulationStartDate': start_date,
        'generatedData': elements['generatedData'], 'requiredData': elements['requiredData'],
        'dataInfo': elements['dataInfo'], 'defaultData': elements['defaultData'],
        'sequenceFlows': flows, 'outgoingFlows': outgoing, 'incomingFlows': incoming,
        'joinTypes': joins, 'startEvents': start_events,
        'endEvents': [item.id_bpmn for item in elements.values()
                      if type(item).__name__ == 'BPMNEndEvent'],
        'logMetadata': _metadata(element, elements),
    }
    script = 'import simpy\nimport random\n'
    script += '\n'.join(f'{key} = {value!r}' for key, value in config.items()) + '\n'
    for node in starts + messageStarts:
        script = generateFunction(elements, elements[node].subTask, script)
    runtime = Path(__file__).with_name('runtime.py').read_text(encoding='utf-8')
    return script + '\n' + runtime + '\n_run_simulation()\n', process
