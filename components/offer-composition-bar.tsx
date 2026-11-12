"use client";

import React, { useEffect, useRef, useState } from "react";
import { formatCop, formatPercent } from "../lib/financial-engine";
import { offerBarLayout } from "../lib/offer-bar-layout";

type Props = {
  offer: number | null;
  ceiling: number | null;
  cost: number | null;
  netUtility: number | null;
  deductions: number | null;
  scope: string;
  compact: boolean;
  preliminary?: boolean;
  utilityLabel?: string;
  costOverview?: {
    knownCost: number | null;
    knownCostCount: number;
    knownOffer: number | null;
    knownOfferCount: number;
    itemCount: number;
    pendingCostCount: number;
    pendingOfferCount: number;
    costComplete: boolean;
  };
};

function shortCop(value: number): string {
  const compact = (amount: number) => new Intl.NumberFormat("es-CO", { maximumFractionDigits: 1 }).format(amount);
  if (Math.abs(value) >= 1_000_000_000) return `$ ${compact(value / 1_000_000_000)} mil M`;
  if (Math.abs(value) >= 1_000_000) return `$ ${compact(value / 1_000_000)} M`;
  if (Math.abs(value) >= 1_000) return `$ ${new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 }).format(value / 1_000)} mil`;
  return formatCop(value);
}

type Callout = { key: string; label: string; value: number; detail: string; anchor: number; color: string; x: number };

function placeCallouts(items: Omit<Callout, "x">[], width: number): Callout[] {
  const bubbleWidth = 160;
  const gap = 8;
  const placed = items.map((item) => ({ ...item, x: Math.max(0, Math.min(width - bubbleWidth, item.anchor - bubbleWidth / 2)) }));
  for (let i = placed.length - 2; i >= 0; i -= 1) {
    placed[i].x = Math.max(0, Math.min(placed[i].x, placed[i + 1].x - bubbleWidth - gap));
  }
  return placed;
}

type CompactMarker = { key: string; label: string; value: number; pct: number; anchor: number; width: number; row: number; title: string; x: number };

function placeCompactMarkers(items: Omit<CompactMarker, "x">[], width: number): CompactMarker[] {
  const placed = items.map((item) => ({ ...item, x: Math.max(0, Math.min(width - item.width, item.anchor - item.width / 2)) }));
  for (const row of [0, 1]) {
    const rowItems = placed.filter((item) => item.row === row);
    for (let i = rowItems.length - 2; i >= 0; i -= 1) {
      rowItems[i].x = Math.max(0, Math.min(rowItems[i].x, rowItems[i + 1].x - rowItems[i].width - 5));
    }
  }
  return placed;
}

