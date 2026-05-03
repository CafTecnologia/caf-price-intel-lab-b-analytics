"use client";

import { useEffect, useMemo, useState } from "react";

import { formatCop, formatNumber } from "@offer/lib/financial-engine";

type TrmResponse = {
  ok: boolean;
  value?: number;
  validFrom?: string | null;
  validTo?: string | null;
  fetchedAt?: string;
  source?: string;
  error?: string;
};

function parseDecimal(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function formatDate(value?: string | null): string {
  if (!value) return "N/D";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "N/D";
  return date.toLocaleDateString("es-CO", { year: "numeric", month: "short", day: "2-digit" });
}

export function TrmCalculator() {
  const [trm, setTrm] = useState<TrmResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [usdValue, setUsdValue] = useState("100");
  const [manualTrm, setManualTrm] = useState("");
  const [importPct, setImportPct] = useState("30");

  useEffect(() => {
    let cancelled = false;

    async function loadTrm() {
      setLoading(true);
      try {
        const response = await fetch("/api/trm", { cache: "no-store" });
        const data = (await response.json()) as TrmResponse;
        if (!cancelled) setTrm(data);
      } catch (error) {
        if (!cancelled) {
          setTrm({ ok: false, error: error instanceof Error ? error.message : "No se pudo consultar la TRM." });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadTrm();
    return () => {
      cancelled = true;
    };
  }, []);

  const calculation = useMemo(() => {
    const usd = parseDecimal(usdValue) ?? 0;
    const override = parseDecimal(manualTrm);
    const rate = override && override > 0 ? override : trm?.value ?? null;
    const pct = parseDecimal(importPct) ?? 0;
    const baseCop = rate ? usd * rate : null;
    const landedCop = baseCop !== null ? baseCop * (1 + pct / 100) : null;

    return { usd, rate, pct, baseCop, landedCop, usingManualTrm: !!override && override > 0 };
  }, [importPct, manualTrm, trm?.value, usdValue]);

  return (
    <details className="trm-tool">
      <summary className="trm-trigger">
        Calculadora TRM {calculation.rate ? formatCop(calculation.rate) : "N/D"}
      </summary>
      <section className="trm-popover-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">TRM</p>
            <h2>Calculadora USD a COP</h2>
          </div>
          <div className="header-actions">
            <span
              className="trm-help"
              title="Herramienta de apoyo: no cambia los ítems automáticamente. Copiá el valor convertido al costo manual cuando lo necesites."
            >
              i
            </span>
            <span className={`status-pill ${trm?.ok ? "viable" : "incomplete"}`}>{loading ? "Consultando" : trm?.ok ? "Actualizada" : "Manual"}</span>
          </div>
        </div>
        <div className="trm-grid">
          <div className="summary-card">
            <small>TRM vigente</small>
            <strong>{calculation.rate ? formatCop(calculation.rate) : "N/D"}</strong>
            <span className="muted">
              {calculation.usingManualTrm ? "Valor escrito manualmente" : trm?.ok ? `Vigencia: ${formatDate(trm.validFrom)}` : trm?.error ?? "Sin conexión"}
            </span>
          </div>
          <label>
            USD
            <input value={usdValue} inputMode="decimal" onChange={(event) => setUsdValue(event.target.value)} />
          </label>
          <label>
            TRM manual
            <input value={manualTrm} inputMode="decimal" onChange={(event) => setManualTrm(event.target.value)} placeholder="Opcional" />
          </label>
          <label>
            Costos importacion %
            <input value={importPct} inputMode="decimal" onChange={(event) => setImportPct(event.target.value)} />
          </label>
        </div>
        <div className="summary-grid trm-results">
          <div className="summary-card">
            <small>Base COP</small>
            <strong>{formatCop(calculation.baseCop)}</strong>
          </div>
          <div className="summary-card">
            <small>Con importacion</small>
            <strong>{formatCop(calculation.landedCop)}</strong>
          </div>
          <div className="summary-card">
            <small>Factor</small>
            <strong>{formatNumber(1 + calculation.pct / 100, 2)}x</strong>
          </div>
        </div>
      </section>
    </details>
  );
}
