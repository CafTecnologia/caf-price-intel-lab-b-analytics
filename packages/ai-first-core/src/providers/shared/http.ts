export class ProviderHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly responseBody: unknown,
  ) {
    super(message);
    this.name = "ProviderHttpError";
  }
}

export async function postJson<TResponse>(args: {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  timeoutMs: number;
}): Promise<TResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), args.timeoutMs);

  try {
    const response = await fetch(args.url, {
      method: "POST",
      headers: args.headers,
      body: JSON.stringify(args.body),
      signal: controller.signal,
    });

    const rawText = await response.text();
    const parsedBody = rawText ? JSON.parse(rawText) : null;

    if (!response.ok) {
      throw new ProviderHttpError(
        `Provider request failed with status ${response.status}`,
        response.status,
        parsedBody,
      );
    }

    return parsedBody as TResponse;
  } finally {
    clearTimeout(timeout);
  }
}
