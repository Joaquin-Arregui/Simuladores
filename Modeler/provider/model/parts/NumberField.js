import { html } from 'htm/preact';
import { useService } from 'bpmn-js-properties-panel';
import { TextFieldEntry } from '@bpmn-io/properties-panel';

import { checkNumber, formatNumber, parseNumber } from '../../../lib/numbers/numbers.js';

// Un campo numerico del panel que valida como el Backend (5.3): lo que no vale
// se marca en rojo y no se guarda; vacio quita el atributo. Lo guardado se
// muestra sin exponente cuando se puede, y con exponente tambien vale
// (lib/numbers): lo que el panel guarda, el panel lo acepta. Se crea una vez por
// campo, fuera del render, para que el panel no lo vuelva a montar en cada
// cambio y no se pierda el foco.
//
//   property     el atributo del businessObject
//   label        la etiqueta
//   integer      entero (si no, admite decimales)
//   minimum      el menor valor admitido
//   description  texto, o (businessObject, translate) => texto
//   required     (businessObject) => si vacio es un error
//   check        (businessObject, valor, translate) => por que un numero valido
//                no vale con los demas campos -un minimo mayor que el maximo-,
//                o null
export default function numberField({ property, label, integer = false, minimum = 0, description, required, check }) {
  function NumberFieldEntry(props) {
    const { element, id } = props;
    const modeling = useService('modeling');
    const translate = useService('translate');
    const debounce = useService('debounceInput');
    const bo = element.businessObject;

    const getValue = () => {
      const value = element.businessObject.get(property);
      return value === undefined || value === null ? '' : formatNumber(value);
    };
    const setValue = (value, error) => {
      if (error) return;
      const text = (value || '').trim();
      const parsed = text === '' ? undefined : parseNumber(text, { integer });
      modeling.updateModdleProperties(element, element.businessObject, { [property]: parsed });
    };
    const validate = value => {
      const text = (value || '').trim();
      if (text === '') {
        return required && required(element.businessObject) ? translate('This value is needed.') : null;
      }
      const problem = checkNumber(text, { integer, minimum });
      if (!problem) {
        return check ? check(element.businessObject, parseNumber(text, { integer }), translate) : null;
      }
      if (integer) {
        return translate('Must be a whole number between {minimum} and {maximum}.',
          { minimum: String(minimum), maximum: String(Number.MAX_SAFE_INTEGER) });
      }
      return problem === 'maximum'
        ? translate('Too large a number.')
        : translate('Must be a number of {minimum} or more.', { minimum: String(minimum) });
    };

    return html`<${TextFieldEntry}
      id=${id}
      element=${element}
      label=${translate(label)}
      description=${typeof description === 'function' ? description(bo, translate) : description && translate(description)}
      getValue=${getValue}
      setValue=${setValue}
      validate=${validate}
      debounce=${debounce}
    />`;
  }

  return NumberFieldEntry;
}
