import { html } from 'htm/preact';
import { useService } from 'bpmn-js-properties-panel';
import {
  CheckboxEntry, SelectEntry,
  isCheckboxEntryEdited, isSelectEntryEdited, isTextFieldEntryEdited
} from '@bpmn-io/properties-panel';

import numberField from './NumberField';

// Los parametros de simulacion de un pool (5.3), con o sin carriles. Se
// guardan en el .bpmn con el prefijo participantWithoutLane, con los mismos
// nombres que en las reglas (descriptors/participantWithoutLane.json), y el
// Backend los lee del diagrama si las reglas no los dicen. Cada campo se
// valida aqui como lo valida el Backend; lo que no vale no se guarda.
//
// - instances: lo habilita el marcador estandar de multiplicidad (D2); en el
//   orquestador son convocatorias sucesivas y en los demas, casos por
//   convocatoria.
// - orchestrationRole: orchestrator u orchestrated; vacio es sin rol.
// - infiniteResources: las tareas del pool no compiten por un recurso (D4).
// - arrivalMode, frequency y arrivalWindow: como llegan los casos a cada
//   convocatoria (D13): uno cada frequency segundos, todos al abrirse, o cada
//   uno al azar entre 0 y arrivalWindow. El orquestador no los usa: tiene un
//   caso por convocatoria, que llega al abrirse.

const ROLES = [ 'orchestrator', 'orchestrated' ];
const ARRIVAL_MODES = [ 'staggered', 'simultaneous', 'uniform' ];

const hasMultiplicity = bo => !!bo.get('participantMultiplicity');
const isOrchestrator = bo => bo.get('orchestrationRole') === 'orchestrator' && hasMultiplicity(bo);
const arrivalMode = bo => bo.get('arrivalMode') || 'staggered';

export default function PoolProps(element) {
  const bo = element.businessObject;
  const orchestrator = isOrchestrator(bo);
  const mode = arrivalMode(bo);
  const hasFrequency = Number(bo.get('frequency') || 0) !== 0;
  const hasWindow = bo.get('arrivalWindow') !== undefined;

  const entries = [
    { id: 'orchestrationRole', element, component: RoleEntry, isEdited: isSelectEntryEdited },
    { id: 'instances', element, component: InstancesEntry, isEdited: isTextFieldEntryEdited },
    { id: 'infiniteResources', element, component: InfiniteResourcesEntry, isEdited: isCheckboxEntryEdited }
  ];

  // Cada campo de la llegada se muestra donde cuenta: el modo, salvo en el
  // orquestador; frequency en la escalonada y T en la uniforme. Un valor puesto
  // donde no cuenta se sigue mostrando, para poder quitarlo: el Backend avisa
  // de que lo ignora.
  if (!orchestrator || bo.get('arrivalMode') !== undefined) {
    entries.push({ id: 'arrivalMode', element, component: ArrivalModeEntry, isEdited: isSelectEntryEdited });
  }
  if ((!orchestrator && mode === 'staggered') || hasFrequency) {
    entries.push({ id: 'frequency', element, component: FrequencyEntry, isEdited: isTextFieldEntryEdited });
  }
  if ((!orchestrator && mode === 'uniform') || hasWindow) {
    entries.push({ id: 'arrivalWindow', element, component: ArrivalWindowEntry, isEdited: isTextFieldEntryEdited });
  }
  return entries;
}

function useUpdate(element) {
  const modeling = useService('modeling');
  return (properties) => modeling.updateModdleProperties(element, element.businessObject, properties);
}

function RoleEntry(props) {
  const { element, id } = props;
  const translate = useService('translate');
  const update = useUpdate(element);

  const getValue = () => element.businessObject.get('orchestrationRole') || '';
  const setValue = value => update({ orchestrationRole: ROLES.includes(value) ? value : undefined });
  const getOptions = () => [
    { value: '', label: translate('No role') },
    { value: 'orchestrator', label: translate('Orchestrator') },
    { value: 'orchestrated', label: translate('Orchestrated') }
  ];
  const description = isOrchestrator(element.businessObject)
    ? translate('Its instances are successive calls; it has one case per call, which arrives when the call opens.')
    : translate('The orchestrator opens each call; the orchestrated pools take part in it.');

  return html`<${SelectEntry}
    id=${id}
    element=${element}
    label=${translate('Orchestration role')}
    getValue=${getValue}
    setValue=${setValue}
    getOptions=${getOptions}
    description=${description}
  />`;
}

const InstancesEntry = numberField({
  property: 'instances',
  label: 'Instances',
  integer: true,
  minimum: 1,
  required: hasMultiplicity,
  description: (bo, translate) => {
    if (!hasMultiplicity(bo)) {
      return translate('Only counts with the participant multiplicity marker: wrench menu, Participant multiplicity.');
    }
    return bo.get('orchestrationRole') === 'orchestrator'
      ? translate('Successive calls.')
      : translate('Cases in each call.');
  }
});

function InfiniteResourcesEntry(props) {
  const { element, id } = props;
  const translate = useService('translate');
  const update = useUpdate(element);

  // Desmarcarla se guarda como false: es decir algo, y si las reglas dicen
  // otra cosa el Backend lo rechaza en vez de quedarse con ellas.
  const getValue = () => element.businessObject.get('infiniteResources') === true;
  const setValue = value => update({ infiniteResources: !!value });

  return html`<${CheckboxEntry}
    id=${id}
    element=${element}
    label=${translate('Infinite resources')}
    description=${translate('Its tasks do not compete for a person: nobody waits in this pool.')}
    getValue=${getValue}
    setValue=${setValue}
  />`;
}

function ArrivalModeEntry(props) {
  const { element, id } = props;
  const translate = useService('translate');
  const update = useUpdate(element);

  const getValue = () => arrivalMode(element.businessObject);
  const setValue = value => update({ arrivalMode: ARRIVAL_MODES.includes(value) ? value : undefined });
  const getOptions = () => [
    { value: 'staggered', label: translate('Staggered: one every frequency seconds') },
    { value: 'simultaneous', label: translate('Simultaneous: all when the call opens') },
    { value: 'uniform', label: translate('Uniform: each at random between 0 and T') }
  ];
  const description = isOrchestrator(element.businessObject)
    ? translate('The orchestrator ignores it.')
    : translate('Times count from the start of each call.');

  return html`<${SelectEntry}
    id=${id}
    element=${element}
    label=${translate('Arrival mode')}
    getValue=${getValue}
    setValue=${setValue}
    getOptions=${getOptions}
    description=${description}
  />`;
}

const FrequencyEntry = numberField({
  property: 'frequency',
  label: 'Frequency (s)',
  description: (bo, translate) => (isOrchestrator(bo) || arrivalMode(bo) !== 'staggered'
    ? translate('Ignored: it only counts for the staggered arrival of an orchestrated pool.')
    : translate('Seconds between two arrivals; decimals allowed.'))
});

const ArrivalWindowEntry = numberField({
  property: 'arrivalWindow',
  label: 'Arrival window T (s)',
  integer: true,
  required: bo => arrivalMode(bo) === 'uniform' && !isOrchestrator(bo),
  description: (bo, translate) => (isOrchestrator(bo) || arrivalMode(bo) !== 'uniform'
    ? translate('Ignored: it only counts for the uniform arrival.')
    : translate('Each case arrives at a whole second between 0 and T.'))
});
