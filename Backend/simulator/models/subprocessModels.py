from simulator.models.baseModels import BPMNElement

class BPMNSubProcess(BPMNElement):
    def __init__(self, name: str, id_bpmn: str, bpmn_type: str, subTask: BPMNElement):
        super().__init__(name, id_bpmn, bpmn_type)
        self.subTask = subTask

class BPMNTransaction(BPMNElement):
    def __init__(self, name: str, id_bpmn: str, bpmn_type: str, subTask: BPMNElement):
        super().__init__(name, id_bpmn, bpmn_type)
        self.subTask = subTask