import { h } from '@bpmn-io/properties-panel/preact';
import { useEffect } from '@bpmn-io/properties-panel/preact/hooks';
import htm from 'htm';

import { useService } from 'bpmn-js-properties-panel';
import { TextFieldEntry, SelectEntry } from '@bpmn-io/properties-panel';

const html = htm.bind(h);

export default function(element) {
  const loopParameterValue =
    element.businessObject.loopParameter || '<none>';
  return [
    {
      id: 'UserTask',
      element,
      component: UserFunction,
      isEdited: isListOfStringEntryEdited,
    },
    {
      id: 'NumberOfExecutions',
      element,
      component:
        element.businessObject.loopCharacteristics &&
        typeof element.businessObject.loopCharacteristics.isSequential !== 'undefined'
          ? NumberOfExecutionsFunction
          : undefined,
      isEdited: isNumberEntryEdited,
    },
    {
      id: 'minimumTime',
      element,
      component: minimumTimeFunction,
      isEdited: isNumberEntryEdited,
    },
    {
      id: 'maximumTime',
      element,
      component: maximumTimeFunction,
      isEdited: isNumberEntryEdited,
    },
    {
      id: 'loopParameter',
      element,
      component: element.businessObject.loopCharacteristics &&
      typeof element.businessObject.loopCharacteristics.isSequential === 'undefined'
        ? SelectOptionFunction
        : undefined,
      isEdited: isSelectEntryEdited,
    },
    ...(loopParameterValue !== '<none>'
      ? [
        {
          id: 'AdditionalIntegerParameter',
          element,
          component: element.businessObject.loopCharacteristics &&
            typeof element.businessObject.loopCharacteristics.isSequential === 'undefined'
            ? IntegerParameterEntry
            : undefined ,
          isEdited: isNumberEntryEdited,
        },
      ]
      : []),
  ];
}

// UserTask
function UserFunction(props) {
  const { element } = props;
  const modeling = useService('modeling');
  const translate = useService('translate');

  const getUserTaskList = () => {
    if (!element || !element.businessObject) {
      return [];
    }

    // Asegurar que UserTask es un array
    const userTask = element.businessObject.UserTask;
    return Array.isArray(userTask) ? userTask : (userTask ? [ userTask ] : []);
  };


  // Actualiza el valor de una tarea en una posición específica
  const updateUserTask = (index, value) => {
    const userTaskList = getUserTaskList();
    const updatedUserTaskList = [ ...userTaskList ];
    updatedUserTaskList[index] = value;

    modeling.updateProperties(element, {
      UserTask: updatedUserTaskList
    });
  };

  // Elimina una tarea de la lista
  const removeUserTask = (index) => {
    const userTaskList = getUserTaskList();
    const updatedUserTaskList = [ ...userTaskList ];
    updatedUserTaskList.splice(index, 1);

    modeling.updateProperties(element, {
      UserTask: updatedUserTaskList
    });
  };

  // Agrega una nueva tarea vacía
  const addUserTask = () => {
    const userTaskList = getUserTaskList();
    const updatedUserTaskList = [ ...userTaskList, '' ];

    modeling.updateProperties(element, {
      UserTask: updatedUserTaskList
    });
  };

  // Renderiza las entradas individuales para las tareas
  const renderUserTaskEntries = () => {
    const userTaskList = getUserTaskList();
    return userTaskList.map((task, index) => {
      return html`
        <div class="user-task-item">
          <input 
            type="text" 
            value=${task} 
            onInput=${(event) => updateUserTask(index, event.target.value)} 
            placeholder="${translate('Enter a task name')}" 
            class="user-task-input"
          />
          <button 
            class="user-task-button" 
            onClick=${() => removeUserTask(index)}>
            ${translate('X')}
          </button>
        </div>
      `;
    });
  };

  // Renderiza el contenedor principal
  return html`
    <div class="user-pool-container">
      ${renderUserTaskEntries()}
      <button 
        class="add-role-button" 
        onClick=${addUserTask}>
        ${translate('Add User Task')}
      </button>
    </div>
  `;
}

