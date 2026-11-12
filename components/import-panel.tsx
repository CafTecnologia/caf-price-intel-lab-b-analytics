"use client";

import { DragEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";

import { appPath } from "@offer/lib/base-path";
import { inspectSpreadsheetFile, payloadFromPastedText, spreadsheetAccept } from "@offer/lib/client-ingest";
import { SAMPLE_PUBLIC_IMPORT_PAYLOAD } from "@offer/lib/contract";

type ImportTab = "json-file" | "paste-code" | "manual";

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function normalizeHeader(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function text(row: Record<string, unknown>, header: string): string {
  const wanted = normalizeHeader(header);
  const key = Object.keys(row).find((item) => normalizeHeader(item) === wanted);
  const value = key ? row[key] : undefined;
  return value === null || value === undefined ? "" : String(value).trim();
}

function firstText(row: Record<string, unknown>, headers: string[]): string {
  for (const header of headers) {
    const value = text(row, header);
    if (value) return value;
  }
  return "";
}

function valueOrNull(value: string): string | number | null {
  return value ? value : null;
}

function sourceFromRow(row: Record<string, unknown>, index: 1 | 2 | 3) {
  const name = text(row, `Proveedor ${index}`);
  const unitPrice = text(row, `Precio proveedor ${index}`);
  const currency = text(row, `Moneda proveedor ${index}`);
  const url = text(row, `URL proveedor ${index}`);
  const notes = text(row, `Notas proveedor ${index}`);
  const trm = text(row, `TRM proveedor ${index}`);

  if (!name && !unitPrice && !url && !notes) {
    return null;
  }

  return {
    name: name || null,
    unit_price: valueOrNull(unitPrice),
    currency: currency || "COP",
    url: url || undefined,
    notes: notes || undefined,
    trm: valueOrNull(trm),
  };
}

function rowsToPayload(rows: Array<Record<string, unknown>>) {
  const items = rows
    .map((row) => {
      const name = firstText(row, ["Nombre", "Nombre o descripción", "Nombre o descripcion"]);
      if (!name) return null;
      const priceSources = [sourceFromRow(row, 1), sourceFromRow(row, 2), sourceFromRow(row, 3)].filter(Boolean);
      return {
        item: firstText(row, ["Item", "No. item", "No item", "Número item", "Numero item", "Consecutivo interno"]) || undefined,
        name,
        description: firstText(row, ["Descripción", "Descripcion", "Detalles o ficha técnica", "Detalles o ficha tecnica", "Ficha técnica", "Ficha tecnica"]) || undefined,
        unit: firstText(row, ["Und de medida", "Unidad de medida", "Unidad", "Und"]) || undefined,
        quantity: valueOrNull(firstText(row, ["Cant", "Cantidad"])),
        ceiling_unit_price: valueOrNull(firstText(row, ["Precio techo unitario", "Precio techo encontrado", "Precio referencia unitario", "Precio referencia techo unit"])),
        notes: firstText(row, ["Notas del ítem", "Notas del item", "Observaciones", "Observación", "Observacion"]) || undefined,
        price_sources: priceSources,
      };
    })
    .filter(Boolean);

  return {
    version: 2,
    items,
  };
}

const excelExtensions = [".xlsx", ".xls", ".xlsm", ".csv"];
const excelMimeTypes = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
]);

function isExcelFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return excelExtensions.some((extension) => name.endsWith(extension)) || excelMimeTypes.has(file.type);
}

function isJsonFile(file: File): boolean {
  return file.name.toLowerCase().endsWith(".json") || file.type === "application/json";
}

const knownExcelHeaders = [
  "Item",
  "No. item",
  "Nombre",
  "Nombre o descripción",
  "Descripción",
  "Detalles o ficha técnica",
  "Und de medida",
  "Cant",
  "Precio techo unitario",
  "Precio techo encontrado",
  "Proveedor 1",
  "Precio proveedor 1",
];

function headerScore(row: unknown[]): number {
  const normalizedCells = row.map((value) => normalizeHeader(String(value ?? "")));
  return knownExcelHeaders.reduce((score, header) => (normalizedCells.includes(normalizeHeader(header)) ? score + 1 : score), 0);
}