export function OfferCompositionBar({ offer, ceiling, cost, netUtility, deductions, scope, compact, preliminary = false, utilityLabel = "Utilidad neta", costOverview }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [trackWidth, setTrackWidth] = useState(0);
  const hasOffer = offer !== null && offer > 0;
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const observer = new ResizeObserver(() => setTrackWidth(track.clientWidth));
    observer.observe(track);
    setTrackWidth(track.clientWidth);
    return () => observer.disconnect();
  }, [hasOffer]);
  const layout = offerBarLayout({ offer, ceiling, cost, netUtility, deductions });
  if (costOverview && ceiling !== null && ceiling >= 0) {
    const knownCost = costOverview.knownCost;
    const scale = Math.max(ceiling, knownCost ?? 0, 1);
    const costGap = knownCost === null ? null : ceiling - knownCost;
    const gapLabel = costGap !== null && costGap < 0
      ? costOverview.costComplete ? "Costo supera techo" : "Costo conocido supera techo"
      : costOverview.costComplete ? "Saldo frente al techo" : "Saldo antes de costos pendientes";
    const costLabel = costOverview.costComplete ? "Costo total" : `Costos conocidos · ${costOverview.knownCostCount}/${costOverview.itemCount}`;
    const costPct = (knownCost ?? 0) / scale * 100;
    const gapPct = Math.max(0, costGap ?? 0) / scale * 100;
    const costInside = !compact && (trackWidth === 0 || trackWidth * costPct / 100 >= 170);
    const gapInside = !compact && costGap !== null && costGap >= 0 && (trackWidth === 0 || trackWidth * gapPct / 100 >= 170);
    // Two fixed 160px bubbles cannot share a narrow bar without covering each other.
    const narrowBudgetTrack = !compact && trackWidth > 0 && trackWidth < 328;
    const callouts = !compact && !narrowBudgetTrack && trackWidth > 0 ? placeCallouts([
      ...(!costInside && knownCost !== null ? [{ key: "cost", label: costLabel, value: knownCost, detail: "Del techo global", anchor: trackWidth * costPct / 200, color: "#a34f4d" }] : []),
      ...(!gapInside && costGap !== null ? [{ key: "budget-gap", label: gapLabel, value: Math.abs(costGap), detail: "No es utilidad", anchor: trackWidth * (costPct + gapPct / 2) / 100, color: "#777674" }] : []),
    ], trackWidth) : [];
    return (
      <div className={`offer-graphic budget-cost-overview ${costOverview.costComplete ? "is-cost-comparable" : "is-preliminary"} ${compact ? "is-compact" : "is-expanded"}`}>
        <div className="offer-graphic-head"><strong><small>Techo global</small>{formatCop(ceiling)}</strong></div>
        {callouts.length ? <div className="offer-graphic-callouts" aria-hidden="true">
          <svg className="offer-graphic-callout-lines" width="100%" height="56" viewBox={`0 0 ${Math.max(trackWidth, 1)} 56`} preserveAspectRatio="none">
            {callouts.map((item) => <g key={item.key}><path d={`M ${item.x + 80} 42 L ${item.anchor} 55`} stroke={item.color} strokeWidth="1.5" fill="none" /><circle cx={item.anchor} cy="55" r="2.5" fill={item.color} /></g>)}
          </svg>
          {callouts.map((item) => <span key={item.key} className={`offer-graphic-callout is-${item.key}`} style={{ left: item.x }}><small>{item.label}</small><strong>{formatCop(item.value)}</strong><em>{item.detail}</em></span>)}
        </div> : null}
        <div ref={trackRef} className="offer-graphic-track" role="img" aria-label={`Techo global ${formatCop(ceiling)}. ${costLabel} ${formatCop(knownCost)}. ${gapLabel} ${formatCop(costGap === null ? null : Math.abs(costGap))}. ${costOverview.pendingCostCount} ítems sin costo y ${costOverview.pendingOfferCount} sin oferta. Esta diferencia no es utilidad ni oferta.`}>
          <div className={`budget-cost-fill ${costInside ? "has-inside-label" : ""}`} style={{ width: `${costPct}%` }}>
            {costInside ? <span><small>{costLabel}</small><strong>{formatCop(knownCost)}</strong><em>{formatPercent(knownCost !== null && ceiling > 0 ? knownCost / ceiling * 100 : 0)} del techo</em></span> : null}
          </div>
          {costGap !== null && costGap > 0 ? <div className={`budget-gap-fill ${gapInside ? "has-inside-label" : ""}`} style={{ width: `${gapPct}%` }}>
            {gapInside ? <span><small>{gapLabel}</small><strong>{formatCop(costGap)}</strong><em>No es utilidad</em></span> : null}
          </div> : null}
          <div className="budget-ceiling-marker" style={{ left: `${ceiling / scale * 100}%` }} />
        </div>
        {compact || narrowBudgetTrack ? <div className="offer-graphic-compact-legend">
          {knownCost !== null ? <span className="offer-graphic-key is-cost" title={`${costLabel} ${formatCop(knownCost)}`}><i aria-hidden="true" />Costo <strong>{shortCop(knownCost)}</strong></span> : null}
          {costGap !== null ? <span className="offer-graphic-key is-budget-gap" title={`${gapLabel} ${formatCop(Math.abs(costGap))}. No es utilidad.`}><i aria-hidden="true" />{costGap < 0 ? "Exceso" : "Saldo"} <strong>{shortCop(Math.abs(costGap))}</strong></span> : null}
        </div> : null}
      </div>
    );
  }
  if (!hasOffer) {
    return <div className="offer-graphic-empty">Completa los costos y precios para ver la composición de la oferta.</div>;
  }

  const segments = [
    { key: "cost", label: "Costo", value: cost ?? 0, pct: layout.costPct },
    { key: "utility", label: utilityLabel, value: Math.max(0, netUtility ?? 0), pct: layout.utilityPct },
    { key: "deductions", label: "Retenciones", value: deductions ?? 0, pct: layout.deductionsPct },
  ].filter((segment) => segment.value > 0.005);
  const excessDetail = ceiling === 0 ? "sobre techo cero" : formatPercent((layout.excess / ceiling!) * 100) + " del techo";
  const description = `${scope}. Valor a ofertar ${formatCop(offer)}. ${segments.map((segment) => `${segment.label} ${formatCop(segment.value)}, ${formatPercent(segment.pct)} de la oferta`).join(". ")}. ${ceiling !== null ? `Precio techo ${formatCop(ceiling)}` : "Precio techo pendiente"}.${layout.discount ? ` Descuento ${formatCop(layout.discount)}, ${formatPercent((layout.discount / ceiling!) * 100)} del techo.` : ""}${layout.excess ? ` Exceso ${formatCop(layout.excess)}, ${excessDetail}.` : ""}${layout.isLoss ? ` Pérdida ${formatCop(layout.loss)}.` : ""}`;
  const discountWidth = trackWidth * layout.discountWidthPct / 100;
  const segmentCallouts = !compact && !layout.isLoss && trackWidth > 0 ? segments.filter((segment) => {
    const width = trackWidth * layout.offerWidthPct / 100 * segment.pct / 100;
    return width < (segment.key === "deductions" ? 145 : 120);
  }) : [];
  const segmentCalloutKeys = new Set(segmentCallouts.map((segment) => segment.key));
  const showDiscountCallout = !compact && trackWidth > 0 && layout.discount > 0 && discountWidth < 145;
  const callouts = placeCallouts([
    ...segmentCallouts.map((segment) => ({
      key: segment.key,
      label: segment.label,
      value: segment.value,
      detail: formatPercent(segment.pct),
      anchor: trackWidth * layout.offerWidthPct / 100 * (segment.key === "cost" ? layout.costPct / 2 : segment.key === "utility" ? layout.costPct + layout.utilityPct / 2 : layout.costPct + layout.utilityPct + layout.deductionsPct / 2) / 100,
      color: segment.key === "cost" ? "#a34f4d" : segment.key === "utility" ? "#3b8150" : "#a87720",
    })),
    ...(showDiscountCallout ? [{ key: "discount", label: "Descuento", value: layout.discount, detail: `${formatPercent((layout.discount / ceiling!) * 100)} del techo`, anchor: trackWidth * (layout.offerWidthPct + layout.discountWidthPct / 2) / 100, color: "#777674" }] : []),
  ], trackWidth);
  const compactMarkers = placeCompactMarkers([
    ...segments.filter((segment) => segment.key !== "deductions").map((segment) => ({
      key: segment.key,
      label: segment.key === "utility" ? utilityLabel : "Costo",
      value: segment.value,
      pct: segment.pct,
      anchor: trackWidth * layout.offerWidthPct / 100 * (segment.key === "cost" ? layout.costPct / 2 : layout.costPct + layout.utilityPct / 2) / 100,
      width: segment.key === "utility" ? 170 : 165,
      row: 0,
      title: `${segment.label} ${formatCop(segment.value)} · ${formatPercent(segment.pct)} de la oferta`,
    })),
    ...segments.filter((segment) => segment.key === "deductions").map((segment) => ({
      key: segment.key, label: "Ret.", value: segment.value, pct: segment.pct,
      anchor: trackWidth * layout.offerWidthPct / 100 * (layout.costPct + layout.utilityPct + layout.deductionsPct / 2) / 100,
      width: 140, row: 0,
      title: `Retenciones ${formatCop(segment.value)} · ${formatPercent(segment.pct)} de la oferta`,
    })),
    ...(layout.discount > 0 ? [{
      key: "discount", label: "Dcto.", value: layout.discount, pct: layout.discount / ceiling! * 100,
      anchor: trackWidth * (layout.offerWidthPct + layout.discountWidthPct / 2) / 100,
      width: 145, row: 0,
      title: `Descuento ${formatCop(layout.discount)} · ${formatPercent(layout.discount / ceiling! * 100)} del techo`,
    }] : []),
  ], Math.max(0, trackWidth - 36));
  const positionCompactMarkers = trackWidth >= 450 && !layout.excess && !layout.isLoss;

  return (
    <div className={`offer-graphic ${compact ? "is-compact" : "is-expanded"} ${layout.isLoss ? "has-loss" : ""} ${preliminary ? "is-preliminary" : ""}`}>
      <div className="offer-graphic-head">
        <span>{scope}</span>
        <strong style={compact ? undefined : { width: `${layout.offerWidthPct}%` }}><small>Valor a ofertar</small><span className="offer-graphic-offer-value">{formatCop(offer)}</span></strong>
      </div>
      {callouts.length ? (
        <div className="offer-graphic-callouts" aria-hidden="true">
          <svg className="offer-graphic-callout-lines" width="100%" height="56" viewBox={`0 0 ${Math.max(trackWidth, 1)} 56`} preserveAspectRatio="none">
            {callouts.map((item) => <g key={item.key}><path d={`M ${item.x + 80} 42 L ${item.anchor} 55`} stroke={item.color} strokeWidth="1.5" fill="none" /><circle cx={item.anchor} cy="55" r="2.5" fill={item.color} /></g>)}
          </svg>
          {callouts.map((item) => <span key={item.key} className={`offer-graphic-callout is-${item.key}`} style={{ left: item.x }}><small>{item.label}</small><strong>{formatCop(item.value)}</strong><em>{item.detail}</em></span>)}
        </div>
      ) : null}
      <div ref={trackRef} className="offer-graphic-track" role="img" aria-label={description}>
        <div className="offer-graphic-offer" style={{ width: `${layout.offerWidthPct}%` }}>
          {layout.isLoss ? <div className="offer-graphic-loss-fill" /> : segments.map((segment) => {
            const inside = !compact && !segmentCalloutKeys.has(segment.key);
            return (
              <div key={segment.key} className={`offer-graphic-segment is-${segment.key} ${inside ? "has-inside-label" : ""}`} style={{ width: `${segment.pct}%` }}>
                {inside ? <span><small>{segment.label}</small><strong>{formatCop(segment.value)}</strong><em>{formatPercent(segment.pct)}</em></span> : null}
              </div>
            );
          })}
          {layout.excess > 0 && layout.ceilingMarkerPct !== null ? (
            <div className="offer-graphic-excess" style={{ left: `${layout.ceilingMarkerPct}%`, width: `${layout.excessWidthPct}%` }} aria-hidden="true" />
          ) : null}
        </div>
        {layout.discount > 0 ? (
          <div className={`offer-graphic-discount ${!compact && !showDiscountCallout ? "has-inside-label" : ""}`} style={{ width: `${layout.discountWidthPct}%` }}>
            {!compact && !showDiscountCallout ? <span><small>Descuento</small><strong>{formatCop(layout.discount)}</strong><em>{formatPercent((layout.discount / ceiling!) * 100)} del techo</em></span> : null}
          </div>
        ) : null}
      </div>
      {compact ? (
        <div className={`offer-graphic-compact-legend ${positionCompactMarkers ? "is-positioned" : ""}`}>
          {compactMarkers.map((marker) => <span key={marker.key} className={`offer-graphic-key is-${marker.key}`} title={marker.title} style={positionCompactMarkers ? { left: marker.x, top: marker.row * 17, width: marker.width } : undefined}><i aria-hidden="true" />{marker.label} <strong>{shortCop(marker.value)}</strong> {formatPercent(marker.pct)}</span>)}
          {layout.excess > 0 ? <span className="offer-graphic-key is-excess"><i aria-hidden="true" />Exceso {excessDetail}</span> : null}
          {layout.isLoss ? <span className="offer-graphic-loss-note">Pérdida {formatCop(layout.loss)}</span> : null}
        </div>
      ) : layout.excess > 0 || layout.isLoss ? (
        <div className="offer-graphic-detail">
          {layout.isLoss ? segments.map((segment) => (
            <span key={segment.key} className={`offer-graphic-key is-${segment.key}`}><i aria-hidden="true" />{segment.label} <strong>{formatCop(segment.value)}</strong> · {formatPercent(segment.pct)}</span>
          )) : null}
          {layout.excess > 0 ? <span className="offer-graphic-key is-excess"><i aria-hidden="true" />Exceso <strong>{formatCop(layout.excess)}</strong> · {excessDetail}</span> : null}
          {layout.isLoss ? <span className="offer-graphic-loss-note">Pérdida {formatCop(layout.loss)}: costo y retenciones superan el valor a ofertar.</span> : null}
        </div>
      ) : null}
      <div className="offer-graphic-ceiling">
        {ceiling !== null ? <span>Precio techo <strong>{formatCop(ceiling)}</strong></span> : <span>Precio techo pendiente</span>}
      </div>
    </div>
  );
}

