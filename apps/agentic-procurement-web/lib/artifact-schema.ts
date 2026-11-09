import { z } from "zod";

/**
 * El contrato de salida, comprobado de verdad.
 *
 * Hasta ahora solo se miraba que las claves existieran, no que su contenido
 * fuera el declarado. Por eso un `decision` podia venir con una frase entera
 * y pasaba: la clave estaba. Aqui la forma se comprueba, y lo que no cumple
 * se rechaza sin gastar un token en discutirlo.
 */

const evidencia = z.object({
  document: z.string(),
  location: z.string(),
  excerpt: z.string()
});

export const viabilityScreenSchema = z.object({
  contract: z.literal("caf-project-viability-screen/v1"),
  status: z.enum(["ready", "needs_review", "insufficient_evidence"]),
  decision: z.enum(["viable", "not_viable", "indeterminate"]),
  summary: z.string(),
  limitingRequirements: z.array(z.object({
    id: z.string(),
    title: z.string(),
    requirement: z.string(),
    impact: z.enum(["medium", "high", "unknown"]),
    companyFit: z.enum(["supported", "not_supported", "unknown", "not_evaluated"]),
    evidence: z.array(evidencia)
  })),
  conditions: z.array(z.string()),
  missingInformation: z.array(z.string()),
  chatterSignals: z.array(z.object({
    at: z.string().optional(),
    author: z.string().optional(),
    text: z.string(),
    relevance: z.string()
  })),
  evidence: z.array(evidencia),
  warnings: z.array(z.string())
});

export const initialAssessmentSchema = z.object({
  contract: z.literal("caf-project-initial-assessment/v1"),
  status: z.enum(["ready", "needs_review", "insufficient_evidence"]),
  executiveSummary: z.string(),
  documentAuthority: z.array(z.object({
    document: z.string(),
    role: z.string(),
    authority: z.enum(["governing", "modifies", "supporting", "unclear"]),
    reason: z.string()
  }))
}).passthrough();

export type ArtifactIssue = { path: string; problema: string };

/**
 * Una decision no puede contradecir lo que sostiene.
 *
 * Es la misma regla que aplicamos del lado de Odoo: descartar es la accion mas
 * cara, asi que exige que el requisito que la sostiene este resuelto en contra,
 * no pendiente de averiguar.
 */
function revisarCoherencia(artefacto: z.infer<typeof viabilityScreenSchema>): ArtifactIssue[] {
  const problemas: ArtifactIssue[] = [];
  const altos = artefacto.limitingRequirements.filter((r) => r.impact === "high");
  const sinResolver = altos.filter((r) => r.companyFit === "unknown" || r.companyFit === "not_evaluated");

  if (artefacto.decision === "not_viable" && !altos.some((r) => r.companyFit === "not_supported")) {
    problemas.push({
      path: "decision",
      problema: "descarta sin un requisito de impacto alto resuelto en contra; con ejes sin resolver corresponde indeterminate"
    });
  }
  if (artefacto.decision === "viable" && sinResolver.length) {
    problemas.push({
      path: "decision",
      problema: `declara viable con ${sinResolver.length} requisito(s) de impacto alto sin evaluar`
    });
  }
  for (const requisito of artefacto.limitingRequirements) {
    if (requisito.companyFit !== "not_supported") continue;
    if (!requisito.evidence.length) {
      problemas.push({
        path: `limitingRequirements.${requisito.id}`,
        problema: "afirma que la empresa no cumple sin una sola cita que lo sostenga"
      });
    }
  }
  return problemas;
}

export type ArtifactCheck =
  | { ok: true; artifact: z.infer<typeof viabilityScreenSchema>; issues: ArtifactIssue[] }
  | { ok: false; issues: ArtifactIssue[] };

export function checkViabilityArtifact(value: unknown): ArtifactCheck {
  const parsed = viabilityScreenSchema.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join(".") || "(raiz)",
        problema: issue.message
      }))
    };
  }
  return { ok: true, artifact: parsed.data, issues: revisarCoherencia(parsed.data) };
}
