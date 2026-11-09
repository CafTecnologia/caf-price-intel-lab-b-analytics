export type StudyDialogueEvent = { at?: string; type?: string; message?: string };

const PUBLIC_PROCESS_EVENT_TYPES = new Set(["queued", "phase", "tool", "source", "decision", "error", "completed"]);

export function visibleStudyEvents(events?: StudyDialogueEvent[]): StudyDialogueEvent[] {
  return (events ?? [])
    .filter((event) => PUBLIC_PROCESS_EVENT_TYPES.has(event.type ?? "") && typeof event.message === "string")
    .slice(-10);
}
