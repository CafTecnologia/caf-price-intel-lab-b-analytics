export type PromptKey =
  | "detectOfficialBlockPrompt"
  | "extractItemsBatchPrompt"
  | "validateBatchPrompt"
  | "validateGlobalPrompt";

export interface PromptArtifact {
  key: PromptKey;
  version: string;
  description: string;
  responseSchemaName: string;
  systemInstructions: string;
  userTemplate: string;
}
