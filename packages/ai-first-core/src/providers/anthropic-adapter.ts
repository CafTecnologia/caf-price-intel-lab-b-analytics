import { postJson } from "./shared/http";
import { BaseAiProviderAdapter } from "./shared/provider-base";

interface AnthropicResponse {
  content?: Array<
    | {
        type: "text";
        text: string;
      }
    | {
        type: "tool_use";
        id?: string;
        name?: string;
        input?: unknown;
      }
  >;
  stop_reason?: string | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

export class AnthropicAdapter extends BaseAiProviderAdapter {
  protected async invokeStructured(request: Parameters<BaseAiProviderAdapter["invokeStructured"]>[0]) {
    const startedAt = Date.now();
    const url = `${this.runtime.baseUrl.replace(/\/$/, "")}/v1/messages`;

    const response = await postJson<AnthropicResponse>({
      url,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.runtime.apiKey ?? "",
        "anthropic-version": "2023-06-01",
      },
      timeoutMs: request.taskConfig.timeout_ms,
      body: {
        model: request.taskConfig.model,
        max_tokens: request.taskConfig.max_output_tokens ?? 4096,
        temperature: request.taskConfig.temperature,
        system: request.prompt.system_instructions,
        messages: [
          {
            role: "user",
            content: request.userPrompt,
          },
        ],
        tools: [
          {
            name: "emit_structured_response",
            description: "Return the final structured response for this task.",
            input_schema: this.buildSchemaPayload(request.prompt),
          },
        ],
        tool_choice: {
          type: "tool",
          name: "emit_structured_response",
        },
      },
    });

    const toolUse = response.content?.find((block) => block.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      throw new Error("Anthropic response did not contain a forced tool_use block");
    }

    return {
      output: toolUse.input,
      rawResponse: response,
      usage: {
        provider: this.provider,
        model: request.taskConfig.model,
        input_tokens: response.usage?.input_tokens ?? null,
        output_tokens: response.usage?.output_tokens ?? null,
        latency_ms: Date.now() - startedAt,
        finish_reason: response.stop_reason ?? null,
      },
    };
  }
}
