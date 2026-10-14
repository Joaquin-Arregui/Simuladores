"""Runtime embedded in generated scripts; configuration comes from generateScript.

Tokens are registered before SimPy runs their processes, so gateway decisions
do not depend on which sibling SimPy executes first at a given instant. Token
bookkeeping is kept per instance, so each step only revisits its own joins.
One unit of simulated time is one second.
"""

from collections import Counter, defaultdict, deque
import json
import os
from typing import NamedTuple
from datetime import datetime, timedelta, timezone
from html import escape
from xml.etree import ElementTree as ET


class SimulationError(RuntimeError):
    """A model cannot complete with the configured tokens, messages or data."""


class Caso(NamedTuple):
    """Quien ejecuta: participante, indice dentro de ese participante, convocatoria.

    Sustituye a la cadena 'Instance N', que hacia de clave de mensajes, datos,
    tokens, uniones y traza a la vez. La clave de un mensaje es ya el caso
    entero; el indice se guarda aparte porque el registro lo necesita y porque
    con el se encuentran por primera vez los dos pools de una colaboracion 1:1.

    El indice no se repite dentro de un participante en toda la simulacion: los
    orquestados de la segunda convocatoria siguen numerando donde acabaron los
    de la primera (D3). Dos rondas no comparten ni un caso ni una traza.
    """
    participante: str
    indice: int
    convocatoria: int = 1

    def __str__(self):
        return f'{self.participante} - {self.indice}'


def casos_de(participante, convocatoria):
    """Los casos de un pool en una convocatoria, hayan arrancado o no.

    La difusion necesita esta lista completa: un mensaje dirigido a un caso que
    todavia no ha arrancado tiene que quedarse esperandole, no perderse. Por eso
    la tabla de cada convocatoria se construye entera antes de lanzar ninguno de
    sus eventos (_abre_convocatoria).

    Solo existe la de la convocatoria en curso: las anteriores ya terminaron y
    las siguientes no se han abierto, asi que nadie de otra ronda puede escribir
    a esta ni recibir de ella. Pedir otra es un fallo del motor, no del modelo.
    """
    if convocatoria != convocatoriaActual:
        raise RuntimeError(f'Se han pedido los casos de {participante} de la convocatoria '
                           f'{convocatoria} durante la {convocatoriaActual}.')
    return casosPorParticipante[participante]


def caso_arrancado(caso):
    """Si su evento de inicio ya ha pasado su retardo de llegada."""
    return caso in casosArrancados


def etiqueta_de_traza(caso):
    # El nombre definitivo de la traza lo fija la tarea 1.6. Hasta entonces, un
    # Process conserva el nombre de siempre. Se mira isProcess y no el numero de
    # participantes: una colaboracion de un solo pool sigue siendo una
    # colaboracion, y su traza se llama por el pool.
    if isProcess:
        return f'Instance {caso.indice}'
    return f'{caso.participante} - {caso.indice}'


def etiqueta_de_caso(caso):
    """El caso, o vacio cuando no hay ninguno.

    Un envio a un pool externo no tiene caso destino: el registro deja el
    atributo en blanco en vez de inventarse uno.
    """
    return '' if caso is None else str(caso)


def xml_value(value):
    return escape(str(value), quote=True)


def resolve_task_time(max_time, min_time):
    # A normal clipped to [min_time, max_time], not truncated: a draw outside
    # is not redrawn, it takes the nearest bound (about 0.13 % at each one).
    duration = max(min_time, min(random.gauss((min_time + max_time) / 2,
                                             (max_time - min_time) / 6), max_time))
    # Rounding must not turn a positive-duration task into a zero-time loop.
    return max(1 if min_time > 0 else 0, round(duration))


def resolve_possible_users(possibleUsers, taskName):
    # taskUsers holds the users of the task's innermost lane with users (or of
    # its participant); without an entry, a Process uses its own users.
    base = taskUsers.get(taskName)
    if possibleUsers is None:
        users = list(base) if base is not None else list(processUsers)
    elif isProcess:
        users = []
        for item in possibleUsers:
            users.extend(rolePool.get(item, [item]))
        if base is not None:
            users = [user for user in users if user in base]
    else:
        users = [user for user in possibleUsers if user in (base or ())]
    if not users:
        raise SimulationError(f'No hay usuarios disponibles para la tarea {taskName}.')
    return list(dict.fromkeys(users))


class UserQueue:
    """Reparte los usuarios de UN pool por orden de llegada.

    Hay una cola por participante: dos pools que declaran el mismo nombre tienen
    cada uno a su persona y no se la quitan. Una peticion toma al momento un
    usuario libre y elegible, prefiriendo al que menos ha trabajado; si no hay,
    espera, y cada usuario liberado va a la peticion mas antigua que pueda
    usarlo.

    Con recursos infinitos se concede siempre al instante y sin ocupar a nadie:
    el pool orquestado se simula asi porque su contencion no es lo que se quiere
    medir, y entonces no puede registrar ni una espera.
    """

    def __init__(self, users, infinite=False):
        self.users = list(users)
        self.free = set(users)
        self.waiting = deque()
        self.infinite = infinite
        self.assignments = dict.fromkeys(users, 0)

    def acquire(self, eligible):
        request = env.event()
        candidates = [user for user in eligible if self.infinite or user in self.free]
        if candidates:
            self._assign(request, min(candidates, key=lambda user: self.assignments.get(user, 0)))
        else:
            self.waiting.append((request, eligible))
        return request

    def release(self, user):
        if self.infinite:
            return
        self.free.add(user)
        for index, (request, eligible) in enumerate(self.waiting):
            if user in eligible:
                del self.waiting[index]
                self._assign(request, user)
                return

    def _assign(self, request, user):
        if not self.infinite:
            self.free.discard(user)
        self.assignments[user] = self.assignments.get(user, 0) + 1
        request.succeed(user)


def cola_de(taskName):
    """La cola del pool al que pertenece esa tarea."""
    return colasPorParticipante[elementParticipant[taskName]]


def adquirir_usuario(taskName, possibleUsers):
    return cola_de(taskName).acquire(possibleUsers)


def liberar_usuario(taskName, user):
    cola_de(taskName).release(user)


def nuevo_contexto(padres):
    """Identidad del token que se crea, con los contextos de los que viene.

    Cada token estrena contexto, y eso es lo que distingue dos activaciones de
    la MISMA recepcion: las dos numeran sus ejecuciones desde 1, asi que sin
    esto comparten anotacion y una respuesta vuelve a quien no escribio. El ID
    de la recepcion no basta, porque es el mismo en las dos.

    Los padres hacen que una respuesta siga encontrando la anotacion de una
    recepcion anterior de su camino, aunque entre las dos haya habido un corte o
    una union: _anotacion sube por ellos. Una union tiene varios padres, los de
    los tokens que ha juntado, porque la respuesta puede estar respondiendo a
    algo recogido en cualquiera de sus ramas.
    """
    global contador_contextos
    contador_contextos += 1
    contextos_padres[contador_contextos] = tuple(padres)
    return contador_contextos


def _anotacion(caso, recepcion, execution, contexto):
    """El remitente que anoto esa recepcion para este token.

    Se sube por los contextos de los que viene el token hasta encontrarlo, que
    es lo que permite responder a algo recogido antes de un corte o al otro lado
    de una union.

    La subida se para en el primer contexto que tenga ALGUNA anotacion de esa
    recepcion, o que la haya cerrado vacia: si esa activacion recogio menos
    sobres de los que esta respuesta pide, lo honesto es quedarse sin anotacion
    y que el destino salga de las cardinalidades, no heredar el remitente de una
    activacion anterior. Desde la 3.2 una respuesta multiinstancia pide tantos
    como se recogieron (cardinalidad_del_envio), asi que no deberia pasar.
    """
    vistos, frontera = {contexto}, [contexto]
    while frontera:
        siguiente = []
        for ctx in frontera:
            anotado = correspondientes.get((caso, ctx, recepcion, execution))
            if anotado is not None:
                return anotado
            if (caso, ctx, recepcion) in recepciones_anotadas:
                return None
            for padre in contextos_padres.get(ctx, ()):
                if padre not in vistos:
                    vistos.add(padre)
                    siguiente.append(padre)
        frontera = siguiente
    return None


