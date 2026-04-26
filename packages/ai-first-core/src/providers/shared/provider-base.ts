import { setTimeout as sleep } from "node:timers/promises";

import type {
  AiProviderAdapter,
  DetectOfficialBlockInput,
  DetectOfficialBlockOutput,
  ExtractItemsBatchInput,
  ExtractItemsBatchOutput,
  PromptArtifact,
  ProviderUsageMetadata,
  ValidateBatchInput,
  ValidateBatchOutput,
  ValidateGlobalInput,
  ValidateGlobalOutput,
} from "../../../../ai-first-contracts/src/providers/ai-provider";
import type { AiProvider } from "../../../../ai-first-contracts/src/enums";
import type { ProviderRuntimeSettings } from "../../config/runtime";

import { ProviderHttpError } from "./http";
import { getResponseJsonSchema, getResponseSchema } from "./schema-registry";
import { MockInferenceEngine } from "./mock-inference";
import { renderDetectOfficialBlockPrompt, renderExtractItemsBatchPrompt, renderValidateBatchPrompt, renderValidateGlobalPrompt } from "../../prompts/task-prompt-builders";

interface StructuredInvocationRequest {
  prompt: PromptArtifact;
  taskConfig: DetectOfficialBlockInput["task_config"];
  userPrompt: string;
  input: DetectOfficialBlockInput | ExtractItemsBatchInput | ValidateBatchInput | ValidateGlobalInput;
}

interface StructuredInvocationResult {
  output: unknown;
  usage: ProviderUsageMetadata;
  rawResponse: unknown;
}

function resolveRetryDelayMs(error: unknown, attempt: number): number {
  if (error instanceof ProviderHttpError) {
    const providerMessage =
      error.responseBody &&
      typeof error.responseBody === "object" &&
      "error" in error.responseBody &&
      error.responseBody.error &&
      typeof error.responseBody.error === "object" &&
      "message" in error.responseBody.error &&
      typeof error.responseBody.error.message === "string"
        ? error.responseBody.error.message
        : "";
    const retryMatch = providerMessage.match(/retry in\s+([0-9]+(?:\.[0-9]+)?)/i);

    if (retryMatch) {
      return Math.ceil(Number(retryMatch[1]) * 1_000) + 500;
    }

    if (error.status === 429) {
      return Math.min(30_000, 8_000 * attempt);
    }

    if (error.status === 503) {
      return Math.min(20_000, 5_000 * attempt);
    }
  }

  return Math.min(8_000, 1_000 * 2 ** (attempt - 1));
}

export abstract class BaseAiProviderAdapter implements AiProviderAdapter {
  protected readonly mockEngine: MockInferenceEngine;

  constructor(
    readonly provider: AiProvider,
    protected readonly runtime: ProviderRuntimeSettings,
  ) {
    this.mockEngine = new MockInferenceEngine(provider);
  }

  protected hasApiKey(): boolean {
    return Boolean(this.runtime.apiKey) && !this.runtime.forceMock;
  }

  protected shouldFallbackToMock(): boolean {
    return !this.hasApiKey() || this.runtime.mockOnError;
  }

  protected async executeWithRetries<T>(taskConfig: StructuredInvocationRequest["taskConfig"], action: () => Promise<T>): Promise<T> {
    let attempt = 0;
    let lastError: unknown;

    while (attempt <= taskConfig.max_retries) {
      try {
        return await action();
      } catch (error) {
        lastError = error;
        attempt += 1;
        if (attempt > taskConfig.max_retries) {
          break;
        }

        const delayMs = resolveRetryDelayMs(error, attempt);
        await sleep(delayMs);
      }
    }

    throw lastError;
  }

