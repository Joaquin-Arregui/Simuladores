import { html } from 'htm/preact';
import { useService } from 'bpmn-js-properties-panel';
import { TextFieldEntry } from '@bpmn-io/properties-panel';

import { PEOPLE_TYPES, entriesOf, peopleOf, setEntries, setPeople } from '../../../lib/people/people.js';


export default function(element) {
  return [
    {
      id: 'userWithoutRole',
      element,
      component: userWithoutRoleFunction,
      isEdited: isListOfStringEntryEdited
    },
    {
      id: 'userWithRole',
      element,
      component: userWithRoleFunction,
      isEdited: isRoleListEntryEdited
    },
    {
      id: 'instance',
      element,
      component: instanceFunction,
      isEdited: isNumberEntryEdited
    },
    {
      id: 'frequency',
      element,
      component: frequencyFunction,
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
    if (!element || !element.businessObject) return '';

    // Acceder al valor en processRef de cada participante
    if (element.businessObject.participants) {
      const firstParticipant = element.businessObject.participants[0];
      if (firstParticipant.processRef) {
        const value = firstParticipant.processRef.instance;
        return (typeof value !== 'undefined' && !isNaN(value)) ? value.toString() : '';
      } else {
        console.warn('processRef is missing for participant:', firstParticipant);
      }
    } else if (element.businessObject.instance !== undefined) {
      const value = element.businessObject.instance;
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

    // Si el elemento es Collaboration, verifica cada participant y su processRef
    if (element.businessObject.participants) {
      element.businessObject.participants.forEach(participant => {
        if (participant.processRef && typeof participant.processRef === 'object') {
          try {
            modeling.updateModdleProperties(element, participant.processRef, {
              instance: newValue
            });
          } catch (error) {
            console.error('Failed to update properties for processRef:', error);
          }
        } else {
          console.warn('processRef is missing or invalid for participant:', participant);
        }
      });
    } else {

      // Actualización directa si no es un Collaboration
      modeling.updateProperties(element, {
        instance: newValue
      });
    }
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

function frequencyFunction(props) {
  const { element, id } = props;
  const modeling = useService('modeling');
  const translate = useService('translate');
  const debounce = useService('debounceInput');

  const getValue = () => {
    if (!element || !element.businessObject) return '';

    // Acceder al valor en processRef de cada participante
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

    // Si el elemento es Collaboration, verifica cada participant y su processRef
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

      // Actualización directa si no es un Collaboration
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

function userWithoutRoleFunction(props) {
  const { element } = props;
  const modeling = useService('modeling');
  const moddle = useService('moddle');
  const translate = useService('translate');

  // Las personas sin rol del proceso, dentro de extensionElements (5.2).
  const getUserWithoutRoleList = () => {
    if (!element || !element.businessObject) {
      return [];
    }
    return peopleOf(element.businessObject, PEOPLE_TYPES.process);
  };

  const setUserWithoutRoleList = (list) => {
    setPeople({ modeling, moddle }, element, element.businessObject, PEOPLE_TYPES.process, list);
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

function userWithRoleFunction(props) {
  const { element } = props;
  const modeling = useService('modeling');
  const translate = useService('translate');
  const moddle = useService('moddle'); // <--- Importante

  // Los roles del proceso, model:KeyValuePair dentro de extensionElements (5.2).
  const getuserWithRole = () => {
    if (!element || !element.businessObject) return [];

    if (element.businessObject.participants) {
      const firstParticipant = element.businessObject.participants[0];
      if (firstParticipant?.processRef) {
        return entriesOf(firstParticipant.processRef, PEOPLE_TYPES.roles);
      }
    }

    return entriesOf(element.businessObject, PEOPLE_TYPES.roles);
  };

  const setuserWithRole = (updatedArray) => {

    // Collaboration: cada proceso con sus propias entradas, que una entrada
    // solo puede colgar de un extensionElements.
    if (element.businessObject.participants) {
      element.businessObject.participants.forEach(participant => {
        if (participant.processRef) {
          const copies = updatedArray.map(pair => moddle.create(PEOPLE_TYPES.roles, { key: pair.key, value: pair.value }));
          setEntries({ modeling, moddle }, element, participant.processRef, PEOPLE_TYPES.roles, copies);
        }
      });
    } else {
      setEntries({ modeling, moddle }, element, element.businessObject, PEOPLE_TYPES.roles, updatedArray);
    }
  };

  // Añadir un nuevo KeyValuePair
  const addRole = () => {
    const current = getuserWithRole();

    // Crear la instancia con moddle
    const newKeyValuePair = moddle.create('model:KeyValuePair', {
      key: `role${current.length + 1}`,
      value: ''
    });

    // Agregamos la instancia al array
    const updated = [ ...current, newKeyValuePair ];
    setuserWithRole(updated);
  };

  // Cambiar la key
  const setRoleName = (index, newKey) => {
    const current = getuserWithRole();
    const updated = [ ...current ];

    // OJO: updated[index] ya debería ser un KeyValuePair moddle
    updated[index] = moddle.create('model:KeyValuePair', {
      key: newKey,
      value: updated[index].value
    });
    setuserWithRole(updated);
  };

  // Cambiar el value
  const setRoleValue = (index, newValue) => {
    const current = getuserWithRole();
    const updated = [ ...current ];

    // Igual, recreamos el KeyValuePair con la nueva value
    updated[index] = moddle.create('model:KeyValuePair', {
      key: updated[index].key,
      value: newValue
    });
    setuserWithRole(updated);
  };

  const removeRole = (index) => {
    const current = getuserWithRole();
    const updated = [ ...current ];
    updated.splice(index, 1);
    setuserWithRole(updated);
  };

  const renderuserWithRoleEntries = () => {
    const arr = getuserWithRole();
    return arr.map((pair, index) => {
      return html`
        <div class="user-pool-item">
          <input 
            type="text" 
            value=${pair.key || ''} 
            onInput=${(event) => setRoleName(index, event.target.value)} 
            placeholder="Role name"
            style="margin-right: 10px;"
          />
          <input 
            type="text" 
            value=${pair.value || ''} 
            onInput=${(event) => setRoleValue(index, event.target.value)} 
            placeholder="User name"
          />
          <button 
            class="remove-role-button"
            onClick=${() => removeRole(index)}
            style="margin-left: 10px; background-color: red; color: white;">
            ${translate('X')}
          </button>
        </div>
      `;
    });
  };

  return html`
    <div class="user-pool-container">
      ${renderuserWithRoleEntries()}
      <button class="add-role-button" onClick=${addRole}>
        ${translate('Add role with user')}
      </button>
    </div>
  `;
}

function isNumberEntryEdited(element) {

  if (!element || !element.businessObject) {
    return '';
  }

  const nuValue = element.businessObject.numberOfExecutions;

  return nuValue;
}

function isRoleListEntryEdited(element) {
  if (!element || !element.businessObject) {
    return false;
  }

  return entriesOf(element.businessObject, PEOPLE_TYPES.roles).some(pair => pair.key || pair.value);
}

function isListOfStringEntryEdited(element) {
  if (!element || !element.businessObject) {
    return false;
  }

  // Retornamos true si al menos un elemento en la lista no es un string vacío
  return peopleOf(element.businessObject, PEOPLE_TYPES.process).some(value => value !== '');
}
