import { html } from 'htm/preact';
import { useService } from 'bpmn-js-properties-panel';
import { TextFieldEntry } from '@bpmn-io/properties-panel';

export default function(element) {
  return [
    {
      id: 'instance',
      element,
      component: instanceFunction,
      isEdited: isNumberEntryEdited
    }
  ];
}

function instanceFunction(props) {
  const { element, id } = props;
  const modeling = useService('modeling');
  const translate = useService('translate');
  const debounce = useService('debounceInput');

  const getValue = () => {
    if (!element || !element.businessObject) {
      return '';
    }
    const value = element.businessObject.instance;
    return typeof value === 'string' ? value : '';
  };

  const setValue = (value) => {
    if (!element || !element.businessObject) {
      return;
    }
    modeling.updateModdleProperties(element, element.businessObject, {
      instance: value.trim() !== '' ? value : undefined
    });
  };

  return html`<${TextFieldEntry}
    id=${id}
    element=${element}
    label=${translate('Number of instances')}
    getValue=${getValue}
    setValue=${setValue}
    debounce=${debounce}
    tooltip=${translate('Enter the number of different instances.')} 
  />`;
}

function isNumberEntryEdited(element) {
  if (!element || !element.businessObject) return '';
  return element.businessObject.numberOfExecutions;
}
