import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authenticateChatGPT, authErrorResponse } from "../../../../lib/chatgpt-auth";
import { createFinanceMcpServer } from "../../../../lib/chatgpt-mcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(request: Request): Promise<Response> {
  let server: ReturnType<typeof createFinanceMcpServer> | undefined;
  let transport: WebStandardStreamableHTTPServerTransport | undefined;
  try {
    const actor = await authenticateChatGPT(request);
    if (request.method === "POST") {
      const size = Number(request.headers.get("content-length") ?? 0);
      if (size > 524288) return new Response("Solicitud demasiado grande.", { status: 413 });
      const body = await request.text();
      if (new TextEncoder().encode(body).byteLength > 524288) return new Response("Solicitud demasiado grande.", { status: 413 });
      request = new Request(request.url, { method: request.method, headers: request.headers, body });
    }
    server = createFinanceMcpServer(actor);
    transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    const response = await transport.handleRequest(request);
    // Stateless JSON responses are consumed before closing per-request SDK resources.
    const body = await response.arrayBuffer();
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "private, no-store");
    headers.set("Vary", "Authorization");
    return new Response(body.byteLength ? body : null, { status: response.status, headers });
  } catch (error) {
    return authErrorResponse(error);
  } finally {
    await transport?.close();
    await server?.close();
  }
}
export const POST = handle;
export const GET = handle;
export const DELETE = handle;
