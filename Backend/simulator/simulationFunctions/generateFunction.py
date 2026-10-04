from html import escape

from simulator.simulationFunctions.events import intermediateThrowEvent, messageIntermediateCatchEvent, messageIntermediateThrowEvent, timerIntermediateCatchEvent, endEvent
from simulator.simulationFunctions.gateways import exclusiveGateway, parallelGateway, inclusiveGateway
from simulator.simulationFunctions.generalTask import generalTask
from simulator.simulationFunctions.receiveTask import receiveTask
from simulator.simulationFunctions.sendTask import sendTask

GENERAL_TASKS = {
    "BPMNTask",
    "BPMNUserTask",
    "BPMNManualTask",
    "BPMNBusinessRuleTask",
    "BPMNScriptTask",
    "BPMNServiceTask",
    "BPMNCallActivity",
}

SPECIFIC_HANDLERS = {
    "BPMNExclusiveGateway":                 exclusiveGateway,
    "BPMNParallelGateway":                  parallelGateway,
    "BPMNInclusiveGateway":                 inclusiveGateway,
    "BPMNSendTask":                         sendTask,
    "BPMNReceiveTask":                      receiveTask,
    "BPMNIntermediateThrowEvent":           intermediateThrowEvent,
    "BPMNMessageIntermediateCatchEvent":    messageIntermediateCatchEvent,
    "BPMNMessageIntermediateThrowEvent":    messageIntermediateThrowEvent,
    "BPMNTimerIntermediateCatchEvent":      timerIntermediateCatchEvent,
    "BPMNEndEvent":                         endEvent,
}

def function_name(element_id):
    return 'node_' + element_id.encode('utf-8').hex()


def xml_template(value):
    # XML attribute escaping first, then literal escaping for the generated
    # f-string. Labels containing braces, apostrophes or ampersands stay data.
    return escape(str(value), quote=True).replace('\\', '\\\\').replace('{', '{{').replace('}', '}}')


def generateFunction(elements, element_id, script=''):
    # Functions precede their successors. An existing definition closes a cycle
    # or shared path without recursing forever or emitting duplicate functions.
    # Se busca el nombre y el parentesis, nunca la firma: la firma ya cambio una
    # vez —la 2.5 anadio el contexto del token— y entonces esta comprobacion dejo
    # de reconocer nada, de modo que un ciclo de flujos hacia recursion infinita
    # hasta el RecursionError. El nombre viene de function_name, que es unico.
    if f'def {function_name(element_id)}(' in script:
        return script
    element = elements[element_id]
    element_type = type(element).__name__
    if element_type in GENERAL_TASKS:
        handler = generalTask
    else:
        handler = SPECIFIC_HANDLERS.get(element_type)
    if handler is None:
        raise ValueError(f'Elemento BPMN no soportado: {element.bpmn_type} ({element_id}).')
    return handler(elements, element, script)