def destino_de(origin, target, caso, execution, contexto, destinatarios=None):
    """El caso al que va un sobre, o None si ninguna regla le asigna uno.

    Un sobre tiene un solo destinatario. Cuatro reglas, y el orden importa:

    1. Si este envio responde a una recepcion y esa recepcion anoto un remitente
       en ESTA ejecucion, la respuesta vuelve a quien escribio. La anotacion es
       por recepcion y por ejecucion: por ejecucion porque con N a 1 una sola
       anotacion mandaria todas las respuestas al ultimo remitente recogido, y
       por recepcion y por token porque cada activacion de una tarea numera sus
       ejecuciones desde 1, asi que dos recepciones del mismo caso, o dos
       activaciones de la misma, se pisarian el contexto. A que recepcion
       responde cada envio lo resuelve resolve_reply_contexts sobre el dibujo.
    2. Si el pool de enfrente tiene un solo caso, ese es el destino. Es el N a 1:
       los N orquestados escriben al unico orquestador.
    3. Si los dos pools tienen el mismo numero de casos, se emparejan por
       indice. Es el 1:1 que D2 conserva en una colaboracion sin marcadores, y va
       antes que la regla siguiente para que N contra N no se cruce.
    4. Si quien envia es un pool de un solo caso, cada ejecucion escribe a UN
       caso: el que ocupa esa posicion en el pool de enfrente. Es el 1 a N, y el
       caso destino no tiene que haber arrancado, por eso la tabla de casos se
       construye entera antes de lanzar nada (2.2).

    Un envio multiinstancia que abre la conversacion no pasa por las reglas 2 a
    4: trae ya sus destinatarios, los casos vivos de enfrente que conto al
    activarse (cardinalidad_del_envio), y la ejecucion i escribe al i-esimo.

    Sin regla aplicable no hay destino y publish_message lo dice: entre 3 casos
    y 5 no hay emparejamiento que el motor pueda adivinar.

    Las reglas solo cuentan los casos de la convocatoria del remitente: en cada
    una hay un orquestador y sus N orquestados, y nadie escribe a otra ronda.
    """
    recepcion = recepcionDeRespuesta.get(origin)
    if recepcion is not None:
        anotado = _anotacion(caso, recepcion, execution, contexto)
        if anotado is not None:
            return anotado
    if destinatarios is not None:
        return destinatarios[execution - 1] if 1 <= execution <= len(destinatarios) else None
    participante = elementParticipant[target]
    enfrente = casos_de(participante, caso.convocatoria)
    propios = casos_de(caso.participante, caso.convocatoria)
    if len(enfrente) == 1:
        return enfrente[0]
    if len(enfrente) == len(propios):
        return next((otro for otro in enfrente if otro.indice == caso.indice), None)
    if len(propios) == 1 and 1 <= execution <= len(enfrente):
        return enfrente[execution - 1]
    return None


def solicitud_de(tarea, caso, execution, contexto):
    """La solicitud que atiende una ejecucion: el caso que escribio a la
    recepcion de la que viene su lote, o a la que responde (6.1).

    Es la misma anotacion con la que una respuesta vuelve a quien escribio
    (destino_de, regla 1), asi que la evaluacion i y la respuesta i dicen la
    misma solicitud que la recepcion i. Una tarea que no trabaja un lote ni
    responde a nadie no atiende ninguna: None.
    """
    recepcion = loteDeEvaluacion.get(tarea) or recepcionDeRespuesta.get(tarea)
    return None if recepcion is None else _anotacion(caso, recepcion, execution, contexto)


def atributo_de_solicitud(solicitud):
    """bpmn:request en el evento de una ejecucion, o nada si no atiende a nadie."""
    if solicitud is None:
        return ''
    return f'\n            <string key="bpmn:request" value="{xml_value(solicitud)}"/>'


def publish_message(origin, target, execution, caso, contexto, destinatarios=None):
    """Deja el sobre en el buzon de su caso destino y devuelve ese caso.

    El sobre lleva el remitente y nada mas: con el gateway de porcentajes el
    veredicto del orquestador no decide la rama del orquestado, asi que no viaja
    resultado, ni motivo, ni etapa, ni caracter. Tampoco lleva numero de
    ejecucion, porque la ejecucion es de quien abre el sobre y no del sobre: por
    eso N sobres comparten el buzon de un mismo caso y el lote se acumula ahi
    hasta que alguien lo recoge.
    """
    if target in destinosExternos:
        # El MessageFlow apunta al pool, no a un receptor: el mensaje sale de la
        # simulacion y nadie lo recoge. validate_simulation ya lo avisa y el
        # emisor sigue su camino, que es lo que hacia antes de la clave por caso
        # destino. No es lo mismo que un receptor sin caso al que dirigirse.
        return None
    destino = destino_de(origin, target, caso, execution, contexto, destinatarios)
    if destino is None:
        raise SimulationError(
            f'El mensaje de {origin} a {target} no tiene caso destino: lo envia '
            f'{caso} en su ejecucion {execution}, y el pool '
            f'{elementParticipant[target]} tiene '
            f'{len(casos_de(elementParticipant[target], caso.convocatoria))} casos frente a los '
            f'{len(casos_de(caso.participante, caso.convocatoria))} del suyo, asi que ninguna regla '
            f'de encaminamiento le asigna un destino.')
    key = (origin, target, destino)
    if message_waiters[key]:
        message_waiters[key].popleft().succeed(caso)
        # Entregado, pero quien lo recoge aun no ha vuelto a ejecutarse para
        # anotarlo: hasta entonces solo se sabe aqui (_pendientes_de_anotar).
        enCamino[key][caso] += 1
    else:
        messages[key].append(caso)
    # Esta ejecucion ya no puede escribir mas: si era lo unico que tenia abierta
    # una recepcion, cierra ahora y no cuando termine el envio entero (D7).
    enviadas.setdefault((caso, contexto, origin), set()).add(execution)
    _revisa_lotes()
    return destino


def wait_for_message(env, origin, target, execution, caso, contexto):
    """Espera un sobre dirigido a este caso y devuelve el caso remitente."""
    key = (origin, target, caso)
    if messages[key]:
        remitente = messages[key].popleft()
    else:
        event = env.event()
        message_waiters[key].append(event)
        remitente = yield event
        enCamino[key][remitente] -= 1
    _anota(caso, contexto, target, execution, remitente)
    return remitente


def _anota(caso, contexto, recepcion, execution, remitente):
    """Un sobre recogido: su remitente, y uno mas en el lote de esa activacion.

    La anotacion es de ESTE token, de ESTA recepcion y de la ejecucion que lo
    recoge: la respuesta de esa misma ejecucion vuelve a ESE remitente, y ni
    otra recepcion del caso ni otra activacion de esta le pisan el contexto. La
    cuenta es lo que luego multiplica a la evaluacion y a la respuesta (D8).
    """
    correspondientes[(caso, contexto, recepcion, execution)] = remitente
    recepciones_anotadas.add((caso, contexto, recepcion))
    clave = (caso, contexto, recepcion)
    lotes[clave] = lotes.get(clave, 0) + 1


def caso_vivo(caso):
    """Si al caso le queda algo por hacer: un token activo o esperando en una union.

    Un caso que todavia no ha arrancado esta vivo, porque sus eventos de inicio
    tienen el token desde el principio aunque esperen a su retardo de llegada.
    """
    return (any(cuenta > 0 for cuenta in active_tokens[caso].values())
            or any(any(esperando.values()) for esperando in pending_joins[caso].values()))


