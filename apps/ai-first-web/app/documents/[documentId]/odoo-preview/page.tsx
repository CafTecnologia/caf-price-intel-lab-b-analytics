import { notFound } from "next/navigation";

import { NavigationTabs } from "../../../../components/navigation-tabs";
import { getLocalProcessingService } from "../../../../lib/server-data";

export default async function OdooPreviewPage(props: { params: Promise<{ documentId: string }> }) {
  const { documentId } = await props.params;
  const record = getLocalProcessingService().getDocument(documentId);

  if (!record) {
    notFound();
  }

  return (
    <div className="stack">
      <NavigationTabs documentId={documentId} current="odoo" />
      <section className="panel">
        <div className="panel-header">
          <div>
            <div className="eyebrow">Odoo 19 Preview</div>
            <h1>{record.fileName}</h1>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Header Payload</h2>
        </div>
        <pre className="code-block">{JSON.stringify(record.odooPreview.header, null, 2)}</pre>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Line Preview</h2>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>External UID</th>
                <th>Item</th>
                <th>Description</th>
                <th>Qty</th>
                <th>Unit</th>
                <th>Unit Price</th>
                <th>Total</th>
                <th>Source</th>
                <th>Confidence</th>
              </tr>
            </thead>
            <tbody>
              {record.odooPreview.lines.map((line) => (
                <tr key={line.external_item_uid}>
                  <td>{line.external_item_uid}</td>
                  <td>{line.numero_item ?? "-"}</td>
                  <td>{line.nombre_o_descripcion ?? "-"}</td>
                  <td>{line.cantidad ?? "-"}</td>
                  <td>{line.unidad_medida ?? "-"}</td>
                  <td>{line.precio_referencia_unit ?? "-"}</td>
                  <td>{line.precio_referencia_total ?? "-"}</td>
                  <td>{line.source_location_label}</td>
                  <td>{line.confidence.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Full Preview Payload</h2>
        </div>
        <pre className="code-block">{JSON.stringify(record.odooPreview, null, 2)}</pre>
      </section>
    </div>
  );
}
