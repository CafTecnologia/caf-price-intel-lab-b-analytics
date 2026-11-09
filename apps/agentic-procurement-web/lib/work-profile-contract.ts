export type WorkProfileId = "minimum_value_initial_assessment_v1" | (string & {});

export type WorkSkillKind =
  | "document_map"
  | "requirements"
  | "technical_scope"
  | "economic_structure"
  | "supervision";

export type WorkSkill = {
  id: string;
  kind: WorkSkillKind;
  label: string;
  purpose: string;
  instructions: string[];
  requiredOutputKeys: string[];
  sourceHints: string[];
};

export type WorkProfile = {
  contract: "caf-work-profile/v1";
  id: WorkProfileId;
  version: number;
  status: "draft" | "published";
  label: string;
  description: string;
  objective: string;
  compatibleProcessTypes: string[];
  protocolScope?: WorkProfileProtocolScope;
  /** Que documentos debe mirar. Se envia al modelo como orientacion de fuentes. */
  documentGuidance?: string;
  /** Como se reconoce una respuesta correcta. Se envia como criterio de calidad. */
  successCriteria?: string[];
  /** Que nunca debe hacer. */
  guardrails: string[];
  skills: WorkSkill[];
  outputContract: {
    id: "caf-project-initial-assessment/v1" | "caf-project-viability-screen/v1";
    sections: string[];
  };
  createdAt: string;
  updatedAt: string;
};

export type WorkProfileProtocolScope = {
  protocolId?: string;
  protocolName: string;
  macroStages: Array<{
    id: string;
    label: string;
    objective: string;
    expectedResult: string;
    recommendedOutputContract?: "caf-project-initial-assessment/v1" | "caf-project-viability-screen/v1";
    completionCriteria: string[];
    taskReferences: string[];
  }>;
};

export type WorkProfileProjectContext = {
  projectId?: string;
  projectName?: string;
  processNumber?: string;
  entity?: string;
  object?: string;
  modality?: string;
  amount?: string;
  closingDate?: string;
  stage?: string;
  protocol?: {
    id?: string;
    name?: string;
    currentMoment?: string;
    moments?: string[];
    tasks?: string[];
  };
  notes?: Array<{
    at?: string;
    author?: string;
    text: string;
  }>;
  companyKnowledge?: {
    status?: string;
    profileId?: string;
    profileName?: string;
    facts?: Array<{ category?: string; label: string; value: string; source?: string }>;
  };
  // Lo que SECOP publico despues de la descarga inicial. Una limitacion a
  // MIPYME territorial suele llegar por aqui, no en el pliego original.
  monitoring?: {
    status?: string;
    monitorActive?: boolean;
    alert?: { text?: string; url?: string; at?: string };
    publicMessages?: Array<{
      subject?: string; documentName?: string; description?: string; body?: string;
      kind?: string; importance?: string; isRelevant?: boolean; publishedAt?: string; url?: string;
    }>;
    fieldChanges?: Array<{ field?: string; oldValue?: string; newValue?: string; detectedAt?: string; origin?: string }>;
    scheduleMilestones?: Array<{ name?: string; start?: string; end?: string }>;
  };
};

export type PreparedProfileDocument = {
  id: string;
  name: string;
  mimeType: string;
  parser: string;
  size: number;
  text: string;
  itemCandidates: number;
  warnings: string[];
  catalogVersion?: number;
  sourceHash?: string;
  sourceRef?: string;
  pageCount?: number;
  contentState?: "ready" | "partial" | "deferred" | "failed";
  catalogStatus?: "cataloged" | "cataloged_with_warnings" | "failed";
  roleCandidates?: Array<{
    role: "governing" | "amendment" | "technical" | "economic" | "requirements" | "supporting" | "unknown";
    confidence: "high" | "medium" | "low";
    signal: string;
  }>;
  sections?: Array<{
    title: string;
    location: string;
    hints: string[];
  }>;
  tables?: Array<{
    name: string;
    location: string;
    rows?: number;
    columns?: number;
    hints: string[];
  }>;
  chunks?: Array<{
    id: string;
    location: string;
    text: string;
    method: "embedded_text" | "docling" | "ocr";
    skills: WorkSkillKind[];
    hints: string[];
  }>;
};

