// La barra de reproduccion del visualizador (6.7): reproduce la ultima
// simulacion sobre el diagrama abierto, con sus registros como unica fuente
// (D15).
//
// «Reproducir» abre la barra debajo del lienzo y «Salir» la cierra y borra lo
// dibujado. En la barra:
//
// - Reproducir y pausar, con la velocidad en segundos simulados por segundo
//   real; volver al principio, y saltar al cambio anterior o al siguiente.
// - La barra de tiempo, para arrastrar, y el instante exacto: se escribe y se
//   salta a el sin redondear.
// - La convocatoria que se reproduce, si hay varias, o todas. Es el alcance de
//   la reproduccion: la escena se hace solo con sus casos, asi que todo lo que
//   se dibuja y se cuenta -pelotas, sobres, insignias, buzones, plantillas y
//   su cola, resumen- es de ella. Las rondas van seguidas: en su ultimo
//   instante, la siguiente ya ha empezado, y no se ve.
// - El filtro de casos, dentro de la convocatoria: por pool, sus numeros
//   -«1-3, 7»-; vacio, todos. Oculta el resto, pero no cambia ningun
//   recuento: siguen siendo los de la convocatoria.
// - Un resumen de cada pool en el instante: cuantos casos estan en curso,
//   cuantos por llegar y cuantos han terminado, de todos los de la
//   convocatoria, y cuantos se ven.
//
// Cada vez que se dibuja, se dibuja el instante entero desde la linea de
// tiempo (lib/player, lib/scene): lo que se ve no depende de lo que se vio
// antes. Mientras se reproduce, las pelotas y los sobres recorren sus flujos
// (el transito, cosmetico); en pausa, cada uno esta donde esta en ese
// instante, asi que pausar en t y saltar a t dan el mismo dibujo. El instante
// exacto que se dibuja queda en data-t de la barra.

import { timelineFromLogs } from '../../lib/timeline/timeline.js';
import { SPEEDS, changesIn, convocatoriasOf, createClock, defaultSpeed, nextChange, previousChange, summaryAt,
  visibleCases, windowOf } from '../../lib/player/player.js';

// Lo que dura en pantalla, en segundos reales, el transito mientras se
// reproduce: a mas velocidad, mas segundos simulados.
const TRANSIT = 0.4;

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const format = t => String(Number(t.toFixed(3)));

