"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { appPath } from "@offer/lib/base-path";
import type { WithholdingBase } from "@offer/lib/contract";
import { DecimalRateInput } from "@offer/components/decimal-rate-input";

type Settings = {
  applyReteFuente: boolean; reteFuenteRate: number; reteFuenteBase: WithholdingBase;
  applyReteIva: boolean; reteIvaRate: number; reteIvaBase: WithholdingBase;
  applyReteIca: boolean; reteIcaRate: number; reteIcaBase: WithholdingBase;
};

const bases: Array<[WithholdingBase, string]> = [["pre_vat", "Antes de IVA"], ["vat", "IVA"], ["total", "Total"]];
const retentionLabels = { ReteFuente: "ReteFuente", ReteIva: "ReteIVA", ReteIca: "ReteICA" } as const;

export function FinancialSettingsButton(props: { onOpen?: () => void }) {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [status, setStatus] = useState("");

  async function show() {
    props.onOpen?.();
    setOpen(true);
    setStatus("Cargando configuracion...");
    try {
      const response = await fetch(appPath("/api/financial-settings"), { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.settings) throw new Error(data.error ?? "No se pudo leer la configuracion.");
      setSettings(data.settings);
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "No se pudo abrir la configuracion.");
    }
  }

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  function row(prefix: "ReteFuente" | "ReteIva" | "ReteIca") {
    if (!settings) return null;
    const enabled = `apply${prefix}` as keyof Settings;
    const rate = `${prefix[0].toLowerCase()}${prefix.slice(1)}Rate` as keyof Settings;
    const base = `${prefix[0].toLowerCase()}${prefix.slice(1)}Base` as keyof Settings;
    return <div className="financial-default-row">
      <label className="financial-default-toggle"><input type="checkbox" checked={settings[enabled] as boolean} onChange={(event) => setSettings({ ...settings, [enabled]: event.target.checked })} />{retentionLabels[prefix]}</label>
      <label className="financial-default-field"><span>Tasa</span><span className="rate-input"><DecimalRateInput value={settings[rate] as number} onValueChange={(value) => setSettings((current) => current ? { ...current, [rate]: value } : current)} ariaLabel={`Tasa ${retentionLabels[prefix]}`} /><em>%</em></span></label>
      <label className="financial-default-field"><span>Base</span><select value={settings[base] as string} onChange={(event) => setSettings({ ...settings, [base]: event.target.value as WithholdingBase })}>{bases.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    </div>;
  }

  async function save() {
    if (!settings) return;
    setStatus("Guardando...");
    const response = await fetch(appPath("/api/financial-settings"), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings) });
    setStatus(response.ok ? "Predeterminados guardados para calculos nuevos." : "No se pudo guardar.");
  }

  return <>
    <button className="settings-menu-item" type="button" onClick={() => void show()}><strong>Retenciones predeterminadas</strong><small>Tasas y bases para calculos nuevos.</small></button>
    {open ? createPortal(<div className="api-modal-overlay" role="presentation" onMouseDown={() => setOpen(false)}><section className="api-modal financial-settings-modal" role="dialog" aria-modal="true" aria-labelledby="financial-settings-title" onMouseDown={(event) => event.stopPropagation()}>
      <div className="panel-header"><div><p className="modal-eyebrow">Configuracion global</p><h2 id="financial-settings-title">Retenciones predeterminadas</h2></div><button className="modal-close-button" type="button" aria-label="Cerrar" onClick={() => setOpen(false)}>x</button></div>
      <p>Estos valores se aplican a calculos nuevos. Cada proyecto puede ajustarlos sin cambiar el predeterminado.</p>
      {settings ? <div className="financial-defaults">{row("ReteFuente")}{row("ReteIva")}{row("ReteIca")}</div> : <p>Cargando...</p>}
      <div className="modal-actions"><span role="status">{status}</span><button className="button" type="button" onClick={() => void save()} disabled={!settings}>Guardar cambios</button></div>
    </section></div>, document.body) : null}
  </>;
}
