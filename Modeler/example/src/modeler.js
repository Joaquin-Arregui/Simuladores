import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-js.css';
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn-embedded.css';
import '@bpmn-io/properties-panel/assets/properties-panel.css';
import '../style.css';

import BpmnModeler from 'bpmn-js/lib/Modeler';
import { BpmnPropertiesPanelModule, BpmnPropertiesProviderModule } from 'bpmn-js-properties-panel';
import download from 'downloadjs';

import resizeAllModule from '../../lib/resize-all-rules';
import legacyPeopleModule from '../../lib/people';
import propertiesProviderModule from '../../provider/properties';
import userModdleDescriptor from '../../descriptors/user.json';
import sequenceFlowExtension from '../../descriptors/sequenceFlow.json';
import modelExtension from '../../descriptors/model.json';
import collaborationExtension from '../../descriptors/collaboration.json';
import laneExtension from '../../descriptors/lane.json';
import participantWithoutLaneExtension from '../../descriptors/participantWithoutLane.json';

import AddExporter from '@bpmn-io/add-exporter';

import { exportToEsper } from './taskHandlers';
import { logsFromResponse, preview } from '../../lib/logs/logs.js';

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
      legacyPeopleModule,
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

  // Un fichero de texto, en UTF-8. downloadjs trata como binaria una cadena con
  // algun caracter entre \x80 y \xff y escribe un byte por caracter: una «ó» o
  // una «ñ» acababan en un byte suelto, y el fichero, que dice ser UTF-8, no se
  // podia leer. Con un Blob la codificacion la hace el navegador.
  function downloadText(text, fileName) {
    download(new Blob([ text ], { type: 'application/xml;charset=utf-8' }), fileName, 'application/xml');
  }

  async function downloadDiagram() {
    try {
      await sanitizeModel(bpmnModeler);
      const xml = await exportDefinitionsXML(bpmnModeler);
      downloadText(xml, 'diagram.bpmn');
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
  const warningsBox = document.getElementById('simulation-warnings');
  const warningsList = warningsBox.querySelector('ul');
  const summaryBox = document.getElementById('simulation-summary');
  const logsSection = document.getElementById('simulation-logs');
  const logsBody = logsSection.querySelector('tbody');
  const downloadAllButton = document.getElementById('download-all-logs');
  const resultsBox = document.getElementById('simulation-results');
  const previewTitle = document.getElementById('simulation-preview-title');
  const previewNote = document.getElementById('simulation-preview-note');
  let simulationRunning = false;
  let lastSimulation = null;
  let modalReturnFocus = null;

  function setSimulationStatus(message, state) {
    simulationStatus.textContent = message;
    simulationStatus.dataset.state = state;
  }

  function openModal(title, state, warnings) {
    if (modalOverlay.style.display === 'none') {
      modalReturnFocus = document.activeElement === document.body ? simulateButton : document.activeElement;
    }
    document.getElementById('simulation-title').textContent = title;
    warningsList.replaceChildren(...warnings.map(warning => {
      const item = document.createElement('li');
      item.textContent = warning;
      return item;
    }));
    warningsBox.hidden = warnings.length === 0;
    modal.dataset.state = state;
    modalOverlay.style.display = 'block';
    modal.scrollTop = 0;
    resultsBox.scrollTop = 0;
    closeModalButton.focus({ preventScroll: true });
  }

  // Un error, o cualquier mensaje sin registros.
  function showSimulationMessage(title, message, state, warnings = []) {
    summaryBox.hidden = true;
    logsSection.hidden = true;
    previewTitle.hidden = true;
    previewNote.hidden = true;
    resultsBox.textContent = message;
    openModal(title, state, warnings);
  }

  // Una simulacion correcta: un XES por pool (D10, 5.5), cada uno con su
  // nombre de fichero (lib/logs), para verlo o descargarlo por separado.
  function showSimulationResults(title, result) {
    const summary = [
      result.simulationId && `Simulación ${result.simulationId}`,
      result.seed !== undefined && result.seed !== null && `semilla ${result.seed}`,
      result.modelName && `modelo «${result.modelName}»`
    ].filter(Boolean);
    summaryBox.textContent = summary.join(' · ');
    summaryBox.hidden = summary.length === 0;
    logsBody.replaceChildren(...result.logs.map(logRow));
    downloadAllButton.hidden = result.logs.length < 2;
    logsSection.hidden = false;
    showLog(result.logs[0]);
    openModal(title, 'success', result.warnings);
  }

  function logRow(log) {
    const row = document.createElement('tr');
    const pool = document.createElement('th');
    pool.scope = 'row';
    pool.textContent = log.label;
    pool.title = `Pool ${log.pool}`;
    const cell = (text, className) => {
      const td = document.createElement('td');
      td.textContent = text;
      if (className) td.className = className;
      return td;
    };
    const actions = cell('', 'simulation-logs-actions');
    const button = (text, label, onClick) => {
      const element = document.createElement('button');
      element.type = 'button';
      element.textContent = text;
      element.setAttribute('aria-label', label);
      element.addEventListener('click', onClick);
      return element;
    };
    const view = button('Ver', `Ver el registro de ${log.label}`, () => showLog(log));
    view.dataset.pool = log.pool;
    actions.append(view, button('Descargar', `Descargar ${log.fileName}`, () => downloadLog(log)));
    row.append(pool, cell(String(log.cases), 'simulation-logs-number'), cell(log.fileName, 'simulation-logs-file'), actions);
    return row;
  }

  function showLog(log) {
    previewTitle.textContent = `Registro de ${log.label} · ${log.fileName}`;
    previewTitle.hidden = false;
    const { text, truncated } = preview(log.xes);
    resultsBox.textContent = text;
    previewNote.textContent = truncated
      ? `Se muestra el principio del registro (${text.length.toLocaleString('es')} de ${log.xes.length.toLocaleString('es')} caracteres); descárgalo para verlo entero.`
      : '';
    previewNote.hidden = !truncated;
    for (const view of logsBody.querySelectorAll('button[data-pool]')) {
      view.setAttribute('aria-pressed', String(view.dataset.pool === log.pool));
    }
  }

  function downloadLog(log) {
    downloadText(log.xes, log.fileName);
  }

  // Uno detras de otro: el navegador puede pedir permiso para descargar varios.
  downloadAllButton.addEventListener('click', async () => {
    if (lastSimulation === null) return;
    for (const [ index, log ] of lastSimulation.logs.entries()) {
      if (index) await new Promise(resolve => window.setTimeout(resolve, 400));
      downloadLog(log);
    }
  });

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
      const body = { content, diagramXML };
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

      // Un XES por pool (D10); el reunido, data.simulation, ya no se usa aqui.
      const logs = logsFromResponse(data);
      const warnings = Array.isArray(data.warnings)
        ? data.warnings.filter(warning => typeof warning === 'string')
        : [];

      lastSimulation = {
        logs, warnings, simulationId: data.simulationId, seed: data.seed, modelName: data.model?.name
      };
      lastSimulationButton.disabled = false;
      const registros = logs.length === 1 ? '1 registro XES' : `${logs.length} registros XES, uno por pool`;
      if (warnings.length) {
        const count = warnings.length === 1 ? '1 aviso' : `${warnings.length} avisos`;
        setSimulationStatus(`Simulación completada con ${count}: ${registros}. Puedes revisarlos en «Última simulación».`, 'warning');
      } else {
        setSimulationStatus(`Simulación completada: ${registros}. Están disponibles en «Última simulación».`, 'success');
      }
      showSimulationResults('Resultados de la simulación', lastSimulation);
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
      showSimulationResults('Última simulación completada', lastSimulation);
    }
  });

  closeModalButton.addEventListener('click', closeSimulationMessage);
  document.addEventListener('keydown', event => {
    if (modalOverlay.style.display === 'none') return;
    if (event.key === 'Escape') closeSimulationMessage();
    if (event.key === 'Tab') {

      // El foco no sale del dialogo: recorre sus botones visibles, en los dos sentidos.
      const focusables = Array.from(modal.querySelectorAll('button:not([disabled])'))
        .filter(element => element.offsetParent !== null);
      event.preventDefault();
      if (!focusables.length) return;
      const index = focusables.indexOf(document.activeElement);
      const next = event.shiftKey
        ? (index <= 0 ? focusables.length - 1 : index - 1)
        : (index + 1) % focusables.length;
      focusables[next].focus();
    }
  });

  // ----------------------------
  // Limpieza de modelo
  // ----------------------------
  async function sanitizeModel(modeler) {
    const modeling = modeler.get('modeling');
    const commandStack = modeler.get('commandStack');
    const elementRegistry = modeler.get('elementRegistry');

    const canvasRoot = modeler.get('canvas').getRootElement();
    const definitions = canvasRoot.businessObject.$parent;

    // Los roles del proceso ya no se reparan aqui: desde la 5.2 son entradas
    // model:KeyValuePair de extensionElements, que solo crean los paneles y la
    // apertura de ficheros antiguos (lib/people).

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
