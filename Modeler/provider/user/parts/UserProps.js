import { h } from '@bpmn-io/properties-panel/preact';
import htm from 'htm';

import { useService } from 'bpmn-js-properties-panel';
import { TextFieldEntry, SelectEntry, isTextFieldEntryEdited } from '@bpmn-io/properties-panel';

import numberField from '../../model/parts/NumberField';
import { formatNumber } from '../../../lib/numbers/numbers.js';

import { PEOPLE_TYPES, peopleOf, setPeople } from '../../../lib/people/people.js';

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
      component: MinimumTimeEntry,
      isEdited: isTextFieldEntryEdited,
    },
    {
      id: 'maximumTime',
      element,
      component: MaximumTimeEntry,
      isEdited: isTextFieldEntryEdited,
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
  const moddle = useService('moddle');
  const translate = useService('translate');

  // Quien puede hacer la tarea -personas o roles-, dentro de extensionElements (5.2).
  const getUserTaskList = () => {
    if (!element || !element.businessObject) {
      return [];
    }
    return peopleOf(element.businessObject, PEOPLE_TYPES.task);
  };

  const setUserTaskList = (list) => {
    setPeople({ modeling, moddle }, element, element.businessObject, PEOPLE_TYPES.task, list);
  };

  // Actualiza el valor de una tarea en una posición específica
  const updateUserTask = (index, value) => {
    const updatedUserTaskList = [ ...getUserTaskList() ];
    updatedUserTaskList[index] = value;
    setUserTaskList(updatedUserTaskList);
  };

  // Elimina una tarea de la lista
  const removeUserTask = (index) => {
    const updatedUserTaskList = [ ...getUserTaskList() ];
    updatedUserTaskList.splice(index, 1);
    setUserTaskList(updatedUserTaskList);
  };

  // Agrega una nueva tarea vacía
  const addUserTask = () => {
    setUserTaskList([ ...getUserTaskList(), '' ]);
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

// Los tiempos de la tarea, en segundos, validados como los valida el Backend:
// un numero de 0 en adelante, con decimales, y el minimo no mayor que el
// maximo. Iguales valen -la tarea dura siempre lo mismo, como varias del
// proceso base-; sin maximo, las reglas llevan el minimo (lib/rules). Lo que no
// vale se marca en rojo y no se guarda, como en los demas campos numericos.
// Los decimales llegan tal cual a las reglas, pero el motor redondea cada
// duracion al segundo (1.2): con 2.5 y 2.5, la tarea dura 2 s.
const MinimumTimeEntry = numberField({
  property: 'minimumTime',
  label: 'Minimum time',
  description: 'Seconds; decimals allowed, but each duration is rounded to a whole second.',
  check: (bo, value, translate) => (typeof bo.maximumTime === 'number' && value > bo.maximumTime
    ? translate('Cannot be greater than Maximum time ({maximum}).', { maximum: formatNumber(bo.maximumTime) })
    : null)
});

const MaximumTimeEntry = numberField({
  property: 'maximumTime',
  label: 'Maximum time',
  description: 'Seconds. Empty: the same as the minimum.',
  check: (bo, value, translate) => (typeof bo.minimumTime === 'number' && value < bo.minimumTime
    ? translate('Cannot be less than Minimum time ({minimum}).', { minimum: formatNumber(bo.minimumTime) })
    : null)
});

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

  return peopleOf(element.businessObject, PEOPLE_TYPES.task).some(value => value !== '');
}

function isNumberEntryEdited(element) {
  if (!element || !element.businessObject) {
    return 0;
  }
  const nuValue = element.businessObject.numberOfExecutions;
  return (typeof nuValue !== 'undefined' && !isNaN(nuValue)) ? nuValue : 0;
}