export type WorkSkillResult = {
  skillId: string;
  kind: WorkSkillKind;
  status: "completed" | "warning" | "failed";
  startedAt: string;
  completedAt: string;
  promptHash: string;
  prompt?: string;
  rawResponse?: string;
  output?: Record<string, unknown>;
  warnings: string[];
  error?: string;
};

export type WorkProfileRun = {
  contract: "caf-work-profile-run/v1";
  id: string;
  name: string;
  profileId: WorkProfileId;
  profileVersion: number;
  providerId: "mock" | "codex_pc" | "codex_vps";
  status: "draft" | "running" | "completed" | "needs_review" | "failed";
  project: WorkProfileProjectContext;
  documents: PreparedProfileDocument[];
  skills: WorkSkillResult[];
  finalArtifact?: WorkProfileArtifact;
  review?: {
    status: "open" | "resolved";
    note: string;
    updatedAt: string;
    resolvedAt?: string;
  };
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
};

export type WorkProfileArtifact = ProjectInitialAssessment | ProjectViabilityScreen;

export type ProjectViabilityScreen = {
  contract: "caf-project-viability-screen/v1";
  status: "ready" | "needs_review" | "insufficient_evidence";
  decision: "viable" | "not_viable" | "indeterminate";
  summary: string;
  limitingRequirements: Array<{
    id: string;
    title: string;
    requirement: string;
    impact: "medium" | "high" | "unknown";
    companyFit: "supported" | "not_supported" | "unknown" | "not_evaluated";
    evidence: Array<{ document: string; location: string; excerpt: string }>;
  }>;
  conditions: string[];
  missingInformation: string[];
  chatterSignals: Array<{ at?: string; author?: string; text: string; relevance: string }>;
  evidence: Array<{ document: string; location: string; excerpt: string }>;
  warnings: string[];
};

export type ProjectInitialAssessment = {
  contract: "caf-project-initial-assessment/v1";
  status: "ready" | "needs_review" | "insufficient_evidence";
  executiveSummary: string;
  documentAuthority: Array<{
    document: string;
    role: string;
    authority: "governing" | "modifies" | "supporting" | "unclear";
    reason: string;
  }>;
  relevantRequirements: Array<{
    id: string;
    category: string;
    title: string;
    normality: "normal" | "normal_actionable" | "unusual" | "limiting" | "unclear";
    impact: "low" | "medium" | "high" | "unknown";
    requirement: string;
    companyFit: "supported" | "not_supported" | "unknown" | "not_evaluated";
    action: string;
    evidence: Array<{ document: string; location: string; excerpt: string }>;
    confidence: "high" | "medium" | "low" | "no_data";
  }>;
  requestedScope: Array<{
    lot?: string;
    item?: string;
    description: string;
    unit?: string;
    quantity?: string;
    ceilingPrice?: string;
    evidence: Array<{ document: string; location: string; excerpt: string }>;
  }>;
  economicStructure: {
    hasUnitReferencePrices: boolean | null;
    hasTotalBudgetOnly: boolean | null;
    totalBudget?: string;
    currency?: string;
    notes: string[];
    evidence: Array<{ document: string; location: string; excerpt: string }>;
  };
  missingInformation: string[];
  humanQuestions: string[];
  warnings: string[];
};

const createdAt = "2026-08-10T00:00:00.000Z";

