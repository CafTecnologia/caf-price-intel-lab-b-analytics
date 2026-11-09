import type { WorkProfile, WorkSkillKind } from "./work-profile-contract";

export type WorkProfileValidation = {
  ok: boolean;
  checks: Array<{ id: string; ok: boolean; message: string }>;
};

const INITIAL_ASSESSMENT_KINDS: WorkSkillKind[] = [
  "requirements",
  "technical_scope",
  "economic_structure",
  "supervision"
];

// La catalogacion no se declara: la ejecuta el sistema antes de toda skill.
const VIABILITY_KINDS: WorkSkillKind[] = ["requirements", "supervision"];

export function validateWorkProfileDefinition(profile: WorkProfile): WorkProfileValidation {
  const ids = profile.skills.map((skill) => skill.id);
  const kinds = profile.skills.map((skill) => skill.kind);
  const requiredKinds = profile.outputContract.id === "caf-project-viability-screen/v1"
    ? VIABILITY_KINDS : INITIAL_ASSESSMENT_KINDS;
  const outputIsValid = profile.outputContract.id === "caf-project-viability-screen/v1"
    ? ["decision", "limitingRequirements", "missingInformation"].every((key) => profile.outputContract.sections.includes(key))
    : ["relevantRequirements", "requestedScope", "economicStructure"].every((key) => profile.outputContract.sections.includes(key));
  const recommendedContracts = [...new Set((profile.protocolScope?.macroStages || []).map((stage) => stage.recommendedOutputContract).filter(Boolean))];
  const checks = [
    check("identity", /^[a-z0-9_-]{4,80}$/.test(profile.id) && Boolean(profile.label.trim()) && Boolean(profile.objective.trim()), "Identidad y objetivo completos."),
    check("unique_skills", new Set(ids).size === ids.length, "Cada skill tiene un identificador unico."),
    check("pipeline", requiredKinds.every((kind) => kinds.includes(kind)), profile.outputContract.id === "caf-project-viability-screen/v1" ? "El perfil cubre requisitos y decision supervisada." : "El perfil cubre requisitos, alcance, economia y supervision."),
    check("instructions", profile.skills.every((skill) => skill.instructions.some((entry) => entry.trim()) && skill.requiredOutputKeys.length > 0), "Todas las skills tienen instrucciones y salida exigible."),
    check("evidence", profile.guardrails.some((rule) => /evidencia|fragmento|fuente/i.test(rule)), "El perfil exige evidencia verificable."),
    check("uncertainty", profile.guardrails.some((rule) => /no invent|falta|desconoc|unknown|no_data/i.test(rule)), "El perfil conserva incertidumbre y prohibe completar por intuicion."),
    check("protocol_scope", !profile.protocolScope || (Boolean(profile.protocolScope.protocolName.trim()) && profile.protocolScope.macroStages.length > 0 && profile.protocolScope.macroStages.every((stage) => Boolean(stage.label.trim()) && Boolean(stage.expectedResult.trim()) && stage.completionCriteria.length > 0)), "El alcance de protocolo tiene macrotareas y criterios de terminacion."),
    check("protocol_output", recommendedContracts.length === 0 || (recommendedContracts.length === 1 && recommendedContracts[0] === profile.outputContract.id), "El tipo de resultado coincide con la salida recomendada por las macrotareas."),
    check("output", outputIsValid, "El contrato final conserva sus secciones normalizadas."),
    check("supervision_last", profile.skills.at(-1)?.kind === "supervision", "La supervision ocurre despues de las skills de extraccion.")
  ];
  return { ok: checks.every((entry) => entry.ok), checks };
}

function check(id: string, ok: boolean, message: string) {
  return { id, ok, message };
}
