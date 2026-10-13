import { exportRules } from '../../lib/rules/rules.js';

// Las reglas del diagrama abierto, en el formato que lee el simulador. El
// recorrido y el formato estan en lib/rules, para que el banco del Backend
// pueda exportar desde Node con el mismo codigo.
function exportToEsper(bpmnModeler) {
  return new Promise((resolve, reject) => {
    try {
      const elementRegistry = bpmnModeler.get('elementRegistry');
      const definitions = bpmnModeler.get('canvas').getRootElement().businessObject.$parent;
      resolve(exportRules(elementRegistry.getAll(), definitions));
    } catch (err) {
      reject(err);
    }
  });
}

export {
  exportToEsper
};
