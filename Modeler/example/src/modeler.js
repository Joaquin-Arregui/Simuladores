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
import { setupReplay } from './replay.js';
import { asFileName, logsFromResponse, preview } from '../../lib/logs/logs.js';
import { checkDiagram, checkLogs, checkSimulation, diagramOf, diagramOfDefinitions } from '../../lib/logs/checks.js';
import { graphFromBpmn, graphFromRegistry } from '../../lib/scene/scene.js';
import sceneModule from '../../lib/scene/view.js';

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
      AddExporter,
      sceneModule
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
  // true si lo ha abierto. Si no, dice por que con `report`: de entrada, en una
  // ventana; al cargar una simulacion, en su mensaje (6.8).
  async function openDiagram(xml, report = null) {
    const tell = report || (message => window.alert(message));

    // Old Scheduler models must not silently become ordinary tasks.
    const documentXml = new DOMParser().parseFromString(xml, 'application/xml');
    const hasScheduler = Array.from(documentXml.getElementsByTagName('*')).some(element =>
      (element.namespaceURI === 'http://example.com/custom' && element.localName.toLowerCase() === 'scheduler') ||
      element.getAttributeNS('http://example.com/custom', 'type') === 'scheduler' ||
      element.getAttribute('isScheduler') === 'true' ||
      element.getAttribute('data-type') === 'scheduler'
    );
    if (hasScheduler) {
      tell('Este modelo contiene Scheduler, que ya no está disponible. No se ha importado ni modificado el archivo.');
      return false;
    }
    try {
      await bpmnModeler.importXML(xml);
      return true;
    } catch (err) {
      if (!report) console.error('Error during importXML:', err);
      tell(`No se pudo abrir el diagrama: ${err.message}`);
      return false;
    }
  }

  // Un diagrama se abre; unos registros (.xes), con su diagrama si viene, se
  // cargan para reproducirlos (6.8).
  function registerFileDrop(container, callback, onLogs) {
    function handleFileSelect(e) {
      e.stopPropagation();
      e.preventDefault();
      const files = e.dataTransfer ? e.dataTransfer.files : e.target.files;
      if (!files || files.length === 0) return console.error('No se encontró un archivo para procesar.');
      if (onLogs && Array.from(files).some(item => /\.xes$/i.test(item.name))) {
        onLogs(Array.from(files));
        if (e.target && e.target.value) e.target.value = '';
        return;
      }
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

  // Lo que se guarda con Ctrl+S y lo que se manda al simular. Con formato, un
  // elemento por linea, como lo guarda Camunda Modeler: en una sola linea, un
  // cambio cualquiera hacia ilegible la diferencia entre dos versiones.
  async function exportDefinitionsXML(modeler) {
    const moddle = modeler.get('moddle');
    const defs = modeler.get('canvas').getRootElement().businessObject.$parent;
    hardCleanDefinitions(modeler); // limpieza fuerte antes de serializar
    const { xml } = await moddle.toXML(defs, { format: true });
    return xml;
  }

  // Un fichero de texto, en UTF-8. downloadjs trata como binaria una cadena con
  // algun caracter entre \x80 y \xff y escribe un byte por caracter: una «ó» o
  // una «ñ» acababan en un byte suelto, y el fichero, que dice ser UTF-8, no se
  // podia leer. Con un Blob la codificacion la hace el navegador.
  function downloadText(text, fileName) {
    download(new Blob([ text ], { type: 'application/xml;charset=utf-8' }), fileName, 'application/xml');
  }

  // El diagrama abierto, como se guarda y se manda al simular: limpio.
  async function savedDiagramXML() {
    await sanitizeModel(bpmnModeler);
    return exportDefinitionsXML(bpmnModeler);
  }

  async function downloadDiagram() {
    try {
      const xml = await savedDiagramXML();
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

  registerFileDrop(document.getElementById('canvas'), openDiagram, files => loadSimulationFiles(files));

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
  const replayButton = document.getElementById('js-replay');
  const loadButton = document.getElementById('js-load');
  const loadInput = document.getElementById('js-load-input');
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
  const downloadDiagramButton = document.getElementById('download-diagram');
  const resultsBox = document.getElementById('simulation-results');
  const previewTitle = document.getElementById('simulation-preview-title');
  const previewNote = document.getElementById('simulation-preview-note');
  let simulationRunning = false;
  let loading = false;
  let lastSimulation = null;

  // La reproduccion de la ultima simulacion sobre el diagrama abierto (6.7).
  // Una simulacion es del diagrama que se simulo: al abrir otro, no se puede
  // reproducir hasta simularlo. Sus registros se siguen viendo en «Última
  // simulación».
  let replayLogs = null;

  // Y lo que se sabe de sus registros (lib/logs/checks.js, checkLogs), para
  // volver a compararlos con el diagrama al reproducir: puede haber cambiado.
  let replayChecked = null;
  const replay = setupReplay(bpmnModeler, {
    onError: message => setSimulationStatus(message, 'error'),
    onExit: () => replayButton.focus()
  });

  // Cada diagrama que se abre tiene su numero: una simulacion solo se puede
  // reproducir sobre el diagrama que se simulo, aunque se abra otro mientras
  // el Backend responde.
  let openedDiagram = 0;
  bpmnModeler.on('import.done', () => {
    openedDiagram += 1;
    replayLogs = null;
    replayChecked = null;
    replayButton.disabled = true;
  });
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
    downloadDiagramButton.hidden = !result.diagramXML;
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

  // El diagrama que se simulo, tal como se mando: con los registros, es lo que
  // hace falta para volver a cargar la simulacion y reproducirla igual (6.8).
  downloadDiagramButton.addEventListener('click', () => {
    if (lastSimulation === null || !lastSimulation.diagramXML) return;
    downloadText(lastSimulation.diagramXML, `${asFileName(lastSimulation.modelName) || 'diagrama'}.bpmn`);
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
    if (simulationRunning || loading) return;

    simulationRunning = true;
    simulateButton.disabled = true;
    replayButton.disabled = true;
    loadButton.disabled = true;
    const simulatedDiagram = openedDiagram;
    simulateButton.textContent = 'Simulando…';
    simulateButton.setAttribute('aria-busy', 'true');
    setSimulationStatus('Preparando el modelo para simular…', 'running');
    let timer;

    try {
      const diagramXML = await savedDiagramXML();
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

      // Un XES por pool (D10); el reunido ya no viene en la respuesta (5.6).
      const logs = logsFromResponse(data);
      const warnings = Array.isArray(data.warnings)
        ? data.warnings.filter(warning => typeof warning === 'string')
        : [];

      lastSimulation = {
        logs, warnings, simulationId: data.simulationId, seed: data.seed, modelName: data.model?.name, diagramXML
      };

      // Se reproduce sobre el diagrama simulado, si sigue abierto, y si los
      // registros son suyos: se comprueban como los cargados de disco (6.8), y
      // se reproducen en el orden de sus pools.
      const sameDiagram = simulatedDiagram === openedDiagram;
      const checked = sameDiagram
        ? checkSimulation(logs.map(({ pool, name, xes }) => ({ pool, name, xes })), { diagram: currentDiagram(diagramXML) })
        : null;
      const byPool = new Map(logs.map(log => [ log.pool, log ]));
      replayLogs = sameDiagram && !checked.problems.length ? checked.logs.map(log => byPool.get(log.pool)) : null;
      replayChecked = replayLogs && checked;
      if (replay.isOpen) replay.close();
      lastSimulationButton.disabled = false;
      const registros = logs.length === 1 ? '1 registro XES' : `${logs.length} registros XES, uno por pool`;
      const otro = !sameDiagram ? ' Mientras se simulaba se abrió otro diagrama: esta simulación no se puede reproducir sobre él.'
        : checked.problems.length ? ` No se puede reproducir: ${checked.problems.join(' ')}`
          : checked.warnings.length ? ` ${checked.warnings.join(' ')}` : '';
      if (warnings.length) {
        const count = warnings.length === 1 ? '1 aviso' : `${warnings.length} avisos`;
        setSimulationStatus(`Simulación completada con ${count}: ${registros}. Puedes revisarlos en «Última simulación».${otro}`, 'warning');
      } else {
        setSimulationStatus(`Simulación completada: ${registros}. Están disponibles en «Última simulación».${otro}`,
          otro ? 'warning' : 'success');
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
      loadButton.disabled = false;
      replayButton.disabled = replayLogs === null;
      simulateButton.textContent = 'Simular';
      simulateButton.removeAttribute('aria-busy');
    }
  });

  lastSimulationButton.addEventListener('click', () => {
    if (lastSimulation !== null) {
      showSimulationResults('Última simulación completada', lastSimulation);
    }
  });

  // Si desde que se simulo o se cargo se ha quitado del diagrama algo por lo que
  // pasan sus casos, ya no se puede reproducir sobre el, y se dice por que.
  replayButton.addEventListener('click', () => {
    if (replayLogs === null || simulationRunning || loading) return;
    const now = replayChecked ? checkDiagram(replayChecked, currentDiagram(null)) : { problems: [] };
    if (now.problems.length) {
      setSimulationStatus(`No se puede reproducir: ${now.problems.join(' ')}`, 'error');
      return;
    }
    replay.open(replayLogs);
  });

  // Lo que hay que saber del diagrama abierto para compararlo con unos
  // registros; `xml`, su texto, para la huella.
  function currentDiagram(xml) {
    return diagramOf(bpmnModeler.get('elementRegistry'), bpmnModeler.get('canvas').getRootElement(), xml);
  }

  // Cargar de disco una simulacion guardada (6.8): sus registros, uno por pool,
  // y, si viene, el diagrama con el que se guardo, que se abre. Sin diagrama, se
  // reproduce sobre el abierto. Antes de abrir nada se comprueba que el
  // conjunto vale, tambien con el diagrama que viene -leido sin abrirlo, como
  // lo abriria bpmn-js-, y que se puede reproducir sobre el; si algo no vale,
  // se dice por que y no se carga nada: siguen el diagrama y la simulacion de
  // antes. Si vale, se reproduce, y queda como la ultima simulacion, para verla
  // o descargarla. Mientras se carga no se puede simular, ni cargar mientras
  // se simula.
  async function loadSimulationFiles(files) {
    if (simulationRunning) {
      showSimulationMessage('No se pueden cargar los registros',
        'Se está simulando: espera a que termine para cargar otra simulación.', 'error');
      return;
    }
    if (loading) return;
    loading = true;
    simulateButton.disabled = true;
    loadButton.disabled = true;
    try {
      await loadFiles(files);
    } catch (err) {

      // Lo que no se esperaba tambien se dice, y no se carga nada.
      console.error('Error al cargar los registros:', err);
      setSimulationStatus('No se han cargado los registros.', 'error');
      showSimulationMessage('No se pueden cargar los registros', `Se produjo un error inesperado: ${err.message}`, 'error');
    } finally {
      loading = false;
      simulateButton.disabled = false;
      loadButton.disabled = false;
      replayButton.disabled = replayLogs === null;
    }
  }

  async function loadFiles(files) {
    let read;
    try {
      read = await Promise.all(files.map(async file => ({ name: file.name, text: await file.text() })));
    } catch (err) {
      showSimulationMessage('No se pueden cargar los registros', `No se pudo leer un fichero: ${err.message}`, 'error');
      return;
    }
    const diagrams = read.filter(file => /\.(bpmn|xml)$/i.test(file.name));
    const xes = read.filter(file => /\.xes$/i.test(file.name));
    const problems = read.filter(file => !diagrams.includes(file) && !xes.includes(file))
      .map(file => `No se sabe qué es «${file.name}»: se cargan registros .xes y, si acaso, el diagrama .bpmn que se simuló.`);
    if (diagrams.length > 1) problems.push(`Hay más de un diagrama: ${diagrams.map(file => `«${file.name}»`).join(', ')}.`);
    if (!xes.length) problems.push('No hay ningún registro .xes.');
    const fail = list => {
      setSimulationStatus('No se han cargado los registros.', 'error');
      showSimulationMessage('No se pueden cargar los registros', list.join('\n'), 'error');
    };
    if (problems.length) return fail(problems);
    const checked = checkLogs(xes.map(file => ({ xes: file.text, fileName: file.name })));
    if (checked.problems.length) return fail(checked.problems);

    // El diagrama sobre el que se van a reproducir: el que viene, todavia sin
    // abrir, o el abierto, tal como se guarda.
    const given = diagrams[0];
    let xml, diagram, graph;
    if (given) {
      xml = given.text;
      try {
        const { rootElement } = await bpmnModeler.get('moddle').fromXML(xml, 'bpmn:Definitions');
        diagram = diagramOfDefinitions(rootElement, xml);

        // Los flujos que dibujaria, como los que da graphFromRegistry una vez
        // abierto.
        const drawn = new Set(diagram.elements);
        const flows = graphFromBpmn(xml);
        graph = { sequenceFlows: flows.sequenceFlows.filter(flow => drawn.has(flow.id)),
          messageFlows: flows.messageFlows.filter(flow => drawn.has(flow.id)) };
      } catch (err) {
        return fail([ `No se puede leer el diagrama «${given.name}»: ${err.message}.` ]);
      }
    } else {
      await sanitizeModel(bpmnModeler);
      xml = await exportDefinitionsXML(bpmnModeler);
      diagram = currentDiagram(xml);
      graph = graphFromRegistry(bpmnModeler.get('elementRegistry'));
    }
    const compared = checkDiagram(checked, diagram);
    if (compared.problems.length) return fail(compared.problems);
    const logs = logsFromResponse({ logs: checked.logs.map(log => ({ pool: log.pool, name: log.name, xes: log.xes })) });
    let timeline;
    try {
      timeline = replay.prepare(logs, graph);
    } catch (err) {
      return fail([ `Los registros no se pueden reproducir: ${err.message}` ]);
    }

    // Si con el diagrama ya abierto algo no fuera como se ha comprobado sin
    // abrirlo, se vuelve al de antes -sin su historial de deshacer- y a su
    // simulacion.
    const before = given ? { xml: await exportDefinitionsXML(bpmnModeler), logs: replayLogs, checked: replayChecked } : null;
    const back = async list => {
      if (before && await openDiagram(before.xml, () => {})) {
        replayLogs = before.logs;
        replayChecked = before.checked;
      }
      fail(list);
    };
    if (given) {
      let why = null;
      if (!(await openDiagram(xml, message => {
        why = message;
      }))) return fail([ `${why || 'No se pudo abrir el diagrama.'} («${given.name}»)` ]);

      // Y con el abierto, como lo ha dibujado bpmn-js.
      const opened = checkDiagram(checked, currentDiagram(xml));
      if (opened.problems.length) return back(opened.problems);
    }
    let why = null;
    if (!replay.open(logs, timeline, message => {
      why = message;
    })) return back([ why || 'Los registros no se pueden reproducir.' ]);

    // Se puede volver a guardar con el diagrama que vino con ella o, sin el, con
    // el abierto si es el que se simulo.
    const common = checked.common;
    const simulated = given || (common['model:diagramSha256'] && !compared.warnings.length);
    lastSimulation = {
      logs, warnings: compared.warnings, simulationId: common['simulation:id'], seed: Number(common['simulation:seed']),
      modelName: common['model:name'], diagramXML: simulated ? xml : null
    };
    replayLogs = logs;
    replayChecked = checked;
    lastSimulationButton.disabled = false;
    replayButton.disabled = false;
    const registros = logs.length === 1 ? '1 registro' : `${logs.length} registros`;
    setSimulationStatus(`Cargada de disco la simulación ${common['simulation:id']}: ${registros}.` +
      `${compared.warnings.length ? ` ${compared.warnings.join(' ')}` : ''}`, compared.warnings.length ? 'warning' : 'success');
  }

  loadButton.addEventListener('click', () => {
    if (!simulationRunning) loadInput.click();
  });
  loadInput.addEventListener('change', async () => {
    const files = Array.from(loadInput.files || []);
    loadInput.value = '';
    if (files.length) await loadSimulationFiles(files);
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
