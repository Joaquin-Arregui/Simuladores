import { migrateLegacyPeople } from './people.js';

// Al abrir un fichero del formato anterior a la 5.2, sus listas de personas
// pasan a bpmn:extensionElements antes de pintarlo (ver people.js).
function LegacyPeopleImport(eventBus, moddle) {
  eventBus.on('import.parse.complete', ({ definitions }) => {
    if (!definitions) {
      return;
    }
    const moved = migrateLegacyPeople(moddle, definitions);
    if (moved) {
      console.info(`Formato anterior: ${moved} entradas de personas pasan a extensionElements; se guardarán ahí.`);
    }
  });
}

LegacyPeopleImport.$inject = [ 'eventBus', 'moddle' ];

export default {
  __init__: [ 'legacyPeopleImport' ],
  legacyPeopleImport: [ 'type', LegacyPeopleImport ]
};