def tamano_del_lote(caso, contexto, recepcion, tarea):
    """Cuantos mensajes recogio la recepcion de la que viene este token (D8).

    Se sube por los contextos del token, como _anotacion, hasta la activacion
    de esa recepcion mas cercana. Cero es un lote valido: una recepcion que
    cierra sin mensajes deja su cuenta a cero, no la deja sin escribir.
    """
    vistos, frontera = {contexto}, [contexto]
    while frontera:
        siguiente = []
        for ctx in frontera:
            cuenta = lotes.get((caso, ctx, recepcion))
            if cuenta is not None:
                return cuenta
            for padre in contextos_padres.get(ctx, ()):
                if padre not in vistos:
                    vistos.add(padre)
                    siguiente.append(padre)
        frontera = siguiente
    raise SimulationError(
        f'{tarea} ({caso}) es multiinstancia y no encuentra en su camino el lote de '
        f'{recepcion}: no sabe cuantas ejecuciones lanzar.')


def cardinalidad_del_envio(tarea, destino, caso, contexto):
    """Cuantas ejecuciones lanza un envio multiinstancia, y a quien escribe cada una.

    Si responde a una recepcion, una por mensaje que esa recepcion recogio, y
    cada ejecucion devuelve el suyo a quien lo escribio (destino_de, regla 1):
    un caso vivo que no escribio no recibe una respuesta que no espera. Si abre
    la conversacion, una por caso vivo del pool de enfrente en su convocatoria,
    en orden de indice, y la ejecucion i escribe al i-esimo: N envios con una
    copia cada uno (2.5).
    Un caso que ya ha terminado no cuenta, porque nadie recogeria su sobre.
    """
    recepcion = recepcionDeRespuesta.get(tarea)
    if recepcion is not None:
        plan = tamano_del_lote(caso, contexto, recepcion, tarea), None
    else:
        vivos = [otro for otro in casos_de(elementParticipant[destino], caso.convocatoria)
                 if caso_vivo(otro)]
        plan = len(vivos), vivos
    # El cierre de las recepciones necesita saber que le queda por escribir a
    # esta activacion (_destinos_de_una_activacion).
    planes[(caso, contexto, tarea)] = plan
    return plan


class Lote:
    """Una activacion de una recepcion multiinstancia, mientras recoge (D7).

    Recoge todo lo que llegue, sin plazo ni cupo, y cierra cuando ya no puede
    llegar nada: cuando ningun caso que pueda escribirle tiene un token capaz de
    alcanzar todavia el envio. N son los mensajes que llegaron, cero incluido.
    """

    def __init__(self, origen, recepcion, caso, contexto):
        self.origen, self.recepcion, self.caso, self.contexto = origen, recepcion, caso, contexto
        self.cerrado = False
        self.espera = None

    @property
    def buzon(self):
        return (self.origen, self.recepcion, self.caso)


def _destinos_fijos(remitente, recepcion, desde=1, hasta=None):
    """A quien mandan las reglas 2 a 4 de destino_de los sobres de las ejecuciones
    desde..hasta de un envio del remitente a esa recepcion (hasta=None: sin
    tope). Solo la regla 4 depende de la ejecucion: la i va al caso i."""
    enfrente = casos_de(elementParticipant[recepcion], remitente.convocatoria)
    propios = casos_de(remitente.participante, remitente.convocatoria)
    if hasta is not None and hasta < desde:
        return set()
    if len(enfrente) == 1:
        return {enfrente[0]}
    if len(enfrente) == len(propios):
        return {otro for otro in enfrente if otro.indice == remitente.indice}
    if len(propios) == 1:
        return set(enfrente[desde - 1:hasta])
    return set()


def _posiciones(caso):
    """Donde estan los tokens vivos del caso, como (nodo, contexto): en un nodo, o
    esperando en una union, con el contexto con el que llegaron."""
    for (nodo, contexto), cuenta in tokensVivos[caso].items():
        if cuenta > 0:
            yield nodo, contexto
    for union, por_flujo in join_waits[caso].items():
        for llegadas in por_flujo.values():
            for _, contexto in llegadas:
                yield union, contexto


def _le_escriben(origen, recepcion, caso, visitando=frozenset()):
    """Los tokens vivos que pueden llegar todavia al envio origen y mandar su
    sobre a esa recepcion del caso, como (remitente, nodo).

    Se mira token a token, con su contexto, y no caso a caso: en varias parejas
    1:1 el servicio 3 sigue vivo y puede responder, pero su respuesta va al
    cliente 3, y la recepcion del cliente 1 no tiene por que esperarla.

    Solo los de la convocatoria del caso: si contaran los orquestados de la
    siguiente, la recepcion esperaria a una ronda que no puede abrirse hasta
    que ella cierre.
    """
    for remitente in casos_de(elementParticipant[origen], caso.convocatoria):
        for nodo, contexto in _posiciones(remitente):
            if origen not in alcanzaDesde.get(nodo, ()):
                continue
            destinos = _destinos_del_token(remitente, origen, recepcion, nodo, contexto, visitando)
            if destinos is None or caso in destinos:
                yield remitente, nodo


def _escritores(recepcion, caso, visitando=frozenset()):
    """Quien podria escribir todavia a esa recepcion de ese caso, o None si no se acota.

    Por los tokens vivos, y no por las reglas fijas: un caso que ya termino no
    escribe, y si quien escribe es a su vez una respuesta, a quien va lo dice su
    propia anotacion, que se sigue igual. Solo si la cadena de respuestas vuelve
    sobre una recepcion que ya se esta mirando se deja sin acotar.
    """
    origen = origenDeRecepcion.get(recepcion)
    clave = (recepcion, caso)
    if origen is None or clave in visitando:
        return None
    escritores = set(_pendientes_de_anotar(origen, recepcion, caso))
    escritores |= {remitente for remitente, _ in _le_escriben(origen, recepcion, caso, visitando | {clave})}
    return escritores


def _pendientes_de_anotar(origen, recepcion, caso):
    """Los remitentes de los sobres que ya se mandaron a esa recepcion del caso y
    que todavia no se han anotado: los que esperan en el buzon, y los que ya se
    entregaron a una ejecucion que aun no ha vuelto a correr.

    Quien los mando ya no puede escribir -su ejecucion consta como enviada-,
    pero la recepcion los anotara, y una respuesta irá a ellos. Sin contarlos,
    entre el envio y la anotacion parece que nadie va a escribir, y una
    recepcion que espera esa respuesta cierra antes de tiempo.
    """
    buzon = (origen, recepcion, caso)
    yield from messages[buzon]
    yield from (remitente for remitente, veces in enCamino[buzon].items() if veces > 0)


def _activacion_anotada(caso, recepcion, contexto):
    """La activacion de la recepcion cuya anotacion leeria una respuesta desde
    este contexto, como _anotacion: su clave (caso, contexto, recepcion), o None."""
    vistos, frontera = {contexto}, [contexto]
    while frontera:
        siguiente = []
        for ctx in frontera:
            clave = (caso, ctx, recepcion)
            if clave in recepciones_anotadas:
                return clave
            for padre in contextos_padres.get(ctx, ()):
                if padre not in vistos:
                    vistos.add(padre)
                    siguiente.append(padre)
        frontera = siguiente
    return None