  private async executeStructuredResult<T>({
    prompt,
    taskConfig,
    input,
    renderUserPrompt,
  }: {
    prompt: PromptArtifact;
    taskConfig: StructuredInvocationRequest["taskConfig"];
    input: StructuredInvocationRequest["input"];
    renderUserPrompt: () => string;
  }): Promise<{
    output: T;
    usage: ProviderUsageMetadata;
    rawResponse: unknown;
  }> {
    const userPrompt = renderUserPrompt();

    return this.executeWithRetries(taskConfig, async () => {
      const invocation = await this.invokeStructured({
        prompt,
        taskConfig,
        userPrompt,
        input,
      });
      const schema = getResponseSchema(prompt.response_schema_name);
      const parsed = schema.parse(invocation.output) as T;
      return {
        output: parsed,
        usage: invocation.usage,
        rawResponse: invocation.rawResponse,
      };
    });
  }

  async detectOfficialBlock(input: DetectOfficialBlockInput): Promise<DetectOfficialBlockOutput> {
    if (!this.hasApiKey()) {
      return this.mockEngine.detectOfficialBlock(input);
    }

    try {
      const execution = await this.executeStructuredResult<DetectOfficialBlockOutput["result"]>({
        prompt: input.prompt,
        taskConfig: input.task_config,
        input,
        renderUserPrompt: () => renderDetectOfficialBlockPrompt(input),
      });

      return {
        result: execution.output,
        usage: execution.usage,
        raw_response: execution.rawResponse,
      };
    } catch (error) {
      if (!this.shouldFallbackToMock()) {
        throw error;
      }

      return this.mockEngine.detectOfficialBlock(input);
    }
  }

  async extractItemsBatch(input: ExtractItemsBatchInput): Promise<ExtractItemsBatchOutput> {
    if (!this.hasApiKey()) {
      return this.mockEngine.extractItemsBatch(input);
    }

    try {
      const execution = await this.executeStructuredResult<ExtractItemsBatchOutput["items"]>({
        prompt: input.prompt,
        taskConfig: input.task_config,
        input,
        renderUserPrompt: () => renderExtractItemsBatchPrompt(input),
      });

      return {
        items: execution.output,
        usage: execution.usage,
        raw_response: execution.rawResponse,
      };
    } catch (error) {
      if (!this.shouldFallbackToMock()) {
        throw error;
      }

      return this.mockEngine.extractItemsBatch(input);
    }
  }

  async validateBatch(input: ValidateBatchInput): Promise<ValidateBatchOutput> {
    if (!this.hasApiKey()) {
      return this.mockEngine.validateBatch(input);
    }

    try {
      const execution = await this.executeStructuredResult<ValidateBatchOutput["result"]>({
        prompt: input.prompt,
        taskConfig: input.task_config,
        input,
        renderUserPrompt: () => renderValidateBatchPrompt(input),
      });

      return {
        result: execution.output,
        usage: execution.usage,
        raw_response: execution.rawResponse,
      };
    } catch (error) {
      if (!this.shouldFallbackToMock()) {
        throw error;
      }

      return this.mockEngine.validateBatch(input);
    }
  }

  async validateGlobal(input: ValidateGlobalInput): Promise<ValidateGlobalOutput> {
    if (!this.hasApiKey()) {
      return this.mockEngine.validateGlobal(input);
    }

    try {
      const execution = await this.executeStructuredResult<ValidateGlobalOutput["result"]>({
        prompt: input.prompt,
        taskConfig: input.task_config,
        input,
        renderUserPrompt: () => renderValidateGlobalPrompt(input),
      });

      return {
        result: execution.output,
        usage: execution.usage,
        raw_response: execution.rawResponse,
      };
    } catch (error) {
      if (!this.shouldFallbackToMock()) {
        throw error;
      }

      return this.mockEngine.validateGlobal(input);
    }
  }

  protected buildSchemaPayload(prompt: PromptArtifact) {
    return getResponseJsonSchema(prompt.response_schema_name);
  }

  protected abstract invokeStructured(request: StructuredInvocationRequest): Promise<StructuredInvocationResult>;
}
