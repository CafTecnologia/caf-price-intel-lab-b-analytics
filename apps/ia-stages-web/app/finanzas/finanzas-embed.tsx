"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";

/** Orígenes de esta app que el Simulador Financiero suele permitir en `frame-ancestors` (VPS/túnel/local). */
const DEFAULT_EMBED_PARENT_ORIGINS: string[] = [
  "http://127.0.0.1:18031",
  "http://localhost:18031",
  "http://127.0.0.1:18032",
  "http://localhost:18032",
  "http://127.0.0.1:3000",
  "http://localhost:3000"
];

const EXTRA_EMBED_PARENT_ORIGINS = (process.env.NEXT_PUBLIC_FINANCIAL_EMBED_PARENT_ORIGINS ?? "")
  .split(/[,;\n]+/)
  .map((s) => s.trim())
  .filter(Boolean);

const ALLOWED_EMBED_PARENT_ORIGINS = new Set([...DEFAULT_EMBED_PARENT_ORIGINS, ...EXTRA_EMBED_PARENT_ORIGINS]);

function safeCalculationPath(id: string): string | null {
  const t = id.trim();
  if (!t || t.length > 200 || /[<>"'`\\]/.test(t)) {
    return null;
  }
  return t;
}

function shouldUseFinancialIframe(): boolean {
  if (typeof window === "undefined") {
    return true;
  }
  if (process.env.NEXT_PUBLIC_FINANCIAL_EMBED_IFRAME === "0") {
    return false;
  }
  return ALLOWED_EMBED_PARENT_ORIGINS.has(window.location.origin);
}

export function FinanzasEmbed() {
  const searchParams = useSearchParams();
  const rawCalc = searchParams.get("calc");
  const embedBase = (process.env.NEXT_PUBLIC_FINANCIAL_EMBED_ORIGIN?.trim() || "http://127.0.0.1:18030").replace(
    /\/$/,
    ""
  );

  const src = useMemo(() => {
    const base = embedBase || "http://127.0.0.1:18030";
    const calc = rawCalc ? safeCalculationPath(rawCalc) : null;
    try {
      if (calc) {
        return new URL(`/calculations/${encodeURIComponent(calc)}`, base).toString();
      }
      return new URL("/", base).toString();
    } catch {
      return calc ? `http://127.0.0.1:18030/calculations/${encodeURIComponent(calc)}` : "http://127.0.0.1:18030/";
    }
  }, [embedBase, rawCalc]);

  const useIframe = shouldUseFinancialIframe();
  const parentOrigin = typeof window !== "undefined" ? window.location.origin : "";

  if (!useIframe) {
    return (
      <div className="embedExternalPanel">
        <h2 className="embedExternalTitle">Simulador Financiero</h2>
        <p className="embedExternalLead">
          Desde <code className="inlineCode">{parentOrigin || "este origen"}</code> el simulador en{" "}
          <code className="inlineCode">{embedBase}</code> no puede mostrarse embebido: el servicio solo autoriza
          ciertos orígenes padre (política <code className="inlineCode">frame-ancestors</code>). Un puerto distinto
          (por ejemplo <strong>:3055</strong> tras <code className="inlineCode">next start -p 3055</code>) suele quedar
          fuera de esa lista y el recuadro queda en blanco.
        </p>
        {rawCalc ? (
          <p className="muted embedExternalMeta">
            Cálculo en URL: <code className="inlineCode">{rawCalc}</code>
          </p>
        ) : null}
        <div className="embedExternalActions">
          <a className="linkAsButton" href={src} target="_blank" rel="noopener noreferrer">
            Abrir Simulador Financiero en una pestaña nueva
          </a>
        </div>
        <p className="muted embedExternalHintList">
          Para volver a la vista embebida: abrí esta suite desde un origen permitido (típico túnel{" "}
          <strong>18031</strong>) o agregá <code className="inlineCode">{parentOrigin}</code> a{" "}
          <code className="inlineCode">NEXT_PUBLIC_FINANCIAL_EMBED_PARENT_ORIGINS</code> en{" "}
          <code className="inlineCode">.env.local</code> y el mismo origen en{" "}
          <code className="inlineCode">frame-ancestors</code> del proyecto Simulador Financiero.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="embedFrameWrap">
        <iframe key={src} className="embedFrame" src={src} title="Simulador Financiero" />
      </div>
      <p className="muted embedExternalHint">
        <a href={src} target="_blank" rel="noopener noreferrer">
          Abrir en nueva pestaña
        </a>{" "}
        si el panel queda en blanco (red, bloqueo o política del navegador).
      </p>
    </>
  );
}

export default FinanzasEmbed;