def _destinos_de_una_activacion(remitente, envio, recepcion_destino, contexto, en_curso):
    """A que casos pueden ir los sobres que le quedan a una activacion del envio.

    Cada ejecucion escribe a un caso: una respuesta, al que anoto su recepcion
    para ESA ejecucion, y si no hay anotacion, por las reglas fijas; un envio
    que abre la conversacion, por las reglas fijas, o al i-esimo de los vivos que
    conto si es multiinstancia. De la activacion en curso solo cuentan las
    ejecuciones que aun no han escrito: las que ya lo hicieron no pueden mandar
    nada mas, y su destinatario no tiene por que seguir esperando.

    Cuantas ejecuciones tiene: las N que conto al activarse si es
    multiinstancia; sin marca, ejecucionesMaximas, que mira el bucle y que con
    Time o Percentage no tiene tope. None si puede ir a cualquiera.
    """
    multiinstancia = envio in enviosMultiinstancia
    respuesta = recepcionDeRespuesta.get(envio)
    plan = planes.get((remitente, contexto, envio)) if en_curso else None
    hechas = enviadas.get((remitente, contexto, envio), ()) if en_curso else ()
    if multiinstancia and respuesta is None:
        if plan is None:
            return None
        cuantas, destinatarios = plan
        return {destinatarios[k - 1] for k in range(1, cuantas + 1) if k not in hechas}
    anotada = _activacion_anotada(remitente, respuesta, contexto) if respuesta is not None else None
    recogidos = lotes.get(anotada, 0) if anotada is not None else 0
    if multiinstancia:
        maximo = plan[0] if plan is not None else recogidos
    else:
        maximo = ejecucionesMaximas.get(envio, 1)
    if maximo is not None:
        pendientes, desde = [k for k in range(1, maximo + 1) if k not in hechas], None
    else:
        tope = max(hechas, default=0)
        pendientes, desde = [k for k in range(1, tope + 1) if k not in hechas], tope + 1
        # Sin tope, todas las que vengan: las anotadas, una a una, y el resto
        # por las reglas fijas de golpe.
        pendientes += list(range(desde, recogidos + 1))
        desde = max(desde, recogidos + 1)

    def una(k):
        anotado = correspondientes.get(anotada + (k,)) if anotada is not None else None
        return {anotado} if anotado is not None else _destinos_fijos(remitente, recepcion_destino, k, k)

    destinos = set()
    for k in pendientes:
        destinos |= una(k)
    if desde is not None:
        destinos |= _destinos_fijos(remitente, recepcion_destino, desde, None)
    return destinos


def _destinos_del_token(remitente, envio, recepcion_destino, nodo, contexto, visitando=frozenset()):
    """A que casos puede ir todavia un sobre del envio mandado por este token, o
    None si a cualquiera. Es lo que decide si el token mantiene abierta una
    recepcion (D7).

    Si el token esta en el envio, cuentan las ejecuciones que le quedan; si aun
    no ha llegado, o puede volver a el por un ciclo, una activacion entera. Y si
    antes de llegar puede pasar otra vez por la recepcion a la que responde, la
    anotacion la hara quien le escriba entonces, y puede anotar menos de las que
    salgan: cuentan tambien quienes podrian escribirle y las reglas fijas.
    """
    destinos = set()
    if nodo == envio:
        actual = _destinos_de_una_activacion(remitente, envio, recepcion_destino, contexto, True)
        if actual is None:
            return None
        destinos |= actual
        if envio not in enviosEnCiclo:
            return destinos
    futura = _destinos_de_una_activacion(remitente, envio, recepcion_destino, contexto, False)
    if futura is None:
        return None
    destinos |= futura
    respuesta = recepcionDeRespuesta.get(envio)
    if (respuesta is not None and respuesta in alcanzaDesde.get(nodo, ())
            and envio in alcanzaDesde.get(respuesta, ())):
        if envio not in enviosMultiinstancia:
            destinos |= _destinos_fijos(remitente, recepcion_destino, 1, ejecucionesMaximas.get(envio, 1))
        escritores = _escritores(respuesta, remitente, visitando)
        if escritores is None:
            return None
        destinos |= escritores
    return destinos


def _alguien_puede_escribir(lote):
    """Si algun token vivo puede mandar todavia un sobre a esta recepcion (D7)."""
    return next(_le_escriben(lote.origen, lote.recepcion, lote.caso), None) is not None


def _cierra(lote):
    """Ya no puede llegar nada: la ejecucion que esperaba el siguiente sobre se va."""
    lote.cerrado = True
    lotesAbiertos.remove(lote)
    espera, lote.espera = lote.espera, None
    if espera is not None and not espera.triggered:
        message_waiters[lote.buzon].remove(espera)
        espera.succeed(None)


def _revisa_lotes():
    """Cierra las recepciones a las que ya no puede llegar nada.

    Solo cambia cuando se mueve un token, asi que basta con mirarlo al final de
    cada nodo y de cada inicio. Cada recepcion se mira por su cuenta, y por eso
    dos abiertas a la vez no se esperan: lo que cierra a una son los tokens de
    quienes le escriben, no lo que haga la otra.
    """
    for lote in list(lotesAbiertos):
        if not _alguien_puede_escribir(lote):
            _cierra(lote)


def abre_lote(origen, recepcion, caso, contexto):
    lote = Lote(origen, recepcion, caso, contexto)
    lotesAbiertos.append(lote)
    if not _alguien_puede_escribir(lote):
        _cierra(lote)
    return lote


def espera_en_lote(env, lote, execution):
    """El siguiente sobre del lote, o None si ya no va a llegar ninguno.

    Lo que ya esta en el buzon es del lote aunque este cerrado: llego antes de
    que nadie pudiera dejar de escribir.
    """
    buzon = messages[lote.buzon]
    if buzon:
        remitente = buzon.popleft()
    elif lote.cerrado:
        return None
    else:
        evento = env.event()
        lote.espera = evento
        message_waiters[lote.buzon].append(evento)
        remitente = yield evento
        lote.espera = None
        if remitente is None:
            return None
        enCamino[lote.buzon][remitente] -= 1
    _anota(lote.caso, lote.contexto, lote.recepcion, execution, remitente)
    return remitente


def recoge_lote(env, origen, recepcion, caso, contexto, ejecuta, paralelo):
    """Una recepcion multiinstancia: una ejecucion por sobre, hasta que cierre.

    En paralelo hay siempre una ejecucion esperando el siguiente sobre, y en
    cuanto recibe el suyo deja otra esperando: es lo que hacian las N
    ejecuciones lanzadas a la vez cuando N estaba escrito, y por eso cada sobre
    va a la misma ejecucion que antes y su espera cuenta desde que se activo la
    recepcion. En secuencia, cada una espera cuando termina la anterior.
    Cuando cierra, la que esperaba se va, y su espera queda en el registro
    cancelada (6.1): sin ella, mientras la recepcion espera algo que ya no
    llega el caso no estaria en ninguna parte. Con cero sobres no ejecuta nada
    ni ocupa a nadie.
    """
    lote = abre_lote(origen, recepcion, caso, contexto)
    inicio = env.now
    if paralelo:
        ejecuciones, fin = [], env.event()

        def ejecucion(numero):
            remitente = yield env.process(espera_en_lote(env, lote, numero))
            if remitente is None:
                _registra_espera_cancelada(caso, recepcion, numero, inicio, contexto)
                fin.succeed()
                return
            ejecuciones.append(env.process(ejecucion(numero + 1)))
            yield from ejecuta(env, recepcion, caso, numero, (remitente, inicio))

        ejecuciones.append(env.process(ejecucion(1)))
        yield fin
        yield simpy.AllOf(env, ejecuciones)
    else:
        def ejecucion_secuencial(numero):
            empieza = env.now
            remitente = yield env.process(espera_en_lote(env, lote, numero))
            if remitente is None:
                _registra_espera_cancelada(caso, recepcion, numero, empieza, contexto)
                return False
            yield from ejecuta(env, recepcion, caso, numero, (remitente, empieza))
            return True

        numero = 1
        while (yield env.process(ejecucion_secuencial(numero))):
            numero += 1
    # El lote queda escrito aunque este vacio: la evaluacion y la respuesta lo
    # buscan, y cero es una respuesta, no la falta de una.
    lotes.setdefault((caso, contexto, recepcion), 0)
    recepciones_anotadas.add((caso, contexto, recepcion))


