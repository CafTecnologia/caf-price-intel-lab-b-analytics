import { notFound } from "next/navigation";

import { BatchReprocessForm } from "../../../../components/batch-reprocess-form";
import { NavigationTabs } from "../../../../components/navigation-tabs";
import { StatusPill } from "../../../../components/status-pill";
import { getLocalProcessingService } from "../../../../lib/server-data";

export default async function BatchesPage(props: { params: Promise<{ documentId: string }> }) {
  const { documentId } = await props.params;
  const record = getLocalProcessingService().getDocument(documentId);

  if (!record) {
    notFound();
  }

  return (
    <div className="stack">
      <NavigationTabs documentId={documentId} current="batches" />
      <section className="panel">
        <div className="panel-header">
          <div>
            <div className="eyebrow">Batch Review</div>
            <h1>{record.fileName}</h1>
          </div>
        </div>
      </section>

      {record.document.batches.map((batch) => (
        <section key={batch.batch_id} className="panel">
          <div className="panel-header">
            <div>
              <h2>{batch.batch_id}</h2>
              <p className="muted small">{batch.source_range.label}</p>
            </div>
            <div className="stack tight align-end">
              <StatusPill status={batch.validation_status} />
              <span className="small muted">retry_count: {batch.retry_count}</span>
            </div>
          </div>

          <div className="metric-grid compact">
            <div className="metric-card">
              <span className="metric-label">Candidate</span>
              <strong>{batch.candidate_item_count ?? 0}</strong>
            </div>
            <div className="metric-card">
              <span className="metric-label">Extracted</span>
              <strong>{batch.extracted_item_count ?? 0}</strong>
            </div>
            <div className="metric-card">
              <span className="metric-label">Validated</span>
              <strong>{batch.validated_item_count ?? 0}</strong>
            </div>
            <div className="metric-card">
              <span className="metric-label">Confidence</span>
              <strong>{batch.confidence_score ?? "n/a"}</strong>
            </div>
          </div>

          <div className="grid two">
            <div className="panel subtle">
              <div className="panel-header compact">
                <h3>Extraction Output</h3>
              </div>
              <pre className="code-block">{JSON.stringify(batch.output_json, null, 2)}</pre>
            </div>
            <div className="panel subtle">
              <div className="panel-header compact">
                <h3>Validation Output</h3>
              </div>
              <pre className="code-block">{JSON.stringify(batch.validation_json, null, 2)}</pre>
            </div>
          </div>

          {batch.warnings.length > 0 ? (
            <div className="panel subtle warning-panel">
              <div className="panel-header compact">
                <h3>Warnings</h3>
              </div>
              <ul className="plain-list">
                {batch.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="panel subtle">
            <div className="panel-header compact">
              <h3>Reprocess This Batch</h3>
              <p className="muted small">Override extract/validate provider or model for this batch only.</p>
            </div>
            <BatchReprocessForm documentId={documentId} batchId={batch.batch_id} />
          </div>
        </section>
      ))}
    </div>
  );
}
