function getAllRelevantTasks(bpmnModeler) {
  const elementRegistry = bpmnModeler.get('elementRegistry');
  const canvas = bpmnModeler.get('canvas');
  const canvasRoot = canvas?.getRootElement?.();
  const definitions = canvasRoot?.businessObject?.$parent || {};

  const elementTypeOf = (el) => (el?.businessObject?.$type || el?.$type || el?.type || '');

  const id_model = Array.isArray(definitions.diagrams) && definitions.diagrams[0]?.id
    ? definitions.diagrams[0].id
    : 'UnknownModel';

  const allElems = Array.isArray(elementRegistry?.getAll?.())
    ? elementRegistry.getAll()
    : [];

  // ===== Helpers =====
  const arr = (x) => Array.isArray(x) ? x : (x == null ? [] : [ x ]);
  const safeId = (x) => x?.id || x?.businessObject?.id || undefined;
  const ids = (xs) => arr(xs).filter(Boolean).map((y) => safeId(y)).filter(Boolean);
  const safeBO = (el) => el?.businessObject || null;

  const getBounds = (el) => {
    if (!el) return null;
    if (Number.isFinite(el.x) && Number.isFinite(el.y) &&
        Number.isFinite(el.width) && Number.isFinite(el.height)) {
      return { x: el.x, y: el.y, width: el.width, height: el.height };
    }
    const di = el.di || (el.gfx && el.gfx.data && el.gfx.data.element && el.gfx.data.element.di) || null;
    if (di && di.bounds) {
      return { x: di.bounds.x, y: di.bounds.y, width: di.bounds.width, height: di.bounds.height };
    }
    return null;
  };

  const pointIn = (pt, b, tol = 40) =>
    !!(pt && b &&
      pt.x >= (b.x - tol) && pt.x <= (b.x + b.width + tol) &&
      pt.y >= (b.y - tol) && pt.y <= (b.y + b.height + tol));

  const isFlow = (el) => {
    const tp = el?.type || el?.businessObject?.$type || '';
    return tp === 'bpmn:SequenceFlow' || tp === 'bpmn:MessageFlow';
  };

  const isLabel = (el) => el?.type === 'label' || !!el?.labelTarget;

  const isFlowNodeCandidate = (el) => {
    if (!el) return false;
    if (isFlow(el) || isLabel(el)) return false;
    const tp = el?.businessObject?.$type || el?.type || '';
    if (tp === 'bpmn:Participant' || tp === 'bpmn:Lane' || tp === 'bpmn:Collaboration' || tp === 'bpmn:Process') return false;
    return true;
  };

  // Defaults model:KeyValuePair
  const keyValuePairs = arr(definitions.rootElements)
    .filter((el) => el?.$type === 'model:KeyValuePair')
    .map((pair) => ({ key: pair.key, value: pair.value }));

  // Defaults por Process
  const defaultsByProcessId = new Map();
  for (const el of allElems) {
    const bo = safeBO(el);
    if (bo?.$type === 'bpmn:Process') {
      const current = {};
      for (const { key, value } of keyValuePairs) {
        current[key] = String(value ?? '')
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean);
      }
      defaultsByProcessId.set(bo.id, current);
    }
  }

  // Elementos relevantes
  const relevantElements = allElems.filter((el) => {
    const t = el?.type || '';
    if (!t) return false;
    return (
      t === 'bpmn:Task' ||
      t === 'bpmn:ServiceTask' ||
      t === 'bpmn:UserTask' ||
      t === 'bpmn:ManualTask' ||
      t === 'bpmn:StartEvent' ||
      t === 'bpmn:EndEvent' ||
      t === 'bpmn:Process' ||
      t === 'bpmn:Collaboration' ||
      t === 'bpmn:Participant' ||
      t === 'bpmn:Lane' ||
      t === 'bpmn:SequenceFlow' ||
      t === 'bpmn:MessageFlow' ||
      t === 'bpmn:IntermediateCatchEvent' ||
      t === 'bpmn:DataObjectReference' ||
      t === 'bpmn:BoundaryEvent' ||
      t === 'bpmn:DataInputAssociation' ||
      t === 'bpmn:DataOutputAssociation' ||
      t.startsWith('bpmn:')
    );
  });
  const relevantElementIds = new Set(relevantElements.map(safeId).filter(Boolean));

  return relevantElements.map((e) => {
    const bo = safeBO(e) || {};
    const t0 = e.type || bo.$type || 'Unknown';

    // Tipos enriquecidos eventos
    const evDefs = arr(bo.eventDefinitions);
    const hasDef = (tp) => evDefs.some((d) => d?.$type === tp);

    let type = t0;
    if (t0 === 'bpmn:StartEvent' && hasDef('bpmn:MessageEventDefinition')) type = 'bpmn:MessageStartEvent';
    else if (t0 === 'bpmn:StartEvent' && hasDef('bpmn:TimerEventDefinition')) type = 'bpmn:TimerStartEvent';
    else if (t0 === 'bpmn:IntermediateCatchEvent' && hasDef('bpmn:MessageEventDefinition')) type = 'bpmn:MessageIntermediateCatchEvent';
    else if (t0 === 'bpmn:IntermediateCatchEvent' && hasDef('bpmn:TimerEventDefinition')) type = 'bpmn:TimerIntermediateCatchEvent';
    else if (t0 === 'bpmn:IntermediateThrowEvent' && hasDef('bpmn:MessageEventDefinition')) type = 'bpmn:MessageIntermediateThrowEvent';

    // Relaciones super/sub + SubTasks
    let subTasks = [];
    let subElement = 'No Sub Element';
    let superElement = 'No Super Element';

    if (t0 === 'bpmn:DataInputAssociation') {
      const srcIds = ids(bo.sourceRef);
      superElement = srcIds.length ? srcIds.join(', ') : 'No Super Element';

      const targetTask = allElems.find((el) =>
        arr(el?.businessObject?.dataInputAssociations).some((assoc) => assoc?.id === bo.id)
      );
      subElement = safeId(targetTask) || 'No Sub Element';

    } else if (t0 === 'bpmn:DataOutputAssociation') {
      subElement = safeId(bo.targetRef) || 'No Sub Element';
      const parentTask = allElems.find((el) =>
        arr(el?.businessObject?.dataOutputAssociations).some((assoc) => assoc?.id === bo.id)
      );
      const pId = safeId(parentTask);
      superElement = pId ? pId : 'No Super Element';

    } else if (t0 === 'bpmn:BoundaryEvent' && bo.attachedToRef) {
      const attached = bo.attachedToRef;
      const outIds = arr(attached.outgoing).map((f) => safeId(f?.targetRef)).filter(Boolean);
      const inIds = arr(attached.incoming).map((f) => safeId(f?.sourceRef)).filter(Boolean);
      subElement = outIds.length ? outIds.join(', ') : 'No Sub Element';
      superElement = inIds.length ? inIds : 'No Super Element';

    } else if (t0 === 'bpmn:SequenceFlow' || t0 === 'bpmn:MessageFlow') {
      let src = bo.sourceRef || e.source || e.businessObject?.sourceRef;
      let tgt = bo.targetRef || e.target || e.businessObject?.targetRef;

      let srcId = safeId(src);
      let tgtId = safeId(tgt);

      if ((!tgtId || tgtId === 'undefined') && Array.isArray(e.waypoints) && e.waypoints.length) {
        const last = e.waypoints[e.waypoints.length - 1];
        const hitTgt = allElems.find(el => {
          if (isFlow(el)) return false;
          const b = getBounds(el);
          return pointIn(last, b);
        });
        tgtId = safeId(hitTgt) || tgtId;
      }

      if ((!srcId || srcId === 'undefined') && Array.isArray(e.waypoints) && e.waypoints.length) {
        const first = e.waypoints[0];
        const hitSrc = allElems.find(el => {
          if (isFlow(el)) return false;
          const b = getBounds(el);
          return pointIn(first, b);
        });
        srcId = safeId(hitSrc) || srcId;
      }

      subElement = tgtId || 'No Sub Element';
      superElement = srcId ? [ srcId ] : 'No Super Element';

    } else {
      const rawOutgoing = (arr(bo.outgoing).length ? arr(bo.outgoing) : arr(e.outgoing))
        .filter(flow => elementTypeOf(flow) === 'bpmn:SequenceFlow');
      const rawIncoming = (arr(bo.incoming).length ? arr(bo.incoming) : arr(e.incoming))
        .filter(flow => elementTypeOf(flow) === 'bpmn:SequenceFlow');

      let outIds = rawOutgoing
        .map(f => safeId(f?.targetRef || f?.target || f?.businessObject?.targetRef))
        .filter(Boolean);

      let inIds = rawIncoming
        .map(f => safeId(f?.sourceRef || f?.source || f?.businessObject?.sourceRef))
        .filter(Boolean);

      if (!outIds.length || !inIds.length) {
        const thisId = safeId(e) || safeId(bo);
        const allFlows = allElems.filter(x => {
          const tp = x?.type || x?.businessObject?.$type || '';
          return tp === 'bpmn:SequenceFlow';
        });

        if (!outIds.length) {
          outIds = allFlows
            .filter(f => safeId(f?.businessObject?.sourceRef || f?.source) === thisId)
            .map(f => safeId(f?.businessObject?.targetRef || f?.target))
            .filter(Boolean);
        }

        if (!inIds.length) {
          inIds = allFlows
            .filter(f => safeId(f?.businessObject?.targetRef || f?.target) === thisId)
            .map(f => safeId(f?.businessObject?.sourceRef || f?.source))
            .filter(Boolean);
        }
      }

      if (!outIds.length && Array.isArray(e.outgoing) && e.outgoing.length) {
        const inferredOut = [];
        e.outgoing.forEach(flow => {
          if (elementTypeOf(flow) !== 'bpmn:SequenceFlow') return;
          if (!flow || !Array.isArray(flow.waypoints) || !flow.waypoints.length) return;
          const last = flow.waypoints[flow.waypoints.length - 1];
          const hit = allElems.find(el => {
            if (!isFlowNodeCandidate(el)) return false;
            const b = getBounds(el);
            return pointIn(last, b);
          });
          const hid = safeId(hit);
          if (hid) inferredOut.push(hid);
        });
        if (inferredOut.length) outIds = inferredOut;
      }

      subTasks = outIds;
      subElement = outIds.length ? outIds.join(', ') : 'No Sub Element';
      superElement = inIds.length ? inIds : 'No Super Element';
    }

    // Otros campos
    const isServiceTask = t0 === 'bpmn:ServiceTask';
    const isProcess = t0 === 'bpmn:Process';
    const isCollab = t0 === 'bpmn:Collaboration';
    const isParticipant = t0 === 'bpmn:Participant';
    const isLane = t0 === 'bpmn:Lane';
    const percentageOfBranches = t0 === 'bpmn:SequenceFlow' ? bo.percentageOfBranches : undefined;

    let time = null;
    const timerDef = evDefs.find((d) => d?.$type === 'bpmn:TimerEventDefinition');
    if (timerDef?.timeDuration?.body) time = (timerDef.timeDuration.body).trim();

    const userTasks = arr(bo.UserTask).filter((s) => typeof s === 'string' && s.trim());
    const numberOfExecutions = bo.NumberOfExecutions ?? 1;
    const minimumTime = bo.minimumTime ?? 0;

    // Sin tiempo máximo, la tarea dura exactamente el tiempo mínimo.
    const maximumTime = bo.maximumTime ?? minimumTime;
    const loopParameter = (bo.loopParameter ?? undefined);
    const loopCharacteristics = bo.loopCharacteristics ?? undefined;
    const multiInstance = bo.loopCharacteristics?.isSequential;
    const AdditionalIntegerParameter = bo.AdditionalIntegerParameter ?? 0;

    let instance = '';
    let userWithRoleReturn = {};
    let userWithoutRole = [];
    let frequency = 0;
    let containedElements = ids(bo.flowNodeRef);
    let parentLane = '';

    if (isCollab) {
      if (bo.instance !== undefined) instance = bo.instance;

    } else if (isParticipant) {
      const processRef = bo.processRef;
      const participantFrequency = bo.frequency ?? bo.get?.('participantWithoutLane:frequency');
      if (participantFrequency !== undefined) frequency = participantFrequency;

      if (processRef) {
        if (Array.isArray(processRef.flowElements)) {
          containedElements = [
            ...containedElements,
            ...processRef.flowElements.map((n) => n?.id).filter(Boolean)
          ];
        }
        arr(processRef.laneSets).forEach((laneSet) => {
          arr(laneSet?.lanes).forEach((lane) => {
            containedElements.push(...ids(lane?.flowNodeRef));
          });
        });
      }
      containedElements = [ ...new Set(containedElements) ].filter(id => relevantElementIds.has(id));
      userWithoutRole = arr(bo.userWithoutRole).map((r) => String(r).trim()).filter(Boolean);

    } else if (isLane) {
      userWithoutRole = arr(bo.userWithoutRole).map((r) => String(r).trim()).filter(Boolean);
      containedElements = ids(bo.flowNodeRef);

      // Un subcarril cuelga de un childLaneSet cuyo padre es otro carril.
      const laneSetParent = bo.$parent?.$parent;
      parentLane = laneSetParent?.$type === 'bpmn:Lane' ? laneSetParent.id : '';

    } else if (isProcess) {
      if (bo.instance !== undefined) instance = bo.instance;

      if (Array.isArray(bo.userWithRole)) {
        userWithRoleReturn = Object.fromEntries(
          bo.userWithRole
            .filter((kv) => kv?.key)
            .map((kv) => [
              kv.key,
              String(kv.value ?? '')
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean)
            ])
        );
      } else if (bo.userWithRole && typeof bo.userWithRole === 'object') {
        userWithRoleReturn = bo.userWithRole;
      }

      userWithoutRole = [ ...new Set(arr(bo.userWithoutRole).filter(Boolean)) ];
      if (bo.frequency !== undefined) frequency = bo.frequency;

      const defaults = defaultsByProcessId.get(bo.id) || {};
      userWithRoleReturn = { ...defaults, ...userWithRoleReturn };

    } else {
      instance = bo.instance || '';
    }

    return {
      id_model: id_model,
      id_bpmn: bo.id || e.id || 'Unknown',
      name: bo.name || e.name || '',
      type,

      Mth: isServiceTask ? (bo.Mth || 0) : 0,
      P: isServiceTask ? (bo.P || 0) : 0,
      User: isServiceTask ? (bo.User || '') : '',
      UserTask: userTasks.join(', '),

      Log: bo.Log || '',
      SubTasks: subTasks,
      subElement,
      superElement,

      Instances: (isProcess || isCollab) ? (instance || 0) : 0,
      Frequency: (isProcess || isParticipant) ? (frequency || 0) : 0,
      PercentageOfBranches: percentageOfBranches,
      NumberOfExecutions: numberOfExecutions,
      MinimumTime: minimumTime,
      MaximumTime: maximumTime,
      UserInstance: instance,
      time,

      userWithoutRole: (isProcess || isLane || isParticipant) ? userWithoutRole : '',

      userWithRole: Object.entries(userWithRoleReturn || {}).map(([ role, users ]) => ({
        role,
        users: Array.isArray(users) ? users : (users != null ? [ users ] : [])
      })),

      loopParameter,
      loopCharacteristics,
      multiInstance,
      AdditionalIntegerParameter,
      containedElements,
      parentLane
    };
  });
}