function NumberOfExecutionsFunction(props) {
  const { element, id } = props;
  const modeling = useService('modeling');
  const translate = useService('translate');
  const debounce = useService('debounceInput');
  const elementRegistry = useService('elementRegistry');

  const getValue = () => {
    if (!element || !element.businessObject) {
      return '';
    }

    // Check if loop is active
    const loopActive = element.businessObject.loopCharacteristics.isSequential;
    if (loopActive === 'undefined') {
      return '1';
    }

    const value = element.businessObject.NumberOfExecutions;
    return (typeof value !== 'undefined' && !isNaN(value)) ? value.toString() : '';
  };

  const setValue = value => {
    if (typeof value === 'undefined') {
      return;
    }

    if (!element || !element.businessObject) {
      return;
    }

    // Prevent modification if loop is active
    const loopActive = element.businessObject.loopCharacteristics.isSequential;
    if (loopActive === 'undefined') {
      modeling.updateProperties(element, {
        NumberOfExecutions: 1
      });
      return;
    }

    if (value.trim() === '') {
      modeling.updateProperties(element, {
        NumberOfExecutions: ''
      });
      return;
    }

    const newValue = parseInt(value, 10);
    if (isNaN(newValue)) {
      return;
    }

    modeling.updateProperties(element, {
      NumberOfExecutions: newValue
    });

    const bo = element.businessObject;
    const isSendOrReceive = bo.$type === 'bpmn:SendTask' || bo.$type === 'bpmn:ReceiveTask';
    if (!isSendOrReceive) {
      return;
    }

    const definitions = bo.$parent.$parent;

    const collaboration = definitions.rootElements.find(e => e.$type === 'bpmn:Collaboration');
    if (!collaboration || !collaboration.messageFlows) {
      return;
    }

    const relatedFlow = collaboration.messageFlows.find(flow =>
      (flow.sourceRef === bo || flow.targetRef === bo)
    );
    if (!relatedFlow) {
      return;
    }

    const otherSide = (relatedFlow.sourceRef === bo)
      ? relatedFlow.targetRef
      : relatedFlow.sourceRef;

    const otherIsSendOrReceive =
      otherSide.$type === 'bpmn:SendTask' ||
      otherSide.$type === 'bpmn:ReceiveTask';

    if (!otherIsSendOrReceive) {
      return;
    }

    const otherElement = elementRegistry.get(otherSide.id);
    if (!otherElement) {
      return;
    }

    modeling.updateProperties(otherElement, {
      NumberOfExecutions: newValue
    });
  };

  return html`<${TextFieldEntry}
    id=${id}
    element=${element}
    label=${translate('Number of executions')}
    getValue=${getValue}
    setValue=${setValue}
    debounce=${debounce}
    tooltip=${translate('Enter the number of different executions.')} 
  />`;
}

function maximumTimeFunction(props) {
  const { element, id } = props;
  const modeling = useService('modeling');
  const translate = useService('translate');
  const debounce = useService('debounceInput');

  const getValue = () => {
    if (!element || !element.businessObject) {
      return '';
    }
    const value = element.businessObject.maximumTime;
    return (value !== undefined && !isNaN(value)) ? value.toString() : '';
  };

  const setValue = value => {
    const safeValue = value || '';
    if (!element || !element.businessObject) {
      return;
    }

    let valueToSave;
    const newValue = parseFloat(safeValue);

    if (safeValue.trim() === '') {
      valueToSave = undefined;
    } else if (isNaN(newValue)) {
      return;
    } else {
      valueToSave = newValue;
    }

    modeling.updateProperties(element, {
      maximumTime: valueToSave
    });
  };

  const validate = (value) => {
    const safeValue = value || '';
    if (safeValue.trim() === '') {
      return null;
    }

    const newValue = parseFloat(safeValue);

    if (isNaN(newValue)) {
      return translate('Must be a valid number.');
    }
    if (newValue < 0) {
      return translate('Time cannot be negative.');
    }

    const minimumTime = parseFloat(element.businessObject.minimumTime);
    if (!isNaN(minimumTime) && newValue <= minimumTime) {
      return translate('Must be greater than Minimum time.');
    }
    return null;
  };

  useEffect(() => {
    return () => {
      const minValue = parseFloat(element.businessObject.minimumTime);
      const maxValue = parseFloat(element.businessObject.maximumTime);

      if (!isNaN(minValue) && !isNaN(maxValue)) {
        if (minValue >= maxValue) {
          alert(translate('Maximum time must be greater than Minimum time.'));
        }
      }
    };
  }, [ element, translate ]);

  return html`<${TextFieldEntry}
    id=${id}
    element=${element}
    label=${translate('Maximum time')}
    getValue=${getValue}
    setValue=${setValue}
    debounce=${debounce}
    validate=${validate}
    tooltip=${translate('Enter the maximum time.')} 
  />`;
}

