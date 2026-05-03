"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";

function safeCalculationPath(id: string): string | null {
  const t = id.trim();
  if (!t || t.length > 200 || /[<>"'`\\]/.test(t)) {
    return null;
  }
  return t;
}

export function FinanzasEmbed() {
  const searchParams = useSearchParams();
  const rawCalc = searchParams.get("calc");
  const origin = (process.env.NEXT_PUBLIC_FINANCIAL_EMBED_ORIGIN?.trim() || "http://127.0.0.1:18030").replace(
    /\/$/,
    ""
  );

  const src = useMemo(() => {
    const calc = rawCalc ? safeCalculationPath(rawCalc) : null;
    if (calc) {
      return `${origin}/calculations/${calc}`;
    }
    return `${origin}/`;
  }, [origin, rawCalc]);

  return (
    <div className="embedFrameWrap">
      <iframe key={src} className="embedFrame" src={src} title="Simulador Financiero" />
    </div>
  );
}