export function setupReplay(modeler, { onError, onExit = () => {} }) {
  const sceneView = modeler.get('sceneView');
  const element = id => document.getElementById(id);
  const bar = element('replay');
  const play = element('replay-play');
  const time = element('replay-time');
  const instant = element('replay-instant');
  const speed = element('replay-speed');
  const call = element('replay-call');
  const callBox = element('replay-call-box');
  const filters = element('replay-filters');
  const summary = element('replay-summary');

  let timeline = null;
  let scoped = null;
  let span = null;
  let changes = [];
  let clock = null;
  let filter = {};
  let visible = null;
  let frame = null;

  // Si se ha escrito en el instante exacto y aun no se ha saltado: mientras
  // no, el campo sigue al reloj, y Ir o Intro no mueven nada.
  let edited = false;

  speed.replaceChildren(...SPEEDS.map(value => new Option(`× ${value}`, String(value))));

  const now = () => performance.now();

  function describe(t) {
    const lines = summaryAt(scoped, t, span, visible.cases).map(pool => {
      const shown = pool.shown < pool.total ? ` · se ${pool.shown === 1 ? 've' : 'ven'} ${pool.shown} de ${pool.total}` : '';
      return `${pool.name || pool.pool}: ${pool.active} en curso · ${pool.pending} por llegar · ` +
        `${plural(pool.finished, 'terminado', 'terminados')}${shown}`;
    });
    const errors = Object.entries(visible.errors).map(([ pool, error ]) => {
      const named = timeline.pool(pool);
      return `Filtro de ${(named && named.name) || pool}: ${error}; no se filtra.`;
    });
    summary.replaceChildren(...[ ...lines, ...errors ].map((text, i) => {
      const line = document.createElement('span');
      line.textContent = text;
      if (i >= lines.length) line.className = 'replay-error';
      return line;
    }));
  }

  // Dibuja el instante del reloj y pone la barra al dia.
  function render() {
    const t = clock.at(now());
    sceneView.show(t, { transit: clock.playing ? TRANSIT * clock.speed : 0, cases: visible.cases });
    bar.dataset.t = String(t);
    bar.dataset.playing = String(clock.playing);
    time.value = String(t);
    if (!edited) {
      instant.value = format(t);
      instant.setAttribute('aria-invalid', 'false');
    }
    play.textContent = clock.playing ? 'Pausa' : 'Reproducir';
    play.setAttribute('aria-pressed', String(clock.playing));

    // Mientras se reproduce, el resumen cambia en cada fotograma: un lector de
    // pantalla lo lee al pausar.
    summary.setAttribute('aria-live', clock.playing ? 'off' : 'polite');
    describe(t);
    return t;
  }

  function loop() {
    frame = null;
    render();
    if (clock.playing) frame = requestAnimationFrame(loop);
  }

  function stopLoop() {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  }

  // Saltar -con los botones, la barra de tiempo o el instante exacto- deja de
  // lado lo que se estuviera escribiendo en el instante exacto.
  function seek(t) {
    edited = false;
    clock.seek(t, now());
    render();
  }

  // Una convocatoria -o todas, con null-: su ventana y su escena, solo con sus
  // casos, en pausa al principio.
  function choose(value) {
    stopLoop();
    span = windowOf(timeline, value);
    scoped = value === null ? timeline : timeline.only(span.cases);
    try {
      sceneView.load(scoped);
    } catch (error) {
      close();
      onError(`No se puede reproducir la convocatoria ${value}: ${error.message}`);
      return false;
    }
    changes = changesIn(scoped, span);
    const kept = clock ? clock.speed : defaultSpeed(span.end - span.start);
    clock = createClock({ start: span.start, end: span.end, speed: kept });
    speed.value = String(kept);
    for (const input of [ time, instant ]) {
      input.min = String(span.start);
      input.max = String(span.end);
    }
    visible = visibleCases(timeline, span, filter);
    render();
    return true;
  }

  function filterInputs() {
    filters.replaceChildren(...timeline.pools.map(pool => {
      const label = document.createElement('label');
      label.className = 'replay-filter';
      const name = document.createElement('span');
      name.textContent = pool.name || pool.id;
      const input = document.createElement('input');
      input.type = 'text';
      input.dataset.pool = pool.id;
      input.placeholder = 'todos';
      input.title = `Los numeros de los casos de ${pool.name || pool.id} que se ven: p. ej. 1-3, 7; vacio, todos`;
      input.addEventListener('input', () => {
        filter = { ...filter, [pool.id]: input.value };
        visible = visibleCases(timeline, span, filter);
        input.setAttribute('aria-invalid', String(pool.id in visible.errors));
        render();
      });
      label.append(name, input);
      return label;
    }));
  }

  function open(logs) {
    close();
    let loaded;
    try {
      loaded = timelineFromLogs(logs);
      sceneView.load(loaded);
    } catch (error) {
      sceneView.clear();
      onError(`No se puede reproducir la simulación: ${error.message}`);
      return false;
    }
    timeline = loaded;
    clock = null;
    filter = {};
    edited = false;
    const calls = convocatoriasOf(timeline);
    call.replaceChildren(...calls.map(group => new Option(`${group.call} · ${format(group.start)}–${format(group.end)} s`,
      String(group.call))), ...(calls.length > 1 ? [ new Option('Todas', '') ] : []));
    callBox.hidden = calls.length < 2;
    filterInputs();
    if (!choose(calls[0].call)) return false;
    bar.hidden = false;
    document.body.classList.add('replaying');
    place();
    fit();
    play.focus();
    return true;
  }

  // La barra empieza a la derecha de la paleta, para no taparla.
  function place() {
    const palette = document.querySelector('.djs-palette');
    const right = palette && palette.offsetParent !== null ? palette.getBoundingClientRect().right : 0;
    bar.style.left = `${Math.max(16, right + 12)}px`;
  }

  // Encajar el diagrama y lo dibujado en lo que dejan libre la paleta, el reloj
  // y la propia barra.
  function fit() {
    const canvas = modeler.get('canvas').getContainer().getBoundingClientRect();
    const palette = document.querySelector('.djs-palette');
    const covered = palette && palette.offsetParent !== null ? palette.getBoundingClientRect() : null;
    const below = bar.getBoundingClientRect();
    sceneView.fit(10, {
      left: covered ? Math.max(0, covered.right - canvas.left + 8) : 0,
      top: 44,
      bottom: Math.max(0, canvas.bottom - below.top + 8)
    });
  }

  function close() {
    stopLoop();
    if (timeline) sceneView.clear();
    timeline = null;
    scoped = null;
    edited = false;
    bar.hidden = true;
    delete bar.dataset.t;
    document.body.classList.remove('replaying');
  }

  play.addEventListener('click', () => {
    edited = false;
    if (clock.playing) {
      clock.pause(now());
      stopLoop();
      render();
    } else {
      clock.play(now());
      render();
      frame = requestAnimationFrame(loop);
    }
  });
  element('replay-start').addEventListener('click', () => seek(clock.start));
  element('replay-previous').addEventListener('click', () => seek(previousChange(changes, clock.at(now()))));
  element('replay-next').addEventListener('click', () => seek(nextChange(changes, clock.at(now()))));
  time.addEventListener('input', () => seek(Number(time.value)));

  // El instante exacto: al pulsar Ir o Intro, si se ha escrito uno. Lo que
  // muestra el campo va redondeado: saltar a eso sin haberlo tocado movia el
  // instante.
  instant.addEventListener('input', () => {
    edited = true;
  });
  const go = () => {
    if (!edited) return;
    const value = Number(instant.value);
    if (instant.value.trim() === '' || !Number.isFinite(value)) {
      instant.setAttribute('aria-invalid', 'true');
      return;
    }
    edited = false;
    seek(value);
  };
  element('replay-go').addEventListener('click', go);
  instant.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      go();
    }
  });
  speed.addEventListener('change', () => {
    clock.setSpeed(Number(speed.value), now());
    render();
  });
  call.addEventListener('change', () => choose(call.value === '' ? null : Number(call.value)));
  element('replay-exit').addEventListener('click', () => {
    close();
    onExit();
  });
  window.addEventListener('resize', () => {
    if (timeline) place();
  });
  modeler.get('eventBus').on('canvas.resized', () => {
    if (timeline) place();
  });

  // Otro diagrama: la simulacion era del anterior, y la vista ya se ha limpiado.
  modeler.get('eventBus').on('diagram.clear', () => {
    if (timeline) close();
  });

  return {
    open,
    close,
    get isOpen() {
      return timeline !== null;
    }
  };
}
