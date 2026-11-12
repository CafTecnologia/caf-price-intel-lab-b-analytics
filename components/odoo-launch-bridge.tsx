"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { appPath } from "@offer/lib/base-path";
import { existingLaunchPath, hasImportedItems, type LaunchCalculationPreview } from "@offer/lib/odoo-launch-navigation";

type LaunchState = "idle" | "loading" | "error";

type OdooFinancialLaunch = {
  name?: string | null;
  nameSuffix?: string | null;
  sourceTitle?: string | null;
  externalId?: string | null;
  odooProjectId?: string | null;
  iaRunId?: string | null;
  sourceAnalysisId?: string | null;
  odooCallbackUrl?: string | null;
  odooReturnUrl?: string | null;
  odooDb?: string | null;
  calculationId?: string | null;
  odooProjectName?: string | null;
  odooProcessNumber?: string | null;
  odooEntityName?: string | null;
  odooUserId?: string | null;
  odooUserName?: string | null;
};

type LaunchResponsePayload = { launch?: OdooFinancialLaunch; error?: string };

function parseJsonResponse<T>(raw: string, fallbackMessage: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    const preview = raw.replace(/\s+/g, " ").trim().slice(0, 120);
    throw new Error(`${fallbackMessage}${preview ? ` Respuesta recibida: ${preview}` : ""}`);
  }
}

