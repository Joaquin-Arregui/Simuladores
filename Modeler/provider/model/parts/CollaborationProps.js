import { isTextFieldEntryEdited } from '@bpmn-io/properties-panel';

import numberField from './NumberField';
import SeedProps from './SeedProps';

// La raiz de una colaboracion: sus instancias y la semilla (5.3).
export default function(element) {
  return [
    { id: 'instance', element, component: InstanceEntry, isEdited: isTextFieldEntryEdited },
    ...SeedProps(element)
  ];
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
