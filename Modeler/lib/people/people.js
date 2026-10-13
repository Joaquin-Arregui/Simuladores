// Las listas de personas del simulador, dentro de bpmn:extensionElements (5.2).
//
// Quien puede hacer cada tarea y la plantilla de cada carril, pool y proceso
// se guardan en bpmn:extensionElements, que es el sitio que BPMN 2.0 reserva a
// las extensiones. Hasta la 5.1 se guardaban como hijos directos del elemento:
//
//     <bpmn:task id="T">                     <bpmn:task id="T">
//       <user:UserTask>Ana</user:UserTask>     <bpmn:extensionElements>
//       <bpmn:incoming>f1</bpmn:incoming>        <user:userTask>Ana</user:userTask>
//     </bpmn:task>                             </bpmn:extensionElements>
//                                              <bpmn:incoming>f1</bpmn:incoming>
//                                            </bpmn:task>
//
// y asi el fichero no valida contra el esquema de BPMN 2.0: Camunda avisa al
// abrirlo y descarta las listas, y una herramienta que compruebe el esquema
// no lo acepta. Las etiquetas son las de
// antes; solo cambia el sitio. Los ficheros antiguos se siguen abriendo: los
// descriptores conservan las propiedades de antes solo para leerlos, y
// migrateLegacyPeople las pasa a extensionElements al abrir.
//
// Este fichero no importa nada a proposito: lo usan los paneles, la
// exportacion de las reglas y la apertura de ficheros en el Modeler, y
// Backend/pruebas/valida_bpmn.mjs desde Node.

// El tipo de cada entrada. Todas guardan un nombre -de persona, o de rol en
// las tareas- como texto, salvo los roles del proceso: model:KeyValuePair, con
// el rol en key y sus personas separadas por comas en value.
export const PEOPLE_TYPES = {
  task: 'user:UserTask',
  lane: 'lane:UserWithoutRole',
  participant: 'participantWithoutLane:UserWithoutRole',
  process: 'model:UserWithoutRole',
  roles: 'model:KeyValuePair'
};

// Formato anterior: la propiedad de los descriptores que leia los hijos
// directos, y el tipo de entrada al que pasa.
const LEGACY_PROPERTIES = [
  [ 'user:UserTask', PEOPLE_TYPES.task ],
  [ 'lane:userWithoutRole', PEOPLE_TYPES.lane ],
  [ 'participantWithoutLane:userWithoutRole', PEOPLE_TYPES.participant ],
  [ 'model:userWithoutRole', PEOPLE_TYPES.process ],
  [ 'model:userWithRole', PEOPLE_TYPES.roles ]
];

const isOfType = (value, type) => !!value && typeof value.$instanceOf === 'function' && value.$instanceOf(type);

// Las entradas de un tipo, en su orden.
export function entriesOf(businessObject, type) {
  const values = businessObject && businessObject.extensionElements && businessObject.extensionElements.values;
  return Array.isArray(values) ? values.filter(value => isOfType(value, type)) : [];
}

// Los nombres de una lista de personas, en su orden; '' si una entrada esta vacia.
export function peopleOf(businessObject, type) {
  return entriesOf(businessObject, type).map(entry => (typeof entry.value === 'string' ? entry.value : ''));
}

// Lo que hay que pasar a modeling.updateModdleProperties para que el elemento
// tenga exactamente estas entradas de este tipo, sin tocar sus otras
// extensiones: { moddleElement, properties }, o null si no hay nada que cambiar.
// Es un solo comando, para que deshacer devuelva la lista entera de antes.
export function replaceEntries(moddle, businessObject, type, entries) {
  const extensionElements = businessObject.extensionElements;
  const others = (extensionElements && extensionElements.values || []).filter(value => !isOfType(value, type));
  const values = [ ...others, ...entries ];
  if (!values.length) {
    return extensionElements ? { moddleElement: businessObject, properties: { extensionElements: undefined } } : null;
  }
  if (!extensionElements) {
    const created = moddle.create('bpmn:ExtensionElements', { values });
    created.$parent = businessObject;
    values.forEach(value => { value.$parent = created; });
    return { moddleElement: businessObject, properties: { extensionElements: created } };
  }
  entries.forEach(entry => { entry.$parent = extensionElements; });
  return { moddleElement: extensionElements, properties: { values } };
}

// Cambia, deshaciendo en un paso, las entradas de un tipo del businessObject
// -el del elemento, o el processRef de un pool- en el elemento del lienzo element.
export function setEntries({ modeling, moddle }, element, businessObject, type, entries) {
  const change = replaceEntries(moddle, businessObject, type, entries);
  if (change) {
    modeling.updateModdleProperties(element, change.moddleElement, change.properties);
  }
}

export function setPeople(services, element, businessObject, type, names) {
  const entries = names.map(value => services.moddle.create(type, { value: String(value ?? '') }));
  setEntries(services, element, businessObject, type, entries);
}

// Cada elemento contenido, una vez: sigue las propiedades de contencion de los
// descriptores, no las referencias. Lee las propiedades directamente, porque
// get() crearia de paso las listas vacias que no existen.
function visit(element, callback, seen = new Set()) {
  if (!element || typeof element !== 'object' || !element.$descriptor || seen.has(element)) {
    return;
  }
  seen.add(element);
  callback(element);
  for (const property of element.$descriptor.properties || []) {
    if (property.isReference || property.isAttr) {
      continue;
    }
    const value = element[property.name];
    for (const child of Array.isArray(value) ? value : [ value ]) {
      visit(child, callback, seen);
    }
  }
}

// Pasa a extensionElements las listas escritas como hijos directos (hasta la
// 5.1), detras de las extensiones que ya tuviera cada elemento, y vacia la
// propiedad antigua para que no se vuelva a escribir. Se hace al abrir, antes
// de pintar el diagrama, y no entra en el deshacer: es leer el fichero, no
// editarlo. Devuelve cuantas entradas ha movido.
export function migrateLegacyPeople(moddle, definitions) {
  let moved = 0;
  visit(definitions, businessObject => {
    const byName = businessObject.$descriptor.propertiesByName || {};
    for (const [ legacyName, type ] of LEGACY_PROPERTIES) {
      const property = byName[legacyName];
      const values = property && businessObject[property.name];
      if (!Array.isArray(values) || !values.length) {
        continue;
      }
      const entries = values
        .map(value => (typeof value === 'string' ? moddle.create(type, { value }) : value))
        .filter(value => isOfType(value, type));
      let extensionElements = businessObject.get('extensionElements');
      if (!extensionElements) {
        extensionElements = moddle.create('bpmn:ExtensionElements');
        extensionElements.$parent = businessObject;
        businessObject.set('extensionElements', extensionElements);
      }
      entries.forEach(entry => { entry.$parent = extensionElements; });
      extensionElements.get('values').push(...entries);
      delete businessObject[property.name];
      moved += entries.length;
    }
  });
  return moved;
}
