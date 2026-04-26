import { LocalProcessingService } from "@ai-first-core/local-dev/local-processing-service";

import {
  applyStoredProviderSettingsToProcessEnv,
  getActiveProviderDefaults,
  getProviderSettingsSummary,
} from "./provider-settings";

export function getLocalProcessingService(): LocalProcessingService {
  applyStoredProviderSettingsToProcessEnv();
  return new LocalProcessingService();
}

export function getDocumentOrThrow(documentId: string) {
  const record = getLocalProcessingService().getDocument(documentId);
  if (!record) {
    throw new Error(`Document not found: ${documentId}`);
  }

  return record;
}

export function listRecentDocuments(limit = 8) {
  return getLocalProcessingService().listDocuments(limit);
}

export function getHomePageProviderSettings() {
  return getProviderSettingsSummary();
}

export function getHomePageUploadDefaults() {
  return getActiveProviderDefaults();
}
