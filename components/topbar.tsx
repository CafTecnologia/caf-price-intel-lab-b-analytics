"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { ApplicationSettings } from "./application-settings";

function toggleHistorySidebar() {
  window.dispatchEvent(new Event("financial-offer:toggle-history"));
}

export function Topbar() {
  const pathname = usePathname();
  const calculationOpen = pathname.startsWith("/calculations/") || pathname.startsWith("/projects/");
  const showHistoryButton = pathname === "/";
  const topbarRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const topbar = topbarRef.current;
    if (!topbar) return;
    const syncHeight = () => {
      document.documentElement.style.setProperty("--app-topbar-height", `${Math.ceil(topbar.getBoundingClientRect().height)}px`);
    };
    syncHeight();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(syncHeight) : null;
    observer?.observe(topbar);
    window.addEventListener("resize", syncHeight);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", syncHeight);
      document.documentElement.style.removeProperty("--app-topbar-height");
    };
  }, []);

  return (
    <header className="topbar" ref={topbarRef}>
      <div className={`topbar-inner operational-topbar ${calculationOpen ? "has-calculation-menu" : ""}`}>
        <div className="topbar-left">
          {showHistoryButton ? (
            <button className="icon-button menu-button" type="button" aria-label="Abrir borradores recientes" onClick={toggleHistorySidebar}>
              <span aria-hidden="true" className="menu-icon">
                <span />
                <span />
                <span />
              </span>
            </button>
          ) : null}
          <Link className="brand brand-compact" href="/" aria-label="Ir al simulador financiero">
            <span className="brand-mark">OF</span>
          </Link>
          <div id="calculation-topbar-menu" />
          <div id="calculation-topbar-actions" />
        </div>

        <Link className="topbar-title" href="/">
          Simulador Financiero
        </Link>

        <div id="calculation-topbar-modes" />
        <div id="calculation-topbar-context" />

        {!calculationOpen ? <ApplicationSettings /> : null}
      </div>


    </header>
  );
}