export const MINIMUM_VALUE_INITIAL_ASSESSMENT: WorkProfile = {
  contract: "caf-work-profile/v1",
  id: "minimum_value_initial_assessment_v1",
  version: 1,
  status: "published",
  label: "Analisis inicial de minima cuantia",
  description: "Encuentra rapidamente lo que solo aparece en los documentos y requiere atencion del equipo.",
  objective: "Preparar un mapa verificable de documentos, requisitos relevantes, alcance solicitado y estructura economica, sin decidir si CAF debe presentar oferta.",
  compatibleProcessTypes: ["minima cuantia", "invitacion publica", "compra de bienes y servicios"],
  guardrails: [
    "No inventar datos ni completar faltantes por intuicion; declarar cuando la evidencia sea insuficiente.",
    "No repetir datos generales que ya entrega Odoo salvo que un documento los contradiga.",
    "No presentar requisitos ordinarios como hallazgos, excepto los que exigen una accion concreta del equipo.",
    "Toda afirmacion material debe conservar documento, ubicacion y fragmento literal.",
    "No concluir viabilidad final ni inventar capacidad de la empresa cuando el perfil no tenga evidencia.",
    "Si versiones o adendas se contradicen, reportar el conflicto y no escoger silenciosamente una.",
    "Distinguir precio unitario, subtotal, presupuesto total y valor estimado."
  ],
  skills: [
    {
      id: "map_documents",
      kind: "document_map",
      label: "Mapa y autoridad documental",
      purpose: "Clasificar documentos y detectar cual gobierna o modifica los requisitos.",
      instructions: [
        "Usa primero nombre, ruta, fecha y encabezados antes de leer contenido extenso.",
        "Identifica invitacion/pliego, estudios previos, anexos tecnicos, formatos economicos, adendas y soportes.",
        "Una adenda modifica solo aquello que sustenta con evidencia."
      ],
      requiredOutputKeys: ["documents", "conflicts", "warnings"],
      sourceHints: ["invitacion", "pliego", "estudio previo", "adenda", "anexo", "formato economico"]
    },
    {
      id: "find_relevant_requirements",
      kind: "requirements",
      label: "Requisitos relevantes y atipicos",
      purpose: "Mostrar solo condiciones limitantes, raras o normales que obligan una accion.",
      instructions: [
        "Omitir requisitos empresariales rutinarios sin accion especial.",
        "Conservar garantias, muestras, visitas, experiencia especifica, personal, territorialidad, certificaciones cerradas y plazos inusuales.",
        "No inferir incumplimiento de CAF si no existe conocimiento empresarial suficiente."
      ],
      requiredOutputKeys: ["requirements", "missingInformation"],
      sourceHints: ["requisito", "habilitante", "experiencia", "garantia", "muestra", "visita", "domicilio", "certificado", "personal"]
    },
    {
      id: "extract_scope",
      kind: "technical_scope",
      label: "Alcance e items solicitados",
      purpose: "Localizar lotes, items, cantidades, unidades y especificaciones con su fuente.",
      instructions: [
        "Mantener numero de lote cuando exista.",
        "No mezclar tablas parecidas de cotizaciones, presupuesto y oferta sin identificar su rol.",
        "Si solo existe una lista narrativa, extraerla con fragmento literal y marcar faltantes."
      ],
      requiredOutputKeys: ["items", "coverage", "warnings"],
      sourceHints: ["lote", "item", "descripcion", "unidad", "cantidad", "especificacion", "ficha tecnica"]
    },
    {
      id: "extract_economics",
      kind: "economic_structure",
      label: "Estructura economica",
      purpose: "Determinar si hay precios unitarios, techo total o ambos, sin confundirlos.",
      instructions: [
        "Reconocer precios de referencia unitarios solo cuando la columna o contexto lo sustente.",
        "Separar subtotal, IVA, presupuesto oficial, CDP y cuantia del precio unitario.",
        "Si no hay precios unitarios, decirlo de forma expresa."
      ],
      requiredOutputKeys: ["economicStructure", "warnings"],
      sourceHints: ["precio unitario", "valor unitario", "precio de referencia", "presupuesto", "cdp", "iva", "subtotal"]
    },
    {
      id: "audit_assessment",
      kind: "supervision",
      label: "Supervision independiente",
      purpose: "Contrastar cobertura, evidencia y consistencia antes de mostrar el informe.",
      instructions: [
        "Rechazar afirmaciones materiales sin evidencia literal.",
        "Detectar contradicciones entre documentos y huecos de cobertura.",
        "Entregar preguntas humanas concretas, no recomendaciones genericas."
      ],
      requiredOutputKeys: ["finalArtifact", "quality", "warnings"],
      sourceHints: []
    }
  ],
  outputContract: {
    id: "caf-project-initial-assessment/v1",
    sections: ["executiveSummary", "documentAuthority", "relevantRequirements", "requestedScope", "economicStructure", "missingInformation", "humanQuestions", "warnings"]
  },
  createdAt,
  updatedAt: createdAt
};

