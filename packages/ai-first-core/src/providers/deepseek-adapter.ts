import { parseJsonFromText } from "./shared/json";
import { postJson } from "./shared/http";
import { BaseAiProviderAdapter } from "./shared/provider-base";

interface DeepSeekResponse {
  choices?: Array<{
    finish_reason?: string | null;
    message?: {
      content?: string;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

export class DeepSeekAdapter extends BaseAiProviderAdapter {
  protected async invokeStructured(request: Parameters<BaseAiProviderAdapter["invokeStructured"]>[0]) {
    const startedAt = Date.now();
    const url = `${this.runtime.baseUrl.replace(/\/$/, "")}/chat/completions`;

    const schemaInstruction = [
      "Return valid JSON only.",
      `Match this schema name exactly: ${request.prompt.response_schema_name}.`,
      `JSON Schema: ${JSON.stringify(this.buildSchemaPayload(request.prompt))}`,
    ].join("\n");

    const response = await postJson<DeepSeekResponse>({
      url,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.runtime.apiKey}`,
      },
      timeoutMs: request.taskConfig.timeout_ms,
      body: {
        model: request.taskConfig.model,
        temperature: request.taskConfig.temperature,
        max_tokens: request.taskConfig.max_output_tokens ?? undefined,
        stream: false,
        response_format: {
          type: "json_object",
        },
        messages: [
          {
            role: "system",
            content: `${request.prompt.system_instructions}\n\n${schemaInstruction}`,
          },
          {
            role: "user",
            content: request.userPrompt,
          },
        ],
      },
    });

    const content = response.choices?.[0]?.message?.content ?? "";

    return {
      output: parseJsonFromText(content),
      rawResponse: response,
      usage: {
        provider: this.provider,
        model: request.taskConfig.model,
        input_tokens: response.usage?.prompt_tokens ?? null,
        output_tokens: response.usage?.completion_tokens ?? null,
        latency_ms: Date.now() - startedAt,
        finish_reason: response.choices?.[0]?.finish_reason ?? null,
      },
    };
  }
}
