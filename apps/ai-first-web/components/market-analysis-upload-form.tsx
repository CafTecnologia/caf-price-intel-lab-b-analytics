"use client";

import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { startTransition, useState } from "react";
import type { AiProvider } from "@ai-first-contracts/enums";

export function MarketAnalysisUploadForm(props: {
  defaultProvider: AiProvider;
  defaultModel: string;
  defaultProviderLabel: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleFormSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/market-analysis", {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json().catch(() => null)) as { runId?: string; error?: string } | null;

        if (!response.ok) {
          if (payload?.runId) {
            startTransition(() => {
            router.push(`/market-analysis/${payload.runId}/financial`);
            });
            return;
          }

        throw new Error(payload?.error ?? "No se pudo ejecutar el análisis de mercado.");
      }

      if (!payload?.runId) {
        throw new Error("La API no devolvió un identificador de análisis.");
      }

      startTransition(() => {
        router.push(`/market-analysis/${payload.runId}/financial`);
      });
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "Error inesperado.");
      setIsSubmitting(false);
      return;
    }

    setIsSubmitting(false);
  }

  return (
    <form className="panel form-panel" onSubmit={handleFormSubmit} encType="multipart/form-data">
      <div className="panel-header">
        <div>
          <div className="eyebrow">Prompt maestro</div>
          <h2>Analizar mercado desde archivo</h2>
          <p className="muted small">
            Archivo completo, una sola corrida, matriz fija y luego simulación financiera.
          </p>
        </div>
      </div>

      <p className="muted small">
        Se usará <strong>{props.defaultProviderLabel}</strong> con modelo <strong>{props.defaultModel}</strong>. La app enviará el
        contenido del archivo al prompt maestro y convertirá la respuesta en una matriz fija de 15 columnas.
      </p>

      <label className="field">
        <span>Archivo fuente</span>
        <input type="file" name="file" accept=".pdf,.xlsx,.xls,.docx,.doc" required />
      </label>

      <div className="upload-hints">
        <span className="toggle-chip">PDF</span>
        <span className="toggle-chip">Excel</span>
        <span className="toggle-chip">Word</span>
      </div>

      {error ? <p className="error-text">{error}</p> : null}

      <button type="submit" className="primary-button" disabled={isSubmitting}>
        {isSubmitting ? "Analizando..." : "Analizar mercado"}
      </button>
    </form>
  );
}