function sheetToRecords(sheet: XLSX.WorkSheet): Array<Record<string, unknown>> {
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", blankrows: false });
  const headerIndex = matrix.reduce(
    (best, row, index) => {
      const score = headerScore(row);
      return score > best.score ? { index, score } : best;
    },
    { index: -1, score: 0 },
  );

  if (headerIndex.index < 0 || headerIndex.score < 2) {
    throw new Error("No encontré una fila de encabezados compatible con la plantilla.");
  }

  const headers = matrix[headerIndex.index].map((value) => String(value ?? "").trim());
  return matrix
    .slice(headerIndex.index + 1)
    .map((row) =>
      headers.reduce<Record<string, unknown>>((record, header, index) => {
        if (header) record[header] = row[index] ?? "";
        return record;
      }, {}),
    )
    .filter((row) => Object.values(row).some((value) => String(value ?? "").trim()));
}

export function ImportPanel(props: {
  targetCalculationId?: string | null;
  targetCalculationName?: string | null;
  targetCallbackUrl?: string | null;
  targetOdooDb?: string | null;
  resetStatus?: "success" | "warning" | null;
}) {
  const router = useRouter();
  const jsonInputRef = useRef<HTMLInputElement | null>(null);
  const excelInputRef = useRef<HTMLInputElement | null>(null);
  const [activeTab, setActiveTab] = useState<ImportTab>("json-file");
  const [dragActive, setDragActive] = useState(false);
  const [payload, setPayload] = useState(pretty(SAMPLE_PUBLIC_IMPORT_PAYLOAD));
  const [manualName, setManualName] = useState("Cálculo sin título");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [savedCalculationUrl, setSavedCalculationUrl] = useState<string | null>(null);
  const targetCalculationId = props.targetCalculationId?.trim() || null;
  const targetCalculationName = props.targetCalculationName?.trim() || null;
  const targetCallbackUrl = props.targetCallbackUrl?.trim() || null;
  const targetOdooDb = props.targetOdooDb?.trim() || null;
  const isPreparedTarget = Boolean(targetCalculationId);
  const [message, setMessage] = useState(
    props.resetStatus === "warning"
      ? "El cálculo quedó limpio y conserva su vínculo con Odoo, pero Odoo no confirmó el cambio. Puedes cargar los datos nuevamente."
      : props.resetStatus === "success"
        ? "Cálculo reiniciado. El vínculo con Odoo se conservó. Carga nuevos datos para comenzar."
        : isPreparedTarget
      ? "Este borrador todavía no contiene el estudio. Puedes cargar datos aquí o abrir el cálculo IA del proyecto si ya existe."
      : "Carga un archivo, pega datos o crea un borrador manual.",
  );

  async function notifyPreparedTargetLinked(calculation: { name?: string | null } | null | undefined) {
    if (!targetCalculationId) {
      return;
    }

    if (!targetCallbackUrl) {
      const response = await fetch(appPath(`/api/projects/${targetCalculationId}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Odoo no confirmó el vínculo del cálculo cargado.");
      if (data.odooSyncWarning) throw new Error(data.odooSyncWarning);
      return;
    }

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (targetOdooDb) {
      headers["X-Odoo-Database"] = targetOdooDb;
    }

    const externalUrl = new URL(appPath(`/calculations/${targetCalculationId}`), window.location.origin).toString();
    const response = await fetch(targetCallbackUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        calculationId: targetCalculationId,
        externalUrl,
        sourceTitle: calculation?.name ?? targetCalculationName ?? "Cálculo sin nombre",
        status: "linked",
      }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error ?? "Odoo no confirmó el vínculo del cálculo cargado.");
    }
  }

  async function importPayload(body: unknown) {
    if (savedCalculationUrl) return;
    setStatus("loading");
    setSavedCalculationUrl(null);
    setMessage("Importando datos...");
    try {
      const endpoint = targetCalculationId ? `/api/projects/${targetCalculationId}/append-items` : "/api/import";
      const response = await fetch(appPath(endpoint), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "No se pudo importar el JSON.");
      }
      const calculation = data.calculation ?? data.project;
      let syncWarning = "";
      if (targetCalculationId) {
        try {
          await notifyPreparedTargetLinked(calculation);
        } catch (syncError) {
          syncWarning = ` ${syncError instanceof Error ? syncError.message : "Odoo no confirmó el vínculo."}`;
        }
      }
      const destination = targetCalculationId ? `/calculations/${targetCalculationId}` : data.url;
      if (syncWarning) {
        setStatus("error");
        setSavedCalculationUrl(destination);
        setMessage(`Los datos se guardaron, pero Odoo no confirmó el vínculo.${syncWarning} No importes de nuevo: abre el cálculo guardado.`);
        return;
      }
      setStatus("success");
      setMessage(
        targetCalculationId
          ? `Borrador asociado actualizado: ${calculation?.name ?? targetCalculationName ?? "sin nombre"}.`
          : `Cálculo importado: ${calculation?.name ?? "sin nombre"}`,
      );
      router.push(destination);
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "No se pudo importar la información.");
    }
  }

  async function importJson() {
    try {
      await importPayload(payloadFromPastedText(payload));
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "No pude interpretar el texto pegado.");
    }
  }

  async function createManual() {
    if (targetCalculationId) {
      router.push(`/calculations/${targetCalculationId}`);
      return;
    }
    setStatus("loading");
    setMessage("Creando borrador...");
    try {
      const response = await fetch(appPath("/api/projects"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: manualName }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "No se pudo crear el cálculo.");
      }
      setStatus("success");
      router.push(data.url);
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "No se pudo crear el cálculo.");
    }
  }

  async function loadJsonFile(file: File) {
    setStatus("loading");
    setMessage("Leyendo JSON...");
    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw);
      setPayload(pretty(parsed));
      setStatus("success");
      setMessage(`${file.name} listo para importar.`);
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "No se pudo leer el JSON.");
    } finally {
      if (jsonInputRef.current) {
        jsonInputRef.current.value = "";
      }
      if (excelInputRef.current) {
        excelInputRef.current.value = "";
      }
    }
  }

  async function loadExcel(file: File) {
    setStatus("loading");
    setMessage("Leyendo Excel...");
    try {
      const preview = await inspectSpreadsheetFile(file);
      const body = preview.payload;
      setPayload(pretty(body));
      setStatus("success");
      setMessage(
        `Excel cargado: ${body.items.length} de ${preview.sourceRowCount} fila(s) listas desde ${preview.sheetName}.` +
          (preview.warnings.length ? ` Revisa: ${preview.warnings.join(" ")}` : " Importes y cantidades reconocidos sin alertas."),
      );
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "No se pudo leer el Excel.");
    } finally {
      if (jsonInputRef.current) {
        jsonInputRef.current.value = "";
      }
      if (excelInputRef.current) {
        excelInputRef.current.value = "";
      }
    }
  }

  async function loadFile(file: File) {
    if (isExcelFile(file)) {
      await loadExcel(file);
      return;
    }
    if (isJsonFile(file)) {
      await loadJsonFile(file);
      return;
    }
    setStatus("error");
    setMessage("Formato no soportado. Sube un archivo JSON, Excel o CSV.");
  }

  function onDrop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    setDragActive(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void loadFile(file);
  }

  return (
    <section className="launchpad-card" id="importar">
      <div className="panel-header launchpad-header">
        <div>
          <h1>{isPreparedTarget ? "Cargar datos al borrador" : "Nuevo cálculo"}</h1>
          {isPreparedTarget ? <p className="muted">{targetCalculationName ?? "Borrador asociado a Odoo"}</p> : null}
        </div>
        <button className="ghost-button" type="button" onClick={() => setPayload(pretty(SAMPLE_PUBLIC_IMPORT_PAYLOAD))}>
          Usar ejemplo
        </button>
      </div>

      <div className="import-tabs" role="tablist" aria-label="Entrada de datos">
        <button className={`tab ${activeTab === "json-file" ? "active" : ""}`} type="button" role="tab" aria-selected={activeTab === "json-file"} onClick={() => setActiveTab("json-file")}>
          Cargar archivo
        </button>
        <button className={`tab ${activeTab === "paste-code" ? "active" : ""}`} type="button" role="tab" aria-selected={activeTab === "paste-code"} onClick={() => setActiveTab("paste-code")}>
          Pegar datos
        </button>
        <button className={`tab ${activeTab === "manual" ? "active" : ""}`} type="button" role="tab" aria-selected={activeTab === "manual"} onClick={() => setActiveTab("manual")}>
          Creación Manual
        </button>
      </div>

      <div className="tab-panel">
        {activeTab === "json-file" ? (
          <div className="file-load-panel">
            <input
              ref={jsonInputRef}
              className="visually-hidden"
              type="file"
              accept={`.json,application/json,${spreadsheetAccept}`}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void loadFile(file);
              }}
            />
            <button
              className={`dropzone ${dragActive ? "is-dragging" : ""}`}
              type="button"
              onClick={() => jsonInputRef.current?.click()}
              onDragEnter={(event) => {
                event.preventDefault();
                setDragActive(true);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setDragActive(false)}
              onDrop={onDrop}
            >
              <span className="file-icon" aria-hidden="true" />
              <strong>Arrastra aquí un archivo JSON o Excel, o haz clic para subir</strong>
            </button>
            <div className="file-actions-row">
              <input
                ref={excelInputRef}
                className="visually-hidden"
                type="file"
                accept=".xlsx,.xls"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void loadExcel(file);
                }}
              />
              <button className="ghost-button spreadsheet-action" type="button" onClick={() => excelInputRef.current?.click()}>
                <span className="spreadsheet-action-icon upload" aria-hidden="true" />
                Cargar Excel
              </button>
              <a className="ghost-button spreadsheet-action" href={appPath("/api/template")} target="_blank">
                <span className="spreadsheet-action-icon download" aria-hidden="true" />
                Descargar plantilla
              </a>
              <button className="button" type="button" disabled={status === "loading" || Boolean(savedCalculationUrl)} onClick={importJson}>
                Importar
              </button>
            </div>
          </div>
        ) : null}

        {activeTab === "paste-code" ? (
          <div className="form-grid">
            <label>
              JSON o tabla de ítems
              <textarea
                className="json-textarea"
                value={payload}
                onChange={(event) => setPayload(event.target.value)}
                placeholder={"Item\tNombre\tDescripción\tUnd de medida\tCant\tPrecio techo unitario"}
                spellCheck={false}
              />
            </label>
            <div className="row-actions compact-row-actions">
              <button className="button" type="button" disabled={status === "loading" || Boolean(savedCalculationUrl)} onClick={importJson}>
                Importar
              </button>
            </div>
          </div>
        ) : null}

        {activeTab === "manual" ? (
          <div className="manual-create-panel">
            <label>
              {isPreparedTarget ? "Borrador asociado" : "Nuevo cálculo manual"}
              <input value={isPreparedTarget ? targetCalculationName ?? "Borrador asociado a Odoo" : manualName} onChange={(event) => setManualName(event.target.value)} disabled={isPreparedTarget} />
            </label>
            <button className="button" type="button" disabled={status === "loading"} onClick={createManual}>
              {isPreparedTarget ? "Abrir borrador" : "Crear borrador"}
            </button>
          </div>
        ) : null}
      </div>

      <div
        className={`status-line ${status === "error" ? "error" : status === "success" || props.resetStatus === "success" ? "success" : props.resetStatus === "warning" ? "warning" : ""}`}
        role={status === "error" || props.resetStatus === "warning" ? "alert" : "status"}
        aria-live="polite"
      >
        {message}
        {savedCalculationUrl ? (
          <button className="button" type="button" onClick={() => router.push(savedCalculationUrl)}>
            Abrir cálculo guardado
          </button>
        ) : null}
      </div>
    </section>
  );
}
