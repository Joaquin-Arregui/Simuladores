import { html } from 'htm/preact';
import { useService } from 'bpmn-js-properties-panel';
import { TextFieldEntry, isTextFieldEntryEdited } from '@bpmn-io/properties-panel';

// La semilla de la simulacion (D11, 5.3), en la raiz del diagrama: la
// colaboracion (collab:seed) o el proceso si es uno solo (model:seed). Se
// guarda como texto, para que una semilla grande no pierda cifras al pasar por
// un numero de JavaScript, y el Backend la lee del diagrama. Vacia, el motor
// genera una y la deja escrita en los registros.

// La mayor que el Backend acepta: Number.MAX_SAFE_INTEGER (simulator/main.py).
const MAX_SEED = '9007199254740991';

export function isValidSeed(text) {
  if (!/^\d+$/.test(text)) {
    return false;
  }
  const digits = text.replace(/^0+(?=\d)/, '');
  return digits.length < MAX_SEED.length || (digits.length === MAX_SEED.length && digits <= MAX_SEED);
}

export default function SeedProps(element) {
  return [
    { id: 'seed', element, component: SeedEntry, isEdited: isTextFieldEntryEdited }
  ];
}

function SeedEntry(props) {
  const { element, id } = props;
  const modeling = useService('modeling');
  const translate = useService('translate');
  const debounce = useService('debounceInput');

  const getValue = () => element.businessObject.get('seed') || '';
  const setValue = (value, error) => {
    if (error) return;
    const text = (value || '').trim();
    modeling.updateModdleProperties(element, element.businessObject, { seed: text === '' ? undefined : text });
  };
  const validate = value => {
    const text = (value || '').trim();
    return text === '' || isValidSeed(text) ? null : translate('Must be a whole number between 0 and 9007199254740991.');
  };

  return html`<${TextFieldEntry}
    id=${id}
    element=${element}
    label=${translate('Seed')}
    description=${translate('The same model with the same seed gives the same simulation. Empty: the engine picks one and writes it in the logs.')}
    getValue=${getValue}
    setValue=${setValue}
    validate=${validate}
    debounce=${debounce}
  />`;
}
