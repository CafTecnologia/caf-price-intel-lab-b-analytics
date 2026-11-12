"use client";
import React from "react";
import type { SavedAiActivity } from "@offer/lib/chat-activity";
import styles from "./ai-workspace-activity.module.css";

export function AiWorkspaceActivity({ activity, pending, historical = false, onDismiss }: { activity: SavedAiActivity | null; pending: boolean; historical?: boolean; onDismiss: () => void }) {
  if (!activity) return null;
  return <aside className={styles.notice} aria-label="Cambios de la IA">
    <div role="status"><strong>✓ La IA guardó {activity.itemIds.length ? `cambios en ${activity.itemIds.length} ${activity.itemIds.length === 1 ? "ítem" : "ítems"}` : "cambios del cálculo"}</strong><span>{historical ? "Hay una base posterior vigente. Puedes consultar lo que guardó esta revisión." : pending ? "Pendientes de mostrar. Tus ediciones locales se conservan." : "Cambios recibidos. Los ítems actualizados están resaltados en la mesa."}</span></div>
    <button type="button" onClick={() => window.dispatchEvent(new CustomEvent("caf:show-ai-changes", { detail: { projectId: activity.projectId } }))}>Ver cambios</button>
    <button type="button" aria-label="Quitar aviso y resaltado de cambios IA" onClick={onDismiss}>×</button>
  </aside>;
}
