import type {
  AiProviderAdapter,
  AiProviderRegistry,
  DetectOfficialBlockInput,
  DetectOfficialBlockOutput,
  ExtractItemsBatchInput,
  ExtractItemsBatchOutput,
  ValidateBatchInput,
  ValidateBatchOutput,
  ValidateGlobalInput,
  ValidateGlobalOutput,
} from "../../../ai-first-contracts/src/providers/ai-provider";
import type { AiProvider } from "../../../ai-first-contracts/src/enums";

import { MockInferenceEngine } from "../providers/shared/mock-inference";

export class ScenarioProviderAdapter implements AiProviderAdapter {
  readonly provider: AiProvider;
  private readonly mockEngine: MockInferenceEngine;
  private readonly batchAttempts = new Map<string, number>();

  constructor(
    provider: AiProvider,
    private readonly options: {
      retryOnceBatchIds?: string[];
    } = {},
  ) {
    this.provider = provider;
    this.mockEngine = new MockInferenceEngine(provider);
  }

  async detectOfficialBlock(input: DetectOfficialBlockInput): Promise<DetectOfficialBlockOutput> {
    return this.mockEngine.detectOfficialBlock(input);
  }

  async extractItemsBatch(input: ExtractItemsBatchInput): Promise<ExtractItemsBatchOutput> {
    return this.mockEngine.extractItemsBatch(input);
  }

  async validateBatch(input: ValidateBatchInput): Promise<ValidateBatchOutput> {
    const currentAttempt = (this.batchAttempts.get(input.batch.batch_id) ?? 0) + 1;
    this.batchAttempts.set(input.batch.batch_id, currentAttempt);

    const result = await this.mockEngine.validateBatch(input);
    const shouldForceRetry =
      currentAttempt === 1 && (this.options.retryOnceBatchIds ?? []).includes(input.batch.batch_id);

    if (!shouldForceRetry) {
      return result;
    }

    return {
      ...result,
      result: {
        ...result.result,
        validation_score: Math.min(result.result.validation_score, 0.42),
        completeness_score: Math.min(result.result.completeness_score, 0.4),
        structural_consistency_score: Math.min(result.result.structural_consistency_score, 0.45),
        recommendation: "retry",
        warnings: Array.from(
          new Set([...result.result.warnings, "Synthetic audit forced a retry on the first validation attempt."]),
        ),
        rationale: "Synthetic audit forced a retry on the first attempt to verify batch retry behavior.",
      },
      raw_response: {
        mode: "scenario-provider",
        forced_retry: true,
        attempt_number: currentAttempt,
        base: result.raw_response,
      },
    };
  }

  async validateGlobal(input: ValidateGlobalInput): Promise<ValidateGlobalOutput> {
    return this.mockEngine.validateGlobal(input);
  }
}

export class SingleProviderRegistry implements AiProviderRegistry {
  constructor(private readonly adapter: AiProviderAdapter) {}

  get(provider: AiProvider): AiProviderAdapter {
    if (provider !== this.adapter.provider) {
      throw new Error(`Scenario provider registry only supports ${this.adapter.provider}, received ${provider}`);
    }

    return this.adapter;
  }

  list(): AiProviderAdapter[] {
    return [this.adapter];
  }
}
