import { detectOfficialBlockPromptV1 } from "./detect-official-block";
import { extractItemsBatchPromptV1 } from "./extract-items-batch";
import { validateBatchPromptV1 } from "./validate-batch";
import { validateGlobalPromptV1 } from "./validate-global";

export * from "./base";
export * from "./detect-official-block";
export * from "./extract-items-batch";
export * from "./validate-batch";
export * from "./validate-global";

export const promptRegistry = {
  detectOfficialBlockPrompt: detectOfficialBlockPromptV1,
  extractItemsBatchPrompt: extractItemsBatchPromptV1,
  validateBatchPrompt: validateBatchPromptV1,
  validateGlobalPrompt: validateGlobalPromptV1,
} as const;
