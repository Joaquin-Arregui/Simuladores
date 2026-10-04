def getPercentOfBranches(elements, gateway):
    possibleElements = {}
    none_elements = []
    for element in elements.values():
        if type(element).__name__ == "BPMNSequenceFlow" and element.superElement == gateway:
            if element.percentageOfBranches is None:
                possibleElements[element.id_bpmn] = None
                none_elements.append(element.id_bpmn)
            else:
                possibleElements[element.id_bpmn] = element.percentageOfBranches / 100
    total_assigned_percent = sum([v for v in possibleElements.values() if v is not None])
    remaining_percent = max(1 - total_assigned_percent, 0)
    if none_elements:
        equal_percent = remaining_percent / len(none_elements)
        for sub_element in none_elements:
            possibleElements[sub_element] = equal_percent
    return list(possibleElements.keys()), list(possibleElements.values())

def exclusiveGateway(elements, element, script):
    from simulator.simulationFunctions.generateFunction import generateFunction, function_name, xml_template
    possibleElements, percents = getPercentOfBranches(elements, element.id_bpmn)
    functionStr = f"""
def {function_name(element.id_bpmn)}(env, caso, contexto):
    selectedElement = random.choices({possibleElements}, {percents})[0]
    simulationResults[caso].append(
f'''
        <event>
            <string key="bpmn:type" value="{xml_template(element.bpmn_type)}"/>
            <string key="bpmn:name" value="{xml_template(element.name)}"/>
            <string key="bpmn:id" value="{xml_template(element.id_bpmn)}"/>
            <string key="bpmn:subTask" value="{{xml_value(sequenceFlows[selectedElement][1])}}"/>
            <string key="bpmn:selectedFlow" value="{{xml_value(selectedElement)}}"/>
            <date key="time:timestamp" value="{{xml_value(env.now)}}"/>
            <int key="bpmn:instance" value="{{xml_value(caso.indice)}}"/>
        </event>''')
    yield env.timeout(0)
    return selectedElement
    """
    extendedScript = script + functionStr
    for elem in possibleElements:
        extendedScript = generateFunction(elements, elements[elem].subElement, extendedScript)
    return extendedScript

def parallelGateway(elements, element, script):
    from simulator.simulationFunctions.generateFunction import generateFunction, function_name, xml_template
    possibleElements = [item.id_bpmn for item in elements.values()
                        if type(item).__name__ == 'BPMNSequenceFlow' and
                        item.superElement == element.id_bpmn]
    functionStr = f"""
def {function_name(element.id_bpmn)}(env, caso, contexto):
    strSelectedElements = ", ".join(sequenceFlows[edge][1] for edge in {possibleElements})
    simulationResults[caso].append(
f'''
        <event>
            <string key="bpmn:type" value="{xml_template(element.bpmn_type)}"/>
            <string key="bpmn:name" value="{xml_template(element.name)}"/>
            <string key="bpmn:id" value="{xml_template(element.id_bpmn)}"/>
            <string key="bpmn:subTask" value="{{xml_value(strSelectedElements)}}"/>
            <string key="bpmn:selectedFlow" value="{xml_template(', '.join(possibleElements))}"/>
            <date key="time:timestamp" value="{{xml_value(env.now)}}"/>
            <int key="bpmn:instance" value="{{xml_value(caso.indice)}}"/>
        </event>''')
    yield env.timeout(0)
    return {possibleElements}
    """
    extendedScript = script + functionStr
    for elem in possibleElements:
        extendedScript = generateFunction(elements, elements[elem].subElement, extendedScript)
    return extendedScript

def inclusiveGateway(elements, element, script):
    from simulator.simulationFunctions.generateFunction import generateFunction, function_name, xml_template
    possibleElements, percents = getPercentOfBranches(elements, element.id_bpmn)
    functionStr = f"""
def {function_name(element.id_bpmn)}(env, caso, contexto):
    elements = {possibleElements}
    percents = {percents}
    selectedElements = [element for element, percent in zip(elements, percents) if random.random() < percent]
    if not selectedElements:
        selectedElements = random.choices(elements, weights=percents, k=1)
    simulationResults[caso].append(
f'''
        <event>
            <string key="bpmn:type" value="{xml_template(element.bpmn_type)}"/>
            <string key="bpmn:name" value="{xml_template(element.name)}"/>
            <string key="bpmn:id" value="{xml_template(element.id_bpmn)}"/>
            <string key="bpmn:subTask" value="{{xml_value([sequenceFlows[edge][1] for edge in selectedElements])}}"/>
            <string key="bpmn:selectedFlow" value="{{xml_value(', '.join(selectedElements))}}"/>
            <date key="time:timestamp" value="{{xml_value(env.now)}}"/>
            <int key="bpmn:instance" value="{{xml_value(caso.indice)}}"/>
        </event>''')
    yield env.timeout(0)
    return selectedElements
    """
    extendedScript = script + functionStr
    for elem in possibleElements:
        extendedScript = generateFunction(elements, elements[elem].subElement, extendedScript)
    return extendedScript
