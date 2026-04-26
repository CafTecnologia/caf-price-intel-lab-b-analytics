import Link from "next/link";

import { listRecentDocuments } from "../lib/server-data";
import { StatusPill } from "./status-pill";

export function RecentDocuments() {
  const documents = listRecentDocuments(6);

  if (documents.length === 0) {
    return (
      <section className="panel">
        <div className="panel-header">
          <h2>Recent Runs</h2>
        </div>
        <p className="muted">No local runs yet. Upload a document to create the first auditable run.</p>
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Recent Runs</h2>
      </div>
      <div className="stack">
        {documents.map((record) => (
          <Link key={record.documentId} href={`/documents/${record.documentId}/processing`} className="run-card">
            <div>
              <strong>{record.fileName}</strong>
              <div className="muted small">{record.documentId}</div>
            </div>
            <div className="run-card-meta">
              <StatusPill status={record.processingStatus} />
              <span className="small muted">{new Date(record.updatedAt).toLocaleString()}</span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
