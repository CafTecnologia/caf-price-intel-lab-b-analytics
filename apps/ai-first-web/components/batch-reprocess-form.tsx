"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const PROVIDERS = ["openai", "gemini", "anthropic", "deepseek"] as const;

export function BatchReprocessForm(props: { documentId: string; batchId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="stack"
      action={async (formData) => {
        setPending(true);
        setError(null);

        try {
          const response = await fetch(`/api/documents/${props.documentId}/batches/${props.batchId}/reprocess`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify({
              extractProvider: formData.get("extractProvider"),
              extractModel: formData.get("extractModel"),
              validateProvider: formData.get("validateProvider"),
              validateModel: formData.get("validateModel"),
            }),
          });

          if (!response.ok) {
            const payload = (await response.json().catch(() => null)) as { error?: string } | null;
            throw new Error(payload?.error ?? "The batch could not be reprocessed.");
          }

          router.refresh();
        } catch (reprocessError) {
          setError(reprocessError instanceof Error ? reprocessError.message : "Unexpected batch reprocess error.");
        } finally {
          setPending(false);
        }
      }}
    >
      <div className="grid two">
        <label className="field">
          <span>Extract provider</span>
          <select name="extractProvider" defaultValue="openai">
            {PROVIDERS.map((provider) => (
              <option key={provider} value={provider}>
                {provider}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Extract model</span>
          <input name="extractModel" placeholder="Optional override" />
        </label>
        <label className="field">
          <span>Validate provider</span>
          <select name="validateProvider" defaultValue="openai">
            {PROVIDERS.map((provider) => (
              <option key={provider} value={provider}>
                {provider}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Validate model</span>
          <input name="validateModel" placeholder="Optional override" />
        </label>
      </div>
      {error ? <p className="error-text">{error}</p> : null}
      <button className="secondary-button" type="submit" disabled={pending}>
        {pending ? "Reprocessing..." : "Reprocess Batch"}
      </button>
    </form>
  );
}
