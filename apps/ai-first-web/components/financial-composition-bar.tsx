"use client";

import { formatCop, formatPercent } from "@web/lib/financial-simulation";

type Segment = {
  key: string;
  label: string;
  value: number;
  tone: "cost" | "utility" | "loss";
};

export function FinancialCompositionBar(props: {
  title: string;
  totalLabel: string;
  totalValue: number;
  costValue: number;
  utilityValue: number;
  note?: string;
  showFooter?: boolean;
}) {
  const safeTotal = props.totalValue > 0 ? props.totalValue : 0;
  const utilityIsPositive = props.utilityValue >= 0;
  const utilityMagnitude = Math.abs(props.utilityValue);
  const scaleBase = Math.max(safeTotal, props.costValue + utilityMagnitude, 1);

  const segments: Segment[] = utilityIsPositive
    ? [
        { key: "cost", label: "Costo", value: props.costValue, tone: "cost" },
        { key: "utility", label: "Utilidad", value: utilityMagnitude, tone: "utility" },
      ]
    : [
        { key: "cost", label: "Costo", value: props.costValue, tone: "cost" },
        { key: "loss", label: "Perdida", value: utilityMagnitude, tone: "loss" },
      ];

  return (
    <section className="financial-composition">
      <div className="panel-header compact">
        <div>
          <h3>{props.title}</h3>
          <p className="muted small">
            {props.totalLabel}: <strong>{formatCop(props.totalValue)}</strong>
          </p>
        </div>
        {props.note ? <div className="muted small">{props.note}</div> : null}
      </div>

      <div className="financial-composition-bar" role="img" aria-label={`${props.title}: ${props.totalLabel}`}>
        {segments.map((segment) => {
          const widthPct = Math.max((segment.value / scaleBase) * 100, segment.value > 0 ? 8 : 0);
          const valuePct = props.totalValue > 0 ? (segment.value / props.totalValue) * 100 : null;

          return (
            <div
              key={segment.key}
              className={`financial-composition-segment financial-composition-${segment.tone}`}
              style={{ width: `${Math.min(widthPct, 100)}%` }}
            >
              <span>{segment.label}</span>
              <strong>{formatCop(segment.value)}</strong>
              <small>{formatPercent(valuePct)}</small>
            </div>
          );
        })}
      </div>

      {props.showFooter === false ? null : (
        <div className="financial-composition-footer">
          <div className="financial-composition-stat">
            <span>Costo total</span>
            <strong>{formatCop(props.costValue)}</strong>
          </div>
          <div className="financial-composition-stat">
            <span>{utilityIsPositive ? "Utilidad total" : "Perdida estimada"}</span>
            <strong>{formatCop(props.utilityValue)}</strong>
          </div>
        </div>
      )}
    </section>
  );
}
