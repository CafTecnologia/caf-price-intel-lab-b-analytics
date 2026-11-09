"use client";

import Link from "next/link";
import { ArrowLeft, ChevronDown, ChevronRight, CircleHelp, Download, FileText, FolderOpen, ListPlus, Save, Settings } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { AnchoredPopover } from "./anchored-popover";

type Panel = "identity" | "items" | "saves" | "scenarios" | "exports" | "settings";
const options = [
  { id: "identity", label: "Datos del cálculo", icon: FileText },
  { id: "items", label: "Ítems", icon: ListPlus },
  { id: "saves", label: "Guardar como", icon: Save },
  { id: "scenarios", label: "Escenarios de oferta", icon: FolderOpen },
  { id: "exports", label: "Exportar", icon: Download },
  { id: "settings", label: "Configuración", icon: Settings },
] as const;

export function CalculationMenu(props: {
  open: boolean; anchorRef: RefObject<HTMLButtonElement | null>; busy: boolean;
  onToggle: () => void; onClose: () => void; onSave: () => void;
  identity: ReactNode; items: ReactNode; saves?: ReactNode; scenarios?: ReactNode; exports: ReactNode; settings: ReactNode;
}) {
  const [active, setActive] = useState<Panel | null>(null);
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!props.open) setActive(null); }, [props.open]);
  function select(id: Panel, focus = false) {
    setActive(id);
    if (focus) requestAnimationFrame(() => content.current?.querySelector<HTMLElement>(`#calculation-panel-${id} input, #calculation-panel-${id} button, #calculation-panel-${id} select, #calculation-panel-${id} summary`)?.focus());
  }
  function back() {
    const previous = active;
    setActive(null);
    requestAnimationFrame(() => content.current?.querySelector<HTMLElement>(`[data-calculation-option="${previous}"]`)?.focus());
  }
  return <>
    <button ref={props.anchorRef} className="calculation-menu-trigger" type="button" aria-expanded={props.open}
      aria-controls="header-save-options" aria-haspopup="dialog" aria-label="Abrir menú Cálculo" title="Abrir menú Cálculo"
      disabled={props.busy} onClick={props.onToggle} onKeyDown={(event) => {
        if (event.key === "ArrowDown") { event.preventDefault(); if (!props.open) props.onToggle(); requestAnimationFrame(() => content.current?.querySelector<HTMLButtonElement>(".calculation-menu-nav button")?.focus()); }
      }}>Cálculo <ChevronDown size={14} aria-hidden="true" /></button>
    <AnchoredPopover open={props.open} anchorRef={props.anchorRef} id="header-save-options" ariaLabel="Cálculo" keepMounted align="start"
      className="header-save-options calculation-menu calculation-cascade" width={active ? 552 : 224} onClose={props.onClose}>
      <div ref={content} className={`calculation-cascade-content ${active ? "has-panel" : ""}`}>
        <nav className="calculation-menu-nav" aria-label="Opciones del cálculo" onKeyDown={(event) => {
          const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]),a[href]')];
          const current = controls.indexOf(document.activeElement as HTMLElement);
          if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            controls[event.key === "Home" ? 0 : event.key === "End" ? controls.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + controls.length) % controls.length]?.focus();
          }
        }}>
          <button type="button" disabled={props.busy} onClick={props.onSave} title="Guardar los cambios actuales del cálculo"><Save size={16} aria-hidden="true" /><span>Guardar cálculo</span></button>
          {options.filter(({ id }) => props[id] != null).map(({ id, label, icon: Icon }) => <button key={id} type="button" data-calculation-option={id}
            aria-expanded={active === id} aria-controls={`calculation-panel-${id}`}
            onClick={() => active === id ? back() : select(id)} onKeyDown={(event) => {
              if (event.key === "ArrowRight") { event.preventDefault(); select(id, true); }
            }}><Icon size={16} aria-hidden="true" /><span>{label}</span><ChevronRight size={14} aria-hidden="true" /></button>)}
          <Link href="/help" onClick={props.onClose}><CircleHelp size={16} aria-hidden="true" /><span>Ayuda</span></Link>
        </nav>
        <div className="calculation-flyouts" hidden={!active} onKeyDown={(event) => {
          if (event.key === "ArrowLeft" && !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement)) { event.preventDefault(); back(); }
        }}>
          <button type="button" className="calculation-menu-back" onClick={back}><ArrowLeft size={16} aria-hidden="true" />Volver al menú</button>
          {options.filter(({ id }) => props[id] != null).map(({ id, label }) => <section key={id} id={`calculation-panel-${id}`} hidden={active !== id} aria-labelledby={`calculation-panel-title-${id}`}>
            <h2 id={`calculation-panel-title-${id}`}>{label}</h2>
            {props[id]}
          </section>)}
        </div>
      </div>
    </AnchoredPopover>
  </>;
}
