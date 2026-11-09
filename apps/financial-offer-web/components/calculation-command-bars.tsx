"use client";

import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

const query = "(min-width: 641px)";
const subscribe = (notify: () => void) => {
  const media = window.matchMedia(query);
  media.addEventListener("change", notify);
  return () => media.removeEventListener("change", notify);
};
const BarsContext = createContext<{ desktop: boolean; costTarget: HTMLSpanElement | null; setCostTarget: (node: HTMLSpanElement | null) => void; target: HTMLSpanElement | null; setTarget: (node: HTMLSpanElement | null) => void; dock: HTMLDivElement | null; setDock: (node: HTMLDivElement | null) => void; docked: boolean; setDocked: (docked: boolean) => void } | null>(null);

export function CalculationBars({ children }: { children: ReactNode }) {
  const desktop = useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);
  const [target, setTarget] = useState<HTMLSpanElement | null>(null);
  const [costTarget, setCostTarget] = useState<HTMLSpanElement | null>(null);
  const [dock, setDock] = useState<HTMLDivElement | null>(null);
  const [docked, setDocked] = useState(false);
  return <BarsContext.Provider value={{ desktop, costTarget, setCostTarget, target, setTarget, dock, setDock, docked, setDocked }}>{children}</BarsContext.Provider>;
}

/** Conserva el menú junto a la marca, también en móvil. */
export function CalculationMenuSlot({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => { setTarget(document.getElementById("calculation-topbar-menu")); }, []);
  return target ? createPortal(children, target) : null;
}

export function CalculationModeSlot({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => { setTarget(document.getElementById("calculation-topbar-modes")); }, []);
  return target ? createPortal(children, target) : null;
}

/** La historia permanece disponible al pasar a Oferta económica; sólo su botón cambia de lugar. */
export function CalculationCostHistory({ children }: { children: ReactNode }) {
  const bars = useContext(BarsContext);
  return bars?.costTarget ? createPortal(children, bars.costTarget) : <div hidden>{children}</div>;
}
export function CalculationCostTarget() {
  const bars = useContext(BarsContext);
  return <span className="calculation-cost-target" ref={bars?.setCostTarget} />;
}

/** En PC, al bajar en la tabla, los mismos controles suben sobre la cinta (como Excel); su sitio conserva el alto para que la página no salte. */
export function CalculationActionBar({ children }: { children: ReactNode }) {
  const bars = useContext(BarsContext);
  const [topbar, setTopbar] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => { setTopbar(document.getElementById("calculation-topbar-actions")); }, []);
  const inTopbar = !!topbar;
  const docked = !inTopbar && !!(bars?.desktop && bars.docked && bars.dock);
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number>();
  useLayoutEffect(() => { if (!docked && ref.current) setHeight(ref.current.offsetHeight); }, [docked]);
  const bar = <div ref={docked ? undefined : ref} className={`header-actions command-bar-primary ${inTopbar ? "is-topbar" : docked ? "is-docked" : ""}`} data-preserve-manual-draft="true" role="group" aria-label="Guardar, versiones y exportar">{children}</div>;
  if (inTopbar) return createPortal(bar, topbar!);
  if (!docked) return bar;
  return <><div className="command-bar-placeholder" style={{ height }} aria-hidden="true" />{createPortal(bar, bars!.dock!)}</>;
}

/** Estado compacto de la tabla fuera de React: al cruzar el umbral no se vuelve a pintar todo el cálculo (#17). */
export type FlagStore = { get: () => boolean; set: (value: boolean) => void; subscribe: (notify: () => void) => () => void };
export function createFlagStore(): FlagStore {
  let value = false;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next) => { if (next === value) return; value = next; listeners.forEach((notify) => notify()); },
    subscribe: (notify) => { listeners.add(notify); return () => { listeners.delete(notify); }; },
  };
}

/** Lugar de la barra principal dentro de la pila fija de la tabla (solo PC y con la tabla compacta). */
export function CalculationActionDock({ store }: { store: FlagStore }) {
  const active = useSyncExternalStore(store.subscribe, store.get, () => false);
  const bars = useContext(BarsContext);
  const setDocked = bars?.setDocked;
  useEffect(() => { setDocked?.(active); }, [active, setDocked]);
  return <div ref={bars?.setDock} className="command-bar-dock" />;
}

export function CalculationTableRibbon({ children }: { children: ReactNode }) {
  const bars = useContext(BarsContext);
  return <div className="batch-toolbar-actions command-bar-ribbon" data-preserve-manual-draft="true">
    {children}
    {/* Integración móvil en paralelo: los chips Todos/Sin costo/Incompletos/Pérdida irían aquí, sin duplicar sus estados ni callbacks. */}
    <span ref={bars?.setTarget} className="desktop-ribbon-settings" role="group" aria-label="Ajustes del cálculo" />
  </div>;
}

/** Same controls and state, moved to the table ribbon on PC; original location on mobile. */
export function CalculationRibbonSettings({ children }: { children: ReactNode }) {
  const bars = useContext(BarsContext);
  return bars?.desktop && bars.target ? createPortal(children, bars.target) : children;
}
