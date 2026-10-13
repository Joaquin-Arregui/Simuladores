import { html } from 'htm/preact';
import { useService } from 'bpmn-js-properties-panel';
import { TextFieldEntry, isTextFieldEntryEdited } from '@bpmn-io/properties-panel';

import numberField from './NumberField';
import SeedProps from './SeedProps';

// La raiz de una colaboracion: su nombre, sus instancias y la semilla (5.3, 5.6).
export default function(element) {
  return [
    { id: 'collaborationName', element, component: NameEntry, isEdited: isTextFieldEntryEdited },
    { id: 'instance', element, component: InstanceEntry, isEdited: isTextFieldEntryEdited },
    ...SeedProps(element)
  ];
}

// El nombre del modelo, que los registros guardan como model:name. Es el name
// estandar de bpmn:Collaboration, pero el panel General de bpmn-js no lo
// ofrece para la colaboracion; sin el, el modelo se exporta como "Unnamed".
function NameEntry(props) {
  const { element, id } = props;
  const modeling = useService('modeling');
  const translate = useService('translate');
  const debounce = useService('debounceInput');

  const getValue = () => element.businessObject.get('name') || '';
  const setValue = value => {
    const text = (value || '').trim();
    modeling.updateProperties(element, { name: text === '' ? undefined : text });
  };

  return html`<${TextFieldEntry}
    id=${id}
    element=${element}
    label=${translate('Model name')}
    description=${translate('Written in the logs as the name of the model.')}
    getValue=${getValue}
    setValue=${setValue}
    debounce=${debounce}
  />`;
}

// Las de siempre: cada pool tiene ese numero de casos y se emparejan 1:1 por
// indice, mientras ningun pool lleve el marcador de multiplicidad (D2).
const InstanceEntry = numberField({
  property: 'instance',
  label: 'Number of instances',
  integer: true,
  minimum: 1,
  description: 'Cases of every pool, paired 1:1, while no pool has the participant multiplicity marker.'
});
