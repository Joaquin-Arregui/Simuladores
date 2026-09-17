from simulator.models.baseModels import BPMNElement
from typing import Union

class BPMNEndEvent(BPMNElement):
    def __init__(self, name: str, id_bpmn: str, bpmn_type: str, subTask: Union[BPMNElement, None]):
        super().__init__(name, id_bpmn, bpmn_type)
        self.subTask = subTask