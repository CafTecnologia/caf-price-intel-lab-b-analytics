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

function formatLastTestAt(value: string | null) {
  if (!value) {
    return null;
  }

  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

export function ProviderSettingsPanel(props: { compact?: boolean; initialSettings: ProviderSettingsSummary; surface?: "panel" | "plain" }) {
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
  const selectedLastTestMatchesModel = selectedConnection.lastTestModel === selectedConnection.model;
  const activeStatus =
    selectedConnection.lastTestStatus === "success" && selectedLastTestMatchesModel
      ? `Conexion confirmada con ${PROVIDER_LABELS[selectedProvider]}:${selectedConnection.model}${
          formatLastTestAt(selectedConnection.lastTestAt) ? ` el ${formatLastTestAt(selectedConnection.lastTestAt)}` : ""
        }.`
      : selectedConnection.lastTestStatus === "error" && selectedLastTestMatchesModel
        ? selectedConnection.lastTestMessage ?? "La ultima prueba de conexion fallo."
        : selectedConnection.lastTestMessage ?? "Configuracion guardada. Falta probar la conexion.";
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
    <section
      id="api-connections"
      className={`${props.surface === "plain" ? "provider-settings-plain" : "panel"} ${props.compact ? "provider-settings-compact" : ""}`}
    >
      <div className="panel-header">
        <div>
          <h2>Configuración de IA</h2>
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

      {selectedProvider === "gemini" && isRefreshingModels ? <p className="muted small">Actualizando modelos...</p> : null}

      <label className="field">
        <span>API Key</span>
        <input
          type="password"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          placeholder={selectedConnection.apiKeyStored ? "Deja vacio para reutilizar la key guardada" : "Pega aqui tu API key"}
        />
      </label>

      {selectedConnection.apiKeyStored ? (
        <p className="muted small">Key guardada: {selectedConnection.apiKeyPreview}</p>
      ) : null}

      <p
        className={
          selectedConnection.lastTestStatus === "error" && selectedLastTestMatchesModel
            ? "error-text"
            : selectedConnection.lastTestStatus === "success" && selectedLastTestMatchesModel
              ? "success-text"
              : "muted small"
        }
      >
        {activeStatus}
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

    </section>
  );
}
