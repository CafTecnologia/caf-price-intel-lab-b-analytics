import { parseJsonFromText } from "./shared/json";
import { postJson } from "./shared/http";
import { BaseAiProviderAdapter } from "./shared/provider-base";

interface OpenAiResponsesApiResponse {
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

export class OpenAiAdapter extends BaseAiProviderAdapter {
  protected async invokeStructured(request: Parameters<BaseAiProviderAdapter["invokeStructured"]>[0]) {
    const startedAt = Date.now();
    const url = `${this.runtime.baseUrl.replace(/\/$/, "")}/v1/responses`;
    const schema = this.buildSchemaPayload(request.prompt);

    const response = await postJson<OpenAiResponsesApiResponse>({
      url,
      headers: {
        Authorization: `Bearer ${this.runtime.apiKey}`,
        "Content-Type": "application/json",
      },
      timeoutMs: request.taskConfig.timeout_ms,
      body: {
        model: request.taskConfig.model,
        instructions: request.prompt.system_instructions,
        input: request.userPrompt,
        temperature: request.taskConfig.temperature,
        max_output_tokens: request.taskConfig.max_output_tokens ?? undefined,
        text: {
          format: {
            type: "json_schema",
            name: request.prompt.response_schema_name.replace(/[^a-zA-Z0-9_-]/g, "_"),
            schema,
            strict: true,
          },
        },
      },
    });

    const text =
      response.output_text ??
      response.output
        ?.flatMap((item) => item.content ?? [])
        .map((content) => content.text ?? "")
        .join("\n") ??
      "";

    return {
      output: parseJsonFromText(text),
      rawResponse: response,
      usage: {
        provider: this.provider,
        model: request.taskConfig.model,
        input_tokens: response.usage?.input_tokens ?? null,
        output_tokens: response.usage?.output_tokens ?? null,
        latency_ms: Date.now() - startedAt,
        finish_reason: "stop",
      },
    };
  }
}
