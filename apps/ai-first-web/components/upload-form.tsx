"use client";

import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { startTransition, useState } from "react";
import type { AiProvider } from "@ai-first-contracts/enums";

export function UploadForm(props: { defaultProvider: AiProvider; defaultModel: string; defaultProviderLabel: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(formData: FormData) {
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/process", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "The local processing service could not process the document.");
      }

      const payload = (await response.json()) as { documentId: string };
      startTransition(() => {
        router.push(`/documents/${payload.documentId}/processing`);
      });
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "Unexpected upload error.");
      setIsSubmitting(false);
      return;
    }

    setIsSubmitting(false);
  }

  async function handleFormSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    await handleSubmit(formData);
  }

  return (
    <form className="panel form-panel" onSubmit={handleFormSubmit} encType="multipart/form-data">
      <div className="panel-header">
        <h2>Upload & Run</h2>
        <p className="muted">AI-first extraction, batch self-validation, and auditable local review.</p>
      </div>

      <p className="muted small">
        Motor principal actual: {props.defaultProviderLabel} con modelo `{props.defaultModel}`. Ese proveedor y ese modelo
        se aplican por defecto a todas las etapas del pipeline para este procesamiento.
      </p>

      <label className="field">
        <span>Source file</span>
        <input type="file" name="file" accept=".pdf,.xlsx,.xls,.docx,.doc" required />
      </label>

      <div className="grid two">
        <label className="field">
          <span>Batch size</span>
          <input type="number" name="batchSize" min={1} max={20} defaultValue={10} required />
        </label>
        <label className="field">
          <span>Reprocess allowed</span>
          <select name="allowBatchReprocess" defaultValue="true">
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        </label>
      </div>

      {error ? <p className="error-text">{error}</p> : null}

      <button type="submit" className="primary-button" disabled={isSubmitting}>
        {isSubmitting ? "Processing..." : "Start Processing"}
      </button>
    </form>
  );
}
