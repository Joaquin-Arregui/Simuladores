"""Build a standalone SimPy script with one token runtime for all models."""

from pathlib import Path
from xml.etree import ElementTree as ET

from simulator.simulationFunctions.generateFunction import generateFunction
from simulator.validation import (TASK_TYPES, resolve_participant_instances,
                                  resolve_reply_contexts, task_base_users)

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


def _assign_participant(elements, ids, participant, mapping, seen):
    """Un pool contiene carriles, y los carriles elementos: se baja hasta el fondo."""
    for child in ids:
        if child in seen:
            continue
        seen.add(child)
        contained = getattr(elements.get(child), 'contained_elements', None)
        if contained:
            _assign_participant(elements, contained, participant, mapping, seen)
        mapping[child] = participant


def _lane_participant(elements, lane_id, element_participant, pools):
    """A que pool pertenece un carril, deducido de los nodos que contiene.

    El Modeler exporta los nodos del pool, pero no los IDs de sus carriles, asi
    que el carril no llega nunca por `containedElements` y se quedaba colgando
    de la colaboracion: la cola del pool perdia a sus usuarios. Los nodos si
    estan, y validate_simulation ya obliga a que sean de un solo participante.

    Los subcarriles se resuelven igual, cada uno por sus propios nodos: bpmn-js
    lista cada nodo en su carril y en todos los que lo contienen, asi que la
    cadena entera apunta al mismo pool y los usuarios heredados de un carril
    padre entran tambien en la cola. Por eso bastan los nodos propios: un carril
    sin nodos no puede cederle usuarios a ninguna tarea ni por herencia, porque
    task_base_users solo recorre los carriles que contienen el nodo.
    """
    owners = {element_participant.get(child) for child in elements[lane_id].contained_elements}
    owners &= pools
    return owners.pop() if len(owners) == 1 else None


def generateScript(elements, process, starts, messageStarts, start_date=DEFAULT_START_DATE, *, seed):
    element = elements[process]
    is_process = element.bpmn_type == 'bpmn:Process'
    flows = {item.id_bpmn: (item.superElement, item.subElement)
             for item in elements.values() if type(item).__name__ == 'BPMNSequenceFlow'}
    outgoing, incoming = {}, {}
    for flow_id, (source, target) in flows.items():
        outgoing.setdefault(source, []).append(flow_id)
        incoming.setdefault(target, []).append(flow_id)
    # Un MessageFlow puede apuntar al pool y no a un receptor ejecutable.
    # validate_simulation lo admite con aviso, porque el mensaje sale de la
    # simulacion y nadie lo recoge; el motor necesita distinguirlo de un
    # receptor que se ha quedado sin caso destino, que si es un error.
    external_targets = tuple(sorted(
        {item.subElement for item in elements.values()
         if type(item).__name__ == 'BPMNMessageFlow'
         and getattr(elements.get(item.subElement), 'bpmn_type', '') == 'bpmn:Participant'}))
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
    # A que participante pertenece cada elemento. Sin pools, todo cuelga de la
    # raiz: el caso es entonces (proceso, indice) y se comporta como antes.
    #
    # Solo entran los pools que de verdad simulan algo, es decir los que tienen
    # un evento de inicio. Un pool vacio lo ignora validate_simulation con un
    # aviso; si se le crearan casos, no tendrian ni evento de inicio ni de fin y
    # _assert_complete convertiria ese aviso en una simulacion bloqueada.
    with_process = {elements['startsParticipant'][node] for node in starts + messageStarts
                    if node in elements['startsParticipant']}
    participants = [participant_id for _, participant_id in elements['participants']
                    if participant_id in with_process] or [process]
    element_participant = {}
    for participant_id in participants:
        contained = getattr(elements.get(participant_id), 'contained_elements', None)
        if contained:
            _assign_participant(elements, contained, participant_id, element_participant, set())
    # Los carriles, despues de sus nodos y antes del valor por defecto: si se
    # dejan al valor por defecto acaban en la colaboracion y sus usuarios no
    # llegan a la cola de su pool.
    pools = set(participants)
    for lane_id in elements['lanes']:
        owner = _lane_participant(elements, lane_id, element_participant, pools)
        if owner is not None:
            element_participant[lane_id] = owner
    for item in elements.values():
        node_id = getattr(item, 'id_bpmn', None)
        if node_id is not None:
            element_participant.setdefault(node_id, participants[0] if is_process else process)
    # A que recepcion responde cada envio, para que dos conversaciones del mismo
    # caso no compartan la anotacion del remitente.
    reply_contexts = resolve_reply_contexts(elements, element_participant)
    # Cuantas instancias simula cada pool. Sin marcadores todos heredan el
    # numero de la colaboracion, que es como se comportaba hasta la tarea 2.1.
    instancias = resolve_participant_instances(elements, process)
    # La plantilla de cada pool y su casilla de recursos infinitos. Las colas
    # son por pool desde la tarea 2.3: dos pools que declaran el mismo nombre
    # tienen cada uno su persona.
    if is_process:
        pool_users = {process: user_pool}
        infinite_pools = {process: False}
    else:
        pool_users, infinite_pools = {}, {}
        for participant_id in participants:
            propios = list(elements[participant_id].users)
            for lane_id in elements['lanes']:
                if element_participant.get(lane_id) == participant_id:
                    propios.extend(elements[lane_id].users)
            pool_users[participant_id] = list(dict.fromkeys(propios))
            infinite_pools[participant_id] = bool(getattr(elements[participant_id], 'infinite_resources', False))
    config = {
        'nInstances': element.instances,
        'usuariosPorParticipante': pool_users,
        'recursosInfinitos': infinite_pools,
        'participantesOrden': participants,
        'instanciasPorParticipante': {p: instancias[p] for p in participants},
        'elementParticipant': element_participant,
        'rolePool': element.userWithRole if is_process else {},
        'processUsers': process_users,
        'taskUsers': task_users,
        'isProcess': is_process,
        'simulationStartDate': start_date,
        'simulationSeed': seed,
        'generatedData': elements['generatedData'], 'requiredData': elements['requiredData'],
        'dataInfo': elements['dataInfo'], 'defaultData': elements['defaultData'],
        'sequenceFlows': flows, 'outgoingFlows': outgoing, 'incomingFlows': incoming,
        'joinTypes': joins, 'startEvents': start_events,
        'destinosExternos': external_targets,
        'recepcionDeRespuesta': reply_contexts,
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