def _registra_espera_cancelada(caso, recepcion, execution, inicio, contexto):
    """La espera de la ejecucion que se va cuando cierra el lote (D7, 6.1).

    Esperaba un sobre mas que ya no puede llegar. Cuenta desde donde cuentan
    las de su lote -en paralelo, desde que se activo la recepcion-, y como el
    resto de esperas solo se registra si duro algo: una recepcion que se activa
    sin nadie que pueda escribirle cierra en el acto y no espera nada.
    """
    if env.now <= inicio:
        return
    _append_event(caso, [('string', 'bpmn:type', 'StandByMessage'),
                         ('string', 'bpmn:id', recepcion),
                         ('string', 'bpmn:execution', execution),
                         ('int', 'bpmn:activation', contexto),
                         ('date', 'time:timestamp', inicio),
                         ('date', 'time:endTime', env.now),
                         ('date', 'time:duration', env.now - inicio),
                         ('int', 'bpmn:instance', caso.indice),
                         ('boolean', 'bpmn:cancelled', 'true')])


def publish_data(data_object, caso):
    data.add((data_object, caso))
    changed = data_changed.pop(caso, None)
    if changed is not None:
        changed.succeed()


def wait_for_data(env, objects, caso):
    # Data objects belong to one caso; only its waiters are woken.
    while not all((item, caso) in data for item in objects):
        if caso not in data_changed:
            data_changed[caso] = env.event()
        yield data_changed[caso]


def _append_event(caso, values):
    event = ET.Element('event')
    for kind, key, value in values:
        ET.SubElement(event, kind, key=key, value=str(value))
    simulationResults[caso].append(ET.tostring(event, encoding='unicode'))


def _reachable(node, incoming_flow, blocked_join):
    """Reach an input without first passing this same join (including cycles).

    Solo por flujos que el motor puede tomar: una rama al 0 % no se elige nunca,
    asi que un token que solo llegaria por ella a una entrada de la union no
    puede llegar, y no debe hacerla esperar ni dejar de esperar. BPMN mira el
    dibujo; aqui el dibujo lleva porcentajes, y uno a cero apaga la rama.
    """
    cache_key = (node, incoming_flow, blocked_join)
    if cache_key in reachability:
        return reachability[cache_key]
    source = sequenceFlows[incoming_flow][0]
    # Tambien tiene que ser posible el ultimo flujo, el que entra en la union:
    # llegar a su origen no basta si esa misma entrada tiene peso cero.
    possible = salidasPosibles.get(source, outgoingFlows.get(source, []))
    visited, pending = {blocked_join}, [node] if incoming_flow in possible else []
    while pending:
        current = pending.pop()
        if current in visited:
            continue
        if current == source:
            reachability[cache_key] = True
            return True
        visited.add(current)
        pending.extend(sequenceFlows[edge][1]
                       for edge in salidasPosibles.get(current, outgoingFlows.get(current, [])))
    reachability[cache_key] = False
    return False


def _join_ready(node, caso, counts):
    inputs = incomingFlows[node]
    if joinTypes[node] == 'parallel':
        return all(counts[edge] > 0 for edge in inputs)
    if not any(counts.values()):
        return False
    missing = [edge for edge in inputs if not counts[edge]]
    occupied = [edge for edge in inputs if counts[edge]]
    live_nodes = [active_node for active_node, count in active_tokens[caso].items() if count > 0]
    live_nodes.extend(other for other, waiting in pending_joins[caso].items()
                      if other != node and any(waiting.values()))
    # BPMN 2.0.2 table 13.3: a token that could reach an empty input blocks
    # only if it cannot also reach an already occupied input, without passing
    # through this join. The second condition matters for cyclic models.
    # https://www.omg.org/spec/BPMN/2.0.2/PDF
    return not any(any(_reachable(live, edge, node) for edge in missing)
                   and not any(_reachable(live, edge, node) for edge in occupied)
                   for live in live_nodes)


def _register(node, caso, incoming_flow=None, contexto=None):
    if node in joinTypes:
        if incoming_flow not in incomingFlows[node]:
            raise SimulationError(f'Entrada desconocida en la unión {node} ({caso}).')
        pending_joins[caso].setdefault(node, Counter())[incoming_flow] += 1
        # Cuando llego el token y de donde viene: lo primero para medir despues
        # lo que espera aqui, lo segundo para que la union herede su contexto.
        join_waits[caso].setdefault(node, {}).setdefault(incoming_flow, deque()).append((env.now, contexto))
    else:
        _activa(node, caso, nuevo_contexto([contexto] if contexto is not None else []))


def _activa(node, caso, contexto):
    """Un token entra en un nodo: se cuenta, se apunta con su contexto y arranca.

    El contexto hace falta para saber a quien puede escribir todavia el caso
    (_alguien_puede_escribir): una respuesta va a quien anoto su recepcion en el
    linaje de ESE token.
    """
    active_tokens[caso][node] += 1
    tokensVivos[caso][(node, contexto)] += 1
    env.process(_run_node(node, caso, contexto))


def _release_token(caso, node, contexto):
    tokens = active_tokens[caso]
    tokens[node] -= 1
    if tokens[node] <= 0:
        del tokens[node]
    vivos = tokensVivos[caso]
    vivos[(node, contexto)] -= 1
    if vivos[(node, contexto)] <= 0:
        del vivos[(node, contexto)]
        enviadas.pop((caso, contexto, node), None)
        planes.pop((caso, contexto, node), None)


def _registra_espera_union(caso, node, edge):
    """La espera de un token en una union, de su llegada al disparo.

    Una rama que termina pronto se queda esperando a su hermana, y sin esto
    esos segundos no aparecen en ninguna parte del registro: solo se veia el
    disparo de la union. Como el resto de esperas del motor, solo se registra
    cuando de verdad hubo espera; el ultimo token en llegar no espera nada.
    """
    llegadas = join_waits[caso].get(node, {}).get(edge)
    inicio, contexto = llegadas.popleft() if llegadas else (env.now, None)
    if env.now <= inicio:
        return contexto
    _append_event(caso, [('string', 'bpmn:type', 'StandByJoin'),
                         ('string', 'bpmn:id', node),
                         ('string', 'bpmn:incomingFlow', edge),
                         ('date', 'time:timestamp', inicio),
                         ('date', 'time:endTime', env.now),
                         ('date', 'time:duration', env.now - inicio),
                         ('int', 'bpmn:instance', caso.indice)])
    return contexto


def _flush_joins(caso):
    # Only this caso's tokens can enable its joins. A firing may unblock
    # another inclusive join; revisit until stable.
    joins = pending_joins[caso]
    changed = True
    while changed:
        changed = False
        for node, counts in list(joins.items()):
            if _join_ready(node, caso, counts):
                heredados = []
                for edge in incomingFlows[node]:
                    if counts[edge]:
                        counts[edge] -= 1
                        contexto = _registra_espera_union(caso, node, edge)
                        if contexto is not None:
                            heredados.append(contexto)
                if not any(counts.values()):
                    del joins[node]
                _activa(node, caso, nuevo_contexto(heredados))
                changed = True


def _route(node, caso, result, contexto):
    selected = result if isinstance(result, list) else [result]
    edges = []
    for target in selected:
        if not target:
            continue
        if target in sequenceFlows and sequenceFlows[target][0] == node:
            edges.append(target)
        else:
            edges.extend(edge for edge in outgoingFlows.get(node, [])
                         if sequenceFlows[edge][1] == target)
    if not edges and node not in endEvents:
        raise SimulationError(f'El elemento {node} no tiene una salida ejecutable ({caso}).')
    # Register a complete split atomically, including tokens at join inputs.
    for edge in edges:
        _register(sequenceFlows[edge][1], caso, edge, contexto)


def _run_node(node, caso, contexto):
    function_name = 'node_' + node.encode('utf-8').hex()
    result = yield env.process(globals()[function_name](env, caso, contexto))
    _release_token(caso, node, contexto)
    _route(node, caso, result, contexto)
    if node in endEvents:
        completed[caso] += 1
    _flush_joins(caso)
    _revisa_lotes()
    _revisa_convocatoria(caso)


