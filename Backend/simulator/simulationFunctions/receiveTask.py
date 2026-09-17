def receiveTask(elements, element, script):
    from simulator.simulationFunctions.generateFunction import generateFunction, function_name, xml_template
    functionStr = f"""
def {function_name(element.id_bpmn)}(env, name):
    def executeTask(env, TaskName, name, execution):
        start_standby_message = env.now
        yield env.process(wait_for_message(env, {element.messageOrigin!r}, TaskName, execution, name))
        end_standby_message = env.now
        duration_standby_message = end_standby_message - start_standby_message
        if duration_standby_message > 0:
            simulationResults[name].append(
f'''
        <event>
            <string key="bpmn:type" value="StandByMessage"/>
            <string key="bpmn:id" value="{{xml_value(TaskName)}}"/>
            <string key="bpmn:execution" value="{{xml_value(execution)}}"/>
            <date key="time:timestamp" value="{{xml_value(start_standby_message)}}"/>
            <date key="time:endTime" value="{{xml_value(end_standby_message)}}"/>
            <date key="time:duration" value="{{xml_value(duration_standby_message)}}"/>
            <int key="bpmn:instance" value="{{xml_value(name.split()[-1])}}"/>
        </event>''')
        start_standBy = env.now
        possibleUsers = {element.userTask}
        if possibleUsers is None:
            possibleUsers = userPool
        possibleUsers = resolve_possible_users(possibleUsers, TaskName)
        available_users = [user for user in possibleUsers if user_resources[user].count < user_resources[user].capacity]
        while not available_users:
            yield env.timeout(1)
            available_users = [user for user in possibleUsers if user_resources[user].count < user_resources[user].capacity]
        if available_users:
            userTask = min(available_users, key=lambda u: user_assignments[u])
            user_assignments[userTask] += 1
            request = user_resources[userTask].request()
            yield request
            try:
                time = resolve_task_time({element.id_bpmn!r}, {element.maximumTime}, {element.minimumTime}, userTask)
                if env.now > start_standBy: 
                    simulationResults[name].append(
f'''
        <event>
            <string key="bpmn:type" value="StandBy"/>
            <string key="bpmn:id" value="{{xml_value(TaskName)}}"/>
            <string key="bpmn:execution" value="{{xml_value(execution)}}"/>
            <date key="time:timestamp" value="{{xml_value(start_standBy)}}"/>
            <date key="time:endTime" value="{{xml_value(env.now)}}"/>
            <date key="time:duration" value="{{xml_value(env.now-start_standBy)}}"/>
            <int key="bpmn:instance" value="{{xml_value(name.split()[-1])}}"/>
        </event>''')
                simulationResults[name].append(
f'''
        <event>
            <string key="bpmn:type" value="{xml_template(element.bpmn_type)}"/>
            <string key="bpmn:name" value="{xml_template(element.name)}"/>
            <string key="bpmn:id" value="{{xml_value(TaskName)}}"/>
            <string key="bpmn:messageOrigin" value="{xml_template(element.messageOrigin)}"/>
            <string key="bpmn:userTask" value="{{xml_value(userTask)}}"/>
            <int key="bpmn:execution" value="{{xml_value(execution)}}"/>
            <int key="bpmn:time" value="{{xml_value(time)}}"/>
            <string key="bpmn:subTask" value="{xml_template(element.subTask)}"/>
            <date key="time:timestamp" value="{{xml_value(env.now)}}"/>
            <int key="bpmn:instance" value="{{xml_value(name.split()[-1])}}"/>
        </event>''')
                yield env.timeout(time)
            finally:
                user_resources[userTask].release(request)
    TaskName = {element.id_bpmn!r}
    if TaskName in requiredData.keys():
        dataObjects = requiredData[TaskName]
        start_standBy_data = env.now
        yield env.process(wait_for_data(env, dataObjects, name))
        if env.now > start_standBy_data:
            simulationResults[name].append(
f'''
        <event>
            <string key="bpmn:type" value="StandByData"/>
            <string key="bpmn:id" value="{{xml_value(TaskName)}}"/>
            <date key="time:timestamp" value="{{xml_value(start_standBy_data)}}"/>
            <date key="time:endTime" value="{{xml_value(env.now)}}"/>
            <date key="time:duration" value="{{xml_value(env.now-start_standBy_data)}}"/>
            <int key="bpmn:instance" value="{{xml_value(name.split()[-1])}}"/>
        </event>''')"""
    if element.multiInstanceType == True or (element.multiInstanceType == None and element.loopParameter == None):
        functionStr = functionStr + f"""
    for execution in range({element.numberOfExecutions}):
        yield env.process(executeTask(env, TaskName, name, execution+1))"""
    elif element.multiInstanceType == False:
        functionStr = functionStr + f"""
    executionProcesses = []
    for execution in range({element.numberOfExecutions}):
        executionProcesses.append(env.process(executeTask(env, TaskName, name, execution+1)))
    yield simpy.AllOf(env, executionProcesses)"""
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
        yield env.process(executeTask(env, TaskName, name, execution))
        units = units - 1"""
    functionStr = functionStr + f"""
    if TaskName in generatedData.keys():
        dataObjects = generatedData[TaskName]
        for dataObject in dataObjects:
            publish_data(dataObject, name)
            simulationResults[name].append(
f'''
        <container key="dataObjects">
            <string key="bpmn:id" value="{{xml_value(dataObject)}}"/>
            <string key="bpmn:name" value="{{xml_value(dataInfo[dataObject])}}"/>
            <date key="time:generationTime" value="{{xml_value(env.now)}}"/>
        </container>''')
    return {element.subTask!r}
"""
    return generateFunction(elements, element.subTask, script + functionStr)
