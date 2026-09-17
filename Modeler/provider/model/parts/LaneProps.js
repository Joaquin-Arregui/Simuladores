import { html } from 'htm/preact';
import { useService } from 'bpmn-js-properties-panel';


export default function(element) {
  return [
    {
      id: 'userWithoutRole',
      element,
      component: userWithoutRoleFunction,
      isEdited: isListOfStringEntryEdited
    }
  ];
}

function userWithoutRoleFunction(props) {
  const { element } = props;
  const modeling = useService('modeling');
  const translate = useService('translate');

  const getUserWithoutRoleList = () => {
    if (!element || !element.businessObject) {
      return [];
    }

    // Asegurar que userWithoutRole es un array
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
