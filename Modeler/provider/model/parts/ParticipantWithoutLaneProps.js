import { html } from 'htm/preact';
import { useService } from 'bpmn-js-properties-panel';
import { TextFieldEntry } from '@bpmn-io/properties-panel';


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
  const translate = useService('translate');

  const getUserWithoutRoleList = () => {
    if (!element || !element.businessObject) {
      return [];
    }

    // Asegurar que el valor sea un array
    const userWithoutRole = element.businessObject.userWithoutRole;
    return Array.isArray(userWithoutRole) ? userWithoutRole : (userWithoutRole ? [ userWithoutRole ] : []);
  };

  const updateUserWithoutRole = (index, value) => {
    const userWithoutRoleList = getUserWithoutRoleList();
    const updatedUserWithoutRoleList = [ ...userWithoutRoleList ];
    updatedUserWithoutRoleList[index] = value;

    modeling.updateProperties(element, {
      userWithoutRole: updatedUserWithoutRoleList
    });
    console.log(element.businessObject.userWithoutRole);
  };

  const removeUserWithoutRole = (index) => {
    const userWithoutRoleList = getUserWithoutRoleList();
    const updatedUserWithoutRoleList = [ ...userWithoutRoleList ];
    updatedUserWithoutRoleList.splice(index, 1);

    modeling.updateProperties(element, {
      userWithoutRole: updatedUserWithoutRoleList
    });
  };

  const addUserWithoutRole = () => {
    const userWithoutRoleList = getUserWithoutRoleList();
    const updatedUserWithoutRoleList = [ ...userWithoutRoleList, '' ];

    modeling.updateProperties(element, {
      userWithoutRole: updatedUserWithoutRoleList
    });
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

  const userWithoutRoleValues = element.businessObject.userWithoutRole;

  // Verificamos que userWithoutRole es un array
  if (!Array.isArray(userWithoutRoleValues)) {
    return false;
  }

  // Retornamos true si al menos un elemento en la lista no es un string vacío
  return userWithoutRoleValues.some(value => typeof value === 'string' && value !== '');
}