export function OdooLaunchBridge() {
  const router = useRouter();
  const searchParams = useSearchParams() ?? new URLSearchParams();
  const queryString = useMemo(() => searchParams.toString(), [searchParams]);
  const [state, setState] = useState<LaunchState>("idle");
  const [message, setMessage] = useState("Abriendo simulador financiero...");
  const [continueUrl, setContinueUrl] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(queryString);
    const launchToken = params.get("launchToken")?.trim() || null;
    const odooBaseUrl = params.get("odooBaseUrl")?.trim() || null;
    const explicitCallbackUrl = params.get("odooCallbackUrl")?.trim() || null;
    const explicitOdooDb = params.get("odooDb")?.trim() || null;

    if (!launchToken && !explicitCallbackUrl) {
      return;
    }

    let cancelled = false;

    async function bootstrap() {
      setState("loading");
      setMessage("Consultando el cálculo vinculado en Odoo...");
      setContinueUrl(null);

      let nextUrl: string | null = null;

      try {
        let launch: OdooFinancialLaunch;

        if (launchToken && odooBaseUrl) {
          const launchHeaders: Record<string, string> = {};
          if (explicitOdooDb) {
            launchHeaders["X-Odoo-Database"] = explicitOdooDb;
          }
          const launchQuery = explicitOdooDb ? `?db=${encodeURIComponent(explicitOdooDb)}` : "";
          const launchResponse = await fetch(
            `${odooBaseUrl.replace(/\/+$/, "")}/caf_financial_offer_app/launch/${encodeURIComponent(launchToken)}${launchQuery}`,
            {
              method: "GET",
              headers: launchHeaders,
            },
          );
          const launchPayload = parseJsonResponse<LaunchResponsePayload>(
            await launchResponse.text(),
            "Odoo no respondió JSON para preparar el borrador financiero. Revisa la URL del clone configurada en Odoo.",
          );
          if (!launchResponse.ok || !launchPayload.launch) {
            throw new Error(launchPayload.error ?? "No se pudo cargar el contexto financiero desde Odoo.");
          }
          launch = launchPayload.launch;
        } else {
          launch = {
            name: params.get("name")?.trim() || "Cálculo sin nombre",
            externalId: params.get("externalId")?.trim() || null,
            odooProjectId: params.get("odooProjectId")?.trim() || null,
            iaRunId: params.get("iaRunId")?.trim() || null,
            sourceAnalysisId: params.get("sourceAnalysisId")?.trim() || null,
            odooCallbackUrl: explicitCallbackUrl,
            odooDb: explicitOdooDb,
          };
        }

        if (launch.calculationId?.trim()) {
          const existingId = launch.calculationId.trim();
          const existingResponse = await fetch(appPath(`/api/projects/${encodeURIComponent(existingId)}`), { cache: "no-store" });
          const existingPayload = parseJsonResponse<{ calculation?: LaunchCalculationPreview; error?: string }>(
            await existingResponse.text(),
            "Finanzas no respondió JSON al consultar el cálculo enlazado.",
          );
          if (!existingResponse.ok) {
            throw new Error(existingPayload.error ?? "El cálculo enlazado por Odoo no está disponible. No se creó otro borrador.");
          }
          const destination = existingLaunchPath(launch, existingPayload.calculation);
          if (!cancelled) router.replace(destination);
          return;
        }

        const response = await fetch(appPath("/api/projects"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: launch.name?.trim() || "Cálculo sin nombre",
            externalId: launch.externalId ?? null,
            entity: "odoo",
            odooProjectId: launch.odooProjectId ?? null,
            iaRunId: launch.iaRunId ?? null,
            sourceAnalysisId: launch.sourceAnalysisId ?? null,
            odooCallbackUrl: launch.odooCallbackUrl ?? null,
            odooReturnUrl: launch.odooReturnUrl ?? null,
            odooDb: launch.odooDb ?? null,
            nameSuffix: launch.nameSuffix ?? null,
            odooProjectName: launch.odooProjectName ?? null,
            odooProcessNumber: launch.odooProcessNumber ?? null,
            odooEntityName: launch.odooEntityName ?? null,
            odooUserId: launch.odooUserId ?? null,
            odooUserName: launch.odooUserName ?? null,
          }),
        });

        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error ?? "No se pudo crear el cálculo financiero.");
        }

        nextUrl = new URL(appPath(data.url), window.location.origin).toString();

        const callbackUrl = launch.odooCallbackUrl?.trim();
        if (!callbackUrl) {
          throw new Error("Falta la URL de callback de Odoo para completar el vínculo.");
        }

        const callbackHeaders: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (launch.odooDb?.trim()) {
          callbackHeaders["X-Odoo-Database"] = launch.odooDb.trim();
        }

        const callbackResponse = await fetch(callbackUrl, {
          method: "POST",
          headers: callbackHeaders,
          body: JSON.stringify({
            calculationId: data.calculationId,
            externalUrl: nextUrl,
            sourceTitle: data.calculation?.name ?? launch.name ?? "Cálculo sin nombre",
            status: hasImportedItems(data.calculation) ? "linked" : "pending",
            odooProjectId: launch.odooProjectId ?? null,
          }),
        });

        if (!callbackResponse.ok) {
          const callbackData = await callbackResponse.json().catch(() => ({}));
          throw new Error(callbackData.error ?? "Se creó el cálculo, pero no se pudo sincronizar con Odoo.");
        }

        if (!cancelled) {
          if (hasImportedItems(data.calculation)) {
            router.replace(data.url);
            return;
          }

          const homeParams = new URLSearchParams({ preparedCalculationId: data.calculationId });
          const preparedName = data.calculation?.name;
          if (typeof preparedName === "string" && preparedName.trim()) {
            homeParams.set("preparedCalculationName", preparedName.trim());
          }
          if (callbackUrl) {
            homeParams.set("preparedCallbackUrl", callbackUrl);
          }
          if (launch.odooDb?.trim()) {
            homeParams.set("preparedOdooDb", launch.odooDb.trim());
          }
          router.replace("/?" + homeParams.toString());
        }
      } catch (error) {
        if (cancelled) {
          return;
        }
        setState("error");
        setMessage(error instanceof Error ? error.message : "No se pudo preparar el borrador financiero.");
        if (nextUrl) {
          setContinueUrl(nextUrl);
        }
      }
    }

    bootstrap();

    return () => {
      cancelled = true;
    };
  }, [queryString, router]);

  if (!searchParams.get("launchToken") && !searchParams.get("odooCallbackUrl")) {
    return null;
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Integración Odoo</p>
          <h2>Abriendo simulador financiero</h2>
        </div>
      </div>
      <div className={`status-line ${state === "error" ? "error" : ""}`}>{message}</div>
      {continueUrl ? (
        <div className="row-actions">
          <a className="button" href={continueUrl}>
            Abrir cálculo creado
          </a>
        </div>
      ) : null}
    </section>
  );
}