function exportToEsper(bpmnModeler) {
  return new Promise((resolve, reject) => {
    try {
      const elements = getAllRelevantTasks(bpmnModeler);
      const safe = (s) => JSON.stringify(String(s ?? '')).slice(1, -1);

      let content = '### Esper Rules Export ###\n\n';

      elements.forEach(element => {

        // El tipo enriquecido ya viene calculado en getAllRelevantTasks (e.g., 'bpmn:MessageStartEvent').
        content += `Element: [type=${element.type}, `;
        content += `name="${safe(element.name) || 'Unnamed'}", `;
        content += `id_bpmn="${safe(element.id_bpmn) || 'Unknown'}", `;

        if (element.time) {
          content += `time=${element.time}, `;
        }

        if (
          element.type === 'bpmn:SequenceFlow' ||
          element.type === 'bpmn:MessageFlow' ||
          element.type === 'bpmn:DataObjectReference' ||
          element.type === 'bpmn:BoundaryEvent' ||
          element.type === 'bpmn:DataInputAssociation' ||
          element.type === 'bpmn:DataOutputAssociation'
        ) {
          if (element.type === 'bpmn:SequenceFlow' && element.PercentageOfBranches !== undefined &&
              element.PercentageOfBranches !== null && element.PercentageOfBranches !== 'N/A' &&
              element.PercentageOfBranches !== '') {
            content += `percentageOfBranches=${element.PercentageOfBranches}, `;
          }

          const superElement = typeof element.superElement === 'string'
            ? element.superElement
            : (Array.isArray(element.superElement) ? element.superElement.join(', ') : 'No Super Element');

          const subElement = element.subElement || 'No Sub Element';

          content += `superElement="${safe(superElement)}", `;
          content += `subElement="${safe(subElement)}"]\n`;

        } else if (
          element.type === 'bpmn:Task' ||
          element.type === 'bpmn:UserTask' ||
          element.type === 'bpmn:ManualTask' ||
          element.type === 'bpmn:SendTask' ||
          element.type === 'bpmn:ReceiveTask' ||
          element.type === 'bpmn:BusinessRuleTask' ||
          element.type === 'bpmn:ScriptTask' ||
          element.type === 'bpmn:CallActivity' ||
          element.type === 'bpmn:ServiceTask'
        ) {
          content += `userTask="${safe(element.UserTask)}", `;
          content += `numberOfExecutions=${element.NumberOfExecutions}, `;
          content += `minimumTime=${element.MinimumTime}, `;
          content += `maximumTime=${element.MaximumTime}, `;
          if (element.loopParameter !== undefined && element.loopParameter !== null && element.loopParameter !== 'undefined') {
            content += `loopParameter={"${safe(element.loopParameter)}":${element.AdditionalIntegerParameter}}, `;
          }
          if (element.loopCharacteristics?.isSequential !== undefined) {
            content += `multiInstanceType="${element.loopCharacteristics.isSequential ? 'true' : 'false'}", `;
          }
          const subTasks = element.SubTasks ? element.SubTasks.join(', ') : 'No SubTasks';
          content += `subTask="${safe(subTasks)}"]\n`;

        } else if (element.type === 'bpmn:Collaboration') {
          content += `instances=${element.Instances}]\n`;

        } else if (element.type === 'bpmn:Lane') {
          const userWithoutRole = Array.isArray(element.userWithoutRole)
            ? element.userWithoutRole.map(user => `"${safe(user)}"`).join(', ')
            : '""';

          const containedElements = element.containedElements && element.containedElements.length > 0
            ? element.containedElements.map(el => `"${safe(el)}"`).join(', ')
            : '""';

          const parentLane = element.parentLane ? `, parentLane="${safe(element.parentLane)}"` : '';
          content += `userWithoutRole=[${userWithoutRole}], containedElements=[${containedElements}]${parentLane}]\n`;

        } else if (element.type === 'bpmn:Process') {
          content += `instances=${element.Instances}, `;
          content += `frequency=${element.Frequency}, `;

          const userWithoutRole = Array.isArray(element.userWithoutRole)
            ? element.userWithoutRole.map(user => `"${safe(user)}"`).join(', ')
            : '""';
          content += `userWithoutRole=[${userWithoutRole}], `;

          // element.userWithRole es un array de { role, users }
          const userWithRole = element.userWithRole
            ? element.userWithRole
              .map(({ role, users }) => {
                const r = safe(role);
                const us = (Array.isArray(users) ? users : [ users ]).map(u => `"${safe(u)}"`).join(', ');
                return `"${r}": [${us}]`;
              })
              .join(', ')
            : '{}';

          content += `userWithRole={${userWithRole}}]\n`;

        } else if (element.type === 'bpmn:Participant') {
          const userWithoutRole = Array.isArray(element.userWithoutRole)
            ? element.userWithoutRole.map(user => `"${safe(user)}"`).join(', ')
            : '""';

          const containedElements = Array.isArray(element.containedElements)
            ? element.containedElements.map(el => `"${safe(el)}"`).join(', ')
            : '""';

          content += `frequency=${element.Frequency}, userWithoutRole=[${userWithoutRole}], containedElements=[${containedElements}]]\n`;

        } else {
          const subTasks = element.SubTasks ? element.SubTasks.join(', ') : 'No SubTasks';
          content += `subTask="${safe(subTasks)}"]\n`;
        }
      });

      if (elements.length === 0) {
        content += 'No elements generated.\n';
      }

      resolve(content);
    } catch (err) {
      reject(err);
    }
  });
}

export {
  exportToEsper
};
