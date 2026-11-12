import {
  authErrorResponse,
  beginAuthorization,
  completeAuthorization,
  exchangeToken,
  revokeToken,
} from "@offer/lib/chatgpt-auth";

export const runtime = "nodejs";

type Context = { params: Promise<{ action: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const { action } = await context.params;
    if (action !== "authorize") return Response.json({ error: "not_found" }, { status: 404 });
    return await beginAuthorization(request);
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request: Request, context: Context) {
  try {
    const { action } = await context.params;
    if (action === "authorize") return await completeAuthorization(request);
    if (action === "token") return await exchangeToken(request);
    if (action === "revoke") return await revokeToken(request);
    return Response.json({ error: "not_found" }, { status: 404 });
  } catch (error) {
    return authErrorResponse(error);
  }
}
