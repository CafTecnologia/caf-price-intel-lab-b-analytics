import Link from "next/link";
import { notFound } from "next/navigation";

import { NavigationTabs } from "../../../../components/navigation-tabs";
import { StatusPill } from "../../../../components/status-pill";
import { getLocalProcessingService } from "../../../../lib/server-data";

export default async function ProcessingPage(props: { params: Promise<{ documentId: string }> }) {
  const { documentId } = await props.params;
  const record = getLocalProcessingService().getDocument(documentId);

  if (!record) {
    notFound();
  }

  const providerSummary = Object.entries(record.document.provider_config_used).map(([task, config]) => ({
    task,
    value: `${config.provider} / ${config.model}`,
  }));

  return (
    <div className="stack">
      <NavigationTabs documentId={documentId} current="processing" />
      <section className="panel">
        <div className="panel-header">
          <div>
            <div className="eyebrow">Processing Summary</div>
            <h1>{record.fileName}</h1>
            <p className="muted small">{record.documentId}</p>
          </div>
          <StatusPill status={record.processingStatus} />
        </div>

        <div className="metric-grid">
          <div className="metric-card">
            <span className="metric-label">Selected segments</span>
            <strong>{record.trace.metrics.selected_segment_count}</strong>
          </div>
          <div className="metric-card">
            <span className="metric-label">Candidate fragments</span>
            <strong>{record.trace.metrics.candidate_fragment_count}</strong>
          </div>
          <div className="metric-card">
            <span className="metric-label">Planned batches</span>
            <strong>{record.trace.metrics.planned_batch_count}</strong>
          </div>
          <div className="metric-card">
            <span className="metric-label">Retried batches</span>
            <strong>{record.trace.metrics.retried_batch_count}</strong>
          </div>
          <div className="metric-card">
            <span className="metric-label">Validated items</span>
            <strong>{record.document.total_validated_items}</strong>
          </div>
          <div className="metric-card">
            <span className="metric-label">Final confidence</span>
            <strong>{record.document.final_confidence_score ?? "n/a"}</strong>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Stage View</h2>
        </div>
        <div className="timeline-grid">
          <div className="timeline-card">
            <strong>1. Intake & Segmentation</strong>
            <p className="muted small">{record.sourceSegments.length} source segments stored for this run.</p>
          </div>
          <div className="timeline-card">
            <strong>2. Official Block Detection</strong>
            <p className="muted small">
              {record.document.detection_summary.selected_blocks.length} relevant blocks chosen by the AI detection pass.
            </p>
          </div>
          <div className="timeline-card">
            <strong>3. Batch Extraction</strong>
            <p className="muted small">
              {record.document.total_extracted_items} items extracted across {record.document.batches.length} batches.
            </p>
          </div>
          <div className="timeline-card">
            <strong>4. Batch Validation</strong>
            <p className="muted small">
              {record.document.batches.filter((batch) => batch.validation_status === "completed").length} batches accepted
              without retry.
            </p>
          </div>
          <div className="timeline-card">
            <strong>5. Global Validation & Consolidation</strong>
            <p className="muted small">{record.document.items.length} final items are ready for human review.</p>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Batch Progress</h2>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Batch</th>
                <th>Source Range</th>
                <th>Extract Status</th>
                <th>Validate Status</th>
                <th>Extracted</th>
                <th>Validated</th>
                <th>Retry Count</th>
              </tr>
            </thead>
            <tbody>
              {record.document.batches.map((batch) => (
                <tr key={batch.batch_id}>
                  <td>{batch.batch_id}</td>
                  <td>{batch.source_range.label}</td>
                  <td>{batch.extraction_status}</td>
                  <td>{batch.validation_status}</td>
                  <td>{batch.extracted_item_count ?? 0}</td>
                  <td>{batch.validated_item_count ?? 0}</td>
                  <td>{batch.retry_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Providers Used</h2>
        </div>
        <div className="stack">
          {providerSummary.map((entry) => (
            <div key={entry.task} className="summary-row">
              <span>{entry.task}</span>
              <strong>{entry.value}</strong>
            </div>
          ))}
        </div>
      </section>

      {record.document.global_warnings.length > 0 ? (
        <section className="panel warning-panel">
          <div className="panel-header">
            <h2>Warnings</h2>
          </div>
          <ul className="plain-list">
            {record.document.global_warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="actions-row">
        <Link href={`/documents/${documentId}/results`} className="primary-button link-button">
          Open Results
        </Link>
        <Link href={`/documents/${documentId}/batches`} className="secondary-button link-button">
          Review Batches
        </Link>
        <Link href={`/documents/${documentId}/odoo-preview`} className="secondary-button link-button">
          Open Odoo Preview
        </Link>
      </div>
    </div>
  );
}