function minimumTimeFunction(props) {
  const { element, id } = props;
  const modeling = useService('modeling');
  const translate = useService('translate');
  const debounce = useService('debounceInput');

  const getValue = () => {
    if (!element || !element.businessObject) {
      return '';
    }
    const value = element.businessObject.minimumTime;
    return (value !== undefined && !isNaN(value)) ? value.toString() : '';
  };

  const setValue = value => {
    const safeValue = value || '';
    if (!element || !element.businessObject) {
      return;
    }

    let valueToSave;
    const newValue = parseFloat(safeValue);

    if (safeValue.trim() === '') {
      valueToSave = undefined;
    } else if (isNaN(newValue)) {
      return;
    } else {
      valueToSave = newValue;
    }

    modeling.updateProperties(element, {
      minimumTime: valueToSave
    });
  };

  const validate = (value) => {
    const safeValue = value || '';
    if (safeValue.trim() === '') {
      return null;
    }

    const newValue = parseFloat(safeValue);

    if (isNaN(newValue)) {
      return translate('Must be a valid number.');
    }
    if (newValue < 0) {
      return translate('Time cannot be negative.');
    }

    const maximumTime = parseFloat(element.businessObject.maximumTime);
    if (!isNaN(maximumTime) && newValue >= maximumTime) {
      return translate('Must be less than Maximum time.');
    }
    return null;
  };

  useEffect(() => {
    return () => {
      const minValue = parseFloat(element.businessObject.minimumTime);
      const maxValue = parseFloat(element.businessObject.maximumTime);

      if (!isNaN(minValue) && !isNaN(maxValue)) {
        if (minValue >= maxValue) {
          alert(translate('Minimum time must be less than Maximum time.'));
        }
      }
    };
  }, [ element, translate ]);

  return html`<${TextFieldEntry}
    id=${id}
    element=${element}
    label=${translate('Minimum time')}
    getValue=${getValue}
    setValue=${setValue}
    debounce=${debounce}
    validate=${validate}
    tooltip=${translate('Enter the minimum time.')} 
  />`;
}

function SelectOptionFunction(props) {
  const { element, id } = props;

  const modeling = useService('modeling');
  const translate = useService('translate');
  const elementRegistry = useService('elementRegistry');

  const getValue = () => {
    if (!element || !element.businessObject) {
      return '<none>';
    }
    return element.businessObject.loopParameter || '<none>';
  };

  const synchronizeTasks = (value) => {
    const bo = element.businessObject;

    const isSendOrReceive = bo.$type === 'bpmn:SendTask' || bo.$type === 'bpmn:ReceiveTask';
    if (!isSendOrReceive) {
      return;
    }

    const definitions = bo.$parent.$parent;

    const collaboration = definitions.rootElements.find(e => e.$type === 'bpmn:Collaboration');
    if (!collaboration || !collaboration.messageFlows) {
      return;
    }

    const relatedFlow = collaboration.messageFlows.find(flow =>
      flow.sourceRef === bo || flow.targetRef === bo
    );
    if (!relatedFlow) {
      return;
    }

    const otherSide = relatedFlow.sourceRef === bo
      ? relatedFlow.targetRef
      : relatedFlow.sourceRef;

    const otherIsSendOrReceive =
      otherSide.$type === 'bpmn:SendTask' || otherSide.$type === 'bpmn:ReceiveTask';
    if (!otherIsSendOrReceive) {
      return;
    }

    const otherElement = elementRegistry.get(otherSide.id);
    if (!otherElement) {
      return;
    }

    modeling.updateProperties(otherElement, {
      loopParameter: value,
    });
  };

  const setValue = (value) => {
    if (!element || !element.businessObject) {
      return;
    }

    modeling.updateProperties(element, {
      loopParameter: value,
    });

    synchronizeTasks(value);
  };

  const getOptions = () => [
    { value: '<none>', label: translate('<none>') },
    { value: 'Time', label: translate('Time') },
    { value: 'Units', label: translate('Units') },
    { value: 'Percentage', label: translate('Percentage') },
  ];

  return html`
    <div>
      <${SelectEntry}
        id=${id}
        element=${element}
        label=${translate('Select an option')}
        getValue=${getValue}
        setValue=${setValue}
        getOptions=${getOptions}
      />
    </div>
  `;
}

