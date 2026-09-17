from simulator.models.baseModels import BPMNElement
from typing import List

class BPMNExclusiveGateway(BPMNElement):
    def __init__(self, name: str, id_bpmn: str, bpmn_type: str, subTask: List[BPMNElement]):
        super().__init__(name, id_bpmn, bpmn_type)
        self.subTask = subTask

class BPMNParallelGateway(BPMNElement):
    def __init__(self, name: str, id_bpmn: str, bpmn_type: str, subTask: List[BPMNElement]):
        super().__init__(name, id_bpmn, bpmn_type)
        self.subTask = subTask

class BPMNInclusiveGateway(BPMNElement):
    def __init__(self, name: str, id_bpmn: str, bpmn_type: str, subTask: List[BPMNElement]):
        super().__init__(name, id_bpmn, bpmn_type)
        self.subTask = subTask