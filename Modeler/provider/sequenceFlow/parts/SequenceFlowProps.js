import { is } from 'bpmn-js/lib/util/ModelUtil';

import numberField from '../../model/parts/NumberField';
import { formatNumber } from '../../../lib/numbers/numbers.js';

export default function(element) {
  return [
    {
      id: 'sequenceFlow',
      element,
      component: PercentageEntry,
      isEdited: isPercentageEdited
    }
  ];
}

// El porcentaje de una rama, validado como lo valida el Backend (5.6): un numero
// de 0 a 100, con decimales; lo que no vale se marca en rojo y no se guarda,
// como en los demas campos numericos. Que las ramas de una compuerta sumen 100
// no es obligatorio: el Backend reparte en proporcion lo que no suma y avisa, y
// eso es lo que cuenta la descripcion, con la suma de la compuerta. Solo se
// rechaza lo que el Backend rechaza: que ninguna rama se pueda elegir nunca.
// Hasta la 5.6 el campo exigia la suma exacta, guardaba igual lo que marcaba en
// rojo, y el descriptor leia el porcentaje como entero: 33.3 volvia como 33.

const TOLERANCIA = 1e-8; // la del Backend al comparar la suma con 100

function eligePorPorcentaje(gateway) {
  return is(gateway, 'bpmn:ExclusiveGateway') || is(gateway, 'bpmn:InclusiveGateway');
}

// La suma de las ramas de la compuerta con porcentaje y cuantas no lo tienen;
// con `valor`, como si la rama `propia` lo tuviera ya.
function ramasDe(bo, valor) {
  const flows = (bo.sourceRef?.outgoing || []).filter(flow => is(flow, 'bpmn:SequenceFlow'));
  const porcentajes = flows.map(flow => (flow === bo && valor !== undefined ? valor : flow.percentageOfBranches));
  const asignados = porcentajes.filter(p => typeof p === 'number');
  return {
    total: asignados.reduce((suma, p) => suma + p, 0),
    sinPorcentaje: porcentajes.length - asignados.length
  };
}

// La suma, escrita sin el ruido de los decimales en coma flotante.
const escrito = total => formatNumber(Number(total.toFixed(6)));

function check(bo, value, translate) {
  if (value > 100) {
    return translate('Cannot be more than 100.');
  }
  if (!eligePorPorcentaje(bo.sourceRef)) {
    return null;
  }

  // Como el Backend: las ramas sin porcentaje se reparten lo que falte hasta 100.
  const { total, sinPorcentaje } = ramasDe(bo, value);
  const resto = sinPorcentaje ? Math.max(100 - total, 0) : 0;
  return total + resto <= 0
    ? translate('No branch of this gateway could ever be taken: give one a percentage above 0.')
    : null;
}

function description(bo, translate) {
  const gateway = bo.sourceRef;
  if (!eligePorPorcentaje(gateway)) {
    return translate('Not used: only exclusive and inclusive gateways choose by percentage.');
  }
  const { total, sinPorcentaje } = ramasDe(bo);
  const exclusiva = is(gateway, 'bpmn:ExclusiveGateway');
  if (sinPorcentaje) {
    return total >= 100 - TOLERANCIA
      ? translate('The branches with a percentage add up to {total} %: those without one are never taken.',
        { total: escrito(total) })
      : translate('The branches without a percentage share the remaining {rest} %.',
        { rest: escrito(100 - total) });
  }
  if (!exclusiva) {
    return translate('Each branch is taken on its own with its percentage; if none is, one is chosen by these weights.');
  }
  return Math.abs(total - 100) <= TOLERANCIA
    ? translate('The branches add up to 100 %.')
    : translate('The branches add up to {total} %: the simulator scales them to 100 % and warns.',
      { total: escrito(total) });
}

const PercentageEntry = numberField({
  property: 'percentageOfBranches',
  label: 'Percentage of Branches',
  description,
  check
});

function isPercentageEdited(element) {
  if (!element || !element.businessObject) {
    return false;
  }
  return element.businessObject.percentageOfBranches !== undefined;
}