export function OfferReferenceSummary(props: Omit<Props, "compact">) {
  const layout = offerBarLayout(props);
  const percentOfOffer = (value: number | null) => value !== null && props.offer !== null && props.offer > 0 ? value / props.offer * 100 : null;
  const difference = props.ceiling !== null && props.offer !== null ? props.ceiling - props.offer : null;
  const fields = [
    { key: "cost", label: "Costo", value: props.cost, pct: percentOfOffer(props.cost), base: "de la oferta" },
    { key: layout.isLoss ? "loss" : "utility", label: layout.isLoss ? "Pérdida" : props.utilityLabel === "Utilidad de escenario" ? "Utilidad de escenario" : "Utilidad", value: props.netUtility, pct: percentOfOffer(props.netUtility), base: "de la oferta" },
    { key: "deductions", label: "Retenciones", value: props.deductions, pct: percentOfOffer(props.deductions), base: "de la oferta" },
    { key: difference !== null && difference < 0 ? "excess" : "discount", label: difference !== null && difference < 0 ? "Exceso" : "Descuento", value: difference === null ? null : Math.abs(difference), pct: difference !== null && props.ceiling !== null && props.ceiling > 0 ? Math.abs(difference) / props.ceiling * 100 : null, base: "del techo" },
  ];
  // #110: punto medio de cada tramo en la cinta, para la línea guía desde su texto.
  const guideAnchors = [
    layout.costPct > 0.005 ? layout.offerWidthPct * layout.costPct / 200 : null,
    !layout.isLoss && layout.utilityPct > 0.005 ? layout.offerWidthPct * (layout.costPct + layout.utilityPct / 2) / 100 : null,
    layout.deductionsPct > 0.005 ? layout.offerWidthPct * (layout.costPct + layout.utilityPct + layout.deductionsPct / 2) / 100 : null,
    layout.discountWidthPct > 0.005 ? layout.offerWidthPct + layout.discountWidthPct / 2 : null,
  ];
  return <div className="summary-reference-composition">
    <div className="summary-reference-ribbon"><OfferCompositionBar {...props} compact />
      <svg className="summary-reference-guides" aria-hidden="true" focusable="false">
        {guideAnchors.map((anchor, index) => anchor === null ? null : <line key={fields[index].key} className={`is-${fields[index].key}`} x1={`${(index + 1) * 25 - 0.6}%`} y1="0" x2={`${anchor}%`} y2="100%" />)}
      </svg>
    </div>
    <dl className="summary-reference-values summary-ordered-values" aria-label={`${props.scope || "Oferta"}. Valores en pesos colombianos (COP)`}>
      <div className="summary-reference-general">
        <div><dt>Techo</dt><dd>{props.ceiling === null ? "Pendiente" : formatCop(props.ceiling)}</dd></div>
        <span aria-hidden="true" className="summary-reference-slash">/</span>
        <div><dt>{props.preliminary ? "Oferta parcial" : "Oferta"}</dt><dd>{props.offer === null ? "Pendiente" : formatCop(props.offer)}</dd></div>
      </div>
      {fields.map((field) => <div key={field.key} className="summary-reference-metric"><dt className={`summary-color-key is-${field.key}`}><i aria-hidden="true" />{field.label}</dt><dd>{field.value === null ? "Pendiente" : formatCop(field.value)}<small title={`Porcentaje ${field.base}`}><span aria-hidden="true"> – </span>{field.pct === null ? "—" : formatPercent(field.pct)}</small></dd></div>)}
    </dl>
  </div>;
}
