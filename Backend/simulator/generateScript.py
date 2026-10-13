"""Build a standalone SimPy script with one token runtime for all models."""

from pathlib import Path
from xml.etree import ElementTree as ET

from simulator.simulationFunctions.generateFunction import generateFunction
from simulator.validation import (TASK_TYPES, resolve_batch_receives, resolve_convocatorias,
                                  resolve_lane_pools, resolve_reply_contexts, resolve_send_cycles,
                                  resolve_send_reach, resolve_takeable_flows, task_base_users)
from simulator.registros import FORMATO_DEL_REGISTRO, id_de_simulacion

DEFAULT_START_DATE = '2026-01-01T00:00:00+00:00'


def _atributo(tipo, clave, valor):
    return ET.Element(tipo, key=clave, value=str(valor))


def _lista(clave, hijos):
    """Una lista XES. Para lo que tiene partes se usan listas anidadas y no
    contenedores, porque PM4Py lee las listas y se salta los contenedores."""
    lista = ET.Element('list', key=clave)
    ET.SubElement(lista, 'values').extend(hijos)
    return lista


def _personas(clave, personas, antes=()):
    return _lista(clave, list(antes) + [_atributo('string', 'person', persona) for persona in personas])


def _cabeceras(elements, process, participants, element_participant, pool_users, infinite_pools,
               convocatorias, seed, start_date, huellas):
    """[(pool, nombre, cabecera)]: los atributos de cada registro, ya en XML (D10).

    Primero los comunes a todos los registros de la simulacion: su
    identificacion, que se puede reproducir; la version del formato, la
    semilla, la base temporal, los pools esperados y cuantas convocatorias hubo;
    y la referencia del modelo, con la huella de las reglas y, si lo hubo, la
    del diagrama. Despues los del pool: su nombre y su rol, si sus recursos son
    finitos o infinitos, la plantilla entera -tambien quien no llegue a
    trabajar-, sus carriles con sus personas y, en un Process, sus roles. Con
    eso un registro se entiende solo, sin las reglas, aunque cambien despues.
    """
    raiz = elements[process]
    comunes = [
        _atributo('string', 'simulation:id',
                  id_de_simulacion(huellas['reglas'], huellas.get('diagrama'), seed, start_date)),
        _atributo('string', 'simulation:formatVersion', FORMATO_DEL_REGISTRO),
        _atributo('int', 'simulation:seed', seed),
        _atributo('string', 'simulation:startDate', start_date),
        _atributo('string', 'simulation:participants', ', '.join(participants)),
        _atributo('int', 'simulation:convocatorias', convocatorias),
        _atributo('string', 'model:id', raiz.id_bpmn),
        _atributo('string', 'model:name', raiz.name),
        _atributo('string', 'model:rulesSha256', huellas['reglas']),
    ]
    if huellas.get('diagrama'):
        comunes.append(_atributo('string', 'model:diagramSha256', huellas['diagrama']))
    cabeceras = []
    for participant_id in participants:
        pool = elements[participant_id]
        propios = [_atributo('string', 'concept:name', pool.name),
                   _atributo('string', 'pool:id', participant_id),
                   _atributo('string', 'pool:name', pool.name)]
        if getattr(pool, 'role', None):
            propios.append(_atributo('string', 'pool:role', pool.role))
        propios.append(_atributo('string', 'pool:resources',
                                 'infinite' if infinite_pools[participant_id] else 'finite'))
        propios.append(_personas('pool:staff', pool_users[participant_id]))
        carriles = [lane_id for lane_id in elements['lanes'] if element_participant.get(lane_id) == participant_id]
        if carriles:
            # Cada carril con su nombre, su carril padre si lo tiene -un
            # subcarril sin personas propias trabaja con las de el- y sus personas.
            propios.append(_lista('pool:lanes', [
                _personas(lane_id, elements[lane_id].users,
                          [_atributo('string', 'name', elements[lane_id].name)]
                          + ([_atributo('string', 'parent', elements[lane_id].parent_lane)]
                             if getattr(elements[lane_id], 'parent_lane', None) else []))
                for lane_id in carriles]))
        if getattr(pool, 'userWithRole', None):
            propios.append(_lista('pool:roles', [_personas(rol, personas)
                                                 for rol, personas in pool.userWithRole.items()]))
        lineas = []
        for atributo in comunes + propios:
            ET.indent(atributo, space='  ', level=1)
            lineas.append('  ' + ET.tostring(atributo, encoding='unicode'))
        cabeceras.append((participant_id, pool.name, '\n'.join(lineas)))
    return cabeceras


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


def _ejecuciones_maximas(envio):
    """Cuantos sobres puede mandar como mucho una activacion de un envio sin marca.

    Sin bucle, numberOfExecutions, que sin marca sigue repitiendo la tarea. Con
    loopParameter manda el bucle y numberOfExecutions no cuenta: con Units son
    esas vueltas; con Time o Percentage no hay un tope que se pueda dar por
    seguro, y None lo dice. Lo usa el cierre de una recepcion (D7): una respuesta
    que manda mas sobres de los que su recepcion anoto saca los que sobran por
    las reglas fijas, y esos pueden ir a otro caso.
    """
    bucle = envio.loopParameter
    if bucle is None:
        return envio.numberOfExecutions
    return bucle.get('Units')