def _start_event(node, caso, delay, contexto):
    item = startEvents[node]
    yield env.timeout(delay)
    casosArrancados.add(caso)
    remitente = None
    if item['origin'] is not None:
        start_wait = env.now
        remitente = yield env.process(wait_for_message(env, item['origin'], node, 1, caso, contexto))
        if env.now > start_wait:
            _append_event(caso, [('string', 'bpmn:type', 'StandByMessage'),
                                ('string', 'bpmn:id', node),
                                ('string', 'bpmn:request', remitente),
                                ('date', 'time:timestamp', start_wait),
                                ('date', 'time:endTime', env.now),
                                ('date', 'time:duration', env.now - start_wait),
                                ('int', 'bpmn:instance', caso.indice)])
    values = [('string', 'bpmn:type', item['type']), ('string', 'bpmn:name', item['name']),
              ('string', 'bpmn:id', node), ('string', 'bpmn:subTask', item['next']),
              ('date', 'time:timestamp', env.now), ('int', 'bpmn:instance', caso.indice)]
    if item['origin'] is not None:
        values.append(('string', 'bpmn:messageOrigin', item['origin']))
        values.append(('string', 'bpmn:messageSender', remitente))
        values.append(('string', 'bpmn:request', remitente))
    _append_event(caso, values)
    _release_token(caso, node, contexto)
    _route(node, caso, item['next'], contexto)
    _flush_joins(caso)
    _revisa_lotes()
    _revisa_convocatoria(caso)


def _enumera(partes, maximo=6):
    """'a, b y c', cortando con 'y N mas' si son demasiadas."""
    partes = list(partes)
    if len(partes) > maximo:
        partes = partes[:maximo] + [f'{len(partes) - maximo} mas']
    return partes[0] if len(partes) == 1 else ', '.join(partes[:-1]) + ' y ' + partes[-1]


def _desde_donde(posiciones):
    """'Pool - 1 desde A y Pool - 2 desde B', agrupando los casos de cada nodo."""
    por_nodo = {}
    for caso, nodo in sorted(set(posiciones)):
        por_nodo.setdefault(nodo, []).append(str(caso))
    return _enumera(f'{_enumera(casos)} desde {nodo}' for nodo, casos in sorted(por_nodo.items()))


def _esperas_al_bloquearse():
    """Que espera cada token que se ha quedado parado, y de quien depende.

    Devuelve {(caso, nodo): (descripcion, [(caso, nodo) de quien depende],
    es_recepcion_abierta)}. Un token parado espera una de cuatro cosas:
    - en una recepcion multiinstancia abierta, que nadie pueda escribirle ya:
      depende de los tokens que todavia pueden hacerlo (_le_escriben);
    - en una recepcion o evento de mensaje, un sobre: depende de quien puede
      mandarselo todavia, con las mismas reglas que el cierre;
    - en una tarea, un dato que no esta: depende de quien puede producirlo;
    - en una union, una rama que no ha llegado: depende de los tokens del caso
      que pueden llegar a ella sin pasar antes por la union, como _join_ready.
    """
    abiertos = {(lote.caso, lote.recepcion, lote.contexto) for lote in lotesAbiertos}
    esperas = {}
    for caso in sorted(tokensVivos):
        for (nodo, contexto), cuenta in sorted(tokensVivos[caso].items(), key=lambda par: str(par[0])):
            if cuenta <= 0 or (caso, nodo) in esperas:
                continue
            faltan = [dato for dato in requiredData.get(nodo, ()) if (dato, caso) not in data]
            if (caso, nodo, contexto) in abiertos:
                quienes = sorted(set(_le_escriben(origenDeRecepcion[nodo], nodo, caso)))
                esperas[(caso, nodo)] = (
                    f'{nodo} ({caso}) no puede cerrar mientras puedan escribirle {_desde_donde(quienes)}',
                    quienes, True)
            elif faltan:
                productores = [tarea for tarea, datos in generatedData.items() if set(datos) & set(faltan)]
                quienes = sorted({(caso, otro) for otro, _ in _posiciones(caso)
                                  if any(tarea in alcanzaDesde.get(otro, ()) for tarea in productores)})
                que = (f'que solo puede producir {_enumera(productores)} desde {_enumera(n for _, n in quienes)}'
                       if quienes else 'que ya no puede producir nadie')
                esperas[(caso, nodo)] = (f'{caso} espera en {nodo} el dato {_enumera(faltan)}, {que}',
                                         quienes, False)
            elif nodo in origenDeRecepcion:
                origen = origenDeRecepcion[nodo]
                quienes = sorted(set(_le_escriben(origen, nodo, caso)))
                que = (f'que solo puede enviar {_desde_donde(quienes)}' if quienes
                       else 'que ya no puede enviar nadie')
                esperas[(caso, nodo)] = (f'{caso} espera en {nodo} el mensaje de {origen}, {que}',
                                         quienes, False)
            else:
                esperas[(caso, nodo)] = (f'{caso} sigue en {nodo}', [], False)
    for caso in sorted(pending_joins):
        for union, cuentas in sorted(pending_joins[caso].items()):
            if not any(cuentas.values()):
                continue
            faltan = [flujo for flujo in incomingFlows[union] if not cuentas[flujo]]
            vivos = {nodo for nodo, _ in _posiciones(caso) if nodo != union}
            quienes = sorted({(caso, vivo) for vivo in vivos
                              if any(_reachable(vivo, flujo, union) for flujo in faltan)})
            ramas = _enumera(sequenceFlows[flujo][0] for flujo in faltan)
            que = (f'que solo puede llegar desde {_enumera(n for _, n in quienes)}' if quienes
                   else 'que ya no puede llegar')
            esperas[(caso, union)] = (f'{caso} espera en {union} la rama de {ramas}, {que}', quienes, False)
    return esperas


def _componentes(esperas):
    """Los ciclos del grafo de esperas: componentes fuertemente conexas de mas de
    un nodo, o de uno que depende de si mismo (Tarjan, iterativo)."""
    indice, bajo, pila, en_pila, ciclos, contador = {}, {}, [], set(), [], [0]
    for inicio in sorted(esperas):
        if inicio in indice:
            continue
        trabajo = [(inicio, iter(esperas[inicio][1]))]
        indice[inicio] = bajo[inicio] = contador[0]
        contador[0] += 1
        pila.append(inicio)
        en_pila.add(inicio)
        while trabajo:
            nodo, hijos = trabajo[-1]
            avanzado = False
            for hijo in hijos:
                if hijo not in esperas:
                    continue
                if hijo not in indice:
                    indice[hijo] = bajo[hijo] = contador[0]
                    contador[0] += 1
                    pila.append(hijo)
                    en_pila.add(hijo)
                    trabajo.append((hijo, iter(esperas[hijo][1])))
                    avanzado = True
                    break
                if hijo in en_pila:
                    bajo[nodo] = min(bajo[nodo], indice[hijo])
            if avanzado:
                continue
            trabajo.pop()
            if trabajo:
                padre = trabajo[-1][0]
                bajo[padre] = min(bajo[padre], bajo[nodo])
            if bajo[nodo] == indice[nodo]:
                componente = []
                while True:
                    miembro = pila.pop()
                    en_pila.discard(miembro)
                    componente.append(miembro)
                    if miembro == nodo:
                        break
                if len(componente) > 1 or nodo in esperas[nodo][1]:
                    ciclos.append(sorted(componente))
    return ciclos


