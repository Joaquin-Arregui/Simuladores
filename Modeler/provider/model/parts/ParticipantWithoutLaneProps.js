import { html } from 'htm/preact';
import { useService } from 'bpmn-js-properties-panel';
import { TextFieldEntry } from '@bpmn-io/properties-panel';

import { PEOPLE_TYPES, peopleOf, setPeople } from '../../../lib/people/people.js';


export default function(element) {
  return [
    {
      id: 'frequency',
      element,
      component: frequencyFunction,
      isEdited: isNumberEntryEdited
    },
    {
      id: 'userWithoutRole',
      element,
      component: userWithoutRoleFunction,
      isEdited: isListOfStringEntryEdited
    }
  ];
}

function frequencyFunction(props) {
  const { element, id } = props;
  const modeling = useService('modeling');
  const translate = useService('translate');
  const debounce = useService('debounceInput');

  const getValue = () => {
    if (!element || !element.businessObject) return '';

    if (element.businessObject.participants) {
      const firstParticipant = element.businessObject.participants[0];
      if (firstParticipant.processRef) {
        const value = firstParticipant.processRef.frequency;
        return (typeof value !== 'undefined' && !isNaN(value)) ? value.toString() : '';
      } else {
        console.warn('processRef is missing for participant:', firstParticipant);
      }
    } else if (element.businessObject.frequency !== undefined) {
      const value = element.businessObject.frequency;

      return (typeof value !== 'undefined' && !isNaN(value)) ? value.toString() : '';
    }

    return '';
  };

  const setValue = (value) => {
    if (typeof value === 'undefined' || !element || !element.businessObject) {
      return;
    }

    const newValue = value.trim() === '' ? '' : parseInt(value, 10);
    if (isNaN(newValue)) return;

    if (element.businessObject.participants) {
      element.businessObject.participants.forEach(participant => {
        if (participant.processRef && typeof participant.processRef === 'object') {
          try {
            modeling.updateModdleProperties(element, participant.processRef, {
              frequency: newValue
            });
          } catch (error) {
            console.error('Failed to update properties for processRef:', error);
          }
        } else {
          console.warn('processRef is missing or invalid for participant:', participant);
        }
      });
    } else {
      modeling.updateProperties(element, {
        frequency: newValue
      });
    }
  };

  return html`<${TextFieldEntry}
    id=${id}
    element=${element}
    label=${translate('Frequency')}
    getValue=${getValue}
    setValue=${setValue}
    debounce=${debounce}
    tooltip=${translate('Enter the frequency')}
  />`;
}

function isNumberEntryEdited(element) {

  if (!element || !element.businessObject) {
    return '';
  }

  const nuValue = element.businessObject.numberOfExecutions;

  return nuValue;
}

function userWithoutRoleFunction(props) {
  const { element } = props;
  const modeling = useService('modeling');
  const moddle = useService('moddle');
  const translate = useService('translate');

  // La plantilla del pool, dentro de extensionElements (5.2).
  const getUserWithoutRoleList = () => {
    if (!element || !element.businessObject) {
      return [];
    }
    return peopleOf(element.businessObject, PEOPLE_TYPES.participant);
  };

  const setUserWithoutRoleList = (list) => {
    setPeople({ modeling, moddle }, element, element.businessObject, PEOPLE_TYPES.participant, list);
  };

  const updateUserWithoutRole = (index, value) => {
    const updatedUserWithoutRoleList = [ ...getUserWithoutRoleList() ];
    updatedUserWithoutRoleList[index] = value;
    setUserWithoutRoleList(updatedUserWithoutRoleList);
  };

  const removeUserWithoutRole = (index) => {
    const updatedUserWithoutRoleList = [ ...getUserWithoutRoleList() ];
    updatedUserWithoutRoleList.splice(index, 1);
    setUserWithoutRoleList(updatedUserWithoutRoleList);
  };

  const addUserWithoutRole = () => {
    setUserWithoutRoleList([ ...getUserWithoutRoleList(), '' ]);
  };

  const renderUserWithoutRoleEntries = () => {
    const userWithoutRoleList = getUserWithoutRoleList();
    return userWithoutRoleList.map((user, index) => {
      return html`
        <div class="user-task-item">
          <input 
            type="text" 
            value=${user} 
            onInput=${(event) => updateUserWithoutRole(index, event.target.value)} 
            placeholder="${translate('Enter a user name')}" 
            class="user-task-input"
          />
          <button 
            class="user-task-button" 
            onClick=${() => removeUserWithoutRole(index)}>
            ${translate('X')}
          </button>
        </div>
      `;
    });
  };

  return html`
    <div class="user-pool-container">
      ${renderUserWithoutRoleEntries()}
      <button 
        class="add-role-button" 
        onClick=${addUserWithoutRole}>
        ${translate('Add User without Role')}
      </button>
    </div>
  `;
}

function isListOfStringEntryEdited(element) {
  if (!element || !element.businessObject) {
    return false;
  }

  // Retornamos true si al menos un elemento en la lista no es un string vacío
  return peopleOf(element.businessObject, PEOPLE_TYPES.participant).some(value => value !== '');
}