export const MINIMUM_VALUE_SCOPE_AND_BUDGET: WorkProfile = {
  ...MINIMUM_VALUE_INITIAL_ASSESSMENT,
  id: "minimum_value_scope_and_budget_v1",
  label: "Minima cuantia - alcance y presupuesto",
  description: "Recupera lotes, items, cantidades y estructura economica sin releer documentos irrelevantes.",
  objective: "Construir una base verificable del alcance solicitado y de los precios de referencia o presupuesto disponible, conservando lote, unidad, cantidad y fuente.",
  guardrails: [
    ...MINIMUM_VALUE_INITIAL_ASSESSMENT.guardrails,
    "No convertir subtotales, presupuestos globales ni cotizaciones de apoyo en precios unitarios sin evidencia explicita.",
    "No omitir registros estructurados por resumir la respuesta; reportar cobertura y cualquier fila no interpretada."
  ],
  skills: MINIMUM_VALUE_INITIAL_ASSESSMENT.skills.filter((skill) =>
    ["document_map", "technical_scope", "economic_structure", "supervision"].includes(skill.kind)
  ),
  createdAt,
  updatedAt: createdAt
};

export const MINIMUM_VALUE_REQUIREMENTS_SCREEN: WorkProfile = {
  ...MINIMUM_VALUE_INITIAL_ASSESSMENT,
  id: "minimum_value_requirements_screen_v1",
  label: "Minima cuantia - requisitos que requieren atencion",
  description: "Busca limitantes, condiciones atipicas y requisitos normales que exigen una accion concreta.",
  objective: "Entregar una lista breve y sustentada de condiciones documentales que merecen atencion humana, sin repetir requisitos empresariales rutinarios ni decidir la viabilidad final.",
  guardrails: [
    ...MINIMUM_VALUE_INITIAL_ASSESSMENT.guardrails,
    "No convertir una ausencia de conocimiento empresarial en incumplimiento; usar unknown o not_evaluated.",
    "No incluir requisitos rutinarios salvo que impliquen una gestion, costo, plazo o riesgo concreto para esta oferta."
  ],
  skills: MINIMUM_VALUE_INITIAL_ASSESSMENT.skills.filter((skill) =>
    ["document_map", "requirements", "supervision"].includes(skill.kind)
  ),
  createdAt,
  updatedAt: createdAt
};

