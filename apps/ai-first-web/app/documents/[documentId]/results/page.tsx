import { notFound } from "next/navigation";

import { NavigationTabs } from "../../../../components/navigation-tabs";
import { ResultsTable } from "../../../../components/results-table";
import { StatusPill } from "../../../../components/status-pill";
import { getLocalProcessingService } from "../../../../lib/server-data";

export default async function ResultsPage(props: { params: Promise<{ documentId: string }> }) {
  const { documentId } = await props.params;
  const record = getLocalProcessingService().getDocument(documentId);

  if (!record) {
    notFound();
  }

  return (
    <div className="stack">
      <NavigationTabs documentId={documentId} current="results" />
      <section className="panel">
        <div className="panel-header">
          <div>
            <div className="eyebrow">Results</div>
            <h1>{record.fileName}</h1>
          </div>
          <StatusPill status={record.processingStatus} />
        </div>
        <div className="actions-row">
          <a href={`/api/documents/${documentId}/export?format=json`} className="secondary-button link-button">
            Download JSON
          </a>
          <a href={`/api/documents/${documentId}/export?format=csv`} className="secondary-button link-button">
            Download CSV
          </a>
          <a href={`/api/documents/${documentId}/export?format=xlsx`} className="secondary-button link-button">
            Download XLSX
          </a>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Normalized Items</h2>
          <p className="muted small">{record.document.items.length} items ready for human review.</p>
        </div>
        <ResultsTable items={record.document.items} />
      </section>
    </div>
  );
}
