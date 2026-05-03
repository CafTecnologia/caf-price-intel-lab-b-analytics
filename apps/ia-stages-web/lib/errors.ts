import { normalizePipelineFailure } from "@/lib/ai-failures";

export function toUserErrorMessage(error: unknown, fallback: string) {
  const failure = normalizePipelineFailure(error, "pipeline");

  if (failure.code === "UNEXPECTED_ERROR") {
    return fallback;
  }

  return `${failure.userMessage} ${failure.userAction}`;
}