def _diagnostico_del_bloqueo():
    """Por que se ha quedado parada la simulacion, si es por esperas (3.4).

    Si hay un ciclo -una recepcion que no puede cerrar porque quien puede
    escribirle espera algo que solo llega cuando cierre, o dos casos que se
    esperan el mensaje uno del otro-, se nombra el elemento, los casos que
    forman el ciclo y que espera cada uno. Si no lo hay, lo que queda son
    esperas sin salida: un mensaje, un dato o una rama que ya no puede llegar.
    Se calcula solo cuando el motor ya se ha parado, sobre lo que de verdad ha
    pasado, asi que un modelo que termina nunca pasa por aqui. None si no hay
    ningun token esperando.
    """
    esperas = _esperas_al_bloquearse()
    if not esperas:
        return None
    ciclos = _componentes(esperas)
    if ciclos:
        # Primero el que contiene una recepcion que no puede cerrar (D7).
        ciclo = min(ciclos, key=lambda c: (not any(esperas[m][2] for m in c), c))
        cabeza = next((m for m in ciclo if esperas[m][2]), ciclo[0])
        orden = [cabeza] + [m for m in ciclo if m != cabeza]
        partes = [esperas[m][0] for m in orden]
        if len(partes) > 8:
            partes = partes[:8] + [f'y {len(partes) - 8} esperas mas']
        caso, nodo = cabeza
        return f'Ciclo de espera en {nodo} ({caso}): ' + '; '.join(partes) + '.'
    sin_salida = [esperas[clave][0] for clave in sorted(esperas) if not esperas[clave][1]]
    if not sin_salida:
        return None
    if len(sin_salida) > 8:
        sin_salida = sin_salida[:8] + [f'y {len(sin_salida) - 8} mas']
    return 'Esperas sin salida: ' + '; '.join(sin_salida) + '.'


def _assert_complete():
    """Que la convocatoria en curso ha terminado limpia, o por que se ha parado.

    Se llama al cerrar cada convocatoria, antes de tirar su estado, y al acabar
    la simulacion. Mira solo la ronda en curso: las anteriores ya pasaron por
    aqui al cerrarse, y sin eso un sobre perdido en la primera desapareceria
    con su estado.
    """
    pending = [f'{node} ({caso})' for caso, joins in pending_joins.items()
               for node, counts in joins.items() if any(counts.values())]
    active = [f'{node} ({caso})' for caso, tokens in active_tokens.items()
              for node, count in tokens.items() if count]
    sin_arrancar = [str(caso) for caso in casosDeLaRonda if caso not in casosArrancados]
    missing = [str(caso) for caso in casosDeLaRonda if not completed[caso]]
    # Sobres que nadie ha abierto. D6 dice que todo mensaje que se envia se
    # recibe, asi que uno sin recoger es un modelo mal planteado, y callarlo
    # seria peor que pararse: la simulacion terminaria con buena cara habiendo
    # perdido mensajes. Con la difusion de la 2.5 hay muchos mas sobres en
    # juego, y antes no habia quien lo mirara.
    sin_recoger = ['%s -> %s (%s)' % (origin, target, destino)
                   for (origin, target, destino), cola in messages.items() if cola]
    if pending or active or missing or sin_arrancar or sin_recoger:
        details = []
        if pending:
            details.append('uniones pendientes: ' + ', '.join(pending[:10]))
        if active:
            details.append('elementos esperando mensaje o datos: ' + ', '.join(active[:10]))
        if sin_recoger:
            details.append('mensajes enviados que nadie ha recogido: ' + ', '.join(sin_recoger[:10]))
        if sin_arrancar:
            details.append('casos preparados que nunca arrancaron: ' + ', '.join(sin_arrancar[:10]))
        if missing:
            details.append('casos sin evento de fin: ' + ', '.join(missing[:10]))
        if convocatorias > 1:
            details.append(f'se ha parado en la convocatoria {convocatoriaActual} de {convocatorias}')
        # Delante, el porque, si es un bloqueo por esperas: el resumen dice que
        # se quedo parado, el diagnostico quien espera a quien (3.4).
        diagnostico = _diagnostico_del_bloqueo() if (pending or active) else None
        raise SimulationError(('' if diagnostico is None else diagnostico + ' ')
                              + 'Simulación bloqueada o incompleta; ' + '; '.join(details) + '.')


def xes_time(seconds):
    """ISO 8601 timestamp for a simulated time in seconds from the start date."""
    return (startDate + timedelta(seconds=float(seconds))).isoformat(timespec='milliseconds')


def _instante(item):
    for child in item:
        if child.get('key') == 'time:timestamp':
            return float(child.get('value'))
    return 0.0


def _ordena_eventos(events):
    """Orden temporal, con el orden de registro como desempate.

    Dos eventos del mismo instante salen siempre en el mismo orden, que es lo
    que pide el contrato de registro. Ademas deja la traza ordenada en el
    tiempo, que es como PM4Py espera leerla.
    """
    items = [ET.fromstring(event) for event in events]
    ordenados = sorted(enumerate(items), key=lambda par: (_instante(par[1]), par[0]))
    return [item for _, item in ordenados]


def _identifica(item, caso, ocurrencia):
    """Marca cada evento con su caso y con un numero de ocurrencia unico.

    La ocurrencia no se reutiliza en bucles ni en ramas paralelas, asi que dos
    ejecuciones simultaneas del mismo elemento en el mismo caso se distinguen.
    Se anade aqui y no en cada plantilla: hay un solo sitio donde se conoce el
    caso completo y por donde pasan todos los eventos.
    """
    item.append(ET.Element('int', key='bpmn:occurrence', value=str(ocurrencia)))
    item.append(ET.Element('string', key='bpmn:participant', value=str(caso.participante)))
    item.append(ET.Element('int', key='bpmn:convocatoria', value=str(caso.convocatoria)))


def _finalize_item(item):
    # Generated code logs simulated seconds; XES needs dates, and durations are
    # numbers rather than dates. Events are named by BPMN ID for process mining.
    for child in item.iter():
        if child.tag != 'date':
            continue
        if child.get('key') == 'time:duration':
            child.tag = 'float'
            child.set('value', str(float(child.get('value'))))
        else:
            child.set('value', xes_time(child.get('value')))
    if item.tag == 'event':
        values = {child.get('key'): child.get('value') for child in item}
        if 'concept:name' not in values and values.get('bpmn:id'):
            kind = values.get('bpmn:type') or ''
            label = values['bpmn:id'] if kind.startswith('bpmn:') else f"{kind} · {values['bpmn:id']}"
            item.insert(0, ET.Element('string', key='concept:name', value=label))
    return item


def _estado_de_ronda(casos):
    """Todo lo que vive dentro de una convocatoria, nuevo para la que empieza (D12).

    Una convocatoria termina cuando a ninguno de sus casos le queda un token, ni
    una espera, ni una recepcion abierta, y como nunca hay dos a la vez, nada de
    lo que deja le sirve a la siguiente: se tira entero, despues de comprobar
    que no se ha perdido ningun sobre (_assert_complete). Asi ninguna respuesta,
    anotacion, lote, dato o decision de una ronda puede llegar a otra, y la
    memoria no crece con el numero de convocatorias. Las colas se rehacen con
    los contadores a cero: cada ronda reparte el trabajo como la primera.

    No se toca el reloj, ni el generador aleatorio, que no se vuelve a sembrar,
    ni el registro, que acumula las trazas de todas las rondas.
    """
    global colasPorParticipante, messages, message_waiters, correspondientes, recepciones_anotadas
    global contextos_padres, lotes, lotesAbiertos, enCamino, tokensVivos, enviadas, planes
    global data, data_changed, active_tokens, pending_joins, join_waits
    global completed, casosArrancados, casosAcabados
    colasPorParticipante = {participante: UserQueue(usuariosPorParticipante[participante],
                                                    recursosInfinitos.get(participante, False))
                            for participante in participantesOrden}
    # Un buzon por caso destino, y dentro de cada sobre su remitente.
    messages, message_waiters = defaultdict(deque), defaultdict(deque)
    # Cada token estrena contexto; los padres son los contextos de los que viene.
    correspondientes, contextos_padres = {}, {}
    # Que recepciones tienen ya alguna anotacion en cada contexto, para que
    # _anotacion no tenga que recorrer todas las anotaciones para saberlo.
    recepciones_anotadas = set()
    # Cuantos sobres recogio cada activacion de cada recepcion, y que recepciones
    # multiinstancia siguen recogiendo (D7).
    lotes, lotesAbiertos = {}, []
    # Sobres entregados a una ejecucion que todavia no los ha anotado.
    enCamino = defaultdict(Counter)
    # Cada token vivo con su contexto, y de cada activacion de un envio que
    # ejecuciones han escrito ya y cuantas tiene: con eso se sabe a quien puede
    # ir todavia un sobre (_destinos_del_token).
    tokensVivos, enviadas, planes = defaultdict(Counter), {}, {}
    data = {(item, caso) for item in defaultData for caso in casos}
    data_changed = {}
    active_tokens, pending_joins = defaultdict(Counter), defaultdict(dict)
    join_waits = defaultdict(dict)
    # Que casos de la ronda han llegado al fin, han arrancado y han terminado.
    completed, casosArrancados, casosAcabados = Counter(), set(), set()


