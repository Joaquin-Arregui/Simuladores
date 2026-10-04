def intermediateThrowEvent(elements, element, script):
    from simulator.simulationFunctions.generateFunction import generateFunction, function_name, xml_template
    functionStr = f"""
def {function_name(element.id_bpmn)}(env, caso, contexto):
    simulationResults[caso].append(
f'''
        <event>
            <string key="bpmn:type" value="{xml_template(element.bpmn_type)}"/>
            <string key="bpmn:name" value="{xml_template(element.name)}"/>
            <string key="bpmn:id" value="{xml_template(element.id_bpmn)}"/>
            <string key="bpmn:subTask" value="{xml_template(element.subTask)}"/>
            <date key="time:timestamp" value="{{xml_value(env.now)}}"/>
            <int key="bpmn:instance" value="{{xml_value(caso.indice)}}"/>
        </event>''')
    yield env.timeout(0)
    return {element.subTask!r}
    """
    return generateFunction(elements, element.subTask, script + functionStr)

def messageIntermediateCatchEvent(elements, element, script):
    from simulator.simulationFunctions.generateFunction import generateFunction, function_name, xml_template
    functionStr = f"""
def {function_name(element.id_bpmn)}(env, caso, contexto):
    TaskName = {element.id_bpmn!r}
    start_standby_message = env.now
    remitente = yield env.process(wait_for_message(env, {element.messageOrigin!r}, TaskName, 1, caso, contexto))
    end_standby_message = env.now
    duration_standby_message = end_standby_message - start_standby_message
    if duration_standby_message > 0:
        simulationResults[caso].append(
f'''
        <event>
            <string key="bpmn:type" value="StandByMessage"/>
            <string key="bpmn:id" value="{{xml_value(TaskName)}}"/>
            <string key="bpmn:execution" value="1"/>
            <date key="time:timestamp" value="{{xml_value(start_standby_message)}}"/>
            <date key="time:endTime" value="{{xml_value(end_standby_message)}}"/>
            <date key="time:duration" value="{{xml_value(duration_standby_message)}}"/>
            <int key="bpmn:instance" value="{{xml_value(caso.indice)}}"/>
        </event>''')
    simulationResults[caso].append(
f'''
        <event>
            <string key="bpmn:type" value="{xml_template(element.bpmn_type)}"/>
            <string key="bpmn:name" value="{xml_template(element.name)}"/>
            <string key="bpmn:id" value="{xml_template(element.id_bpmn)}"/>
            <string key="bpmn:messageOrigin" value="{xml_template(element.messageOrigin)}"/>
            <string key="bpmn:messageSender" value="{{xml_value(remitente)}}"/>
            <string key="bpmn:subTask" value="{xml_template(element.subTask)}"/>
            <date key="time:timestamp" value="{{xml_value(env.now)}}"/>
            <int key="bpmn:instance" value="{{xml_value(caso.indice)}}"/>
        </event>''')
    return {element.subTask!r}
"""
    return generateFunction(elements, element.subTask, script + functionStr)

def messageIntermediateThrowEvent(elements, element, script):
    from simulator.simulationFunctions.generateFunction import generateFunction, function_name, xml_template
    functionStr = f"""
def {function_name(element.id_bpmn)}(env, caso, contexto):
    TaskName = {element.id_bpmn!r}
    # Igual que en el envio por tarea: el sobre sale primero para poder anotar a
    # que caso va, y no consume tiempo.
    destino = publish_message(TaskName, {element.messageDestiny!r}, 1, caso, contexto)
    simulationResults[caso].append(
f'''
        <event>
            <string key="bpmn:type" value="{xml_template(element.bpmn_type)}"/>
            <string key="bpmn:name" value="{xml_template(element.name)}"/>
            <string key="bpmn:id" value="{xml_template(element.id_bpmn)}"/>
            <string key="bpmn:messageDestiny" value="{xml_template(element.messageDestiny)}"/>
            <string key="bpmn:messageTarget" value="{{xml_value(etiqueta_de_caso(destino))}}"/>
            <string key="bpmn:subTask" value="{xml_template(element.subTask)}"/>
            <date key="time:timestamp" value="{{xml_value(env.now)}}"/>
            <int key="bpmn:instance" value="{{xml_value(caso.indice)}}"/>
        </event>''')
    yield env.timeout(0)
    return {element.subTask!r}
    """
    return generateFunction(elements, element.subTask, script + functionStr)

def timerIntermediateCatchEvent(elements, element, script):
    from simulator.simulationFunctions.generateFunction import generateFunction, function_name, xml_template
    functionStr = f"""
def {function_name(element.id_bpmn)}(env, caso, contexto):
    # Se registra al terminar la espera: el fin es el real, no el inicio mas la
    # duracion nominal, que es lo que el contrato de la 1.6 prohibe deducir.
    start_timer = env.now
    yield env.timeout({element.time})
    simulationResults[caso].append(
f'''
        <event>
            <string key="bpmn:type" value="{xml_template(element.bpmn_type)}"/>
            <string key="bpmn:name" value="{xml_template(element.name)}"/>
            <string key="bpmn:id" value="{xml_template(element.id_bpmn)}"/>
            <{'int' if isinstance(element.time, int) else 'float'} key="bpmn:time" value="{xml_template(element.time)}"/>
            <string key="bpmn:subTask" value="{xml_template(element.subTask)}"/>
            <date key="time:timestamp" value="{{xml_value(start_timer)}}"/>
            <date key="time:endTime" value="{{xml_value(env.now)}}"/>
            <date key="time:duration" value="{{xml_value(env.now-start_timer)}}"/>
            <int key="bpmn:instance" value="{{xml_value(caso.indice)}}"/>
        </event>''')
    return {element.subTask!r}
"""
    return generateFunction(elements, element.subTask, script + functionStr)

def endEvent(elements, element, script):
    from simulator.simulationFunctions.generateFunction import function_name, xml_template
    functionStr = f"""
def {function_name(element.id_bpmn)}(env, caso, contexto):
    simulationResults[caso].append(
f'''
        <event>
            <string key="bpmn:type" value="{xml_template(element.bpmn_type)}"/>
            <string key="bpmn:name" value="{xml_template(element.name)}"/>
            <string key="bpmn:id" value="{xml_template(element.id_bpmn)}"/>
            <string key="bpmn:subTask" value=""/>
            <date key="time:timestamp" value="{{xml_value(env.now)}}"/>
            <int key="bpmn:instance" value="{{xml_value(caso.indice)}}"/>
        </event>''')
    yield env.timeout(0)
    """
    return script + functionStr
