import type { AiTaskKind } from "../../../ai-first-contracts/src/enums";
import type { PromptArtifact as ContractPromptArtifact } from "../../../ai-first-contracts/src/providers/ai-provider";
import { promptRegistry } from "../../../ai-first-prompts/src/index";

const promptKeyByTask: Record<AiTaskKind, keyof typeof promptRegistry> = {
  detectOfficialBlock: "detectOfficialBlockPrompt",
  extractItemsBatch: "extractItemsBatchPrompt",
  validateBatch: "validateBatchPrompt",
  validateGlobal: "validateGlobalPrompt",
};

function toContractPromptArtifact(
  artifact: (typeof promptRegistry)[keyof typeof promptRegistry],
): ContractPromptArtifact {
  return {
    key: artifact.key,
    version: artifact.version,
    description: artifact.description,
    system_instructions: artifact.systemInstructions,
    user_template: artifact.userTemplate,
    response_schema_name: artifact.responseSchemaName,
  };
}

export class PromptCatalog {
  resolve(task: AiTaskKind, expectedVersion?: string): ContractPromptArtifact {
    const artifact = toContractPromptArtifact(promptRegistry[promptKeyByTask[task]]);

    if (expectedVersion && artifact.version !== expectedVersion) {
      throw new Error(
        `Prompt version mismatch for ${task}: expected ${expectedVersion}, got ${artifact.version}`,
      );
    }

    return artifact;
  }
}