export const MINIMUM_VALUE_PREANALYSIS_VIABILITY: WorkProfile = {
  contract: "caf-work-profile/v1",
  id: "minimum_value_preanalysis_viability_v1",
  version: 1,
  status: "published",
  label: "Minima cuantia - viabilidad de pre-evaluacion",
  description: "Decide si la macrotarea inicial puede continuar, atendiendo solo requisitos limitantes sustentados.",
  objective: "Responder exclusivamente si el proyecto es viable para continuar la Pre-evaluacion del protocolo piloto de minima cuantia, usando documentos catalogados, novedades recientes del chatter y conocimiento empresarial disponible.",
  compatibleProcessTypes: ["contratacion minima cuantia", "minima cuantia"],
  protocolScope: {
    protocolId: "61",
    protocolName: "Piloto Minima Cuantia Carlos",
    macroStages: [{
      id: "pre-evaluacion",
      label: "Pre-evaluacion",
      objective: "Detectar requisitos limitantes que cambian la posibilidad de continuar el analisis inicial.",
      expectedResult: "Una decision unica: viable, no viable o indeterminada para continuar la Pre-evaluacion.",
      recommendedOutputContract: "caf-project-viability-screen/v1",
      completionCriteria: [
        "Los limitantes materiales tienen evidencia documental.",
        "La relacion con la empresa usa conocimiento disponible o declara el faltante.",
        "No se adelantan tareas de cotizacion, oferta o preparacion documental."
      ],
      taskReferences: ["Pre-evaluacion"]
    }]
  },
  guardrails: [
    "No inventar capacidades de la empresa, requisitos, hechos ni documentos; declarar indeterminate cuando falte evidencia.",
    "Toda condicion limitante debe conservar documento, ubicacion y fragmento literal verificable.",
    "El chatter es una senal operativa fechada: puede dirigir la lectura, pero no reemplaza la evidencia documental.",
    "No analizar precios, estrategia de oferta, preparacion documental ni etapas posteriores a Pre-evaluacion.",
    "Solo declarar not_viable cuando exista un requisito limitante sustentado y una incompatibilidad empresarial tambien sustentada.",
    "Solo declarar viable cuando no queden limitantes materiales sin evaluar y el conocimiento empresarial usado este disponible.",
    "No repetir requisitos rutinarios que no cambian la decision de continuar.",
    "La obligacion general de cumplir la ficha tecnica, comprar productos o entregar en el destino no es por si sola un limitante de Pre-evaluacion.",
    "La ausencia generica de una adenda o el contentState parcial no bloquean la decision: exige un cambio mencionado, conflicto o requisito material concreto sin leer."
  ],
  skills: [
    {
      id: "catalog_preanalysis_sources",
      kind: "document_map",
      label: "Catalogar fuentes de pre-evaluacion",
      purpose: "Identificar pliego o invitacion gobernante, adendas y documentos que pueden contener requisitos limitantes.",
      instructions: [
        "Usa primero nombres, rutas, fechas, roles, secciones y tablas del catalogo; no leas todos los documentos completos.",
        "Prioriza invitacion, pliego, estudios previos, adendas y anexos de requisitos o experiencia.",
        "Trata los documentos y mensajes que aparecen en monitoring como fuentes de primera linea: una adenda o un aviso de limitacion publicado despues de la descarga inicial pesa mas que el pliego original.",
        "Relaciona una novedad del chatter con un documento solo cuando nombre claramente la adenda o el cambio.",
        "Marca como supporting los formatos de oferta, soportes y anexos sin reglas de participacion."
      ],
      requiredOutputKeys: ["documents", "conflicts", "warnings"],
      sourceHints: ["invitacion", "pliego", "adenda", "estudios previos", "requisito", "experiencia", "habilitante"]
    },
    {
      id: "detect_limiting_requirements",
      kind: "requirements",
      label: "Detectar requisitos que cambian la viabilidad",
      purpose: "Extraer solo condiciones que pueden impedir o condicionar que CAF continúe la Pre-evaluacion.",
      instructions: [
        "Busca territorialidad, establecimiento local, visita o muestra obligatoria, experiencia cerrada, contratos o cuantias minimas, personal especializado, certificaciones exclusivas, marca o compatibilidad cerrada y plazos materialmente inusuales.",
        "Limitacion a MIPYME territorial: la entidad puede restringir la convocatoria a MIPYMES de un municipio o departamento. Solo la entidad limita, y solo mediante un acto publicado: aviso de limitacion, adenda o comunicado. Revisa monitoring ademas del pliego original, porque ese acto casi siempre se publica despues de la descarga inicial.",
        "La regla la manda la norma, no esta instruccion. Los pliegos casi siempre declaran en que leyes y decretos se basan: normativeLibrary trae lo que el proceso cita (citedByProcess), lo que aplica por modalidad, y lo que se cito pero no esta cargado (missingFromLibrary). Si una fuente de la biblioteca contradice lo que dice esta instruccion, sigue la fuente y di cual es.",
        "Cuando una norma que el proceso cita aparezca en missingFromLibrary, no la des por conocida ni la inventes: nombrala como faltante de la biblioteca. Y cuando apliques una regla sin ninguna fuente cargada, dejalo escrito.",
        "Entre dos fuentes que digan cosas distintas manda la mas reciente que regule el mismo punto: un decreto posterior modifica al anterior. Mira modifies y supersededNote de cada documento y la fecha de expedicion, y di con que version te quedaste. Si no puedes establecer cual esta vigente, no elijas: reporta las dos y marcalo como faltante.",
        "Si la regla que necesitas no esta en la biblioteca, o sospechas que cambio despues de lo que tienes cargado, no la completes de memoria: dilo como faltante y nombra la norma que habria que verificar. Los pliegos de pre-evaluacion casi siempre citan la norma aplicable, asi que empieza por ahi.",
        "Distingue dos cosas que no son lo mismo. Que un tercero SOLICITE limitar la convocatoria es una senal de riesgo y nunca limita el proceso: no la conviertas en limitante ni cambies la viabilidad por ella. Que la ENTIDAD publique el acto de limitacion si limita el proceso. Un asunto de mensaje que diga solicitud es lo primero, no lo segundo.",
        "La limitacion se responde en dos ejes separados y hay que contestar los dos. Uno: la entidad limito el proceso, si o no. Dos: la empresa cumple ese ambito, si o no. Son independientes.",
        "Que el proceso este limitado NO es por si mismo un impedimento. Si el ambito limitado incluye el domicilio inscrito de la empresa o alguno de sus establecimientos, la respuesta correcta es que si fue limitado Y que si cumple: no lo registres como limitante, porque la limitacion incluso reduce la competencia a favor. Solo es limitante cuando el ambito exigido deja a la empresa afuera.",
        "Para decidir el segundo eje compara el ambito del acto contra companyKnowledge: municipio y departamento del domicilio inscrito, establecimientos inscritos y tamano empresarial. Si la empresa no califica como MIPYME, una limitacion a Mipymes la excluye aunque el territorio coincida.",
        "Caso Bogota, unico en Colombia y que no se resuelve por logica: Bogota es Distrito Capital y no pertenece a Cundinamarca, pero en las limitaciones a Mipymes hay entidades de Cundinamarca que aceptan empresas de Bogota y otras que las excluyen expresamente. Cuando el domicilio de la empresa sea Bogota y el ambito limitado sea el departamento de Cundinamarca, o al reves, NO decidas: el eje de cumplimiento queda en to_confirm y el faltante es el texto del acto, que es lo unico que lo resuelve.",
        "Esa ambiguedad es solo de Bogota. Para el resto del pais la pertenencia municipio-departamento es directa: una empresa de Medellin cumple una limitacion al departamento de Antioquia, y una limitacion a un municipio distinto del suyo la deja afuera.",
        "Distingue siempre el nivel del ambito. Una limitacion municipal exige domicilio en ese municipio exacto y es mucho mas estrecha que una departamental. Si el acto dice municipal, no lo trates como departamental ni al reves.",
        "Si solo tienes solicitudes de terceros y ningun acto de la entidad, el proceso NO esta limitado a esa fecha. Registralo como riesgo a vigilar con el territorio que se pidio, no como limitante, y deja como faltante el acto de la entidad.",
        "El nombre de un archivo o el asunto de un mensaje prueban que el acto existe, no lo que dice. Nunca deduzcas de un titulo el ambito territorial ni la conclusion. Con solo el titulo puedes afirmar que la entidad publico el acto; el ambito queda pendiente y el texto del documento va como faltante. No cierres la viabilidad sobre una inferencia de titulo, por explicito que parezca.",
        "Esa desconfianza vale en los dos sentidos. Un archivo llamado aviso de no limitacion prueba que la entidad publico un aviso, no que el proceso quedo sin limitar: no lo uses para descartar la limitacion. Un titulo no alcanza ni para afirmar que algo se exige ni para afirmar que no se exige.",
        "Una cita es una frase de una sola fuente, copiada tal cual. No juntes fragmentos de documentos distintos separandolos con punto y coma o barra: cada pedazo puede existir y la frase resultante no existir en ninguna parte. Si te apoyas en dos fuentes, cita una y nombra la otra en el texto.",
        "Di siempre desde cuando vale tu respuesta. Usa monitoring.checkedAt y el hito del plazo para publicar el aviso de limitacion: mientras ese plazo no venza, cualquier no limitado es provisional. Dilo con la fecha.",
        "No bloquees la Pre-evaluacion por esto: el acto puede publicarse despues y cada macrotarea siguiente vuelve a verificarlo. Basta con que quede escrito que la observacion es provisional y hasta cuando.",
        "Incluye garantias u otros requisitos normales solo cuando exijan una accion inmediata que afecte continuar.",
        "No conviertas disponibilidad ordinaria de productos, entrega en el lugar contractual ni cumplimiento general de especificaciones en requisitos limitantes.",
        "Cada afirmacion que hagas sobre el proceso, sobre CAF o sobre la norma va acompanada de la frase textual de donde la sacaste, copiada literal del documento, mas su nombre y el lugar (pagina, articulo o seccion). Literal quiere decir que si se busca esa frase en el documento, aparece: no la resumas, no la reconstruyas, no la traduzcas.",
        "Si no puedes copiar una frase que sostenga lo que ibas a afirmar, no lo afirmes. Di que no esta y pasa a faltante. Es un error grave juntar dos renglones distantes de un mismo documento y presentarlos como un solo dato: un formulario con etiquetas y valores separados induce exactamente a eso.",
        "La ausencia de un requisito tambien es una respuesta, y hay que darla. Si leiste completo el documento que impondria el requisito -invitacion, pliego, estudios previos y sus adendas- y el requisito no aparece, la respuesta es que la entidad NO lo exige. No lo dejes en pending: pending significa que te falta leer algo, no que el documento callo.",
        "La condicion para responder que no se exige es haber leido la fuente que lo exigiria. Distingue las dos situaciones y dilo: no lo exige, porque revise la invitacion y las adendas; frente a no lo se, porque no tengo la invitacion. La primera cierra la pregunta, la segunda deja un faltante concreto.",
        "Para sostener una ausencia cita que revisaste: el documento gobernante, su alcance y las secciones donde el requisito habria aparecido. Una ausencia sin decir donde se busco no vale.",
        "Estas preguntas estan hechas para resolverse con lo disponible: los documentos del proceso, el conocimiento de la empresa y la biblioteca normativa. Si terminas dejando casi todo en pending, revisa si el problema es que te falta una fuente concreta -y entonces nombrala- o si estas evitando contestar algo que los documentos ya responden.",
        "Para la norma cita la pieza del inventario que trae normativeLibrary.passages, con su referencia y su articulo. No cites de memoria una norma cuyo texto no recibiste.",
        "Una marca o modelo solo es limitante si el documento cierra equivalencias, exige autorizacion exclusiva o existe evidencia empresarial de imposibilidad.",
        "Contrasta cada requisito con companyKnowledge y deja constancia del resultado. not_evaluated significa que no habia ningun hecho empresarial que hablara del tema, no que no lo miraste. Si companyKnowledge dice algo aplicable al requisito, tienes que resolverlo en supported o not_supported y citar el hecho que lo sostiene.",
        "No escribas en el resumen una conclusion que los requisitos no sostienen. Si vas a decir que la empresa no cumple, el requisito correspondiente tiene que quedar en not_supported con su evidencia; si lo dejas en not_evaluated, la conclusion no se sostiene y el resultado se degrada a indeterminate.",
        "No concluyas viabilidad en esta skill: entrega requisitos sustentados y faltantes concretos."
      ],
      requiredOutputKeys: ["requirements", "missingInformation"],
      sourceHints: ["experiencia", "domicilio", "establecimiento", "visita", "muestra", "certificacion", "personal", "garantia", "plazo", "exclusivo", "distribuidor"]
    },
    {
      id: "decide_preanalysis_viability",
      kind: "supervision",
      label: "Decidir continuidad de la pre-evaluacion",
      purpose: "Entregar una unica decision controlada y sustentada para la macrotarea Pre-evaluacion.",
      instructions: [
        "Devuelve viable, not_viable o indeterminate; no entregues una recomendacion general ni avances a otras tareas.",
        "not_viable exige al menos un requisito limitante con evidencia documental y companyFit=not_supported sustentado por conocimiento empresarial.",
        "Descarta cualquier requisito cuya cita textual no venga copiada del documento: tratalo como faltante, no como hecho. Una conclusion no se apoya en afirmaciones sin frase que las sostenga.",
        "La conclusion no puede contradecir las respuestas de las lineas. Si el eje que decide sigue en pending o to_confirm, la conclusion es indeterminate, nunca not_viable: no se descarta por lo que falta averiguar, solo por lo que consta.",
        "not_viable exige que el eje de cumplimiento este resuelto en no, con la evidencia que lo sostiene. Si sabes que la entidad limito pero no que ambito, eso es indeterminate mas un faltante concreto, y el proceso sigue vivo hasta que alguien lea el documento.",
      "viable exige que todo requisito de impacto alto tenga companyFit=supported y que no queden faltantes materiales.",
      "Todo faltante que impida decidir debe aparecer como requisito de impacto alto con companyFit unknown o not_evaluated; no lo escondas como una nota generica.",
      "Puede ser viable aunque queden compras, referencias, logistica o diligencias rutinarias para etapas posteriores; este perfil decide solo si continuar la Pre-evaluacion.",
        "Si falta conocimiento empresarial aplicable a un limitante real, una adenda expresamente mencionada no fue leida o existe contradiccion documental material, usa indeterminate y formula el faltante minimo.",
        "No uses contentState parcial o ausencia generica de adendas como unico motivo para indeterminate; identifica la evidencia material que falta.",
        "Usa las notas recientes del chatter solo como señales operativas y conserva autor, fecha y texto cuando sean relevantes."
      ],
      requiredOutputKeys: ["finalArtifact", "quality", "warnings"],
      sourceHints: []
    }
  ],
  outputContract: {
    id: "caf-project-viability-screen/v1",
    sections: ["decision", "summary", "limitingRequirements", "conditions", "missingInformation", "chatterSignals", "evidence", "warnings"]
  },
  createdAt,
  updatedAt: createdAt
};

