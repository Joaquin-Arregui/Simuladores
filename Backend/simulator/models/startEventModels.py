from simulator.models.baseModels import BPMNElement

class BPMNStartEvent(BPMNElement):
    def __init__(self, name: str, id_bpmn: str, bpmn_type: str, subTask: BPMNElement):
        super().__init__(name, id_bpmn, bpmn_type)
        self.subTask = subTask

class BPMNMessageStartEvent(BPMNElement):
    def __init__(self, name: str, id_bpmn: str, bpmn_type: str, messageOrigin: str, subTask: BPMNElement):
        super().__init__(name, id_bpmn, bpmn_type)
        self.subTask = subTask