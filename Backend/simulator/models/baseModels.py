from typing import List, Dict

class BPMNElement:
    def __init__(self, name: str, id_bpmn: str, bpmn_type: str):
        self.name = name
        self.id_bpmn = id_bpmn
        self.bpmn_type = bpmn_type

class BPMNProcess(BPMNElement):
    def __init__(self, name: str, id_bpmn: str, bpmn_type: str, instances: int, frequency: int, userWithoutRole: List[str], userWithRole: Dict[str, List[str]]):
        super().__init__(name, id_bpmn, bpmn_type)
        self.instances = instances
        self.frequency = frequency
        self.userWithoutRole = userWithoutRole
        self.userWithRole = userWithRole

class BPMNCollaboration(BPMNElement):
    def __init__(self, name: str, id_bpmn: str, bpmn_type: str, instances: int):
        super().__init__(name, id_bpmn, bpmn_type)
        self.instances = instances

class BPMNParticipant(BPMNElement):
    def __init__(self, name: str, id_bpmn: str, bpmn_type: str, frequency: int, users: List[str], contained_elements: List[str]):
        super().__init__(name, id_bpmn, bpmn_type)
        self.frequency = frequency
        self.users = users
        self.contained_elements = contained_elements

class BPMNLane(BPMNElement):
    def __init__(self, name: str, id_bpmn: str, bpmn_type: str, users: List[str], contained_elements: List[str]):
        super().__init__(name, id_bpmn, bpmn_type)
        self.users = users
        self.contained_elements = contained_elements

class BPMNSequenceFlow(BPMNElement):
    def __init__(self, name: str, id_bpmn: str, bpmn_type: str, superElement: BPMNElement, subElement: BPMNElement, percentageOfBranches: float = None):
        super().__init__(name, id_bpmn, bpmn_type)
        self.superElement = superElement
        self.subElement = subElement
        self.percentageOfBranches = percentageOfBranches

class BPMNDataInputAssociation(BPMNElement):
    def __init__(self, name: str, id_bpmn: str, bpmn_type: str, superElement: BPMNElement, subElement: BPMNElement):
        super().__init__(name, id_bpmn, bpmn_type)
        self.superElement = superElement
        self.subElement = subElement

class BPMNDataOutputAssociation(BPMNElement):
    def __init__(self, name: str, id_bpmn: str, bpmn_type: str, superElement: BPMNElement, subElement: BPMNElement):
        super().__init__(name, id_bpmn, bpmn_type)
        self.superElement = superElement
        self.subElement = subElement

class BPMNMessageFlow(BPMNElement):
    def __init__(self, name: str, id_bpmn: str, bpmn_type: str, superElement: BPMNElement, subElement: BPMNElement):
        super().__init__(name, id_bpmn, bpmn_type)
        self.superElement = superElement
        self.subElement = subElement

class BPMNDataObjectReference(BPMNElement):
    def __init__(self, name: str, id_bpmn: str, bpmn_type: str):
        super().__init__(name, id_bpmn, bpmn_type)