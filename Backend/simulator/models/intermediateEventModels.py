from simulator.models.baseModels import BPMNElement

class BPMNIntermediateThrowEvent(BPMNElement):
    def __init__(self, name: str, id_bpmn: str, bpmn_type: str, subTask: BPMNElement):
        super().__init__(name, id_bpmn, bpmn_type)
        self.subTask = subTask

class BPMNMessageIntermediateCatchEvent(BPMNElement):
    def __init__(self, name: str, id_bpmn: str, bpmn_type: str, messageOrigin: str, subTask: BPMNElement):
        super().__init__(name, id_bpmn, bpmn_type)
        self.messageOrigin = messageOrigin
        self.subTask = subTask

class BPMNMessageIntermediateThrowEvent(BPMNElement):
    def __init__(self, name: str, id_bpmn: str, bpmn_type: str, messageDestiny: str, subTask: BPMNElement):
        super().__init__(name, id_bpmn, bpmn_type)
        self.messageDestiny = messageDestiny
        self.subTask = subTask

class BPMNTimerIntermediateCatchEvent(BPMNElement):
    def __init__(self, name: str, id_bpmn: str, bpmn_type: str, time: int, subTask: BPMNElement):
        super().__init__(name, id_bpmn, bpmn_type)
        self.time = time
        self.subTask = subTask