function IntegerParameterEntry(props) {
  const { element, id } = props;

  const modeling = useService('modeling');
  const translate = useService('translate');
  const elementRegistry = useService('elementRegistry');

  const getValue = () => {
    if (!element || !element.businessObject) {
      return '';
    }
    return element.businessObject.AdditionalIntegerParameter || '';
  };

  const synchronizeAdditionalIntegerParameter = (value) => {
    const bo = element.businessObject;

    const isSendOrReceive = bo.$type === 'bpmn:SendTask' || bo.$type === 'bpmn:ReceiveTask';
    if (!isSendOrReceive) {
      return;
    }

    const definitions = bo.$parent.$parent;

    const collaboration = definitions.rootElements.find(e => e.$type === 'bpmn:Collaboration');
    if (!collaboration || !collaboration.messageFlows) {
      return;
    }

    const relatedFlow = collaboration.messageFlows.find(flow =>
      flow.sourceRef === bo || flow.targetRef === bo
    );
    if (!relatedFlow) {
      return;
    }

    const otherSide = relatedFlow.sourceRef === bo
      ? relatedFlow.targetRef
      : relatedFlow.sourceRef;

    const otherIsSendOrReceive =
      otherSide.$type === 'bpmn:SendTask' || otherSide.$type === 'bpmn:ReceiveTask';
    if (!otherIsSendOrReceive) {
      return;
    }

    const otherElement = elementRegistry.get(otherSide.id);
    if (!otherElement) {
      return;
    }

    modeling.updateProperties(otherElement, {
      AdditionalIntegerParameter: value,
    });
  };

  const setValue = (value) => {
    if (!element || !element.businessObject) {
      return;
    }

    const parsedValue = parseInt(value, 10);
    if (isNaN(parsedValue) || parsedValue < 0) {
      alert('Please enter a valid positive integer.');
      return;
    }

    modeling.updateProperties(element, {
      AdditionalIntegerParameter: parsedValue,
    });

    synchronizeAdditionalIntegerParameter(parsedValue);
  };

  return html`<${TextFieldEntry}
    id=${id}
    element=${element}
    label=${translate('Additional Integer Parameter')}
    getValue=${getValue}
    setValue=${setValue}
    debounce=${useService('debounceInput')}
    tooltip=${translate('Enter a positive integer value to synchronize.')}
  />`;
}

function isSelectEntryEdited(element) {
  if (!element || !element.businessObject) {
    return false;
  }
  const selectOption = element.businessObject.SelectOption;
  return typeof selectOption === 'string' && selectOption !== 'default';
}

function isListOfStringEntryEdited(element) {
  if (!element || !element.businessObject) {
    return false;
  }

  const userTaskValues = element.businessObject.UserTask;

  if (!Array.isArray(userTaskValues)) {
    return false;
  }

  return userTaskValues.some(value => typeof value === 'string' && value !== '');
}

function isNumberEntryEdited(element) {
  if (!element || !element.businessObject) {
    return 0;
  }
  const nuValue = element.businessObject.numberOfExecutions;
  return (typeof nuValue !== 'undefined' && !isNaN(nuValue)) ? nuValue : 0;
}