def _abre_convocatoria(convocatoria):
    """Crea los casos de una convocatoria y lanza sus eventos de inicio.

    La tabla se construye completa ANTES de lanzar nada: el numero de casos se
    conoce desde el principio, asi que no hay que esperar a que uno arranque
    para poder dirigirle un mensaje. En cada ronda el orquestador tiene un caso
    y los demas pools los suyos, con indices que siguen a los de la ronda
    anterior (D3).

    Las llegadas cuentan desde que se abre la convocatoria (D13), en uno de
    tres modos por pool: escalonada, el caso i llega (i - 1) * frequency
    despues; simultanea, todos al abrirse; uniforme, cada uno en un segundo
    entero al azar entre 0 y T, ambos incluidos. Los sorteos salen del mismo
    generador que todo lo demas, de pool en pool y de caso en caso por orden, y
    antes de lanzar ningun evento de la ronda: la semilla los fija. Un caso con
    varios eventos de inicio llega una sola vez, a la misma hora en todos.
    """
    global convocatoriaActual, casosPorParticipante, casosDeLaRonda
    convocatoriaActual = convocatoria
    casosPorParticipante = {participante: [Caso(participante, (convocatoria - 1) * cuantos + posicion,
                                                convocatoria)
                                           for posicion in range(1, cuantos + 1)]
                            for participante, cuantos in casosPorConvocatoria.items()}
    # Con un solo caso por pool y ronda, el orden es el de siempre.
    maximo = max(casosPorConvocatoria.values())
    casosDeLaRonda = [casosPorParticipante[participante][posicion - 1]
                      for posicion in range(1, maximo + 1)
                      for participante in participantesOrden
                      if posicion <= casosPorConvocatoria[participante]]
    for caso in casosDeLaRonda:
        simulationResults[caso] = []
    _estado_de_ronda(casosDeLaRonda)
    llegadas = {}
    for participante in participantesOrden:
        modo, valor = llegadaPorParticipante[participante]
        for posicion, caso in enumerate(casosPorParticipante[participante], 1):
            if modo == 'uniform':
                llegadas[caso] = random.randint(0, valor)
            elif modo == 'staggered':
                llegadas[caso] = (posicion - 1) * valor
            else:
                llegadas[caso] = 0
    # Waiting for messages never suspends other starts or later instances.
    for posicion in range(1, maximo + 1):
        for node in startEvents:
            casos = casosPorParticipante[elementParticipant[node]]
            if posicion > len(casos):
                continue
            caso = casos[posicion - 1]
            contexto = nuevo_contexto([])
            active_tokens[caso][node] += 1
            tokensVivos[caso][(node, contexto)] += 1
            env.process(_start_event(node, caso, llegadas[caso], contexto))


def _revisa_convocatoria(caso):
    """Si el caso ya no tiene nada que hacer, y con el toda su convocatoria (D12).

    Se mira al final de cada nodo y de cada inicio del caso que acaba de moverse:
    solo un nodo suyo puede dejarle sin tokens, y un caso sin tokens no vuelve a
    tenerlos. Cuando el ultimo caso de la ronda termina, la siguiente se abre en
    ese mismo instante: ni antes, que se solaparian, ni despues. Una recepcion
    ya cerrada no la retrasa, porque al cerrar suelta la ejecucion que esperaba
    y el token sale en cuanto acaban las demas (recoge_lote).
    """
    if caso in casosAcabados or caso_vivo(caso):
        return
    casosAcabados.add(caso)
    if len(casosAcabados) < len(casosDeLaRonda) or convocatoriaActual >= convocatorias:
        return
    _assert_complete()
    _abre_convocatoria(convocatoriaActual + 1)


def _run_simulation():
    global env, simulationResults, reachability, startDate, contador_contextos
    # Every draw (durations, gateways, loops) comes from this generator, so the
    # seed alone fixes the run. Se siembra una sola vez: las convocatorias
    # siguen la misma secuencia, y la semilla las reproduce todas (D12).
    random.seed(simulationSeed)
    env = simpy.Environment()
    startDate = datetime.fromisoformat(simulationStartDate)
    # El registro de todas las rondas, y lo que es del modelo y no de una ronda:
    # la cache de alcance de las uniones y la numeracion de los contextos.
    simulationResults, reachability, contador_contextos = {}, {}, 0
    _abre_convocatoria(1)
    env.run()
    _assert_complete()
    _escribe_registros()


def _escribe_registros():
    """Un XES por pool en registros/, y registros/indice.json con su orden (D10).

    Cada fichero lleva la cabecera que preparo generateScript -los metadatos
    comunes a toda la simulacion y los de su pool- y las trazas de sus casos,
    de todas las convocatorias, en el orden en que se crearon. Los eventos son
    los mismos que antes, cuando habia un solo registro: lo que cambia es en que
    fichero va cada traza.
    """
    trazas = {participante: [] for participante in participantesOrden}
    for caso, events in simulationResults.items():
        trace = ET.Element('trace')
        ET.SubElement(trace, 'string', key='concept:name', value=etiqueta_de_traza(caso))
        ET.SubElement(trace, 'string', key='bpmn:participant', value=str(caso.participante))
        ET.SubElement(trace, 'int', key='bpmn:instance', value=str(caso.indice))
        ET.SubElement(trace, 'int', key='bpmn:convocatoria', value=str(caso.convocatoria))
        for ocurrencia, item in enumerate(_ordena_eventos(events), 1):
            _identifica(item, caso, ocurrencia)
            trace.append(_finalize_item(item))
        ET.indent(trace, space='  ', level=1)
        trazas[caso.participante].append('  ' + ET.tostring(trace, encoding='unicode'))
    os.makedirs('registros', exist_ok=True)
    indice = []
    for posicion, (participante, nombre, cabecera) in enumerate(registrosPorPool, 1):
        fichero = f'{posicion:02d}.xes'
        partes = ['<?xml version="1.0" encoding="UTF-8"?>',
                  '<log xes.version="1.0" xes.features="nested-attributes" openxes.version="1.0RC7" '
                  'xmlns="http://www.xes-standard.org/">',
                  '  <extension name="Concept" prefix="concept" uri="http://www.xes-standard.org/concept.xesext"/>',
                  '  <extension name="Time" prefix="time" uri="http://www.xes-standard.org/time.xesext"/>',
                  '  <classifier name="Activity (by BPMN ID)" keys="bpmn:id" scope="event"/>',
                  '  <classifier name="Case (by participant and instance)" '
                  'keys="bpmn:participant bpmn:instance" scope="event"/>',
                  cabecera, *trazas[participante], '</log>']
        with open(os.path.join('registros', fichero), 'w', encoding='utf-8') as output:
            output.write('\n'.join(partes) + '\n')
        indice.append({'pool': participante, 'nombre': nombre, 'fichero': fichero})
    with open(os.path.join('registros', 'indice.json'), 'w', encoding='utf-8') as output:
        json.dump(indice, output, ensure_ascii=False)
