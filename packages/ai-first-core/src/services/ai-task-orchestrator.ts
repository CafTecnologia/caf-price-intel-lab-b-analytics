import type {
  DetectOfficialBlockInput,
  ExtractItemsBatchInput,
  ValidateBatchInput,
  ValidateGlobalInput,
} from "../../../ai-first-contracts/src/providers/ai-provider";
import type { AiProviderRegistry } from "../../../ai-first-contracts/src/providers/ai-provider";

import { PromptCatalog } from "../prompts/prompt-catalog";
import { DefaultAiProviderRegistry } from "../providers/provider-registry";

type DetectOfficialBlockRequest = Omit<DetectOfficialBlockInput, "prompt">;
type ExtractItemsBatchRequest = Omit<ExtractItemsBatchInput, "prompt">;
type ValidateBatchRequest = Omit<ValidateBatchInput, "prompt">;
type ValidateGlobalRequest = Omit<ValidateGlobalInput, "prompt">;

export class AiTaskOrchestrator {
  constructor(
    private readonly providerRegistry: AiProviderRegistry = new DefaultAiProviderRegistry(),
    private readonly promptCatalog: PromptCatalog = new PromptCatalog(),
  ) {}

  async detectOfficialBlock(request: DetectOfficialBlockRequest) {
    const prompt = this.promptCatalog.resolve("detectOfficialBlock", request.task_config.prompt_version);
    const provider = this.providerRegistry.get(request.task_config.provider);

    return provider.detectOfficialBlock({
      ...request,
      prompt,
    });
  }

  async extractItemsBatch(request: ExtractItemsBatchRequest) {
    const prompt = this.promptCatalog.resolve("extractItemsBatch", request.task_config.prompt_version);
    const provider = this.providerRegistry.get(request.task_config.provider);

    return provider.extractItemsBatch({
      ...request,
      prompt,
    });
  }

  async validateBatch(request: ValidateBatchRequest) {
    const prompt = this.promptCatalog.resolve("validateBatch", request.task_config.prompt_version);
    const provider = this.providerRegistry.get(request.task_config.provider);

    return provider.validateBatch({
      ...request,
      prompt,
    });
  }

  async validateGlobal(request: ValidateGlobalRequest) {
    const prompt = this.promptCatalog.resolve("validateGlobal", request.task_config.prompt_version);
    const provider = this.providerRegistry.get(request.task_config.provider);

    return provider.validateGlobal({
      ...request,
      prompt,
    });
  }
}
