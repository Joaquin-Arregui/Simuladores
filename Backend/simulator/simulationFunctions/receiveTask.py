def receiveTask(elements, element, script):
    from simulator.simulationFunctions.generateFunction import generateFunction, function_name, xml_template
    functionStr = f"""
def {function_name(element.id_bpmn)}(env, caso, contexto):
    def executeTask(env, TaskName, caso, execution, recibido=None):
        # recoge_lote ya trae el sobre, y desde cuando lo esperaba esta ejecucion.
        if recibido is None:
            start_standby_message = env.now
            remitente = yield env.process(wait_for_message(env, {element.messageOrigin!r}, TaskName, execution, caso, contexto))
        else:
            remitente, start_standby_message = recibido
        end_standby_message = env.now
        duration_standby_message = end_standby_message - start_standby_message
        if duration_standby_message > 0:
            simulationResults[caso].append(
f'''
        <event>
            <string key="bpmn:type" value="StandByMessage"/>
            <string key="bpmn:id" value="{{xml_value(TaskName)}}"/>
            <int key="bpmn:activation" value="{{xml_value(contexto)}}"/>
            <string key="bpmn:execution" value="{{xml_value(execution)}}"/>
            <string key="bpmn:request" value="{{xml_value(remitente)}}"/>
            <date key="time:timestamp" value="{{xml_value(start_standby_message)}}"/>
            <date key="time:endTime" value="{{xml_value(end_standby_message)}}"/>
            <date key="time:duration" value="{{xml_value(duration_standby_message)}}"/>
            <int key="bpmn:instance" value="{{xml_value(caso.indice)}}"/>
        </event>''')
        start_standBy = env.now
        possibleUsers = resolve_possible_users({element.userTask}, TaskName)
        # Users are handed out in order of arrival (see UserQueue in runtime.py).
        userTask = yield adquirir_usuario(TaskName, possibleUsers)
        try:
            time = resolve_task_time({element.maximumTime}, {element.minimumTime})
            if env.now > start_standBy: 
                simulationResults[caso].append(
f'''
        <event>
            <string key="bpmn:type" value="StandBy"/>
            <string key="bpmn:id" value="{{xml_value(TaskName)}}"/>
            <int key="bpmn:activation" value="{{xml_value(contexto)}}"/>
            <string key="bpmn:execution" value="{{xml_value(execution)}}"/>
            <string key="bpmn:request" value="{{xml_value(remitente)}}"/>
            <date key="time:timestamp" value="{{xml_value(start_standBy)}}"/>
            <date key="time:endTime" value="{{xml_value(env.now)}}"/>
            <date key="time:duration" value="{{xml_value(env.now-start_standBy)}}"/>
            <int key="bpmn:instance" value="{{xml_value(caso.indice)}}"/>
        </event>''')
            # El evento se registra al terminar, para que el fin sea el real y no
            # el nominal: una tarea cancelada no habria llegado hasta aqui.
            start_task = env.now
            yield env.timeout(time)
            simulationResults[caso].append(
f'''
        <event>
            <string key="bpmn:type" value="{xml_template(element.bpmn_type)}"/>
            <string key="bpmn:name" value="{xml_template(element.name)}"/>
            <string key="bpmn:id" value="{{xml_value(TaskName)}}"/>
            <int key="bpmn:activation" value="{{xml_value(contexto)}}"/>
            <string key="bpmn:messageOrigin" value="{xml_template(element.messageOrigin)}"/>
            <string key="bpmn:messageSender" value="{{xml_value(remitente)}}"/>
            <string key="bpmn:request" value="{{xml_value(remitente)}}"/>
            <string key="bpmn:userTask" value="{{xml_value(userTask)}}"/>
            <int key="bpmn:execution" value="{{xml_value(execution)}}"/>
            <int key="bpmn:time" value="{{xml_value(time)}}"/>
            <string key="bpmn:subTask" value="{xml_template(element.subTask)}"/>
            <date key="time:timestamp" value="{{xml_value(start_task)}}"/>
            <date key="time:endTime" value="{{xml_value(env.now)}}"/>
            <date key="time:duration" value="{{xml_value(env.now-start_task)}}"/>
            <int key="bpmn:instance" value="{{xml_value(caso.indice)}}"/>
        </event>''')
        finally:
            liberar_usuario(TaskName, userTask)
    TaskName = {element.id_bpmn!r}
    if TaskName in requiredData.keys():
        dataObjects = requiredData[TaskName]
        start_standBy_data = env.now
        yield env.process(wait_for_data(env, dataObjects, caso))
        if env.now > start_standBy_data:
            simulationResults[caso].append(
f'''
        <event>
            <string key="bpmn:type" value="StandByData"/>
            <string key="bpmn:id" value="{{xml_value(TaskName)}}"/>
            <int key="bpmn:activation" value="{{xml_value(contexto)}}"/>
            <date key="time:timestamp" value="{{xml_value(start_standBy_data)}}"/>
            <date key="time:endTime" value="{{xml_value(env.now)}}"/>
            <date key="time:duration" value="{{xml_value(env.now-start_standBy_data)}}"/>
            <int key="bpmn:instance" value="{{xml_value(caso.indice)}}"/>
        </event>''')"""
    # Sin marca, numberOfExecutions sigue siendo el numero de sobres que espera,
    # uno tras otro. Con la marca recoge todo lo que llegue hasta que ya no
    # pueda llegar nada (D7): N son los sobres recogidos, cero incluido.
    if element.multiInstanceType is not None:
        functionStr = functionStr + f"""
    yield from recoge_lote(env, {element.messageOrigin!r}, TaskName, caso, contexto, executeTask, {element.multiInstanceType == False})"""
    elif element.loopParameter == None:
        functionStr = functionStr + f"""
    for execution in range({element.numberOfExecutions}):
        yield env.process(executeTask(env, TaskName, caso, execution+1))"""
    elif element.multiInstanceType == None:
        if "Time" in element.loopParameter.keys():
            time = element.loopParameter["Time"]
        else:
            time = 0
        if "Units" in element.loopParameter.keys():
            units = element.loopParameter["Units"]
        else:
            units = -1
        if "Percentage" in element.loopParameter.keys():
            percentage = 1 - element.loopParameter["Percentage"]/100
        else:
            percentage = 1
        functionStr = functionStr + f"""
    units = {units}
    loopStartTime = env.now
    initial = True
    execution = 0
    while ((env.now - loopStartTime < {time}) or ({time}==0)) and (units!=0) and (random.random() < {percentage}) or initial:
        execution = execution + 1
        initial = False
        yield env.process(executeTask(env, TaskName, caso, execution))
        units = units - 1"""
    functionStr = functionStr + f"""
    if TaskName in generatedData.keys():
        dataObjects = generatedData[TaskName]
        for dataObject in dataObjects:
            publish_data(dataObject, caso)
            simulationResults[caso].append(
f'''
        <container key="dataObjects">
            <string key="bpmn:id" value="{{xml_value(dataObject)}}"/>
            <string key="bpmn:name" value="{{xml_value(dataInfo[dataObject])}}"/>
            <date key="time:generationTime" value="{{xml_value(env.now)}}"/>
        </container>''')
    return {element.subTask!r}
"""
    return generateFunction(elements, element.subTask, script + functionStr)