export const BUILTIN_WORK_PROFILES = [
  MINIMUM_VALUE_INITIAL_ASSESSMENT,
  MINIMUM_VALUE_SCOPE_AND_BUDGET,
  MINIMUM_VALUE_REQUIREMENTS_SCREEN,
  MINIMUM_VALUE_PREANALYSIS_VIABILITY
];

export type WorkProfileOutputContractId = WorkProfile["outputContract"]["id"];

export function createWorkProfileDraftFromDocumentFoundation(
  outputContractId: WorkProfileOutputContractId = "caf-project-initial-assessment/v1"
): WorkProfile {
  const now = new Date().toISOString();
  const template = outputContractId === "caf-project-viability-screen/v1"
    ? MINIMUM_VALUE_PREANALYSIS_VIABILITY
    : MINIMUM_VALUE_INITIAL_ASSESSMENT;
  const suffix = Date.now().toString(36);
  const base = cloneProfile(template);
  return {
    ...base,
    // Catalogar y mapear la autoridad documental es un servicio del sistema:
    // se hace siempre, no se configura y no aparece entre las skills.
    skills: base.skills.filter((skill) => skill.kind !== "document_map"),
    id: `custom_profile_${suffix}`,
    version: 1,
    status: "draft",
    label: "Nuevo perfil personalizado",
    description: "Perfil creado sobre la preparacion documental estandar de CAF.",
    objective: "Describe el resultado concreto que debe producir este perfil.",
    compatibleProcessTypes: [],
    protocolScope: undefined,
    createdAt: now,
    updatedAt: now
  };
}

export function changeWorkProfileOutputContract(
  profile: WorkProfile,
  outputContractId: WorkProfileOutputContractId
): WorkProfile {
  const template = outputContractId === "caf-project-viability-screen/v1"
    ? MINIMUM_VALUE_PREANALYSIS_VIABILITY
    : MINIMUM_VALUE_INITIAL_ASSESSMENT;
  return {
    ...profile,
    skills: cloneProfile(template).skills,
    outputContract: cloneProfile(template).outputContract,
    updatedAt: new Date().toISOString()
  };
}

function cloneProfile(profile: WorkProfile): WorkProfile {
  return JSON.parse(JSON.stringify(profile)) as WorkProfile;
}