def generateScript(elements, process, starts, messageStarts, start_date=DEFAULT_START_DATE, *, seed, huellas):
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
    # Su pool sale de sus nodos o, si no tienen, de su carril padre o sus
    # subcarriles (resolve_lane_pools).
    element_participant.update(resolve_lane_pools(elements, element_participant, set(participants)))
    for item in elements.values():
        node_id = getattr(item, 'id_bpmn', None)
        if node_id is not None:
            element_participant.setdefault(node_id, participants[0] if is_process else process)
    # A que recepcion responde cada envio, para que dos conversaciones del mismo
    # caso no compartan la anotacion del remitente.
    reply_contexts = resolve_reply_contexts(elements, element_participant)
    # Lo que necesita el motor para cerrar una recepcion multiinstancia (D7): los
    # envios que le escriben y, si son respuestas, la recepcion a la que
    # responden; desde cada nodo, a cuales de ellos se puede llegar todavia.
    # El diagnostico de un bloqueo (3.4) pregunta lo mismo de cualquier envio, y
    # de quien produce cada dato, asi que se calcula para todos.
    receptores = [item for item in elements.values() if getattr(item, 'messageOrigin', None)]
    envios = {item.id_bpmn for item in elements.values() if getattr(item, 'messageDestiny', None)}
    productores = set(elements['generatedData'])
    objetivos = envios | {reply_contexts[envio] for envio in envios if envio in reply_contexts} | productores
    # Cuantas convocatorias hay y cuantos casos tiene cada pool en cada una: las
    # instancias del orquestador son rondas sucesivas, y las de los demas, casos
    # por ronda. Sin orquestador marcado hay una sola, y sin marcadores todos
    # heredan el numero de la colaboracion, como hasta la tarea 2.1.
    convocatorias, por_convocatoria, orquestador = resolve_convocatorias(elements, process, participants)
    # Como llegan los casos de cada pool, contando desde que se abre su
    # convocatoria (D13): (modo, valor), con la frequency de la escalonada o la
    # ventana de la uniforme. Un Process escalona con la suya, como siempre, y
    # el orquestador, con un caso por ronda, llega al abrirse.
    llegadas = {}
    for participant_id in participants:
        item = elements[participant_id]
        modo = 'simultaneous' if participant_id == orquestador else (getattr(item, 'arrival_mode', None) or 'staggered')
        valor = {'staggered': item.frequency, 'uniform': getattr(item, 'arrival_window', None)}.get(modo, 0)
        llegadas[participant_id] = (modo, valor)
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
        'convocatorias': convocatorias,
        'casosPorConvocatoria': por_convocatoria,
        'llegadaPorParticipante': llegadas,
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
        # Los flujos que el motor puede tomar, de los nodos que tienen alguno al
        # 0 %: una union inclusiva no espera a un token que solo podria llegarle
        # por una rama que nunca se toma.
        'salidasPosibles': resolve_takeable_flows(elements),
        'destinosExternos': external_targets,
        'recepcionDeRespuesta': reply_contexts,
        # La cardinalidad en ejecucion (3.2): que lote evalua cada evaluacion
        # multiinstancia y que envios lo son; para cerrar una recepcion (D7), a
        # que envios y recepciones puede llegar un token desde cada nodo, quien
        # escribe a cada recepcion y cuantas veces repite un envio sin marca.
        'loteDeEvaluacion': resolve_batch_receives(elements),
        'enviosMultiinstancia': tuple(sorted(
            item.id_bpmn for item in elements.values()
            if type(item).__name__ == 'BPMNSendTask' and item.multiInstanceType is not None)),
        'alcanzaDesde': resolve_send_reach(elements, objetivos),
        'enviosEnCiclo': resolve_send_cycles(elements, envios),
        'origenDeRecepcion': {item.id_bpmn: item.messageOrigin for item in receptores},
        'ejecucionesMaximas': {item.id_bpmn: _ejecuciones_maximas(item) for item in elements.values()
                               if type(item).__name__ == 'BPMNSendTask' and item.multiInstanceType is None},
        'endEvents': [item.id_bpmn for item in elements.values()
                      if type(item).__name__ == 'BPMNEndEvent'],
        # Un registro por pool, con su cabecera ya escrita (D10).
        'registrosPorPool': _cabeceras(elements, process, participants, element_participant, pool_users,
                                       infinite_pools, convocatorias, seed, start_date, huellas),
    }
    script = 'import simpy\nimport random\n'
    script += '\n'.join(f'{key} = {value!r}' for key, value in config.items()) + '\n'
    for node in starts + messageStarts:
        script = generateFunction(elements, elements[node].subTask, script)
    runtime = Path(__file__).with_name('runtime.py').read_text(encoding='utf-8')
    return script + '\n' + runtime + '\n_run_simulation()\n', process
