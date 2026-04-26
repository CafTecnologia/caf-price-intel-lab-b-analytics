"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import type { AiProvider } from "@ai-first-contracts/enums";

import {
  PROVIDER_LABELS,
  PROVIDER_MODEL_OPTIONS,
  type ProviderModelOption,
  type ProviderSettingsSummary,
} from "../lib/provider-models";

interface FeedbackState {
  tone: "success" | "error";
  message: string;
}

function buildModelOptions(provider: AiProvider, currentModel: string) {
  const options = PROVIDER_MODEL_OPTIONS[provider];
  return options.some((option) => option.value === currentModel)
    ? options
    : [{ value: currentModel, label: `${currentModel} (saved)` }, ...options];
}

function buildAvailableModelOptions(options: ProviderModelOption[], currentModel: string) {
  return options.some((option) => option.value === currentModel)
    ? options
    : [{ value: currentModel, label: `${currentModel} (saved)` }, ...options];
}

export function ProviderSettingsPanel(props: { initialSettings: ProviderSettingsSummary; surface?: "panel" | "plain" }) {
  const router = useRouter();
  const [settings, setSettings] = useState(props.initialSettings);
  const [selectedProvider, setSelectedProvider] = useState<AiProvider>(props.initialSettings.activeProvider);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(props.initialSettings.connections[props.initialSettings.activeProvider].model);
  const [availableModels, setAvailableModels] = useState<Record<AiProvider, ProviderModelOption[]>>({
    openai: PROVIDER_MODEL_OPTIONS.openai,
    gemini: PROVIDER_MODEL_OPTIONS.gemini,
    anthropic: PROVIDER_MODEL_OPTIONS.anthropic,
    deepseek: PROVIDER_MODEL_OPTIONS.deepseek,
  });
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isRefreshingModels, setIsRefreshingModels] = useState(false);

  const selectedConnection = settings.connections[selectedProvider];
  const modelOptions = useMemo(
    () => buildAvailableModelOptions(
      availableModels[selectedProvider] ?? buildModelOptions(selectedProvider, selectedConnection.model),
      model || selectedConnection.model,
    ),
    [availableModels, model, selectedConnection.model, selectedProvider],
  );

  useEffect(() => {
    setApiKey("");
    setModel(settings.connections[selectedProvider].model);
    setFeedback(null);
  }, [selectedProvider, settings]);

  useEffect(() => {
    let cancelled = false;

    async function refreshModels() {
      setIsRefreshingModels(true);

      try {
        const response = await fetch(`/api/provider-settings/models?provider=${selectedProvider}`, {
          cache: "no-store",
        });
        const payload = (await response.json()) as {
          error?: string;
          message?: string | null;
          models?: ProviderModelOption[];
        };

        if (!response.ok || !payload.models) {
          throw new Error(payload.error ?? "No se pudieron cargar los modelos disponibles.");
        }

        if (!cancelled) {
          setAvailableModels((current) => ({
            ...current,
            [selectedProvider]: payload.models ?? current[selectedProvider],
          }));
        }
      } catch (error) {
        if (!cancelled) {
          setFeedback({
            tone: "error",
            message: error instanceof Error ? error.message : "No se pudieron cargar los modelos disponibles.",
          });
        }
      } finally {
        if (!cancelled) {
          setIsRefreshingModels(false);
        }
      }
    }

    void refreshModels();

    return () => {
      cancelled = true;
    };
  }, [selectedProvider]);

  async function saveConfiguration() {
    setFeedback(null);
    setIsSaving(true);

    try {
      const response = await fetch("/api/provider-settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          provider: selectedProvider,
          apiKey: apiKey.trim() || undefined,
          model,
        }),
      });

      const payload = (await response.json()) as { error?: string; message?: string; settings?: ProviderSettingsSummary };
      if (!response.ok || !payload.settings) {
        throw new Error(payload.error ?? "No se pudo guardar la configuracion.");
      }

      setSettings(payload.settings);
      setFeedback({
        tone: "success",
        message: payload.message ?? "Configuracion guardada.",
      });
      setApiKey("");
      router.refresh();
    } catch (error) {
      setFeedback({
        tone: "error",
        message: error instanceof Error ? error.message : "No se pudo guardar la configuracion.",
      });
    } finally {
      setIsSaving(false);
    }
  }

  async function testConnection() {
    setFeedback(null);
    setIsTesting(true);

    try {
      const response = await fetch("/api/provider-settings/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          provider: selectedProvider,
          apiKey: apiKey.trim() || undefined,
          model,
        }),
      });

      const payload = (await response.json()) as {
        error?: string;
        message?: string;
        settings?: ProviderSettingsSummary;
        usage?: { latency_ms?: number | null };
      };

      if (!response.ok || !payload.settings) {
        throw new Error(payload.error ?? "No se pudo probar la conexion.");
      }

      setSettings(payload.settings);
      setFeedback({
        tone: "success",
        message: payload.usage?.latency_ms
          ? `${payload.message ?? "Conexion exitosa."} Latencia aproximada: ${payload.usage.latency_ms} ms.`
          : payload.message ?? "Conexion exitosa.",
      });
    } catch (error) {
      setFeedback({
        tone: "error",
        message: error instanceof Error ? error.message : "No se pudo probar la conexion.",
      });
    } finally {
      setIsTesting(false);
    }
  }

  return (
    <section id="api-connections" className={props.surface === "plain" ? "provider-settings-plain" : "panel"}>
      <div className="panel-header">
        <div>
          <div className="eyebrow">Motor principal</div>
          <h2>Configuración de IA</h2>
          <p className="muted">
            Elige proveedor, pega la API key, selecciona el modelo y prueba la conexión. La configuración queda guardada
            localmente en este PC.
          </p>
          <p className="muted small">
            El proveedor y modelo marcados como principales se usan por defecto en todas las etapas del pipeline cuando
            cargas un archivo nuevo.
          </p>
        </div>
      </div>

      <div className="grid two">
        <label className="field">
          <span>Proveedor</span>
          <select value={selectedProvider} onChange={(event) => setSelectedProvider(event.target.value as AiProvider)}>
            {(Object.keys(PROVIDER_LABELS) as AiProvider[]).map((provider) => (
              <option key={provider} value={provider}>
                {PROVIDER_LABELS[provider]}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Modelo</span>
          <select value={model} onChange={(event) => setModel(event.target.value)}>
            {modelOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="muted small">
        {selectedProvider === "gemini"
          ? isRefreshingModels
            ? "Consultando catalogo live de Gemini..."
            : `${modelOptions.length} modelos disponibles cargados para Gemini desde models.list.`
          : "Para este proveedor se muestran modelos preconfigurados en la app."}
      </p>

      <label className="field">
        <span>API Key</span>
        <input
          type="password"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          placeholder={selectedConnection.apiKeyStored ? "Deja vacio para reutilizar la key guardada" : "Pega aqui tu API key"}
        />
      </label>

      <p className="muted small">
        {selectedConnection.apiKeyStored
          ? `API key guardada para ${PROVIDER_LABELS[selectedProvider]}: ${selectedConnection.apiKeyPreview}`
          : `Todavia no hay una API key guardada para ${PROVIDER_LABELS[selectedProvider]}.`}
      </p>

      <div className="actions-row">
        <button type="button" className="primary-button" onClick={saveConfiguration} disabled={isSaving || isTesting}>
          {isSaving ? "Guardando..." : "Guardar y usar por defecto"}
        </button>
        <button type="button" className="secondary-button" onClick={testConnection} disabled={isSaving || isTesting}>
          {isTesting ? "Probando..." : "Probar conexión"}
        </button>
      </div>

      {feedback ? (
        <p className={feedback.tone === "success" ? "success-text" : "error-text"}>{feedback.message}</p>
      ) : null}

      <div className="provider-summary-grid">
        {(Object.keys(settings.connections) as AiProvider[]).map((provider) => {
          const connection = settings.connections[provider];
          return (
            <article key={provider} className={connection.isActive ? "provider-card provider-card-active" : "provider-card"}>
              <div className="panel-header compact">
                <strong>{PROVIDER_LABELS[provider]}</strong>
                {connection.isActive ? <span className="status-pill">Default</span> : null}
              </div>
              <div className="stack tight">
                <div className="summary-row">
                  <span className="muted small">Modelo</span>
                  <span className="small">{connection.model}</span>
                </div>
                <div className="summary-row">
                  <span className="muted small">API key</span>
                  <span className="small">{connection.apiKeyStored ? "Guardada" : "Pendiente"}</span>
                </div>
                <div className="summary-row">
                  <span className="muted small">Ultimo test</span>
                  <span className="small">
                    {connection.lastTestStatus === "idle"
                      ? "Sin probar"
                      : connection.lastTestStatus === "success"
                        ? "OK"
                        : "Error"}
                  </span>
                </div>
                {connection.lastTestMessage ? <div className="muted small">{connection.lastTestMessage}</div> : null}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
