import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-js.css';
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn-embedded.css';
import '@bpmn-io/properties-panel/assets/properties-panel.css';
import '../style.css';

import BpmnModeler from 'bpmn-js/lib/Modeler';
import { BpmnPropertiesPanelModule, BpmnPropertiesProviderModule } from 'bpmn-js-properties-panel';
import download from 'downloadjs';

import resizeAllModule from '../../lib/resize-all-rules';
import propertiesProviderModule from '../../provider/properties';
import userModdleDescriptor from '../../descriptors/user.json';
import sequenceFlowExtension from '../../descriptors/sequenceFlow.json';
import modelExtension from '../../descriptors/model.json';
import collaborationExtension from '../../descriptors/collaboration.json';
import laneExtension from '../../descriptors/lane.json';
import participantWithoutLaneExtension from '../../descriptors/participantWithoutLane.json';

import AddExporter from '@bpmn-io/add-exporter';

import { exportToEsper } from './taskHandlers';

document.addEventListener('DOMContentLoaded', function() {

  // ----------------------------
  // Modeler setup
  // ----------------------------
  const bpmnModeler = new BpmnModeler({
    container: '#canvas',
    propertiesPanel: { parent: '#properties-panel' },
    additionalModules: [
      BpmnPropertiesPanelModule,
      BpmnPropertiesProviderModule,
      propertiesProviderModule,
      resizeAllModule,
      AddExporter
    ],
    exporter: { name: 'my-bpmn-exporter', version: '1.0.0' },
    moddleExtensions: {
      user: userModdleDescriptor,
      sequenceFlow: sequenceFlowExtension,
      model: modelExtension,
      collaboration: collaborationExtension,
      lane: laneExtension,
      participantWithoutLane: participantWithoutLaneExtension
    }
  });

  // ----------------------------
  // Helpers
  // ----------------------------
  async function openDiagram(xml) {

    // Old Scheduler models must not silently become ordinary tasks.
    const documentXml = new DOMParser().parseFromString(xml, 'application/xml');
    const hasScheduler = Array.from(documentXml.getElementsByTagName('*')).some(element =>
      (element.namespaceURI === 'http://example.com/custom' && element.localName.toLowerCase() === 'scheduler') ||
      element.getAttributeNS('http://example.com/custom', 'type') === 'scheduler' ||
      element.getAttribute('isScheduler') === 'true' ||
      element.getAttribute('data-type') === 'scheduler'
    );
    if (hasScheduler) {
      window.alert('Este modelo contiene Scheduler, que ya no está disponible. No se ha importado ni modificado el archivo.');
      return;
    }
    try {
      await bpmnModeler.importXML(xml);
    } catch (err) {
      console.error('Error during importXML:', err);
      window.alert(`No se pudo abrir el diagrama: ${err.message}`);
    }
  }

  function registerFileDrop(container, callback) {
    function handleFileSelect(e) {
      e.stopPropagation();
      e.preventDefault();
      const files = e.dataTransfer ? e.dataTransfer.files : e.target.files;
      if (!files || files.length === 0) return console.error('No se encontró un archivo para procesar.');
      const file = files[0];
      if (!(file instanceof File)) return console.error('El archivo no es válido.');

      const reader = new FileReader();
      reader.onload = ev => callback(ev.target.result);
      reader.onerror = ev => console.error('Error al leer el archivo:', ev);
      reader.readAsText(file);
    }

    function handleDragOver(e) {
      e.stopPropagation();
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }

    container.addEventListener('dragover', handleDragOver, false);
    container.addEventListener('drop', handleFileSelect, false);

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.bpmn, .xml';
    fileInput.style.display = 'none';
    fileInput.addEventListener('change', handleFileSelect, false);
    container.appendChild(fileInput);
  }

  async function exportDefinitionsXML(modeler) {
    const moddle = modeler.get('moddle');
    const defs = modeler.get('canvas').getRootElement().businessObject.$parent;
    hardCleanDefinitions(modeler); // limpieza fuerte antes de serializar
    const { xml } = await moddle.toXML(defs);
    return xml;
  }

  async function downloadDiagram() {
    try {
      await sanitizeModel(bpmnModeler);
      const xml = await exportDefinitionsXML(bpmnModeler);
      download(xml, 'diagram.bpmn', 'application/xml');
    } catch (err) {
      console.error('Error al guardar BPMN:', err);
    }
  }

  // ----------------------------
  // Bootstrap inicial
  // ----------------------------
  (async () => {
    try {
      await bpmnModeler.createDiagram();
      const storedXml = sessionStorage.getItem('importedDiagram');
      if (storedXml) {
        await openDiagram(storedXml);
        sessionStorage.removeItem('importedDiagram');
      }
    } catch (err) {
      console.error('No se pudo cargar el diagrama inicial:', err);
    }
  })();

  registerFileDrop(document.getElementById('canvas'), openDiagram);

  // ----------------------------
  // Acciones UI
  // ----------------------------
  document.body.addEventListener('keydown', (event) => {
    if (event.code === 'KeyS' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      downloadDiagram();
    }
  });

  if (!window.FileList || !window.FileReader) {
    window.alert('Tu navegador no soporta arrastrar y soltar. Usa Chrome, Firefox o Edge.');
  }

  const backendUrl = 'http://localhost:3000';
  const simulateButton = document.getElementById('js-simulate');
  const lastSimulationButton = document.getElementById('js-continue');
  const simulationStatus = document.getElementById('simulation-status');
  const modalOverlay = document.querySelector('.modal-overlay');
  const modal = document.querySelector('.modal');
  const closeModalButton = document.getElementById('close-modal');
  let simulationRunning = false;
  let lastSimulation = null;
  let modalReturnFocus = null;

  function setSimulationStatus(message, state) {
    simulationStatus.textContent = message;
    simulationStatus.dataset.state = state;
  }

  function showSimulationMessage(title, message, state) {
    if (modalOverlay.style.display === 'none') {
      modalReturnFocus = document.activeElement === document.body ? simulateButton : document.activeElement;
    }
    document.getElementById('simulation-title').textContent = title;
    document.getElementById('simulation-results').textContent = message;
    modal.dataset.state = state;
    modalOverlay.style.display = 'block';
    closeModalButton.focus();
  }

  function closeSimulationMessage() {
    modalOverlay.style.display = 'none';
    modalReturnFocus?.focus();
  }

  async function readResponse(response) {
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  function responseError(data, fallback) {
    const message = typeof data?.error === 'string'
      ? data.error
      : typeof data?.message === 'string' ? data.message : fallback;
    const details = Array.isArray(data?.details)
      ? data.details.map(detail => {
        if (typeof detail === 'string') return detail;
        return [ detail?.id || detail?.id_bpmn, detail?.type, detail?.message || detail?.reason ].filter(Boolean).join(': ');
      }).filter(Boolean).join('\n')
      : typeof data?.details === 'string' ? data.details : '';
    return new Error(details ? `${message}\n\n${details}` : message);
  }

  async function simulationTimeoutSeconds() {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 5000);
    let response;
    let data;
    try {
      response = await fetch(`${backendUrl}/simulation-config`, { signal: controller.signal });
      data = await readResponse(response);
    } catch {

      // Compatibility fallback; the simulation request will report connection errors.
      return 300;
    } finally {
      window.clearTimeout(timer);
    }
    if (response.status === 404) return 300;
    if (!response.ok) {
      throw responseError(data, 'No se pudo consultar la configuración del Backend.');
    }
    if (typeof data?.timeoutSeconds !== 'number' || !Number.isFinite(data.timeoutSeconds) || data.timeoutSeconds <= 0) {
      throw new Error('El Backend devolvió un límite de tiempo no válido. Revisa su configuración antes de simular.');
    }
    return data.timeoutSeconds;
  }

  simulateButton.addEventListener('click', async (e) => {
    e.preventDefault();
    if (simulationRunning) return;

    simulationRunning = true;
    simulateButton.disabled = true;
    simulateButton.textContent = 'Simulando…';
    simulateButton.setAttribute('aria-busy', 'true');
    setSimulationStatus('Preparando el modelo para simular…', 'running');
    let timer;

    try {
      await sanitizeModel(bpmnModeler);
      const diagramXML = await exportDefinitionsXML(bpmnModeler);
      const content = await exportToEsper(bpmnModeler);
      const timeoutSeconds = await simulationTimeoutSeconds();
      const duration = timeoutSeconds % 60 === 0 ? `${timeoutSeconds / 60} min` : `${timeoutSeconds} s`;
      setSimulationStatus(`Simulación en curso. Límite de ejecución: ${duration}.`, 'running');

      // The Backend validates the original BPMN XML before executing it, so
      // unsupported elements remain editable without silently changing semantics.
      const body = {
        content,
        diagramXML,
        filename: 'esperTasks.txt',
        diagramfilename: 'diagram.bpmn'
      };
      const controller = new AbortController();

      // Allow the server watchdog to stop Python and return its own error first.
      timer = window.setTimeout(() => controller.abort(), (timeoutSeconds + 15) * 1000);
      let response;
      let data;
      try {
        response = await fetch(`${backendUrl}/simulate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal
        });
        data = await readResponse(response);
      } catch (err) {
        if (err.name === 'AbortError') {
          throw new Error('El Backend no respondió dentro del plazo esperado. No se ha confirmado la cancelación de la simulación; revisa el Backend antes de volver a enviarla.');
        }
        throw new Error(`No se pudo conectar con el Backend o se perdió la conexión. Comprueba que esté disponible en ${backendUrl}.`);
      }

      if (!response.ok) {
        const fallback = response.status === 504
          ? 'La simulación superó el tiempo máximo y el Backend la detuvo.'
          : `El Backend no pudo completar la simulación (HTTP ${response.status}).`;
        throw responseError(data, fallback);
      }
      if (typeof data?.simulation !== 'string') {
        throw new Error('El Backend devolvió una respuesta sin resultados válidos.');
      }

      lastSimulation = data.simulation;
      lastSimulationButton.disabled = false;
      setSimulationStatus('Simulación completada. Los resultados están disponibles en «Última simulación».', 'success');
      showSimulationMessage('Resultados de la simulación', lastSimulation, 'success');
    } catch (err) {
      const preserved = lastSimulation !== null ? ' Se conserva la última simulación completada.' : '';
      setSimulationStatus(`No se pudo completar la simulación.${preserved}`, 'error');
      showSimulationMessage('No se pudo simular el modelo', err.message || 'Se produjo un error inesperado.', 'error');
    } finally {
      window.clearTimeout(timer);
      simulationRunning = false;
      simulateButton.disabled = false;
      simulateButton.textContent = 'Simular';
      simulateButton.removeAttribute('aria-busy');
    }
  });

  lastSimulationButton.addEventListener('click', () => {
    if (lastSimulation !== null) {
      showSimulationMessage('Última simulación completada', lastSimulation, 'success');
    }
  });

  closeModalButton.addEventListener('click', closeSimulationMessage);
  document.addEventListener('keydown', event => {
    if (modalOverlay.style.display === 'none') return;
    if (event.key === 'Escape') closeSimulationMessage();
    if (event.key === 'Tab') {
      event.preventDefault();
      closeModalButton.focus();
    }
  });

  // ----------------------------
  // Limpieza de modelo
  // ----------------------------
  async function sanitizeModel(modeler) {
    const modeling = modeler.get('modeling');
    const moddle = modeler.get('moddle');
    const commandStack = modeler.get('commandStack');
    const elementRegistry = modeler.get('elementRegistry');

    const canvasRoot = modeler.get('canvas').getRootElement();
    const definitions = canvasRoot.businessObject.$parent;

    // Reparar userWithRole
    elementRegistry.filter(e => e.type === 'bpmn:Process').forEach(procShape => {
      const bo = procShape.businessObject;

      if (bo.userWithRole && !Array.isArray(bo.userWithRole)) {
        const arr = Object.entries(bo.userWithRole).map(([ key, val ]) =>
          moddle.create('model:KeyValuePair', {
            key,
            value: Array.isArray(val) ? val.join(',') : String(val ?? '')
          })
        );
        modeling.updateModdleProperties(procShape, bo, { userWithRole: arr });
      }

      if (Array.isArray(bo.userWithRole)) {
        const needsFix = bo.userWithRole.some(x => !x || !x.$descriptor);
        if (needsFix) {
          const arr = bo.userWithRole
            .filter(Boolean)
            .map(x => {
              if (x && x.$descriptor) return x;
              const key = String(x?.key ?? x?.role ?? '');
              const value = x?.value != null ? String(x.value) : Array.isArray(x?.users) ? x.users.join(',') : '';
              return moddle.create('model:KeyValuePair', { key, value });
            });
          modeling.updateModdleProperties(procShape, bo, { userWithRole: arr });
        }
      }
    });

    // Filtrar rootElements inválidos
    if (definitions && Array.isArray(definitions.rootElements)) {
      const filtered = definitions.rootElements.filter(re => re && re.$descriptor);
      if (filtered.length !== definitions.rootElements.length) {
        commandStack.execute('element.updateModdleProperties', {
          element: canvasRoot,
          moddleElement: definitions,
          properties: { rootElements: filtered }
        });
      }
    }

    // Limpiar extensionElements.values
    elementRegistry.forEach(shape => {
      const bo = shape.businessObject;
      const ext = bo && bo.extensionElements;
      if (ext && Array.isArray(ext.values)) {
        const filtered = ext.values.filter(v => v && v.$descriptor);
        if (filtered.length !== ext.values.length) {
          modeling.updateModdleProperties(shape, ext, { values: filtered });
        }
      }
    });

    // Limpieza recursiva
    const deepClean = (ownerEl, me) => {
      if (!me || !me.$descriptor) return;
      const props = me.$descriptor.properties || [];
      const toUpdate = {};

      for (const p of props) {
        if (p.type !== 'Element' || p.isReference) continue;
        const val = me.get ? me.get(p.name) : me[p.name];
        const isWaypointList = /BPMNEdge/.test(me.$type) && p.name === 'waypoint' && p.isMany;

        if (p.isMany) {
          if (Array.isArray(val)) {
            let arr = val.filter(v => v && v.$descriptor);
            if (isWaypointList) {

              // recreación de dc:Point se hace en hardCleanDefinitions
            }
            if (arr.length !== val.length) toUpdate[p.name] = arr;
            arr.forEach(child => deepClean(ownerEl, child));
          } else if (val != null) {
            toUpdate[p.name] = [];
          }
        } else {
          if (val && !val.$descriptor) toUpdate[p.name] = null;
          else if (val && val.$descriptor) deepClean(ownerEl, val);
        }
      }

      if (Object.keys(toUpdate).length) {
        commandStack.execute('element.updateModdleProperties', {
          element: canvasRoot,
          moddleElement: me,
          properties: toUpdate
        });
      }
    };

    deepClean(canvasRoot, definitions);
  }

  function hardCleanDefinitions(modeler) {
    const moddle = modeler.get('moddle');
    const canvasRoot = modeler.get('canvas').getRootElement();
    const definitions = canvasRoot.businessObject.$parent;

    const asDcPoint = (p) => {
      if (p && p.$descriptor) return p;
      const x = Number(p?.x ?? p?.X ?? 0);
      const y = Number(p?.y ?? p?.Y ?? 0);
      return moddle.create('dc:Point', { x, y });
    };

    const visit = (me) => {
      if (!me || !me.$descriptor) return;
      const props = me.$descriptor.properties || [];

      for (const prop of props) {
        if (prop.type !== 'Element' || prop.isReference) continue;
        let val = me.get ? me.get(prop.name) : me[prop.name];
        const isWaypointList = /BPMNEdge/.test(me.$type) && prop.name === 'waypoint' && prop.isMany;

        if (prop.isMany) {
          if (Array.isArray(val)) {
            let arr = val.filter(v => v && v.$descriptor);
            if (isWaypointList) arr = val.map(v => asDcPoint(v)).filter(Boolean);
            if (me.set) me.set(prop.name, arr);
            else me[prop.name] = arr;
            arr.forEach(visit);
          } else if (val != null) {
            if (me.set) me.set(prop.name, []);
            else me[prop.name] = [];
          }
        } else {
          if (val && !val.$descriptor) {
            if (me.set) me.set(prop.name, null);
            else me[prop.name] = null;
          } else if (val && val.$descriptor) {
            visit(val);
          }
        }
      }
    };

    if (Array.isArray(definitions.rootElements)) {
      definitions.rootElements = definitions.rootElements.filter(re => re && re.$descriptor);
    }
    if (Array.isArray(definitions.diagrams)) {
      definitions.diagrams = definitions.diagrams.filter(d => d && d.$descriptor);
    }

    visit(definitions);
  }
});
