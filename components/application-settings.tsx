"use client";
import Link from "next/link";
import { CircleHelp, Settings } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { AiSettingsButton } from "./ai-settings-button";
import { FinancialSettingsButton } from "./financial-settings-button";

export function ApplicationSettings({ embedded = false, panel = false, onOpen }: { embedded?: boolean; panel?: boolean; onOpen?: () => void }) {
  const [apiOpen, setApiOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const items = <>
    <button className="settings-menu-item" type="button" onClick={() => { setSettingsOpen(false); onOpen?.(); setApiOpen(true); }}><strong>API e integraciones</strong><small>Contrato para conectar otros sistemas.</small></button>
    <AiSettingsButton menu onOpen={() => { setSettingsOpen(false); onOpen?.(); }} />
    <FinancialSettingsButton onOpen={() => { setSettingsOpen(false); onOpen?.(); }} />
  </>;
  return <>
        {panel ? <div className="calculation-settings-panel">{items}</div> : <nav className={embedded ? "calculation-general-options" : "topbar-nav"} aria-label="Configuración de la aplicación">
          <Link className="topbar-link" href="/help" onClick={onOpen} aria-label="Ayuda" title="Ayuda"><CircleHelp className="topbar-help-icon" size={16} aria-hidden="true" /><span>Ayuda</span></Link>
          <div className="topbar-settings">
            <button
              className="topbar-link topbar-settings-trigger"
              type="button"
              aria-expanded={settingsOpen}
              aria-controls="app-settings-menu"
              onClick={() => setSettingsOpen((current) => !current)}
              title="Configuración"
            >
              <Settings size={16} aria-hidden="true" />
              <span>Configuración</span>
            </button>
            <div className="topbar-settings-menu" id="app-settings-menu" hidden={!settingsOpen}>
                {items}
            </div>
          </div>
        </nav>}
      {apiOpen && typeof document !== "undefined" ? createPortal(
        <div className="api-modal-overlay" role="presentation" onMouseDown={() => setApiOpen(false)}>
          <section className="api-modal" role="dialog" aria-modal="true" aria-labelledby="api-modal-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="panel-header">
              <div>
                <p className="modal-eyebrow">API</p>
                <h2 id="api-modal-title">Contrato de ingesta</h2>
              </div>
              <button className="modal-close-button" type="button" aria-label="Cerrar" onClick={() => setApiOpen(false)}>
                x
              </button>
            </div>
            <div className="api-contract-summary">
              <p>Endpoint: <code>POST /api/import</code></p>
              <p>Campo obligatorio: <code>items[].name</code></p>
              <p>Campos recomendados: cantidad, unidad, precio techo y fuentes de precio.</p>
              <pre className="code-sample compact-code">{`{
  "version": 2,
  "items": [{
    "name": "Taladro profesional",
    "quantity": 2,
    "unit": "UND",
    "ceiling_unit_price": 350000,
    "price_sources": [{
      "name": "Proveedor A",
      "unit_price": 210000,
      "currency": "COP"
    }]
  }]
}`}</pre>
            </div>
          </section>
        </div>
      , document.body) : null}
  </>;
}
