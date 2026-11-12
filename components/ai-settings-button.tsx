"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { appPath } from "@offer/lib/base-path";

type AiConfigResponse = {
  hasDeepseekApiKey: boolean;
  deepseekModel: string;
  models: string[];
};

type AiSettingsButtonProps = { menu?: boolean; onOpen?: () => void };

export function AiSettingsButton({ menu = false, onOpen }: AiSettingsButtonProps) {
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState<AiConfigResponse | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("deepseek-flash");
  const [status, setStatus] = useState<"idle" | "loading" | "saved" | "error">("idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    async function loadConfig() {
      setStatus("loading");
      try {
        const response = await fetch(appPath("/api/ai-config"), { cache: "no-store" });
        const data = (await response.json()) as AiConfigResponse;
        if (!cancelled) {
          setConfig(data);
          setModel(data.deepseekModel);
          setStatus("idle");
          setMessage(data.hasDeepseekApiKey ? "API key configurada." : "Sin API key guardada.");
        }
      } catch {
        if (!cancelled) {
          setStatus("error");
          setMessage("No se pudo leer la configuracion.");
        }
      }
    }
    void loadConfig();
    return () => {
      cancelled = true;
    };
  }, [open]);

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

  async function save() {
    setStatus("loading");
    setMessage("Guardando...");
    try {
      const response = await fetch(appPath("/api/ai-config"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deepseekModel: model,
          deepseekApiKey: apiKey.trim() ? apiKey.trim() : undefined,
        }),
      });
      const data = (await response.json()) as AiConfigResponse & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "No se pudo guardar.");
      setConfig(data);
      setApiKey("");
      setModel(data.deepseekModel);
      setStatus("saved");
      setMessage("Configuracion guardada.");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "No se pudo guardar.");
    }
  }

  return (
    <>
      <button
        className={menu ? "settings-menu-item" : "topbar-link ai-settings-trigger"}
        type="button"
        onClick={() => {
          onOpen?.();
          setOpen(true);
        }}
        aria-label="Configuración IA"
      >
        {menu ? (
          <>
            <strong>IA y búsqueda</strong>
            <small>Modelo y clave de DeepSeek para preparar búsquedas.</small>
          </>
        ) : (
          <>
            <span className="gear-mark" aria-hidden="true" />
            IA
          </>
        )}
      </button>
      {open ? createPortal(
        <div className="api-modal-overlay" role="presentation" onMouseDown={() => setOpen(false)}>
          <section className="api-modal ai-settings-modal" role="dialog" aria-modal="true" aria-labelledby="ai-settings-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="panel-header">
              <div>
                <p className="modal-eyebrow">IA</p>
                <h2 id="ai-settings-title">Configuracion DeepSeek</h2>
              </div>
              <button className="modal-close-button" type="button" aria-label="Cerrar" onClick={() => setOpen(false)}>
                x
              </button>
            </div>
            <div className="ai-settings-form">
              <label>
                Modelo
                <select value={model} onChange={(event) => setModel(event.target.value)}>
                  {(config?.models ?? ["deepseek-flash", "deepseek-v4-pro"]).map((candidate) => (
                    <option value={candidate} key={candidate}>
                      {candidate === "deepseek-flash" ? "DeepSeek Flash" : "DeepSeek V4 Pro"}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                API key DeepSeek
                <input
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  type="password"
                  placeholder={config?.hasDeepseekApiKey ? "Guardada. Pega una nueva para reemplazarla." : "Pega tu API key"}
                  autoComplete="off"
                />
              </label>
              <div className="ai-settings-actions">
                <button className="button" type="button" disabled={status === "loading"} onClick={save}>
                  Guardar
                </button>
                <span className={`ai-settings-status ${status === "error" ? "error" : status === "saved" ? "success" : ""}`}>{message}</span>
              </div>
            </div>
          </section>
        </div>, document.body,
      ) : null}
    </>
  );
}
